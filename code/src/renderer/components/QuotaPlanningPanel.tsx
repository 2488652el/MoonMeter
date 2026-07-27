import type { QuotaPlanningOverview } from '../../shared/types/quota-planning'
import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card } from './Card'

const FORECAST_LABEL = {
  'exhausts-early': '会提前耗尽',
  sustainable: '可持续到重置',
  'may-waste': '可能浪费额度'
} as const

const UNAVAILABLE_LABEL = {
  'insufficient-samples': '至少需要 3 个有效样本',
  'stale-data': '数据已过期',
  'missing-reset': '来源未提供重置时间',
  'window-changed': '额度周期已变化',
  'invalid-data': '样本不可比较'
} as const

function formatTime(value: string | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
}

export function QuotaPlanningPanel({ overview }: { overview: QuotaPlanningOverview | null }) {
  const [searchParams] = useSearchParams()
  const focusedAccount = searchParams.get('focus') === 'quota' ? searchParams.get('account') : null
  const focusedRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focusedAccount) focusedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusedAccount])
  if (!overview || overview.forecasts.length === 0) return null
  return (
    <Card title="额度规划" subtitle="同账户、同周期的稳健速度预测；数据不足时自动失败关闭">
      <div className="grid grid-cols-3 gap-3 max-xl:grid-cols-1">
        {overview.forecasts.slice(0, 6).map(({ window, forecast }) => (
          <div
            key={`${window.sourceId}:${window.accountRef}:${window.windowKey}`}
            ref={window.accountRef === focusedAccount ? focusedRef : undefined}
            className={`rounded-lg border bg-bg-base/40 p-4 ${
              window.accountRef === focusedAccount
                ? 'border-border-focus ring-2 ring-accent/30'
                : 'border-border-light'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold text-text-primary">
                  {window.sourceId} · {window.windowKey}
                </div>
                <div className="mt-1 text-[11px] text-text-muted">
                  更新 {formatTime(window.capturedAt)}
                </div>
              </div>
              <div className="font-mono text-[20px] font-bold text-text-primary">
                {window.usedPercent === undefined
                  ? '—'
                  : `${(100 - window.usedPercent).toFixed(1)}%`}
              </div>
            </div>
            <div className="mt-3 border-t border-border-light pt-3 text-[11.5px]">
              {forecast.available ? (
                <>
                  <div className="font-semibold text-accent-text">
                    {FORECAST_LABEL[forecast.category]}
                  </div>
                  <div className="mt-1 leading-5 text-text-secondary">
                    {forecast.sampleCount} 个样本 · 中位速度 {forecast.medianRatePerHour.toFixed(1)}
                    %/小时 · 预计重置时使用 {forecast.projectedUsedAtReset.toFixed(1)}%
                  </div>
                </>
              ) : (
                <>
                  <div className="font-semibold text-text-secondary">暂不预测</div>
                  <div className="mt-1 text-text-muted">{UNAVAILABLE_LABEL[forecast.reason]}</div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
