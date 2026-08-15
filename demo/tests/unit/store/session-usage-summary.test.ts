import { describe, expect, it, vi } from 'vitest'

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
    provider_id: 'deepseek',
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

vi.mock('../../../../code/src/main/store/db', () => ({
  getDb: () => ({
    prepare: (sql: string) => {
      capturedSql = sql
      return { all: () => aggregateRows }
    }
  })
}))

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
        providerId: 'deepseek',
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
    expect(capturedSql).toContain("COUNT(DISTINCT NULLIF(session_id, ''))")
  })
})
