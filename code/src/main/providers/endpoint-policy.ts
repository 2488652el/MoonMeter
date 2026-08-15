import { getProvider } from './registry'
import { getCatalogEntry } from '@shared/provider-catalog'

type EndpointResult = { ok: true; origin: string } | { ok: false; reason: string }

function isManualProvider(providerId: string): boolean {
  return getProvider(providerId)?.manifest.category === 'manual'
}

function documentedOrigins(providerId: string): Set<string> {
  const entry = getCatalogEntry(providerId)
  const urls = [entry?.defaultBaseUrl ?? '', ...(entry?.baseUrlTemplates ?? []).map((t) => t.url)]
  return new Set(
    urls.flatMap((url) => {
      const origin = parseOrigin(url)
      return origin && url.startsWith('https://') ? [origin] : []
    })
  )
}

function parseOrigin(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || rawUrl.trim() === '') return ''
  try {
    return new URL(rawUrl).origin
  } catch {
    return null
  }
}

/**
 * 自建 NewAPI 网关允许 HTTP 的地址范围：回环 + RFC1918 私网 + 链路本地。
 * 公网 HTTP 会明文传输 API Key，一律拒绝；公网地址请使用 HTTPS。
 */
function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true
  if (/^127\.\d+\.\d+\.\d+$/.test(host)) return true
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)) return true
  if (/^169\.254\.\d+\.\d+$/.test(host)) return true
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true // IPv6 ULA
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true // IPv6 link-local
  return false
}

export function validateProviderEndpoint(
  providerId: string,
  rawUrl: string | null | undefined
): EndpointResult {
  if (!rawUrl || rawUrl.trim() === '') return { ok: true, origin: '' }
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'endpoint must be a valid URL' }
  }

  if (providerId === 'newapi-generic') {
    if (parsed.protocol === 'https:') return { ok: true, origin: parsed.origin }
    if (parsed.protocol === 'http:' && isPrivateNetworkHost(parsed.hostname)) {
      return { ok: true, origin: parsed.origin }
    }
    return {
      ok: false,
      reason:
        parsed.protocol === 'http:'
          ? 'HTTP endpoint is only allowed for loopback or private-network self-hosted gateways; public endpoints must use HTTPS'
          : 'endpoint must use HTTP or HTTPS'
    }
  }
  if (parsed.protocol === 'https:' && documentedOrigins(providerId).has(parsed.origin)) {
    return { ok: true, origin: parsed.origin }
  }
  return {
    ok: false,
    reason:
      parsed.protocol === 'https:'
        ? 'endpoint origin is not approved for this provider'
        : 'endpoint must use HTTP or HTTPS'
  }
}

export function originChanged(
  providerId: string,
  existingUrl: string | null | undefined,
  nextUrl: string | null | undefined
): boolean {
  if (isManualProvider(providerId) && (!nextUrl || nextUrl.trim() === '')) return false
  const existingOrigin = parseOrigin(existingUrl)
  const nextOrigin = parseOrigin(nextUrl)
  return existingOrigin !== nextOrigin
}
