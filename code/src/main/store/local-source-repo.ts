import { createHash } from 'node:crypto'
import { getDb } from './db'
import type {
  CliSourceId,
  LocalSourceConfig,
  LocalSourceEnvironment,
  LocalSourceErrorCode,
  LocalSourceStatus
} from '@shared/types/local-source'

export interface LocalSourceConfigInput {
  id?: string
  environment: LocalSourceEnvironment
  wslDistribution?: string
  cliSource: CliSourceId
  rootDir: string
  normalizedRoot: string
  enabled: boolean
  status?: LocalSourceStatus
  errorCode?: LocalSourceErrorCode
  errorMessage?: string
}

interface LocalSourceRow {
  id: string
  environment: LocalSourceEnvironment
  wsl_distribution: string
  cli_source: CliSourceId
  root_dir: string
  normalized_root: string
  enabled: number
  status: LocalSourceStatus
  last_attempt_at: string | null
  last_success_at: string | null
  error_code: LocalSourceErrorCode | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface SessionContextInput {
  sourceConfigId: string
  sessionId: string
  workspaceId?: string
  normalizedCwd?: string
  branch?: string
  seenAt?: string
}

export interface WorkspaceInput {
  id?: string
  environment: LocalSourceEnvironment
  wslDistribution?: string
  projectKey: string
  normalizedRoot: string
  displayName: string
  normalizedGitRoot?: string
  seenAt?: string
}

function distributionKey(value: string | undefined): string {
  return value?.trim() ?? ''
}

export function makeLocalSourceId(
  input: Pick<
    LocalSourceConfigInput,
    'environment' | 'wslDistribution' | 'cliSource' | 'normalizedRoot'
  >
): string {
  const key = [
    input.environment,
    distributionKey(input.wslDistribution),
    input.cliSource,
    input.normalizedRoot
  ].join('\u001f')
  return `local-source:${createHash('sha256').update(key).digest('hex').slice(0, 24)}`
}

function rowToConfig(row: LocalSourceRow): LocalSourceConfig {
  return {
    id: row.id,
    environment: row.environment,
    ...(row.wsl_distribution ? { wslDistribution: row.wsl_distribution } : {}),
    cliSource: row.cli_source,
    rootDir: row.root_dir,
    normalizedRoot: row.normalized_root,
    enabled: row.enabled === 1,
    status: row.status,
    ...(row.last_attempt_at ? { lastAttemptAt: row.last_attempt_at } : {}),
    ...(row.last_success_at ? { lastSuccessAt: row.last_success_at } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function selectById(id: string): LocalSourceRow | undefined {
  return getDb().prepare('SELECT * FROM local_source_configs WHERE id = ?').get(id) as
    LocalSourceRow | undefined
}

export function getLocalSourceConfig(id: string): LocalSourceConfig | undefined {
  const row = selectById(id)
  return row ? rowToConfig(row) : undefined
}

export function listLocalSourceConfigs(): LocalSourceConfig[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM local_source_configs ORDER BY enabled DESC, updated_at DESC, environment, wsl_distribution, cli_source'
    )
    .all() as LocalSourceRow[]
  return rows.map(rowToConfig)
}

export function upsertLocalSourceConfig(
  input: LocalSourceConfigInput,
  now = new Date()
): LocalSourceConfig {
  const db = getDb()
  const timestamp = now.toISOString()
  const wslDistribution = distributionKey(input.wslDistribution)
  const id = input.id ?? makeLocalSourceId(input)
  const existing = db
    .prepare(
      `SELECT id, created_at FROM local_source_configs
       WHERE environment = ? AND wsl_distribution = ? AND cli_source = ? AND normalized_root = ?`
    )
    .get(input.environment, wslDistribution, input.cliSource, input.normalizedRoot) as
    { id: string; created_at: string } | undefined
  const actualId = existing?.id ?? id
  const createdAt = existing?.created_at ?? timestamp

  db.prepare(
    `INSERT INTO local_source_configs (
       id, environment, wsl_distribution, cli_source, root_dir, normalized_root,
       enabled, status, error_code, error_message, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       environment = excluded.environment,
       wsl_distribution = excluded.wsl_distribution,
       cli_source = excluded.cli_source,
       root_dir = excluded.root_dir,
       normalized_root = excluded.normalized_root,
       enabled = excluded.enabled,
       status = excluded.status,
       error_code = excluded.error_code,
       error_message = excluded.error_message,
       updated_at = excluded.updated_at`
  ).run(
    actualId,
    input.environment,
    wslDistribution,
    input.cliSource,
    input.rootDir,
    input.normalizedRoot,
    input.enabled ? 1 : 0,
    input.status ?? (input.enabled ? 'enabled' : 'discovered'),
    input.errorCode ?? null,
    input.errorMessage ?? null,
    createdAt,
    timestamp
  )
  return rowToConfig(selectById(actualId)!)
}

export function setLocalSourceEnabled(
  id: string,
  enabled: boolean,
  now = new Date()
): LocalSourceConfig | undefined {
  const timestamp = now.toISOString()
  getDb()
    .prepare(
      `UPDATE local_source_configs
       SET enabled = ?, status = CASE WHEN ? = 1 THEN 'enabled' ELSE 'discovered' END,
           error_code = NULL, error_message = NULL, updated_at = ?
       WHERE id = ?`
    )
    .run(enabled ? 1 : 0, enabled ? 1 : 0, timestamp, id)
  const row = selectById(id)
  return row ? rowToConfig(row) : undefined
}

export function upsertWorkspace(input: WorkspaceInput, now = new Date()): string {
  const db = getDb()
  const timestamp = input.seenAt ?? now.toISOString()
  const wslDistribution = distributionKey(input.wslDistribution)
  const id =
    input.id ??
    `workspace:${createHash('sha256').update(input.projectKey).digest('hex').slice(0, 24)}`
  db.prepare(
    `INSERT INTO workspaces (
       id, environment, wsl_distribution, project_key, normalized_root, display_name,
       normalized_git_root, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_key) DO UPDATE SET
       display_name = excluded.display_name,
       normalized_git_root = COALESCE(excluded.normalized_git_root, workspaces.normalized_git_root),
       updated_at = excluded.updated_at`
  ).run(
    id,
    input.environment,
    wslDistribution,
    input.projectKey,
    input.normalizedRoot,
    input.displayName,
    input.normalizedGitRoot ?? null,
    timestamp,
    timestamp
  )
  const row = db
    .prepare('SELECT id FROM workspaces WHERE project_key = ?')
    .get(input.projectKey) as { id: string } | undefined
  if (!row) throw new Error('workspace upsert failed')
  return row.id
}

export function updateLocalSourceStatus(
  id: string,
  status: LocalSourceStatus,
  details: { errorCode?: LocalSourceErrorCode; errorMessage?: string; success?: boolean } = {},
  now = new Date()
): LocalSourceConfig | undefined {
  const timestamp = now.toISOString()
  getDb()
    .prepare(
      `UPDATE local_source_configs
       SET status = ?,
           last_attempt_at = ?,
           last_success_at = CASE WHEN ? = 1 THEN ? ELSE last_success_at END,
           error_code = ?,
           error_message = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .run(
      status,
      timestamp,
      details.success ? 1 : 0,
      timestamp,
      details.errorCode ?? null,
      details.errorMessage ?? null,
      timestamp,
      id
    )
  const row = selectById(id)
  return row ? rowToConfig(row) : undefined
}

export function upsertSessionContext(input: SessionContextInput, now = new Date()): void {
  const timestamp = input.seenAt ?? now.toISOString()
  getDb()
    .prepare(
      `INSERT INTO session_contexts (
         source_config_id, session_id, workspace_id, normalized_cwd, branch,
         first_seen_at, last_seen_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_config_id, session_id) DO UPDATE SET
         workspace_id = COALESCE(excluded.workspace_id, session_contexts.workspace_id),
         normalized_cwd = COALESCE(excluded.normalized_cwd, session_contexts.normalized_cwd),
         branch = COALESCE(excluded.branch, session_contexts.branch),
         last_seen_at = excluded.last_seen_at`
    )
    .run(
      input.sourceConfigId,
      input.sessionId,
      input.workspaceId ?? null,
      input.normalizedCwd ?? null,
      input.branch ?? null,
      timestamp,
      timestamp
    )
}
