import {
  computeModelSpend,
  computeTotalSpend,
  getDashboardSummary,
  queryUsagePage
} from '../store/usage-repo'
import { getSetting, setSetting } from '../store/settings-store'
import { listPricing } from '../store/pricing-repo'
import {
  withCnyAmounts,
  withCnyDashboardConversion,
  withCnyModelSpendConversion,
  withCnySpendConversion,
  withCnyUsageRecordsConversion
} from './exchange-rate'
import { calcCost } from '@shared/utils/money'
import type { PricingEntry } from '@shared/types/pricing'
import type { UsageAnalysisFilter, UsageRecord } from '@shared/types/usage'
import type {
  LocalPeriodReport,
  LocalReportOverview,
  LocalReportPeriod,
  LocalReportPeriodKind,
  LocalReportRankedItem,
  LocalUsageRecommendation
} from '@shared/types/local-report'

export const LOCAL_REPORT_ENABLED_SETTING_KEY = 'report_local_enabled'
export const LOCAL_RECOMMENDATIONS_ENABLED_SETTING_KEY = 'report_recommendations_enabled'
const REPORT_PAGE_SIZE = 1_000
const TOP_LIMIT = 5

function localStart(year: number, month: number, day: number): Date {
  return new Date(year, month, day, 0, 0, 0, 0)
}

function formatDate(value: Date): string {
  return value.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

export function resolveLocalReportPeriod(
  kind: LocalReportPeriodKind,
  now = new Date()
): LocalReportPeriod {
  const todayStart = localStart(now.getFullYear(), now.getMonth(), now.getDate())
  const startsAt =
    kind === 'month'
      ? localStart(now.getFullYear(), now.getMonth(), 1)
      : new Date(todayStart.getTime() - ((todayStart.getDay() + 6) % 7) * 86_400_000)
  return {
    startsAt: startsAt.toISOString(),
    endsAt: now.toISOString(),
    label:
      kind === 'month'
        ? `${startsAt.getFullYear()} 年 ${startsAt.getMonth() + 1} 月至今`
        : `本周至今（${formatDate(startsAt)} 起）`
  }
}

/**
 * Compare the current partial billing period with the same elapsed duration
 * immediately before it, avoiding a misleading month-to-date vs full-month comparison.
 */
export function resolveComparableReportPeriod(current: LocalReportPeriod): LocalReportPeriod {
  const startsAt = new Date(current.startsAt)
  const endsAt = new Date(current.endsAt)
  const elapsed = Math.max(0, endsAt.getTime() - startsAt.getTime())
  const comparisonEnd = new Date(startsAt.getTime())
  const comparisonStart = new Date(comparisonEnd.getTime() - elapsed)
  return {
    startsAt: comparisonStart.toISOString(),
    endsAt: comparisonEnd.toISOString(),
    label: `对比区间（${formatDate(comparisonStart)} 至 ${formatDate(new Date(comparisonEnd.getTime() - 1))}）`
  }
}

function filterFor(period: LocalReportPeriod): UsageAnalysisFilter {
  return { fromISO: period.startsAt, toISO: period.endsAt }
}

function displayLabel(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  const lastSegment = value.split(/[\\/]/).filter(Boolean).at(-1) ?? value
  const safe = [...lastSegment]
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code >= 32 && code !== 127
    })
    .join('')
    .trim()
  return safe ? safe.slice(0, 80) : fallback
}

function rankedItems(
  rows: UsageRecord[],
  labelFor: (row: UsageRecord) => string,
  keyFor: (row: UsageRecord) => string
): LocalReportRankedItem[] {
  const grouped = new Map<string, LocalReportRankedItem>()
  for (const row of rows) {
    const key = keyFor(row)
    const current = grouped.get(key) ?? {
      label: labelFor(row),
      amountCny: 0,
      requests: 0,
      tokens: 0
    }
    current.amountCny += row.costCny ?? 0
    current.requests += 1
    current.tokens += row.totalTokens ?? (row.promptTokens ?? 0) + (row.completionTokens ?? 0)
    grouped.set(key, current)
  }
  return [...grouped.values()]
    .sort(
      (a, b) => b.amountCny - a.amountCny || b.tokens - a.tokens || a.label.localeCompare(b.label)
    )
    .slice(0, TOP_LIMIT)
}

