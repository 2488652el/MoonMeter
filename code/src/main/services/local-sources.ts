import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  getCliPaths,
  normalizeWindowsWorkspace,
  normalizeWorkspaceProjectKey,
  normalizeWslWorkspace,
  resolveCliPaths
} from '../platform/paths'
import { resolveGitRoot, type GitCommandRunner } from '../platform/git'
import {
  discoverWslDistributions,
  resolveWslHome,
  statusForWslError,
  validateWslDistributionName,
  wslErrorMessage,
  type WslCommandRunner
} from '../platform/wsl'
import {
  CLI_LOG_SOURCES,
  cliSourceRoot,
  getCliLogSource,
  type CliSourceContext
} from '../log-parsers/registry'
import { syncAllSessions, type SyncProgress } from '../log-parsers/sync'
import {
  getLocalSourceConfig,
  listLocalSourceConfigs,
  setLocalSourceEnabled,
  updateLocalSourceStatus,
  upsertLocalSourceConfig,
  upsertSessionContext,
  upsertWorkspace,
  type LocalSourceConfigInput
} from '../store/local-source-repo'
import type {
  CliSourceId,
  LocalSourceConfig,
  LocalSourceErrorCode,
  LocalSourcePreviewInput,
  LocalSourceSyncInput,
  LocalSourceSyncResult,
  LocalSourcesOverview,
  SanitizedLocalSourceDiagnostic,
  SourcePreview,
  SourcePreviewCandidate,
  WslDistribution
} from '@shared/types/local-source'
import type { CliPaths } from '@shared/types/platform'

function sourcePosixRoot(homeDir: string, cliSource: CliSourceId): string {
  const roots: Record<CliSourceId, string> = {
    'claude-code': `${homeDir}/.claude/projects`,
    codex: `${homeDir}/.codex/sessions`,
    'kimi-code': `${homeDir}/.kimi-code/sessions`,
    'gemini-cli': `${homeDir}/.gemini/tmp`,
    opencode: `${homeDir}/.local/share/opencode/storage/message`
  }
  return roots[cliSource]
}

interface SessionFileMetadata {
  sessionId: string
  cwd?: string
  branch?: string
}

function safeMetadataString(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_000) return undefined
  if (Array.from(value).some((character) => character.charCodeAt(0) < 32)) return undefined
  return value.trim()
}

function readSessionFileHead(filePath: string): string {
  try {
    return readFileSync(filePath)
      .subarray(0, 128 * 1024)
      .toString('utf8')
  } catch {
    return ''
  }
}

function readSessionFileMetadata(filePath: string, cliSource: CliSourceId): SessionFileMetadata {
  let sessionId: string | undefined
  let cwd: string | undefined
  let branch: string | undefined
  for (const line of readSessionFileHead(filePath).split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const object = JSON.parse(line) as Record<string, unknown>
      const payload = object.payload as Record<string, unknown> | undefined
      const message = object.message as Record<string, unknown> | undefined
      const metadata = object.metadata as Record<string, unknown> | undefined
      const assistant = metadata?.assistant as Record<string, unknown> | undefined
      const assistantPath = assistant?.path as Record<string, unknown> | undefined
      sessionId ??=
        safeMetadataString(object.sessionId) ??
        safeMetadataString(object.session_id) ??
        safeMetadataString(object.thread_id) ??
        safeMetadataString(payload?.session_id) ??
        safeMetadataString(payload?.sessionId) ??
        safeMetadataString(payload?.thread_id) ??
        safeMetadataString(message?.sessionId)
      cwd ??=
        safeMetadataString(object.cwd) ??
        safeMetadataString(payload?.cwd) ??
        safeMetadataString(object.workDir) ??
        safeMetadataString(payload?.workDir) ??
        safeMetadataString(assistantPath?.root) ??
        safeMetadataString(assistantPath?.cwd)
      branch ??=
        safeMetadataString(object.branch) ??
        safeMetadataString(payload?.branch) ??
        safeMetadataString(metadata?.branch)
      if (sessionId && cwd && branch) break
    } catch {
      continue
    }
  }
  if (!cwd && cliSource === 'kimi-code') {
    try {
      const statePath = join(dirname(dirname(dirname(filePath))), 'state.json')
      const state = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>
      cwd = safeMetadataString(state.workDir)
    } catch {
      // The session context is best effort; missing state must not block usage sync.
    }
  }
  const fallbackSessionId = basename(filePath).replace(/\.(jsonl?|log)$/i, '')
  return {
    sessionId: sessionId ?? fallbackSessionId,
    ...(cwd ? { cwd } : {}),
    ...(branch ? { branch } : {})
  }
}

