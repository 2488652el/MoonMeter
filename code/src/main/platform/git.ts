import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

export const GIT_ROOT_TIMEOUT_MS = 5_000

export type GitEnvironment = 'windows' | 'wsl'
export type GitRootErrorCode =
  'git-unavailable' | 'not-repository' | 'permission-denied' | 'timeout' | 'unknown-error'

export interface GitCommandResult {
  stdout: string
  stderr: string
}

export type GitCommandRunner = (
  executable: string,
  args: readonly string[],
  options: { timeoutMs: number }
) => Promise<GitCommandResult>

export interface GitRootResult {
  root?: string
  errorCode?: GitRootErrorCode
}

export interface GitCommitSummary {
  commitId: string
  authorName?: string
  authoredAt?: string
  title?: string
  changedFiles: number
  additions: number
  deletions: number
}

interface GitCommandError {
  code?: string
  killed?: boolean
  signal?: string
  message?: string
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32)
}

function classifyGitError(error: unknown): GitRootErrorCode {
  const candidate = error as GitCommandError
  const message = String(candidate?.message ?? '').toLowerCase()
  if (candidate?.code === 'ENOENT' || /not recognized|cannot find|git\.exe/.test(message)) {
    return 'git-unavailable'
  }
  if (candidate?.killed || candidate?.signal === 'SIGTERM' || /timeout|timed out/.test(message)) {
    return 'timeout'
  }
  if (/not a git repository|不是 git 仓库|no repository/.test(message)) {
    return 'not-repository'
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

async function defaultGitCommandRunner(
  executable: string,
  args: readonly string[],
  options: { timeoutMs: number }
): Promise<GitCommandResult> {
  const result = await execFile(executable, [...args], {
    windowsHide: true,
    timeout: options.timeoutMs,
    encoding: 'utf8'
  })
  return { stdout: String(result.stdout), stderr: String(result.stderr) }
}

function normalizeRootOutput(value: string, environment: GitEnvironment): string | undefined {
  const root = value
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .trim()
  if (!root || hasControlCharacters(root)) return undefined
  if (environment === 'wsl' && !root.startsWith('/')) return undefined
  if (environment === 'windows' && !/^(?:[A-Za-z]:[\\/]|\\\\)/.test(root)) return undefined
  return root
}

/**
 * Resolve a repository root without invoking a shell. Git is advisory: a
 * missing executable, a non-repository directory, or a timeout never blocks
 * local usage ingestion.
 */
export async function resolveGitRoot(
  cwd: string,
  environment: GitEnvironment,
  wslDistribution?: string,
  commandRunner: GitCommandRunner = defaultGitCommandRunner
): Promise<GitRootResult> {
  if (!cwd.trim() || hasControlCharacters(cwd)) return { errorCode: 'unknown-error' }
  const args: string[] = ['-C', cwd, 'rev-parse', '--show-toplevel']
  let executable = 'git'
  if (environment === 'wsl') {
    if (!wslDistribution?.trim() || hasControlCharacters(wslDistribution)) {
      return { errorCode: 'unknown-error' }
    }
    executable = 'wsl.exe'
    args.unshift('--distribution', wslDistribution.trim(), '--exec', 'git')
  }
  try {
    const result = await commandRunner(executable, args, { timeoutMs: GIT_ROOT_TIMEOUT_MS })
    const root = normalizeRootOutput(result.stdout, environment)
    return root ? { root } : { errorCode: 'not-repository' }
  } catch (error) {
    return { errorCode: classifyGitError(error) }
  }
}

function safeText(value: string, maxLength: number): string | undefined {
  const normalized = value.replace(/\r/g, '').trim()
  if (!normalized || hasControlCharacters(normalized)) return undefined
  return normalized.slice(0, maxLength)
}

function parseCommitLog(output: string): GitCommitSummary[] {
  const commits: GitCommitSummary[] = []
  let current: GitCommitSummary | undefined

  const flush = () => {
    if (current) commits.push(current)
    current = undefined
  }

  // `%x1e` is emitted immediately after each header. Replacing it with a
  // newline keeps the following numstat lines attached to that header; a
  // plain split would put the header and its stats in separate records.
  for (const line of output
    .replace(/^\uFEFF/, '')
    .split('\u001e')
    .join('\n')
    .split(/\r?\n/)) {
    if (line.includes('\u001f')) {
      flush()
      const [commitId, authorName, authoredAt, title] = line.split('\u001f')
      if (!commitId || !/^[0-9a-f]{7,64}$/i.test(commitId)) continue
      const safeAuthor = safeText(authorName ?? '', 200)
      const safeAuthoredAt = safeText(authoredAt ?? '', 64)
      const safeTitle = safeText(title ?? '', 500)
      current = {
        commitId,
        ...(safeAuthor ? { authorName: safeAuthor } : {}),
        ...(safeAuthoredAt ? { authoredAt: safeAuthoredAt } : {}),
        ...(safeTitle ? { title: safeTitle } : {}),
        changedFiles: 0,
        additions: 0,
        deletions: 0
      }
      continue
    }

    if (!current) continue
    const match = /^(\d+|-)\t(\d+|-)\t/.exec(line)
    if (!match) continue
    current.changedFiles++
    if (match[1] !== '-') current.additions += Number(match[1])
    if (match[2] !== '-') current.deletions += Number(match[2])
  }
  flush()
  return commits
}

/** Read commit metadata and numstat only; file names and patch contents are ignored. */
export async function readGitCommits(
  root: string,
  environment: GitEnvironment,
  wslDistribution?: string,
  limit = 500,
  commandRunner: GitCommandRunner = defaultGitCommandRunner
): Promise<{ commits: GitCommitSummary[]; errorCode?: GitRootErrorCode }> {
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)))
  if (!root.trim() || hasControlCharacters(root)) return { commits: [], errorCode: 'unknown-error' }
  const args: string[] = [
    '-C',
    root,
    'log',
    '--numstat',
    '--date=iso-strict',
    '--format=%H%x1f%an%x1f%aI%x1f%s%x1e',
    '-n',
    String(safeLimit)
  ]
  let executable = 'git'
  if (environment === 'wsl') {
    if (!wslDistribution?.trim() || hasControlCharacters(wslDistribution)) {
      return { commits: [], errorCode: 'unknown-error' }
    }
    executable = 'wsl.exe'
    args.unshift('--distribution', wslDistribution.trim(), '--exec', 'git')
  }
  try {
    const result = await commandRunner(executable, args, { timeoutMs: GIT_ROOT_TIMEOUT_MS })
    return { commits: parseCommitLog(result.stdout) }
  } catch (error) {
    return { commits: [], errorCode: classifyGitError(error) }
  }
}