async function allUsageRows(filter: UsageAnalysisFilter): Promise<UsageRecord[]> {
  const first = queryUsagePage({ ...filter, limit: REPORT_PAGE_SIZE, offset: 0 })
  const rows = [...first.rows]
  for (let offset = first.rows.length; offset < first.total; offset += REPORT_PAGE_SIZE) {
    rows.push(...queryUsagePage({ ...filter, limit: REPORT_PAGE_SIZE, offset }).rows)
  }
  return withCnyUsageRecordsConversion(rows)
}

export function localReportsEnabled(): boolean {
  return getSetting<boolean>(LOCAL_REPORT_ENABLED_SETTING_KEY) !== false
}

export function setLocalReportsEnabled(enabled: boolean): void {
  setSetting(LOCAL_REPORT_ENABLED_SETTING_KEY, enabled)
}

export function localRecommendationsEnabled(): boolean {
  return getSetting<boolean>(LOCAL_RECOMMENDATIONS_ENABLED_SETTING_KEY) !== false
}

export function setLocalRecommendationsEnabled(enabled: boolean): void {
  setSetting(LOCAL_RECOMMENDATIONS_ENABLED_SETTING_KEY, enabled)
}

interface RecommendationCandidate {
  providerKey: string
  providerLabel: string
  amountCny: number
}

function pricingKey(entry: Pick<PricingEntry, 'providerId' | 'billingScope'>): string {
  return `${entry.providerId}:${entry.billingScope ?? 'default'}`
}

function pricingLabel(entry: Pick<PricingEntry, 'providerId' | 'billingScope'>): string {
  return entry.billingScope && entry.billingScope !== 'default'
    ? `${entry.providerId} (${entry.billingScope})`
    : entry.providerId
}

function activeExactModelPrices(model: string): PricingEntry[] {
  const normalizedModel = model.trim().toLowerCase()
  const selected = new Map<string, PricingEntry>()
  for (const entry of listPricing()) {
    if (entry.catalogActive === false || entry.model.trim().toLowerCase() !== normalizedModel)
      continue
    const key = `${pricingKey(entry)}:${entry.currency}`
    const previous = selected.get(key)
    if (
      !previous ||
      (entry.source === 'user' && previous.source !== 'user') ||
      (entry.updatedAt ?? '') > (previous.updatedAt ?? '')
    ) {
      selected.set(key, entry)
    }
  }
  return [...selected.values()]
}

async function candidateCosts(
  rows: UsageRecord[],
  entries: PricingEntry[]
): Promise<RecommendationCandidate[]> {
  const inputTokens = rows.reduce((sum, row) => sum + (row.promptTokens ?? 0), 0)
  const outputTokens = rows.reduce((sum, row) => sum + (row.completionTokens ?? 0), 0)
  const cacheReadTokens = rows.reduce((sum, row) => sum + (row.cacheReadTokens ?? 0), 0)
  const cacheCreationTokens = rows.reduce((sum, row) => sum + (row.cacheCreationTokens ?? 0), 0)
  const raw = entries.map((entry) => ({
    entry,
    amount: calcCost(
      inputTokens,
      outputTokens,
      entry.promptPricePerMtok,
      entry.completionPricePerMtok,
      cacheReadTokens,
      cacheCreationTokens,
      entry.cacheReadPricePerMtok,
      entry.cacheCreationPricePerMtok
    )
  }))
  const conversions = await Promise.all(
    raw.map(async ({ entry, amount }) => ({
      entry,
      conversion: await withCnyAmounts([{ currency: entry.currency, amount }])
    }))
  )
  return conversions
    .filter(({ conversion }) => conversion.unconvertedCurrencies.length === 0)
    .map(({ entry, conversion }) => ({
      providerKey: pricingKey(entry),
      providerLabel: pricingLabel(entry),
      amountCny: conversion.cnyTotal
    }))
}

