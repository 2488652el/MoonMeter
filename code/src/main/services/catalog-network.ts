/** 官方价格目录的 Electron 网络出口与失败恢复。 */
import { session } from 'electron'
import type { CatalogFetch } from '../pricing/catalog'

const CATALOG_SESSION_PARTITION = 'moonmeter-pricing-catalog'
type CatalogSession = ReturnType<typeof session.fromPartition>

let catalogSession: CatalogSession | null = null

function getCatalogSession(): CatalogSession {
  if (!catalogSession) catalogSession = session.fromPartition(CATALOG_SESSION_PARTITION)
  return catalogSession
}

async function refreshSystemProxy(target: CatalogSession): Promise<void> {
  await target.setProxy({ mode: 'system' })
}

async function recoverNetworkSession(target: CatalogSession): Promise<void> {
  await refreshSystemProxy(target)
  await target.clearHostResolverCache()
  await target.closeAllConnections()
}

/**
 * 价格目录不复用渲染窗口的默认网络会话，避免窗口启动时留下的失败连接、
 * DNS 状态或代理解析结果污染同步。每次请求前重新应用 system proxy；失败后
 * 再清理该独立会话的 DNS 与连接池并重试。
 */
export const fetchCatalogThroughSystemProxy: CatalogFetch = async (input, init) => {
  const target = getCatalogSession()

  try {
    await refreshSystemProxy(target)
    return await target.fetch(input, init)
  } catch (error) {
    // Do not reuse an already-aborted signal. The outer catalog retry loop will
    // provide a fresh deadline and signal for the next attempt.
    if (init?.signal?.aborted) throw error

    try {
      await recoverNetworkSession(target)
    } catch {
      // Even if proxy refresh is unavailable, the second request may succeed
      // when the local proxy service recovered between attempts.
    }
    if (init?.signal?.aborted) throw error
    return target.fetch(input, init)
  }
}
