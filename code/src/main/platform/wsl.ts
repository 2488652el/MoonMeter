import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  LocalSourceErrorCode,
  LocalSourceStatus,
  WslDistribution,
  WslDistributionState
} from '@shared/types/local-source'

const execFile = promisify(execFileCallback)
export const WSL_DISCOVERY_TIMEOUT_MS = 5_000
export const WSL_COMMAND_TIMEOUT_MS = 8_000

export interface WslCommandResult {
  stdout: string
  stderr: string
}

export type WslCommandRunner = (
  args: readonly string[],
  options: { timeoutMs: number }
) => Promise<WslCommandResult>

export interface WslDiscoveryResult {
  available: boolean
  distributions: WslDistribution[]
  errorCode?: LocalSourceErrorCode
  errorMessage?: string
}

export interface WslCommandError {
  code?: string
  killed?: boolean
  signal?: string
  message?: string
}

const SAFE_MESSAGES: Record<LocalSourceErrorCode, string> = {
  'wsl-unavailable': 'WSL 不可用，请安装或启用 Windows Subsystem for Linux',
  'no-distributions': '尚未安装 WSL 发行版',
  'distribution-not-found': '未找到所选 WSL 发行版',
  'distribution-stopped': '发行版当前已停止，请显式启用后再读取来源',
  'permission-denied': 'WSL 或本地目录缺少读取权限',
  'path-missing': '未发现可读取的 CLI 数据目录',
  'format-changed': 'WSL 返回格式暂不受支持',
  timeout: 'WSL 命令响应超时，请稍后重试',
  'sync-failed': 'WSL 来源同步失败，请检查来源状态后重试',
  'unknown-error': 'WSL 来源检查失败，请稍后重试'
}

function safeMessage(code: LocalSourceErrorCode): string {
  return SAFE_MESSAGES[code]
}

function normalizedOutput(value: string): string {
  return value
    .replaceAll('\u0000', '')
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32)
}

function classifyWslCommandError(error: unknown): LocalSourceErrorCode {
  const candidate = error as WslCommandError
  const message = String(candidate?.message ?? '').toLowerCase()
  if (candidate?.code === 'ENOENT' || /not recognized|cannot find|找不到|wsl\.exe/.test(message)) {
    return 'wsl-unavailable'
  }
  if (candidate?.killed || candidate?.signal === 'SIGTERM' || /timeout|timed out/.test(message)) {
    return 'timeout'
  }
  if (
    candidate?.code === 'EACCES' ||
    candidate?.code === 'EPERM' ||
    /access denied|permission/.test(message)
  ) {
    return 'permission-denied'
  }
  return 'unknown-error'
}

async function defaultWslCommandRunner(
  args: readonly string[],
  options: { timeoutMs: number }
): Promise<WslCommandResult> {
  const result = await execFile('wsl.exe', [...args], {
    windowsHide: true,
    timeout: options.timeoutMs,
    encoding: 'utf8'
  })
  return { stdout: String(result.stdout), stderr: String(result.stderr) }
}

export function parseWslDistributionList(output: string): string[] {
  const names: string[] = []
  for (const rawLine of normalizedOutput(output).split('\n')) {
    const line = rawLine.trim().replace(/^\*\s*/, '')
    if (!line || /^windows subsystem for linux/i.test(line) || /^name$/i.test(line)) continue
    if (/^name\s+state\s+version$/i.test(line)) continue
    if (!names.includes(line)) names.push(line)
  }
  return names
}

export function parseWslVerboseDistributionList(
  output: string
): Map<string, { state: WslDistributionState; version?: 1 | 2; isDefault: boolean }> {
  const parsed = new Map<
    string,
    { state: WslDistributionState; version?: 1 | 2; isDefault: boolean }
  >()
  for (const rawLine of normalizedOutput(output).split('\n')) {
    const line = rawLine.trimEnd()
    if (!line.trim() || /^name\s+state\s+version$/i.test(line.trim())) continue
    const match = /^\s*(\*)?\s*(.*?)\s{2,}(Running|Stopped)\s+(1|2)\s*$/i.exec(line)
    if (!match) continue
    const name = match[2]?.trim()
    const state = match[3]?.toLowerCase() as WslDistributionState | undefined
    const version = match[4] === '1' || match[4] === '2' ? (Number(match[4]) as 1 | 2) : undefined
    if (!name || (state !== 'running' && state !== 'stopped')) continue
    parsed.set(name, { state, ...(version ? { version } : {}), isDefault: match[1] === '*' })
  }
  return parsed
}

