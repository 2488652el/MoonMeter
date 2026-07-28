export type TimelineEventType =
  | 'session-start'
  | 'session-end'
  | 'session-resume'
  | 'model-call'
  | 'source-error'
  | 'permission-block'
  | 'sync-failure'
  | 'quota-alert'
  | 'budget-event'
  | 'commit'
  | 'pr'
  | 'otel'

export type TimelineEventStatus = 'ok' | 'failed' | 'blocked' | 'warning'

export interface TimelineEvent {
  id: string
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
  title?: string
  commitId?: string
  changedFiles?: number
  additions?: number
  deletions?: number
  prUrl?: string
  prLabel?: string
}

export interface TimelineFilter {
  cursor?: string
  limit?: number
  workspaceId?: string
  taskId?: string
  sourceId?: string
  eventTypes?: TimelineEventType[]
  status?: TimelineEventStatus
  fromISO?: string
  toISO?: string
}

export interface TimelinePage {
  rows: TimelineEvent[]
  nextCursor?: string
}
