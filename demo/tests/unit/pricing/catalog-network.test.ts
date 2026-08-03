import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sessionFetch: vi.fn(),
  fromPartition: vi.fn(),
  setProxy: vi.fn(),
  clearHostResolverCache: vi.fn(),
  closeAllConnections: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: vi.fn() },
  session: {
    fromPartition: mocks.fromPartition
  }
}))

import { fetchCatalogThroughSystemProxy } from '../../../../code/src/main/services/catalog-network'

beforeEach(() => {
  mocks.sessionFetch.mockReset()
  mocks.fromPartition.mockReset()
  mocks.setProxy.mockReset()
  mocks.clearHostResolverCache.mockReset()
  mocks.closeAllConnections.mockReset()
  mocks.setProxy.mockResolvedValue(undefined)
  mocks.clearHostResolverCache.mockResolvedValue(undefined)
  mocks.closeAllConnections.mockResolvedValue(undefined)
  mocks.fromPartition.mockReturnValue({
    fetch: mocks.sessionFetch,
    setProxy: mocks.setProxy,
    clearHostResolverCache: mocks.clearHostResolverCache,
    closeAllConnections: mocks.closeAllConnections
  })
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
    expect(mocks.closeAllConnections).toHaveBeenCalledOnce()
    expect(mocks.sessionFetch).toHaveBeenCalledTimes(2)
    expect(mocks.fromPartition).toHaveBeenCalledWith('moonmeter-pricing-catalog')
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
})
