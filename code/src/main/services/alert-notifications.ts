import { BrowserWindow, Notification } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type {
  AlertEvent,
  AlertNotificationDelivery,
  AlertNotificationStatus,
  AlertOpenDestination
} from '@shared/types/alert'
import { listAlertEvents } from '../store/alerts-repo'
import { getSetting, setSetting } from '../store/settings-store'
import { createWindow } from '../window'

const activeNotifications = new Set<Notification>()
export const ALERT_NOTIFICATIONS_MUTE_UNTIL_SETTING = 'alert_notifications_mute_until'

export function areAlertNotificationsMuted(now = new Date()): boolean {
  const mutedUntil = getSetting<string>(ALERT_NOTIFICATIONS_MUTE_UNTIL_SETTING)
  const mutedUntilMs = mutedUntil ? Date.parse(mutedUntil) : NaN
  return Number.isFinite(mutedUntilMs) && mutedUntilMs > now.getTime()
}

export function muteAlertNotificationsFor(durationMs: number, now = new Date()): void {
  const safeDuration = Math.max(0, Math.floor(durationMs))
  setSetting(
    ALERT_NOTIFICATIONS_MUTE_UNTIL_SETTING,
    new Date(now.getTime() + safeDuration).toISOString()
  )
}

export function getAlertNotificationStatus(): AlertNotificationStatus {
  const supported = Notification.isSupported()
  if (!supported) {
    return {
      supported: false,
      state: 'unsupported',
      detail: '当前系统或运行环境不支持 Electron 原生通知。'
    }
  }

  let latest: AlertEvent | undefined
  try {
    latest = listAlertEvents(1)[0]
  } catch {
    // The capability endpoint may be queried while the database is still
    // opening. Keep the result honest instead of treating support as delivery.
  }

  if (!latest) {
    return {
      supported: true,
      state: 'unverified',
      detail: '系统支持原生通知；尚无实际送达记录，系统权限需在首次告警后验证。'
    }
  }

  const base = {
    supported: true,
    lastDeliveryStatus: latest.notificationStatus,
    lastAttemptAt: latest.firedAt
  } as const
  if (latest.notificationStatus === 'shown') {
    return {
      ...base,
      state: 'delivered',
      detail: '最近一条告警已由系统确认展示。'
    }
  }
  if (latest.notificationStatus === 'failed') {
    return {
      ...base,
      state: 'blocked-or-failed',
      detail: latest.notificationError
        ? `最近一条告警发送失败：${latest.notificationError}`
        : '最近一条告警发送失败；请检查系统通知权限。'
    }
  }
  if (latest.notificationStatus === 'unsupported') {
    return {
      ...base,
      state: 'unsupported',
      detail: '最近一次发送时，运行环境不支持原生通知。'
    }
  }
  return {
    ...base,
    state: 'pending',
    detail: '最近一条告警已创建，正在等待系统确认送达结果。'
  }
}

function sendDestination(window: BrowserWindow, destination: AlertOpenDestination): void {
  window.webContents.send(IPC.alertsOpenDestination, destination)
}

function openAlertDestination(destination: AlertOpenDestination): void {
  const window = BrowserWindow.getAllWindows()[0] ?? createWindow()
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', () => sendDestination(window, destination))
  } else {
    sendDestination(window, destination)
  }
}

export type AlertNotificationResult = {
  status: AlertNotificationDelivery
  error?: string
}

function reportDelivery(
  onDelivery: ((result: AlertNotificationResult) => void) | undefined,
  result: AlertNotificationResult
): void {
  try {
    onDelivery?.(result)
  } catch (error) {
    console.error('[alerts] failed to persist notification delivery:', (error as Error).message)
  }
}

export function showAlertNotification(
  event: AlertEvent,
  onDelivery?: (result: AlertNotificationResult) => void
): AlertNotificationResult {
  if (!Notification.isSupported()) {
    const result = { status: 'unsupported' as const }
    reportDelivery(onDelivery, result)
    return result
  }

  let createdNotification: Notification | undefined
  try {
    const notification = new Notification({
      title: `MoonMeter · ${event.providerId} 额度告警`,
      body: event.message,
      silent: false
    })
    createdNotification = notification
    let settled = false
    const settle = (result: AlertNotificationResult): void => {
      if (settled) return
      settled = true
      // Keep successfully displayed notifications alive so their later click
      // and close events remain observable. Failed notifications can be freed.
      if (result.status !== 'shown') activeNotifications.delete(notification)
      reportDelivery(onDelivery, result)
    }
    notification.on('show', () => settle({ status: 'shown' }))
    notification.on('failed', (_nativeEvent, error) =>
      settle({ status: 'failed', error: String(error) })
    )
    notification.on('click', () => {
      openAlertDestination({ eventId: event.id, providerId: event.providerId })
    })
    notification.on('close', () => activeNotifications.delete(notification))
    activeNotifications.add(notification)
    notification.show()
    return { status: 'pending' }
  } catch (error) {
    if (createdNotification) activeNotifications.delete(createdNotification)
    const result = { status: 'failed' as const, error: (error as Error).message }
    reportDelivery(onDelivery, result)
    return result
  }
}
