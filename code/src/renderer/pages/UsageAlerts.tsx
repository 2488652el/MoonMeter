/**
 * 用量告警页面:管理告警规则的增删改查与启停,
 * 支持按全局或指定供应商、按剩余金额或剩余百分比设置阈值。
 */
import { Icon } from '../components/Icon'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { Modal } from '../components/Modal'
import { AnimatedNumber, ProgressBar } from '../components/motion'
import { fmtMoney } from '../../shared/utils/money'
import type {
  AlertEvent,
  AlertMetric,
  AlertNotificationStatus,
  AlertRule,
  AlertRuleInput,
  AlertScope
} from '../../shared/types/alert'
import type { ProviderManifest, BalanceSnapshot } from '../../shared/types/provider'
import { alertAddInputSchema } from '../../shared/ipc-schemas'
import { useReducedMotion } from '../hooks/useReducedMotion'

/** 告警指标到中文标签的映射 */
const METRIC_LABEL: Record<AlertMetric, string> = {
  remaining_amount: '剩余金额',
  remaining_pct: '剩余百分比'
}

function notificationPresentation(status: AlertNotificationStatus | null): {
  icon: string
  iconClass: string
  badgeClass: string
  label: string
} {
  if (!status) {
    return {
      icon: 'fa-bell',
      iconClass: 'text-text-muted',
      badgeClass: 'bg-bg-hover text-text-muted',
      label: '读取中'
    }
  }
  if (status.state === 'delivered') {
    return {
      icon: 'fa-bell',
      iconClass: 'text-status-green',
      badgeClass: 'bg-status-green-dim text-status-green',
      label: '已验证'
    }
  }
  if (status.state === 'pending') {
    return {
      icon: 'fa-bell',
      iconClass: 'text-status-blue',
      badgeClass: 'bg-status-blue-dim text-status-blue',
      label: '待确认'
    }
  }
  if (status.state === 'unverified') {
    return {
      icon: 'fa-bell',
      iconClass: 'text-status-blue',
      badgeClass: 'bg-status-blue-dim text-status-blue',
      label: '未验证'
    }
  }
  return {
    icon: 'fa-triangle-exclamation',
    iconClass: 'text-status-amber',
    badgeClass: 'bg-status-amber-dim text-status-amber',
    label: status.state === 'unsupported' ? '不可用' : '需检查'
  }
}

