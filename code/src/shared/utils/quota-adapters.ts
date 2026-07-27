import type { CodexUsageSnapshot, CodexUsageWindow } from '../types/codex-usage'
import type { QuotaConfidence, QuotaKind, QuotaWindow } from '../types/quota-planning'
import { extractKimiCodingQuotas } from './kimi-quota'
import { extractCodingPlanQuotas } from './minimax-quota'

export interface QuotaAdapterContext {
  sourceId: string
  accountRef: string
  capturedAt: string
  refreshIntervalMs: number
  quotaKind?: QuotaKind
  confidence?: QuotaConfidence
}

const MIN_DYNAMIC_TTL_MS = 10 * 60_000
const MAX_DYNAMIC_TTL_MS = 30 * 60_000
const BALANCE_TTL_MS = 24 * 60 * 60_000

export function quotaFreshUntil(
  capturedAt: string,
  refreshIntervalMs: number,
  kind: QuotaKind = 'hard-quota'
): string | null {
  const capturedMs = Date.parse(capturedAt)
  if (!Number.isFinite(capturedMs)) return null
  const ttl =
    kind === 'balance'
      ? BALANCE_TTL_MS
      : Math.min(Math.max(2 * refreshIntervalMs, MIN_DYNAMIC_TTL_MS), MAX_DYNAMIC_TTL_MS)
  if (!Number.isFinite(ttl) || ttl <= 0) return null
  return new Date(capturedMs + ttl).toISOString()
}

export function adaptCodexQuota(
  snapshot: CodexUsageSnapshot,
  context: Omit<QuotaAdapterContext, 'capturedAt'>
): QuotaWindow[] {
  const capturedAt = snapshot.fetchedAt
  return [
    codexWindow('5h', snapshot.fiveHour, capturedAt, context),
    codexWindow('7d', snapshot.oneWeek, capturedAt, context)
  ].filter((window): window is QuotaWindow => window !== null)
}

export function adaptKimiQuota(raw: unknown, context: QuotaAdapterContext): QuotaWindow[] {
  const quotas = extractKimiCodingQuotas(raw)
  return [
    percentWindow('7d', quotas.weeklyWindow, context),
    percentWindow(quotas.rateWindow?.label ?? 'rolling', quotas.rateWindow, context)
  ].filter((window): window is QuotaWindow => window !== null)
}

export function adaptMiniMaxQuota(raw: unknown, context: QuotaAdapterContext): QuotaWindow[] {
  const quotas = extractCodingPlanQuotas(raw)
  return [
    percentWindow('5h', quotas.shortWindow, context),
    percentWindow('7d', quotas.weeklyWindow, context)
  ].filter((window): window is QuotaWindow => window !== null)
}

function codexWindow(
  windowKey: string,
  input: CodexUsageWindow | null,
  capturedAt: string,
  context: Omit<QuotaAdapterContext, 'capturedAt'>
): QuotaWindow | null {
  if (!input) return null
  return makeWindow(windowKey, input.usedPercent, input.resetAt ?? undefined, {
    ...context,
    capturedAt
  })
}

function percentWindow(
  windowKey: string,
  input: { usedPercent?: number; resetText?: string } | null,
  context: QuotaAdapterContext
): QuotaWindow | null {
  if (!input) return null
  const resetAt = parseReset(input.resetText)
  return makeWindow(windowKey, input.usedPercent, resetAt, context)
}

function makeWindow(
  windowKey: string,
  usedPercent: number | undefined,
  resetAt: string | undefined,
  context: QuotaAdapterContext
): QuotaWindow | null {
  const freshUntil = quotaFreshUntil(
    context.capturedAt,
    context.refreshIntervalMs,
    context.quotaKind
  )
  if (
    !freshUntil ||
    !Number.isFinite(usedPercent) ||
    usedPercent === undefined ||
    usedPercent < 0 ||
    usedPercent > 100
  ) {
    return null
  }
  return {
    sourceId: context.sourceId,
    accountRef: context.accountRef,
    windowKey,
    windowType: windowKey === '7d' ? 'calendar' : 'rolling',
    quotaKind: context.quotaKind ?? 'hard-quota',
    unit: 'percent',
    capturedAt: context.capturedAt,
    freshUntil,
    confidence: context.confidence ?? 'measured',
    usedPercent,
    ...(resetAt ? { resetAt } : {})
  }
}

function parseReset(value: string | undefined): string | undefined {
  if (!value) return undefined
  const candidate = value.replace(/^重置\s*/, '').trim()
  const timestamp = Date.parse(candidate)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined
}
