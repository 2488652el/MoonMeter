import { computeTotalSpend } from '../store/usage-repo'
import { insertBudgetEvent, listBudgetEvents, listBudgetRules } from '../store/budget-repo'
import type {
  BudgetEvaluation,
  BudgetEvent,
  BudgetForecast,
  BudgetOverview,
  BudgetPeriod,
  BudgetRule,
  BudgetThreshold
} from '@shared/types/budget'
import type { UsageAnalysisFilter } from '@shared/types/usage'

const THRESHOLDS: readonly BudgetThreshold[] = [100, 80, 50]
const FORECAST_MIN_ELAPSED_MS = 6 * 60 * 60_000

function localMonthStart(year: number, month: number, day: number): Date {
  return new Date(year, month, day, 0, 0, 0, 0)
}

export function resolveBudgetPeriod(rule: BudgetRule, now = new Date()): BudgetPeriod {
  const year = now.getFullYear()
  const month = now.getMonth()
  const day = rule.periodKind === 'custom-cycle' ? (rule.customCycleStartDay ?? 1) : 1
  const currentStart = localMonthStart(year, month, day)
  const startsAt =
    now.getTime() >= currentStart.getTime() ? currentStart : localMonthStart(year, month - 1, day)
  const endsAt = localMonthStart(startsAt.getFullYear(), startsAt.getMonth() + 1, day)
  const label =
    rule.periodKind === 'calendar-month'
      ? `${startsAt.getFullYear()}-${String(startsAt.getMonth() + 1).padStart(2, '0')} 自然月`
      : `${startsAt.toLocaleDateString('zh-CN')} 至 ${new Date(endsAt.getTime() - 1).toLocaleDateString('zh-CN')}`
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), label }
}

export function budgetRuleToFilter(
  rule: BudgetRule,
  period: BudgetPeriod,
  now = new Date()
): UsageAnalysisFilter {
  const filter: UsageAnalysisFilter = { fromISO: period.startsAt, toISO: now.toISOString() }
  if (rule.scope === 'provider' && rule.scopeValue) filter.providerId = rule.scopeValue
  if (rule.scope === 'project' && rule.scopeValue) filter.projectContains = rule.scopeValue
  return filter
}

function thresholdFor(percentUsed: number): BudgetThreshold | undefined {
  return THRESHOLDS.find((threshold) => percentUsed >= threshold)
}

function forecastFor(spentCny: number, period: BudgetPeriod, now: Date): BudgetForecast {
  if (spentCny <= 0) return { available: false, reason: 'no-cost-data' }
  const startsAt = Date.parse(period.startsAt)
  const endsAt = Date.parse(period.endsAt)
  const elapsed = now.getTime() - startsAt
  if (!Number.isFinite(elapsed) || elapsed < FORECAST_MIN_ELAPSED_MS || endsAt <= startsAt) {
    return { available: false, reason: 'period-too-new' }
  }
  return { available: true, projectedCny: (spentCny / elapsed) * (endsAt - startsAt) }
}

export function evaluateBudgetRule(rule: BudgetRule, now = new Date()): BudgetEvaluation {
  const period = resolveBudgetPeriod(rule, now)
  const filter = budgetRuleToFilter(rule, period, now)
  const spend = computeTotalSpend(filter)
  const spentCny = spend.cnyTotal
  const percentUsed = rule.limitCny > 0 ? (spentCny / rule.limitCny) * 100 : 0
  const reachedThreshold = thresholdFor(percentUsed)
  return {
    rule,
    period,
    filter,
    spentCny,
    percentUsed,
    ...(reachedThreshold ? { reachedThreshold } : {}),
    forecast: forecastFor(spentCny, period, now),
    dataQuality: {
      totalRequests: spend.totalRequests,
      pricedRequests: spend.pricedRequests,
      providerCostRequests: spend.providerCostRequests,
      priceSnapshotRequests: spend.snapshotCostRequests,
      estimatedRequests: spend.estimatedRequests,
      unpricedRequests: spend.unpricedRequests,
      unconvertedCurrencies: spend.unconvertedCurrencies
    }
  }
}

export function getBudgetOverview(now = new Date()): BudgetOverview {
  return {
    generatedAt: now.toISOString(),
    evaluations: listBudgetRules().map((rule) => evaluateBudgetRule(rule, now)),
    recentEvents: listBudgetEvents()
  }
}

/** Persist only the highest newly-reached threshold in a billing period. */
export function evaluateBudgetReminders(now = new Date()): BudgetEvent[] {
  const events: BudgetEvent[] = []
  for (const rule of listBudgetRules()) {
    if (!rule.enabled) continue
    const evaluation = evaluateBudgetRule(rule, now)
    if (!evaluation.reachedThreshold) continue
    const event = insertBudgetEvent({
      ruleId: rule.id,
      periodStart: evaluation.period.startsAt,
      periodEnd: evaluation.period.endsAt,
      thresholdPercent: evaluation.reachedThreshold,
      spentCny: evaluation.spentCny,
      limitCny: rule.limitCny,
      message: `${rule.name} 已使用 ${evaluation.percentUsed.toFixed(1)}%，当前 ¥${evaluation.spentCny.toFixed(2)} / ¥${rule.limitCny.toFixed(2)}`
    })
    if (event) events.push(event)
  }
  return events
}
