import { createHash, randomUUID } from 'node:crypto'
import type {
  TimelineEvent,
  TimelineEventStatus,
  TimelineEventType,
  TimelineFilter,
  TimelinePage
} from '@shared/types/timeline'
import { convertSpendToCny } from '@shared/utils/money'
import { getDb } from './db'

const DETAIL_RETENTION_DAYS = 90

interface TimelineRow {
  event_id: string
  event_type: TimelineEventType
  source_id: string | null
  session_id: string | null
  workspace_id: string | null
  task_id: string | null
  occurred_at: string
  status: TimelineEventStatus
  model: string | null
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  cost: number | null
  currency: string | null
  cost_cny: number | null
  duration_ms: number | null
  tool_category: string | null
  error_code: string | null
  title: string | null
  commit_id: string | null
  changed_files: number | null
  additions: number | null
  deletions: number | null
  pr_url: string | null
  pr_label: string | null
}

interface AgentEventInput {
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
  errorCode?: string
}

const LATEST_CONTEXT_CTE = `
  WITH latest_context AS (
    SELECT session_id, workspace_id,
           ROW_NUMBER() OVER (
             PARTITION BY session_id
             ORDER BY last_seen_at DESC, source_config_id DESC
           ) AS row_num
    FROM session_contexts
  ), timeline_events AS (
    SELECT
      'usage:' || u.id AS event_id,
      'model-call' AS event_type,
      'session-log' AS source_id,
      u.session_id AS session_id,
      latest_context.workspace_id AS workspace_id,
      NULL AS task_id,
      u.captured_at AS occurred_at,
      'ok' AS status,
      u.model AS model,
      u.prompt_tokens AS input_tokens,
      u.completion_tokens AS output_tokens,
      u.total_tokens AS total_tokens,
      u.cost AS cost,
      u.currency AS currency,
      NULL AS cost_cny,
      NULL AS duration_ms,
      NULL AS tool_category,
      NULL AS error_code,
      NULL AS title,
      NULL AS commit_id,
      NULL AS changed_files,
      NULL AS additions,
      NULL AS deletions,
      NULL AS pr_url,
      NULL AS pr_label
    FROM usage_records u
    LEFT JOIN latest_context
      ON latest_context.session_id = u.session_id AND latest_context.row_num = 1
    WHERE u.source = 'session-log'

    UNION ALL

    SELECT
      'agent:' || id, event_type, source_id, session_id, workspace_id, task_id,
      occurred_at, status, model, input_tokens, output_tokens, total_tokens,
      NULL, NULL, cost_cny, duration_ms, tool_category, error_code,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL
    FROM agent_events

    UNION ALL

    SELECT
      'delivery:' || id,
      kind,
      'git',
      NULL,
      workspace_id,
      task_id,
      COALESCE(authored_at, created_at),
      CASE WHEN confirmed = 1 THEN 'ok' ELSE 'warning' END,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      title, commit_id, changed_files, additions, deletions, pr_url, pr_label
    FROM delivery_events

    UNION ALL

    SELECT
      'source:' || source_id || ':' || account_ref || ':' || updated_at,
      'source-error',
      source_id,
      NULL,
      NULL,
      NULL,
      updated_at,
      CASE WHEN status = 'error' THEN 'failed' ELSE 'warning' END,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      error_code, NULL, NULL, NULL, NULL, NULL, NULL, NULL
    FROM source_health

    UNION ALL

    SELECT
      'budget:' || id,
      'budget-event',
      'budget:' || rule_id,
      NULL,
      NULL,
      NULL,
      created_at,
      'warning',
      NULL, NULL, NULL, NULL, spent_cny, 'CNY', spent_cny,
      NULL, NULL, NULL,
      '预算达到 ' || threshold_percent || '%', NULL, NULL, NULL, NULL, NULL, NULL
    FROM budget_events
  )`

function encodeCursor(occurredAt: string, eventId: string): string {
  return Buffer.from(JSON.stringify({ occurredAt, eventId }), 'utf8').toString('base64url')
}

function decodeCursor(value?: string): { occurredAt: string; eventId: string } | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >
    if (typeof parsed.occurredAt !== 'string' || typeof parsed.eventId !== 'string')
      return undefined
    return { occurredAt: parsed.occurredAt, eventId: parsed.eventId }
  } catch {
    return undefined
  }
}

function rowToEvent(row: TimelineRow): TimelineEvent {
  const converted =
    row.cost_cny !== null
      ? { cnyTotal: row.cost_cny }
      : row.cost !== null && row.currency
        ? convertSpendToCny({ byCurrency: [{ currency: row.currency, amount: row.cost }] })
        : undefined
  return {
    id: row.event_id,
    eventType: row.event_type,
    ...(row.source_id ? { sourceId: row.source_id } : {}),
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    ...(row.task_id ? { taskId: row.task_id } : {}),
    occurredAt: row.occurred_at,
    status: row.status,
    ...(row.model ? { model: row.model } : {}),
    ...(row.input_tokens !== null ? { inputTokens: row.input_tokens } : {}),
    ...(row.output_tokens !== null ? { outputTokens: row.output_tokens } : {}),
    ...(row.total_tokens !== null ? { totalTokens: row.total_tokens } : {}),
    ...(converted && converted.cnyTotal !== 0 ? { costCny: converted.cnyTotal } : {}),
    ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
    ...(row.tool_category ? { toolCategory: row.tool_category } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.title ? { title: row.title } : {}),
    ...(row.commit_id ? { commitId: row.commit_id } : {}),
    ...(row.changed_files !== null ? { changedFiles: row.changed_files } : {}),
    ...(row.additions !== null ? { additions: row.additions } : {}),
    ...(row.deletions !== null ? { deletions: row.deletions } : {}),
    ...(row.pr_url ? { prUrl: row.pr_url } : {}),
    ...(row.pr_label ? { prLabel: row.pr_label } : {})
  }
}

