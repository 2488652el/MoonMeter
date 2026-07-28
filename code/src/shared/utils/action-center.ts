import type {
  ActionCenterItem,
  PricingCoverage,
  QuotaForecast,
  QuotaWindow,
  SourceHealth
} from '../types/quota-planning'

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 } as const

export function sourceStatusWithFreshness(
  status: SourceHealth['status'],
  lastSuccessAt: string | undefined,
  generatedAt: Date,
  staleAfterMs: number
): SourceHealth['status'] {
  if (status !== 'healthy' || !lastSuccessAt) return status
  const ageMs = generatedAt.getTime() - Date.parse(lastSuccessAt)
  return Number.isFinite(ageMs) && ageMs > staleAfterMs ? 'stale' : status
}

export function selectActionCenterItems(
  candidates: readonly ActionCenterItem[],
  limit = 3
): ActionCenterItem[] {
  const deduplicated = new Map<string, ActionCenterItem>()
  for (const candidate of candidates) {
    if (!isInternalTarget(candidate.target)) continue
    const existing = deduplicated.get(candidate.rootCauseId)
    if (!existing || compareActions(candidate, existing) < 0) {
      deduplicated.set(candidate.rootCauseId, candidate)
    }
  }
  return [...deduplicated.values()].sort(compareActions).slice(0, Math.max(0, Math.min(3, limit)))
}

export function quotaAction(window: QuotaWindow, forecast: QuotaForecast): ActionCenterItem | null {
  if (!forecast.available || forecast.category === 'sustainable') return null
  const exhausting = forecast.category === 'exhausts-early'
  return {
    id: stableId(
      exhausting ? 'quota-exhausting' : 'quota-waste',
      window.sourceId,
      window.accountRef,
      window.windowKey
    ),
    rootCauseId: `quota:${window.sourceId}:${window.accountRef}:${window.windowKey}`,
    kind: exhausting ? 'quota-exhausting' : 'quota-waste',
    severity: exhausting ? 'critical' : 'info',
    title: exhausting ? '额度可能在重置前耗尽' : '额度可能未充分使用',
    basis: `按 ${forecast.sampleCount} 个样本，当前速率 ${format1(forecast.medianRatePerHour)}%/小时，预计重置时使用 ${format1(forecast.projectedUsedAtReset)}%`,
    sampleStart: forecast.sampleStart,
    sampleEnd: forecast.sampleEnd,
    updatedAt: window.capturedAt,
    target: quotaSourceTarget(window.sourceId, window.accountRef)
  }
}

export function abnormalBurnAction(
  window: QuotaWindow,
  currentRatePerHour: number,
  historicalMedianRatePerHour: number,
  sampleStart: string
): ActionCenterItem | null {
  if (
    !Number.isFinite(currentRatePerHour) ||
    !Number.isFinite(historicalMedianRatePerHour) ||
    currentRatePerHour < 5 ||
    currentRatePerHour <= historicalMedianRatePerHour * 3
  ) {
    return null
  }
  return {
    id: stableId('abnormal-burn', window.sourceId, window.accountRef, window.windowKey),
    rootCauseId: `quota:${window.sourceId}:${window.accountRef}:${window.windowKey}`,
    kind: 'abnormal-burn',
    severity: 'critical',
    title: '额度消耗速度异常',
    basis: `当前 ${format1(currentRatePerHour)}%/小时，超过序列中位速率 ${format1(historicalMedianRatePerHour)}%/小时的 3 倍`,
    sampleStart,
    sampleEnd: window.capturedAt,
    updatedAt: window.capturedAt,
    target: quotaSourceTarget(window.sourceId, window.accountRef)
  }
}

export function sourceHealthAction(source: SourceHealth): ActionCenterItem | null {
  if (source.status === 'healthy') return null
  const providerName = source.providerId ?? providerFromSourceId(source.sourceId)
  const sourceName = source.accountAlias ? `${providerName} · ${source.accountAlias}` : providerName
  const target = `/sources?focus=source&source=${encodeURIComponent(source.sourceId)}${
    source.accountRef ? `&account=${encodeURIComponent(source.accountRef)}` : ''
  }`
  return {
    id: stableId('source-unhealthy', source.sourceId, source.errorCode ?? source.status),
    rootCauseId: `source:${source.sourceId}`,
    kind: 'source-unhealthy',
    severity: source.status === 'error' ? 'warning' : 'info',
    title: source.status === 'stale' ? `${sourceName} 数据已过期` : `${sourceName} 需要处理`,
    basis: source.errorMessage ?? source.errorCode ?? source.status,
    sampleStart: source.lastAttemptAt ?? source.updatedAt,
    sampleEnd: source.updatedAt,
    updatedAt: source.updatedAt,
    target
  }
}

export function unpricedUsageAction(
  providerId: string,
  coverage: PricingCoverage
): ActionCenterItem | null {
  if (coverage.unpricedRequests <= 0) return null
  return {
    id: stableId('unpriced-usage', providerId, coverage.windowStart, coverage.windowEnd),
    rootCauseId: `pricing:${providerId}`,
    kind: 'unpriced-usage',
    severity: 'warning',
    title: '存在未计价请求',
    basis: `${coverage.windowStart} 至 ${coverage.windowEnd} 共 ${coverage.unpricedRequests}/${coverage.totalRequests} 条请求未计价`,
    sampleStart: coverage.windowStart,
    sampleEnd: coverage.windowEnd,
    updatedAt: coverage.windowEnd,
    target: `/pricing?provider=${encodeURIComponent(providerId)}`
  }
}

export function isInternalTarget(target: string): boolean {
  return /^\/(?:(?:providers|apikeys|logs|agents|pricing|sources))?(?:\?|$)/.test(target)
}

function compareActions(left: ActionCenterItem, right: ActionCenterItem): number {
  return (
    SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
    left.id.localeCompare(right.id)
  )
}

function stableId(...parts: string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join(':')
}

function format1(value: number): string {
  return value.toFixed(1)
}

export function providerFromSourceId(sourceId: string): string {
  if (sourceId.startsWith('provider:')) return sourceId.slice('provider:'.length)
  if (sourceId.startsWith('codex:')) return 'codex'
  if (sourceId === 'cli:claude-code') return 'claude-code'
  if (sourceId === 'cli:codex') return 'codex'
  if (sourceId === 'cli:kimi-code') return 'kimi-coding'
  return sourceId
}

export function quotaSourceTarget(sourceId: string, accountRef: string): string {
  const account = encodeURIComponent(accountRef)
  return sourceId.startsWith('codex:')
    ? `/?focus=quota&account=${account}`
    : `/apikeys?provider=${encodeURIComponent(providerFromSourceId(sourceId))}&account=${account}`
}
