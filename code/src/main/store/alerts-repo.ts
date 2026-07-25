/**
 * 告警规则仓库:管理 alert_rules 与 alert_events 表的 CRUD 操作。
 * 该模块属于 main 进程的 store 模块,提供告警规则的增删改查与事件持久化能力。
 */
import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import type {
  AlertRule,
  AlertEvent,
  AlertNotificationDelivery,
  AlertRuleInput
} from '@shared/types/alert'

/** alert_rules 表的数据库行结构映射。 */
interface DbRow {
  id: string
  scope: string
  provider_id: string | null
  threshold: number
  metric: string
  enabled: number
  last_triggered_at: string | null
  created_at: string
}

interface AlertEventRow {
  id: string
  rule_id: string
  provider_id: string
  api_key_id: string | null
  fired_at: string
  value: number
  threshold: number
  message: string
  read_at: string | null
  notification_status: AlertNotificationDelivery
  notification_error: string | null
}

interface AlertRuleStateRow {
  active: number
  breach_count: number
}

/** 将数据库行映射为 AlertRule 对象,处理可选字段的条件展开。 */
function rowToRule(r: DbRow): AlertRule {
  return {
    id: r.id,
    scope: r.scope as AlertRule['scope'],
    threshold: r.threshold,
    metric: r.metric as AlertRule['metric'],
    enabled: r.enabled === 1,
    createdAt: r.created_at,
    ...(r.provider_id !== null ? { providerId: r.provider_id } : {}),
    ...(r.last_triggered_at !== null ? { lastTriggeredAt: r.last_triggered_at } : {})
  }
}

/** 查询所有告警规则,按创建时间降序排列。 */
export function listAlerts(): AlertRule[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM alert_rules ORDER BY created_at DESC').all() as DbRow[]
  return rows.map(rowToRule)
}

/**
 * 新增一条告警规则,enabled 默认为 true。
 * @param input 不含 id/createdAt/enabled/lastTriggeredAt 的规则数据
 * @returns 完整的 AlertRule 对象(含生成的 id 与时间戳)
 */