export function listTimeline(filter: TimelineFilter = {}): TimelinePage {
  const clauses: string[] = []
  const args: unknown[] = []
  if (filter.workspaceId) {
    clauses.push('workspace_id = ?')
    args.push(filter.workspaceId)
  }
  if (filter.taskId) {
    clauses.push('task_id = ?')
    args.push(filter.taskId)
  }
  if (filter.sourceId) {
    clauses.push('source_id = ?')
    args.push(filter.sourceId)
  }
  if (filter.status) {
    clauses.push('status = ?')
    args.push(filter.status)
  }
  if (filter.eventTypes?.length) {
    clauses.push(`event_type IN (${filter.eventTypes.map(() => '?').join(', ')})`)
    args.push(...filter.eventTypes)
  }
  if (filter.fromISO) {
    clauses.push('occurred_at >= ?')
    args.push(filter.fromISO)
  }
  if (filter.toISO) {
    clauses.push('occurred_at <= ?')
    args.push(filter.toISO)
  }
  const cursor = decodeCursor(filter.cursor)
  if (cursor) {
    clauses.push('(occurred_at < ? OR (occurred_at = ? AND event_id < ?))')
    args.push(cursor.occurredAt, cursor.occurredAt, cursor.eventId)
  }
  const limit = Math.max(1, Math.min(200, Math.trunc(filter.limit ?? 50)))
  const rows = getDb()
    .prepare(
      `${LATEST_CONTEXT_CTE}
       SELECT * FROM timeline_events
       WHERE 1 = 1 ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''}
       ORDER BY occurred_at DESC, event_id DESC
       LIMIT ?`
    )
    .all(...args, limit + 1) as TimelineRow[]
  const hasNext = rows.length > limit
  const visible = hasNext ? rows.slice(0, limit) : rows
  return {
    rows: visible.map(rowToEvent),
    ...(hasNext && visible.at(-1)
      ? { nextCursor: encodeCursor(visible.at(-1)!.occurred_at, visible.at(-1)!.event_id) }
      : {})
  }
}

export function insertAgentEvent(input: AgentEventInput, now = new Date()): boolean {
  const eventId = `agent:${randomUUID()}`
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO agent_events (
         id, dedup_key, event_type, source_id, session_id, workspace_id, task_id,
         occurred_at, status, model, input_tokens, output_tokens, total_tokens,
         cost_cny, duration_ms, tool_category, error_code, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      eventId,
      input.dedupKey,
      input.eventType,
      input.sourceId ?? null,
      input.sessionId ?? null,
      input.workspaceId ?? null,
      input.taskId ?? null,
      input.occurredAt,
      input.status,
      input.model ?? null,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.totalTokens ?? null,
      input.costCny ?? null,
      input.durationMs ?? null,
      input.toolCategory ?? null,
      input.errorCode ?? null,
      now.toISOString()
    )
  return result.changes > 0
}

export function cleanupTimelineDetails(
  now = new Date(),
  retentionDays = DETAIL_RETENTION_DAYS
): number {
  const boundary = new Date(now.getTime() - retentionDays * 24 * 60 * 60_000).toISOString()
  const db = getDb()
  const oldEvents = db
    .prepare(
      `SELECT substr(occurred_at, 1, 10) AS day,
              COALESCE(workspace_id, '') AS workspace_id,
              COALESCE(task_id, '') AS task_id,
              COALESCE(source_id, '') AS source_id,
              event_type, COUNT(*) AS event_count,
              SUM(CASE WHEN status IN ('failed', 'blocked') THEN 1 ELSE 0 END) AS failed_count,
              COALESCE(SUM(duration_ms), 0) AS total_duration_ms,
              COALESCE(SUM(total_tokens), 0) AS total_tokens,
              COALESCE(SUM(cost_cny), 0) AS total_cost_cny
       FROM agent_events
       WHERE occurred_at < ?
       GROUP BY day, workspace_id, task_id, source_id, event_type`
    )
    .all(boundary) as Array<{
    day: string
    workspace_id: string
    task_id: string
    source_id: string
    event_type: string
    event_count: number
    failed_count: number
    total_duration_ms: number
    total_tokens: number
    total_cost_cny: number
  }>
  const remove = db.prepare('DELETE FROM agent_events WHERE occurred_at < ?')
  const writeDaily = db.prepare(
    `INSERT INTO agent_event_daily (
       day, workspace_id, task_id, source_id, event_type, event_count,
       failed_count, total_duration_ms, total_tokens, total_cost_cny
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day, workspace_id, task_id, source_id, event_type) DO UPDATE SET
       event_count = agent_event_daily.event_count + excluded.event_count,
       failed_count = agent_event_daily.failed_count + excluded.failed_count,
       total_duration_ms = agent_event_daily.total_duration_ms + excluded.total_duration_ms,
       total_tokens = agent_event_daily.total_tokens + excluded.total_tokens,
       total_cost_cny = agent_event_daily.total_cost_cny + excluded.total_cost_cny`
  )
  return db.transaction(() => {
    for (const row of oldEvents) {
      writeDaily.run(
        row.day,
        row.workspace_id,
        row.task_id,
        row.source_id,
        row.event_type,
        row.event_count,
        row.failed_count,
        row.total_duration_ms,
        row.total_tokens,
        row.total_cost_cny
      )
    }
    return remove.run(boundary).changes
  })()
}

export function timelineRetentionDays(): number {
  return DETAIL_RETENTION_DAYS
}

export function dedupKeyForParts(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u001f')).digest('hex')
}
