import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsageRecord } from '../../../code/src/shared/types/usage'
import type { PricingEntry } from '../../../code/src/shared/types/pricing'

const state = vi.hoisted(() => ({
  enabled: true,
  recommendationsEnabled: true,
  settings: new Map<string, unknown>(),
  rows: [] as UsageRecord[],
  prices: [] as PricingEntry[]
}))

vi.mock('../../../code/src/main/store/settings-store', () => ({
  getSetting: vi.fn((key: string) => {
    if (key === 'report_local_enabled') return state.enabled ? null : false
    if (key === 'report_recommendations_enabled') return state.recommendationsEnabled ? null : false
    return null
  }),
  setSetting: vi.fn((key: string, value: unknown) => state.settings.set(key, value))
}))
vi.mock('../../../code/src/main/store/pricing-repo', () => ({
  listPricing: vi.fn(() => state.prices)
}))
vi.mock('../../../code/src/main/store/usage-repo', () => ({
  computeTotalSpend: vi.fn((filter) => ({
    total: 0,
    currency: 'CNY',
    byCurrency: [],
    cnyTotal: filter.fromISO === '2026-06-11T00:00:00.000Z' ? 8 : 12,
    convertedByCurrency: [],
    exchangeRateSource: 'fallback',
    unconvertedCurrencies: [],
    pricedRequests: 2,
    providerCostRequests: 1,
    snapshotCostRequests: 0,
    estimatedRequests: 1,
    unpricedRequests: 1,
    totalRequests: 3
  })),
  getDashboardSummary: vi.fn(() => ({
    totalCost: 12,
    currency: 'CNY',
    byCurrency: [{ currency: 'CNY', amount: 12 }],
    totalInputTokens: 10,
    totalOutputTokens: 20,
    totalCacheReadTokens: 0,
    totalRequests: 3,
    providers: [
      {
        providerId: 'codex',
        cost: 12,
        byCurrency: [{ currency: 'CNY', amount: 12 }],
        tokens: 30,
        pct: 1
      }
    ],
    daily: []
  })),
  computeModelSpend: vi.fn(() => [
    {
      model: 'gpt-5',
      providers: ['codex'],
      total: 12,
      currency: 'CNY',
      byCurrency: [{ currency: 'CNY', amount: 12 }],
      tokens: 30,
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      requests: 3,
      pricedRequests: 2,
      unpricedRequests: 1
    }
  ]),
  queryUsagePage: vi.fn(() => ({
    rows: state.rows,
    total: state.rows.length,
    limit: 1000,
    offset: 0
  }))
}))
vi.mock('../../../code/src/main/services/exchange-rate', () => ({
  withCnySpendConversion: vi.fn(async (value) => value),
  withCnyDashboardConversion: vi.fn(async (value) => value),
  withCnyModelSpendConversion: vi.fn(async (value) => value),
  withCnyUsageRecordsConversion: vi.fn(async (value) => value),
  withCnyAmounts: vi.fn(async (value) => ({
    cnyTotal: value[0].amount,
    convertedByCurrency: [],
    exchangeRateSource: 'fallback',
    unconvertedCurrencies: []
  }))
}))

import {
  getLocalReportOverview,
  resolveComparableReportPeriod,
  resolveLocalReportPeriod,
  setLocalRecommendationsEnabled,
  setLocalReportsEnabled
} from '../../../code/src/main/services/local-report'
import { computeTotalSpend } from '../../../code/src/main/store/usage-repo'

beforeEach(() => {
  vi.clearAllMocks()
  state.enabled = true
  state.recommendationsEnabled = true
  state.settings.clear()
  state.rows = [
    {
      id: 1,
      providerId: 'codex',
      model: 'gpt-5',
      source: 'session-log',
      sessionId: 'private-session-id',
      agentLabel: 'D:\\开发\\tokengirl',
      capturedAt: '2026-07-20T09:00:00.000Z',
      totalTokens: 30,
      promptTokens: 1_000_000,
      costCny: 12
    }
  ]
  state.prices = [
    {
      providerId: 'codex',
      model: 'gpt-5',
      promptPricePerMtok: 10,
      completionPricePerMtok: 10,
      currency: 'CNY',
      source: 'user'
    },
    {
      providerId: 'lower-cost-provider',
      model: 'gpt-5',
      promptPricePerMtok: 5,
      completionPricePerMtok: 5,
      currency: 'CNY',
      source: 'user'
    }
  ]
})

describe('local report planning', () => {
  it('compares month-to-date with the same elapsed prior duration', () => {
    const current = resolveLocalReportPeriod('month', new Date('2026-07-20T08:00:00.000Z'))
    const comparison = resolveComparableReportPeriod(current)
    expect(current.startsAt).toBe('2026-06-30T16:00:00.000Z')
    expect(comparison.startsAt).toBe('2026-06-11T00:00:00.000Z')
    expect(comparison.endsAt).toBe(current.startsAt)
  })

  it('uses exact report periods and only returns sanitized display labels', async () => {
    const overview = await getLocalReportOverview('month', new Date('2026-07-20T08:00:00.000Z'))
    expect(computeTotalSpend).toHaveBeenCalledWith({
      fromISO: '2026-06-30T16:00:00.000Z',
      toISO: '2026-07-20T08:00:00.000Z'
    })
    expect(overview.report).toMatchObject({ totalCny: 12, comparisonTotalCny: 8, changeCny: 4 })
    expect(overview.report?.projects).toEqual([
      expect.objectContaining({ label: 'tokengirl', amountCny: 12 })
    ])
    expect(overview.report?.highCostSessions[0]?.label).toBe('tokengirl · gpt-5')
    expect(overview.report?.recommendations).toEqual([
      expect.objectContaining({
        model: 'gpt-5',
        candidateProvider: 'lower-cost-provider',
        estimatedCurrentCny: 10,
        estimatedCandidateCny: 5,
        savingsCny: 5
      })
    ])
    expect(JSON.stringify(overview)).not.toContain('private-session-id')
    expect(JSON.stringify(overview)).not.toContain('D:\\开发')
  })

  it('does not compute a disabled report and persists the local preference', async () => {
    state.enabled = false
    await expect(getLocalReportOverview('week')).resolves.toEqual({
      enabled: false,
      recommendationsEnabled: true
    })
    expect(computeTotalSpend).not.toHaveBeenCalled()
    setLocalReportsEnabled(false)
    expect(state.settings.get('report_local_enabled')).toBe(false)
    setLocalRecommendationsEnabled(false)
    expect(state.settings.get('report_recommendations_enabled')).toBe(false)
  })

  it('fails closed when exact-model pricing comparison is disabled', async () => {
    state.recommendationsEnabled = false
    const overview = await getLocalReportOverview('week')
    expect(overview.recommendationsEnabled).toBe(false)
    expect(overview.report?.recommendations).toEqual([])
    expect(overview.report?.recommendationsUnavailableReason).toBeUndefined()
  })
})
