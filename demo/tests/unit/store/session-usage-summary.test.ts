import { createRequire } from 'node:module'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const aggregateRows = [
  {
    provider_id: 'codex',
    requests: 3,
    input_tokens: 120,
    output_tokens: 80,
    cache_read_tokens: 20,
    cache_creation_tokens: 10,
    total_tokens: 220,
    sessions: 2,
    models: 2,
    last_captured_at: '2026-07-27T08:00:00.000Z'
  },
  {
    provider_id: 'opencode',
    requests: 1,
    input_tokens: 50,
    output_tokens: 25,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    total_tokens: 75,
    sessions: 1,
    models: 1,
    last_captured_at: null
  },
  {
    provider_id: 'deepseek-harness',
    requests: 2,
    input_tokens: 200,
    output_tokens: 100,
    cache_read_tokens: 40,
    cache_creation_tokens: 0,
    total_tokens: 340,
    sessions: 1,
    models: 1,
    last_captured_at: '2026-08-15T08:00:00.000Z'
  }
]

let capturedSql = ''
const dbState = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('../../../../code/src/main/store/db', () => ({
  getDb: () => dbState.current
}))

beforeEach(() => {
  capturedSql = ''
  dbState.current = {
    prepare: (sql: string) => {
      capturedSql = sql
      return { all: () => aggregateRows }
    }
  }
})

describe('querySessionUsageSummaries', () => {
  it('aggregates session logs in SQLite before crossing the IPC boundary', async () => {
    const { querySessionUsageSummaries } =
      await import('../../../../code/src/main/store/usage-repo')

    expect(querySessionUsageSummaries()).toEqual([
      {
        providerId: 'codex',
        requests: 3,
        inputTokens: 120,
        outputTokens: 80,
        cacheReadTokens: 20,
        cacheCreationTokens: 10,
        totalTokens: 220,
        sessions: 2,
        models: 2,
        lastCapturedAt: '2026-07-27T08:00:00.000Z'
      },
      {
        providerId: 'opencode',
        requests: 1,
        inputTokens: 50,
        outputTokens: 25,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 75,
        sessions: 1,
        models: 1
      },
      {
        providerId: 'deepseek-harness',
        requests: 2,
        inputTokens: 200,
        outputTokens: 100,
        cacheReadTokens: 40,
        cacheCreationTokens: 0,
        totalTokens: 340,
        sessions: 1,
        models: 1,
        lastCapturedAt: '2026-08-15T08:00:00.000Z'
      }
    ])
    expect(capturedSql).toContain("WHERE source = 'session-log'")
    expect(capturedSql).toContain("provider_id LIKE 'deepseek-harness:%'")
    expect(capturedSql).toContain("THEN 'deepseek-harness'")
    expect(capturedSql).toContain("COUNT(DISTINCT NULLIF(session_id, ''))")
  })

  it('combines priced DeepSeek and unpriced Harness routes under one summary', async () => {
    const nodeRequire = createRequire(import.meta.url)
    const { DatabaseSync } = nodeRequire(['node', 'sqlite'].join(':')) as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void
        prepare(sql: string): {
          all(...params: unknown[]): unknown[]
          run(...params: unknown[]): unknown
        }
        close(): void
      }
    }
    const db = new DatabaseSync(':memory:')
    db.exec(`
      CREATE TABLE usage_records (
        provider_id TEXT NOT NULL,
        source TEXT NOT NULL,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        cache_read_tokens INTEGER,
        cache_creation_tokens INTEGER,
        total_tokens INTEGER,
        session_id TEXT,
        model TEXT,
        captured_at TEXT NOT NULL
      )
    `)
    const insert = db.prepare(`
      INSERT INTO usage_records (
        provider_id, source, prompt_tokens, completion_tokens, cache_read_tokens,
        cache_creation_tokens, total_tokens, session_id, model, captured_at
      ) VALUES (?, 'session-log', ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insert.run('deepseek', 10, 5, 0, 0, 15, 'session-a', 'deepseek-chat', '2026-08-15T01:00:00Z')
    insert.run(
      'deepseek-harness:anthropic',
      20,
      7,
      3,
      0,
      30,
      'session-b',
      'claude-sonnet',
      '2026-08-15T02:00:00Z'
    )
    dbState.current = db
    const { querySessionUsageSummaries } =
      await import('../../../../code/src/main/store/usage-repo')

    expect(querySessionUsageSummaries()).toEqual([
      {
        providerId: 'deepseek-harness',
        requests: 2,
        inputTokens: 30,
        outputTokens: 12,
        cacheReadTokens: 3,
        cacheCreationTokens: 0,
        totalTokens: 45,
        sessions: 2,
        models: 2,
        lastCapturedAt: '2026-08-15T02:00:00Z'
      }
    ])
    db.close()
  })
})
