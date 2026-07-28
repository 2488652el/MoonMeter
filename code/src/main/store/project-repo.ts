import { calcCost, convertSpendToCny, normalizeCurrency } from '@shared/utils/money'
import type {
  DeliveryEvent,
  ProjectCostTrendPoint,
  ProjectDetail,
  ProjectListFilter,
  ProjectListPage,
  ProjectModelBreakdown,
  ProjectSessionSummary,
  ProjectSummary,
  TaskSummary
} from '@shared/types/project'
import type { UsageCostBasis } from '@shared/types/usage'
import { findPricing, findPricingByModel } from './pricing-repo'
import { getDb } from './db'

const DEFAULT_PROJECT_DAYS = 30

interface ProjectGroupRow {
  project_id: string
  project_name: string
  environment: ProjectSummary['environment']
  wsl_distribution: string | null
  normalized_root: string | null
  provider_id: string
  billing_scope: string
  model: string
  currency: string | null
  cost_basis: UsageCostBasis
  pt: number
  ct: number
  crt: number
  cct: number
  stored_cost: number | null
  n: number
  date?: string
}

interface ProjectStatRow {
  project_id: string
  requests: number
  sessions: number
  active_days: number
  last_activity_at: string | null
}

interface ProjectSessionGroupRow extends ProjectGroupRow {
  session_id: string
  source_config_id: string | null
  branch: string | null
  started_at: string
  last_activity_at: string
}

interface DeliveryAggregateRow {
  workspace_id: string
  commit_count: number
  changed_files: number
  additions: number
  deletions: number
}

interface TaskAggregateRow {
  workspace_id: string
  task_count: number
}

interface ProjectAccumulator {
  id: string
  name: string
  environment: ProjectSummary['environment']
  wslDistribution?: string
  normalizedRoot?: string
  cost: number
  byCurrency: Map<string, number>
  costCny: number
  tokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  unpricedRequests: number
  totalRequests: number
  requests: number
  sessions: number
  activeDays: number
  lastActivityAt?: string
  commitCount: number
  changedFiles: number
  additions: number
  deletions: number
  taskCount: number
}

interface ProjectQueryFilter {
  days: number
  projectId?: string
}

const PROJECTED_USAGE_CTE = `
  WITH latest_context AS (
    SELECT session_id, workspace_id, source_config_id, branch,
           ROW_NUMBER() OVER (
             PARTITION BY session_id
             ORDER BY last_seen_at DESC, source_config_id DESC
           ) AS row_num
    FROM session_contexts
  ), projected_usage AS (
    SELECT
      COALESCE(
        latest_context.workspace_id,
        'legacy:' || lower(trim(COALESCE(NULLIF(u.agent_label, ''), NULLIF(u.session_id, ''), 'unassigned')))
      ) AS project_id,
      COALESCE(
        workspaces.display_name,
        NULLIF(trim(u.agent_label), ''),
        NULLIF(trim(u.session_id), ''),
        '未归属项目'
      ) AS project_name,
      COALESCE(workspaces.environment, 'legacy') AS environment,
      NULLIF(workspaces.wsl_distribution, '') AS wsl_distribution,
      workspaces.normalized_root AS normalized_root,
      u.provider_id,
      COALESCE(u.billing_scope, 'default') AS billing_scope,
      u.model,
      u.currency,
      COALESCE(u.cost_basis, 'current-estimate') AS cost_basis,
      COALESCE(u.prompt_tokens, 0) AS pt,
      COALESCE(u.completion_tokens, 0) AS ct,
      COALESCE(u.cache_read_tokens, 0) AS crt,
      COALESCE(u.cache_creation_tokens, 0) AS cct,
      u.cost AS stored_cost,
      u.session_id,
      latest_context.source_config_id AS source_config_id,
      latest_context.branch AS branch,
      u.captured_at
    FROM usage_records u
    LEFT JOIN latest_context
      ON latest_context.session_id = u.session_id AND latest_context.row_num = 1
    LEFT JOIN workspaces ON workspaces.id = latest_context.workspace_id
    WHERE u.source = 'session-log'
  )
`

