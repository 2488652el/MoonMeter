import { getDb } from './db'

export type StoredSourceStatus = 'ready' | 'stale' | 'error' | 'unavailable' | 'disabled'
export type StoredPermissionStatus =
  'granted' | 'missing' | 'auth-required' | 'permission-required' | 'unknown'

export interface StoredSourceHealth {
  sourceId: string
  accountRef: string
  sourceKind: 'provider' | 'codex' | 'cli'
  providerId?: string
  displayName: string
  permissionStatus: StoredPermissionStatus
  status: StoredSourceStatus
  lastAttemptAt?: string
  lastSuccessAt?: string
  errorCode?: string
  errorMessage?: string
  updatedAt: string
}

interface SourceHealthRow {
  source_id: string
  account_ref: string
  source_kind: StoredSourceHealth['sourceKind']
  provider_id: string | null
  display_name: string
  permission_status: StoredPermissionStatus
  status: StoredSourceStatus
  last_attempt_at: string | null
  last_success_at: string | null
  error_code: string | null
  error_message: string | null
  updated_at: string
}

type SourceIdentity = Pick<
  StoredSourceHealth,
  'sourceId' | 'accountRef' | 'sourceKind' | 'displayName'
> & { providerId?: string }

const SAFE_ERROR_MESSAGES: Record<string, string> = {
  'auth-required': '登录或凭据已失效，请重新授权',
  'permission-required': '当前账户或本地文件缺少读取权限',
  'source-missing': '未发现可读取的数据源',
  offline: '网络不可用，请检查连接后重试',
  timeout: '来源响应超时，请稍后重试',
  'format-changed': '来源返回格式暂不受支持',
  'refresh-failed': '来源刷新失败，请重试或检查配置'
}

function rowToHealth(row: SourceHealthRow): StoredSourceHealth {
  return {
    sourceId: row.source_id,
    accountRef: row.account_ref,
    sourceKind: row.source_kind,
    displayName: row.display_name,
    permissionStatus: row.permission_status,
    status: row.status,
    updatedAt: row.updated_at,
    ...(row.provider_id ? { providerId: row.provider_id } : {}),
    ...(row.last_attempt_at ? { lastAttemptAt: row.last_attempt_at } : {}),
    ...(row.last_success_at ? { lastSuccessAt: row.last_success_at } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {})
  }
}

function writeHealth(value: StoredSourceHealth): void {
  getDb()
    .prepare(
      `
        INSERT INTO source_health (
          source_id, account_ref, source_kind, provider_id, display_name,
          permission_status, status, last_attempt_at, last_success_at,
          error_code, error_message, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (source_id, account_ref) DO UPDATE SET
          source_kind = excluded.source_kind,
          provider_id = excluded.provider_id,
          display_name = excluded.display_name,
          permission_status = excluded.permission_status,
          status = excluded.status,
          last_attempt_at = excluded.last_attempt_at,
          last_success_at = COALESCE(excluded.last_success_at, source_health.last_success_at),
          error_code = excluded.error_code,
          error_message = excluded.error_message,
          updated_at = excluded.updated_at
      `
    )
    .run(
      value.sourceId,
      value.accountRef,
      value.sourceKind,
      value.providerId ?? null,
      value.displayName,
      value.permissionStatus,
      value.status,
      value.lastAttemptAt ?? null,
      value.lastSuccessAt ?? null,
      value.errorCode ?? null,
      value.errorMessage ?? null,
      value.updatedAt
    )
}

export function recordSourceSuccess(identity: SourceIdentity, at = new Date()): void {
  const timestamp = at.toISOString()
  writeHealth({
    ...identity,
    permissionStatus: 'granted',
    status: 'ready',
    lastAttemptAt: timestamp,
    lastSuccessAt: timestamp,
    updatedAt: timestamp
  })
}

export function recordSourceDiscovered(identity: SourceIdentity, at = new Date()): void {
  const timestamp = at.toISOString()
  writeHealth({
    ...identity,
    permissionStatus: 'granted',
    status: 'stale',
    lastAttemptAt: timestamp,
    updatedAt: timestamp
  })
}

export function recordSourceFailure(
  identity: SourceIdentity,
  error: unknown,
  at = new Date()
): void {
  const timestamp = at.toISOString()
  const safe = classifySourceError(error)
  writeHealth({
    ...identity,
    permissionStatus: safe.permissionStatus,
    status: safe.status,
    lastAttemptAt: timestamp,
    errorCode: safe.code,
    errorMessage: SAFE_ERROR_MESSAGES[safe.code] ?? SAFE_ERROR_MESSAGES['refresh-failed']!,
    updatedAt: timestamp
  })
}

export function recordSourceUnavailable(
  identity: SourceIdentity,
  permissionStatus: Extract<StoredPermissionStatus, 'missing' | 'permission-required'>,
  at = new Date()
): void {
  const code = permissionStatus === 'missing' ? 'source-missing' : 'permission-required'
  const timestamp = at.toISOString()
  writeHealth({
    ...identity,
    permissionStatus,
    status: 'unavailable',
    lastAttemptAt: timestamp,
    errorCode: code,
    errorMessage: SAFE_ERROR_MESSAGES[code]!,
    updatedAt: timestamp
  })
}

export function listSourceHealth(): StoredSourceHealth[] {
  const rows = getDb()
    .prepare('SELECT * FROM source_health ORDER BY updated_at DESC, source_id, account_ref')
    .all() as SourceHealthRow[]
  return rows.map(rowToHealth)
}

export function deleteSourceHealth(sourceId: string, accountRef: string): void {
  getDb()
    .prepare('DELETE FROM source_health WHERE source_id = ? AND account_ref = ?')
    .run(sourceId, accountRef)
}

export function classifySourceError(error: unknown): {
  code: keyof typeof SAFE_ERROR_MESSAGES
  permissionStatus: StoredPermissionStatus
  status: StoredSourceStatus
} {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (/\b401\b|unauthori[sz]ed|login|登录|凭据/.test(message)) {
    return { code: 'auth-required', permissionStatus: 'auth-required', status: 'error' }
  }
  if (/\b403\b|eacces|eperm|permission|权限/.test(message)) {
    return {
      code: 'permission-required',
      permissionStatus: 'permission-required',
      status: 'error'
    }
  }
  if (/enoent|not found|未找到/.test(message)) {
    return { code: 'source-missing', permissionStatus: 'missing', status: 'unavailable' }
  }
  if (/timeout|timed out|abort/.test(message)) {
    return { code: 'timeout', permissionStatus: 'unknown', status: 'error' }
  }
  if (/enotfound|econn|network|fetch failed|网络/.test(message)) {
    return { code: 'offline', permissionStatus: 'unknown', status: 'error' }
  }
  if (/format|格式|parse|json/.test(message)) {
    return { code: 'format-changed', permissionStatus: 'granted', status: 'error' }
  }
  return { code: 'refresh-failed', permissionStatus: 'unknown', status: 'error' }
}
