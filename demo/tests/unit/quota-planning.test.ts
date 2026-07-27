import { describe, expect, it } from 'vitest'
import type { QuotaSample, QuotaWindow } from '../../../code/src/shared/types/quota-planning'
import {
  adaptCodexQuota,
  adaptKimiQuota,
  adaptMiniMaxQuota,
  quotaFreshUntil
} from '../../../code/src/shared/utils/quota-adapters'
import { forecastQuota } from '../../../code/src/shared/utils/quota-forecast'

const current: QuotaWindow = {
  sourceId: 'codex',
  accountRef: 'acct-hash',
  windowKey: '5h',
  windowType: 'rolling',
  quotaKind: 'hard-quota',
  unit: 'percent',
  capturedAt: '2026-07-25T03:00:00.000Z',
  freshUntil: '2026-07-25T03:30:00.000Z',
  confidence: 'measured',
  usedPercent: 30,
  resetAt: '2026-07-25T08:00:00.000Z'
}

function samples(values: Array<[string, number]>, resetAt = current.resetAt): QuotaSample[] {
  return values.map(([capturedAt, usedPercent]) => ({
    sourceId: current.sourceId,
    accountRef: current.accountRef,
    windowKey: current.windowKey,
    windowType: current.windowType,
    quotaKind: current.quotaKind,
    unit: current.unit,
    confidence: current.confidence,
    capturedAt,
    ...(resetAt ? { resetAt } : {}),
    usedPercent
  }))
}

describe('quota adapters', () => {
  const context = {
    sourceId: 'provider',
    accountRef: 'uuid',
    capturedAt: '2026-07-25T00:00:00.000Z',
    refreshIntervalMs: 60_000
  }

  it('uses bounded dynamic TTL and 24-hour balance TTL', () => {
    expect(quotaFreshUntil(context.capturedAt, 60_000)).toBe('2026-07-25T00:10:00.000Z')
    expect(quotaFreshUntil(context.capturedAt, 60 * 60_000)).toBe('2026-07-25T00:30:00.000Z')
    expect(quotaFreshUntil(context.capturedAt, 1, 'balance')).toBe('2026-07-26T00:00:00.000Z')
  })

  it('normalizes Codex, Kimi and MiniMax to one contract', () => {
    const codex = adaptCodexQuota(
      {
        fetchedAt: context.capturedAt,
        planType: 'pro',
        fiveHour: {
          usedPercent: 25,
          remainingPercent: 75,
          windowSeconds: 18_000,
          resetAt: '2026-07-25T05:00:00.000Z'
        },
        oneWeek: null
      },
      context
    )
    const kimi = adaptKimiQuota(
      { usage: { limit: 100, used: 25, reset_at: '2026-08-01T00:00:00.000Z' } },
      context
    )
    const minimax = adaptMiniMaxQuota(
      { model_remains: [{ model_name: 'general', current_weekly_remaining_percent: 75 }] },
      context
    )
    for (const window of [codex[0], kimi[0], minimax[0]]) {
      expect(window).toMatchObject({
        sourceId: 'provider',
        accountRef: 'uuid',
        unit: 'percent',
        usedPercent: 25,
        confidence: 'measured'
      })
    }
  })

  it('fails closed for invalid percentages and timestamps', () => {
    expect(
      adaptCodexQuota(
        {
          fetchedAt: 'invalid',
          planType: null,
          fiveHour: {
            usedPercent: 10,
            remainingPercent: 90,
            windowSeconds: 1,
            resetAt: null
          },
          oneWeek: null
        },
        context
      )
    ).toEqual([])
  })
})

