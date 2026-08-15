/**
 * DeepSeek Harness session log parser.
 *
 * Harness JSONL session persistence writes one `session.jsonl` per session.
 * The first line is a session header; token accounting is carried by
 * `assistant/message.data.usage`. Compressed `session.jsonl.zstd` files are
 * deliberately ignored until MoonMeter owns a zstd decoder.
 */
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { UsageRecord } from '@shared/types/usage'
import { getCliPaths } from '../platform/paths'

interface HarnessHeader {
  type?: unknown
  id?: unknown
  createdAt?: unknown
  cwd?: unknown
}

interface HarnessUsage {
  inputTokens?: unknown
  outputTokens?: unknown
  cacheReadTokens?: unknown
  /** Official Harness TokenUsage field; stored locally as cacheCreationTokens. */
  cacheWriteTokens?: unknown
  /** Compatibility with early experimental logs. */
  cacheCreationTokens?: unknown
  reasoningTokens?: unknown
}

interface HarnessEvent {
  type?: unknown
  seq?: unknown
  time?: unknown
  data?: {
    turn?: unknown
    step?: unknown
    provider?: unknown
    model?: unknown
    header?: { config?: { provider?: unknown; model?: unknown } }
    message?: { model?: unknown; provider?: unknown }
    usage?: HarnessUsage
  }
}

interface HarnessMeta {
  sessionId: string
  createdAt?: number
  agentLabel?: string
}

interface HarnessParserState {
  sessionId: string
  lineNumber: number
  currentModel?: string
  provider?: string
}

interface HarnessParseContext {
  lineNumber: number
  currentModel?: string
  provider?: string
}

const DEEPSEEK_PROVIDER_ROUTES = new Set(['deepseek', 'deepseek-official'])

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function timestamp(value: unknown, fallback?: unknown): string {
  for (const candidate of [value, fallback]) {
    if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < 0) continue
    const date = new Date(candidate)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return new Date().toISOString()
}

function stemSessionId(filePath: string): string {
  return basename(filePath.replace(/\.jsonl$/, '')) || 'unknown-deepseek-harness-session'
}

function agentLabelFromCwd(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  return value
    .split(/[\\/]/)
    .filter((part) => part.length > 0)
    .pop()
}

function normalizeProvider(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return normalized ? normalized.slice(0, 100) : undefined
}

function modelFromEvent(event: HarnessEvent): string | undefined {
  const messageModel = event.data?.message?.model
  if (typeof messageModel === 'string' && messageModel) return messageModel
  const headerModel = event.data?.header?.config?.model
  if (typeof headerModel === 'string' && headerModel) return headerModel
  const contextModel = event.data?.model
  if (typeof contextModel === 'string' && contextModel) return contextModel
  return undefined
}

function providerFromEvent(event: HarnessEvent): string | undefined {
  const messageProvider = normalizeProvider(event.data?.message?.provider)
  if (messageProvider) return messageProvider
  const headerProvider = normalizeProvider(event.data?.header?.config?.provider)
  if (headerProvider) return headerProvider
  return normalizeProvider(event.data?.provider)
}

function headerFromLine(firstLine: string, filePath: string): HarnessMeta {
  if (!firstLine) return { sessionId: stemSessionId(filePath) }
  try {
    const header = JSON.parse(firstLine) as HarnessHeader
    if (header.type === 'session') {
      const out: HarnessMeta = {
        sessionId: typeof header.id === 'string' && header.id ? header.id : stemSessionId(filePath)
      }
      if (typeof header.createdAt === 'number') out.createdAt = header.createdAt
      const agentLabel = agentLabelFromCwd(header.cwd)
      if (agentLabel) out.agentLabel = agentLabel
      return out
    }
  } catch {
    // Fall back to filename-derived identity below.
  }
  return { sessionId: stemSessionId(filePath) }
}

function headerFromContent(content: string, filePath: string): HarnessMeta {
  return headerFromLine(content.split(/\r?\n/, 1)[0]?.trim() ?? '', filePath)
}

