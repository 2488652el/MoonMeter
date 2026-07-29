import type { TimelineFilter, TimelinePage } from '@shared/types/timeline'
import { cleanupTimelineDetails, listTimeline } from '../store/timeline-repo'

let lastCleanupDay: string | undefined

export function getTimeline(filter: TimelineFilter = {}): TimelinePage {
  return listTimeline(filter)
}

export function cleanupTimeline(now = new Date(), force = false): number {
  const day = now.toISOString().slice(0, 10)
  if (!force && lastCleanupDay === day) return 0
  lastCleanupDay = day
  return cleanupTimelineDetails(now)
}
