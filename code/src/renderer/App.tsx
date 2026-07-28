/**
 * 应用根组件:配置整体路由表,将各业务页面挂载到 AppShell 布局下。
 * 通过 HashRouter 实现客户端路由切换,涵盖仪表盘、供应商、模型对比、
 * 请求日志、余额查询、API 密钥、价格配置、用量告警、设置等页面。
 */
import { useEffect } from 'react'
import { Navigate, Routes, Route, useNavigate } from 'react-router-dom'
import { AppShell } from './layout/AppShell'
import Dashboard from './pages/Dashboard'
import Projects from './pages/Projects'
import ProviderSummary from './pages/ProviderSummary'
import ModelCompare from './pages/ModelCompare'
import RequestLogs from './pages/RequestLogs'
import BalanceQuery from './pages/BalanceQuery'
import ApiKeys from './pages/ApiKeys'
import PricingConfig from './pages/PricingConfig'
import UsageAlerts from './pages/UsageAlerts'
import Settings from './pages/Settings'
import Sources from './pages/Sources'
import Timeline from './pages/Timeline'
import MiniPanel from './pages/MiniPanel'

/**
 * 应用根组件。
 * 使用 react-router 的 Routes 组织所有子路由,统一包裹在 AppShell 布局内,
 * 各 Route 的 element 对应一个业务页面。
 */
export default function App() {
  return (
    <>
      <AlertDestinationBridge />
      <Routes>
        <Route path="/mini-panel" element={<MiniPanel />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/agents" element={<Navigate to="/projects" replace />} />
          <Route path="/providers" element={<ProviderSummary />} />
          <Route path="/models" element={<ModelCompare />} />
          <Route path="/logs" element={<RequestLogs />} />
          <Route path="/sources" element={<Sources />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/sessions" element={<Navigate to="/apikeys" replace />} />
          <Route path="/balance" element={<BalanceQuery />} />
          <Route path="/apikeys" element={<ApiKeys />} />
          <Route path="/pricing" element={<PricingConfig />} />
          <Route path="/alerts" element={<UsageAlerts />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </>
  )
}

function AlertDestinationBridge() {
  const navigate = useNavigate()

  useEffect(
    () =>
      window.api.alerts.onOpenDestination(({ eventId, providerId }) => {
        navigate(
          `/providers?provider=${encodeURIComponent(providerId)}&alertEvent=${encodeURIComponent(eventId)}`
        )
      }),
    [navigate]
  )

  return null
}
