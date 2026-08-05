import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

const mocks = vi.hoisted(() => ({
  sessionFetch: vi.fn(),
  fromPartition: vi.fn(),
  setProxy: vi.fn(),
  clearHostResolverCache: vi.fn(),
  closeAllConnections: vi.fn(),
  resolveProxy: vi.fn(),
  nodeRequest: vi.fn(),
  proxyAgent: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: vi.fn() },
  session: {
    fromPartition: mocks.fromPartition
  }
}))

vi.mock('node:https', () => ({ request: mocks.nodeRequest }))
vi.mock('https-proxy-agent', () => ({ HttpsProxyAgent: mocks.proxyAgent }))

let fetchCatalogThroughSystemProxy: typeof import('../../../../code/src/main/services/catalog-network').fetchCatalogThroughSystemProxy

beforeEach(async () => {
  vi.resetModules()
  mocks.sessionFetch.mockReset()
  mocks.fromPartition.mockReset()
  mocks.setProxy.mockReset()
  mocks.clearHostResolverCache.mockReset()
  mocks.closeAllConnections.mockReset()
  mocks.resolveProxy.mockReset()
  mocks.nodeRequest.mockReset()
  mocks.proxyAgent.mockReset()
  mocks.setProxy.mockResolvedValue(undefined)
  mocks.clearHostResolverCache.mockResolvedValue(undefined)
  mocks.closeAllConnections.mockResolvedValue(undefined)
  mocks.resolveProxy.mockResolvedValue('PROXY 127.0.0.1:7897')
  mocks.proxyAgent.mockImplementation((value: string) => ({ proxy: value }))
  mocks.fromPartition.mockReturnValue({
    fetch: mocks.sessionFetch,
    setProxy: mocks.setProxy,
    clearHostResolverCache: mocks.clearHostResolverCache,
    closeAllConnections: mocks.closeAllConnections,
    resolveProxy: mocks.resolveProxy
  })
  ;({ fetchCatalogThroughSystemProxy } =
    await import('../../../../code/src/main/services/catalog-network'))
})

describe('catalog-network', () => {
  it('refreshes the system network session and retries after net::ERR_FAILED', async () => {
    const response = new Response('{}', { status: 200 })
    mocks.sessionFetch.mockRejectedValueOnce(new TypeError('net::ERR_FAILED'))
    mocks.sessionFetch.mockResolvedValueOnce(response)

    await expect(fetchCatalogThroughSystemProxy('https://models.dev/api.json')).resolves.toBe(
      response
    )
    expect(mocks.setProxy).toHaveBeenCalledWith({ mode: 'system' })
    expect(mocks.clearHostResolverCache).toHaveBeenCalledOnce()
    expect(mocks.closeAllConnections).toHaveBeenCalledTimes(2)
    expect(mocks.sessionFetch).toHaveBeenCalledTimes(2)
    expect(mocks.fromPartition).toHaveBeenCalledTimes(2)
    const partitions = mocks.fromPartition.mock.calls.map(([partition]) => partition as string)
    expect(partitions[0]!).toMatch(/^moonmeter-pricing-catalog-/)
    expect(partitions[1]!).toMatch(/^moonmeter-pricing-catalog-/)
  })

  it('prepares the isolated session before a successful request', async () => {
    const response = new Response('{}', { status: 200 })
    mocks.sessionFetch.mockResolvedValueOnce(response)

    await expect(fetchCatalogThroughSystemProxy('https://models.dev/api.json')).resolves.toBe(
      response
    )
    expect(mocks.setProxy).toHaveBeenCalledWith({ mode: 'system' })
    expect(mocks.clearHostResolverCache).not.toHaveBeenCalled()
    expect(mocks.sessionFetch).toHaveBeenCalledOnce()
  })

  it('drops a failed retry session before the next manual sync', async () => {
    mocks.sessionFetch.mockRejectedValueOnce(new TypeError('net::ERR_FAILED'))
    mocks.sessionFetch.mockRejectedValueOnce(new TypeError('net::ERR_FAILED'))

    await expect(fetchCatalogThroughSystemProxy('https://models.dev/api.json')).rejects.toThrow(
      'net::ERR_FAILED'
    )

    const response = new Response('{}', { status: 200 })
    mocks.sessionFetch.mockResolvedValueOnce(response)
    await expect(fetchCatalogThroughSystemProxy('https://models.dev/api.json')).resolves.toBe(
      response
    )
    expect(mocks.fromPartition).toHaveBeenCalledTimes(3)
  })

  it('does not retry with an aborted request signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const error = new TypeError('net::ERR_FAILED')
    mocks.sessionFetch.mockRejectedValueOnce(error)

    await expect(
      fetchCatalogThroughSystemProxy('https://models.dev/api.json', { signal: controller.signal })
    ).rejects.toBe(error)
    expect(mocks.sessionFetch).toHaveBeenCalledOnce()
    expect(mocks.clearHostResolverCache).not.toHaveBeenCalled()
  })

  it('falls back to a Node CONNECT request when both Electron sessions fail', async () => {
    mocks.sessionFetch.mockRejectedValueOnce(new TypeError('net::ERR_FAILED'))
    mocks.sessionFetch.mockRejectedValueOnce(new TypeError('net::ERR_FAILED'))
    mocks.nodeRequest.mockImplementation(
      (
        _input: string,
        options: Record<string, unknown>,
        callback: (
          response: EventEmitter & {
            statusCode: number
            statusMessage: string
            headers: Record<string, string>
          }
        ) => void
      ) => {
        const request = new EventEmitter() as EventEmitter & { end: () => void }
        request.end = () => {
          const response = new EventEmitter() as EventEmitter & {
            statusCode: number
            statusMessage: string
            headers: Record<string, string>
          }
          response.statusCode = 200
          response.statusMessage = 'OK'
          response.headers = { etag: 'new-etag' }
          callback(response)
          response.emit('data', '{}')
          response.emit('end')
        }
        expect(options.agent).toEqual({ proxy: 'http://127.0.0.1:7897/' })
        return request
      }
    )

    await expect(
      fetchCatalogThroughSystemProxy('https://models.dev/api.json')
    ).resolves.toMatchObject({
      status: 200
    })
    expect(mocks.resolveProxy).toHaveBeenCalledWith('https://models.dev/api.json')
    expect(mocks.proxyAgent).toHaveBeenCalledWith('http://127.0.0.1:7897/')
  })
})
