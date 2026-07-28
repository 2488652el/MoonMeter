import { createHmac, randomUUID } from 'node:crypto'
import { adaptCodexQuota } from '@shared/utils/quota-adapters'
import { forecastQuota } from '@shared/utils/quota-forecast'
import {
  abnormalBurnAction,
  quotaAction,
  selectActionCenterItems,
  sourceStatusWithFreshness,
  sourceHealthAction,
  unpricedUsageAction
} from '@shared/utils/action-center'
import type {
  ActionCenterItem,
  PricingCoverage,
  QuotaPlanningOverview,
  QuotaSample,
  QuotaWindow,
  SourceErrorCode,
  SourceHealth,
  SourcePermission,
  SourceStatus
} from '@shared/types/quota-planning'
import { fetchCodexUsageWithIdentity, readCodexUsageAccountId } from './codex-usage'
import { getSetting, setSetting } from '../store/settings-store'
import { listKeys } from '../store/keys-repo'
import {
  listSourceHealth,
  deleteSourceHealth,
  recordSourceDiscovered,
  recordSourceFailure,
  recordSourceSuccess,
  recordSourceUnavailable,
  type StoredSourceHealth
} from '../store/source-health-repo'
import {
  listQuotaSamples,
  persistQuotaWindows,
  pruneQuotaSamples,
  type PersistedQuotaSample
} from '../store/quota-repo'
import { listLocalSourceConfigs } from '../store/local-source-repo'
import { discoverAllSessions } from '../log-parsers/sync'
import { CLI_LOG_SOURCES } from '../log-parsers/registry'
import { computeTotalSpend, listUsageProviderIds } from '../store/usage-repo'
import type { LocalSourceConfig } from '@shared/types/local-source'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const ACCOUNT_SALT_SETTING = 'quota_account_ref_salt'
const CODEX_OVERVIEW_TIMEOUT_MS = 20_000
function localAccountRef(accountId: string): string {
  let salt = getSetting<string>(ACCOUNT_SALT_SETTING)
  if (!salt) {
    salt = randomUUID()
    setSetting(ACCOUNT_SALT_SETTING, salt)
  }
  return `codex-${createHmac('sha256', salt).update(accountId).digest('hex').slice(0, 16)}`
}

function resolveCodexAccountRef(stored: readonly StoredSourceHealth[]): string {
  try {
    return localAccountRef(readCodexUsageAccountId())
  } catch {
    return (
      stored.find(
        (source) => source.sourceId === 'codex:chatgpt' && source.accountRef !== 'codex-local'
      )?.accountRef ?? 'codex-local'
    )
  }
}

function persistedToWindow(sample: PersistedQuotaSample): QuotaWindow {
  return {
    sourceId: sample.sourceId,
    accountRef: sample.accountRef,
    windowKey: sample.windowKey,
    windowType: sample.windowType,
    quotaKind: sample.quotaKind,
    unit: sample.unit,
    capturedAt: sample.capturedAt,
    freshUntil: sample.freshUntil,
    confidence: sample.confidence,
    ...(sample.providerId === 'codex' ? { planRef: sample.accountLabel } : {}),
    ...(sample.usedPercent !== undefined ? { usedPercent: sample.usedPercent } : {}),
    ...(sample.used !== undefined ? { used: sample.used } : {}),
    ...(sample.limit !== undefined ? { limit: sample.limit } : {}),
    ...(sample.resetAt !== undefined ? { resetAt: sample.resetAt } : {})
  }
}

function persistedToSample(sample: PersistedQuotaSample): QuotaSample {
  return {
    sourceId: sample.sourceId,
    accountRef: sample.accountRef,
    windowKey: sample.windowKey,
    windowType: sample.windowType,
    quotaKind: sample.quotaKind,
    unit: sample.unit,
    confidence: sample.confidence,
    ...(sample.providerId === 'codex' ? { planRef: sample.accountLabel } : {}),
    capturedAt: sample.capturedAt,
    ...(sample.usedPercent !== undefined ? { usedPercent: sample.usedPercent } : {}),
    ...(sample.used !== undefined ? { used: sample.used } : {}),
    ...(sample.limit !== undefined ? { limit: sample.limit } : {}),
    ...(sample.resetAt !== undefined ? { resetAt: sample.resetAt } : {})
  }
}

function latestWindows(samples: PersistedQuotaSample[]): QuotaWindow[] {
  const latest = new Map<string, PersistedQuotaSample>()
  for (const sample of samples) {
    const key = `${sample.sourceId}\0${sample.accountRef}\0${sample.windowKey}`
    const previous = latest.get(key)
    if (!previous || Date.parse(sample.capturedAt) > Date.parse(previous.capturedAt)) {
      latest.set(key, sample)
    }
  }
  return [...latest.values()].map(persistedToWindow)
}

