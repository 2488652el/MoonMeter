import { describe, expect, it, vi } from 'vitest'

const settings = new Map<string, unknown>()

vi.mock('../../../code/src/main/store/keys-repo', () => ({
  listKeys: vi.fn(() => [
    {
      id: 'key-a',
      providerId: 'deepseek',
      alias: '个人账号',
      updatedAt: '2026-07-27T00:00:00.000Z'
    },
    {
      id: 'key-b',
      providerId: 'deepseek',
      alias: '团队账号',
      updatedAt: '2026-07-26T00:00:00.000Z'
    }
  ])
}))
vi.mock('../../../code/src/main/store/source-health-repo', () => ({
  listSourceHealth: vi.fn(() => [
    {
      sourceId: 'provider:deepseek',
      accountRef: 'key-a',
      sourceKind: 'provider',
      providerId: 'deepseek',
      displayName: '个人账号',
      status: 'ready',
      updatedAt: '2026-07-27T00:00:00.000Z'
    },
    {
      sourceId: 'provider:deepseek',
      accountRef: 'key-b',
      sourceKind: 'provider',
      providerId: 'deepseek',
      displayName: '团队账号',
      status: 'ready',
      updatedAt: '2026-07-26T00:00:00.000Z'
    },
    {
      sourceId: 'cli:opencode',
      accountRef: 'cli:opencode',
      sourceKind: 'cli',
      displayName: 'OpenCode 本地工作区',
      status: 'stale',
      updatedAt: '2026-07-25T00:00:00.000Z'
    }
  ])
}))
vi.mock('../../../code/src/main/store/usage-repo', () => ({
  listUsageWorkspaces: vi.fn(() => [{ label: 'tokengirl', lastSeenAt: '2026-07-27T00:00:00.000Z' }])
}))
vi.mock('../../../code/src/main/store/settings-store', () => ({
  getSetting: vi.fn((key: string) => settings.get(key) ?? null),
  setSetting: vi.fn((key: string, value: unknown) => settings.set(key, value))
}))
vi.mock('../../../code/src/main/sync/service', () => ({
  getSyncStatus: vi.fn(() => ({ configured: true })),
  listSyncDevices: vi.fn(async () => [
    { id: 'device-1', name: '工作电脑', createdAt: '2026-07-24T00:00:00.000Z', revokedAt: null }
  ])
}))

import {
  ACCOUNT_IDENTITY_PREFERENCES_SETTING_KEY,
  getAccountIdentityOverview,
  saveAccountIdentityPreferences
} from '../../../code/src/main/services/account-identities'

describe('AccountIdentity projection', () => {
  it('keeps same-provider keys separate while exposing independent source and device identities', async () => {
    const overview = await getAccountIdentityOverview()

    expect(overview.identities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'api-key:key-a', label: '个人账号', providerId: 'deepseek' }),
        expect.objectContaining({ id: 'api-key:key-b', label: '团队账号', providerId: 'deepseek' }),
        expect.objectContaining({ id: 'source:cli:opencode:cli:opencode', kind: 'source' }),
        expect.objectContaining({ kind: 'workspace', label: 'tokengirl' }),
        expect.objectContaining({ id: 'device:device-1', kind: 'device' })
      ])
    )
    expect(overview.identities).toHaveLength(5)
    expect(overview.identities.map((identity) => identity.id)).not.toContain(
      'source:provider:deepseek:key-a'
    )
  })

  it('persists display-only aliases and ordering without changing the source identities', async () => {
    const preferences = saveAccountIdentityPreferences({
      order: ['api-key:key-b', 'api-key:key-a', 'api-key:key-b'],
      aliasById: { 'api-key:key-b': 'DeepSeek 团队', 'api-key:key-a': '  ' }
    })
    const overview = await getAccountIdentityOverview()

    expect(settings.get(ACCOUNT_IDENTITY_PREFERENCES_SETTING_KEY)).toEqual(preferences)
    expect(overview.identities.slice(0, 2)).toMatchObject([
      { id: 'api-key:key-b', label: 'DeepSeek 团队' },
      { id: 'api-key:key-a', label: '个人账号' }
    ])
  })
})
