export interface SanitizedDiagnosticSource {
  sourceId: string
  sourceKind: 'provider' | 'codex' | 'cli'
  providerId?: string
  permissionStatus: 'granted' | 'missing' | 'auth-required' | 'permission-required' | 'unknown'
  status: 'ready' | 'stale' | 'error' | 'unavailable' | 'disabled'
  lastAttemptAt?: string
  lastSuccessAt?: string
  errorCode?: string
}

/** A local support payload that deliberately excludes credentials, aliases, paths, prompts and raw errors. */
export interface SanitizedDiagnosticPack {
  generatedAt: string
  appVersion: string
  platform: string
  counts: {
    configuredKeyCount: number
    pricingEntryCount: number
    sourceCount: number
    usageRecordCount: number
    pricedRequestCount: number
    estimatedRequestCount: number
    unpricedRequestCount: number
  }
  sources: SanitizedDiagnosticSource[]
  unconvertedCurrencies: string[]
}
