import type { BudgetDataQuality } from './budget'

export type LocalReportPeriodKind = 'week' | 'month'

export interface LocalReportPeriod {
  startsAt: string
  endsAt: string
  label: string
}

/** A display-only aggregate; labels intentionally exclude filesystem paths and session identifiers. */
export interface LocalReportRankedItem {
  label: string
  amountCny: number
  requests: number
  tokens: number
}

/** A non-binding comparison that only exists for an exact same-model price match. */
export interface LocalUsageRecommendation {
  model: string
  currentProviders: string[]
  candidateProvider: string
  requestCount: number
  estimatedCurrentCny: number
  estimatedCandidateCny: number
  savingsCny: number
  savingsPercent: number
  reason: string
}

export interface LocalPeriodReport {
  kind: LocalReportPeriodKind
  generatedAt: string
  period: LocalReportPeriod
  comparisonPeriod: LocalReportPeriod
  totalCny: number
  comparisonTotalCny: number
  changeCny: number
  /** Omitted when the comparable prior period has no cost. */
  changePercent?: number
  totalRequests: number
  comparisonRequests: number
  providers: LocalReportRankedItem[]
  models: LocalReportRankedItem[]
  projects: LocalReportRankedItem[]
  highCostSessions: LocalReportRankedItem[]
  dataQuality: BudgetDataQuality
  recommendationsEnabled: boolean
  recommendations: LocalUsageRecommendation[]
  /** Explains why no recommendation is shown instead of inferring model capabilities. */
  recommendationsUnavailableReason?: string
}

export interface LocalReportOverview {
  enabled: boolean
  recommendationsEnabled: boolean
  report?: LocalPeriodReport
}