function workspaceDisplayName(cwd: string): string {
  const segments = cwd.split(/[\\/]/).filter(Boolean)
  return segments.at(-1) ?? '未命名项目'
}

async function persistSessionContexts(
  config: LocalSourceConfig,
  files: string[],
  wslCommandRunner?: WslCommandRunner,
  gitCommandRunner?: GitCommandRunner,
  seenAt = new Date()
): Promise<void> {
  const gitCache = new Map<string, Promise<Awaited<ReturnType<typeof resolveGitRoot>>>>()
  for (const filePath of files) {
    const metadata = readSessionFileMetadata(filePath, config.cliSource)
    if (!metadata.cwd) continue
    try {
      const gitKey = `${config.environment}\u0000${config.wslDistribution ?? ''}\u0000${metadata.cwd}`
      let gitResult = gitCache.get(gitKey)
      if (!gitResult) {
        const runner: GitCommandRunner | undefined =
          config.environment === 'wsl' && wslCommandRunner
            ? async (_executable, args, options) => wslCommandRunner(args, options)
            : gitCommandRunner
        gitResult = resolveGitRoot(metadata.cwd, config.environment, config.wslDistribution, runner)
        gitCache.set(gitKey, gitResult)
      }
      const gitRoot = (await gitResult).root
      const workspaceRoot = gitRoot ?? metadata.cwd
      const normalizedRoot =
        config.environment === 'wsl'
          ? normalizeWslWorkspace(config.wslDistribution ?? '', workspaceRoot)
          : normalizeWindowsWorkspace(workspaceRoot)
      const projectKey = normalizeWorkspaceProjectKey(
        config.environment,
        workspaceRoot,
        config.wslDistribution
      )
      const workspaceId = upsertWorkspace(
        {
          environment: config.environment,
          ...(config.wslDistribution ? { wslDistribution: config.wslDistribution } : {}),
          projectKey,
          normalizedRoot,
          displayName: workspaceDisplayName(workspaceRoot),
          ...(gitRoot
            ? {
                normalizedGitRoot:
                  config.environment === 'wsl'
                    ? normalizeWslWorkspace(config.wslDistribution ?? '', gitRoot)
                    : normalizeWindowsWorkspace(gitRoot)
              }
            : {}),
          seenAt: seenAt.toISOString()
        },
        seenAt
      )
      upsertSessionContext(
        {
          sourceConfigId: config.id,
          sessionId: metadata.sessionId,
          workspaceId,
          normalizedCwd:
            config.environment === 'wsl'
              ? normalizeWslWorkspace(config.wslDistribution ?? '', metadata.cwd)
              : normalizeWindowsWorkspace(metadata.cwd),
          ...(metadata.branch ? { branch: metadata.branch } : {}),
          seenAt: seenAt.toISOString()
        },
        seenAt
      )
    } catch {
      // A malformed cwd or unavailable WSL mount should only reduce project
      // attribution completeness; it must not block usage ingestion.
    }
  }
}

function sourceRootKey(cliSource: CliSourceId): keyof CliPaths {
  return getCliLogSource(cliSource).rootPathKey
}

