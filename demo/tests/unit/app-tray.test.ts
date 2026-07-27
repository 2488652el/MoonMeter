import { describe, expect, it, vi } from 'vitest'
import type { QuotaWindow } from '../../../code/src/shared/types/quota-planning'

const setContextMenu = vi.fn()
const refreshAll = vi.fn()
const muteAlertNotificationsFor = vi.fn()
const listQuotaSamples = vi.fn()
const listAlertEvents = vi.fn()
const computeTotalSpend = vi.fn()
const appQuit = vi.fn()

class MockTray {
  setContextMenu = setContextMenu
  setToolTip = vi.fn()
  on = vi.fn()
  destroy = vi.fn()
}

async function loadTrayService() {
  vi.resetModules()
  setContextMenu.mockReset()
  refreshAll.mockReset()
  muteAlertNotificationsFor.mockReset()
  listQuotaSamples.mockReset()
  listAlertEvents.mockReset()
  computeTotalSpend.mockReset()
  appQuit.mockReset()

  vi.doMock('electron', () => ({
    app: { getAppPath: () => 'D:/app', isPackaged: false, quit: appQuit },
    BrowserWindow: { getAllWindows: () => [] },
    Menu: { buildFromTemplate: (template: unknown[]) => template },
    Tray: MockTray,
    nativeImage: { createFromPath: vi.fn(() => ({})) }
  }))
  vi.doMock('../../../code/src/main/store/alerts-repo', () => ({ listAlertEvents }))
  vi.doMock('../../../code/src/main/store/usage-repo', () => ({ computeTotalSpend }))
  vi.doMock('../../../code/src/main/store/quota-repo', () => ({ listQuotaSamples }))
  vi.doMock('../../../code/src/main/scheduler/refresh', () => ({ refreshAll }))
  vi.doMock('../../../code/src/main/services/alert-notifications', () => ({
    muteAlertNotificationsFor
  }))
  return import('../../../code/src/main/services/app-tray')
}

function sample(overrides: Partial<QuotaWindow> = {}): QuotaWindow {
  return {
    sourceId: 'provider:kimi',
    accountRef: 'key-1',
    windowKey: '7d',
    windowType: 'calendar',
    quotaKind: 'hard-quota',
    unit: 'percent',
    capturedAt: '2026-07-27T08:00:00.000Z',
    freshUntil: '2099-07-27T09:00:00.000Z',
    confidence: 'measured',
    usedPercent: 20,
    ...overrides
  }
}

describe('application tray', () => {
  function seedTrayData(): void {
    listQuotaSamples.mockReturnValue([
      sample({ sourceId: 'provider:codex', usedPercent: 80 }),
      sample({ sourceId: 'provider:kimi', usedPercent: 60 }),
      sample({ sourceId: 'provider:minimax', usedPercent: 40 }),
      sample({ sourceId: 'provider:other', usedPercent: 20 })
    ])
    listAlertEvents.mockReturnValue([
      {
        id: 'alert-1',
        ruleId: 'rule-1',
        providerId: 'minimax',
        firedAt: '2026-07-27T08:00:00.000Z',
        value: 10,
        threshold: 20,
        message: 'MiniMax 剩余 10%',
        notificationStatus: 'shown'
      }
    ])
    computeTotalSpend.mockReturnValue({ total: 12, currency: 'USD', cnyTotal: 86.4 })
  }

  it('builds the compact menu from persisted quotas, alerts and costs', async () => {
    const { createAppTray } = await loadTrayService()
    seedTrayData()
    createAppTray()

    const template = setContextMenu.mock.calls.at(-1)?.[0] as Array<{ label?: string }>
    const labels = template.flatMap((item) => (item.label ? [item.label] : []))
    expect(labels).toContain('codex · 7d：剩余 20%')
    expect(labels).toContain('kimi · 7d：剩余 40%')
    expect(labels).toContain('minimax · 7d：剩余 60%')
    expect(labels).not.toContain('other · 7d：剩余 80%')
    expect(labels).toContain('最近告警：MiniMax 剩余 10%')
    expect(labels).toContain('今日成本：CNY 86.40')
    expect(labels).toContain('本月成本：CNY 86.40')
    expect(labels).toEqual(expect.arrayContaining(['打开详情', '立即刷新', '静音 1 小时']))
  })
})
