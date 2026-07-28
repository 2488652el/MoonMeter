import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { safeStorage } from 'electron'
import type {
  OtelConfigPreview,
  OtelReceiverSettings,
  OtelReceiverStatus
} from '@shared/types/otel'
import type { TimelineEventStatus, TimelineEventType } from '@shared/types/timeline'
import { getSetting, setSetting } from '../store/settings-store'
import { getDb } from '../store/db'

const OTEL_TOKEN_SETTING = 'otel_bearer_token_blob'
const OTEL_PORT_SETTING = 'otel_receiver_port'
const DEFAULT_PORT = 4_318
const MAX_BODY_BYTES = 256 * 1024
const MAX_EVENTS_PER_REQUEST = 100
const MAX_REQUESTS_PER_MINUTE = 600

const ACCEPTED_FIELDS = [
  'event_id',
  'event_type',
  'source_id',
  'session_id',
  'workspace_id',
  'task_id',
  'timestamp',
  'status',
  'model',
  'input_tokens',
  'output_tokens',
  'total_tokens',
  'cost_cny',
  'duration_ms',
  'tool_category'
]

const DROPPED_FIELDS = [
  'prompt',
  'command',
  'command_args',
  'code',
  'tool.arguments',
  'tool.input',
  'tool.output',
  'raw body',
  'unknown fields'
]

let receiver: Server | null = null
let receiverPort = DEFAULT_PORT
let receiverState: OtelReceiverStatus['state'] = 'disabled'
let lastEventAt: string | undefined
let lastErrorCode: OtelReceiverStatus['lastErrorCode'] | undefined
let recentEventCount = 0
const requestTimestamps: number[] = []

interface SanitizedEvent {
  dedupKey: string
  eventType: TimelineEventType
  sourceId?: string
  sessionId?: string
  workspaceId?: string
  taskId?: string
  occurredAt: string
  status: TimelineEventStatus
  model?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  costCny?: number
  durationMs?: number
  toolCategory?: string
}

interface ReceiverStateRow {
  enabled: number
  port: number
  last_event_at: string | null
  last_error_code: OtelReceiverStatus['lastErrorCode'] | null
}

function safeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) return undefined
  if (Array.from(normalized).some((character) => character.charCodeAt(0) < 32)) return undefined
  return normalized
}

function safeIdentity(value: unknown): string | undefined {
  const normalized = safeString(value, 300)
  if (!normalized || !/^[A-Za-z0-9:_./-]+$/.test(normalized)) return undefined
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/|~[\\/])/.test(normalized)) return undefined
  return normalized
}

function numberValue(value: unknown, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (value < 0 || value > max) return undefined
  return Math.trunc(value)
}

function numericValue(value: unknown, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (value < 0 || value > max) return undefined
  return value
}

function recordValue(record: Record<string, unknown>, key: string): unknown {
  if (record[key] !== undefined) return record[key]
  const attributes = record.attributes
  if (Array.isArray(attributes)) {
    const item = attributes.find((candidate) => {
      if (!candidate || typeof candidate !== 'object') return false
      return (candidate as Record<string, unknown>).key === key
    }) as Record<string, unknown> | undefined
    const value = item?.value
    if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>
      return object.stringValue ?? object.intValue ?? object.doubleValue ?? object.boolValue
    }
    return value
  }
  if (attributes && typeof attributes === 'object') {
    return (attributes as Record<string, unknown>)[key]
  }
  return undefined
}

