import type { ProjectDetail, ProjectListFilter, ProjectListPage } from '@shared/types/project'
import { getProjectDetail, listProjectSummaries } from '../store/project-repo'
import { refreshGitDelivery } from './git-delivery'

let refreshInFlight: Promise<unknown> | null = null

async function refreshDeliverySafely(): Promise<void> {
  if (!refreshInFlight) {
    refreshInFlight = refreshGitDelivery().finally(() => {
      refreshInFlight = null
    })
  }
  await refreshInFlight
}

/** Main-owned project aggregation; Git evidence is advisory and fail-soft. */
export async function getProjectsOverview(
  filter: ProjectListFilter = {}
): Promise<ProjectListPage> {
  await refreshDeliverySafely().catch(() => undefined)
  return listProjectSummaries(filter)
}

export async function getProjectDetails(id: string, days = 30): Promise<ProjectDetail | null> {
  await refreshDeliverySafely().catch(() => undefined)
  return getProjectDetail(id, days)
}
