import type { QuotaForecast, QuotaSample, QuotaWindow } from '../types/quota-planning'

export function forecastQuota(
  current: QuotaWindow,
  samples: readonly QuotaSample[],
  now = new Date()
): QuotaForecast {
  const nowMs = now.getTime()
  const capturedMs = Date.parse(current.capturedAt)
  const freshUntilMs = Date.parse(current.freshUntil)
  const resetMs = current.resetAt ? Date.parse(current.resetAt) : NaN
  const currentUsed = usedPercent(current)

  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(capturedMs) ||
    !Number.isFinite(freshUntilMs) ||
    !Number.isFinite(currentUsed) ||
    currentUsed === null ||
    currentUsed < 0 ||
    currentUsed > 100
  ) {
    return unavailable('invalid-data')
  }
  if (nowMs > freshUntilMs) return unavailable('stale-data')
  if (!current.resetAt) return unavailable('missing-reset')
  if (!Number.isFinite(resetMs) || resetMs <= capturedMs) return unavailable('invalid-data')
  if (resetMs <= nowMs) return unavailable('window-changed')

  const sameSeries = samples.filter(
    (sample) =>
      sample.sourceId === current.sourceId &&
      sample.accountRef === current.accountRef &&
      sample.windowKey === current.windowKey &&
      sample.windowType === current.windowType &&
      sample.quotaKind === current.quotaKind &&
      sample.unit === current.unit &&
      sample.confidence === current.confidence &&
      sample.planRef === current.planRef
  )
  const otherCycle = sameSeries.some((sample) => sample.resetAt !== current.resetAt)
  const cycleSamples = sameSeries.filter((sample) => sample.resetAt === current.resetAt)
  if (otherCycle && cycleSamples.length < 3) return unavailable('window-changed')

  const byTimestamp = new Map<number, { sample: QuotaSample; used: number }>()
  for (const sample of cycleSamples) {
    const timestamp = Date.parse(sample.capturedAt)
    const used = usedPercent(sample)
    if (
      Number.isFinite(timestamp) &&
      used !== null &&
      Number.isFinite(used) &&
      used >= 0 &&
      used <= 100
    ) {
      byTimestamp.set(timestamp, { sample, used })
    }
  }
  const ordered = [...byTimestamp.entries()]
    .sort(([left], [right]) => left - right)
    .map(([timestamp, value]) => ({ timestamp, ...value }))
  if (ordered.length < 3) return unavailable('insufficient-samples')

  const rates: number[] = []
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!
    const next = ordered[index]!
    const hours = (next.timestamp - previous.timestamp) / 3_600_000
    const consumed = next.used - previous.used
    if (hours > 0 && consumed >= 0) rates.push(consumed / hours)
  }
  if (rates.length < 2) return unavailable('invalid-data')

  const medianRatePerHour = median(rates)
  const hoursUntilReset = Math.max(0, (resetMs - capturedMs) / 3_600_000)
  const projectedUsedAtReset = currentUsed + medianRatePerHour * hoursUntilReset
  if (!Number.isFinite(projectedUsedAtReset)) return unavailable('invalid-data')

  return {
    available: true,
    category:
      projectedUsedAtReset > 105
        ? 'exhausts-early'
        : projectedUsedAtReset >= 80
          ? 'sustainable'
          : 'may-waste',
    medianRatePerHour,
    projectedUsedAtReset,
    currentUsedPercent: currentUsed,
    sampleCount: ordered.length,
    sampleStart: ordered[0]!.sample.capturedAt,
    sampleEnd: ordered.at(-1)!.sample.capturedAt,
    resetAt: current.resetAt
  }
}

export function median(values: readonly number[]): number {
  const sorted = values
    .filter(Number.isFinite)
    .slice()
    .sort((left, right) => left - right)
  if (sorted.length === 0) return NaN
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
}

function usedPercent(input: Pick<QuotaWindow, 'usedPercent' | 'used' | 'limit'>): number | null {
  if (input.usedPercent !== undefined) return input.usedPercent
  if (
    input.used !== undefined &&
    input.limit !== undefined &&
    Number.isFinite(input.used) &&
    Number.isFinite(input.limit) &&
    input.limit > 0
  ) {
    return (input.used / input.limit) * 100
  }
  return null
}

function unavailable(
  reason: Extract<QuotaForecast, { available: false }>['reason']
): QuotaForecast {
  return { available: false, reason }
}
