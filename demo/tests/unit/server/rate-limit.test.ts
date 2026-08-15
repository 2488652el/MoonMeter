import { describe, expect, it } from 'vitest'
import { createRateLimiter, RateLimitError } from '../../../../drive/src/server/rate-limit'

describe('rate limiter', () => {
  it('limits a key within a window and resets after it expires', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000 })

    limiter.check('device', 0)
    expect(() => limiter.check('device', 500)).toThrow(RateLimitError)
    expect(() => limiter.check('device', 1000)).not.toThrow()
  })

  it('evicts expired windows once the key set exceeds its cap', () => {
    const windowMs = 1000
    const limiter = createRateLimiter({ max: 1, windowMs, maxTrackedKeys: 100 })

    for (let i = 0; i < 200; i++) limiter.check(`key-${i}`, 0)

    // 旧窗口过期后触发淘汰；新 key 正常计数而不是被旧条目永久挤占。
    limiter.check('fresh-key', windowMs + 1)
    expect(() => limiter.check('fresh-key', windowMs + 1)).toThrow(RateLimitError)
  })

  it('keeps active high-cardinality keys bounded by evicting the oldest key', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 10_000, maxTrackedKeys: 2 })

    limiter.check('oldest', 0)
    limiter.check('retained', 1)
    limiter.check('newest', 2)

    // The active oldest entry was evicted, while the newer entry remains
    // rate-limited. A rotating-key flood therefore cannot grow the Map.
    expect(() => limiter.check('newest', 3)).toThrow(RateLimitError)
    expect(() => limiter.check('oldest', 4)).not.toThrow()
    expect(() => limiter.check('newest', 5)).toThrow(RateLimitError)
  })
})
