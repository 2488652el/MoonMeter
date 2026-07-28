import { readGitCommits, type GitRootErrorCode } from '../platform/git'
import { getDb } from '../store/db'
import { upsertGitDelivery } from '../store/delivery-repo'

interface WorkspaceRow {
  id: string
  environment: 'windows' | 'wsl'
  wsl_distribution: string
  normalized_root: string
  normalized_git_root: string | null
}

function rootForGit(row: WorkspaceRow): string {
  const value = row.normalized_git_root ?? row.normalized_root
  if (row.environment !== 'wsl') return value
  const marker = `${row.wsl_distribution}:`
  return value.startsWith(marker) ? value.slice(marker.length) || '/' : value
}

export interface GitDeliveryRefreshResult {
  workspaceId: string
  commits: number
  errorCode?: GitRootErrorCode
}

/** Refresh read-only commit/numstat evidence for all known workspaces. */
export async function refreshGitDelivery(): Promise<GitDeliveryRefreshResult[]> {
  const workspaces = getDb()
    .prepare(
      `SELECT id, environment, wsl_distribution, normalized_root, normalized_git_root
       FROM workspaces ORDER BY updated_at DESC`
    )
    .all() as WorkspaceRow[]
  const results: GitDeliveryRefreshResult[] = []
  for (const workspace of workspaces) {
    const result = await readGitCommits(
      rootForGit(workspace),
      workspace.environment,
      workspace.environment === 'wsl' ? workspace.wsl_distribution : undefined
    )
    for (const commit of result.commits) upsertGitDelivery(workspace.id, commit)
    results.push({
      workspaceId: workspace.id,
      commits: result.commits.length,
      ...(result.errorCode ? { errorCode: result.errorCode } : {})
    })
  }
  return results
}
