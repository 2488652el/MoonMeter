import type { UsageRecord } from '@shared/types/usage'
import type { CliSourceId } from '@shared/types/local-source'
import type { CliPaths } from '@shared/types/platform'
import { getCliPaths } from '../platform/paths'
import { discoverClaudeSessions, syncClaudeFile } from './claude'
import { discoverCodexSessions, syncCodexFile } from './codex'
import { discoverKimiCodeSessions, syncKimiCodeFile } from './kimi-code'
import { discoverGeminiSessions, syncGeminiFile } from './gemini'
import { discoverOpenCodeSessions, syncOpenCodeFile } from './opencode'

export type CliLogSourceId = CliSourceId
export type CliDiscoveryKey = 'claude' | 'codex' | 'kimiCode' | 'gemini' | 'opencode'

export interface CliSourceContext {
  environment: 'windows' | 'macos' | 'wsl'
  paths: CliPaths
  wslDistribution?: string
  sourceConfigId?: string
}

type CliRootPathKey =
  | 'claudeProjects'
  | 'codexSessions'
  | 'codexArchivedSessions'
  | 'kimiCodeSessions'
  | 'geminiTemp'
  | 'opencodeMessages'

export interface CliLogSourceDefinition {
  id: CliLogSourceId
  healthSourceId: `cli:${CliLogSourceId}`
  discoveryKey: CliDiscoveryKey
  displayName: string
  syncStateSource: string
  rootPathKey: CliRootPathKey
  discover: (context?: CliSourceContext) => string[]
  syncFile: (file: string, byteOffset: number) => { records: UsageRecord[]; nextOffset: number }
}

export const CLI_LOG_SOURCES: readonly CliLogSourceDefinition[] = [
  {
    id: 'claude-code',
    healthSourceId: 'cli:claude-code',
    discoveryKey: 'claude',
    displayName: 'Claude Code 日志',
    syncStateSource: 'claude-code',
    rootPathKey: 'claudeProjects',
    discover: (context) => discoverClaudeSessions(context?.paths.claudeProjects),
    syncFile: syncClaudeFile
  },
  {
    id: 'codex',
    healthSourceId: 'cli:codex',
    discoveryKey: 'codex',
    displayName: 'Codex CLI 日志',
    syncStateSource: 'codex:v2',
    rootPathKey: 'codexSessions',
    discover: (context) =>
      discoverCodexSessions(
        context ? [context.paths.codexSessions, context.paths.codexArchivedSessions] : undefined
      ),
    syncFile: syncCodexFile
  },
  {
    id: 'kimi-code',
    healthSourceId: 'cli:kimi-code',
    discoveryKey: 'kimiCode',
    displayName: 'Kimi Code 日志',
    syncStateSource: 'kimi-code:v1',
    rootPathKey: 'kimiCodeSessions',
    discover: (context) => discoverKimiCodeSessions(context?.paths.kimiCodeSessions),
    syncFile: syncKimiCodeFile
  },
  {
    id: 'gemini-cli',
    healthSourceId: 'cli:gemini-cli',
    discoveryKey: 'gemini',
    displayName: 'Gemini CLI 日志',
    syncStateSource: 'gemini-cli:v1',
    rootPathKey: 'geminiTemp',
    discover: (context) => discoverGeminiSessions(context?.paths.geminiTemp),
    syncFile: syncGeminiFile
  },
  {
    id: 'opencode',
    healthSourceId: 'cli:opencode',
    discoveryKey: 'opencode',
    displayName: 'OpenCode 日志',
    syncStateSource: 'opencode:v1',
    rootPathKey: 'opencodeMessages',
    discover: (context) => discoverOpenCodeSessions(context?.paths.opencodeMessages),
    syncFile: syncOpenCodeFile
  }
]

export function getCliLogSource(id: CliLogSourceId): CliLogSourceDefinition {
  const source = CLI_LOG_SOURCES.find((candidate) => candidate.id === id)
  if (!source) throw new Error(`unsupported CLI log source: ${id}`)
  return source
}

export function defaultCliSourceContext(): CliSourceContext {
  return {
    environment: process.platform === 'win32' ? 'windows' : 'macos',
    paths: getCliPaths()
  }
}

export function cliSourceRoot(
  source: CliLogSourceDefinition,
  context: CliSourceContext = defaultCliSourceContext()
): string {
  return context.paths[source.rootPathKey]
}

export function discoverCliLogSessions(
  context: CliSourceContext = defaultCliSourceContext()
): Record<CliDiscoveryKey, string[]> {
  return Object.fromEntries(
    CLI_LOG_SOURCES.map((source) => [source.discoveryKey, source.discover(context)])
  ) as Record<CliDiscoveryKey, string[]>
}