describe('quota forecast', () => {
  it('is stable against one rate outlier and classifies the projection', () => {
    const result = forecastQuota(
      current,
      samples([
        ['2026-07-25T00:00:00.000Z', 0],
        ['2026-07-25T01:00:00.000Z', 10],
        ['2026-07-25T02:00:00.000Z', 20],
        ['2026-07-25T02:06:00.000Z', 29],
        ['2026-07-25T03:00:00.000Z', 30]
      ]),
      new Date('2026-07-25T03:00:00.000Z')
    )
    expect(result).toMatchObject({
      available: true,
      category: 'sustainable',
      medianRatePerHour: 10,
      projectedUsedAtReset: 80
    })
  })

  it('deduplicates timestamps and derives percentages only with a valid limit', () => {
    const absolute = samples([
      ['2026-07-25T00:00:00.000Z', 0],
      ['2026-07-25T01:00:00.000Z', 10],
      ['2026-07-25T01:00:00.000Z', 20]
    ])
    const base = absolute[0]!
    absolute.push({
      ...base,
      capturedAt: '2026-07-25T02:00:00.000Z',
      used: 30,
      limit: 100
    })
    delete absolute[3]!.usedPercent
    const result = forecastQuota(current, absolute, new Date(current.capturedAt))
    expect(result.available && result.sampleCount).toBe(3)

    absolute[3] = { ...absolute[3]!, limit: 0 }
    expect(forecastQuota(current, absolute, new Date(current.capturedAt))).toEqual({
      available: false,
      reason: 'insufficient-samples'
    })
  })

  it('fails closed after reset and when quota semantics change', () => {
    const fixture = samples([
      ['2026-07-25T00:00:00.000Z', 0],
      ['2026-07-25T01:00:00.000Z', 10],
      ['2026-07-25T02:00:00.000Z', 20]
    ])
    expect(
      forecastQuota(
        { ...current, freshUntil: '2026-07-25T09:00:00.000Z' },
        fixture,
        new Date('2026-07-25T08:00:00.000Z')
      )
    ).toEqual({ available: false, reason: 'window-changed' })

    const incompatible = fixture.map((sample) => ({
      ...sample,
      quotaKind: 'local-estimate' as const
    }))
    expect(forecastQuota(current, incompatible, new Date(current.capturedAt))).toEqual({
      available: false,
      reason: 'insufficient-samples'
    })
  })

  it.each([
    [
      'too few samples',
      samples([['2026-07-25T00:00:00.000Z', 0]]),
      current,
      'insufficient-samples'
    ],
    [
      'stale data',
      samples([
        ['2026-07-25T00:00:00.000Z', 0],
        ['2026-07-25T01:00:00.000Z', 1],
        ['2026-07-25T02:00:00.000Z', 2]
      ]),
      { ...current, freshUntil: '2026-07-25T02:59:59.000Z' },
      'stale-data'
    ],
    [
      'missing reset',
      samples([
        ['2026-07-25T00:00:00.000Z', 0],
        ['2026-07-25T01:00:00.000Z', 1],
        ['2026-07-25T02:00:00.000Z', 2]
      ]),
      { ...current, resetAt: undefined },
      'missing-reset'
    ],
    [
      'changed cycle',
      samples(
        [
          ['2026-07-25T00:00:00.000Z', 0],
          ['2026-07-25T01:00:00.000Z', 1],
          ['2026-07-25T02:00:00.000Z', 2]
        ],
        '2026-07-26T08:00:00.000Z'
      ),
      current,
      'window-changed'
    ],
    [
      'negative consumption',
      samples([
        ['2026-07-25T00:00:00.000Z', 20],
        ['2026-07-25T01:00:00.000Z', 10],
        ['2026-07-25T02:00:00.000Z', 5]
      ]),
      current,
      'invalid-data'
    ],
    [
      'out of bounds',
      samples([
        ['2026-07-25T00:00:00.000Z', 0],
        ['2026-07-25T01:00:00.000Z', 101],
        ['2026-07-25T02:00:00.000Z', 2]
      ]),
      current,
      'insufficient-samples'
    ]
  ])('%s returns an explicit reason', (_name, fixture, window, reason) => {
    expect(
      forecastQuota(window as QuotaWindow, fixture as QuotaSample[], new Date(current.capturedAt))
    ).toEqual({
      available: false,
      reason
    })
  })
})
