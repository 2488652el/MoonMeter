import { useNavigate } from 'react-router-dom'
import type { ActionCenterItem } from '../../shared/types/quota-planning'
import { Card } from './Card'
import { Icon } from './Icon'

const ACTION_META: Record<
  ActionCenterItem['severity'],
  { icon: string; iconClass: string; badge: string }
> = {
  critical: {
    icon: 'fa-triangle-exclamation',
    iconClass: 'bg-status-red-dim text-status-red',
    badge: '立即处理'
  },
  warning: {
    icon: 'fa-circle-exclamation',
    iconClass: 'bg-status-amber-dim text-status-amber',
    badge: '需要关注'
  },
  info: {
    icon: 'fa-lightbulb',
    iconClass: 'bg-accent-dim text-accent-text',
    badge: '优化建议'
  }
}

export function ActionCenter({ actions }: { actions: ActionCenterItem[] }) {
  const navigate = useNavigate()
  if (actions.length === 0) return null

  return (
    <Card
      title="行动中心"
      subtitle="最多展示 3 条可追溯、可直接处理的信息"
      action={
        <span className="rounded-full bg-bg-base px-2.5 py-1 text-[11px] text-text-secondary">
          {actions.length} 条
        </span>
      }
    >
      <div className="grid grid-cols-3 gap-3 max-xl:grid-cols-1">
        {actions.slice(0, 3).map((action) => {
          const meta = ACTION_META[action.severity]
          return (
            <button
              key={action.id}
              type="button"
              className="rounded-lg border border-border-light bg-bg-base/45 p-4 text-left transition-colors hover:border-border-focus hover:bg-bg-hover"
              onClick={() => navigate(action.target)}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg ${meta.iconClass}`}
                >
                  <Icon name={meta.icon} />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="font-semibold text-text-primary">{action.title}</span>
                    <span className="rounded-full border border-border-light px-2 py-0.5 text-[10px] text-text-muted">
                      {meta.badge}
                    </span>
                  </span>
                  <span className="mt-1.5 block text-[12px] leading-5 text-text-secondary">
                    {action.basis}
                  </span>
                  <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-accent-text">
                    查看依据与处理
                    <Icon name="fa-arrow-right" className="text-[9px]" />
                  </span>
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </Card>
  )
}
