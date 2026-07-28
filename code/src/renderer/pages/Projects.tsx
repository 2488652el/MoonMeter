import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fmtMoney } from '../../shared/utils/money'
import type { ProjectDetail, ProjectSummary } from '../../shared/types/project'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'

const RANGE_OPTIONS = [
  { days: 7, label: '7 天' },
  { days: 30, label: '30 天' },
  { days: 90, label: '90 天' }
]

function environmentLabel(project: ProjectSummary): string {
  if (project.environment === 'legacy') return '历史日志'
  return project.environment === 'wsl'
    ? `WSL · ${project.wslDistribution ?? '未知发行版'}`
    : 'Windows'
}

function formatTokens(value: number): string {
  return value.toLocaleString('en-US')
}

function ProjectDetailPanel({
  detail,
  onRefresh
}: {
  detail: ProjectDetail
  onRefresh: () => void
}) {
  const [taskName, setTaskName] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [prUrl, setPrUrl] = useState('')
  const [prLabel, setPrLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const canMutateWorkspace = detail.environment !== 'legacy'

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canMutateWorkspace || !taskName.trim() || busy) return
    setBusy(true)
    setMessage(null)
    try {
      await window.api.tasks.add({ name: taskName.trim(), workspaceId: detail.id })
      setTaskName('')
      setMessage('任务已创建')
      onRefresh()
    } catch {
      setMessage('任务创建失败')
    } finally {
      setBusy(false)
    }
  }

  async function updateTask(taskId: string, status: 'active' | 'completed') {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      await window.api.tasks.update(taskId, { status })
      setMessage(status === 'completed' ? '任务已完成' : '任务已恢复')
      onRefresh()
    } catch {
      setMessage('任务更新失败')
    } finally {
      setBusy(false)
    }
  }

  async function assignSession(sourceConfigId: string | undefined, sessionId: string) {
    if (!selectedTaskId || !sourceConfigId || busy) return
    setBusy(true)
    setMessage(null)
    try {
      await window.api.tasks.assignSession({
        taskId: selectedTaskId,
        sourceConfigId,
        sessionId
      })
      setMessage('会话已手动归属到任务')
      onRefresh()
    } catch {
      setMessage('会话归属失败，请确认任务与会话属于同一项目')
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelivery(deliveryId: string) {
    if (!selectedTaskId || busy) return
    setBusy(true)
    setMessage(null)
    try {
      await window.api.tasks.confirmDelivery(deliveryId, selectedTaskId)
      setMessage('交付已确认归属')
      onRefresh()
    } catch {
      setMessage('交付确认失败，请确认任务与项目匹配')
    } finally {
      setBusy(false)
    }
  }

  async function addPr(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canMutateWorkspace || !prUrl.trim() || busy) return
    setBusy(true)
    setMessage(null)
    try {
      await window.api.tasks.addPr({
        workspaceId: detail.id,
        url: prUrl.trim(),
        ...(selectedTaskId ? { taskId: selectedTaskId } : {}),
        ...(prLabel.trim() ? { label: prLabel.trim() } : {})
      })
      setPrUrl('')
      setPrLabel('')
      setMessage('HTTPS PR 链接已记录')
      onRefresh()
    } catch {
      setMessage('PR 记录失败，仅支持不含凭据的 HTTPS URL')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      className="mt-4"
      title={`项目详情 · ${detail.name}`}
      subtitle="Git 交付指标仅表示仓库变化，不将 commit 自动归因到某次会话"
    >
      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        {[
          ['成本', fmtMoney(detail.costCny)],
          ['Token', formatTokens(detail.tokens)],
          ['会话', formatTokens(detail.sessions)],
          ['活跃天数', formatTokens(detail.activeDays)],
          ['Commit', formatTokens(detail.commitCount)],
          ['变更文件', formatTokens(detail.changedFiles)],
          ['新增行', formatTokens(detail.additions)],
          ['删除行', formatTokens(detail.deletions)]
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-md border border-border-light bg-bg-base/40 px-3 py-2"
          >
            <div className="text-[10px] text-text-muted">{label}</div>
            <div className="mt-1 font-mono text-[14px] text-text-primary">{value}</div>
          </div>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <div>
          <div className="mb-2 text-[12px] font-semibold text-text-primary">模型构成</div>
          {detail.models.length ? (
            <div className="space-y-1.5 text-[12px]">
              {detail.models.slice(0, 12).map((model) => (
                <div key={model.model} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-text-secondary" title={model.model}>
                    {model.model}
                  </span>
                  <span className="shrink-0 font-mono text-text-primary">
                    {fmtMoney(model.costCny)} · {formatTokens(model.tokens)} T
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[12px] text-text-muted">暂无模型数据</span>
          )}
        </div>
        <div>
          <div className="mb-2 text-[12px] font-semibold text-text-primary">最近会话</div>
          {detail.sessionDetails.length ? (
            <div className="space-y-1.5 text-[12px]">
              {detail.sessionDetails.slice(0, 10).map((session) => (
                <div
                  key={session.sessionId}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span
                    className="min-w-0 truncate font-mono text-text-secondary"
                    title={session.sessionId}
                  >
                    {session.sessionId.slice(0, 16)}
                  </span>
                  <div className="flex items-center gap-2 text-text-muted">
                    <span>
                      {formatTokens(session.tokens)} T · {session.requests} 次
                    </span>
                    {canMutateWorkspace && session.sourceId && detail.tasks.length > 0 && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        disabled={busy || !selectedTaskId}
                        onClick={() => void assignSession(session.sourceId, session.sessionId)}
                      >
                        归属任务
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[12px] text-text-muted">暂无会话数据</span>
          )}
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 text-[12px] font-semibold text-text-primary">Git 交付趋势</div>
        {detail.deliveries.length ? (
          <div className="space-y-1.5 text-[12px]">
            {detail.deliveries.slice(0, 12).map((delivery) => (
              <div key={delivery.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0 truncate text-text-secondary" title={delivery.title}>
                  {delivery.commitId?.slice(0, 8) ?? delivery.prLabel ?? '手动 PR'} ·{' '}
                  {delivery.title ?? delivery.prUrl ?? '未命名交付'}
                  {delivery.taskId && (
                    <span className="ml-2 text-[10px] text-emerald-700">已归属任务</span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2 font-mono text-text-muted">
                  <span>
                    {delivery.changedFiles} 文件 · +{delivery.additions} / -{delivery.deletions}
                  </span>
                  {canMutateWorkspace && !delivery.taskId && detail.tasks.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs font-sans"
                      disabled={busy || !selectedTaskId}
                      onClick={() => void confirmDelivery(delivery.id)}
                    >
                      确认归属
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <span className="text-[12px] text-text-muted">暂无 Git 或手动 PR 记录</span>
        )}
      </div>

      <div className="mt-5 rounded-lg border border-border-light bg-bg-base/35 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[12px] font-semibold text-text-primary">任务与人工归属</div>
            <div className="mt-0.5 text-[10px] text-text-muted">
              只在你确认后建立会话/交付与任务的关系，不自动推断。
            </div>
          </div>
          {!canMutateWorkspace && (
            <span className="text-[10px] text-text-muted">历史日志项目只读</span>
          )}
        </div>
        {canMutateWorkspace ? (
          <>
            <form className="flex flex-wrap gap-2" onSubmit={(event) => void createTask(event)}>
              <input
                className="input min-w-[220px] flex-1"
                value={taskName}
                onChange={(event) => setTaskName(event.target.value)}
                placeholder="例如：重构登录流程"
                aria-label="新任务名称"
                maxLength={120}
              />
              <button
                type="submit"
                className="btn btn-outline btn-sm"
                disabled={busy || !taskName.trim()}
              >
                <span>新建任务</span>
              </button>
            </form>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="text-[11px] text-text-muted" htmlFor="project-task-select">
                当前操作任务
              </label>
              <select
                id="project-task-select"
                className="select"
                value={selectedTaskId || detail.tasks[0]?.id || ''}
                onChange={(event) => setSelectedTaskId(event.target.value)}
              >
                <option value="">请选择任务</option>
                {detail.tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.name} · {task.status === 'completed' ? '已完成' : '进行中'}
                  </option>
                ))}
              </select>
              {message && <span className="text-[11px] text-accent-text">{message}</span>}
            </div>
            {detail.tasks.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {detail.tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between gap-2 text-[11px]"
                  >
                    <span className="min-w-0 truncate text-text-secondary">{task.name}</span>
                    <span className="shrink-0 text-text-muted">
                      {task.sessionCount} 会话 · {task.deliveryEventCount} 交付
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs ml-2"
                        disabled={busy}
                        onClick={() =>
                          void updateTask(
                            task.id,
                            task.status === 'completed' ? 'active' : 'completed'
                          )
                        }
                      >
                        {task.status === 'completed' ? '恢复' : '完成'}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <form
              className="mt-4 grid gap-2 md:grid-cols-[1fr_180px_auto]"
              onSubmit={(event) => void addPr(event)}
            >
              <input
                className="input"
                type="url"
                value={prUrl}
                onChange={(event) => setPrUrl(event.target.value)}
                placeholder="https://github.com/org/repo/pull/123"
                aria-label="HTTPS PR 链接"
                maxLength={2000}
              />
              <input
                className="input"
                value={prLabel}
                onChange={(event) => setPrLabel(event.target.value)}
                placeholder="PR 标题（可选）"
                aria-label="PR 标题"
                maxLength={160}
              />
              <button
                type="submit"
                className="btn btn-outline btn-sm"
                disabled={busy || !prUrl.trim()}
              >
                记录 PR
              </button>
            </form>
            <div className="mt-1 text-[10px] text-text-muted">
              仅保存手动提供的 HTTPS 链接，不抓取远端仓库或 PR 内容。
            </div>
          </>
        ) : (
          <div className="text-[11px] text-text-muted">
            如需任务归属，请先从已启用来源生成工作区项目。
          </div>
        )}
      </div>
    </Card>
  )
}

export default function Projects() {
  const [searchParams] = useSearchParams()
  const [days, setDays] = useState(30)
  const [page, setPage] = useState<{ rows: ProjectSummary[]; total: number } | null>(null)
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [selectedId, setSelectedId] = useState(searchParams.get('project'))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    window.api.projects
      .overview({ days, limit: 500 })
      .then((result) => {
        if (alive) setPage(result)
      })
      .catch(() => {
        if (alive) setError('项目聚合失败，请稍后重试')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [days])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let alive = true
    window.api.projects
      .detail(selectedId, days)
      .then((result) => {
        if (alive) setDetail(result)
      })
      .catch(() => {
        if (alive) setDetail(null)
      })
    return () => {
      alive = false
    }
  }, [selectedId, days])

  function refreshDetail() {
    if (!selectedId) return
    void window.api.projects
      .detail(selectedId, days)
      .then((result) => setDetail(result))
      .catch(() => setDetail(null))
  }

  return (
    <div className="page-content">
      <PageHeader
        title="项目用量"
        desc="由 Main / SQLite 聚合成本、Token、会话与 Git 交付，不再把最多 10,000 条日志拉到 Renderer"
        action={
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
        }
      />

      {error && (
        <div className="mb-4 rounded border border-status-red/20 bg-status-red-dim px-3 py-2 text-[12px] text-status-red">
          {error}
        </div>
      )}
      {loading && !page ? (
        <Card>
          <EmptyState icon="fa-spinner" title="正在聚合项目数据" variant="loading" />
        </Card>
      ) : page?.rows.length ? (
        <Card title="项目总览" subtitle={`最近 ${days} 天 · 共 ${page.total} 个项目`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[12px]">
              <thead className="text-[10px] text-text-muted">
                <tr>
                  <th className="pb-2 font-medium">项目</th>
                  <th className="pb-2 font-medium">环境</th>
                  <th className="pb-2 text-right font-medium">成本</th>
                  <th className="pb-2 text-right font-medium">Token</th>
                  <th className="pb-2 text-right font-medium">会话</th>
                  <th className="pb-2 text-right font-medium">活跃天</th>
                  <th className="pb-2 text-right font-medium">Git 交付</th>
                  <th className="pb-2 text-right font-medium">未计价</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((project) => (
                  <tr
                    key={project.id}
                    className={`cursor-pointer border-t border-border-light hover:bg-bg-hover/50 ${selectedId === project.id ? 'bg-accent-dim' : ''}`}
                    onClick={() => setSelectedId(project.id)}
                  >
                    <td className="py-3 font-medium text-text-primary">{project.name}</td>
                    <td className="py-3 text-text-muted">{environmentLabel(project)}</td>
                    <td className="py-3 text-right font-mono text-text-primary">
                      {fmtMoney(project.costCny)}
                    </td>
                    <td className="py-3 text-right font-mono text-text-primary">
                      {formatTokens(project.tokens)}
                    </td>
                    <td className="py-3 text-right font-mono text-text-secondary">
                      {project.sessions}
                    </td>
                    <td className="py-3 text-right font-mono text-text-secondary">
                      {project.activeDays}
                    </td>
                    <td className="py-3 text-right font-mono text-text-secondary">
                      {project.commitCount}
                    </td>
                    <td className="py-3 text-right font-mono text-text-muted">
                      {project.unpricedRequests}/{project.totalRequests}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon="fa-folder-open"
            title="暂无项目用量"
            hint={`最近 ${days} 天尚未解析到本地 CLI 项目日志`}
          />
        </Card>
      )}

      {detail && <ProjectDetailPanel detail={detail} onRefresh={refreshDetail} />}
    </div>
  )
}
