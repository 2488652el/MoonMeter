/**
 * Gemini CLI session log parser.
 *
 * Gemini CLI stores chat recordings as JSONL files under
 * ~/.gemini/tmp/<project>/chats. Gemini response records carry a stable id,
 * timestamp, model and a TokensSummary object.
 */
import { basename, join } from 'node:path'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import type { UsageRecord } from '@shared/types/usage'
import { getCliPaths } from '../platform/paths'

interface GeminiTokens {
  input?: unknown
  output?: unknown
  cached?: unknown
  thoughts?: unknown
  total?: unknown
}

interface GeminiRecord {
  id?: unknown
  type?: unknown
  timestamp?: unknown
  sessionId?: unknown
  model?: unknown
  tokens?: GeminiTokens | null
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function isoTimestamp(value: unknown): string {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value
  return new Date().toISOString()
}

function sessionIdFromContent(content: string, filePath: string): string {
  for (const line of content.split(/\r?\n/)) {
    try {
      const entry = JSON.parse(line) as GeminiRecord
      if (typeof entry.sessionId === 'string' && entry.sessionId) return entry.sessionId
    } catch {
      // A malformed line must not prevent later valid message records from importing.
    }
  }
  return basename(filePath).replace(/\.jsonl?$/, '') || 'unknown-gemini-session'
}

/** Parse one Gemini response record into a normalized local usage record. */
export function parseGeminiSessionLine(
  line: string,
  sessionId: string,
  lineNo = 1
): UsageRecord | null {
  let entry: GeminiRecord
  try {
    entry = JSON.parse(line) as GeminiRecord
  } catch {
    return null
  }
  if (entry.type !== 'gemini' || !entry.tokens) return null

  const input = nonNegativeNumber(entry.tokens.input)
  const cached = nonNegativeNumber(entry.tokens.cached)
  const output = nonNegativeNumber(entry.tokens.output)
  const thoughts = nonNegativeNumber(entry.tokens.thoughts)
  const fallbackTotal = Math.max(0, input - cached) + cached + output + thoughts
  const total = nonNegativeNumber(entry.tokens.total) || fallbackTotal
  if (total === 0) return null

  const record: UsageRecord = {
    providerId: 'gemini-cli',
    model: typeof entry.model === 'string' && entry.model ? entry.model : 'unknown-gemini',
    source: 'session-log',
    capturedAt: isoTimestamp(entry.timestamp),
    // Gemini's input includes the cached portion. Keep the shared record fields exclusive.
    promptTokens: Math.max(0, input - cached),
    completionTokens: output,
    cacheReadTokens: cached,
    cacheCreationTokens: 0,
    totalTokens: total,
    sessionId,
    messageId:
      typeof entry.id === 'string' && entry.id
        ? `${sessionId}-${entry.id}`
        : `${sessionId}-line-${lineNo}`
  }
  return record
}

export function parseGeminiSessionFile(content: string, filePath: string): UsageRecord[] {
  const sessionId = sessionIdFromContent(content, filePath)
  const records: UsageRecord[] = []
  let lineNo = 0
  for (const line of content.split(/\r?\n/)) {
    lineNo++
    const record = parseGeminiSessionLine(line, sessionId, lineNo)
    if (record) records.push(record)
  }
  return records
}

/** Discover official Gemini CLI chat files, including legacy .json sessions. */
export function discoverGeminiSessions(root?: string): string[] {
  const actualRoot = root ?? getCliPaths().geminiTemp
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
      else if (stat.isFile() && basename(dir) === 'chats' && /\.jsonl?$/.test(name)) {
        results.push(full)
      }
    }
  }
  walk(actualRoot)
  return results
}

/** Reparse the full JSONL file so a newly appended record keeps session metadata. */
export function syncGeminiFile(
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
  return {
    records: parseGeminiSessionFile(readFileSync(filePath, 'utf8'), filePath),
    nextOffset: stat.size
  }
}
