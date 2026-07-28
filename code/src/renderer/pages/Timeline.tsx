import { useEffect, useMemo, useState } from 'react'
import { fmtMoney } from '../../shared/utils/money'
import type {
  TimelineEvent,
  TimelineEventStatus,
  TimelineEventType,
  TimelineFilter
} from '../../shared/types/timeline'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'

const EVENT_TYPE_OPTIONS: Array<{ value: TimelineEventType; label: string }> = [
  { value: 'model-call', label: '模型调用' },
  { value: 'session-start', label: '会话开始' },
  { value: 'session-end', label: '会话结束' },
  { value: 'session-resume', label: '会话恢复' },
  { value: 'source-error', label: '来源异常' },
  { value: 'permission-block', label: '权限阻断' },
  { value: 'sync-failure', label: '同步失败' },
  { value: 'quota-alert', label: '额度告警' },
  { value: 'budget-event', label: '预算事件' },
  { value: 'commit', label: 'Commit' },
  { value: 'pr', label: 'PR' },
  { value: 'otel', label: 'OTLP' }
]

const STATUS_OPTIONS: Array<{ value: TimelineEventStatus; label: string }> = [
  { value: 'ok', label: '正常' },
  { value: 'warning', label: '提醒' },
  { value: 'failed', label: '失败' },
  { value: 'blocked', label: '阻断' }
]

const RANGE_OPTIONS = [
  { days: 7, label: '7 天' },
  { days: 30, label: '30 天' },
  { days: 90, label: '90 天' }
]

function eventLabel(event: TimelineEvent): string {
  return (
    EVENT_TYPE_OPTIONS.find((option) => option.value === event.eventType)?.label ?? event.eventType
  )
}

function statusClass(status: TimelineEventStatus): string {
  if (status === 'failed' || status === 'blocked') return 'text-status-red'
  if (status === 'warning') return 'text-amber-700'
  return 'text-emerald-700'
}

function eventSummary(event: TimelineEvent): string {
  if (event.title) return event.title
  if (event.model) return `${event.model} · ${event.totalTokens ?? 0} Token`
  if (event.commitId) return `Commit ${event.commitId.slice(0, 8)}`
  if (event.prLabel) return event.prLabel
  if (event.errorCode) return `错误码：${event.errorCode}`
  return event.sourceId ?? '本地事件'
}

function eventMeta(event: TimelineEvent): string {
  const parts: string[] = []
  if (event.costCny !== undefined) parts.push(fmtMoney(event.costCny))
  if (event.totalTokens !== undefined) parts.push(`${event.totalTokens.toLocaleString()} Token`)
  if (event.durationMs !== undefined) parts.push(`${event.durationMs} ms`)
  if (event.changedFiles !== undefined) parts.push(`${event.changedFiles} 文件`)
  return parts.join(' · ')
}

export default function Timeline() {
  const [days, setDays] = useState(30)
  const [eventType, setEventType] = useState<TimelineEventType | 'all'>('all')
  const [status, setStatus] = useState<TimelineEventStatus | 'all'>('all')
  const [rows, setRows] = useState<TimelineEvent[]>([])
  const [nextCursor, setNextCursor] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fromISO = useMemo(
    () => new Date(Date.now() - days * 24 * 60 * 60_000).toISOString(),
    [days]
  )

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    const filter: TimelineFilter = {
      limit: 50,
      fromISO,
      ...(eventType !== 'all' ? { eventTypes: [eventType] } : {}),
      ...(status !== 'all' ? { status } : {})
    }
    window.api.timeline
      .list(filter)
      .then((page) => {
        if (!alive) return
        setRows(page.rows)
        setNextCursor(page.nextCursor)
      })
      .catch(() => {
        if (alive) setError('时间线读取失败，请稍后重试')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [eventType, fromISO, status])

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await window.api.timeline.list({
        limit: 50,
        cursor: nextCursor,
        fromISO,
        ...(eventType !== 'all' ? { eventTypes: [eventType] } : {}),
        ...(status !== 'all' ? { status } : {})
      })
      setRows((current) => [...current, ...page.rows])
      setNextCursor(page.nextCursor)
    } catch {
      setError('加载更多事件失败')
    } finally {
      setLoadingMore(false)
    }
  }

  async function cleanup() {
    await window.api.timeline.cleanup().catch(() => undefined)
  }

  return (
    <div className="page-content">
      <PageHeader
        title="时间线"
        desc="按时间浏览本地用量、来源健康、预算与交付事件；详细事件保留 90 天后聚合"
        action={
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void cleanup()}>
            <Icon name="fa-broom" /> 清理旧详情
          </button>
        }
      />

      <Card className="mb-4" bodyClassName="py-3" motion="none">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-md border border-border-light bg-bg-card p-1">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.days}
                type="button"
                className={`rounded px-2.5 py-1.5 text-[11px] ${days === option.days ? 'bg-text-primary text-bg-base' : 'text-text-muted hover:bg-bg-hover'}`}
                onClick={() => setDays(option.days)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <select
            className="select"
            value={eventType}
            onChange={(event) => setEventType(event.target.value as TimelineEventType | 'all')}
            aria-label="事件类型"
          >
            <option value="all">全部类型</option>
            {EVENT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={status}
            onChange={(event) => setStatus(event.target.value as TimelineEventStatus | 'all')}
            aria-label="事件状态"
          >
            <option value="all">全部状态</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {error && (
        <div className="mb-4 rounded border border-status-red/20 bg-status-red-dim px-3 py-2 text-[12px] text-status-red">
          {error}
        </div>
      )}
      {loading ? (
        <Card>
          <EmptyState icon="fa-spinner" title="正在读取时间线" variant="loading" />
        </Card>
      ) : rows.length ? (
        <Card title="事件流" subtitle={`最近 ${days} 天 · ${rows.length} 条已加载`}>
          <div className="space-y-2">
            {rows.map((event) => (
              <div
                key={event.id}
                className="grid grid-cols-[112px_110px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border-light bg-bg-base/35 px-3 py-2.5 max-md:grid-cols-1"
              >
                <time className="font-mono text-[10px] text-text-muted" dateTime={event.occurredAt}>
                  {new Date(event.occurredAt).toLocaleString()}
                </time>
                <div className="flex items-center gap-2 text-[11px]">
                  <span
                    className={`h-1.5 w-1.5 rounded-full bg-current ${statusClass(event.status)}`}
                  />
                  <span className="text-text-secondary">{eventLabel(event)}</span>
                </div>
                <div className="min-w-0">
                  <div
                    className="truncate text-[12px] text-text-primary"
                    title={eventSummary(event)}
                  >
                    {eventSummary(event)}
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-text-muted">
                    {[event.workspaceId, event.taskId, event.toolCategory]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <div className="text-right font-mono text-[10px] text-text-muted max-md:text-left">
                  {eventMeta(event)}
                </div>
              </div>
            ))}
          </div>
          {nextCursor && (
            <button
              type="button"
              className="btn btn-outline btn-sm mt-4 w-full"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? '加载中…' : '加载更多'}
            </button>
          )}
        </Card>
      ) : (
        <Card>
          <EmptyState icon="fa-stream" title="暂无时间线事件" hint="调整时间范围或筛选条件后重试" />
        </Card>
      )}
    </div>
  )
}
