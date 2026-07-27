export type QuotaKind = 'hard-quota' | 'balance' | 'soft-limit' | 'local-estimate'
export type QuotaConfidence = 'measured' | 'derived' | 'estimated'
export type QuotaUnit = 'percent' | 'currency' | 'tokens' | 'requests'
export type QuotaWindowType = 'rolling' | 'calendar' | 'balance' | 'unknown'

/** A non-sensitive, provider-neutral quota observation. */
export interface QuotaWindow {
  sourceId: string
  accountRef: string
  windowKey: string
  windowType: QuotaWindowType
  quotaKind: QuotaKind
  unit: QuotaUnit
  capturedAt: string
  freshUntil: string
  confidence: QuotaConfidence
  planRef?: string
  usedPercent?: number
  used?: number
  limit?: number
  resetAt?: string
}

export interface QuotaSample {
  sourceId: string
  accountRef: string
  windowKey: string
  windowType: QuotaWindowType
  quotaKind: QuotaKind
  unit: QuotaUnit
  confidence: QuotaConfidence
  planRef?: string
  capturedAt: string
  resetAt?: string
  usedPercent?: number
  used?: number
  limit?: number
}

export type QuotaForecastCategory = 'exhausts-early' | 'sustainable' | 'may-waste'
export type QuotaForecastUnavailableReason =
  'insufficient-samples' | 'stale-data' | 'missing-reset' | 'window-changed' | 'invalid-data'

export type QuotaForecast =
  | {
      available: true
      category: QuotaForecastCategory
      medianRatePerHour: number
      projectedUsedAtReset: number
      currentUsedPercent: number
      sampleCount: number
      sampleStart: string
      sampleEnd: string
      resetAt: string
    }
  | {
      available: false
      reason: QuotaForecastUnavailableReason
    }

export type SourcePermission =
  'readable' | 'missing' | 'permission-required' | 'auth-required' | 'unknown'
export type SourceStatus = 'healthy' | 'stale' | 'error' | 'unavailable'
export type SourceErrorCode =
  | 'auth-required'
  | 'permission-required'
  | 'network-error'
  | 'invalid-response'
  | 'not-found'
  | 'unknown-error'

export interface PricingCoverage {
  windowStart: string
  windowEnd: string
  totalRequests: number
  pricedRequests: number
  unpricedRequests: number
  providerCostRequests: number
  priceSnapshotRequests: number
  currentEstimateRequests: number
  unpricedCurrencyCount: number
}

export interface SourceHealth {
  sourceId: string
  sourceType: 'provider' | 'codex' | 'cli-log'
  accountRef?: string
  accountAlias?: string
  providerId?: string
  permission: SourcePermission
  status: SourceStatus
  lastAttemptAt?: string
  lastSuccessAt?: string
  dataAgeMs?: number
  errorCode?: SourceErrorCode
  errorMessage?: string
  pricingCoverage?: PricingCoverage
  updatedAt: string
}

export type ActionSeverity = 'critical' | 'warning' | 'info'
export type ActionKind =
  'quota-exhausting' | 'source-unhealthy' | 'unpriced-usage' | 'abnormal-burn' | 'quota-waste'

export interface ActionCenterItem {
  id: string
  rootCauseId: string
  kind: ActionKind
  severity: ActionSeverity
  title: string
  basis: string
  sampleStart: string
  sampleEnd: string
  updatedAt: string
  target: string
}

export interface QuotaPlanningOverview {
  generatedAt: string
  quotaWindows: QuotaWindow[]
  forecasts: Array<{ window: QuotaWindow; forecast: QuotaForecast }>
  sources: SourceHealth[]
  pricingCoverage?: PricingCoverage
  actions: ActionCenterItem[]
}
