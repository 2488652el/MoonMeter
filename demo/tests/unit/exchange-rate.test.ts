/** 人民币汇率查询的缓存、实时结果与离线回退测试。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearExchangeRateCache,
  getCnyRateQuote,
  withCnyAmounts,
  withCnyDashboardConversion,
  withCnyModelSpendConversion,
  withCnySpendConversion,
  withCnyUsageRecordsConversion
} from '../../../code/src/main/services/exchange-rate'
import { DEFAULT_CNY_RATES } from '../../../code/src/shared/utils/money'

const realFetch = globalThis.fetch

beforeEach(() => clearExchangeRateCache())
afterEach(() => {
  globalThis.fetch = realFetch
  clearExchangeRateCache()
})

describe('getCnyRateQuote', () => {
  it('returns and caches a live USD/CNY quote', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 200, rate: '7.2', uptime: '2026-07-15 12:00:00' }), {
          status: 200
        })
    ) as typeof fetch

    await expect(getCnyRateQuote('usd')).resolves.toEqual({
      currency: 'USD',
      rateToCny: 7.2,
      source: 'api',
      updatedAt: '2026-07-15 12:00:00'
    })
    await getCnyRateQuote('USD')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('falls back when the exchange API is unavailable', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('offline')
    }) as typeof fetch
    await expect(getCnyRateQuote('USD')).resolves.toEqual({
      currency: 'USD',
      rateToCny: DEFAULT_CNY_RATES.USD,
      source: 'fallback'
    })
  })

  it('returns identity for CNY without a network request', async () => {
    globalThis.fetch = vi.fn()
    await expect(getCnyRateQuote('CNY')).resolves.toEqual({
      currency: 'CNY',
      rateToCny: 1,
      source: 'fallback'
    })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('uses one exchange-rate context across dashboard, model, spend, and log amounts', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ code: 200, rate: '7.2' }), { status: 200 })
    ) as typeof fetch
    const byCurrency = [
      { currency: 'USD', amount: 1 },
      { currency: 'CNY', amount: 2 }
    ]

    const [spend, dashboard, models, logs, amounts] = await Promise.all([
      withCnySpendConversion({
        total: 2,
        currency: 'CNY',
        byCurrency,
        cnyTotal: 0,
        convertedByCurrency: [],
        exchangeRateSource: 'none',
        unconvertedCurrencies: [],
        pricedRequests: 2,
        providerCostRequests: 1,
        snapshotCostRequests: 1,
        estimatedRequests: 0,
        unpricedRequests: 0,
        totalRequests: 2
      }),
      withCnyDashboardConversion({
        totalCost: 2,
        currency: 'CNY',
        byCurrency,
        totalInputTokens: 2,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalRequests: 2,
        providers: [{ providerId: 'mixed', cost: 2, byCurrency, tokens: 2, pct: 1 }],
        daily: [{ date: '2026-07-25', cost: 2, byCurrency, tokens: 2 }]
      }),
      withCnyModelSpendConversion([
        {
          model: 'mixed-model',
          providers: ['mixed'],
          total: 2,
          currency: 'CNY',
          byCurrency,
          tokens: 2,
          inputTokens: 2,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          requests: 2,
          pricedRequests: 2,
          unpricedRequests: 0
        }
      ]),
      withCnyUsageRecordsConversion([
        {
          providerId: 'mixed',
          model: 'mixed-model',
          cost: 1,
          currency: 'USD',
          source: 'vendor-api',
          capturedAt: '2026-07-25T00:00:00.000Z'
        }
      ]),
      withCnyAmounts(byCurrency)
    ])

    expect(spend.cnyTotal).toBe(9.2)
    expect(dashboard.totalCost).toBe(9.2)
    expect(dashboard.providers[0]?.cost).toBe(9.2)
    expect(dashboard.daily[0]?.cost).toBe(9.2)
    expect(models[0]?.total).toBe(9.2)
    expect(logs[0]?.costCny).toBe(7.2)
    expect(amounts.cnyTotal).toBe(9.2)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })
})
