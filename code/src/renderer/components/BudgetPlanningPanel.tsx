import { useState } from 'react'
import { Card } from './Card'
import { ProgressBar } from './motion'
import type { BudgetOverview, BudgetRuleInput, BudgetScope } from '../../shared/types/budget'

const scopeLabels: Record<BudgetScope, string> = {
  total: '总额',
  provider: 'Provider',
  project: '项目 / Agent'
}

function money(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function coverageLabel(evaluation: BudgetOverview['evaluations'][number]): string {
  const quality = evaluation.dataQuality
  const estimate = quality.estimatedRequests > 0 ? `，${quality.estimatedRequests} 条当前估算` : ''
  const missing = quality.unpricedRequests > 0 ? `，${quality.unpricedRequests} 条未计价` : ''
  const currency = quality.unconvertedCurrencies.length
    ? `，${quality.unconvertedCurrencies.join('/')} 未折算`
    : ''
  return `${quality.pricedRequests}/${quality.totalRequests} 条已计价${estimate}${missing}${currency}`
}

export function BudgetPlanningPanel({
  overview,
  loading,
  error,
  onRefresh
}: {
  overview: BudgetOverview | null
  loading: boolean
  error: string | null
  onRefresh: () => Promise<void>
}) {
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState<BudgetRuleInput>({
    name: '本月总预算',
    periodKind: 'calendar-month',
    scope: 'total',
    limitCny: 100,
    enabled: true
  })

  async function save() {
    setSaving(true)
    setFormError(null)
    try {
      await window.api.budgets.add(form)
      await onRefresh()
      setFormOpen(false)
    } catch (cause) {
      setFormError((cause as Error).message || '预算保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function toggle(id: string, enabled: boolean) {
    await window.api.budgets.toggle(id, enabled)
    await onRefresh()
  }

  async function remove(id: string) {
    await window.api.budgets.delete(id)
    await onRefresh()
  }

  async function markEventRead(id: string) {
    await window.api.budgets.markEventRead(id)
    await onRefresh()
  }

  return (
    <Card
      title="软预算"
      subtitle="仅提醒，不会阻断请求；所有金额按人民币折算并保留成本口径"
      action={
        <button className="btn btn-outline btn-sm" onClick={() => setFormOpen((value) => !value)}>
          {formOpen ? '收起设置' : '新增预算'}
        </button>
      }
    >
      {formOpen ? (
        <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-border-light bg-bg-base/40 p-3 md:grid-cols-3">
          <label>
            <span className="mb-1 block text-[11px] text-text-secondary">名称</span>
            <input
              className="input w-full"
              value={form.name}
              maxLength={80}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </label>
          <label>
            <span className="mb-1 block text-[11px] text-text-secondary">预算上限（CNY）</span>
            <input
              className="input w-full"
              type="number"
              min="0.01"
              step="0.01"
              value={form.limitCny}
              onChange={(event) =>
                setForm((current) => ({ ...current, limitCny: Number(event.target.value) }))
              }
            />
          </label>
          <label>
            <span className="mb-1 block text-[11px] text-text-secondary">范围</span>
            <select
              className="input w-full"
              value={form.scope}
              onChange={(event) =>
                setForm((current) => ({ ...current, scope: event.target.value as BudgetScope }))
              }
            >
              <option value="total">总额</option>
              <option value="provider">Provider</option>
              <option value="project">项目 / Agent</option>
            </select>
          </label>
          {form.scope !== 'total' ? (
            <label>
              <span className="mb-1 block text-[11px] text-text-secondary">
                {form.scope === 'provider' ? 'Provider ID' : '项目 / Agent 包含'}
              </span>
              <input
                className="input w-full"
                value={form.scopeValue ?? ''}
                placeholder={form.scope === 'provider' ? '例如 codex' : '例如 tokenlub'}
                onChange={(event) =>
                  setForm((current) => ({ ...current, scopeValue: event.target.value }))
                }
              />
            </label>
          ) : null}
          <label>
            <span className="mb-1 block text-[11px] text-text-secondary">账期</span>
            <select
              className="input w-full"
              value={form.periodKind}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  periodKind: event.target.value as BudgetRuleInput['periodKind']
                }))
              }
            >
              <option value="calendar-month">自然月</option>
              <option value="custom-cycle">自定义循环账期</option>
            </select>
          </label>
          {form.periodKind === 'custom-cycle' ? (
            <label>
              <span className="mb-1 block text-[11px] text-text-secondary">每月起始日</span>
              <input
                className="input w-full"
                type="number"
                min="1"
                max="28"
                value={form.customCycleStartDay ?? 1}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    customCycleStartDay: Number(event.target.value)
                  }))
                }
              />
            </label>
          ) : null}
          <div className="flex items-end gap-2">
            <button
              className="btn btn-primary btn-sm"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? '保存中…' : '保存预算'}
            </button>
            {formError ? <span className="text-[11px] text-red-600">{formError}</span> : null}
          </div>
        </div>
      ) : null}

      {loading && !overview ? (
        <div className="text-[12px] text-text-muted">正在读取预算…</div>
      ) : null}
      {error ? <div className="text-[12px] text-red-600">{error}</div> : null}
      {!loading && !error && overview?.evaluations.length === 0 ? (
        <div className="text-[12px] text-text-muted">
          尚未设置预算。可按总额、Provider 或项目设置自然月/自定义账期上限。
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {overview?.evaluations.map((evaluation) => {
          const percent = Math.max(0, Math.min(100, evaluation.percentUsed))
          const tone =
            evaluation.percentUsed >= 100
              ? 'red'
              : evaluation.percentUsed >= 80
                ? 'amber'
                : 'accent'
          return (
            <div
              key={evaluation.rule.id}
              className="rounded-lg border border-border-light bg-bg-base/40 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[13px] font-semibold text-text-primary">
                    {evaluation.rule.name}
                  </div>
                  <div className="mt-1 text-[11px] text-text-muted">
                    {scopeLabels[evaluation.rule.scope]}
                    {evaluation.rule.scopeValue ? ` · ${evaluation.rule.scopeValue}` : ''} ·{' '}
                    {evaluation.period.label}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => void toggle(evaluation.rule.id, !evaluation.rule.enabled)}
                  >
                    {evaluation.rule.enabled ? '暂停' : '启用'}
                  </button>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => void remove(evaluation.rule.id)}
                  >
                    删除
                  </button>
                </div>
              </div>
              <div className="mt-3 flex items-baseline justify-between gap-3">
                <span className="text-[18px] font-bold text-text-primary">
                  {money(evaluation.spentCny)}{' '}
                  <span className="text-[12px] font-medium">
                    / {money(evaluation.rule.limitCny)}
                  </span>
                </span>
                <span className="text-[12px] font-semibold text-text-secondary">
                  {evaluation.percentUsed.toFixed(1)}%
                </span>
              </div>
              <div className="mt-2">
                <ProgressBar label="预算已用" value={percent} tone={tone} />
              </div>
              <div className="mt-3 space-y-1 text-[11px] text-text-secondary">
                <div>
                  筛选：
                  {evaluation.filter.providerId
                    ? `Provider=${evaluation.filter.providerId}`
                    : evaluation.filter.projectContains
                      ? `项目包含“${evaluation.filter.projectContains}”`
                      : '全部来源'}
                  ；{evaluation.period.startsAt.slice(0, 10)} 起
                </div>
                <div>{coverageLabel(evaluation)}</div>
                <div>
                  {evaluation.forecast.available
                    ? `按当前速度预计本账期 ${money(evaluation.forecast.projectedCny ?? 0)}`
                    : evaluation.forecast.reason === 'period-too-new'
                      ? '账期不足 6 小时，暂不预测'
                      : '暂无可计价消耗，暂不预测'}
                </div>
                {evaluation.reachedThreshold ? (
                  <div className="font-semibold text-amber-700">
                    已达到 {evaluation.reachedThreshold}% 阶梯提醒
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
      {overview?.recentEvents.length ? (
        <div className="mt-4 border-t border-border-light pt-3">
          <div className="mb-2 text-[11px] font-semibold text-text-secondary">最近预算提醒</div>
          <div className="space-y-2">
            {overview.recentEvents.slice(0, 3).map((event) => (
              <div
                key={event.id}
                className="flex items-center justify-between gap-3 rounded-md bg-bg-base/50 px-3 py-2 text-[11.5px]"
              >
                <span
                  className={event.readAt ? 'text-text-muted' : 'font-medium text-text-primary'}
                >
                  {event.message}
                </span>
                {!event.readAt ? (
                  <button
                    className="shrink-0 text-accent-text hover:underline"
                    onClick={() => void markEventRead(event.id)}
                  >
                    已读
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  )
}
