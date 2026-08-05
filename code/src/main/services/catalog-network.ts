/** 官方价格目录的 Electron 网络出口与失败恢复。 */
import { request as httpsRequest } from 'node:https'
import { session } from 'electron'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { CatalogFetch } from '../pricing/catalog'
import type { IncomingHttpHeaders } from 'node:http'

const CATALOG_SESSION_PARTITION = 'moonmeter-pricing-catalog'
type CatalogSession = ReturnType<typeof session.fromPartition>

let catalogSession: CatalogSession | null = null
let catalogSessionSequence = 0

function getCatalogSession(): CatalogSession {
  if (!catalogSession) {
    catalogSession = session.fromPartition(
      `${CATALOG_SESSION_PARTITION}-${++catalogSessionSequence}`
    )
  }
  return catalogSession
}

function discardCatalogSession(target: CatalogSession): void {
  if (catalogSession === target) catalogSession = null
}

async function refreshSystemProxy(target: CatalogSession): Promise<void> {
  await target.setProxy({ mode: 'system' })
}

async function recoverNetworkSession(target: CatalogSession): Promise<void> {
  await refreshSystemProxy(target)
  await target.clearHostResolverCache()
  await target.closeAllConnections()
}

function toNodeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  new Headers(headers).forEach((value, key) => {
    result[key] = value
  })
  return result
}

function toFetchHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers()
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue
    result.set(key, Array.isArray(value) ? value.join(', ') : value)
  }
  return result
}

function parseHttpProxyRule(proxyRules: string): string | undefined {
  const proxyRule = proxyRules
    .split(';')
    .map((rule) => rule.trim())
    .find((rule) => /^(PROXY|HTTPS)\s+/i.test(rule))
  if (!proxyRule) return undefined

  const value = proxyRule.replace(/^(PROXY|HTTPS)\s+/i, '').trim()
  if (!value) return undefined
  try {
    const parsed = new URL(value.includes('://') ? value : `http://${value}`)
    return parsed.hostname && parsed.port ? parsed.toString() : undefined
  } catch {
    return undefined
  }
}

async function fetchThroughNodeProxy(
  target: CatalogSession,
  input: string,
  init: RequestInit
): Promise<Response | undefined> {
  const proxyRules = await target.resolveProxy(input)
  const proxyUrl = parseHttpProxyRule(proxyRules)
  if (!proxyUrl) return undefined

  return new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(
      input,
      {
        method: init.method ?? 'GET',
        headers: toNodeHeaders(init.headers),
        agent: new HttpsProxyAgent(proxyUrl) as unknown as import('node:https').Agent,
        ...(init.signal ? { signal: init.signal } : {})
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        response.once('error', reject)
        response.once('end', () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 0,
              statusText: response.statusMessage ?? '',
              headers: toFetchHeaders(response.headers)
            })
          )
        })
      }
    )
    request.once('error', reject)
    if (init.body) request.end(init.body as string)
    else request.end()
  })
}

/**
 * 价格目录不复用渲染窗口的默认网络会话，避免窗口启动时留下的失败连接、
 * DNS 状态或代理解析结果污染同步。每次请求前重新应用 system proxy；失败后
 * 再清理该独立会话的 DNS 与连接池并重试。
 */
export const fetchCatalogThroughSystemProxy: CatalogFetch = async (input, init) => {
  let target = getCatalogSession()

  try {
    await refreshSystemProxy(target)
    return await target.fetch(input, init)
  } catch (error) {
    // Do not reuse an already-aborted signal. The outer catalog retry loop will
    // provide a fresh deadline and signal for the next attempt.
    if (init?.signal?.aborted) {
      discardCatalogSession(target)
      throw error
    }

    discardCatalogSession(target)
    try {
      await target.closeAllConnections()
    } catch {
      // The failed session is disposable; a cleanup failure must not block retry.
    }
    if (init?.signal?.aborted) throw error

    target = getCatalogSession()
    try {
      await recoverNetworkSession(target)
      return await target.fetch(input, init)
    } catch (retryError) {
      discardCatalogSession(target)
      try {
        const fallback = await fetchThroughNodeProxy(target, input, init ?? {})
        if (fallback) return fallback
      } catch (fallbackError) {
        throw new Error(
          `${(retryError as Error).message}; Node proxy fallback: ${(fallbackError as Error).message}`
        )
      }
      throw retryError
    }
  }
}
