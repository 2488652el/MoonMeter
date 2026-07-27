/**
 * A local, read-only projection of an independently tracked account surface.
 * `id` is stable only inside this profile; it must never be sent to diagnostics
 * or telemetry because it can be derived from local configuration.
 */
export type AccountIdentityKind = 'api-key' | 'source' | 'workspace' | 'device'

export interface AccountIdentity {
  id: string
  kind: AccountIdentityKind
  label: string
  providerId?: string
  sourceLabel?: string
  status?: 'ready' | 'stale' | 'error' | 'unavailable' | 'disabled'
  lastSeenAt?: string
}

export interface AccountIdentityPreferences {
  aliasById: Record<string, string>
  order: string[]
}

export interface AccountIdentityOverview {
  identities: AccountIdentity[]
  preferences: AccountIdentityPreferences
}
