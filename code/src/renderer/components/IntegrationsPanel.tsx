import { useEffect, useState } from 'react'
import type { ProjectSummary } from '../../shared/types/project'
import type { MiniPanelSettings } from '../../shared/types/mini-panel'
import type { OtelConfigPreview, OtelReceiverStatus } from '../../shared/types/otel'
import { Card } from './Card'
import { Icon } from './Icon'

export function IntegrationsPanel() {
  const [otel, setOtel] = useState<OtelReceiverStatus | null>(null)
  const [preview, setPreview] = useState<OtelConfigPreview | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [otelError, setOtelError] = useState<string | null>(null)
  const [mini, setMini] = useState<MiniPanelSettings | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [miniError, setMiniError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    void Promise.all([
      window.api.otel.status(),
      window.api.otel.preview(),
      window.api.miniPanel.settings(),
      window.api.projects.overview({ days: 90, limit: 500 })
    ])
      .then(([nextOtel, nextPreview, nextMini, page]) => {
        if (!alive) return
        setOtel(nextOtel)
        setPreview(nextPreview)
        setMini(nextMini)
        setProjects(page.rows)
      })
      .catch(() => {
        if (alive) setOtelError('无法读取本地集成状态')
      })
    return () => {
      alive = false
    }
  }, [])

  async function toggleOtel(enabled: boolean) {
    if (!otel) return
    setOtelError(null)
    try {
      setOtel(await window.api.otel.setEnabled(enabled, otel.port))
      setPreview(await window.api.otel.preview(otel.port))
    } catch (error) {
      setOtelError((error as Error).message || '无法更新 OTLP 设置')
    }
  }

  async function rotateToken() {
    setToken(null)
    try {
      setToken((await window.api.otel.rotateToken()).token)
    } catch (error) {
      setOtelError((error as Error).message || '无法轮换 Token')
    }
  }

  async function updateMini(next: MiniPanelSettings) {
    setSaving(true)
    setMiniError(null)
    try {
      setMini(await window.api.miniPanel.setSettings(next))
    } catch (error) {
      setMiniError((error as Error).message || '无法保存 mini panel 设置')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card className="mt-4" title="本地集成" icon="fa-plug" motionOrder={3}>
        <div className="rounded-lg border border-border-light bg-bg-base/45 p-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13px] font-medium text-text-primary">
                OTLP / HTTP JSON 接收器
                <span className="rounded-full bg-bg-card px-2 py-0.5 text-[10px] text-text-muted">
                  {otel?.state === 'running' ? '运行中' : '默认关闭'}
                </span>
              </div>
              <p className="form-hint mt-1">
                仅监听 127.0.0.1:{otel?.port ?? 4318}，必须显式开启；只接收白名单标量，不接收
                Prompt、命令、代码或工具输入输出。
              </p>
            </div>
            <button
              type="button"
              className={`btn btn-sm ${otel?.enabled ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => void toggleOtel(!otel?.enabled)}
              disabled={!otel}
            >
              {otel?.enabled ? '关闭接收器' : '开启接收器'}
            </button>
          </div>
          {otel?.lastErrorCode && (
            <p className="mt-2 text-[11px] text-amber-700">状态：{otel.lastErrorCode}</p>
          )}
          {otelError && <p className="mt-2 text-[11px] text-status-red">{otelError}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-outline btn-xs"
              onClick={() => void rotateToken()}
            >
              <Icon name="fa-key" /> 轮换 Bearer Token
            </button>
            {token && (
              <button
                type="button"
                className="max-w-full truncate rounded border border-amber-300 bg-amber-50 px-2 py-1 text-left font-mono text-[10px] text-amber-900"
                title="点击复制 Token"
                onClick={() => void navigator.clipboard?.writeText(token)}
              >
                新 Token：{token}
              </button>
            )}
          </div>
          {preview && (
            <details className="mt-3 rounded border border-border-light bg-bg-card/35 px-3 py-2 text-[11px]">
              <summary className="cursor-pointer text-text-secondary">
                查看接入预览与字段边界
              </summary>
              <div className="mt-2 text-text-muted">端点：{preview.endpoint}</div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div>
                  <div className="font-medium text-emerald-700">允许字段</div>
                  <div className="mt-1 break-words">{preview.acceptedFields.join(' · ')}</div>
                </div>
                <div>
                  <div className="font-medium text-status-red">丢弃字段</div>
                  <div className="mt-1 break-words">{preview.droppedFields.join(' · ')}</div>
                </div>
              </div>
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-bg-base p-2 text-[10px] text-text-muted">
                {preview.powershellScript}
              </pre>
            </details>
          )}
        </div>

        <div className="mt-3 rounded-lg border border-border-light bg-bg-base/45 p-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[13px] font-medium text-text-primary">Mini panel</div>
              <p className="form-hint mt-1">
                独立置顶摘要窗默认关闭；不读取或展示 Prompt、路径和原始日志。
              </p>
            </div>
            <button
              type="button"
              className={`btn btn-sm ${mini?.enabled ? 'btn-primary' : 'btn-outline'}`}
              disabled={!mini || saving}
              onClick={() =>
                mini && void updateMini({ ...mini, enabled: !mini.enabled, visible: !mini.enabled })
              }
            >
              {mini?.enabled ? '关闭 Mini panel' : '开启 Mini panel'}
            </button>
          </div>
          {mini && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="form-label">
                固定项目（可选）
                <select
                  className="select mt-1 w-full"
                  value={mini.fixedWorkspaceId ?? ''}
                  onChange={(event) => {
                    const next = { ...mini }
                    if (event.target.value) next.fixedWorkspaceId = event.target.value
                    else delete next.fixedWorkspaceId
                    void updateMini(next)
                  }}
                  disabled={saving}
                >
                  <option value="">跟随最近项目</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-label">
                快捷键
                <input
                  className="input mt-1 w-full"
                  value={mini.hotkey}
                  onChange={(event) => setMini({ ...mini, hotkey: event.target.value })}
                  onBlur={() => void updateMini(mini)}
                  disabled={saving}
                />
              </label>
              <label className="flex items-center gap-2 text-[12px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={mini.hotkeyEnabled}
                  onChange={(event) =>
                    void updateMini({ ...mini, hotkeyEnabled: event.target.checked })
                  }
                  disabled={saving || !mini.enabled}
                />
                启用全局快捷键
              </label>
              <button
                type="button"
                className="btn btn-outline btn-xs justify-self-start"
                onClick={() => void window.api.miniPanel.show()}
                disabled={saving || !mini.enabled}
              >
                <Icon name="fa-up-right-from-square" /> 显示面板
              </button>
            </div>
          )}
          {mini?.errorCode === 'hotkey-conflict' && (
            <p className="mt-2 text-[11px] text-amber-700">
              快捷键注册失败，已安全保持快捷键关闭；请换一个组合后重试。
            </p>
          )}
          {miniError && <p className="mt-2 text-[11px] text-status-red">{miniError}</p>}
        </div>
      </Card>
    </>
  )
}