async function buildRecommendations(rows: UsageRecord[]): Promise<{
  recommendations: LocalUsageRecommendation[]
  unavailableReason?: string
}> {
  const byModel = new Map<string, UsageRecord[]>()
  for (const row of rows) {
    if (!row.model.trim()) continue
    const model = row.model.trim().toLowerCase()
    const modelRows = byModel.get(model) ?? []
    modelRows.push(row)
    byModel.set(model, modelRows)
  }
  const recommendations: LocalUsageRecommendation[] = []
  for (const modelRows of byModel.values()) {
    const model = modelRows[0]?.model ?? ''
    const entries = activeExactModelPrices(model)
    const usedProviderKeys = new Set(
      modelRows.map((row) => `${row.providerId}:${row.billingScope ?? 'default'}`)
    )
    if (entries.length < 2 || usedProviderKeys.size === 0) continue
    const candidates = await candidateCosts(modelRows, entries)
    const current = candidates
      .filter((candidate) => usedProviderKeys.has(candidate.providerKey))
      .sort((a, b) => a.amountCny - b.amountCny)[0]
    const alternative = candidates
      .filter((candidate) => !usedProviderKeys.has(candidate.providerKey))
      .sort((a, b) => a.amountCny - b.amountCny)[0]
    if (!current || !alternative || alternative.amountCny >= current.amountCny) continue
    const savingsCny = current.amountCny - alternative.amountCny
    recommendations.push({
      model: displayLabel(model, '未标注模型'),
      currentProviders: [...usedProviderKeys].map((key) => key.replace(/:default$/, '')),
      candidateProvider: alternative.providerLabel,
      requestCount: modelRows.length,
      estimatedCurrentCny: current.amountCny,
      estimatedCandidateCny: alternative.amountCny,
      savingsCny,
      savingsPercent: current.amountCny > 0 ? (savingsCny / current.amountCny) * 100 : 0,
      reason: `精确同一模型；按本周期 ${modelRows.length} 条请求的实际 token 结构，使用当前已配置价格试算。不会自动切换。`
    })
  }
  const sorted = recommendations
    .sort((a, b) => b.savingsCny - a.savingsCny || a.model.localeCompare(b.model))
    .slice(0, TOP_LIMIT)
  return sorted.length
    ? { recommendations: sorted }
    : {
        recommendations: [],
        unavailableReason:
          '没有发现与当前模型精确一致、且可比较的备用 Provider 定价；未按模型名称推断任务族或能力。'
      }
}

export async function getLocalReportOverview(
  kind: LocalReportPeriodKind,
  now = new Date()
): Promise<LocalReportOverview> {
  const recommendationsEnabled = localRecommendationsEnabled()
  if (!localReportsEnabled()) return { enabled: false, recommendationsEnabled }

  const period = resolveLocalReportPeriod(kind, now)
  const comparisonPeriod = resolveComparableReportPeriod(period)
  const filter = filterFor(period)
  const comparisonFilter = filterFor(comparisonPeriod)
  const [spend, comparisonSpend, dashboard, models, rows] = await Promise.all([
    withCnySpendConversion(computeTotalSpend(filter)),
    withCnySpendConversion(computeTotalSpend(comparisonFilter)),
    withCnyDashboardConversion(getDashboardSummary(filter)),
    withCnyModelSpendConversion(computeModelSpend(filter)),
    allUsageRows(filter)
  ])
  const changeCny = spend.cnyTotal - comparisonSpend.cnyTotal
  const providers = dashboard.providers.slice(0, TOP_LIMIT).map((row) => ({
    label: displayLabel(row.providerId, '未标注 Provider'),
    amountCny: row.cost,
    requests: 0,
    tokens: row.tokens
  }))
  const recommendationResult = recommendationsEnabled
    ? await buildRecommendations(rows)
    : { recommendations: [] }
  const report: LocalPeriodReport = {
    kind,
    generatedAt: now.toISOString(),
    period,
    comparisonPeriod,
    totalCny: spend.cnyTotal,
    comparisonTotalCny: comparisonSpend.cnyTotal,
    changeCny,
    ...(comparisonSpend.cnyTotal > 0
      ? { changePercent: (changeCny / comparisonSpend.cnyTotal) * 100 }
      : {}),
    totalRequests: spend.totalRequests,
    comparisonRequests: comparisonSpend.totalRequests,
    providers,
    models: models.slice(0, TOP_LIMIT).map((row) => ({
      label: displayLabel(row.model, '未标注模型'),
      amountCny: row.total,
      requests: row.requests,
      tokens: row.tokens
    })),
    projects: rankedItems(
      rows,
      (row) => displayLabel(row.agentLabel, '未标注项目'),
      (row) => displayLabel(row.agentLabel, '未标注项目')
    ),
    highCostSessions: rankedItems(
      rows,
      (row) =>
        `${displayLabel(row.agentLabel, '本地会话')} · ${displayLabel(row.model, '未标注模型')}`,
      (row) => row.sessionId ?? `${row.id ?? ''}:${row.capturedAt}:${row.model}`
    ),
    recommendationsEnabled,
    recommendations: recommendationResult.recommendations,
    ...(recommendationResult.unavailableReason
      ? { recommendationsUnavailableReason: recommendationResult.unavailableReason }
      : {}),
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
  return { enabled: true, recommendationsEnabled, report }
}