function withDistributionStatus(
  name: string,
  details: { state: WslDistributionState; version?: 1 | 2; isDefault: boolean } | undefined
): WslDistribution {
  const state = details?.state ?? 'unknown'
  return {
    name,
    state,
    ...(details?.version ? { version: details.version } : {}),
    isDefault: details?.isDefault ?? false,
    enabled: false,
    status: state === 'stopped' ? 'stopped' : 'discovered'
  }
}

export async function discoverWslDistributions(
  commandRunner?: WslCommandRunner
): Promise<WslDiscoveryResult> {
  if (!commandRunner && process.platform !== 'win32') {
    return {
      available: false,
      distributions: [],
      errorCode: 'wsl-unavailable',
      errorMessage: safeMessage('wsl-unavailable')
    }
  }
  const runner = commandRunner ?? defaultWslCommandRunner
  let quiet: WslCommandResult
  try {
    // Keep this as an argument array: distribution names and user paths never
    // participate in a shell command during initial discovery.
    quiet = await runner(['--list', '--quiet'], { timeoutMs: WSL_DISCOVERY_TIMEOUT_MS })
  } catch (error) {
    const errorCode = classifyWslCommandError(error)
    return { available: false, distributions: [], errorCode, errorMessage: safeMessage(errorCode) }
  }

  const names = parseWslDistributionList(quiet.stdout)
  if (names.length === 0) {
    return {
      available: true,
      distributions: [],
      errorCode: 'no-distributions',
      errorMessage: safeMessage('no-distributions')
    }
  }

  let verbose = new Map<
    string,
    { state: WslDistributionState; version?: 1 | 2; isDefault: boolean }
  >()
  try {
    const result = await runner(['--list', '--verbose'], { timeoutMs: WSL_DISCOVERY_TIMEOUT_MS })
    verbose = parseWslVerboseDistributionList(result.stdout)
  } catch {
    // `--list --quiet` is the authoritative discovery call. If verbose output
    // is unavailable, expose the distro but keep its state unknown.
  }

  return {
    available: true,
    distributions: names.map((name) => withDistributionStatus(name, verbose.get(name)))
  }
}

export function validateWslDistributionName(name: string): string {
  const normalized = name.trim()
  if (!normalized || normalized.length > 100 || hasControlCharacters(normalized)) {
    throw new Error('invalid WSL distribution name')
  }
  return normalized
}

export async function resolveWslHome(
  distribution: string,
  commandRunner?: WslCommandRunner
): Promise<string> {
  const validated = validateWslDistributionName(distribution)
  if (!commandRunner && process.platform !== 'win32')
    throw new Error(safeMessage('wsl-unavailable'))
  const runner = commandRunner ?? defaultWslCommandRunner
  try {
    const result = await runner(
      ['--distribution', validated, '--exec', 'sh', '-lc', 'printf %s "$HOME"'],
      { timeoutMs: WSL_COMMAND_TIMEOUT_MS }
    )
    const home = normalizedOutput(result.stdout).trim()
    if (!home.startsWith('/') || hasControlCharacters(home)) {
      throw new Error('invalid WSL home path')
    }
    return home
  } catch (error) {
    const errorCode = classifyWslCommandError(error)
    throw new Error(safeMessage(errorCode))
  }
}

export function statusForWslError(errorCode: LocalSourceErrorCode): LocalSourceStatus {
  if (errorCode === 'permission-denied') return 'permission-denied'
  if (errorCode === 'path-missing' || errorCode === 'no-distributions') return 'unavailable'
  return 'error'
}

export function wslErrorMessage(errorCode: LocalSourceErrorCode): string {
  return safeMessage(errorCode)
}
