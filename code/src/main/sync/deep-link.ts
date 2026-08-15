export type SyncBindingLink = {
  baseUrl: string
  ticket: string
}

export function parseSyncBindingLink(
  value: string,
  options: { allowHttp?: boolean } = {}
): SyncBindingLink {
  let link: URL
  try {
    link = new URL(value)
  } catch {
    throw new Error('invalid sync binding link')
  }
  if (
    (link.protocol !== 'moonmeter:' && link.protocol !== 'tokenlub:') ||
    link.hostname !== 'sync' ||
    link.pathname !== '/bind'
  ) {
    throw new Error('invalid sync binding link')
  }

  const ticket = link.searchParams.get('ticket') ?? ''
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(ticket)) throw new Error('invalid sync binding link')

  let server: URL
  try {
    server = new URL(link.searchParams.get('server') ?? '')
  } catch {
    throw new Error('invalid sync binding link')
  }
  // HTTP 同步地址会明文传输令牌，默认拒绝；仅在开发模式或显式 opt-in 时放行。
  if (
    (server.protocol !== 'https:' && !(server.protocol === 'http:' && options.allowHttp)) ||
    server.username ||
    server.password ||
    server.search ||
    server.hash ||
    (server.pathname !== '/' && server.pathname !== '')
  ) {
    throw new Error('invalid sync binding link')
  }
  return { baseUrl: server.origin, ticket }
}
