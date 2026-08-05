import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { MoonMeterAppIcon, MoonMeterWordmark } from '../components/Brand'
import { Icon } from '../components/Icon'
import { useTheme, type ThemeMode } from '../theme'

type NavItem = {
  to: string
  label: string
  icon: string
  badge?: string
  badgeVariant?: 'new' | 'count'
}

type PrimaryNavItem = NavItem & { activePaths: string[] }

const PRIMARY_NAV: PrimaryNavItem[] = [
  { to: '/', label: '概览', icon: 'fa-chart-simple', activePaths: ['/'] },
  {
    to: '/projects',
    label: '分析',
    icon: 'fa-chart-line',
    activePaths: ['/projects', '/providers', '/models', '/logs', '/timeline']
  },
  { to: '/balance', label: '额度', icon: 'fa-wallet', activePaths: ['/balance'] },
  { to: '/sources', label: '来源', icon: 'fa-heart-pulse', activePaths: ['/sources', '/apikeys'] },
  { to: '/alerts', label: '告警', icon: 'fa-bell', activePaths: ['/alerts'] },
  { to: '/settings', label: '设置', icon: 'fa-gear', activePaths: ['/settings', '/pricing'] }
]

const SECONDARY_NAV: Record<string, NavItem[]> = {
  '/projects': [
    { to: '/projects', label: '项目用量', icon: 'fa-folder-tree' },
    { to: '/providers', label: 'Provider 汇总', icon: 'fa-server' },
    { to: '/models', label: '模型对比', icon: 'fa-cube', badge: 'NEW', badgeVariant: 'new' },
    { to: '/logs', label: '请求日志', icon: 'fa-clock-rotate-left' },
    { to: '/timeline', label: '时间线', icon: 'fa-timeline' }
  ],
  '/sources': [{ to: '/apikeys', label: 'API Keys', icon: 'fa-key' }],
  '/settings': [{ to: '/pricing', label: '价格配置', icon: 'fa-tag' }]
}

const THEME_OPTIONS: Array<{ mode: ThemeMode; icon: string; label: string }> = [
  { mode: 'system', icon: 'fa-display', label: '跟随系统' },
  { mode: 'light', icon: 'fa-sun', label: '浅色' },
  { mode: 'dark', icon: 'fa-moon', label: '深色' }
]

