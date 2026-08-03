/** 官方价格目录的 Electron 网络出口与失败恢复。 */
import { net, session } from 'electron'
import type { CatalogFetch } from '../pricing/catalog'

/**
 * Electron 进程长期运行时，系统代理或本地代理服务可能在 Chromium 网络
 * 会话初始化后才就绪。失败后重新加载 system proxy、DNS 与连接池，再重试
 * 当前请求，避免把一次性的 net::ERR_FAILED 固化成目录异常。
 */
export const fetchCatalogThroughSystemProxy: CatalogFetch = async (input, init) => {
  try {
    return await net.fetch(input, init)
  } catch {
    try {
      await session.defaultSession.setProxy({ mode: 'system' })
      await session.defaultSession.clearHostResolverCache()
      await session.defaultSession.closeAllConnections()
    } catch {
      // Even if proxy refresh is unavailable, the second request may succeed
      // when the local proxy service recovered between attempts.
    }
    return net.fetch(input, init)
  }
}
