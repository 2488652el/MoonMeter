import { useCallback, useEffect, useState } from 'react'
import type { QuotaPlanningOverview } from '../../shared/types/quota-planning'

const REFRESH_INTERVAL_MS = 60_000

export function useQuotaPlanning() {
  const [overview, setOverview] = useState<QuotaPlanningOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      setOverview(await window.api.quotaPlanning.overview())
      setError(null)
    } catch {
      setError('额度规划加载失败，请稍后重试')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(true), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  return { overview, loading, error, refresh }
}