function queryFilter(filter: ProjectQueryFilter): { sql: string; args: unknown[] } {
  const clauses: string[] = []
  const args: unknown[] = []
  if (filter.days > 0) {
    clauses.push('captured_at >= ?')
    args.push(new Date(Date.now() - filter.days * 24 * 60 * 60_000).toISOString())
  }
  if (filter.projectId) {
    clauses.push('project_id = ?')
    args.push(filter.projectId)
  }
  return { sql: clauses.length ? `AND ${clauses.join(' AND ')}` : '', args }
}

function priceGroup(row: ProjectGroupRow): {
  cost: number | null
  currency?: string
  priced: boolean
} {
  if (row.cost_basis === 'provider' || row.cost_basis === 'price-snapshot') {
    return row.stored_cost === null
      ? { cost: null, priced: false }
      : {
          cost: row.stored_cost,
          ...(row.currency ? { currency: normalizeCurrency(row.currency) } : {}),
          priced: true
        }
  }
  const pricing =
    findPricing(row.provider_id, row.model, row.currency ?? undefined, row.billing_scope) ??
    findPricingByModel(row.model, row.currency ?? undefined, row.billing_scope)
  if (!pricing)
    return {
      cost: row.stored_cost,
      ...(row.currency ? { currency: normalizeCurrency(row.currency) } : {}),
      priced: row.stored_cost !== null
    }
  return {
    cost: calcCost(
      row.pt,
      row.ct,
      pricing.promptPricePerMtok,
      pricing.completionPricePerMtok,
      row.crt,
      row.cct,
      pricing.cacheReadPricePerMtok,
      pricing.cacheCreationPricePerMtok
    ),
    currency: normalizeCurrency(pricing.currency),
    priced: true
  }
}

function projectRows(filter: ProjectQueryFilter): ProjectGroupRow[] {
  const where = queryFilter(filter)
  return getDb()
    .prepare(
      `${PROJECTED_USAGE_CTE}
       SELECT project_id, project_name, environment, wsl_distribution, normalized_root,
              provider_id, billing_scope, model, currency, cost_basis,
              SUM(pt) AS pt, SUM(ct) AS ct, SUM(crt) AS crt, SUM(cct) AS cct,
              SUM(stored_cost) AS stored_cost, COUNT(*) AS n
       FROM projected_usage
       WHERE 1 = 1 ${where.sql}
       GROUP BY project_id, project_name, environment, wsl_distribution, normalized_root,
                provider_id, billing_scope, model, currency, cost_basis
       ORDER BY project_id, provider_id, model`
    )
    .all(...where.args) as ProjectGroupRow[]
}

function projectStats(filter: ProjectQueryFilter): ProjectStatRow[] {
  const where = queryFilter(filter)
  return getDb()
    .prepare(
      `${PROJECTED_USAGE_CTE}
       SELECT project_id, COUNT(*) AS requests,
              COUNT(DISTINCT NULLIF(session_id, '')) AS sessions,
              COUNT(DISTINCT substr(captured_at, 1, 10)) AS active_days,
              MAX(captured_at) AS last_activity_at
       FROM projected_usage
       WHERE 1 = 1 ${where.sql}
       GROUP BY project_id`
    )
    .all(...where.args) as ProjectStatRow[]
}

function deliveryAggregates(): Map<string, DeliveryAggregateRow> {
  const rows = getDb()
    .prepare(
      `SELECT workspace_id,
              SUM(CASE WHEN kind = 'commit' THEN 1 ELSE 0 END) AS commit_count,
              COALESCE(SUM(changed_files), 0) AS changed_files,
              COALESCE(SUM(additions), 0) AS additions,
              COALESCE(SUM(deletions), 0) AS deletions
       FROM delivery_events
       WHERE workspace_id IS NOT NULL AND confirmed = 1
       GROUP BY workspace_id`
    )
    .all() as DeliveryAggregateRow[]
  return new Map(rows.map((row) => [row.workspace_id, row]))
}

