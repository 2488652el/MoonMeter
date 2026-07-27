import type { UsageAnalysisFilter } from './usage'

export type BudgetPeriodKind = 'calendar-month' | 'custom-cycle'
export type BudgetScope = 'total' | 'provider' | 'project'
export type BudgetThreshold = 50 | 80 | 100

export interface BudgetRuleInput {
  name: string
  periodKind: BudgetPeriodKind
  customCycleStartDay?: number
  scope: BudgetScope
  scopeValue?: string
  limitCny: number
  enabled?: boolean
}

export interface BudgetRule extends BudgetRuleInput {
  id: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface BudgetPeriod {
  startsAt: string
  endsAt: string
  label: string
}

export interface BudgetDataQuality {
  totalRequests: number
  pricedRequests: number
  providerCostRequests: number
  priceSnapshotRequests: number
  estimatedRequests: number
  unpricedRequests: number
  unconvertedCurrencies: string[]
}

export interface BudgetForecast {
  available: boolean
  projectedCny?: number
  reason?: 'period-too-new' | 'no-cost-data'
}

export interface BudgetEvaluation {
  rule: BudgetRule
  period: BudgetPeriod
  filter: UsageAnalysisFilter
  spentCny: number
  percentUsed: number
  reachedThreshold?: BudgetThreshold
  forecast: BudgetForecast
  dataQuality: BudgetDataQuality
}

export interface BudgetEvent {
  id: string
  ruleId: string
  periodStart: string
  periodEnd: string
  thresholdPercent: BudgetThreshold
  spentCny: number
  limitCny: number
  message: string
  createdAt: string
  readAt?: string
}

export interface BudgetOverview {
  generatedAt: string
  evaluations: BudgetEvaluation[]
  recentEvents: BudgetEvent[]
}