function mapPermission(value: StoredSourceHealth['permissionStatus']): SourcePermission {
  return value === 'granted'
    ? 'readable'
    : value === 'missing'
      ? 'missing'
      : value === 'auth-required'
        ? 'auth-required'
        : value === 'permission-required'
          ? 'permission-required'
          : 'unknown'
}

function mapStatus(value: StoredSourceHealth['status']): SourceStatus {
  return value === 'ready'
    ? 'healthy'
    : value === 'stale'
      ? 'stale'
      : value === 'error'
        ? 'error'
        : 'unavailable'
}

function mapErrorCode(value: string | undefined): SourceErrorCode | undefined {
  if (!value) return undefined
  if (value === 'auth-required') return 'auth-required'
  if (value === 'permission-required') return 'permission-required'
  if (value === 'offline' || value === 'timeout') return 'network-error'
  if (value === 'format-changed') return 'invalid-response'
  if (value === 'source-missing') return 'not-found'
  return 'unknown-error'
}

function toSourceHealth(
  stored: StoredSourceHealth,
  generatedAt: Date,
  staleAfterMs: number,
  pricingCoverage?: PricingCoverage
): SourceHealth {
  const lastSuccessMs = stored.lastSuccessAt ? Date.parse(stored.lastSuccessAt) : NaN
  const dataAgeMs = Number.isFinite(lastSuccessMs)
    ? Math.max(0, generatedAt.getTime() - lastSuccessMs)
    : undefined
  const errorCode = mapErrorCode(stored.errorCode)
  const status = sourceStatusWithFreshness(
    mapStatus(stored.status),
    stored.lastSuccessAt,
    generatedAt,
    staleAfterMs
  )
  return {
    sourceId: stored.sourceId,
    sourceType:
      stored.sourceKind === 'provider'
        ? 'provider'
        : stored.sourceKind === 'codex'
          ? 'codex'
          : 'cli-log',
    permission: mapPermission(stored.permissionStatus),
    status,
    updatedAt: stored.updatedAt,
    ...(stored.accountRef ? { accountRef: stored.accountRef } : {}),
    ...(stored.displayName ? { accountAlias: stored.displayName } : {}),
    ...(stored.providerId ? { providerId: stored.providerId } : {}),
    ...(stored.lastAttemptAt ? { lastAttemptAt: stored.lastAttemptAt } : {}),
    ...(stored.lastSuccessAt ? { lastSuccessAt: stored.lastSuccessAt } : {}),
    ...(dataAgeMs !== undefined ? { dataAgeMs } : {}),
    ...(errorCode ? { errorCode } : {}),
    ...(stored.errorMessage ? { errorMessage: stored.errorMessage } : {}),
    ...(pricingCoverage ? { pricingCoverage } : {})
  }
}

function localSourceErrorCode(value: LocalSourceConfig['errorCode']): SourceErrorCode | undefined {
  if (!value) return undefined
  if (value === 'permission-denied') return 'permission-required'
  if (
    value === 'path-missing' ||
    value === 'distribution-not-found' ||
    value === 'no-distributions'
  ) {
    return 'not-found'
  }
  if (value === 'timeout') return 'network-error'
  if (value === 'format-changed') return 'invalid-response'
  return 'unknown-error'
}

function toLocalSourceHealth(
  source: LocalSourceConfig,
  generatedAt: Date,
  staleAfterMs: number
): SourceHealth {
  const status: SourceStatus =
    source.status === 'ready'
      ? 'healthy'
      : source.status === 'stale'
        ? 'stale'
        : source.status === 'enabled' || source.status === 'discovered'
          ? 'unavailable'
          : source.status === 'stopped' || source.status === 'unavailable'
            ? 'unavailable'
            : 'error'
  const lastSuccessMs = source.lastSuccessAt ? Date.parse(source.lastSuccessAt) : NaN
  const dataAgeMs = Number.isFinite(lastSuccessMs)
    ? Math.max(0, generatedAt.getTime() - lastSuccessMs)
    : undefined
  const errorCode = localSourceErrorCode(source.errorCode)
  return {
    sourceId: `local:${source.id}`,
    sourceType: 'cli-log',
    accountRef: source.id,
    accountAlias: `${source.cliSource}${source.wslDistribution ? ` · WSL ${source.wslDistribution}` : ' · Windows'}`,
    permission:
      source.errorCode === 'permission-denied'
        ? 'permission-required'
        : source.status === 'ready'
          ? 'readable'
          : source.errorCode === 'path-missing' || source.errorCode === 'distribution-not-found'
            ? 'missing'
            : 'unknown',
    status: sourceStatusWithFreshness(status, source.lastSuccessAt, generatedAt, staleAfterMs),
    updatedAt: source.updatedAt,
    ...(source.lastAttemptAt ? { lastAttemptAt: source.lastAttemptAt } : {}),
    ...(source.lastSuccessAt ? { lastSuccessAt: source.lastSuccessAt } : {}),
    ...(dataAgeMs !== undefined ? { dataAgeMs } : {}),
    ...(errorCode ? { errorCode } : {}),
    ...(source.errorMessage ? { errorMessage: source.errorMessage } : {})
  }
}

