import { describe, expect, it } from 'vitest'
import type { QuotaWindow } from '../../../code/src/shared/types/quota-planning'
import {
  formatLatestAlert,
  formatTraySpend,
  selectTrayQuotaLines
} from '../../../code/src/main/services/tray-summary'

const window = (overrides: Partial<QuotaWindow> = {}): QuotaWindow => ({
  sourceId: 'provider:kimi-coding',
  accountRef: 'account-a',
  windowKey: '7d',
  windowType: 'calendar',
  quotaKind: 'hard-quota',
  unit: 'percent',
  capturedAt: '2026-07-27T08:00:00.000Z',
  freshUntil: '2026-07-27T09:00:00.000Z',
  confidence: 'measured',
  usedPercent: 25,
  ...overrides
})

describe('tray summary', () => {
  it('keeps the three most urgent hard quotas and marks stale data', () => {
    expect(
      selectTrayQuotaLines(
        [
          window({ sourceId: 'provider:codex', usedPercent: 80 }),
          window({ sourceId: 'provider:kimi', usedPercent: 60 }),
          window({ sourceId: 'provider:minimax', usedPercent: 40 }),
          window({ sourceId: 'provider:other', usedPercent: 20 }),
          window({ sourceId: 'provider:balance', quotaKind: 'balance', usedPercent: 99 }),
          window({
            sourceId: 'provider:stale',
            usedPercent: 90,
            freshUntil: '2026-07-27T07:59:00.000Z'
          })
        ],
        new Date('2026-07-27T08:00:00.000Z')
      )
    ).toEqual(['stale · 7d：剩余 10% · 数据已过期', 'codex · 7d：剩余 20%', 'kimi · 7d：剩余 40%'])
  })

  it('formats costs and alerts without inventing data', () => {
    expect(formatTraySpend('今日成本', { total: 12, currency: 'USD', cnyTotal: 86.4 })).toBe(
      '今日成本：CNY 86.40'
    )
    expect(formatTraySpend('本月成本', { total: 0, currency: 'CNY', cnyTotal: 0 })).toBe(
      '本月成本：暂无成本数据'
    )
    expect(formatLatestAlert(undefined)).toBe('最近告警：暂无')
  })
})
