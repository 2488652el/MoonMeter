import { describe, expect, it } from 'vitest'
import type { ActionCenterItem, QuotaWindow } from '../../../code/src/shared/types/quota-planning'
import {
  abnormalBurnAction,
  isInternalTarget,
  providerFromSourceId,
  quotaAction,
  quotaSourceTarget,
  selectActionCenterItems,
  sourceHealthAction,
  sourceStatusWithFreshness,
  unpricedUsageAction
} from '../../../code/src/shared/utils/action-center'

function action(
  id: string,
  severity: ActionCenterItem['severity'],
  updatedAt: string,
  rootCauseId = id
): ActionCenterItem {
  return {
    id,
    rootCauseId,
    kind: 'source-unhealthy',
    severity,
    title: id,
    basis: id,
    sampleStart: updatedAt,
    sampleEnd: updatedAt,
    updatedAt,
    target: '/providers?provider=test'
  }
}

const window: QuotaWindow = {
  sourceId: 'kimi',
  accountRef: 'uuid',
  windowKey: '7d',
  windowType: 'calendar',
  quotaKind: 'hard-quota',
  unit: 'percent',
  capturedAt: '2026-07-25T03:00:00.000Z',
  freshUntil: '2026-07-25T03:30:00.000Z',
  confidence: 'measured',
  usedPercent: 30,
  resetAt: '2026-08-01T00:00:00.000Z'
}

describe('action center', () => {
  it('deduplicates root causes, sorts deterministically and hard-limits to three', () => {
    const result = selectActionCenterItems([
      action('old-info', 'info', '2026-07-25T00:00:00.000Z'),
      action('new-warning', 'warning', '2026-07-25T02:00:00.000Z', 'same'),
      action('old-warning', 'warning', '2026-07-25T01:00:00.000Z', 'same'),
      action('critical-b', 'critical', '2026-07-25T03:00:00.000Z'),
      action('critical-a', 'critical', '2026-07-25T03:00:00.000Z')
    ])
    expect(result.map(({ id }) => id)).toEqual(['critical-a', 'critical-b', 'new-warning'])
  })

  it('rejects external and unknown routes', () => {
    expect(isInternalTarget('https://example.com')).toBe(false)
    expect(isInternalTarget('/settings')).toBe(false)
    expect(isInternalTarget('/logs?source=codex')).toBe(true)
    expect(isInternalTarget('/?focus=quota&account=hash')).toBe(true)
  })

  it('keeps Codex quota actions on the matching dashboard account card', () => {
    const action = quotaAction(
      { ...window, sourceId: 'codex:chatgpt', accountRef: 'local-hash' },
      {
        available: true,
        category: 'exhausts-early',
        medianRatePerHour: 12,
        projectedUsedAtReset: 120,
        currentUsedPercent: 30,
        sampleCount: 3,
        sampleStart: '2026-07-25T00:00:00.000Z',
        sampleEnd: window.capturedAt,
        resetAt: window.resetAt!
      }
    )
    expect(action?.target).toBe('/?focus=quota&account=local-hash')
    expect(
      abnormalBurnAction(
        { ...window, sourceId: 'codex:chatgpt', accountRef: 'local-hash' },
        7,
        2,
        window.capturedAt
      )?.target
    ).toBe('/?focus=quota&account=local-hash')
    expect(
      sourceHealthAction({
        sourceId: 'codex:chatgpt',
        sourceType: 'codex',
        accountRef: 'local-hash',
        permission: 'auth-required',
        status: 'error',
        updatedAt: window.capturedAt
      })?.target
    ).toBe('/?focus=quota&account=local-hash')
    expect(
      sourceHealthAction({
        sourceId: 'codex:chatgpt',
        sourceType: 'codex',
        accountRef: 'codex-local',
        permission: 'auth-required',
        status: 'error',
        updatedAt: window.capturedAt
      })?.target
    ).toBe('/?focus=source&source=codex%3Achatgpt')
    expect(quotaSourceTarget('provider:minimax', 'key-id')).toBe(
      '/apikeys?provider=minimax&account=key-id'
    )
  })

  it('maps CLI source deep links to the provider ids stored in usage records', () => {
    expect(providerFromSourceId('cli:claude-code')).toBe('claude-code')
    expect(providerFromSourceId('cli:codex')).toBe('codex')
    expect(providerFromSourceId('cli:kimi-code')).toBe('kimi-coding')
  })

  it('names the affected source instead of repeating a generic refresh warning', () => {
    const action = sourceHealthAction({
      sourceId: 'provider:minimax',
      sourceType: 'provider',
      accountRef: 'key-id',
      accountAlias: '个人 Coding Plan',
      providerId: 'minimax',
      permission: 'unknown',
      status: 'error',
      errorMessage: '来源刷新失败，请重试或检查配置',
      updatedAt: window.capturedAt
    })

    expect(action).toMatchObject({
      title: 'minimax · 个人 Coding Plan 需要处理',
      basis: '来源刷新失败，请重试或检查配置'
    })
  })

  it('derives stale health from the last successful sample time', () => {
    const now = new Date('2026-07-25T10:30:00.001Z')
    expect(sourceStatusWithFreshness('healthy', '2026-07-25T10:00:00.000Z', now, 30 * 60_000)).toBe(
      'stale'
    )
    expect(sourceStatusWithFreshness('error', '2026-07-25T10:00:00.000Z', now, 30 * 60_000)).toBe(
      'error'
    )
  })

  it('builds traceable quota, pricing and abnormal burn actions', () => {
    const forecastAction = quotaAction(window, {
      available: true,
      category: 'exhausts-early',
      medianRatePerHour: 12.345,
      projectedUsedAtReset: 120.04,
      currentUsedPercent: 30,
      sampleCount: 4,
      sampleStart: '2026-07-25T00:00:00.000Z',
      sampleEnd: window.capturedAt,
      resetAt: window.resetAt!
    })
    expect(forecastAction).toMatchObject({
      severity: 'critical',
      target: '/apikeys?provider=kimi&account=uuid'
    })
    expect(forecastAction?.basis).toContain('12.3%/小时')

    expect(abnormalBurnAction(window, 6, 2, '2026-07-25T02:00:00.000Z')).toBeNull()
    expect(abnormalBurnAction(window, 6.1, 2, '2026-07-25T02:00:00.000Z')?.kind).toBe(
      'abnormal-burn'
    )

    expect(
      unpricedUsageAction('openai', {
        windowStart: '2026-07-24T03:00:00.000Z',
        windowEnd: window.capturedAt,
        totalRequests: 10,
        pricedRequests: 7,
        unpricedRequests: 3,
        providerCostRequests: 1,
        priceSnapshotRequests: 3,
        currentEstimateRequests: 3,
        unpricedCurrencyCount: 0
      })
    ).toMatchObject({ target: '/pricing?provider=openai', severity: 'warning' })
  })
})
