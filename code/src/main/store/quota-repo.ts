import { getDb } from './db'
import type { QuotaWindow } from '@shared/types/quota-planning'

const RETENTION_DAYS = 90
const MAX_SAMPLES_PER_SERIES = 5_000

export interface PersistedQuotaSample {
  sourceId: string
  providerId: string
  accountRef: string
  accountLabel: string
  quotaKind: 'hard-quota' | 'balance' | 'soft-limit' | 'local-estimate'
  windowType: 'rolling' | 'calendar' | 'balance' | 'unknown'
  windowKey: string
  windowSeconds?: number
  usedPercent?: number
  used?: number
  remaining?: number
  limit?: number
  unit: 'percent' | 'tokens' | 'requests' | 'currency'
  resetAt?: string
  capturedAt: string
  freshUntil: string
  confidence: 'measured' | 'derived' | 'estimated'
}

interface QuotaSampleRow {
  source_id: string
  provider_id: string
  account_ref: string
  account_label: string
  quota_kind: PersistedQuotaSample['quotaKind']
  window_type: PersistedQuotaSample['windowType']
  window_key: string
  window_seconds: number | null
  used_percent: number | null
  used: number | null
  remaining: number | null
  limit_value: number | null
  unit: PersistedQuotaSample['unit']
  reset_at: string | null
  captured_at: string
  fresh_until: string
  confidence: PersistedQuotaSample['confidence']
}

function rowToSample(row: QuotaSampleRow): PersistedQuotaSample {
  return {
    sourceId: row.source_id,
    providerId: row.provider_id,
    accountRef: row.account_ref,
    accountLabel: row.account_label,
    quotaKind: row.quota_kind,
    windowType: row.window_type,
    windowKey: row.window_key,
    unit: row.unit,
    capturedAt: row.captured_at,
    freshUntil: row.fresh_until,
    confidence: row.confidence,
    ...(row.window_seconds !== null ? { windowSeconds: row.window_seconds } : {}),
    ...(row.used_percent !== null ? { usedPercent: row.used_percent } : {}),
    ...(row.used !== null ? { used: row.used } : {}),
    ...(row.remaining !== null ? { remaining: row.remaining } : {}),
    ...(row.limit_value !== null ? { limit: row.limit_value } : {}),
    ...(row.reset_at !== null ? { resetAt: row.reset_at } : {})
  }
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function insertQuotaSamples(samples: PersistedQuotaSample[], now = new Date()): number {
  const db = getDb()
  const insert = db.prepare(
    `
      INSERT OR IGNORE INTO quota_samples (
        source_id, provider_id, account_ref, account_label, quota_kind,
        window_type, window_key, window_seconds, used_percent, used, remaining, limit_value,
        unit, reset_at, captured_at, fresh_until, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  )
  let inserted = 0
  db.transaction(() => {
    for (const sample of samples) {
      const result = insert.run(
        sample.sourceId,
        sample.providerId,
        sample.accountRef,
        sample.accountLabel,
        sample.quotaKind,
        sample.windowType,
        sample.windowKey,
        finiteOrNull(sample.windowSeconds),
        finiteOrNull(sample.usedPercent),
        finiteOrNull(sample.used),
        finiteOrNull(sample.remaining),
        finiteOrNull(sample.limit),
        sample.unit,
        sample.resetAt ?? null,
        sample.capturedAt,
        sample.freshUntil,
        sample.confidence
      )
      inserted += result.changes
    }

    pruneQuotaSamples(now, db)

    for (const sample of samples) {
      db.prepare(
        `
          DELETE FROM quota_samples
          WHERE source_id = ? AND account_ref = ? AND window_key = ?
            AND id NOT IN (
              SELECT id FROM quota_samples
              WHERE source_id = ? AND account_ref = ? AND window_key = ?
              ORDER BY captured_at DESC, id DESC
              LIMIT ?
            )
        `
      ).run(
        sample.sourceId,
        sample.accountRef,
        sample.windowKey,
        sample.sourceId,
        sample.accountRef,
        sample.windowKey,
        MAX_SAMPLES_PER_SERIES
      )
    }
  })()
  return inserted
}

export function pruneQuotaSamples(
  now = new Date(),
  db: ReturnType<typeof getDb> = getDb()
): number {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString()
  return db.prepare('DELETE FROM quota_samples WHERE captured_at < ?').run(cutoff).changes
}

export function persistQuotaWindows(
  windows: readonly QuotaWindow[],
  providerId: string,
  accountLabel: string,
  now = new Date()
): number {
  return insertQuotaSamples(
    windows.map((window) => ({
      ...window,
      providerId,
      accountLabel,
      ...(window.usedPercent !== undefined
        ? { remaining: Math.max(0, 100 - window.usedPercent), limit: 100 }
        : {})
    })),
    now
  )
}

export function listQuotaSamples(limit = 10_000): PersistedQuotaSample[] {
  const safeLimit = Math.max(1, Math.min(50_000, Math.floor(limit)))
  const rows = getDb()
    .prepare(
      `
        SELECT source_id, provider_id, account_ref, account_label, quota_kind,
          window_type, window_key, window_seconds, used_percent, used, remaining, limit_value,
          unit, reset_at, captured_at, fresh_until, confidence
        FROM quota_samples
        ORDER BY captured_at DESC, id DESC
        LIMIT ?
      `
    )
    .all(safeLimit) as QuotaSampleRow[]
  return rows.map(rowToSample)
}
