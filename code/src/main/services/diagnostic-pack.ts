import { listKeys } from '../store/keys-repo'
import { listPricing } from '../store/pricing-repo'
import { listSourceHealth } from '../store/source-health-repo'
import { computeTotalSpend } from '../store/usage-repo'
import type { SanitizedDiagnosticPack } from '@shared/types/diagnostics'

/**
 * Builds an in-memory support payload. Do not add user-provided aliases,
 * account refs, paths, raw errors, keys, prompts, or request content here.
 */
export function createSanitizedDiagnosticPack(
  appVersion: string,
  now = new Date()
): SanitizedDiagnosticPack {
  const spend = computeTotalSpend({})
  const sources = listSourceHealth().map((source) => ({
    sourceId: source.sourceId,
    sourceKind: source.sourceKind,
    permissionStatus: source.permissionStatus,
    status: source.status,
    ...(source.providerId ? { providerId: source.providerId } : {}),
    ...(source.lastAttemptAt ? { lastAttemptAt: source.lastAttemptAt } : {}),
    ...(source.lastSuccessAt ? { lastSuccessAt: source.lastSuccessAt } : {}),
    ...(source.errorCode ? { errorCode: source.errorCode } : {})
  }))
  return {
    generatedAt: now.toISOString(),
    appVersion,
    platform: process.platform,
    counts: {
      configuredKeyCount: listKeys().length,
      pricingEntryCount: listPricing().length,
      sourceCount: sources.length,
      usageRecordCount: spend.totalRequests,
      pricedRequestCount: spend.pricedRequests,
      estimatedRequestCount: spend.estimatedRequests,
      unpricedRequestCount: spend.unpricedRequests
    },
    sources,
    unconvertedCurrencies: spend.unconvertedCurrencies
  }
}