function buildPricingCoverage(now: Date): PricingCoverage {
  const windowStart = new Date(now.getTime() - 24 * 60 * 60_000).toISOString()
  const windowEnd = now.toISOString()
  const spend = computeTotalSpend({ fromISO: windowStart, toISO: windowEnd })
  return {
    windowStart,
    windowEnd,
    totalRequests: spend.totalRequests,
    pricedRequests: spend.pricedRequests,
    unpricedRequests: spend.unpricedRequests,
    providerCostRequests: spend.providerCostRequests,
    priceSnapshotRequests: spend.snapshotCostRequests,
    currentEstimateRequests: spend.estimatedRequests,
    unpricedCurrencyCount: spend.unconvertedCurrencies.length
  }
}

function buildProviderPricingCoverage(
  providerId: string,
  coverage: PricingCoverage
): PricingCoverage {
  const spend = computeTotalSpend({
    providerId,
    fromISO: coverage.windowStart,
    toISO: coverage.windowEnd
  })
  return {
    windowStart: coverage.windowStart,
    windowEnd: coverage.windowEnd,
    totalRequests: spend.totalRequests,
    pricedRequests: spend.pricedRequests,
    unpricedRequests: spend.unpricedRequests,
    providerCostRequests: spend.providerCostRequests,
    priceSnapshotRequests: spend.snapshotCostRequests,
    currentEstimateRequests: spend.estimatedRequests,
    unpricedCurrencyCount: spend.unconvertedCurrencies.length
  }
}

function discoverCliSources(now: Date): void {
  try {
    const discovered = discoverAllSessions()
    const stored = new Map(
      listSourceHealth().map((source) => [`${source.sourceId}\0${source.accountRef}`, source])
    )
    for (const source of CLI_LOG_SOURCES) {
      const identity = {
        sourceId: source.healthSourceId,
        accountRef: source.healthSourceId,
        sourceKind: 'cli' as const,
        displayName: source.displayName
      }
      const previous = stored.get(`${source.healthSourceId}\0${source.healthSourceId}`)
      if (discovered[source.discoveryKey].length > 0) {
        if (!previous || previous.status === 'unavailable') recordSourceDiscovered(identity, now)
      } else {
        recordSourceUnavailable(identity, 'missing', now)
      }
    }
  } catch (error) {
    for (const source of CLI_LOG_SOURCES) {
      recordSourceFailure(
        {
          sourceId: source.healthSourceId,
          accountRef: source.healthSourceId,
          sourceKind: 'cli',
          displayName: source.displayName
        },
        error,
        now
      )
    }
  }
}

function ensureConfiguredProviderSources(now: Date): void {
  const stored = new Set(
    listSourceHealth().map((source) => `${source.sourceId}\0${source.accountRef}`)
  )
  for (const key of listKeys()) {
    const identityKey = `provider:${key.providerId}\0${key.id}`
    if (stored.has(identityKey)) continue
    recordSourceUnavailable(
      {
        sourceId: `provider:${key.providerId}`,
        accountRef: key.id,
        sourceKind: 'provider',
        providerId: key.providerId,
        displayName: key.alias
      },
      'missing',
      now
    )
  }
}

function abnormalAction(
  window: QuotaWindow,
  samples: QuotaSample[],
  forecastRate: number
): ActionCenterItem | null {
  const ordered = samples
    .filter(
      (sample) =>
        sample.sourceId === window.sourceId &&
        sample.accountRef === window.accountRef &&
        sample.windowKey === window.windowKey &&
        sample.resetAt === window.resetAt &&
        sample.usedPercent !== undefined
    )
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))
  const previous = ordered.at(-2)
  const current = ordered.at(-1)
  if (
    !previous ||
    !current ||
    previous.usedPercent === undefined ||
    current.usedPercent === undefined
  ) {
    return null
  }
  const hours = (Date.parse(current.capturedAt) - Date.parse(previous.capturedAt)) / 3_600_000
  if (hours <= 0) return null
  const currentRate = (current.usedPercent - previous.usedPercent) / hours
  return abnormalBurnAction(window, currentRate, forecastRate, previous.capturedAt)
}

