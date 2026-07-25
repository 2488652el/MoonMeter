/**
 * 供应商汇总页面:按供应商维度聚合费用与用量,提供三种视图(按供应商/按模型/按费用趋势),
 * 含费用占比环形图、Top 5 排行、明细表格与每日费用趋势折线图。
 */
import { Icon } from '../components/Icon'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { Tabs, type TabDef } from '../components/Tabs'
import { AnimatedNumber, MotionGroup, ProgressBar } from '../components/motion'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { fmtCount, fmtMoney, formatPct } from '../../shared/utils/money'
import {
  computeTrend,
  buildDailyCostSeries,
  providerWeekWindows,
  topModelsForProvider
} from '../../shared/utils/provider-aggregation'
import type { DashboardSummary, ModelSpendAggregate, UsageRecord } from '../../shared/types/usage'
import {
  readUsageAnalysisFilter,
  usageAnalysisFilterToQuery,
  usageRangeLabel
} from '../../shared/utils/usage-analysis-filter'

/** 8-color palette — derived from tailwind status colors. */
// 供应商配色:8 色调色板,源自 tailwind 状态色。
const PROVIDER_PALETTE = [
  '#10B981',
  '#3B82F6',
  '#8B5CF6',
  '#F59E0B',
  '#EF4444',
  '#EC4899',
  '#F97316',
  '#6366F1'
]

/** 标签页类型:按供应商 / 按模型 / 按费用趋势 */
type TabKey = 'provider' | 'model' | 'trend'

/** 标签页定义列表 */
const TAB_DEFS: TabDef<TabKey>[] = [
  { key: 'provider', label: 'By Provider', icon: 'fa-server' },
  { key: 'model', label: 'By Model', icon: 'fa-cubes' },
  { key: 'trend', label: 'By Cost Trend', icon: 'fa-arrow-trend-up' }
]

/**
 * trend -> CSS class. +tint red for growth, amber for drop.
 * We use colorblind-safe status tokens already defined in tailwind.css.
 *
 * (The trend itself is computed by `computeTrend` from
 * `shared/utils/provider-aggregation` - extracted so it's unit-testable
 * without mounting React.)
 *
 * 趋势值映射为 CSS 类:增长偏红、下降偏琥珀。
 */
function trendClass(t: number | null): string {
  if (t === null) return 'text-text-muted'
  if (t > 0.5) return 'text-status-red'
  if (t < -0.5) return 'text-status-amber'
  return 'text-text-muted'
}

/** conic-gradient donut without any chart library.
 *
 * 供应商费用占比环形图:纯 CSS conic-gradient 实现,无需图表库。 */