function taskAggregates(): Map<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT workspace_id, COUNT(*) AS task_count
       FROM tasks
       WHERE workspace_id IS NOT NULL AND status <> 'archived'
       GROUP BY workspace_id`
    )
    .all() as TaskAggregateRow[]
  return new Map(rows.map((row) => [row.workspace_id, row.task_count]))
}

function createAccumulator(row: ProjectGroupRow): ProjectAccumulator {
  return {
    id: row.project_id,
    name: row.project_name,
    environment: row.environment,
    ...(row.wsl_distribution ? { wslDistribution: row.wsl_distribution } : {}),
    cost: 0,
    byCurrency: new Map(),
    costCny: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    unpricedRequests: 0,
    totalRequests: 0,
    requests: 0,
    sessions: 0,
    activeDays: 0,
    commitCount: 0,
    changedFiles: 0,
    additions: 0,
    deletions: 0,
    taskCount: 0
  }
}

function finalizeAccumulator(
  accumulator: ProjectAccumulator,
  stats: ProjectStatRow | undefined,
  delivery: DeliveryAggregateRow | undefined,
  taskCount: number | undefined
): ProjectSummary {
  const byCurrency = [...accumulator.byCurrency.entries()]
  const primary = [...byCurrency].sort((a, b) => b[1] - a[1])[0]
  const conversion = convertSpendToCny({
    byCurrency: byCurrency.map(([currency, amount]) => ({ currency, amount }))
  })
  return {
    id: accumulator.id,
    name: accumulator.name,
    environment: accumulator.environment,
    ...(accumulator.wslDistribution ? { wslDistribution: accumulator.wslDistribution } : {}),
    cost: primary?.[1] ?? 0,
    costCny: conversion.cnyTotal,
    currency: primary?.[0] ?? 'CNY',
    tokens: accumulator.tokens,
    inputTokens: accumulator.inputTokens,
    outputTokens: accumulator.outputTokens,
    cacheReadTokens: accumulator.cacheReadTokens,
    cacheCreationTokens: accumulator.cacheCreationTokens,
    requests: stats?.requests ?? 0,
    sessions: stats?.sessions ?? 0,
    activeDays: stats?.active_days ?? 0,
    commitCount: delivery?.commit_count ?? 0,
    changedFiles: delivery?.changed_files ?? 0,
    additions: delivery?.additions ?? 0,
    deletions: delivery?.deletions ?? 0,
    taskCount: taskCount ?? 0,
    unpricedRequests: accumulator.unpricedRequests,
    totalRequests: stats?.requests ?? accumulator.totalRequests,
    ...(stats?.last_activity_at ? { lastActivityAt: stats.last_activity_at } : {})
  }
}

function aggregateProjects(filter: ProjectQueryFilter): ProjectSummary[] {
  const rows = projectRows(filter)
  const stats = new Map(projectStats(filter).map((row) => [row.project_id, row]))
  const deliveries = deliveryAggregates()
  const tasks = taskAggregates()
  const accumulators = new Map<string, ProjectAccumulator>()
  for (const row of rows) {
    const accumulator = accumulators.get(row.project_id) ?? createAccumulator(row)
    const priced = priceGroup(row)
    accumulator.totalRequests += row.n
    accumulator.inputTokens += row.pt
    accumulator.outputTokens += row.ct
    accumulator.cacheReadTokens += row.crt
    accumulator.cacheCreationTokens += row.cct
    accumulator.tokens += row.pt + row.ct + row.crt + row.cct
    if (!priced.priced || priced.cost === null || !priced.currency) {
      accumulator.unpricedRequests += row.n
    } else {
      accumulator.byCurrency.set(
        priced.currency,
        (accumulator.byCurrency.get(priced.currency) ?? 0) + priced.cost
      )
    }
    accumulators.set(row.project_id, accumulator)
  }
  return [...accumulators.values()]
    .map((accumulator) =>
      finalizeAccumulator(
        accumulator,
        stats.get(accumulator.id),
        deliveries.get(accumulator.id),
        tasks.get(accumulator.id)
      )
    )
    .sort((left, right) => {
      const cost = right.costCny - left.costCny
      return cost || right.tokens - left.tokens || left.name.localeCompare(right.name)
    })
}

export function listProjectSummaries(filter: ProjectListFilter = {}): ProjectListPage {
  const days = Math.max(0, Math.min(3_650, Math.trunc(filter.days ?? DEFAULT_PROJECT_DAYS)))
  const limit = Math.max(1, Math.min(500, Math.trunc(filter.limit ?? 100)))
  const offset = Math.max(0, Math.trunc(filter.offset ?? 0))
  const rows = aggregateProjects({ days })
  return { rows: rows.slice(offset, offset + limit), total: rows.length, limit, offset }
}

function rowsForProject(filter: ProjectQueryFilter): ProjectGroupRow[] {
  return projectRows(filter)
}

function costTrend(projectId: string, days: number): ProjectCostTrendPoint[] {
  const where = queryFilter({ days, projectId })
  const rows = getDb()
    .prepare(
      `${PROJECTED_USAGE_CTE}
       SELECT project_id, project_name, environment, wsl_distribution, normalized_root,
              substr(captured_at, 1, 10) AS date, provider_id, billing_scope, model,
              currency, cost_basis, SUM(pt) AS pt, SUM(ct) AS ct, SUM(crt) AS crt,
              SUM(cct) AS cct, SUM(stored_cost) AS stored_cost, COUNT(*) AS n
       FROM projected_usage
       WHERE 1 = 1 ${where.sql}
       GROUP BY project_id, project_name, environment, wsl_distribution, normalized_root,
                date, provider_id, billing_scope, model, currency, cost_basis
       ORDER BY date ASC`
    )
    .all(...where.args) as Array<ProjectGroupRow & { date: string }>
  const daily = new Map<string, { cost: number; tokens: number; requests: number }>()
  for (const row of rows) {
    const day = daily.get(row.date) ?? { cost: 0, tokens: 0, requests: 0 }
    const priced = priceGroup(row)
    if (priced.cost !== null && priced.cost !== undefined && priced.currency) {
      const converted = convertSpendToCny({
        byCurrency: [{ currency: priced.currency, amount: priced.cost }]
      })
      day.cost += converted.cnyTotal
    }
    day.tokens += row.pt + row.ct + row.crt + row.cct
    day.requests += row.n
    daily.set(row.date, day)
  }
  return [...daily.entries()].map(([date, value]) => ({
    date,
    cost: value.cost,
    costCny: value.cost,
    tokens: value.tokens,
    requests: value.requests
  }))
}

function modelBreakdown(projectId: string, days: number): ProjectModelBreakdown[] {
  const rows = rowsForProject({ days, projectId })
  const models = new Map<
    string,
    { providers: Set<string>; cost: number; tokens: number; requests: number }
  >()
  for (const row of rows) {
    const item = models.get(row.model) ?? {
      providers: new Set<string>(),
      cost: 0,
      tokens: 0,
      requests: 0
    }
    const priced = priceGroup(row)
    if (priced.cost !== null && priced.cost !== undefined && priced.currency) {
      item.cost += convertSpendToCny({
        byCurrency: [{ currency: priced.currency, amount: priced.cost }]
      }).cnyTotal
    }
    item.providers.add(row.provider_id)
    item.tokens += row.pt + row.ct + row.crt + row.cct
    item.requests += row.n
    models.set(row.model, item)
  }
  return [...models.entries()]
    .map(([model, value]) => ({
      model,
      providers: [...value.providers].sort(),
      cost: value.cost,
      costCny: value.cost,
      tokens: value.tokens,
      requests: value.requests
    }))
    .sort((left, right) => right.costCny - left.costCny)
}

function taskRowsForWorkspace(workspaceId: string): TaskSummary[] {
  return getDb()
    .prepare(
      `SELECT tasks.id, tasks.name, tasks.status, tasks.workspace_id,
              COUNT(DISTINCT task_sessions.session_id) AS session_count,
              COUNT(DISTINCT delivery_events.id) AS delivery_event_count,
              tasks.updated_at
       FROM tasks
       LEFT JOIN task_sessions ON task_sessions.task_id = tasks.id
       LEFT JOIN delivery_events ON delivery_events.task_id = tasks.id
       WHERE tasks.workspace_id = ? AND tasks.status <> 'archived'
       GROUP BY tasks.id, tasks.name, tasks.status, tasks.workspace_id, tasks.updated_at
       ORDER BY tasks.updated_at DESC`
    )
    .all(workspaceId)
    .map((row) => {
      const value = row as {
        id: string
        name: string
        status: TaskSummary['status']
        workspace_id: string | null
        session_count: number
        delivery_event_count: number
        updated_at: string
      }
      return {
        id: value.id,
        name: value.name,
        status: value.status,
        ...(value.workspace_id ? { workspaceId: value.workspace_id } : {}),
        sessionCount: value.session_count,
        deliveryEventCount: value.delivery_event_count,
        updatedAt: value.updated_at
      }
    })
}

function deliveryRowsForWorkspace(workspaceId: string): DeliveryEvent[] {
  return getDb()
    .prepare(
      `SELECT * FROM delivery_events
       WHERE workspace_id = ?
       ORDER BY COALESCE(authored_at, created_at) DESC, id DESC
       LIMIT 500`
    )
    .all(workspaceId)
    .map((row) => {
      const value = row as Record<string, unknown>
      return {
        id: String(value.id),
        ...(value.workspace_id ? { workspaceId: String(value.workspace_id) } : {}),
        ...(value.task_id ? { taskId: String(value.task_id) } : {}),
        kind: value.kind as DeliveryEvent['kind'],
        ...(value.commit_id ? { commitId: String(value.commit_id) } : {}),
        ...(value.author_name ? { authorName: String(value.author_name) } : {}),
        ...(value.authored_at ? { authoredAt: String(value.authored_at) } : {}),
        ...(value.title ? { title: String(value.title) } : {}),
        changedFiles: Number(value.changed_files ?? 0),
        additions: Number(value.additions ?? 0),
        deletions: Number(value.deletions ?? 0),
        ...(value.pr_url ? { prUrl: String(value.pr_url) } : {}),
        ...(value.pr_label ? { prLabel: String(value.pr_label) } : {}),
        confirmed: Number(value.confirmed ?? 0) === 1,
        createdAt: String(value.created_at),
        updatedAt: String(value.updated_at)
      }
    })
}

function sessionRows(projectId: string, days: number): ProjectSessionSummary[] {
  const where = queryFilter({ days, projectId })
  const rows = getDb()
    .prepare(
      `${PROJECTED_USAGE_CTE}
       SELECT project_id, project_name, environment, wsl_distribution, normalized_root,
              provider_id, billing_scope, model, currency, cost_basis, session_id,
              source_config_id, branch,
              SUM(pt) AS pt, SUM(ct) AS ct, SUM(crt) AS crt, SUM(cct) AS cct,
              SUM(stored_cost) AS stored_cost, COUNT(*) AS n, MIN(captured_at) AS started_at,
              MAX(captured_at) AS last_activity_at
       FROM projected_usage
       WHERE session_id IS NOT NULL AND trim(session_id) <> '' ${where.sql}
      GROUP BY project_id, project_name, environment, wsl_distribution, normalized_root,
                provider_id, billing_scope, model, currency, cost_basis, session_id,
                source_config_id, branch
       ORDER BY last_activity_at DESC`
    )
    .all(...where.args) as ProjectSessionGroupRow[]
  const sessions = new Map<string, ProjectSessionSummary>()
  for (const row of rows) {
    const current = sessions.get(row.session_id) ?? {
      sessionId: row.session_id,
      ...(row.source_config_id ? { sourceId: row.source_config_id } : {}),
      ...(row.branch ? { branch: row.branch } : {}),
      startedAt: row.started_at,
      lastActivityAt: row.last_activity_at,
      tokens: 0,
      requests: 0,
      costCny: 0,
      taskIds: []
    }
    const priced = priceGroup(row)
    if (priced.cost !== null && priced.cost !== undefined && priced.currency) {
      current.costCny += convertSpendToCny({
        byCurrency: [{ currency: priced.currency, amount: priced.cost }]
      }).cnyTotal
    }
    current.tokens += row.pt + row.ct + row.crt + row.cct
    current.requests += row.n
    if (row.started_at < (current.startedAt ?? row.started_at)) current.startedAt = row.started_at
    if (row.last_activity_at > current.lastActivityAt) current.lastActivityAt = row.last_activity_at
    sessions.set(row.session_id, current)
  }
  return [...sessions.values()].slice(0, 500)
}

export function getProjectDetail(id: string, days = DEFAULT_PROJECT_DAYS): ProjectDetail | null {
  const summary = aggregateProjects({
    days: Math.max(0, Math.min(3_650, Math.trunc(days))),
    projectId: id
  })[0]
  if (!summary) return null
  const workspaceId = summary.environment === 'legacy' ? undefined : summary.id
  return {
    ...summary,
    sessionDetails: sessionRows(id, days),
    costTrend: costTrend(id, days),
    models: modelBreakdown(id, days),
    deliveries: workspaceId ? deliveryRowsForWorkspace(workspaceId) : [],
    tasks: workspaceId ? taskRowsForWorkspace(workspaceId) : []
  }
}