export function Sidebar() {
  const location = useLocation()
  const [projectBadge, setProjectBadge] = useState<string | undefined>()
  const { mode, setMode } = useTheme()

  useEffect(() => {
    let alive = true
    window.api.projects
      .overview({ days: 30, limit: 500 })
      .then((result) => {
        if (!alive) return
        setProjectBadge(result.total > 0 ? String(result.total) : undefined)
      })
      .catch(() => {
        if (alive) setProjectBadge(undefined)
      })
    return () => {
      alive = false
    }
  }, [])

  const activePrimary = useMemo(
    () =>
      PRIMARY_NAV.find((item) =>
        item.activePaths.some((path) =>
          path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)
        )
      )?.to ?? '/',
    [location.pathname]
  )
  const activeSecondary =
    location.pathname === activePrimary
      ? undefined
      : SECONDARY_NAV[activePrimary]?.find((item) => location.pathname.startsWith(item.to))?.to

  return (
    <aside
      aria-label="MoonMeter 导航"
      className="z-10 flex w-[216px] min-w-[216px] flex-col overflow-y-auto border-r border-border-light bg-bg-sidebar/80 backdrop-blur-xl"
    >
      <div className="px-5 pb-5 pt-6">
        <MoonMeterWordmark compact className="text-text-primary" />
        <p className="mt-2 text-[9px] font-semibold tracking-[0.12em] text-text-muted">
          EVERY TOKEN, CLEARER.
        </p>
      </div>

      <nav className="flex-1 px-3 py-3" aria-label="主导航">
        <div className="space-y-2">
          {PRIMARY_NAV.map((item) => {
            const isSectionActive = activePrimary === item.to
            const isActive = isSectionActive && activeSecondary === undefined
            const sectionSecondaryItems = (SECONDARY_NAV[item.to] ?? []).map((secondaryItem) =>
              secondaryItem.to === '/projects' && projectBadge
                ? {
                    ...secondaryItem,
                    badge: projectBadge,
                    badgeVariant: 'count' as const
                  }
                : secondaryItem
            )
            const secondaryNavId = `sidebar-secondary-${item.to.slice(1)}`
            return (
              <div key={item.to} data-primary-nav-section={item.to} className="space-y-2">
                <Link
                  to={item.to}
                  data-primary-nav-item
                  aria-current={isActive ? 'page' : undefined}
                  aria-expanded={sectionSecondaryItems.length > 0 ? isSectionActive : undefined}
                  aria-controls={
                    isSectionActive && sectionSecondaryItems.length > 0 ? secondaryNavId : undefined
                  }
                  className={clsx(
                    'motion-nav-item relative grid min-h-[44px] w-full select-none grid-cols-[18px_minmax(0,1fr)_36px] items-center gap-2.5 rounded-md px-3 py-2 text-[13px]',
                    isActive
                      ? 'bg-text-primary font-medium text-bg-base'
                      : isSectionActive
                        ? 'bg-bg-hover/60 font-medium text-text-primary'
                        : 'text-text-secondary hover:bg-bg-hover/70 hover:text-text-primary'
                  )}
                >
                  <Icon
                    name={item.icon}
                    className={clsx('w-[17px]', isActive ? 'opacity-100' : 'opacity-70')}
                  />
                  <span className="min-w-0 truncate">{item.label}</span>
                  <span className="flex h-5 w-9 items-center justify-end" />
                </Link>

                {isSectionActive && sectionSecondaryItems.length > 0 && (
                  <div
                    id={secondaryNavId}
                    data-secondary-nav-list
                    role="group"
                    aria-label={`${item.label}次级导航`}
                    className="space-y-2 border-l border-border-light pl-2"
                  >
                    {sectionSecondaryItems.map((secondaryItem) => {
                      const isSecondaryActive = activeSecondary === secondaryItem.to
                      return (
                        <Link
                          key={secondaryItem.to}
                          to={secondaryItem.to}
                          data-secondary-nav-item
                          aria-current={isSecondaryActive ? 'page' : undefined}
                          className={clsx(
                            'motion-nav-item relative grid min-h-[44px] w-full select-none grid-cols-[18px_minmax(0,1fr)_36px] items-center gap-2.5 rounded-md px-3 py-2 text-[12px]',
                            isSecondaryActive
                              ? 'bg-text-primary font-medium text-bg-base'
                              : 'text-text-secondary hover:bg-bg-hover/70 hover:text-text-primary'
                          )}
                        >
                          <Icon
                            name={secondaryItem.icon}
                            className={clsx(
                              'w-[16px]',
                              isSecondaryActive ? 'opacity-100' : 'opacity-70'
                            )}
                          />
                          <span className="min-w-0 truncate">{secondaryItem.label}</span>
                          <span className="flex h-5 w-9 items-center justify-end">
                            {secondaryItem.badge && (
                              <span
                                className={clsx(
                                  'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-[7px] text-[9px] font-semibold leading-none',
                                  secondaryItem.badgeVariant === 'new'
                                    ? isSecondaryActive
                                      ? 'bg-bg-base text-text-primary'
                                      : 'bg-text-primary text-bg-base'
                                    : 'bg-accent text-text-primary'
                                )}
                              >
                                {secondaryItem.badge}
                              </span>
                            )}
                          </span>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </nav>

      <div className="mt-auto border-t border-border-light p-3">
        <div
          className="mb-3 grid grid-cols-3 gap-2 rounded-full border border-border-light bg-bg-card/45 p-1"
          aria-label="外观主题"
        >
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              className={clsx(
                'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full transition-colors',
                mode === option.mode
                  ? 'bg-text-primary text-bg-base'
                  : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'
              )}
              onClick={() => setMode(option.mode)}
              aria-label={option.label}
              aria-pressed={mode === option.mode}
              title={option.label}
            >
              <Icon name={option.icon} className="text-[13px]" />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 px-2 py-2">
          <MoonMeterAppIcon className="h-8 w-8 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-text-primary">MoonMeter</div>
            <div className="text-[10px] text-text-muted">本地加密 · 安全聚合</div>
          </div>
          <span className="text-[9.5px] text-text-muted">v{window.api.version}</span>
        </div>
      </div>
    </aside>
  )
}