function DonutChart({ providers }: { providers: DashboardSummary['providers'] }) {
  const reducedMotion = useReducedMotion()
  const [ready, setReady] = useState(reducedMotion)
  const circumference = 2 * Math.PI * 55
  let cursor = 0

  useEffect(() => {
    if (reducedMotion) {
      setReady(true)
      return
    }
    setReady(false)
    const frame = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(frame)
  }, [providers, reducedMotion])

  return (
    <div className="flex items-center gap-6">
      <div className="w-[140px] h-[140px] rounded-full relative flex-shrink-0">
        <svg
          className="absolute inset-0 -rotate-90"
          viewBox="0 0 140 140"
          aria-label={`${providers.length} 个 Provider 的费用占比`}
          role="img"
        >
          <circle
            cx="70"
            cy="70"
            r="55"
            fill="none"
            stroke="rgb(var(--color-line) / 0.08)"
            strokeWidth="18"
          />
          {providers.map((provider, index) => {
            const start = cursor
            cursor += provider.pct
            return (
              <circle
                key={provider.providerId}
                cx="70"
                cy="70"
                r="55"
                fill="none"
                stroke={PROVIDER_PALETTE[index % PROVIDER_PALETTE.length] ?? '#10B981'}
                strokeWidth="18"
                strokeDasharray={`${ready ? provider.pct * circumference : 0} ${circumference}`}
                strokeDashoffset={-start * circumference}
                style={{
                  transition: reducedMotion
                    ? 'none'
                    : 'stroke-dasharray 560ms cubic-bezier(0.22, 1, 0.36, 1)'
                }}
              />
            )
          })}
        </svg>
        <div className="absolute inset-[18px] bg-bg-card rounded-full flex items-center justify-center">
          <AnimatedNumber
            value={providers.length}
            format={(value) => Math.round(value).toLocaleString('en-US')}
            className="text-[18px] font-semibold text-text-primary"
          />
        </div>
      </div>
      <ul className="flex-1 space-y-1.5 min-w-0">
        {providers.slice(0, 6).map((p, i) => (
          <li key={p.providerId} className="flex items-center gap-2 text-[12.5px]">
            <span
              className="w-3 h-3 rounded-sm flex-shrink-0"
              style={{ background: PROVIDER_PALETTE[i % PROVIDER_PALETTE.length] }}
            />
            <span className="text-text-primary truncate">{p.providerId}</span>
            <span className="ml-auto text-text-muted font-mono">{(p.pct * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 每日费用趋势折线图:展示最高/最低点标注 */
function DailyCostLineChart({
  daily,
  days,
  now
}: {
  daily: DashboardSummary['daily']
  days: number
  now: Date
}) {
  const reducedMotion = useReducedMotion()
  const points = buildDailyCostSeries(daily, days, now)
  if (!points.length) return null

  const highest = points.reduce(
    (best, point) => (point.cost > best.cost ? point : best),
    points[0]!
  )
  const nonZero = points.filter((point) => point.cost > 0)
  const lowest = nonZero.length
    ? nonZero.reduce((best, point) => (point.cost < best.cost ? point : best), nonZero[0]!)
    : null

  return (
    <div>
      <div className="h-[240px] min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 10, right: 18, bottom: 8, left: 4 }}>
            <CartesianGrid
              stroke="rgb(var(--color-line) / 0.1)"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: 'rgb(var(--color-muted))' }}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              width={64}
              tick={{ fontSize: 11, fill: 'rgb(var(--color-muted))' }}
              tickFormatter={(v) => fmtMoney(Number(v))}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              formatter={(value: number) => fmtMoney(value)}
              labelFormatter={(label, payload) => {
                const point = payload?.[0]?.payload as { date?: string } | undefined
                return point?.date ?? String(label)
              }}
            />
            <Line
              type="monotone"
              dataKey="cost"
              stroke="rgb(var(--color-accent))"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={!reducedMotion}
              animationDuration={640}
              animationEasing="ease-out"
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-4 mt-3 text-[11.5px] text-text-muted">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 bg-status-red rounded-full inline-block" />
          最高 {highest ? `${highest.date} ${fmtMoney(highest.cost)}` : '—'}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 bg-status-amber rounded-full inline-block" />
          最低 {lowest ? `${lowest.date} ${fmtMoney(lowest.cost)}` : '—'}
        </span>
      </div>
    </div>
  )
}

/**
 * 供应商汇总页面组件。
 * 根据时间范围拉取仪表盘、日志与模型消费数据,按标签页渲染不同视图。
 */
export default function ProviderSummary() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const requestedProvider = searchParams.get('provider')
  const [tab, setTab] = useState<TabKey>('provider')
  const analysisFilter = useMemo(() => readUsageAnalysisFilter(window.localStorage), [])
  const analysisQuery = useMemo(() => usageAnalysisFilterToQuery(analysisFilter), [analysisFilter])
  const rangeLabel = usageRangeLabel(analysisFilter)

  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [logs, setLogs] = useState<UsageRecord[]>([])
  const [modelSpend, setModelSpend] = useState<ModelSpendAggregate[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const now = useMemo(() => new Date(), [])

  useEffect(() => {
    if (!requestedProvider || loading) return
    setTab('provider')
    document
      .getElementById(`provider-${encodeURIComponent(requestedProvider)}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [loading, requestedProvider])

  useEffect(() => {
    let alive = true
    setLoading(true)

    const filter: Parameters<typeof window.api.usage.getLogs>[0] = {
      ...analysisQuery,
      limit: 5000
    }

    Promise.all([
      window.api.usage.getDashboard(analysisQuery),
      window.api.usage.getLogs(filter),
      window.api.usage.getModelSpend(analysisQuery)
    ])
      .then(([d, l, m]) => {
        if (!alive) return
        setSummary(d)
        setLogs(l ?? [])
        setModelSpend(m ?? [])
      })
      .catch(() => {
        if (!alive) return
        setSummary(null)
        setLogs([])
        setModelSpend([])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [analysisQuery, reloadKey])

  /** 刷新已入库的用量并触发重新加载 */
  async function handleRefresh() {
    setRefreshing(true)
    try {
      await window.api.usage.refreshAll()
      // bump a counter so the load effect re-runs without the
      // user having to flip range back and forth.
      setReloadKey((k) => k + 1)
    } finally {
      setRefreshing(false)
    }
  }

  if (loading) {
    return (
      <div className="page-content">
        <PageHeader title="Provider 汇总" desc="按供应商维度聚合费用与用量数据" />
        <Card>
          <p className="text-text-muted text-[13px] py-6 text-center">加载中…</p>
        </Card>
      </div>
    )
  }

  const providers = summary?.providers ?? []
  const empty = providers.length === 0 && logs.length === 0

  // Top-5 ranking kept from Phase E
  const topProviders = [...providers].sort((a, b) => b.cost - a.cost).slice(0, 5)

  const trendDays = Math.max(summary?.daily.length ?? 0, 1)

  return (
    <div className="page-content">
      <PageHeader
        title="Provider 汇总"
        desc="按供应商维度聚合费用与用量数据"
        action={
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-border-light bg-bg-card px-3 py-1.5 text-[12px] text-text-secondary">
              统一筛选：{rangeLabel}
            </span>
            <button
              className="btn btn-outline btn-sm"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <Icon name="fa-arrows-rotate" /> 刷新
            </button>
          </div>
        }
      />

      <Tabs tabs={TAB_DEFS} active={tab} onChange={setTab} />

      {empty ? (
        <Card>
          <EmptyState
            icon="fa-chart-pie"
            title="暂无 Provider 数据"
            hint="先去 API Keys 解析本机会话，或刷新一次余额"
            action={
              <div className="flex gap-2 mt-2">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleRefresh}
                  disabled={refreshing}
                >
                  <Icon name="fa-arrows-rotate" /> 刷新用量
                </button>
                <button className="btn btn-outline btn-sm" onClick={() => navigate('/apikeys')}>
                  <Icon name="fa-arrow-right" /> 前往 API Keys
                </button>
              </div>
            }
          />
        </Card>
      ) : tab === 'provider' ? (
        <>
          <div className="grid grid-cols-[2fr_1fr] gap-4 mb-4 max-md:grid-cols-1">
            <Card
              title="费用占比"
              icon="fa-chart-pie"
              subtitle={`${rangeLabel}各 Provider 费用占比`}
            >
              <DonutChart providers={providers} />
            </Card>
            <Card title="费用 Top 5" icon="fa-fire" subtitle={`${rangeLabel} — 按费用降序`}>
              <MotionGroup className="space-y-2">
                {topProviders.map((p, i) => (
                  <li key={p.providerId} className="text-[13px]">
                    <div className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-full bg-accent-dim text-accent-text text-[11px] font-semibold flex items-center justify-center">
                        {i + 1}
                      </span>
                      <span className="text-text-primary flex-1 truncate">{p.providerId}</span>
                      <AnimatedNumber
                        value={p.cost}
                        format={fmtMoney}
                        className="text-text-secondary font-mono"
                      />
                    </div>
                    <ProgressBar
                      value={topProviders[0]?.cost ? p.cost / topProviders[0].cost : 0}
                      label={`${p.providerId} 费用排行`}
                      className="ml-8 mt-1"
                    />
                  </li>
                ))}
              </MotionGroup>
            </Card>
          </div>

          <Card
            title="Provider 明细"
            icon="fa-server"
            subtitle={`${rangeLabel} — 趋势按最近 7 天 vs 上 7 天对比`}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-text-muted text-left">
                  <tr>
                    <th className="py-2 font-medium">Provider</th>
                    <th className="py-2 font-medium text-right">费用</th>
                    <th className="py-2 font-medium text-right">Tokens</th>
                    <th className="py-2 font-medium text-right">占比</th>
                    <th className="py-2 font-medium text-left">主要模型 Top 3</th>
                    <th className="py-2 font-medium text-right">趋势</th>
                  </tr>
                </thead>
                <tbody className="motion-table-rows text-text-primary">
                  {providers.map((p) => {
                    const top = topModelsForProvider(logs, p.providerId, 3)
                    const pw = providerWeekWindows(now, logs, p.providerId)
                    const trend = computeTrend(pw.currentWeek, pw.previousWeek)
                    const arrow =
                      trend === null ? '—' : trend > 0.5 ? '▲' : trend < -0.5 ? '▼' : '·'
                    return (
                      <tr
                        id={`provider-${encodeURIComponent(p.providerId)}`}
                        key={p.providerId}
                        className={`border-t border-border-light align-top ${
                          requestedProvider === p.providerId ? 'bg-accent-dim/40' : ''
                        }`}
                      >
                        <td className="py-2">{p.providerId}</td>
                        <td className="py-2 text-right font-mono">{fmtMoney(p.cost)}</td>
                        <td className="py-2 text-right font-mono">
                          {p.tokens.toLocaleString('en-US')}
                        </td>
                        <td className="py-2 text-right font-mono">{(p.pct * 100).toFixed(1)}%</td>
                        <td className="py-2">
                          {top.length === 0 ? (
                            <span className="text-text-muted">—</span>
                          ) : (
                            <ul className="space-y-0.5">
                              {top.map((m) => (
                                <li key={m.model} className="flex items-center gap-2">
                                  <span
                                    className="text-text-primary truncate max-w-[180px]"
                                    title={m.model}
                                  >
                                    {m.model}
                                  </span>
                                  <span className="ml-auto text-text-muted font-mono">
                                    {fmtMoney(m.cost)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className={`py-2 text-right font-mono ${trendClass(trend)}`}>
                          {arrow} {formatPct(trend)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : tab === 'model' ? (
        <Card
          title="模型聚合"
          icon="fa-cubes"
          subtitle={`${rangeLabel} — 跨 Provider 按 model 聚合`}
        >
          {modelSpend.length === 0 ? (
            <EmptyState icon="fa-cubes" title="暂无可用模型记录" hint="等数据回流后会自动出现" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-text-muted text-left">
                  <tr>
                    <th className="py-2 font-medium">Model</th>
                    <th className="py-2 font-medium text-left">Provider(s)</th>
                    <th className="py-2 font-medium text-right">费用</th>
                    <th className="py-2 font-medium text-right">Tokens</th>
                    <th className="py-2 font-medium text-right">请求数</th>
                  </tr>
                </thead>
                <tbody className="motion-table-rows text-text-primary">
                  {modelSpend.map((m) => (
                    <tr key={m.model} className="border-t border-border-light">
                      <td className="py-2 font-mono" title={m.model}>
                        {m.model}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          {m.providers.map((p) => (
                            <span
                              key={p}
                              className="px-1.5 py-[1px] rounded text-[11px] bg-bg-base border border-border-light text-text-secondary"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 text-right font-mono">{fmtMoney(m.total, m.currency)}</td>
                      <td className="py-2 text-right font-mono">{fmtCount(m.tokens)}</td>
                      <td className="py-2 text-right font-mono">
                        {m.requests.toLocaleString('en-US')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        // tab === 'trend'
        <Card
          title="每日费用趋势"
          icon="fa-arrow-trend-up"
          subtitle={`${rangeLabel}每日成本 — 红色为最高 / 琥珀为最低`}
        >
          {summary && summary.daily.length > 0 ? (
            <DailyCostLineChart daily={summary.daily} days={trendDays} now={now} />
          ) : (
            <EmptyState icon="fa-arrow-trend-up" title="暂无每日数据" hint="缩短时间窗口后再看" />
          )}
        </Card>
      )}
    </div>
  )
}