export function addAlert(input: AlertRuleInput & { enabled?: boolean }): AlertRule {
  const db = getDb()
  const id = randomUUID()
  const now = new Date().toISOString()
  db.prepare(
    `
    INSERT INTO alert_rules (id, scope, provider_id, threshold, metric, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    input.scope,
    input.providerId ?? null,
    input.threshold,
    input.metric,
    input.enabled === false ? 0 : 1,
    now
  )
  return { id, enabled: input.enabled !== false, createdAt: now, ...input }
}

export function updateAlert(id: string, input: AlertRuleInput): AlertRule {
  const db = getDb()
  const result = db
    .prepare(
      `
      UPDATE alert_rules
      SET scope = ?, provider_id = ?, threshold = ?, metric = ?
      WHERE id = ?
    `
    )
    .run(input.scope, input.providerId ?? null, input.threshold, input.metric, id)
  if (result.changes === 0) throw new Error('告警规则不存在')
  db.prepare('DELETE FROM alert_rule_states WHERE rule_id = ?').run(id)
  return listAlerts().find((rule) => rule.id === id)!
}

/** 切换告警规则的启用状态。 */
export function toggleAlert(id: string, enabled: boolean): void {
  const db = getDb()
  db.prepare('UPDATE alert_rules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
  if (!enabled) db.prepare('DELETE FROM alert_rule_states WHERE rule_id = ?').run(id)
}

/** 删除指定告警规则。 */
export function deleteAlert(id: string): void {
  const db = getDb()
  db.transaction(() => {
    db.prepare('DELETE FROM alert_rule_states WHERE rule_id = ?').run(id)
    db.prepare('DELETE FROM alert_rules WHERE id = ?').run(id)
  })()
}

/** Update last_triggered_at after a rule fires (N3). */
/**
 * 规则触发后更新 last_triggered_at 时间戳。
 * @param ruleId 规则 ID
 * @param firedAt 触发时间(ISO 字符串)
 */
export function markAlertTriggered(ruleId: string, firedAt: string): void {
  const db = getDb()
  db.prepare('UPDATE alert_rules SET last_triggered_at = ? WHERE id = ?').run(firedAt, ruleId)
}

/** Persist an alert event (N3). The alert_events table is created by schema migrations in store/db. */
/**
 * 持久化一条告警触发事件。
 * alert_events 表由 store/db 的 schema 迁移创建。
 * @param event 不含 id 的事件数据
 */
function rowToEvent(row: AlertEventRow): AlertEvent {
  return {
    id: row.id,
    ruleId: row.rule_id,
    providerId: row.provider_id,
    firedAt: row.fired_at,
    value: row.value,
    threshold: row.threshold,
    message: row.message,
    notificationStatus: row.notification_status,
    ...(row.api_key_id !== null ? { apiKeyId: row.api_key_id } : {}),
    ...(row.read_at !== null ? { readAt: row.read_at } : {}),
    ...(row.notification_error !== null ? { notificationError: row.notification_error } : {})
  }
}

export function insertAlertEvent(
  event: Omit<AlertEvent, 'id' | 'readAt' | 'notificationStatus' | 'notificationError'>
): AlertEvent {
  const db = getDb()
  const id = randomUUID()
  db.prepare(
    `
    INSERT INTO alert_events (
      id, rule_id, provider_id, api_key_id, fired_at, value, threshold, message,
      notification_status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `
  ).run(
    id,
    event.ruleId,
    event.providerId,
    event.apiKeyId ?? null,
    event.firedAt,
    event.value,
    event.threshold,
    event.message
  )
  return { id, notificationStatus: 'pending', ...event }
}

export function listAlertEvents(limit = 100): AlertEvent[] {
  const rows = getDb()
    .prepare('SELECT * FROM alert_events ORDER BY fired_at DESC LIMIT ?')
    .all(limit) as AlertEventRow[]
  return rows.map(rowToEvent)
}

export function markAlertEventRead(id: string, readAt = new Date().toISOString()): void {
  getDb()
    .prepare('UPDATE alert_events SET read_at = COALESCE(read_at, ?) WHERE id = ?')
    .run(readAt, id)
}

export function markAllAlertEventsRead(readAt = new Date().toISOString()): void {
  getDb().prepare('UPDATE alert_events SET read_at = ? WHERE read_at IS NULL').run(readAt)
}

export function updateAlertEventNotification(
  id: string,
  status: AlertNotificationDelivery,
  error?: string
): void {
  getDb()
    .prepare('UPDATE alert_events SET notification_status = ?, notification_error = ? WHERE id = ?')
    .run(status, error ?? null, id)
}

export function getAlertRuleState(
  ruleId: string,
  providerId: string,
  apiKeyId?: string
): { active: boolean; breachCount: number } {
  const row = getDb()
    .prepare(
      `
      SELECT active, breach_count FROM alert_rule_states
      WHERE rule_id = ? AND provider_id = ? AND api_key_id = ?
    `
    )
    .get(ruleId, providerId, apiKeyId ?? '') as AlertRuleStateRow | undefined
  return {
    active: row?.active === 1,
    breachCount: Math.max(0, row?.breach_count ?? 0)
  }
}

export function setAlertRuleState(
  ruleId: string,
  providerId: string,
  apiKeyId: string | undefined,
  active: boolean,
  value: number,
  updatedAt: string,
  breachCount = 0
): void {
  getDb()
    .prepare(
      `
      INSERT INTO alert_rule_states (
        rule_id, provider_id, api_key_id, active, last_value, updated_at, breach_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(rule_id, provider_id, api_key_id) DO UPDATE SET
        active = excluded.active,
        last_value = excluded.last_value,
        updated_at = excluded.updated_at,
        breach_count = excluded.breach_count
    `
    )
    .run(ruleId, providerId, apiKeyId ?? '', active ? 1 : 0, value, updatedAt, breachCount)
}