function eventTimestamp(value: unknown, fallback: Date): string {
  if (typeof value === 'string') {
    const normalized = value.trim()
    const parsed = new Date(normalized)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
    if (/^\d+(?:\.\d+)?$/.test(normalized)) {
      const numeric = Number(normalized)
      if (Number.isFinite(numeric)) return eventTimestamp(numeric, fallback)
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const absolute = Math.abs(value)
    const millis =
      absolute < 100_000_000_000
        ? value * 1_000
        : absolute >= 100_000_000_000_000_000
          ? value / 1_000_000
          : absolute >= 100_000_000_000_000
            ? value / 1_000
            : value
    const parsed = new Date(millis)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return fallback.toISOString()
}

function allowedEventType(value: unknown): TimelineEventType {
  const candidate = safeString(value, 40)
  const allowed: TimelineEventType[] = [
    'session-start',
    'session-end',
    'session-resume',
    'model-call',
    'source-error',
    'permission-block',
    'sync-failure',
    'quota-alert',
    'budget-event',
    'commit',
    'pr',
    'otel'
  ]
  return candidate && allowed.includes(candidate as TimelineEventType)
    ? (candidate as TimelineEventType)
    : 'otel'
}

function allowedStatus(value: unknown): TimelineEventStatus {
  return value === 'failed' || value === 'blocked' || value === 'warning' ? value : 'ok'
}

/** Exported as a pure seam for tests; unknown payload fields never enter this result. */
export function sanitizeOtelRecord(value: unknown, now = new Date()): SanitizedEvent | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const eventId = safeString(recordValue(record, 'event_id'), 300)
  const sourceId = safeIdentity(recordValue(record, 'source_id'))
  const sessionId = safeIdentity(recordValue(record, 'session_id'))
  const workspaceId = safeIdentity(recordValue(record, 'workspace_id'))
  const taskId = safeIdentity(recordValue(record, 'task_id'))
  const timestamp =
    recordValue(record, 'timestamp') ??
    recordValue(record, 'timeUnixNano') ??
    recordValue(record, 'observedTimeUnixNano')
  const occurredAt = eventTimestamp(timestamp, now)
  const model = safeString(recordValue(record, 'model'), 200)
  const toolCategory = safeString(recordValue(record, 'tool_category'), 40)
  const inputTokens = numberValue(recordValue(record, 'input_tokens'), 1_000_000_000_000)
  const outputTokens = numberValue(recordValue(record, 'output_tokens'), 1_000_000_000_000)
  const totalTokens = numberValue(recordValue(record, 'total_tokens'), 1_000_000_000_000)
  const costCny = numericValue(recordValue(record, 'cost_cny'), 1_000_000_000)
  const durationMs = numberValue(recordValue(record, 'duration_ms'), 86_400_000)
  if (!eventId && !sessionId) return null
  const dedupKey = createHash('sha256')
    .update([sourceId ?? 'otel', sessionId ?? '', eventId ?? '', occurredAt].join('\u001f'))
    .digest('hex')
  return {
    dedupKey,
    eventType: allowedEventType(recordValue(record, 'event_type')),
    ...(sourceId ? { sourceId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(taskId ? { taskId } : {}),
    occurredAt,
    status: allowedStatus(recordValue(record, 'status')),
    ...(model ? { model } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(costCny !== undefined ? { costCny } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(toolCategory ? { toolCategory } : {})
  }
}

function payloadRecords(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  const object = payload as Record<string, unknown>
  if (Array.isArray(object.events)) return object.events
  const resourceLogs = object.resourceLogs
  if (!Array.isArray(resourceLogs)) return []
  const records: unknown[] = []
  for (const resource of resourceLogs) {
    if (!resource || typeof resource !== 'object') continue
    const scopes = (resource as Record<string, unknown>).scopeLogs
    if (!Array.isArray(scopes)) continue
    for (const scope of scopes) {
      if (!scope || typeof scope !== 'object') continue
      const logs = (scope as Record<string, unknown>).logRecords
      if (Array.isArray(logs)) records.push(...logs)
    }
  }
  return records
}

function ensureToken(): string {
  const stored = getSetting<string>(OTEL_TOKEN_SETTING)
  if (stored) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage unavailable')
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage unavailable')
  const token = randomBytes(32).toString('base64url')
  setSetting(OTEL_TOKEN_SETTING, safeStorage.encryptString(token).toString('base64'))
  return token
}

function tokenConfigured(): boolean {
  return Boolean(getSetting<string>(OTEL_TOKEN_SETTING))
}

function stateRow(): ReceiverStateRow | undefined {
  return getDb()
    .prepare(
      'SELECT enabled, port, last_event_at, last_error_code FROM otel_receiver_state WHERE id = 1'
    )
    .get() as ReceiverStateRow | undefined
}

function persistState(input: {
  enabled: boolean
  port: number
  lastEventAt?: string
  errorCode?: OtelReceiverStatus['lastErrorCode']
}): void {
  getDb()
    .prepare(
      `INSERT INTO otel_receiver_state (id, enabled, host, port, last_event_at, last_error_code, updated_at)
       VALUES (1, ?, '127.0.0.1', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         enabled = excluded.enabled,
         port = excluded.port,
         last_event_at = excluded.last_event_at,
         last_error_code = excluded.last_error_code,
         updated_at = excluded.updated_at`
    )
    .run(
      input.enabled ? 1 : 0,
      input.port,
      input.lastEventAt ?? null,
      input.errorCode ?? null,
      new Date().toISOString()
    )
}

function currentStatus(): OtelReceiverStatus {
  const row = stateRow()
  const resolvedLastEventAt = lastEventAt ?? row?.last_event_at ?? undefined
  const resolvedLastErrorCode = lastErrorCode ?? row?.last_error_code ?? undefined
  return {
    enabled: Boolean(row?.enabled),
    state: receiverState,
    host: '127.0.0.1',
    port: receiverPort || row?.port || DEFAULT_PORT,
    tokenConfigured: tokenConfigured(),
    ...(resolvedLastEventAt ? { lastEventAt: resolvedLastEventAt } : {}),
    ...(resolvedLastErrorCode ? { lastErrorCode: resolvedLastErrorCode } : {}),
    recentEventCount
  }
}

function json(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(body))
}

function authToken(request: IncomingMessage): string | undefined {
  const value = request.headers.authorization
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return undefined
  return value.slice('Bearer '.length).trim()
}

function rateAllowed(now = Date.now()): boolean {
  while (requestTimestamps[0] !== undefined && requestTimestamps[0] < now - 60_000) {
    requestTimestamps.shift()
  }
  if (requestTimestamps.length >= MAX_REQUESTS_PER_MINUTE) return false
  requestTimestamps.push(now)
  return true
}

async function readBody(request: IncomingMessage): Promise<string | null> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) return null
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function persistEvents(
  events: SanitizedEvent[],
  now: Date
): { accepted: number; duplicates: number } {
  const db = getDb()
  const dedup = db.prepare(
    `INSERT OR IGNORE INTO otel_event_dedup (
       dedup_key, source_id, event_id, session_id, occurred_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?)`
  )
  const insert = db.prepare(
    `INSERT OR IGNORE INTO agent_events (
       id, dedup_key, event_type, source_id, session_id, workspace_id, task_id,
       occurred_at, status, model, input_tokens, output_tokens, total_tokens,
       cost_cny, duration_ms, tool_category, error_code, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  let accepted = 0
  let duplicates = 0
  db.transaction(() => {
    for (const event of events) {
      const result = dedup.run(
        event.dedupKey,
        event.sourceId ?? 'otel',
        null,
        event.sessionId ?? null,
        event.occurredAt,
        now.toISOString()
      )
      if (result.changes === 0) {
        duplicates++
        continue
      }
      insert.run(
        `agent:${randomBytes(12).toString('hex')}`,
        event.dedupKey,
        event.eventType,
        event.sourceId ?? 'otel',
        event.sessionId ?? null,
        event.workspaceId ?? null,
        event.taskId ?? null,
        event.occurredAt,
        event.status,
        event.model ?? null,
        event.inputTokens ?? null,
        event.outputTokens ?? null,
        event.totalTokens ?? null,
        event.costCny ?? null,
        event.durationMs ?? null,
        event.toolCategory ?? null,
        null,
        now.toISOString()
      )
      accepted++
    }
  })()
  return { accepted, duplicates }
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'POST' || request.url !== '/v1/logs') {
    json(response, 404, { error: 'not-found' })
    return
  }
  if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    json(response, 415, { error: 'application-json-required' })
    return
  }
  if (!rateAllowed()) {
    lastErrorCode = 'rate-limited'
    json(response, 429, { error: 'rate-limited' })
    return
  }
  let token: string
  try {
    token = ensureToken()
  } catch {
    lastErrorCode = 'server-error'
    json(response, 503, { error: 'receiver-unavailable' })
    return
  }
  if (authToken(request) !== token) {
    lastErrorCode = 'invalid-token'
    json(response, 401, { error: 'invalid-token' })
    return
  }
  const body = await readBody(request)
  if (body === null) {
    lastErrorCode = 'invalid-payload'
    json(response, 413, { error: 'payload-too-large' })
    return
  }
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    lastErrorCode = 'invalid-payload'
    json(response, 400, { error: 'invalid-json' })
    return
  }
  const records = payloadRecords(payload)
  if (records.length === 0 || records.length > MAX_EVENTS_PER_REQUEST) {
    lastErrorCode = 'invalid-payload'
    json(response, 422, { error: 'invalid-event-count' })
    return
  }
  const now = new Date()
  const events = records
    .map((record) => sanitizeOtelRecord(record, now))
    .filter((event): event is SanitizedEvent => Boolean(event))
  if (!events.length) {
    lastErrorCode = 'invalid-payload'
    json(response, 422, { error: 'no-allowed-events' })
    return
  }
  try {
    const result = persistEvents(events, now)
    acceptedEvent(result.accepted, now)
    json(response, 202, result)
  } catch {
    lastErrorCode = 'server-error'
    json(response, 500, { error: 'receiver-error' })
  }
}

function acceptedEvent(count: number, now: Date): void {
  if (count <= 0) return
  lastEventAt = now.toISOString()
  recentEventCount += count
  persistState({ enabled: true, port: receiverPort, lastEventAt, errorCode: undefined })
}

async function closeReceiver(): Promise<void> {
  if (!receiver) return
  const current = receiver
  receiver = null
  await new Promise<void>((resolve) => {
    current.close(() => resolve())
  })
}

async function listen(port: number): Promise<void> {
  const server = createServer((request, response) => {
    void handleRequest(request, response)
  })
  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
  receiver = server
}

export function getOtelReceiverStatus(): OtelReceiverStatus {
  return currentStatus()
}

export async function setOtelReceiverEnabled(
  settings: OtelReceiverSettings
): Promise<OtelReceiverStatus> {
  const port = Math.max(1_024, Math.min(65_535, Math.trunc(settings.port || DEFAULT_PORT)))
  await closeReceiver()
  receiverPort = port
  lastErrorCode = undefined
  if (!settings.enabled) {
    receiverState = 'disabled'
    persistState({ enabled: false, port })
    return currentStatus()
  }
  receiverState = 'starting'
  try {
    ensureToken()
    await listen(port)
    receiverState = 'running'
    persistState({ enabled: true, port })
  } catch (error) {
    receiverState = 'error'
    lastErrorCode =
      (error as NodeJS.ErrnoException)?.code === 'EADDRINUSE' ? 'port-in-use' : 'server-error'
    persistState({ enabled: false, port, errorCode: lastErrorCode })
  }
  return currentStatus()
}

export function rotateOtelToken(): { token: string } {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage unavailable')
  const token = randomBytes(32).toString('base64url')
  setSetting(OTEL_TOKEN_SETTING, safeStorage.encryptString(token).toString('base64'))
  return { token }
}

export function getOtelConfigPreview(port = receiverPort || DEFAULT_PORT): OtelConfigPreview {
  const endpoint = `http://127.0.0.1:${port}/v1/logs`
  return {
    endpoint,
    acceptedFields: [...ACCEPTED_FIELDS],
    droppedFields: [...DROPPED_FIELDS],
    powershellScript: `$token = '<PASTE_MOONMETER_TOKEN>'\nInvoke-RestMethod -Method Post -Uri '${endpoint}' -Headers @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' } -Body (Get-Content .\\event.json -Raw)`,
    claudeConfigSnippet: JSON.stringify(
      {
        endpoint,
        headers: { Authorization: 'Bearer <PASTE_MOONMETER_TOKEN>' },
        acceptedFields: ACCEPTED_FIELDS
      },
      null,
      2
    )
  }
}

export async function initializeOtelReceiver(): Promise<void> {
  const row = stateRow()
  receiverPort = row?.port ?? getSetting<number>(OTEL_PORT_SETTING) ?? DEFAULT_PORT
  receiverState = 'disabled'
  if (row?.enabled) await setOtelReceiverEnabled({ enabled: true, port: receiverPort })
}

export async function stopOtelReceiver(): Promise<void> {
  await closeReceiver()
  receiverState = 'disabled'
  persistState({ enabled: false, port: receiverPort })
}
