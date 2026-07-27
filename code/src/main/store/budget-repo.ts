import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import type {
  BudgetEvent,
  BudgetRule,
  BudgetRuleInput,
  BudgetThreshold
} from '@shared/types/budget'

interface BudgetRuleRow {
  id: string
  name: string
  period_kind: BudgetRule['periodKind']
  custom_cycle_start_day: number | null
  scope: BudgetRule['scope']
  scope_value: string | null
  limit_cny: number
  enabled: number
  created_at: string
  updated_at: string
}

interface BudgetEventRow {
  id: string
  rule_id: string
  period_start: string
  period_end: string
  threshold_percent: BudgetThreshold
  spent_cny: number
  limit_cny: number
  message: string
  created_at: string
  read_at: string | null
}

function toRule(row: BudgetRuleRow): BudgetRule {
  return {
    id: row.id,
    name: row.name,
    periodKind: row.period_kind,
    scope: row.scope,
    limitCny: row.limit_cny,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.custom_cycle_start_day !== null
      ? { customCycleStartDay: row.custom_cycle_start_day }
      : {}),
    ...(row.scope_value !== null ? { scopeValue: row.scope_value } : {})
  }
}

function toEvent(row: BudgetEventRow): BudgetEvent {
  return {
    id: row.id,
    ruleId: row.rule_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    thresholdPercent: row.threshold_percent,
    spentCny: row.spent_cny,
    limitCny: row.limit_cny,
    message: row.message,
    createdAt: row.created_at,
    ...(row.read_at ? { readAt: row.read_at } : {})
  }
}

export function listBudgetRules(): BudgetRule[] {
  return (
    getDb().prepare('SELECT * FROM budget_rules ORDER BY created_at DESC').all() as BudgetRuleRow[]
  ).map(toRule)
}

export function addBudgetRule(input: BudgetRuleInput): BudgetRule {
  const now = new Date().toISOString()
  const rule: BudgetRule = {
    id: randomUUID(),
    name: input.name.trim(),
    periodKind: input.periodKind,
    scope: input.scope,
    limitCny: input.limitCny,
    enabled: input.enabled !== false,
    createdAt: now,
    updatedAt: now,
    ...(input.customCycleStartDay !== undefined
      ? { customCycleStartDay: input.customCycleStartDay }
      : {}),
    ...(input.scopeValue?.trim() ? { scopeValue: input.scopeValue.trim() } : {})
  }
  getDb()
    .prepare(
      `INSERT INTO budget_rules (
        id, name, period_kind, custom_cycle_start_day, scope, scope_value, limit_cny,
        enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      rule.id,
      rule.name,
      rule.periodKind,
      rule.customCycleStartDay ?? null,
      rule.scope,
      rule.scopeValue ?? null,
      rule.limitCny,
      rule.enabled ? 1 : 0,
      rule.createdAt,
      rule.updatedAt
    )
  return rule
}

export function updateBudgetRule(id: string, input: BudgetRuleInput): BudgetRule {
  const now = new Date().toISOString()
  const result = getDb()
    .prepare(
      `UPDATE budget_rules SET
        name = ?, period_kind = ?, custom_cycle_start_day = ?, scope = ?, scope_value = ?,
        limit_cny = ?, enabled = ?, updated_at = ?
      WHERE id = ?`
    )
    .run(
      input.name.trim(),
      input.periodKind,
      input.customCycleStartDay ?? null,
      input.scope,
      input.scopeValue?.trim() || null,
      input.limitCny,
      input.enabled !== false ? 1 : 0,
      now,
      id
    )
  if (result.changes === 0) throw new Error('预算规则不存在')
  return listBudgetRules().find((rule) => rule.id === id)!
}

export function toggleBudgetRule(id: string, enabled: boolean): void {
  const result = getDb()
    .prepare('UPDATE budget_rules SET enabled = ?, updated_at = ? WHERE id = ?')
    .run(enabled ? 1 : 0, new Date().toISOString(), id)
  if (result.changes === 0) throw new Error('预算规则不存在')
}

export function deleteBudgetRule(id: string): void {
  getDb().prepare('DELETE FROM budget_rules WHERE id = ?').run(id)
}

export function listBudgetEvents(limit = 20): BudgetEvent[] {
  return (
    getDb()
      .prepare('SELECT * FROM budget_events ORDER BY created_at DESC LIMIT ?')
      .all(Math.max(1, Math.min(limit, 100))) as BudgetEventRow[]
  ).map(toEvent)
}

export function insertBudgetEvent(
  input: Omit<BudgetEvent, 'id' | 'createdAt' | 'readAt'>
): BudgetEvent | null {
  const event: BudgetEvent = { id: randomUUID(), createdAt: new Date().toISOString(), ...input }
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO budget_events (
        id, rule_id, period_start, period_end, threshold_percent, spent_cny, limit_cny, message,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      event.id,
      event.ruleId,
      event.periodStart,
      event.periodEnd,
      event.thresholdPercent,
      event.spentCny,
      event.limitCny,
      event.message,
      event.createdAt
    )
  return result.changes === 1 ? event : null
}

export function markBudgetEventRead(id: string): void {
  getDb()
    .prepare('UPDATE budget_events SET read_at = COALESCE(read_at, ?) WHERE id = ?')
    .run(new Date().toISOString(), id)
}
