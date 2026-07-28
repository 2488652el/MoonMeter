import { randomUUID } from 'node:crypto'
import type { TaskInput, TaskSessionAssignment, TaskSummary } from '@shared/types/project'
import { getDb } from './db'

interface TaskRow {
  id: string
  name: string
  status: TaskSummary['status']
  workspace_id: string | null
  session_count: number
  delivery_event_count: number
  updated_at: string
}

function rowToTask(row: TaskRow): TaskSummary {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    sessionCount: row.session_count,
    deliveryEventCount: row.delivery_event_count,
    updatedAt: row.updated_at
  }
}

function taskQuery(where = '', args: unknown[] = []): TaskSummary[] {
  return getDb()
    .prepare(
      `SELECT tasks.id, tasks.name, tasks.status, tasks.workspace_id,
              COUNT(DISTINCT task_sessions.source_config_id || ':' || task_sessions.session_id) AS session_count,
              COUNT(DISTINCT delivery_events.id) AS delivery_event_count,
              tasks.updated_at
       FROM tasks
       LEFT JOIN task_sessions ON task_sessions.task_id = tasks.id
       LEFT JOIN delivery_events ON delivery_events.task_id = tasks.id
       ${where}
       GROUP BY tasks.id, tasks.name, tasks.status, tasks.workspace_id, tasks.updated_at
       ORDER BY tasks.updated_at DESC`
    )
    .all(...args)
    .map((row) => rowToTask(row as TaskRow))
}

export function listTasks(workspaceId?: string): TaskSummary[] {
  return workspaceId
    ? taskQuery("WHERE tasks.workspace_id = ? AND tasks.status <> 'archived'", [workspaceId])
    : taskQuery("WHERE tasks.status <> 'archived'")
}

export function createTask(input: TaskInput, now = new Date()): TaskSummary {
  const name = input.name.trim()
  if (!name) throw new Error('task name is required')
  const timestamp = now.toISOString()
  const id = `task:${randomUUID()}`
  getDb()
    .prepare(
      `INSERT INTO tasks (id, workspace_id, name, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)`
    )
    .run(id, input.workspaceId ?? null, name.slice(0, 120), timestamp, timestamp)
  return listTasks(input.workspaceId).find((task) => task.id === id)!
}

export function updateTask(
  id: string,
  input: Partial<Pick<TaskInput, 'name'>> & { status?: TaskSummary['status'] },
  now = new Date()
): TaskSummary {
  const current = getDb().prepare('SELECT workspace_id FROM tasks WHERE id = ?').get(id) as
    { workspace_id: string | null } | undefined
  if (!current) throw new Error('task not found')
  getDb()
    .prepare(
      `UPDATE tasks
       SET name = COALESCE(?, name), status = COALESCE(?, status), updated_at = ?
       WHERE id = ?`
    )
    .run(input.name?.trim().slice(0, 120) || null, input.status ?? null, now.toISOString(), id)
  return listTasks(current.workspace_id ?? undefined).find((task) => task.id === id)!
}

export function assignSessionToTask(
  assignment: TaskSessionAssignment,
  now = new Date()
): TaskSummary {
  const db = getDb()
  const task = db.prepare('SELECT workspace_id FROM tasks WHERE id = ?').get(assignment.taskId) as
    { workspace_id: string | null } | undefined
  if (!task) throw new Error('task not found')
  const session = db
    .prepare(
      `SELECT workspace_id FROM session_contexts
       WHERE source_config_id = ? AND session_id = ?`
    )
    .get(assignment.sourceConfigId, assignment.sessionId) as
    { workspace_id: string | null } | undefined
  if (!session) throw new Error('session not found')
  if (task.workspace_id && session.workspace_id && task.workspace_id !== session.workspace_id) {
    throw new Error('session belongs to another workspace')
  }
  db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO task_sessions (task_id, source_config_id, session_id, assigned_at)
       VALUES (?, ?, ?, ?)`
    ).run(assignment.taskId, assignment.sourceConfigId, assignment.sessionId, now.toISOString())
    db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(
      now.toISOString(),
      assignment.taskId
    )
  })()
  return listTasks(task.workspace_id ?? undefined).find((item) => item.id === assignment.taskId)!
}

export function removeSessionFromTask(assignment: TaskSessionAssignment, now = new Date()): void {
  const db = getDb()
  db.prepare(
    `DELETE FROM task_sessions
     WHERE task_id = ? AND source_config_id = ? AND session_id = ?`
  ).run(assignment.taskId, assignment.sourceConfigId, assignment.sessionId)
  db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(
    now.toISOString(),
    assignment.taskId
  )
}
