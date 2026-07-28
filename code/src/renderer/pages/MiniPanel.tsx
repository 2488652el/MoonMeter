import { useEffect, useState } from 'react'
import { fmtMoney } from '../../shared/utils/money'
import type { ProjectSummary } from '../../shared/types/project'
import { Icon } from '../components/Icon'

export default function MiniPanel() {
  const [settings, setSettings] = useState<Awaited<
    ReturnType<typeof window.api.miniPanel.settings>
  > | null>(null)
  const [project, setProject] = useState<ProjectSummary | null>(null)

  useEffect(() => {
    let alive = true
    void window.api.miniPanel.settings().then(async (next) => {
      if (!alive) return
      setSettings(next)
      if (next.fixedWorkspaceId) {
        const detail = await window.api.projects.detail(next.fixedWorkspaceId, 30).catch(() => null)
        if (alive && detail) setProject(detail)
        return
      }
      const page = await window.api.projects.overview({ days: 30, limit: 1 }).catch(() => null)
      if (alive) setProject(page?.rows[0] ?? null)
    })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="min-h-screen bg-bg-base px-4 py-3 text-text-primary">
      <div className="flex items-center justify-between border-b border-border-light pb-2">
        <div className="flex items-center gap-2 text-[12px] font-semibold">
          <Icon name="fa-gauge-high" className="text-accent" /> MoonMeter
        </div>
        <button
          type="button"
          className="text-text-muted hover:text-text-primary"
          aria-label="隐藏 mini panel"
          onClick={() => void window.api.miniPanel.hide()}
        >
          <Icon name="fa-xmark" />
        </button>
      </div>
      <div className="pt-3">
        <div className="truncate text-[13px] font-medium">
          {project?.name ?? (settings?.enabled ? '暂无项目数据' : 'Mini panel 已关闭')}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            ['成本', project ? fmtMoney(project.costCny) : '—'],
            ['Token', project ? project.tokens.toLocaleString() : '—'],
            ['会话', project ? project.sessions.toLocaleString() : '—']
          ].map(([label, value]) => (
            <div key={label} className="rounded border border-border-light bg-bg-card/50 px-2 py-2">
              <div className="text-[9px] text-text-muted">{label}</div>
              <div className="mt-1 truncate font-mono text-[12px] text-text-primary">{value}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 text-[10px] text-text-muted">
          最近 30 天 · 仅显示摘要，不包含路径或原始内容
        </div>
      </div>
    </div>
  )
}
