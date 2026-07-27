import type { UsageRecord } from '@shared/types/usage'
import { discoverClaudeSessions, syncClaudeFile } from './claude'
import { discoverCodexSessions, syncCodexFile } from './codex'
import { discoverKimiCodeSessions, syncKimiCodeFile } from './kimi-code'
import { discoverGeminiSessions, syncGeminiFile } from './gemini'
import { discoverOpenCodeSessions, syncOpenCodeFile } from './opencode'

export type CliLogSourceId = 'claude-code' | 'codex' | 'kimi-code' | 'gemini-cli' | 'opencode'
export type CliDiscoveryKey = 'claude' | 'codex' | 'kimiCode' | 'gemini' | 'opencode'

export interface CliLogSourceDefinition {
  id: CliLogSourceId
  healthSourceId: `cli:${CliLogSourceId}`
  discoveryKey: CliDiscoveryKey
  displayName: string
  syncStateSource: string
  discover: () => string[]
  syncFile: (file: string, byteOffset: number) => { records: UsageRecord[]; nextOffset: number }
}

export const CLI_LOG_SOURCES: readonly CliLogSourceDefinition[] = [
  {
    id: 'claude-code',
    healthSourceId: 'cli:claude-code',
    discoveryKey: 'claude',
    displayName: 'Claude Code 日志',
    syncStateSource: 'claude-code',
    discover: discoverClaudeSessions,
    syncFile: syncClaudeFile
  },
  {
    id: 'codex',
    healthSourceId: 'cli:codex',
    discoveryKey: 'codex',
    displayName: 'Codex CLI 日志',
    syncStateSource: 'codex:v2',
    discover: discoverCodexSessions,
    syncFile: syncCodexFile
  },
  {
    id: 'kimi-code',
    healthSourceId: 'cli:kimi-code',
    discoveryKey: 'kimiCode',
    displayName: 'Kimi Code 日志',
    syncStateSource: 'kimi-code:v1',
    discover: discoverKimiCodeSessions,
    syncFile: syncKimiCodeFile
  },
  {
    id: 'gemini-cli',
    healthSourceId: 'cli:gemini-cli',
    discoveryKey: 'gemini',
    displayName: 'Gemini CLI 日志',
    syncStateSource: 'gemini-cli:v1',
    discover: discoverGeminiSessions,
    syncFile: syncGeminiFile
  },
  {
    id: 'opencode',
    healthSourceId: 'cli:opencode',
    discoveryKey: 'opencode',
    displayName: 'OpenCode 日志',
    syncStateSource: 'opencode:v1',
    discover: discoverOpenCodeSessions,
    syncFile: syncOpenCodeFile
  }
]

export function getCliLogSource(id: CliLogSourceId): CliLogSourceDefinition {
  const source = CLI_LOG_SOURCES.find((candidate) => candidate.id === id)
  if (!source) throw new Error(`unsupported CLI log source: ${id}`)
  return source
}

export function discoverCliLogSessions(): Record<CliDiscoveryKey, string[]> {
  return Object.fromEntries(
    CLI_LOG_SOURCES.map((source) => [source.discoveryKey, source.discover()])
  ) as Record<CliDiscoveryKey, string[]>
}