function updateParseContext(event: HarnessEvent, context: HarnessParseContext): void {
  const provider = providerFromEvent(event)
  if (provider) context.provider = provider
  const model = modelFromEvent(event)
  if (model) context.currentModel = model
}

function providerForRecord(
  provider: string | undefined,
  model: string
): {
  providerId: string
  priced: boolean
} {
  if (provider && DEEPSEEK_PROVIDER_ROUTES.has(provider)) {
    return { providerId: 'deepseek', priced: model !== 'unknown' }
  }
  return {
    providerId: provider ? `deepseek-harness:${provider}` : 'deepseek-harness:unknown',
    priced: false
  }
}

function parseLine(
  line: string,
  meta: HarnessMeta,
  context: HarnessParseContext
): UsageRecord | undefined {
  context.lineNumber++
  const trimmed = line.trim()
  if (!trimmed) return undefined

  let event: HarnessEvent
  try {
    event = JSON.parse(trimmed) as HarnessEvent
  } catch {
    return undefined
  }
  updateParseContext(event, context)
  if (event.type !== 'assistant/message') return undefined

  const usage = event.data?.usage
  if (!usage) return undefined

  const inputTokens = nonNegativeNumber(usage.inputTokens)
  const outputTokens = nonNegativeNumber(usage.outputTokens)
  const cacheReadTokens = nonNegativeNumber(usage.cacheReadTokens)
  // Harness calls the disjoint write side `cacheWriteTokens`; the local schema
  // predates it and names the same bucket `cacheCreationTokens`. Never add both.
  const cacheCreationTokens = nonNegativeNumber(usage.cacheWriteTokens ?? usage.cacheCreationTokens)
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens
  if (totalTokens === 0) return undefined

  const model = context.currentModel ?? 'unknown'
  const provider = providerForRecord(context.provider, model)
  const seq =
    typeof event.seq === 'number' && Number.isSafeInteger(event.seq) && event.seq >= 0
      ? event.seq
      : context.lineNumber
  const record: UsageRecord = {
    providerId: provider.providerId,
    model,
    source: 'session-log',
    capturedAt: timestamp(event.time, meta.createdAt),
    sessionId: meta.sessionId,
    messageId: `${meta.sessionId}-seq-${seq}`,
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens
  }
  if (meta.agentLabel) record.agentLabel = meta.agentLabel
  if (!provider.priced) record.costBasis = 'unpriced'
  return record
}

export function parseDeepSeekHarnessSessionFile(content: string, filePath: string): UsageRecord[] {
  const meta = headerFromContent(content, filePath)
  const context: HarnessParseContext = { lineNumber: 0 }
  const records: UsageRecord[] = []
  for (const line of content.split(/\r?\n/)) {
    const record = parseLine(line, meta, context)
    if (record) records.push(record)
  }
  return records
}

export function discoverDeepSeekHarnessSessions(root?: string): string[] {
  const actualRoot = root ?? getCliPaths().deepseekHarnessHome
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
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(full)
      } else if (st.isFile() && name === 'session.jsonl') {
        results.push(full)
      }
    }
  }
  walk(actualRoot)
  return results
}

function decodeParserState(value: string | undefined): HarnessParserState | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as Partial<HarnessParserState>
    const lineNumber = parsed.lineNumber
    if (
      typeof parsed.sessionId !== 'string' ||
      typeof lineNumber !== 'number' ||
      !Number.isSafeInteger(lineNumber) ||
      lineNumber < 0
    ) {
      return undefined
    }
    return {
      sessionId: parsed.sessionId,
      lineNumber,
      ...(typeof parsed.currentModel === 'string' && parsed.currentModel
        ? { currentModel: parsed.currentModel }
        : {}),
      ...(typeof parsed.provider === 'string' && parsed.provider
        ? { provider: parsed.provider }
        : {})
    }
  } catch {
    return undefined
  }
}