function withSelectedRoot(paths: CliPaths, cliSource: CliSourceId, rootDir: string): CliPaths {
  const key = sourceRootKey(cliSource)
  return { ...paths, [key]: rootDir }
}

function localErrorCode(error: unknown): LocalSourceErrorCode {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (/wsl 不可用|not installed|wsl\.exe/.test(message)) return 'wsl-unavailable'
  if (/未找到所选|not found/.test(message)) return 'distribution-not-found'
  if (/permission|权限|access denied/.test(message)) return 'permission-denied'
  if (/timeout|超时/.test(message)) return 'timeout'
  if (/path|目录|数据目录/.test(message)) return 'path-missing'
  return 'unknown-error'
}

function sourceStatusForCandidate(
  candidate: SourcePreviewCandidate
): NonNullable<LocalSourceConfigInput['status']> {
  return candidate.exists ? 'enabled' : 'unavailable'
}

function errorDetails(error: unknown): { errorCode: LocalSourceErrorCode; errorMessage: string } {
  const errorCode = localErrorCode(error)
  return { errorCode, errorMessage: wslErrorMessage(errorCode) }
}

function mergeDistributionConfigState(
  distribution: WslDistribution,
  configs: LocalSourceConfig[]
): WslDistribution {
  const enabled = configs.some(
    (config) =>
      config.environment === 'wsl' && config.wslDistribution === distribution.name && config.enabled
  )
  if (!enabled) return { ...distribution, enabled }
  if (distribution.state === 'stopped') return { ...distribution, enabled, status: 'stopped' }
  return { ...distribution, enabled, status: 'enabled' }
}

export async function getLocalSourcesOverview(
  commandRunner?: WslCommandRunner
): Promise<LocalSourcesOverview> {
  const configs = listLocalSourceConfigs()
  const discovery = await discoverWslDistributions(commandRunner)
  return {
    generatedAt: new Date().toISOString(),
    wslAvailable: discovery.available,
    ...(discovery.errorCode ? { wslErrorCode: discovery.errorCode } : {}),
    ...(discovery.errorMessage ? { wslErrorMessage: discovery.errorMessage } : {}),
    distributions: discovery.distributions.map((distribution) =>
      mergeDistributionConfigState(distribution, configs)
    ),
    configs
  }
}

