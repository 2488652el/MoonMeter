/**
 * 应用外壳布局:左侧导航栏 + 右侧主内容区(Outlet)的整体结构。
 */
import { useLocation, useOutlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

/** 应用外壳布局组件:组合 Sidebar 与路由 Outlet */
export function AppShell() {
  const location = useLocation()
  const outlet = useOutlet()

  return (
    <div className="relative flex h-screen overflow-hidden bg-bg-base text-text-primary">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-text-primary px-4 py-3 text-sm font-semibold text-bg-base focus:not-sr-only focus:absolute focus:left-3 focus:top-3"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
      >
        跳到主内容
      </a>
      <Sidebar />
      <main
        id="main-content"
        tabIndex={-1}
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-bg-base outline-none"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(circle_at_50%_-40%,rgb(var(--color-ink)/0.055),transparent_68%)]" />
        <div
          key={location.pathname}
          className="motion-route relative flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {outlet}
        </div>
      </main>
    </div>
  )
}