async function refreshCodexQuota(
  fetchImpl: FetchLike,
  refreshIntervalMs: number,
  fallbackAccountRef: string
): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CODEX_OVERVIEW_TIMEOUT_MS)
  await fetchCodexUsageWithIdentity(fetchImpl, controller.signal)
    .then((codex) => {
      const accountRef = localAccountRef(codex.accountId)
      const windows = adaptCodexQuota(codex.snapshot, {
        sourceId: 'codex:chatgpt',
        accountRef,
        refreshIntervalMs
      })
      persistQuotaWindows(windows, 'codex', codex.snapshot.planType ?? 'ChatGPT')
      deleteSourceHealth('codex:chatgpt', 'codex-local')
      recordSourceSuccess({
        sourceId: 'codex:chatgpt',
        accountRef,
        sourceKind: 'codex',
        providerId: 'codex',
        displayName: codex.snapshot.planType ?? 'ChatGPT'
      })
    })
    .catch((error: unknown) => {
      if (fallbackAccountRef !== 'codex-local') {
        deleteSourceHealth('codex:chatgpt', 'codex-local')
      }
      recordSourceFailure(
        {
          sourceId: 'codex:chatgpt',
          accountRef: fallbackAccountRef,
          sourceKind: 'codex',
          providerId: 'codex',
          displayName: 'ChatGPT / Codex'
        },
        error
      )
    })
    .finally(() => clearTimeout(timer))
}

export async function getQuotaPlanningOverview(
  fetchImpl: FetchLike,
  now = new Date(),
  options: { refresh?: boolean } = {}
): Promise<QuotaPlanningOverview> {
  const refreshIntervalMs = (getSetting<number>('refresh_interval_min') ?? 30) * 60_000
  const storedBeforeRefresh = listSourceHealth()
  const codexAccountRef = resolveCodexAccountRef(storedBeforeRefresh)
  if (options.refresh !== false) {
    if (!storedBeforeRefresh.some((source) => source.sourceKind === 'codex')) {
      recordSourceUnavailable(
        {
          sourceId: 'codex:chatgpt',
          accountRef: codexAccountRef,
          sourceKind: 'codex',
          providerId: 'codex',
          displayName: 'ChatGPT / Codex'
        },
        'missing',
        now
      )
    }
    await refreshCodexQuota(fetchImpl, refreshIntervalMs, codexAccountRef)
    discoverCliSources(now)
  }
  ensureConfiguredProviderSources(now)

  const pricingCoverage = buildPricingCoverage(now)
  pruneQuotaSamples(now)
  const persisted = listQuotaSamples()
  const quotaWindows = latestWindows(persisted)
  const samples = persisted.map(persistedToSample)
  const forecasts = quotaWindows.map((window) => ({
    window,
    forecast: forecastQuota(window, samples, now)
  }))
  const sourceTtlMs = Math.min(Math.max(refreshIntervalMs * 2, 10 * 60_000), 30 * 60_000)
  const sources = [
    ...listSourceHealth().map((source) =>
      toSourceHealth(source, now, sourceTtlMs, pricingCoverage)
    ),
    ...listLocalSourceConfigs().map((source) => toLocalSourceHealth(source, now, sourceTtlMs))
  ]
  const actions: ActionCenterItem[] = []
  for (const item of forecasts) {
    const action = quotaAction(item.window, item.forecast)
    if (action) actions.push(action)
    if (item.forecast.available) {
      const anomaly = abnormalAction(item.window, samples, item.forecast.medianRatePerHour)
      if (anomaly) actions.push(anomaly)
    }
  }
  for (const source of sources) {
    const action = sourceHealthAction(source)
    if (action) actions.push(action)
  }

  if (pricingCoverage.unpricedRequests > 0) {
    const providerCoverage = listUsageProviderIds({
      fromISO: pricingCoverage.windowStart,
      toISO: pricingCoverage.windowEnd
    }).map((providerId) => ({
      providerId,
      coverage: buildProviderPricingCoverage(providerId, pricingCoverage)
    }))
    const topProvider =
      providerCoverage.sort(
        (left, right) => right.coverage.unpricedRequests - left.coverage.unpricedRequests
      )[0] ?? null
    const action = topProvider
      ? unpricedUsageAction(topProvider.providerId, topProvider.coverage)
      : null
    if (action) actions.push(action)
  }

  return {
    generatedAt: now.toISOString(),
    quotaWindows,
    forecasts,
    sources,
    pricingCoverage,
    actions: selectActionCenterItems(actions)
  }
}
