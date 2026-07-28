import type { LocalSourceEnvironment } from './local-source'

export type ProjectEnvironment = LocalSourceEnvironment | 'legacy'

export interface ProjectSummary {
  id: string
  name: string
  environment: ProjectEnvironment
  wslDistribution?: string
  cost: number
  costCny: number
  currency: string
  tokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  requests: number
  sessions: number
  activeDays: number
  commitCount: number
  changedFiles: number
  additions: number
  deletions: number
  taskCount: number
  unpricedRequests: number
  totalRequests: number
  lastActivityAt?: string
}

export interface ProjectCostTrendPoint {
  date: string
  cost: number
  costCny: number
  tokens: number
  requests: number
}

export interface ProjectModelBreakdown {
  model: string
  providers: string[]
  cost: number
  costCny: number
  tokens: number
  requests: number
}

export interface ProjectSessionSummary {
  sessionId: string
  sourceId?: string
  branch?: string
  startedAt?: string
  lastActivityAt: string
  tokens: number
  requests: number
  costCny: number
  taskIds: string[]
}

export interface ProjectDetail extends ProjectSummary {
  sessionDetails: ProjectSessionSummary[]
  costTrend: ProjectCostTrendPoint[]
  models: ProjectModelBreakdown[]
  deliveries: DeliveryEvent[]
  tasks: TaskSummary[]
}

export interface ProjectListFilter {
  days?: number
  limit?: number
  offset?: number
}

export interface ProjectListPage {
  rows: ProjectSummary[]
  total: number
  limit: number
  offset: number
}

export interface TaskSummary {
  id: string
  name: string
  status: 'active' | 'completed' | 'archived'
  workspaceId?: string
  sessionCount: number
  deliveryEventCount: number
  updatedAt: string
}

export interface TaskInput {
  name: string
  workspaceId?: string
}

export interface TaskSessionAssignment {
  taskId: string
  sourceConfigId: string
  sessionId: string
}

export interface DeliveryEvent {
  id: string
  workspaceId?: string
  taskId?: string
  kind: 'commit' | 'pr'
  commitId?: string
  authorName?: string
  authoredAt?: string
  title?: string
  changedFiles: number
  additions: number
  deletions: number
  prUrl?: string
  prLabel?: string
  confirmed: boolean
  createdAt: string
  updatedAt: string
}
