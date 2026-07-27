import type {
  AccountIdentity,
  AccountIdentityOverview,
  AccountIdentityPreferences
} from '@shared/types/account-identity'
import { createHash } from 'node:crypto'
import { listKeys } from '../store/keys-repo'
import { listSourceHealth } from '../store/source-health-repo'
import { listUsageWorkspaces } from '../store/usage-repo'
import { getSetting, setSetting } from '../store/settings-store'
import { getSyncStatus, listSyncDevices } from '../sync/service'

export const ACCOUNT_IDENTITY_PREFERENCES_SETTING_KEY = 'account_identity_preferences'

const EMPTY_PREFERENCES: AccountIdentityPreferences = { aliasById: {}, order: [] }

function readPreferences(): AccountIdentityPreferences {
  const value = getSetting<Partial<AccountIdentityPreferences>>(
    ACCOUNT_IDENTITY_PREFERENCES_SETTING_KEY
  )
  if (
    !value ||
    !Array.isArray(value.order) ||
    !value.aliasById ||
    typeof value.aliasById !== 'object'
  ) {
    return EMPTY_PREFERENCES
  }
  return {
    order: value.order.filter((id): id is string => typeof id === 'string'),
    aliasById: Object.fromEntries(
      Object.entries(value.aliasById).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'string'
      )
    )
  }
}

function applyPreferences(
  identities: AccountIdentity[],
  preferences: AccountIdentityPreferences
): AccountIdentity[] {
  const identityById = new Map(identities.map((identity) => [identity.id, identity]))
  const ordered: AccountIdentity[] = []
  for (const id of preferences.order) {
    const identity = identityById.get(id)
    if (!identity) continue
    identityById.delete(id)
    const alias = preferences.aliasById[id]?.trim()
    ordered.push(alias ? { ...identity, label: alias } : identity)
  }
  return [
    ...ordered,
    ...[...identityById.values()]
      .map((identity) => {
        const alias = preferences.aliasById[identity.id]?.trim()
        return alias ? { ...identity, label: alias } : identity
      })
      .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
  ]
}

/**
 * Builds a display-only identity list. API Key rows stay separate from every
 * other Key for the same provider; no balances, percentages, or costs are
 * aggregated here.
 */
export async function getAccountIdentityOverview(): Promise<AccountIdentityOverview> {
  const keys = listKeys()
  const keyIds = new Set(keys.map((key) => key.id))
  const identities: AccountIdentity[] = keys.map((key) => ({
    id: `api-key:${key.id}`,
    kind: 'api-key',
    label: key.alias,
    providerId: key.providerId,
    sourceLabel: 'API Key',
    lastSeenAt: key.updatedAt
  }))

  for (const source of listSourceHealth()) {
    // Provider health is the same identity as an API Key when accountRef is a
    // key id, so enrich neither row by creating a duplicate card.
    if (source.sourceKind === 'provider' && keyIds.has(source.accountRef)) continue
    identities.push({
      id: `source:${source.sourceId}:${source.accountRef}`,
      kind: 'source',
      label: source.displayName,
      ...(source.providerId ? { providerId: source.providerId } : {}),
      sourceLabel: source.sourceKind === 'cli' ? '本地 Coding Agent' : source.sourceKind,
      status: source.status,
      lastSeenAt: source.lastSuccessAt ?? source.updatedAt
    })
  }

  for (const workspace of listUsageWorkspaces()) {
    // The ID is deterministic inside the profile but avoids putting a project
    // label into an internal identifier that may later be used in a URL.
    const workspaceId = createHash('sha256').update(workspace.label).digest('hex').slice(0, 16)
    identities.push({
      id: `workspace:${workspaceId}`,
      kind: 'workspace',
      label: workspace.label,
      sourceLabel: '本地工作区',
      lastSeenAt: workspace.lastSeenAt
    })
  }

  if (getSyncStatus().configured) {
    const devices = await listSyncDevices().catch(() => [])
    for (const device of devices) {
      identities.push({
        id: `device:${device.id}`,
        kind: 'device',
        label: device.name,
        sourceLabel: device.revokedAt ? '已撤销同步设备' : '同步设备',
        lastSeenAt: device.createdAt
      })
    }
  }

  const preferences = readPreferences()
  return { identities: applyPreferences(identities, preferences), preferences }
}

export function saveAccountIdentityPreferences(
  preferences: AccountIdentityPreferences
): AccountIdentityPreferences {
  const normalized: AccountIdentityPreferences = {
    order: [...new Set(preferences.order)],
    aliasById: Object.fromEntries(
      Object.entries(preferences.aliasById)
        .map(([id, alias]) => [id, alias.trim()] as const)
        .filter(([, alias]) => alias.length > 0)
    )
  }
  setSetting(ACCOUNT_IDENTITY_PREFERENCES_SETTING_KEY, normalized)
  return normalized
}
