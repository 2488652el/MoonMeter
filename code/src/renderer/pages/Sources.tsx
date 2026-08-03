import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { LocalSessionSourcesPanel } from '../components/LocalSessionSourcesPanel'
import { PageHeader } from '../components/PageHeader'
import type {
  LocalSourceConfig,
  LocalSourcesOverview,
  SourcePreview,
  WslDistribution
} from '../../shared/types/local-source'
import type { QuotaPlanningOverview, SourceHealth } from '../../shared/types/quota-planning'

const STATUS_LABELS: Record<LocalSourceConfig['status'], string> = {
  discovered: '已发现',
  enabled: '已启用',
  ready: '可用',
  stale: '已过期',
  stopped: '发行版已停止',
  unavailable: '不可用',
  'permission-denied': '权限受限',
  error: '异常'
}

const HEALTH_STATUS_LABELS: Record<SourceHealth['status'], string> = {
  healthy: '可用',
  stale: '已过期',
  error: '异常',
  unavailable: '不可用'
}

function formatTime(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}

function shortPath(value: string): string {
  if (value.length <= 64) return value
  return `${value.slice(0, 27)}…${value.slice(-32)}`
}

function sourceName(source: SourceHealth): string {
  return source.accountAlias ?? source.providerId ?? source.sourceId
}

function distributionDescription(distribution: WslDistribution): string {
  if (distribution.status === 'stopped') return '已发现但未启动；启用来源后才会读取其家目录'
  if (distribution.enabled) return '已有启用来源；可预览候选 CLI 目录或立即同步'
  return '仅发现发行版；当前不会读取目录或产生使用记录'
}

