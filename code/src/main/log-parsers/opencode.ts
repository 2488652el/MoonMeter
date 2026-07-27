/**
 * OpenCode session log parser.
 *
 * OpenCode persists each message as JSON at
 * ~/.local/share/opencode/storage/message/<session>/<message>.json (or under
 * XDG_DATA_HOME). Assistant metadata contains the final token counters and cost.
 */
import { basename, join } from 'node:path'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import type { UsageRecord } from '@shared/types/usage'
import { getCliPaths } from '../platform/paths'

interface OpenCodeMessage {
  id?: unknown
  role?: unknown
  metadata?: {
    sessionID?: unknown
    time?: { created?: unknown }
    assistant?: {
      modelID?: unknown
      cost?: unknown
      path?: { root?: unknown; cwd?: unknown }
      tokens?: {
        input?: unknown
        output?: unknown
        reasoning?: unknown
        cache?: { read?: unknown; write?: unknown }
      }
    }
  }
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function finiteCost(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function timestamp(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return new Date().toISOString()
}

function labelFromPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  return value.split(/[\\/]/).filter(Boolean).pop()
}

/** Parse one persisted OpenCode assistant message. */
export function parseOpenCodeMessage(content: string, filePath: string): UsageRecord | null {
  let message: OpenCodeMessage
  try {
    message = JSON.parse(content) as OpenCodeMessage
  } catch {
    return null
  }
  const assistant = message.role === 'assistant' ? message.metadata?.assistant : undefined
  if (!assistant?.tokens) return null

  const input = nonNegativeNumber(assistant.tokens.input)
  const output = nonNegativeNumber(assistant.tokens.output)
  const reasoning = nonNegativeNumber(assistant.tokens.reasoning)
  const cacheRead = nonNegativeNumber(assistant.tokens.cache?.read)
  const cacheCreation = nonNegativeNumber(assistant.tokens.cache?.write)
  const total = input + output + reasoning + cacheRead + cacheCreation
  if (total === 0) return null

  const sessionId =
    typeof message.metadata?.sessionID === 'string' && message.metadata.sessionID
      ? message.metadata.sessionID
      : basename(join(filePath, '..'))
  const messageId =
    typeof message.id === 'string' && message.id
      ? message.id
      : basename(filePath).replace(/\.json$/, '')
  const record: UsageRecord = {
    providerId: 'opencode',
    model:
      typeof assistant.modelID === 'string' && assistant.modelID
        ? assistant.modelID
        : 'unknown-opencode',
    source: 'session-log',
    capturedAt: timestamp(message.metadata?.time?.created),
    promptTokens: input,
    completionTokens: output,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheCreation,
    totalTokens: total,
    sessionId,
    messageId: `${sessionId}-${messageId}`
  }
  const cost = finiteCost(assistant.cost)
  if (cost !== undefined) {
    record.cost = cost
    record.currency = 'USD'
    record.costBasis = 'provider'
  }
  const label = labelFromPath(assistant.path?.root) ?? labelFromPath(assistant.path?.cwd)
  if (label) record.agentLabel = label
  return record
}

export function discoverOpenCodeSessions(root?: string): string[] {
  const actualRoot = root ?? getCliPaths().opencodeMessages
  if (!existsSync(actualRoot)) return []
  const results: string[] = []
  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(dir, name)
      let stat
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) walk(full)
      else if (stat.isFile() && name.endsWith('.json')) results.push(full)
    }
  }
  walk(actualRoot)
  return results
}

/** Reparse a changed message JSON; usage insertion is idempotent by message id. */
export function syncOpenCodeFile(
  filePath: string,
  byteOffset = 0
): { records: UsageRecord[]; nextOffset: number } {
  let stat
  try {
    stat = statSync(filePath)
  } catch {
    return { records: [], nextOffset: byteOffset }
  }
  if (stat.size <= byteOffset) return { records: [], nextOffset: stat.size }
  const record = parseOpenCodeMessage(readFileSync(filePath, 'utf8'), filePath)
  return { records: record ? [record] : [], nextOffset: stat.size }
}