function encodeParserState(meta: HarnessMeta, context: HarnessParseContext): string {
  const state: HarnessParserState = {
    sessionId: meta.sessionId,
    lineNumber: context.lineNumber,
    ...(context.currentModel ? { currentModel: context.currentModel } : {}),
    ...(context.provider ? { provider: context.provider } : {})
  }
  return JSON.stringify(state)
}

function readFileRange(filePath: string, start: number, end: number): Buffer {
  const length = Math.max(0, end - start)
  if (length === 0) return Buffer.alloc(0)
  const buffer = Buffer.alloc(length)
  const fd = openSync(filePath, 'r')
  try {
    let read = 0
    while (read < length) {
      const count = readSync(fd, buffer, read, length - read, start + read)
      if (count === 0) break
      read += count
    }
    return read === length ? buffer : buffer.subarray(0, read)
  } finally {
    closeSync(fd)
  }
}

/** Recover only routing context for old sync rows created before v28. */
function recoverParserContext(buffer: Buffer, offset: number): HarnessParseContext {
  const context: HarnessParseContext = { lineNumber: 0 }
  const prefix = buffer.subarray(0, offset).toString('utf8')
  for (const line of prefix.split(/\r?\n/)) {
    if (!line.includes('request/header') && !line.includes('request/context')) continue
    try {
      updateParseContext(JSON.parse(line.trim()) as HarnessEvent, context)
    } catch {
      continue
    }
  }
  for (const byte of buffer.subarray(0, offset)) {
    if (byte === 0x0a) context.lineNumber++
  }
  return context
}

export function syncDeepSeekHarnessFile(
  filePath: string,
  byteOffset = 0,
  parserState?: string
): { records: UsageRecord[]; nextOffset: number; parserState?: string } {
  let st
  try {
    st = statSync(filePath)
  } catch {
    return { records: [], nextOffset: byteOffset }
  }
  if (st.size <= byteOffset) {
    return { records: [], nextOffset: st.size, ...(parserState ? { parserState } : {}) }
  }

  let startOffset = byteOffset > 0 && byteOffset < st.size ? byteOffset : 0
  if (startOffset > 0 && readFileRange(filePath, startOffset - 1, startOffset)[0] !== 0x0a) {
    // Sync checkpoints are newline boundaries. A malformed/legacy checkpoint
    // is safest to rebuild from zero rather than emit a partial JSON record.
    startOffset = 0
    parserState = undefined
  }

  // Once parser state is persisted, only the appended byte range is read.
  // A legacy row without parser_state pays one prefix scan to recover routing
  // context, then the next sync is O(new bytes) again.
  const buffer = readFileRange(filePath, startOffset, st.size)
  const headerBuffer =
    startOffset === 0 ? buffer : readFileRange(filePath, 0, Math.min(st.size, 128 * 1024))
  const headerEnd = headerBuffer.indexOf(0x0a)
  if (headerEnd === -1) {
    // A live writer may not have flushed the header newline yet.
    return { records: [], nextOffset: byteOffset, ...(parserState ? { parserState } : {}) }
  }
  const meta = headerFromLine(headerBuffer.subarray(0, headerEnd).toString('utf8').trim(), filePath)

  const saved = decodeParserState(parserState)
  const context: HarnessParseContext =
    startOffset > 0 && saved?.sessionId === meta.sessionId
      ? {
          lineNumber: saved.lineNumber,
          ...(saved.currentModel ? { currentModel: saved.currentModel } : {}),
          ...(saved.provider ? { provider: saved.provider } : {})
        }
      : startOffset > 0
        ? recoverParserContext(readFileRange(filePath, 0, startOffset), startOffset)
        : { lineNumber: 0 }
  const records: UsageRecord[] = []
  let cursor = 0
  while (cursor < buffer.length) {
    const newline = buffer.indexOf(0x0a, cursor)
    if (newline === -1) break
    const record = parseLine(buffer.subarray(cursor, newline).toString('utf8'), meta, context)
    if (record) records.push(record)
    cursor = newline + 1
  }

  return {
    records,
    nextOffset: startOffset + cursor,
    parserState: encodeParserState(meta, context)
  }
}