export default function Sources() {
  const [searchParams] = useSearchParams()
  const [local, setLocal] = useState<LocalSourcesOverview | null>(null)
  const [quota, setQuota] = useState<QuotaPlanningOverview | null>(null)
  const [preview, setPreview] = useState<SourcePreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const focusedSource = searchParams.get('source')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [localSources, quotaOverview] = await Promise.all([
        window.api.localSources.discover(),
        window.api.quotaPlanning.overview({ refresh: false })
      ])
      setLocal(localSources)
      setQuota(quotaOverview)
    } catch {
      setError('来源检查失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const enabledCount = useMemo(
    () => local?.configs.filter((config) => config.enabled).length ?? 0,
    [local]
  )

  async function previewDistribution(distribution: WslDistribution) {
    setBusy(`preview:${distribution.name}`)
    setError(null)
    try {
      setPreview(
        await window.api.localSources.preview({
          environment: 'wsl',
          wslDistribution: distribution.name
        })
      )
    } catch {
      setError('无法预览该发行版的候选目录')
    } finally {
      setBusy(null)
    }
  }

  async function previewWindowsSources() {
    setBusy('preview:windows')
    setError(null)
    try {
      setPreview(await window.api.localSources.preview({ environment: 'windows' }))
    } catch {
      setError('无法预览 Windows CLI 来源目录')
    } finally {
      setBusy(null)
    }
  }

  async function toggleSource(config: LocalSourceConfig, enabled: boolean) {
    setBusy(config.id)
    setError(null)
    try {
      await window.api.localSources.setEnabled({
        sourceId: config.id,
        environment: config.environment,
        cliSource: config.cliSource,
        enabled,
        ...(config.wslDistribution ? { wslDistribution: config.wslDistribution } : {})
      })
      await load()
      setNotice(enabled ? '来源已启用；尚未自动读取日志' : '来源已停用')
    } catch {
      setError('更新来源状态失败')
    } finally {
      setBusy(null)
    }
  }

  async function enablePreviewCandidate(
    candidate: NonNullable<SourcePreview['candidates']>[number]
  ) {
    if (!preview) return
    setBusy(`enable:${candidate.cliSource}`)
    setError(null)
    try {
      await window.api.localSources.setEnabled({
        environment: preview.environment,
        cliSource: candidate.cliSource,
        enabled: true,
        ...(preview.wslDistribution ? { wslDistribution: preview.wslDistribution } : {})
      })
      await load()
      setNotice('来源已启用；请使用“立即同步”读取本地会话日志')
    } catch {
      setError('启用来源失败')
    } finally {
      setBusy(null)
    }
  }

  async function syncSource(sourceId?: string) {
    setBusy(`sync:${sourceId ?? 'all'}`)
    setError(null)
    try {
      const result = await window.api.localSources.sync(sourceId ? { sourceId } : {})
      const inserted = result.results.reduce((sum, item) => sum + item.inserted, 0)
      const failed = result.results.filter((item) => item.error).length
      setNotice(
        failed > 0
          ? `同步完成：${failed} 个来源需要处理`
          : `同步完成：新增 ${inserted.toLocaleString('zh-CN')} 条用量记录`
      )
      await load()
    } catch {
      setError('来源同步失败，请检查状态后重试')
    } finally {
      setBusy(null)
    }
  }

  async function openFolder(sourceId: string) {
    setBusy(`open:${sourceId}`)
    try {
      const result = await window.api.localSources.openFolder(sourceId)
      setNotice(result.ok ? '已请求打开来源目录' : (result.error ?? '来源目录不可用'))
    } catch {
      setError('无法打开来源目录')
    } finally {
      setBusy(null)
    }
  }

  async function copyDiagnostic() {
    try {
      const diagnostic = await window.api.localSources.diagnostic()
      await navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2))
      setNotice('已复制脱敏诊断信息；其中不包含路径、凭据或日志正文')
    } catch {
      setError('复制诊断信息失败')
    }
  }

  return (
    <div className="page-content">
      <PageHeader
        title="来源健康"
        desc="只读检查 Windows、WSL 与本地 CLI 来源；首次发现不会读取未授权发行版"
        action={
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => void copyDiagnostic()}
            >
              <Icon name="fa-copy" /> 复制脱敏诊断
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void load()}
              disabled={loading}
            >
              <Icon name="fa-arrows-rotate" className={loading ? 'icon-spin' : ''} />
              {loading ? '检查中' : '重新扫描'}
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-status-red/20 bg-status-red-dim px-4 py-3 text-[12px] text-status-red">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-lg border border-accent/20 bg-accent-dim px-4 py-3 text-[12px] text-accent-text">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-1">
        <StatCard label="启用来源" value={String(enabledCount)} hint="不会自动启动同步" />
        <StatCard
          label="WSL 发行版"
          value={String(local?.distributions.length ?? 0)}
          hint={local?.wslAvailable ? '已完成只读发现' : 'WSL 不可用'}
        />
        <StatCard
          label="最近检查"
          value={formatTime(local?.generatedAt)}
          hint="状态与错误均为脱敏说明"
        />
      </div>

      <div className="mt-6">
        <LocalSessionSourcesPanel />
      </div>

      <Card
        className="mt-4"
        title="WSL 发行版"
        subtitle={
          local?.wslAvailable
            ? '初次只列出发行版；解析 $HOME 和候选 CLI 目录需要显式预览或启用'
            : (local?.wslErrorMessage ?? 'WSL 不可用')
        }
        action={
          <button
            type="button"
            className="btn btn-outline btn-xs"
            onClick={() => void syncSource()}
            disabled={busy !== null}
          >
            <Icon name="fa-cloud-arrow-down" /> 同步已启用来源
          </button>
        }
      >
        {loading && !local ? (
          <EmptyState icon="fa-spinner" title="正在检查 WSL" variant="loading" />
        ) : local?.distributions.length ? (
          <div className="space-y-2">
            {local.distributions.map((distribution) => (
              <div
                key={distribution.name}
                className="rounded-lg border border-border-light bg-bg-base/40 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
                      <span
                        className={`h-2 w-2 rounded-full ${distribution.state === 'running' ? 'bg-emerald-500' : 'bg-status-amber'}`}
                      />
                      <span className="truncate">{distribution.name}</span>
                      {distribution.isDefault && (
                        <span className="text-[10px] text-text-muted">默认</span>
                      )}
                    </div>
                    <div className="mt-1 text-[11px] text-text-muted">
                      {distributionDescription(distribution)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline btn-xs shrink-0"
                    onClick={() => void previewDistribution(distribution)}
                    disabled={busy !== null}
                  >
                    <Icon name="fa-magnifying-glass" /> 预览目录
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="fa-linux"
            title={local?.wslAvailable ? '未发现 WSL 发行版' : 'WSL 不可用'}
            hint={
              local?.wslErrorMessage ?? '安装发行版后重新扫描；MoonMeter 不会自动安装或启动 WSL'
            }
          />
        )}
      </Card>

      <Card
        className="mt-4"
        title="Windows CLI 来源"
        subtitle="仅在你点击预览后检查候选目录；不会自动扫描或读取日志"
        action={
          <button
            type="button"
            className="btn btn-outline btn-xs"
            onClick={() => void previewWindowsSources()}
            disabled={busy !== null}
          >
            <Icon name="fa-magnifying-glass" /> 预览目录
          </button>
        }
      >
        <p className="text-[11px] text-text-muted">
          支持 Claude Code、Codex、Kimi Code、Gemini CLI 与
          OpenCode。预览结果会出现在下方，启用后仍需手动同步。
        </p>
      </Card>

      {preview && (
        <Card
          className="mt-4"
          title={`${preview.wslDistribution ?? 'Windows'} 候选 CLI 目录`}
          subtitle={
            preview.homeDir
              ? `已显式解析家目录：${preview.homeDir}`
              : (preview.errorMessage ?? '未返回来源路径')
          }
          action={
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setPreview(null)}>
              关闭
            </button>
          }
        >
          {preview.candidates.length ? (
            <div className="space-y-2">
              {preview.candidates.map((candidate) => (
                <div
                  key={candidate.cliSource}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border-light px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium text-text-primary">
                      {candidate.displayName}
                    </div>
                    <div className="truncate text-[11px] text-text-muted" title={candidate.rootDir}>
                      {shortPath(candidate.rootDir)} ·{' '}
                      {candidate.exists ? '目录存在' : '未发现目录'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline btn-xs shrink-0"
                    disabled={candidate.enabled || busy !== null}
                    onClick={() => void enablePreviewCandidate(candidate)}
                  >
                    {candidate.enabled ? '已启用' : '启用来源'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="fa-folder-open" title={preview.errorMessage ?? '未发现候选目录'} />
          )}
        </Card>
      )}

      <Card
        className="mt-4"
        title="已配置本地来源"
        subtitle="启用只保存来源上下文；读取日志必须由你点击立即同步"
      >
        {local?.configs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[12px]">
              <thead className="text-[10px] uppercase tracking-[0.12em] text-text-muted">
                <tr>
                  <th className="pb-2 font-medium">来源</th>
                  <th className="pb-2 font-medium">环境</th>
                  <th className="pb-2 font-medium">状态</th>
                  <th className="pb-2 font-medium">最后尝试</th>
                  <th className="pb-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {local.configs.map((config) => (
                  <tr
                    key={config.id}
                    className={`border-t border-border-light ${focusedSource === config.id ? 'bg-accent-dim' : ''}`}
                  >
                    <td className="py-3">
                      <div className="font-medium text-text-primary">{config.cliSource}</div>
                      <div
                        className="max-w-[300px] truncate text-[11px] text-text-muted"
                        title={config.rootDir}
                      >
                        {shortPath(config.rootDir)}
                      </div>
                    </td>
                    <td className="py-3 text-text-secondary">
                      {config.environment === 'wsl' ? `WSL · ${config.wslDistribution}` : 'Windows'}
                    </td>
                    <td className="py-3">
                      <span
                        className={
                          config.status === 'ready'
                            ? 'text-emerald-600'
                            : config.status === 'error'
                              ? 'text-status-red'
                              : 'text-status-amber'
                        }
                      >
                        {STATUS_LABELS[config.status]}
                      </span>
                      {config.errorMessage && (
                        <div className="mt-0.5 text-[11px] text-text-muted">
                          {config.errorMessage}
                        </div>
                      )}
                    </td>
                    <td className="py-3 text-text-muted">{formatTime(config.lastAttemptAt)}</td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => void syncSource(config.id)}
                          disabled={busy !== null}
                        >
                          同步
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => void openFolder(config.id)}
                          disabled={busy !== null}
                        >
                          打开目录
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs text-status-red"
                          onClick={() => void toggleSource(config, false)}
                          disabled={busy !== null}
                        >
                          停用
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="fa-plug"
            title="尚未启用本地 CLI 来源"
            hint="从上方 WSL 发行版预览候选目录；Windows CLI 会在显式配置后出现在这里"
          />
        )}
      </Card>

      <Card
        className="mt-4"
        title="已有来源健康记录"
        subtitle="Provider 与传统本地 CLI 同样在这里集中查看；异常项从行动中心深链到本页"
      >
        {quota?.sources.length ? (
          <div className="grid grid-cols-2 gap-2 max-lg:grid-cols-1">
            {quota.sources.map((source) => (
              <div
                key={`${source.sourceId}:${source.accountRef ?? ''}`}
                className={`rounded-lg border border-border-light p-3 ${focusedSource === source.sourceId ? 'ring-2 ring-accent/30' : ''}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-[12.5px] font-semibold text-text-primary">
                    {sourceName(source)}
                  </span>
                  <span className="text-[11px] text-text-secondary">
                    {HEALTH_STATUS_LABELS[source.status]}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-text-muted">
                  {source.sourceType} · 最近尝试 {formatTime(source.lastAttemptAt)}
                </div>
                <div className="mt-1 text-[11px] text-text-muted">
                  最近成功 {formatTime(source.lastSuccessAt)} ·{' '}
                  {source.errorMessage ?? '无安全错误说明'}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="fa-heart-pulse"
            title="还没有来源健康记录"
            hint="连接 Provider 或手动同步本地 CLI 后会显示状态"
          />
        )}
      </Card>
    </div>
  )
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-border-light bg-bg-card px-4 py-3">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="mt-1 text-[20px] font-semibold text-text-primary">{value}</div>
      <div className="mt-1 text-[10.5px] text-text-muted">{hint}</div>
    </div>
  )
}
