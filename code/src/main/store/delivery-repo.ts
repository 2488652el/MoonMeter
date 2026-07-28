import { randomUUID } from 'node:crypto'
import type { DeliveryEvent } from '@shared/types/project'
import { getDb } from './db'
import type { GitCommitSummary } from '../platform/git'

interface DeliveryRow {
  id: string
  workspace_id: string | null
  task_id: string | null
  kind: DeliveryEvent['kind']
  commit_id: string | null
  author_name: string | null
  authored_at: string | null
  title: string | null
  changed_files: number
  additions: number
  deletions: number
  pr_url: string | null
  pr_label: string | null
  confirmed: number
  created_at: string
  updated_at: string
}

function rowToDelivery(row: DeliveryRow): DeliveryEvent {
  return {
    id: row.id,
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    ...(row.task_id ? { taskId: row.task_id } : {}),
    kind: row.kind,
    ...(row.commit_id ? { commitId: row.commit_id } : {}),
    ...(row.author_name ? { authorName: row.author_name } : {}),
    ...(row.authored_at ? { authoredAt: row.authored_at } : {}),
    ...(row.title ? { title: row.title } : {}),
    changedFiles: row.changed_files,
    additions: row.additions,
    deletions: row.deletions,
    ...(row.pr_url ? { prUrl: row.pr_url } : {}),
    ...(row.pr_label ? { prLabel: row.pr_label } : {}),
    confirmed: row.confirmed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function upsertGitDelivery(
  workspaceId: string,
  commit: GitCommitSummary,
  now = new Date()
): DeliveryEvent {
  const timestamp = now.toISOString()
  const id = `delivery:${workspaceId}:${commit.commitId}`
  const db = getDb()
  db.prepare(
    `INSERT INTO delivery_events (
       id, workspace_id, kind, commit_id, author_name, authored_at, title,
       changed_files, additions, deletions, confirmed, created_at, updated_at
     ) VALUES (?, ?, 'commit', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(workspace_id, commit_id) DO UPDATE SET
       author_name = excluded.author_name,
       authored_at = excluded.authored_at,
       title = excluded.title,
       changed_files = excluded.changed_files,
       additions = excluded.additions,
       deletions = excluded.deletions,
       updated_at = excluded.updated_at`
  ).run(
    id,
    workspaceId,
    commit.commitId,
    commit.authorName ?? null,
    commit.authoredAt ?? null,
    commit.title ?? null,
    commit.changedFiles,
    commit.additions,
    commit.deletions,
    timestamp,
    timestamp
  )
  return rowToDelivery(
    db
      .prepare('SELECT * FROM delivery_events WHERE workspace_id = ? AND commit_id = ?')
      .get(workspaceId, commit.commitId) as DeliveryRow
  )
}

export function addManualPr(
  input: { workspaceId?: string; taskId?: string; url: string; label?: string },
  now = new Date()
): DeliveryEvent {
  const parsed = new URL(input.url)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('PR URL must be a public HTTPS URL')
  }
  const normalizedUrl = parsed.toString()
  const timestamp = now.toISOString()
  const id = `delivery:${randomUUID()}`
  const db = getDb()
  db.prepare(
    `INSERT INTO delivery_events (
       id, workspace_id, task_id, kind, pr_url, pr_label, confirmed, created_at, updated_at
     ) VALUES (?, ?, ?, 'pr', ?, ?, 1, ?, ?)`
  ).run(
    id,
    input.workspaceId ?? null,
    input.taskId ?? null,
    normalizedUrl,
    input.label?.trim().slice(0, 160) ?? null,
    timestamp,
    timestamp
  )
  return rowToDelivery(
    db.prepare('SELECT * FROM delivery_events WHERE id = ?').get(id) as DeliveryRow
  )
}

export function confirmDeliveryTask(
  deliveryId: string,
  taskId: string,
  now = new Date()
): DeliveryEvent {
  const db = getDb()
  const delivery = db
    .prepare('SELECT workspace_id FROM delivery_events WHERE id = ?')
    .get(deliveryId) as { workspace_id: string | null } | undefined
  if (!delivery) throw new Error('delivery event not found')
  const task = db.prepare('SELECT workspace_id FROM tasks WHERE id = ?').get(taskId) as
    { workspace_id: string | null } | undefined
  if (!task) throw new Error('task not found')
  if (delivery.workspace_id && task.workspace_id && delivery.workspace_id !== task.workspace_id) {
    throw new Error('task belongs to another workspace')
  }
  db.prepare(
    'UPDATE delivery_events SET task_id = ?, confirmed = 1, updated_at = ? WHERE id = ?'
  ).run(taskId, now.toISOString(), deliveryId)
  return rowToDelivery(
    db.prepare('SELECT * FROM delivery_events WHERE id = ?').get(deliveryId) as DeliveryRow
  )
}

export function listDeliveryEvents(workspaceId?: string): DeliveryEvent[] {
  const rows = workspaceId
    ? getDb()
        .prepare(
          'SELECT * FROM delivery_events WHERE workspace_id = ? ORDER BY COALESCE(authored_at, created_at) DESC'
        )
        .all(workspaceId)
    : getDb()
        .prepare('SELECT * FROM delivery_events ORDER BY COALESCE(authored_at, created_at) DESC')
        .all()
  return (rows as DeliveryRow[]).map(rowToDelivery)
}