// inline relative-time helper. Keeps a stable interface so we can
// extract to money.ts later if more settings or alert views need it. Format is
// zh-CN friendly but ASCII-safe (no full-width chars) for tabular layouts.
//
// 相对时间格式化:将 ISO 时间转为"刚刚/N 分钟前/N 小时前"等中文友好文本。
function formatRelative(iso: string | undefined): string {
  if (!iso) return '从未'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  const diff = Date.now() - t
  if (diff < 0) return '刚刚'
  const m = Math.floor(diff / 60_000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  return iso.slice(0, 10)
}

/**
 * 用量告警页面组件。
 * 拉取告警规则、供应商与余额,渲染规则表格与新建规则弹窗。
 */
export default function UsageAlerts() {
  const navigate = useNavigate()
  const [rules, setRules] = useState<AlertRule[]>([])
  const [events, setEvents] = useState<AlertEvent[]>([])
  const [notificationStatus, setNotificationStatus] = useState<AlertNotificationStatus | null>(null)
  const [providers, setProviders] = useState<ProviderManifest[]>([])
  const [balances, setBalances] = useState<
    Array<BalanceSnapshot & { id: number; apiKeyId?: string }>
  >([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null)
  const reducedMotion = useReducedMotion()

  /** 刷新告警规则、供应商与余额列表 */
  async function refresh() {
    setLoading(true)
    try {
      const [list, provs, bals, alertEvents, status] = await Promise.all([
        window.api.alerts.list(),
        window.api.providers.list(),
        window.api.balance.latest(),
        window.api.alerts.listEvents(),
        window.api.alerts.notificationStatus()
      ])
      setRules(list)
      setProviders(provs)
      setBalances(bals)
      setEvents(alertEvents)
      setNotificationStatus(status)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  /** 供应商 id 到显示名的映射 */
  const providerNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of providers) m.set(p.id, p.displayName)
    return m
  }, [providers])

  // latest balance per providerId — for displaying "current vs threshold".
  // Multiple keys under the same provider all reference the same latest snapshot,
  // so we keep the most recent by capturedAt.
  // 按 providerId 保留最新一条余额快照,用于展示当前值与阈值对比。
  const latestBalanceByProvider = useMemo(() => {
    const m = new Map<string, BalanceSnapshot & { id: number; apiKeyId?: string }>()
    for (const b of balances) {
      const prev = m.get(b.providerId)
      if (!prev || Date.parse(b.capturedAt) > Date.parse(prev.capturedAt)) {
        m.set(b.providerId, b)
      }
    }
    return m
  }, [balances])

  /** 获取规则对应的币种(优先取该供应商余额快照的币种,默认 USD) */
  function currencyFor(rule: AlertRule): string {
    if (rule.scope === 'provider' && rule.providerId) {
      const snap = latestBalanceByProvider.get(rule.providerId)
      if (snap?.currency) return snap.currency
    }
    return 'USD'
  }

  /** 格式化阈值:百分比指标显示 %,金额指标用 fmtMoney */
  function formatThreshold(rule: AlertRule): string {
    if (rule.metric === 'remaining_pct') return `${rule.threshold}%`
    return fmtMoney(rule.threshold, currencyFor(rule))
  }

  /** 打开新建规则弹窗 */
  function openCreate() {
    setEditingRule(null)
    setModalOpen(true)
  }

  function openEdit(rule: AlertRule) {
    setEditingRule(rule)
    setModalOpen(true)
  }

  /** 切换规则启用状态(乐观更新,失败回滚) */
  async function handleToggle(rule: AlertRule) {
    const next = !rule.enabled
    // optimistic update; rollback on failure
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: next } : r)))
    try {
      await window.api.alerts.toggle(rule.id, next)
    } catch (e) {
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: !next } : r)))
      window.alert(`切换失败：${(e as Error).message}`)
    }
  }

  /** 删除规则(带确认弹窗) */
  async function handleDelete(rule: AlertRule) {
    const providerLabel =
      rule.scope === 'global'
        ? '全局'
        : (providerNameById.get(rule.providerId ?? '') ?? rule.providerId ?? '')
    if (
      !window.confirm(
        `确认删除 ${providerLabel} 的${METRIC_LABEL[rule.metric]}告警规则？\n此操作不可撤销。`
      )
    ) {
      return
    }
    const prev = rules
    setRules((p) => p.filter((r) => r.id !== rule.id))
    setBusy(true)
    try {
      await window.api.alerts.delete(rule.id)
    } catch (e) {
      setRules(prev)
      window.alert(`删除失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  /** 保存新建规则:经 schema 校验后调用 alerts.add */
  async function handleSave(input: AlertRuleInput) {
    setBusy(true)
    try {
      const payload: {
        scope: AlertScope
        providerId?: string
        metric: AlertMetric
        threshold: number
      } = {
        scope: input.scope,
        threshold: input.threshold,
        metric: input.metric
      }
      if (input.scope === 'provider' && input.providerId) payload.providerId = input.providerId
      // parse through the same schema the preload bridge uses, so
      // we get the same exactOptionalPropertyTypes narrowing (e.g. providerId
      // omitted when scope=global). Avoids duplicating Zod's optional-key logic.
      const parsed = alertAddInputSchema.parse(payload) as AlertRuleInput
      if (editingRule) await window.api.alerts.update(editingRule.id, parsed)
      else await window.api.alerts.add(parsed)
      setModalOpen(false)
      setEditingRule(null)
      await refresh()
    } catch (e) {
      window.alert(`保存失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleMarkAllRead() {
    await window.api.alerts.markAllRead()
    const readAt = new Date().toISOString()
    setEvents((current) => current.map((event) => ({ ...event, readAt: event.readAt ?? readAt })))
  }

  async function handleOpenEvent(event: AlertEvent) {
    if (!event.readAt) {
      await window.api.alerts.markEventRead(event.id)
      setEvents((current) =>
        current.map((item) =>
          item.id === event.id ? { ...item, readAt: new Date().toISOString() } : item
        )
      )
    }
    navigate(
      `/providers?provider=${encodeURIComponent(event.providerId)}&alertEvent=${encodeURIComponent(event.id)}`
    )
  }

  const showTable = !loading && rules.length > 0
  const notificationUi = notificationPresentation(notificationStatus)

  return (
    <div className="page-content">
      <PageHeader
        title="用量告警"
        desc="余额越过阈值时通过系统通知提醒，并保留可追溯的事件历史"
        action={
          <button
            className="btn btn-primary"
            onClick={openCreate}
            disabled={busy}
            title="新建告警规则"
          >
            <Icon name="fa-plus" /> 新建规则
          </button>
        }
      />

      <Card motion="status" className="mb-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[13px] font-medium">
              <Icon name={notificationUi.icon} className={notificationUi.iconClass} />
              系统通知
              <span className={`rounded px-2 py-0.5 text-[11px] ${notificationUi.badgeClass}`}>
                {notificationUi.label}
              </span>
            </div>
            <p className="mt-1 text-[12px] text-text-muted">
              {notificationStatus?.detail ?? '正在读取系统通知状态…'}
            </p>
          </div>
          <span className="text-[12px] text-text-muted">
            持续低于阈值不会重复通知，恢复后再次越线才会重触发
          </span>
        </div>
      </Card>

      {loading ? (
        <Card motion="status" className={busy ? 'motion-data-flash' : ''}>
          <EmptyState icon="fa-spinner" title="加载中…" hint="读取告警规则" />
        </Card>
      ) : !showTable ? (
        <Card>
          <EmptyState
            icon="fa-bell"
            title="尚未配置告警规则"
            hint="余额低于阈值时通过系统通知提醒"
            action={
              <button className="btn btn-primary btn-sm mt-2" onClick={openCreate} disabled={busy}>
                <Icon name="fa-plus" /> 创建第一条告警规则
              </button>
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Scope</th>
                  <th>Provider</th>
                  <th>指标</th>
                  <th>阈值</th>
                  <th>启用</th>
                  <th>最近触发</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody className="motion-table-rows">
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <ScopeBadge scope={r.scope} />
                    </td>
                    <td className="text-[12.5px]">
                      {r.scope === 'provider' ? (
                        (providerNameById.get(r.providerId ?? '') ?? r.providerId ?? '—')
                      ) : (
                        <span className="text-text-muted">全部 Provider</span>
                      )}
                    </td>
                    <td className="text-[12.5px]">{METRIC_LABEL[r.metric]}</td>
                    <td className="mono text-[12.5px]">
                      <ThresholdCell rule={r} value={formatThreshold(r)} />
                    </td>
                    <td>
                      <Toggle
                        checked={r.enabled}
                        onChange={() => handleToggle(r)}
                        reducedMotion={reducedMotion}
                      />
                    </td>
                    <td className="text-secondary text-[12px]">
                      {formatRelative(r.lastTriggeredAt)}
                    </td>
                    <td className="text-secondary text-[12px]">
                      {r.createdAt.slice(0, 16).replace('T', ' ')}
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => openEdit(r)}
                          disabled={busy}
                          title="编辑"
                        >
                          <Icon name="fa-pen" />
                        </button>
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => handleDelete(r)}
                          disabled={busy}
                          title="删除"
                        >
                          <Icon name="fa-trash-can" className="text-red" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pt-3 mt-2 border-t border-border-light text-[12px] text-text-muted">
            共 <AnimatedNumber value={rules.length} /> 条规则{busy && ' · 保存中…'}
          </div>
        </Card>
      )}

      <Card
        title="告警事件"
        icon="fa-clock-rotate-left"
        subtitle="最近 100 条，点击可查看对应 Provider"
        className="mt-4"
      >
        {events.length === 0 ? (
          <EmptyState icon="fa-bell" title="暂无告警事件" hint="规则首次越过阈值后会记录在这里" />
        ) : (
          <>
            <div className="mb-3 flex justify-end">
              <button
                className="btn btn-outline btn-sm"
                onClick={() => void handleMarkAllRead()}
                disabled={events.every((event) => event.readAt)}
              >
                全部标为已读
              </button>
            </div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>状态</th>
                    <th>Provider</th>
                    <th>事件</th>
                    <th>通知</th>
                    <th>触发时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody className="motion-table-rows">
                  {events.map((event) => (
                    <tr key={event.id} className={event.readAt ? '' : 'bg-accent-dim/25'}>
                      <td>
                        <span
                          className={`rounded px-2 py-0.5 text-[11px] ${
                            event.readAt
                              ? 'bg-bg-base text-text-muted'
                              : 'bg-status-red-dim text-status-red'
                          }`}
                        >
                          {event.readAt ? '已读' : '未读'}
                        </span>
                      </td>
                      <td className="text-[12.5px]">
                        {providerNameById.get(event.providerId) ?? event.providerId}
                      </td>
                      <td className="max-w-[420px] text-[12.5px]" title={event.message}>
                        {event.message}
                      </td>
                      <td className="text-[12px] text-text-muted">
                        {notificationDeliveryLabel(event)}
                      </td>
                      <td className="text-[12px] text-text-muted">
                        {formatRelative(event.firedAt)}
                      </td>
                      <td>
                        <button
                          className="btn btn-outline btn-xs"
                          onClick={() => void handleOpenEvent(event)}
                        >
                          查看 Provider
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {modalOpen && (
        <RuleModal
          key={editingRule?.id ?? 'new'}
          providers={providers}
          initialRule={editingRule}
          onClose={() => {
            setModalOpen(false)
            setEditingRule(null)
          }}
          onSave={handleSave}
        />
      )}
    </div>
  )
}

function notificationDeliveryLabel(event: AlertEvent): string {
  if (event.notificationStatus === 'shown') return '系统已展示'
  if (event.notificationStatus === 'unsupported') return '系统不支持'
  if (event.notificationStatus === 'failed') {
    return event.notificationError ? `失败：${event.notificationError}` : '发送失败'
  }
  return '待发送'
}

/** 作用域徽标:区分 global 与 provider */
function ScopeBadge({ scope }: { scope: AlertScope }) {
  const isGlobal = scope === 'global'
  const cls = isGlobal ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
  return (
    <span className={`inline-block px-2 py-[2px] rounded text-[11.5px] font-medium ${cls}`}>
      {isGlobal ? 'global' : 'provider'}
    </span>
  )
}

function ThresholdCell({ rule, value }: { rule: AlertRule; value: string }) {
  if (rule.metric !== 'remaining_pct') return <span>{value}</span>
  const threshold = Math.max(0, Math.min(100, rule.threshold))
  return (
    <div className="min-w-[78px]">
      <AnimatedNumber
        value={threshold}
        format={(next) => `${Number.isInteger(next) ? next.toFixed(0) : next.toFixed(1)}%`}
      />
      <ProgressBar
        value={threshold / 100}
        label="剩余百分比告警阈值"
        tone="amber"
        trackClassName="mt-1 h-1 w-16"
      />
    </div>
  )
}

/** 开关组件:可点击或键盘切换的 switch */
function Toggle({
  checked,
  onChange,
  reducedMotion
}: {
  checked: boolean
  onChange: () => void
  reducedMotion: boolean
}) {
  return (
    <span
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onChange()
        }
      }}
      tabIndex={0}
      className={`relative inline-block w-9 h-5 rounded-full cursor-pointer ${
        !reducedMotion ? 'transition-colors' : ''
      } ${checked ? 'bg-accent' : 'bg-border'}`}
    >
      <span
        className={`absolute top-[2px] left-[2px] w-4 h-4 bg-white rounded-full shadow ${
          !reducedMotion ? 'transition-transform' : ''
        } ${checked ? 'translate-x-4' : 'translate-x-0'}`}
      />
    </span>
  )
}

/**
 * 新建告警规则弹窗。
 * @param providers 供应商列表
 * @param onClose 关闭回调
 * @param onSave 保存回调
 */
function RuleModal({
  providers,
  initialRule,
  onClose,
  onSave
}: {
  providers: ProviderManifest[]
  initialRule: AlertRule | null
  onClose: () => void
  onSave: (input: AlertRuleInput) => void | Promise<void>
}) {
  const [scope, setScope] = useState<AlertScope>(initialRule?.scope ?? 'provider')
  const [providerId, setProviderId] = useState<string>(
    initialRule?.providerId ?? providers[0]?.id ?? ''
  )
  const [metric, setMetric] = useState<AlertMetric>(initialRule?.metric ?? 'remaining_amount')
  const [threshold, setThreshold] = useState<string>(
    initialRule ? String(initialRule.threshold) : ''
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  /** 提交表单:校验后组装 payload 并调用 onSave */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (scope === 'provider' && !providerId) {
      return setError('请选择 Provider')
    }
    const n = Number(threshold)
    if (!Number.isFinite(n) || n <= 0) {
      return setError('阈值需为大于 0 的数字')
    }
    if (metric === 'remaining_pct' && n > 100) {
      return setError('百分比阈值不能超过 100')
    }
    setSaving(true)
    try {
      const payload: {
        scope: AlertScope
        providerId?: string
        metric: AlertMetric
        threshold: number
      } = { scope, metric, threshold: n }
      if (scope === 'provider') payload.providerId = providerId
      await onSave(payload)
    } catch (err) {
      setError(`保存失败:${(err as Error).message}`)
      setSaving(false)
    }
  }

  return (
    <Modal title={initialRule ? '编辑告警规则' : '新建告警规则'} onClose={onClose}>
      <form className="space-y-3" onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Scope</label>
          <div className="flex items-center gap-4 text-[13px]">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="scope"
                value="provider"
                checked={scope === 'provider'}
                onChange={() => setScope('provider')}
              />
              指定 Provider
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="scope"
                value="global"
                checked={scope === 'global'}
                onChange={() => setScope('global')}
              />
              全局（任一 Provider 触发即告警）
            </label>
          </div>
        </div>

        {scope === 'provider' && (
          <div className="form-group">
            <label className="form-label">Provider</label>
            <select
              className="select w-full"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
            >
              {providers.length === 0 ? <option value="">(暂无 Provider)</option> : null}
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">指标</label>
          <div className="flex items-center gap-4 text-[13px]">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="metric"
                value="remaining_amount"
                checked={metric === 'remaining_amount'}
                onChange={() => setMetric('remaining_amount')}
              />
              剩余金额
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="metric"
                value="remaining_pct"
                checked={metric === 'remaining_pct'}
                onChange={() => setMetric('remaining_pct')}
              />
              剩余百分比
            </label>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">阈值 {metric === 'remaining_pct' ? '(%)' : '(金额)'}</label>
          <input
            className="input w-full mono"
            type="number"
            min={metric === 'remaining_pct' ? '0' : '0'}
            max={metric === 'remaining_pct' ? '100' : undefined}
            step={metric === 'remaining_pct' ? '0.1' : '0.01'}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder={metric === 'remaining_pct' ? '如 10' : '如 5'}
            required
          />
          <p className="form-hint">
            {metric === 'remaining_pct'
              ? '余额剩余百分比低于该值时触发（0–100）。'
              : '余额剩余金额低于该值时触发。'}
          </p>
        </div>

        {error && <p className="text-[12.5px] text-red">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button
            type="submit"
            className={`btn btn-primary ${saving ? 'motion-data-flash' : ''}`}
            disabled={saving}
          >
            {saving ? '保存中…' : initialRule ? '保存修改' : '保存'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
