import type { AlertEvent } from '@shared/types/alert'
import type { QuotaWindow } from '@shared/types/quota-planning'

export interface TraySpend {
  total: number
  currency: string
  cnyTotal: number
}

export function selectTrayQuotaLines(windows: readonly QuotaWindow[], now = new Date()): string[] {
  return windows
    .filter(
      (window) =>
        window.quotaKind === 'hard-quota' &&
        typeof window.usedPercent === 'number' &&
        Number.isFinite(window.usedPercent)
    )
    .sort((left, right) => {
      const byUsage = (right.usedPercent ?? 0) - (left.usedPercent ?? 0)
      return byUsage !== 0 ? byUsage : Date.parse(right.capturedAt) - Date.parse(left.capturedAt)
    })
    .slice(0, 3)
    .map((window) => {
      const remaining = Math.max(0, 100 - (window.usedPercent ?? 0)).toFixed(0)
      const label = `${window.sourceId.replace(/^provider:/, '')} · ${window.windowKey}`
      const stale = Date.parse(window.freshUntil) < now.getTime() ? ' · 数据已过期' : ''
      return `${label}：剩余 ${remaining}%${stale}`
    })
}

export function formatTraySpend(label: string, spend: TraySpend): string {
  if (!Number.isFinite(spend.total) || spend.total <= 0) return `${label}：暂无成本数据`
  if (Number.isFinite(spend.cnyTotal) && spend.cnyTotal > 0) {
    return `${label}：CNY ${spend.cnyTotal.toFixed(2)}`
  }
  return `${label}：${spend.currency.trim().toUpperCase()} ${spend.total.toFixed(2)}`
}

export function formatLatestAlert(event: AlertEvent | undefined): string {
  return event ? `最近告警：${event.message}` : '最近告警：暂无'
}
