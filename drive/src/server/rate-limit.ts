export type RateLimitOptions = { max: number; windowMs: number; maxTrackedKeys?: number }

export class RateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('rate limit exceeded')
    this.name = 'RateLimitError'
  }
}

const DEFAULT_MAX_TRACKED_KEYS = 50_000

export function createRateLimiter(options: RateLimitOptions) {
  const maxTrackedKeys = options.maxTrackedKeys ?? DEFAULT_MAX_TRACKED_KEYS
  if (!Number.isInteger(options.max) || options.max <= 0) {
    throw new Error('rate limiter max must be a positive integer')
  }
  if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
    throw new Error('rate limiter windowMs must be positive')
  }
  if (!Number.isInteger(maxTrackedKeys) || maxTrackedKeys <= 0) {
    throw new Error('rate limiter maxTrackedKeys must be a positive integer')
  }
  const windows = new Map<string, { startedAt: number; count: number }>()

  function evictExpired(now: number): void {
    // Map insertion order is the eviction order. Expired windows are removed
    // from the front, so each entry is inspected at most once per insertion.
    while (windows.size > 0) {
      const oldest = windows.entries().next().value as
        [string, { startedAt: number; count: number }] | undefined
      if (!oldest || now - oldest[1].startedAt < options.windowMs) return
      windows.delete(oldest[0])
    }
  }

  function trackNewKey(key: string, now: number): void {
    evictExpired(now)
    if (windows.size >= maxTrackedKeys) {
      const oldestKey = windows.keys().next().value as string | undefined
      if (oldestKey !== undefined) windows.delete(oldestKey)
    }
    windows.set(key, { startedAt: now, count: 1 })
  }

  return {
    check(key: string, now = Date.now()): void {
      const current = windows.get(key)
      if (!current || now - current.startedAt >= options.windowMs) {
        if (current) windows.delete(key)
        trackNewKey(key, now)
        return
      }
      if (current.count >= options.max) {
        throw new RateLimitError(
          Math.max(1, Math.ceil((options.windowMs - (now - current.startedAt)) / 1000))
        )
      }
      current.count++
    }
  }
}
