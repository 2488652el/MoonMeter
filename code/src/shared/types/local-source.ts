/**
 * 本地 CLI 来源契约。
 *
 * 这些类型只描述脱敏后的来源上下文；文件系统路径和 WSL 命令都由 main
 * 进程生成，renderer 不接受任意路径作为输入。
 */

export type CliSourceId = 'claude-code' | 'codex' | 'kimi-code' | 'gemini-cli' | 'opencode'
export type LocalSourceEnvironment = 'windows' | 'wsl'
export type LocalSourceStatus =
  | 'discovered'
  | 'enabled'
  | 'ready'
  | 'stale'
  | 'stopped'
  | 'unavailable'
  | 'permission-denied'
  | 'error'

export type LocalSourceErrorCode =
  | 'wsl-unavailable'
  | 'no-distributions'
  | 'distribution-not-found'
  | 'distribution-stopped'
  | 'permission-denied'
  | 'path-missing'
  | 'format-changed'
  | 'timeout'
  | 'sync-failed'
  | 'unknown-error'

export type WslDistributionState = 'running' | 'stopped' | 'unknown'

export interface WslDistribution {
  name: string
  state: WslDistributionState
  version?: 1 | 2
  isDefault: boolean
  enabled: boolean
  status: LocalSourceStatus
  errorCode?: LocalSourceErrorCode
  errorMessage?: string
}

export interface LocalSourceConfig {
  id: string
  environment: LocalSourceEnvironment
  wslDistribution?: string
  cliSource: CliSourceId
  /** Main-owned access path; WSL uses a host-readable UNC path. */
  rootDir: string
  /** Stable identity used for workspace merging and deduplication. */
  normalizedRoot: string
  enabled: boolean
  status: LocalSourceStatus
  lastAttemptAt?: string
  lastSuccessAt?: string
  errorCode?: LocalSourceErrorCode
  errorMessage?: string
  createdAt: string
  updatedAt: string
}

export interface SourcePreviewCandidate {
  cliSource: CliSourceId
  displayName: string
  rootDir: string
  normalizedRoot: string
  exists: boolean
  enabled: boolean
}

export interface SourcePreview {
  environment: LocalSourceEnvironment
  wslDistribution?: string
  homeDir?: string
  candidates: SourcePreviewCandidate[]
  generatedAt: string
  status: LocalSourceStatus
  errorCode?: LocalSourceErrorCode
  errorMessage?: string
}

export interface LocalSourcesOverview {
  generatedAt: string
  wslAvailable: boolean
  wslErrorCode?: LocalSourceErrorCode
  wslErrorMessage?: string
  distributions: WslDistribution[]
  configs: LocalSourceConfig[]
}

export interface LocalSourcePreviewInput {
  environment: LocalSourceEnvironment
  cliSource?: CliSourceId
  wslDistribution?: string
}

export interface LocalSourceToggleInput extends Omit<LocalSourcePreviewInput, 'cliSource'> {
  cliSource: CliSourceId
  sourceId?: string
  enabled: boolean
}

export interface LocalSourceSyncInput {
  sourceId?: string
}

export interface LocalSourceSyncResult {
  started: boolean
  results: Array<{
    sourceId: string
    cliSource: CliSourceId
    files: number
    lines: number
    tokens: number
    inserted: number
    error?: string
  }>
}

export interface SanitizedLocalSourceDiagnostic {
  generatedAt: string
  platform: 'win32' | 'darwin' | 'other'
  wsl: {
    available: boolean
    distributionCount: number
    errorCode?: LocalSourceErrorCode
  }
  sources: Array<{
    environment: LocalSourceEnvironment
    wslDistribution?: string
    cliSource: CliSourceId
    enabled: boolean
    status: LocalSourceStatus
    errorCode?: LocalSourceErrorCode
  }>
}

/** v1.4+ 共享契约先在这里固定，避免未来 Renderer/Main 各自发明字段。 */
export interface WorkspaceSummary {
  id: string
  environment: LocalSourceEnvironment
  wslDistribution?: string
  normalizedRoot: string
  displayName: string
  sessionCount: number
  lastSeenAt?: string
}

export interface WorkspaceDetail extends WorkspaceSummary {
  sourceIds: string[]
  normalizedGitRoot?: string
}
