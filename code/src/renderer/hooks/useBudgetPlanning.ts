import { useCallback, useEffect, useState } from 'react'
import type { BudgetOverview } from '../../shared/types/budget'

export function useBudgetPlanning() {
  const [overview, setOverview] = useState<BudgetOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      setOverview(await window.api.budgets.overview())
      setError(null)
    } catch {
      setError('预算加载失败，请稍后重试')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { overview, loading, error, refresh }
}
