export type SyncScheduler = {
  trigger(): Promise<void>
  dispose(): void
}

export function createSyncScheduler(
  run: () => Promise<void>,
  options: {
    baseDelayMs?: number
    maxDelayMs?: number
    shouldRetry?: (error: unknown) => boolean
  } = {}
): SyncScheduler {
  const baseDelayMs = options.baseDelayMs ?? 1_000
  const maxDelayMs = options.maxDelayMs ?? 30 * 60_000
  let inFlight: Promise<void> | null = null
  let pending: Promise<void> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let failures = 0
  let disposed = false

  const scheduleRetry = (): void => {
    if (disposed || retryTimer) return
    const exponent = Math.min(failures - 1, 30)
    const delay = Math.min(baseDelayMs * 2 ** exponent, maxDelayMs)
    retryTimer = setTimeout(() => {
      retryTimer = null
      void runOnce().catch(() => undefined)
    }, delay)
  }

  const runOnce = (): Promise<void> => {
    if (pending) return pending
    if (inFlight) {
      const activeRun = inFlight
      const queuedRun: Promise<void> = activeRun
        .catch(() => undefined)
        .then(() => {
          if (pending === queuedRun) pending = null
          if (disposed) return
          if (retryTimer) {
            clearTimeout(retryTimer)
            retryTimer = null
          }
          return runOnce()
        })
      pending = queuedRun
      return queuedRun
    }
    const activeRun: Promise<void> = Promise.resolve()
      .then(run)
      .then(() => {
        failures = 0
      })
      .catch((error: unknown) => {
        failures++
        if (options.shouldRetry?.(error) ?? true) scheduleRetry()
        throw error
      })
      .finally(() => {
        if (inFlight === activeRun) inFlight = null
      })
    inFlight = activeRun
    return activeRun
  }

  return {
    trigger() {
      if (disposed) return Promise.reject(new Error('sync scheduler disposed'))
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      return runOnce()
    },
    dispose() {
      disposed = true
      pending = null
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = null
    }
  }
}
