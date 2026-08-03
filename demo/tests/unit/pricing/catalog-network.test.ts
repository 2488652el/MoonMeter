import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  setProxy: vi.fn(),
  clearHostResolverCache: vi.fn(),
  closeAllConnections: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: mocks.fetch },
  session: {
    defaultSession: {
      setProxy: mocks.setProxy,
      clearHostResolverCache: mocks.clearHostResolverCache,
      closeAllConnections: mocks.closeAllConnections
    }
  }
}))

import { fetchCatalogThroughSystemProxy } from '../../../../code/src/main/services/catalog-network'

beforeEach(() => {
  mocks.fetch.mockReset()
  mocks.setProxy.mockReset()
  mocks.clearHostResolverCache.mockReset()
  mocks.closeAllConnections.mockReset()
  mocks.setProxy.mockResolvedValue(undefined)
  mocks.clearHostResolverCache.mockResolvedValue(undefined)
  mocks.closeAllConnections.mockResolvedValue(undefined)
})

describe('catalog-network', () => {
  it('refreshes the system network session and retries after net::ERR_FAILED', async () => {
    const response = new Response('{}', { status: 200 })
    mocks.fetch.mockRejectedValueOnce(new TypeError('net::ERR_FAILED'))
    mocks.fetch.mockResolvedValueOnce(response)

    await expect(fetchCatalogThroughSystemProxy('https://models.dev/api.json')).resolves.toBe(
      response
    )
    expect(mocks.setProxy).toHaveBeenCalledWith({ mode: 'system' })
    expect(mocks.clearHostResolverCache).toHaveBeenCalledOnce()
    expect(mocks.closeAllConnections).toHaveBeenCalledOnce()
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })

  it('does not reset the session after a successful request', async () => {
    const response = new Response('{}', { status: 200 })
    mocks.fetch.mockResolvedValueOnce(response)

    await expect(fetchCatalogThroughSystemProxy('https://models.dev/api.json')).resolves.toBe(
      response
    )
    expect(mocks.setProxy).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledOnce()
  })
})
