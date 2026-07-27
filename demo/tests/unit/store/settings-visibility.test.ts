import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../../code/src/main/store/db', () => ({
  getDb: () => ({
    prepare: () => ({
      all: () => [
        { key: 'refresh_interval_min', value: '30' },
        { key: 'pricing_catalog_last_attempt_at', value: '"internal"' },
        { key: 'pricing_exchange_policy', value: '"fixed"' },
        { key: 'quota_account_ref_salt', value: '"local-secret"' }
      ]
    })
  })
}))
vi.mock('../../../../code/src/main/store/sync-v2-repo', () => ({ markSyncV2Dirty: vi.fn() }))

import { getAllSettings } from '../../../../code/src/main/store/settings-store'

describe('settings visibility', () => {
  it('does not expose pricing or local quota identity metadata through generic settings', () => {
    expect(getAllSettings()).toEqual({ refresh_interval_min: 30 })
  })
})
