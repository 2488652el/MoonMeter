import { homedir } from 'node:os'
import path from 'node:path'
import type { CliDisplayPaths, CliPaths, CliPathEnvironment } from '@shared/types/platform'

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32)
}

function getPathImpl(platform: CliPathEnvironment): typeof path.win32 | typeof path.posix {
  return platform === 'win32' || platform === 'wsl' ? path.win32 : path.posix
}

/**
 * Convert a POSIX path inside an enabled WSL distribution to the UNC path that
 * Node can read from the Windows host. The POSIX form remains the identity
 * stored in local_source_configs; this form is only an access path.
 */
export function toWslUncPath(distribution: string, posixPath: string): string {
  const safeDistribution = distribution.trim()
  const safePosixPath = posixPath.trim()
  if (
    !safeDistribution ||
    hasControlCharacters(safeDistribution) ||
    !safePosixPath.startsWith('/') ||
    hasControlCharacters(safePosixPath)
  ) {
    throw new Error('invalid WSL distribution name')
  }
  const normalized = path.posix.normalize(safePosixPath || '/')
  const suffix = normalized === '/' ? '' : normalized.replace(/^\//, '').replaceAll('/', '\\')
  return `\\\\wsl$\\${safeDistribution}${suffix ? `\\${suffix}` : ''}`
}

export function normalizeWindowsWorkspace(value: string): string {
  const normalized = path.win32.normalize(path.win32.resolve(value.trim()))
  const withoutTrailingSlash = normalized.replace(/(?<!^[A-Za-z]:)\\+$/, '')
  return withoutTrailingSlash.toLocaleLowerCase('en-US')
}

export function normalizeWslWorkspace(distribution: string, posixPath: string): string {
  const normalizedDistribution = distribution.trim()
  const safePosixPath = posixPath.trim()
  if (
    !normalizedDistribution ||
    hasControlCharacters(normalizedDistribution) ||
    !safePosixPath.startsWith('/') ||
    hasControlCharacters(safePosixPath)
  ) {
    throw new Error('invalid WSL distribution name')
  }
  const normalizedPath = path.posix.normalize(safePosixPath || '/')
  const root = normalizedPath === '/' ? '/' : normalizedPath.replace(/\/+$/, '')
  return `${normalizedDistribution}:${root}`
}

/**
 * A local-only merge key for projects mounted from a Windows drive into WSL.
 * The source identity still uses normalizeWslWorkspace; this second key only
 * lets the future project view join `C:\\work\\app` and `/mnt/c/work/app`.
 */
export function normalizeWorkspaceProjectKey(
  environment: 'windows' | 'wsl',
  value: string,
  distribution?: string
): string {
  if (environment === 'windows') return normalizeWindowsWorkspace(value)
  const normalized = path.posix.normalize(value.trim() || '/')
  const mountedDrive = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/.exec(normalized)
  if (mountedDrive) {
    const suffix = mountedDrive[2] ? `\\${mountedDrive[2].replaceAll('/', '\\')}` : '\\'
    return `${mountedDrive[1]!.toLowerCase()}:${suffix}`.toLocaleLowerCase('en-US')
  }
  return normalizeWslWorkspace(distribution ?? '', normalized)
}

export function resolveCliPaths(
  platform: CliPathEnvironment,
  home: string,
  wslDistribution?: string
): CliPaths {
  const isWsl = platform === 'wsl'
  const p = isWsl ? path.posix : getPathImpl(platform)
  const wslPath = (value: string): string =>
    isWsl ? toWslUncPath(wslDistribution ?? '', value) : value
  const joinHome = (...parts: string[]): string => wslPath(p.join(home, ...parts))
  const kimiCodeHome = joinHome('.kimi-code')
  const geminiTemp = joinHome('.gemini', 'tmp')
  // OpenCode delegates its data root to xdg-basedir. That package uses this
  // same ~/.local/share default on both supported desktop platforms.
  const xdgDataHome = isWsl
    ? p.join(home, '.local', 'share')
    : process.env.XDG_DATA_HOME || p.join(home, '.local', 'share')
  const opencodeStorage = wslPath(p.join(xdgDataHome, 'opencode', 'storage'))
  return {
    claudeProjects: joinHome('.claude', 'projects'),
    claudeCredentialFiles: [
      joinHome('.claude', '.credentials.json'),
      joinHome('.claude', 'credentials.json')
    ],
    codexSessions: joinHome('.codex', 'sessions'),
    codexArchivedSessions: joinHome('.codex', 'archived_sessions'),
    codexAuthFile: joinHome('.codex', 'auth.json'),
    kimiCodeHome,
    kimiCodeSessions: joinHome('.kimi-code', 'sessions'),
    kimiCodeSessionIndex: joinHome('.kimi-code', 'session_index.jsonl'),
    geminiTemp,
    opencodeStorage,
    opencodeMessages: wslPath(p.join(xdgDataHome, 'opencode', 'storage', 'message'))
  }
}

export function getCliPaths(): CliPaths {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    throw new Error(`Unsupported desktop platform: ${process.platform}`)
  }
  const paths = resolveCliPaths(process.platform, homedir())
  const override = process.env.KIMI_CODE_HOME
  if (!override) return paths
  const p = getPathImpl(process.platform)
  return {
    ...paths,
    kimiCodeHome: override,
    kimiCodeSessions: p.join(override, 'sessions'),
    kimiCodeSessionIndex: p.join(override, 'session_index.jsonl')
  }
}

export function getCliDisplayPaths(): CliDisplayPaths {
  const { claudeProjects, codexSessions, kimiCodeSessions, geminiTemp, opencodeMessages } =
    getCliPaths()
  return { claudeProjects, codexSessions, kimiCodeSessions, geminiTemp, opencodeMessages }
}
