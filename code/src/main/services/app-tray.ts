import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import { join } from 'node:path'
import { listAlertEvents } from '../store/alerts-repo'
import { computeTotalSpend } from '../store/usage-repo'
import { listQuotaSamples } from '../store/quota-repo'
import { refreshAll } from '../scheduler/refresh'
import { muteAlertNotificationsFor } from './alert-notifications'
import { formatLatestAlert, formatTraySpend, selectTrayQuotaLines } from './tray-summary'

let tray: Tray | null = null

function localPeriodStart(now: Date, period: 'day' | 'month'): string {
  const start =
    period === 'day'
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
      : new Date(now.getFullYear(), now.getMonth(), 1)
  return start.toISOString()
}

function showMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function currentQuotaWindows() {
  const latest = new Map<string, ReturnType<typeof listQuotaSamples>[number]>()
  for (const sample of listQuotaSamples()) {
    const key = `${sample.sourceId}\0${sample.accountRef}\0${sample.windowKey}`
    const previous = latest.get(key)
    if (!previous || Date.parse(sample.capturedAt) > Date.parse(previous.capturedAt)) {
      latest.set(key, sample)
    }
  }
  return [...latest.values()]
}

function rebuildTrayMenu(now = new Date()): void {
  if (!tray) return
  const today = computeTotalSpend({
    fromISO: localPeriodStart(now, 'day'),
    toISO: now.toISOString()
  })
  const month = computeTotalSpend({
    fromISO: localPeriodStart(now, 'month'),
    toISO: now.toISOString()
  })
  const quotaLines = selectTrayQuotaLines(currentQuotaWindows(), now)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'MoonMeter', enabled: false },
      { type: 'separator' },
      ...(quotaLines.length > 0
        ? quotaLines.map((label) => ({ label, enabled: false }))
        : [{ label: '暂无可用额度数据', enabled: false }]),
      { type: 'separator' },
      { label: formatLatestAlert(listAlertEvents(1)[0]), enabled: false },
      { label: formatTraySpend('今日成本', today), enabled: false },
      { label: formatTraySpend('本月成本', month), enabled: false },
      { type: 'separator' },
      { label: '打开详情', click: showMainWindow },
      {
        label: '立即刷新',
        click: () => {
          void refreshAll().finally(() => rebuildTrayMenu())
        }
      },
      {
        label: '静音 1 小时',
        click: () => {
          muteAlertNotificationsFor(60 * 60_000)
          rebuildTrayMenu()
        }
      },
      { type: 'separator' },
      { label: '退出 MoonMeter', click: () => app.quit() }
    ])
  )
}

export function createAppTray(): Tray {
  if (tray) return tray
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'moonmeter-tray.png')
    : join(app.getAppPath(), 'design', 'assets', 'icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  tray = new Tray(icon)
  tray.setToolTip('MoonMeter · AI 额度与成本驾驶舱')
  tray.on('click', showMainWindow)
  tray.on('right-click', () => rebuildTrayMenu())
  rebuildTrayMenu()
  return tray
}

export function refreshAppTray(): void {
  rebuildTrayMenu()
}

export function destroyAppTray(): void {
  tray?.destroy()
  tray = null
}