async function buildPreview(
  input: LocalSourcePreviewInput,
  commandRunner?: WslCommandRunner
): Promise<SourcePreview> {
  const generatedAt = new Date().toISOString()
  const cliSources = input.cliSource ? [getCliLogSource(input.cliSource)] : [...CLI_LOG_SOURCES]
  let homeDir: string | undefined
  let paths: CliPaths
  let normalizedRootFor = (candidateRoot: string): string =>
    normalizeWindowsWorkspace(candidateRoot)

  if (input.environment === 'wsl') {
    const distribution = validateWslDistributionName(input.wslDistribution ?? '')
    const discovery = await discoverWslDistributions(commandRunner)
    const found = discovery.distributions.find((candidate) => candidate.name === distribution)
    if (!found) {
      const errorCode = discovery.available
        ? 'distribution-not-found'
        : (discovery.errorCode ?? 'wsl-unavailable')
      return {
        environment: 'wsl',
        wslDistribution: distribution,
        candidates: [],
        generatedAt,
        status: statusForWslError(errorCode),
        errorCode,
        errorMessage: wslErrorMessage(errorCode)
      }
    }
    homeDir = await resolveWslHome(distribution, commandRunner)
    paths = getCliPathsForWsl(homeDir, distribution)
    normalizedRootFor = (candidateRoot: string): string =>
      normalizeWslWorkspace(distribution, candidateRoot)
  } else {
    if (process.platform !== 'win32') {
      return {
        environment: input.environment,
        candidates: [],
        generatedAt,
        status: 'unavailable',
        errorCode: 'path-missing',
        errorMessage: 'Windows CLI 来源仅在 Windows 主机上可用'
      }
    }
    paths = getCliPaths()
  }

  const configs = listLocalSourceConfigs()
  const candidates = cliSources.map<SourcePreviewCandidate>((source) => {
    const rootDir = cliSourceRoot(source, {
      environment: input.environment === 'wsl' ? 'wsl' : 'windows',
      paths
    })
    const normalizedRoot =
      input.environment === 'wsl'
        ? normalizeWslWorkspace(
            input.wslDistribution ?? '',
            sourcePosixRoot(homeDir ?? '/', source.id)
          )
        : normalizedRootFor(rootDir)
    const existing = configs.find(
      (config) =>
        config.environment === input.environment &&
        config.wslDistribution === (input.wslDistribution ?? undefined) &&
        config.cliSource === source.id &&
        config.normalizedRoot === normalizedRoot
    )
    return {
      cliSource: source.id,
      displayName: source.displayName,
      rootDir,
      normalizedRoot,
      exists: existsSync(rootDir),
      enabled: existing?.enabled ?? false
    }
  })
  const hasExistingCandidate = candidates.some((candidate) => candidate.exists)
  return {
    environment: input.environment,
    ...(input.environment === 'wsl' ? { wslDistribution: input.wslDistribution } : {}),
    ...(homeDir ? { homeDir } : {}),
    candidates,
    generatedAt,
    status: hasExistingCandidate ? 'discovered' : 'unavailable',
    ...(hasExistingCandidate
      ? {}
      : { errorCode: 'path-missing', errorMessage: wslErrorMessage('path-missing') })
  }
}

function getCliPathsForWsl(homeDir: string, distribution: string): CliPaths {
  return resolveCliPaths('wsl', homeDir, distribution)
}

export async function previewLocalSource(
  input: LocalSourcePreviewInput,
  commandRunner?: WslCommandRunner
): Promise<SourcePreview> {
  try {
    return await buildPreview(input, commandRunner)
  } catch (error) {
    const details = errorDetails(error)
    return {
      environment: input.environment,
      ...(input.wslDistribution ? { wslDistribution: input.wslDistribution } : {}),
      candidates: [],
      generatedAt: new Date().toISOString(),
      status: statusForWslError(details.errorCode),
      errorCode: details.errorCode,
      errorMessage: details.errorMessage
    }
  }
}

export async function setLocalSourceEnabledForInput(
  input: {
    sourceId?: string
    environment: 'windows' | 'wsl'
    wslDistribution?: string
    cliSource: CliSourceId
    enabled: boolean
  },
  commandRunner?: WslCommandRunner
): Promise<LocalSourceConfig> {
  if (!input.enabled && input.sourceId) {
    const existing = getLocalSourceConfig(input.sourceId)
    const requestedDistribution = input.wslDistribution?.trim() ?? ''
    if (
      !existing ||
      existing.environment !== input.environment ||
      existing.cliSource !== input.cliSource ||
      (existing.wslDistribution ?? '') !== requestedDistribution
    ) {
      throw new Error('local source identity mismatch')
    }
    const updated = setLocalSourceEnabled(input.sourceId, false)
    if (!updated) throw new Error('local source not found')
    return updated
  }
  if (!input.enabled) throw new Error('sourceId is required to disable a local source')

  const preview = await previewLocalSource(
    {
      environment: input.environment,
      cliSource: input.cliSource,
      ...(input.wslDistribution ? { wslDistribution: input.wslDistribution } : {})
    },
    commandRunner
  )
  const candidate = preview.candidates.find((item) => item.cliSource === input.cliSource)
  if (!candidate) throw new Error(preview.errorMessage ?? 'source preview unavailable')
  const sourceInput: LocalSourceConfigInput = {
    environment: input.environment,
    ...(input.wslDistribution ? { wslDistribution: input.wslDistribution } : {}),
    cliSource: input.cliSource,
    rootDir: candidate.rootDir,
    normalizedRoot: candidate.normalizedRoot,
    enabled: true,
    status: sourceStatusForCandidate(candidate),
    ...(candidate.exists
      ? {}
      : { errorCode: 'path-missing' as const, errorMessage: wslErrorMessage('path-missing') })
  }
  return upsertLocalSourceConfig(sourceInput)
}

