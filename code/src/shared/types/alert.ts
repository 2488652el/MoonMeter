/**
 * 告警类型定义:描述用量/余额告警规则与触发事件。
 * 规则(AlertRule)定义阈值与指标,事件(AlertEvent)记录实际触发的快照。
 */

/** 告警指标:剩余金额(remaining_amount)或剩余百分比(remaining_pct)。 */
export type AlertMetric = 'remaining_amount' | 'remaining_pct'
/** 告警作用域:单个供应商(provider)或全局(global)。 */
export type AlertScope = 'provider' | 'global'
export type AlertNotificationDelivery = 'pending' | 'shown' | 'unsupported' | 'failed'

export interface AlertRuleInput {
  scope: AlertScope
  providerId?: string
  threshold: number
  metric: AlertMetric
}

/** 告警规则:用户配置的一条阈值规则,由调度器周期性评估。 */
export interface AlertRule extends AlertRuleInput {
  id: string
  enabled: boolean
  lastTriggeredAt?: string
  createdAt: string
}

/** 告警事件:规则被触发时写入的一条历史记录。 */
export interface AlertEvent {
  id: string
  ruleId: string
  providerId: string
  apiKeyId?: string
  firedAt: string
  value: number
  threshold: number
  message: string
  readAt?: string
  notificationStatus: AlertNotificationDelivery
  notificationError?: string
}

export interface AlertNotificationStatus {
  supported: boolean
  state: 'unverified' | 'pending' | 'delivered' | 'blocked-or-failed' | 'unsupported'
  detail: string
  lastDeliveryStatus?: AlertNotificationDelivery
  lastAttemptAt?: string
}

export interface AlertOpenDestination {
  eventId: string
  providerId: string
}
