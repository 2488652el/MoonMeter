import { useCallback, useEffect, useState } from 'react'
import type { LocalReportOverview, LocalReportPeriodKind } from '../../shared/types/local-report'

export function useLocalReports() {
  const [periodKind, setPeriodKind] = useState<LocalReportPeriodKind>('month')
  const [overview, setOverview] = useState<LocalReportOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      try {
        setOverview(await window.api.localReports.get(periodKind))
        setError(null)
      } catch {
        setError('本地报告加载失败，请稍后重试')
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [periodKind]
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      await window.api.localReports.setEnabled(enabled)
      await refresh()
    },
    [refresh]
  )

  const setRecommendationsEnabled = useCallback(
    async (enabled: boolean) => {
      await window.api.localRecommendations.setEnabled(enabled)
      await refresh()
    },
    [refresh]
  )

  return {
    periodKind,
    setPeriodKind,
    overview,
    loading,
    error,
    refresh,
    setEnabled,
    setRecommendationsEnabled
  }
}