function sourceContextForConfig(config: LocalSourceConfig, paths: CliPaths): CliSourceContext {
  return {
    environment: config.environment === 'wsl' ? 'wsl' : 'windows',
    paths: withSelectedRoot(paths, config.cliSource, config.rootDir),
    ...(config.wslDistribution ? { wslDistribution: config.wslDistribution } : {}),
    sourceConfigId: config.id
  }
}

async function syncOneLocalSource(
  config: LocalSourceConfig,
  onProgress?: (progress: SyncProgress) => void,
  commandRunner?: WslCommandRunner
): Promise<LocalSourceSyncResult['results'][number]> {
  try {
    let paths: CliPaths
    if (config.environment === 'wsl') {
      const distribution = config.wslDistribution
      if (!distribution) throw new Error('distribution-not-found')
      const home = await resolveWslHome(distribution, commandRunner)
      paths = getCliPathsForWsl(home, distribution)
    } else {
      paths = getCliPaths()
    }
    const context = sourceContextForConfig(config, paths)
    const source = getCliLogSource(config.cliSource)
    const discoveredFiles = source.discover(context)
    const files = discoveredFiles.length
    const result = syncAllSessions(config.cliSource, onProgress, context)
    await persistSessionContexts(config, discoveredFiles, commandRunner)
    updateLocalSourceStatus(config.id, 'ready', { success: true })
    return {
      sourceId: config.id,
      cliSource: config.cliSource,
      files,
      lines: result.totals.lines,
      tokens: result.totals.tokens,
      inserted: result.totals.inserted
    }
  } catch (error) {
    const details = errorDetails(error)
    updateLocalSourceStatus(config.id, statusForWslError(details.errorCode), details)
    return {
      sourceId: config.id,
      cliSource: config.cliSource,
      files: 0,
      lines: 0,
      tokens: 0,
      inserted: 0,
      error: details.errorMessage
    }
  }
}

export async function syncLocalSources(
  input: LocalSourceSyncInput = {},
  onProgress?: (progress: SyncProgress) => void,
  commandRunner?: WslCommandRunner
): Promise<LocalSourceSyncResult> {
  const configs = listLocalSourceConfigs().filter(
    (config) => config.enabled && (!input.sourceId || config.id === input.sourceId)
  )
  const results = []
  for (const config of configs) {
    results.push(await syncOneLocalSource(config, onProgress, commandRunner))
  }
  return { started: true, results }
}

export function getLocalSourceDirectory(sourceId: string): string | undefined {
  return getLocalSourceConfig(sourceId)?.rootDir
}

export async function getSanitizedLocalSourceDiagnostic(
  commandRunner?: WslCommandRunner
): Promise<SanitizedLocalSourceDiagnostic> {
  const overview = await getLocalSourcesOverview(commandRunner)
  return {
    generatedAt: overview.generatedAt,
    platform:
      process.platform === 'win32' || process.platform === 'darwin' ? process.platform : 'other',
    wsl: {
      available: overview.wslAvailable,
      distributionCount: overview.distributions.length,
      ...(overview.wslErrorCode ? { errorCode: overview.wslErrorCode } : {})
    },
    sources: overview.configs.map((config) => ({
      environment: config.environment,
      ...(config.wslDistribution ? { wslDistribution: config.wslDistribution } : {}),
      cliSource: config.cliSource,
      enabled: config.enabled,
      status: config.status,
      ...(config.errorCode ? { errorCode: config.errorCode } : {})
    }))
  }
}
