import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BudgetRule } from '../../../code/src/shared/types/budget'

const mocks = vi.hoisted(() => ({
  rules: [] as BudgetRule[],
  events: [] as unknown[],
  spend: {
    cnyTotal: 0,
    totalRequests: 0,
    pricedRequests: 0,
    providerCostRequests: 0,
    snapshotCostRequests: 0,
    estimatedRequests: 0,
    unpricedRequests: 0,
    unconvertedCurrencies: [] as string[]
  },
  insert: vi.fn()
}))

vi.mock('../../../code/src/main/store/usage-repo', () => ({
  computeTotalSpend: vi.fn(() => mocks.spend)
}))
vi.mock('../../../code/src/main/store/budget-repo', () => ({
  listBudgetRules: vi.fn(() => mocks.rules),
  listBudgetEvents: vi.fn(() => mocks.events),
  insertBudgetEvent: mocks.insert
}))

import {
  budgetRuleToFilter,
  evaluateBudgetReminders,
  evaluateBudgetRule,
  resolveBudgetPeriod
} from '../../../code/src/main/services/budget-planning'
import { computeTotalSpend } from '../../../code/src/main/store/usage-repo'

const rule: BudgetRule = {
  id: 'budget-1',
  name: 'Codex 项目预算',
  periodKind: 'custom-cycle',
  customCycleStartDay: 15,
  scope: 'project',
  scopeValue: 'tokenlub',
  limitCny: 100,
  enabled: true,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z'
}

beforeEach(() => {
  mocks.rules = [rule]
  mocks.events = []
  mocks.spend = {
    cnyTotal: 0,
    totalRequests: 0,
    pricedRequests: 0,
    providerCostRequests: 0,
    snapshotCostRequests: 0,
    estimatedRequests: 0,
    unpricedRequests: 0,
    unconvertedCurrencies: []
  }
  mocks.insert.mockReset()
})

describe('soft budget planning', () => {
  it('resolves a recurring custom billing cycle instead of comparing calendar months', () => {
    const period = resolveBudgetPeriod(rule, new Date('2026-07-10T08:00:00.000Z'))
    expect(period.startsAt).toBe('2026-06-14T16:00:00.000Z')
    expect(period.endsAt).toBe('2026-07-14T16:00:00.000Z')
  })

  it('uses the rule scope and exact billing period as the spend filter', () => {
    const now = new Date('2026-07-20T08:00:00.000Z')
    const period = resolveBudgetPeriod(rule, now)
    expect(budgetRuleToFilter(rule, period, now)).toEqual({
      fromISO: '2026-07-14T16:00:00.000Z',
      toISO: '2026-07-20T08:00:00.000Z',
      projectContains: 'tokenlub'
    })
  })

  it('reports data quality and forecasts only after a minimum elapsed period', () => {
    mocks.spend = {
      cnyTotal: 42,
      totalRequests: 10,
      pricedRequests: 8,
      providerCostRequests: 2,
      snapshotCostRequests: 3,
      estimatedRequests: 3,
      unpricedRequests: 2,
      unconvertedCurrencies: ['JPY']
    }
    const result = evaluateBudgetRule(rule, new Date('2026-07-20T08:00:00.000Z'))
    expect(computeTotalSpend).toHaveBeenCalledWith(
      expect.objectContaining({ projectContains: 'tokenlub', fromISO: '2026-07-14T16:00:00.000Z' })
    )
    expect(result).toMatchObject({
      spentCny: 42,
      percentUsed: 42,
      forecast: { available: true },
      dataQuality: { pricedRequests: 8, estimatedRequests: 3, unpricedRequests: 2 }
    })
    expect(result.dataQuality.unconvertedCurrencies).toEqual(['JPY'])
  })

  it('emits only the highest crossed threshold for a billing cycle', () => {
    mocks.spend = { ...mocks.spend, cnyTotal: 85, totalRequests: 1, pricedRequests: 1 }
    mocks.insert.mockImplementation((event) => ({
      id: 'event-1',
      createdAt: '2026-07-20T08:00:00.000Z',
      ...event
    }))

    const events = evaluateBudgetReminders(new Date('2026-07-20T08:00:00.000Z'))

    expect(events).toHaveLength(1)
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ thresholdPercent: 80, spentCny: 85, limitCny: 100 })
    )
  })
})
