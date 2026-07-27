import { Card } from './Card'
import { Icon } from './Icon'
import type {
  LocalPeriodReport,
  LocalReportOverview,
  LocalReportPeriodKind,
  LocalReportRankedItem
} from '../../shared/types/local-report'

function money(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function csvCell(value: string | number): string {
  const text = String(value)
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

function downloadCsv(report: LocalPeriodReport) {
  const rows: Array<Array<string | number>> = [
    ['period', report.period.label],
    ['comparison_period', report.comparisonPeriod.label],
    ['total_cny', report.totalCny],
    ['comparison_total_cny', report.comparisonTotalCny],
    ['change_cny', report.changeCny],
    [],
    ['category', 'label', 'amount_cny', 'requests', 'tokens']
  ]
  const append = (category: string, items: LocalReportRankedItem[]) => {
    for (const item of items)
      rows.push([category, item.label, item.amountCny, item.requests, item.tokens])
  }
  append('provider', report.providers)
  append('model', report.models)
  append('project', report.projects)
  append('high_cost_session', report.highCostSessions)
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n')
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `tokenlub-${report.kind}-report-${report.generatedAt.slice(0, 10)}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function RankedList({ title, items }: { title: string; items: LocalReportRankedItem[] }) {
  return (
    <div className="min-w-0 rounded-lg border border-border-light bg-bg-base p-3">
      <p className="mb-2 text-[11px] font-semibold text-text-secondary">{title}</p>
      {items.length ? (
        <ol className="space-y-1.5">
          {items.map((item, index) => (
            <li
              key={`${item.label}-${index}`}
              className="flex items-center justify-between gap-2 text-[12px]"
            >
              <span className="min-w-0 truncate text-text-primary">
                {index + 1}. {item.label}
              </span>
              <span className="shrink-0 tabular-nums text-text-secondary">
                {money(item.amountCny)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[12px] text-text-muted">当前周期暂无可计价数据</p>
      )}
    </div>
  )
}

function qualityLabel(report: LocalPeriodReport): string {
  const quality = report.dataQuality
  const gaps = [
    quality.estimatedRequests ? `${quality.estimatedRequests} 条当前估算` : '',
    quality.unpricedRequests ? `${quality.unpricedRequests} 条未计价` : '',
    quality.unconvertedCurrencies.length ? `${quality.unconvertedCurrencies.join('/')} 未折算` : ''
  ].filter(Boolean)
  return `${quality.pricedRequests}/${quality.totalRequests} 条有可用成本${gaps.length ? `；${gaps.join('，')}` : ''}`
}

export function LocalReportPanel({
  overview,
  loading,
  error,
  periodKind,
  onPeriodKindChange,
  onRefresh,
  onSetEnabled,
  onSetRecommendationsEnabled
}: {
  overview: LocalReportOverview | null
  loading: boolean
  error: string | null
  periodKind: LocalReportPeriodKind
  onPeriodKindChange: (kind: LocalReportPeriodKind) => void
  onRefresh: () => Promise<void>
  onSetEnabled: (enabled: boolean) => Promise<void>
  onSetRecommendationsEnabled: (enabled: boolean) => Promise<void>
}) {
  const report = overview?.report
  const disabled = overview?.enabled === false
  return (
    <Card
      title="本地周期报告"
      subtitle="同一发生时间与成本口径下的周报/月报；导出不包含路径、会话 ID 或密钥"
      action={
        <div className="flex items-center gap-2">
          {!disabled && (
            <select
              className="h-8 rounded-md border border-border-light bg-bg-base px-2 text-[12px] text-text-primary"
              value={periodKind}
              onChange={(event) => onPeriodKindChange(event.target.value as LocalReportPeriodKind)}
            >
              <option value="week">本周</option>
              <option value="month">本月</option>
            </select>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void onSetEnabled(disabled)}
          >
            {disabled ? '启用报告' : '关闭报告'}
          </button>
        </div>
      }
    >
      {disabled ? (
        <p className="text-[13px] text-text-secondary">
          本地周期报告已关闭，不会在首页读取或汇总报告数据。
        </p>
      ) : loading && !report ? (
        <p className="text-[13px] text-text-secondary">正在汇总本地报告…</p>
      ) : error ? (
        <div className="flex items-center justify-between gap-3 text-[13px] text-red-600">
          <span>{error}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void onRefresh()}
          >
            重试
          </button>
        </div>
      ) : report ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium text-text-primary">{report.period.label}</p>
              <p className="mt-1 text-[12px] text-text-secondary">
                {report.comparisonPeriod.label}，按相同已过时长比较
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void onRefresh()}
              >
                <Icon name="fa-arrows-rotate" /> 刷新
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => downloadCsv(report)}
              >
                <Icon name="fa-file-csv" /> CSV
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-bg-base p-3">
              <p className="text-[11px] text-text-secondary">当前成本</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
                {money(report.totalCny)}
              </p>
              <p className="mt-1 text-[11px] text-text-muted">{report.totalRequests} 条请求</p>
            </div>
            <div className="rounded-lg bg-bg-base p-3">
              <p className="text-[11px] text-text-secondary">同期对比</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
                {money(report.comparisonTotalCny)}
              </p>
              <p className="mt-1 text-[11px] text-text-muted">{report.comparisonRequests} 条请求</p>
            </div>
            <div className="rounded-lg bg-bg-base p-3">
              <p className="text-[11px] text-text-secondary">成本变化</p>
              <p
                className={`mt-1 text-lg font-semibold tabular-nums ${report.changeCny > 0 ? 'text-amber-600' : report.changeCny < 0 ? 'text-emerald-600' : 'text-text-primary'}`}
              >
                {report.changeCny > 0 ? '+' : ''}
                {money(report.changeCny)}
              </p>
              <p className="mt-1 text-[11px] text-text-muted">
                {report.changePercent === undefined
                  ? '同期无可比较成本'
                  : `${report.changePercent > 0 ? '+' : ''}${report.changePercent.toFixed(1)}%`}
              </p>
            </div>
          </div>
          <p className="text-[11.5px] text-text-secondary">口径：{qualityLabel(report)}</p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <RankedList title="Top Provider" items={report.providers} />
            <RankedList title="Top 模型" items={report.models} />
            <RankedList title="Top 项目 / Agent" items={report.projects} />
            <RankedList title="高成本会话" items={report.highCostSessions} />
          </div>
          <div className="rounded-lg border border-border-light bg-bg-base p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[12px] font-semibold text-text-primary">透明使用建议</p>
                <p className="mt-0.5 text-[11px] text-text-secondary">
                  仅比较精确相同模型的已配置价格；不会排序或切换 Provider。
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void onSetRecommendationsEnabled(!report.recommendationsEnabled)}
              >
                {report.recommendationsEnabled ? '关闭建议' : '启用建议'}
              </button>
            </div>
            {!report.recommendationsEnabled ? (
              <p className="mt-3 text-[12px] text-text-secondary">透明建议已关闭。</p>
            ) : report.recommendations.length ? (
              <div className="mt-3 space-y-2">
                {report.recommendations.map((recommendation) => (
                  <div
                    key={`${recommendation.model}-${recommendation.candidateProvider}`}
                    className="rounded-md border border-border-light bg-bg-card p-2.5 text-[12px]"
                  >
                    <p className="font-medium text-text-primary">
                      {recommendation.model}：可评估 {recommendation.candidateProvider}
                    </p>
                    <p className="mt-1 text-text-secondary">
                      同一 token 结构试算 {money(recommendation.estimatedCurrentCny)} →{' '}
                      {money(recommendation.estimatedCandidateCny)}，预计节省{' '}
                      {money(recommendation.savingsCny)}（{recommendation.savingsPercent.toFixed(1)}
                      %）。
                    </p>
                    <p className="mt-1 text-[11px] text-text-muted">{recommendation.reason}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-[12px] text-text-secondary">
                {report.recommendationsUnavailableReason ?? '当前没有可比较建议。'}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </Card>
  )
}
