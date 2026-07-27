import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../code/src/main/store/keys-repo', () => ({
  listKeys: vi.fn(() => [{ id: 'key-private', alias: 'Alice Production', providerId: 'deepseek' }])
}))
vi.mock('../../../code/src/main/store/pricing-repo', () => ({
  listPricing: vi.fn(() => [{ providerId: 'deepseek', model: 'deepseek-chat' }])
}))
vi.mock('../../../code/src/main/store/source-health-repo', () => ({
  listSourceHealth: vi.fn(() => [
    {
      sourceId: 'provider:deepseek',
      accountRef: 'key-private',
      sourceKind: 'provider',
      providerId: 'deepseek',
      displayName: 'Alice Production',
      permissionStatus: 'auth-required',
      status: 'error',
      errorCode: 'auth-required',
      errorMessage: 'raw endpoint https://private.example.com leaked',
      updatedAt: '2026-07-27T00:00:00.000Z'
    }
  ])
}))
vi.mock('../../../code/src/main/store/usage-repo', () => ({
  computeTotalSpend: vi.fn(() => ({
    totalRequests: 12,
    pricedRequests: 8,
    estimatedRequests: 3,
    unpricedRequests: 1,
    unconvertedCurrencies: ['JPY']
  }))
}))

import { createSanitizedDiagnosticPack } from '../../../code/src/main/services/diagnostic-pack'

describe('sanitized diagnostic pack', () => {
  it('contains support-relevant status while excluding aliases, account refs and raw errors', () => {
    const pack = createSanitizedDiagnosticPack('1.2.52', new Date('2026-07-27T00:00:00.000Z'))
    expect(pack).toMatchObject({
      appVersion: '1.2.52',
      counts: {
        configuredKeyCount: 1,
        pricingEntryCount: 1,
        sourceCount: 1,
        usageRecordCount: 12,
        pricedRequestCount: 8,
        estimatedRequestCount: 3,
        unpricedRequestCount: 1
      },
      sources: [
        {
          sourceId: 'provider:deepseek',
          providerId: 'deepseek',
          status: 'error',
          errorCode: 'auth-required'
        }
      ],
      unconvertedCurrencies: ['JPY']
    })
    const serialized = JSON.stringify(pack)
    expect(serialized).not.toContain('Alice Production')
    expect(serialized).not.toContain('key-private')
    expect(serialized).not.toContain('private.example.com')
  })
})
