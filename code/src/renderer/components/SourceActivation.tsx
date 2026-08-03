import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type {
  QuotaPlanningOverview,
  SourceHealth,
  SourceStatus
} from '../../shared/types/quota-planning'
import { Card } from './Card'
import { Icon } from './Icon'

const STATUS_META: Record<SourceStatus, { label: string; dot: string }> = {
  healthy: { label: '可用', dot: 'bg-emerald-500' },
  stale: { label: '已过期', dot: 'bg-status-amber' },
  error: { label: '异常', dot: 'bg-status-red' },
  unavailable: { label: '待连接', dot: 'bg-text-muted' }
}

function sourceTarget(source: SourceHealth): string {
  if (source.sourceType === 'cli-log') {
    return `/logs?source=${encodeURIComponent(source.sourceId)}`
  }
  if (source.accountRef) {
    return `/apikeys?provider=${encodeURIComponent(source.providerId ?? source.sourceId)}&account=${encodeURIComponent(source.accountRef)}`
  }
  return `/providers?provider=${encodeURIComponent(source.providerId ?? source.sourceId)}`
}

function formatAge(value: number | undefined): string {
  if (value === undefined) return '尚无成功数据'
  if (value < 60_000) return '刚刚更新'
  if (value < 3_600_000) return `${Math.max(1, Math.round(value / 60_000))} 分钟前`
  return `${Math.round(value / 3_600_000)} 小时前`
}

export function SourceActivation({
  overview,
  loading,
  error,
  onRefresh,
  compact = false
}: {
  overview: QuotaPlanningOverview | null
  loading: boolean
  error: string | null
  onRefresh: () => void
  compact?: boolean
}) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const focusedSource = searchParams.get('focus') === 'source' ? searchParams.get('source') : null
  const focusedRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (focusedSource) focusedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusedSource])
  const sources = overview?.sources ?? []
  const healthy = sources.filter((source) => source.status === 'healthy').length
  const title = healthy > 0 ? '来源健康中心' : '连接来源，开始看到可信数据'

  return (
    <Card
      title={title}
      subtitle={
        healthy > 0
          ? `${healthy}/${sources.length} 个来源可用；自动检查权限、刷新、数据新鲜度和计价覆盖`
          : 'MoonMeter 会只读发现本机 CLI 与已配置 Provider，不会上传日志、路径或凭据'
      }
      action={
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={onRefresh}
          disabled={loading}
        >
          <Icon name="fa-arrows-rotate" className={loading ? 'icon-spin' : ''} />
          {loading ? '发现中' : '重新检查'}
        </button>
      }
    >
      {error && sources.length === 0 ? (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-2 rounded-lg border border-status-red/20 bg-status-red-dim px-4 py-3 text-[12px] text-status-red"
        >
          <Icon name="fa-circle-exclamation" className="mt-0.5" />
          <span>{error}</span>
        </div>
      ) : sources.length === 0 ? (
        <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-1">
          <ActivationStep
            icon="fa-key"
            title="添加 Provider"
            description="连接已有 API Key 或套餐账户"
            onClick={() => navigate('/apikeys')}
          />
          <ActivationStep
            icon="fa-terminal"
            title="登录本机 CLI"
            description="支持 Codex、Claude Code、Kimi、Gemini 与 OpenCode"
            onClick={() => navigate('/apikeys')}
          />
          <ActivationStep
            icon="fa-file-lines"
            title="解析会话日志"
            description="只读导入本地用量记录"
            onClick={() => navigate('/logs')}
          />
        </div>
      ) : (
        <div
          className={`grid gap-2 ${compact ? 'grid-cols-3 max-xl:grid-cols-1' : 'grid-cols-2 max-lg:grid-cols-1'}`}
        >
          {sources.slice(0, compact ? 3 : 8).map((source) => {
            const meta = STATUS_META[source.status]
            return (
              <button
                key={`${source.sourceId}:${source.accountRef ?? ''}`}
                ref={source.sourceId === focusedSource ? focusedRef : undefined}
                type="button"
                className={`flex items-center justify-between gap-4 rounded-lg border bg-bg-base/40 px-4 py-3 text-left hover:bg-bg-hover ${
                  source.sourceId === focusedSource
                    ? 'border-border-focus ring-2 ring-accent/30'
                    : 'border-border-light'
                }`}
                onClick={() => navigate(sourceTarget(source))}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-[12.5px] font-semibold text-text-primary">
                    <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                    <span className="truncate">{source.accountAlias ?? source.sourceId}</span>
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-text-muted">
                    {source.errorMessage ?? formatAge(source.dataAgeMs)}
                  </span>
                </span>
                <span className="flex-none text-[11px] font-medium text-text-secondary">
                  {meta.label}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {overview?.pricingCoverage ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border-light pt-3 text-[11px] text-text-secondary">
          <span>
            24h 计价覆盖：
            <strong className="ml-1 text-text-primary">
              {overview.pricingCoverage.pricedRequests}/{overview.pricingCoverage.totalRequests}
            </strong>
          </span>
          <span>Provider 成本 {overview.pricingCoverage.providerCostRequests}</span>
          <span>价格快照 {overview.pricingCoverage.priceSnapshotRequests}</span>
          <span>当前估算 {overview.pricingCoverage.currentEstimateRequests}</span>
          <span>未计价 {overview.pricingCoverage.unpricedRequests}</span>
        </div>
      ) : null}
    </Card>
  )
}

function ActivationStep({
  icon,
  title,
  description,
  onClick
}: {
  icon: string
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="min-h-[44px] rounded-lg border border-dashed border-border p-4 text-left hover:border-border-focus hover:bg-bg-hover"
      onClick={onClick}
    >
      <Icon name={icon} className="text-accent-text" />
      <span className="ml-2 font-semibold text-text-primary">{title}</span>
      <span className="mt-1 block text-[11.5px] text-text-muted">{description}</span>
    </button>
  )
}
