import type { TimelineFilter, TimelinePage } from '@shared/types/timeline'
import { cleanupTimelineDetails, listTimeline } from '../store/timeline-repo'

let lastCleanupDay: string | undefined

export function getTimeline(filter: TimelineFilter = {}): TimelinePage {
  return listTimeline(filter)
}

export function cleanupTimeline(now = new Date()): number {
  const day = now.toISOString().slice(0, 10)
  if (lastCleanupDay === day) return 0
  lastCleanupDay = day
  return cleanupTimelineDetails(now)
}
