import { beforeEach, describe, expect, it, vi } from 'vitest'

const run = vi.fn()

vi.mock('../../../code/src/main/store/db', () => ({
  getDb: () => ({
    prepare: () => ({ run, all: () => [] })
  })
}))

import {
  classifySourceError,
  recordSourceDiscovered,
  recordSourceFailure
} from '../../../code/src/main/store/source-health-repo'

describe('source health privacy and classification', () => {
  beforeEach(() => run.mockClear())

  it('classifies authentication and permission failures without returning raw text', () => {
    expect(classifySourceError(new Error('HTTP 401 bearer super-secret'))).toEqual({
      code: 'auth-required',
      permissionStatus: 'auth-required',
      status: 'error'
    })
    expect(classifySourceError(new Error('EACCES C:\\Users\\alice\\.codex\\sessions'))).toEqual({
      code: 'permission-required',
      permissionStatus: 'permission-required',
      status: 'error'
    })
  })

  it('persists only a fixed product message, never the raw error payload', () => {
    recordSourceFailure(
      {
        sourceId: 'provider:test',
        accountRef: 'account-local',
        sourceKind: 'provider',
        providerId: 'test',
        displayName: 'Test'
      },
      new Error(
        'HTTP 401 https://private.example/path Authorization: Bearer token-value C:\\Users\\alice'
      ),
      new Date('2026-07-25T10:00:00.000Z')
    )

    const stored = JSON.stringify(run.mock.calls)
    expect(stored).toContain('auth-required')
    expect(stored).toContain('登录或凭据已失效')
    expect(stored).not.toContain('private.example')
    expect(stored).not.toContain('token-value')
    expect(stored).not.toContain('Users')
  })

  it('records discovery as stale without inventing a successful sync time', () => {
    recordSourceDiscovered(
      {
        sourceId: 'cli:codex',
        accountRef: 'cli:codex',
        sourceKind: 'cli',
        displayName: 'Codex CLI 日志'
      },
      new Date('2026-07-25T10:00:00.000Z')
    )

    const values = run.mock.calls.at(-1) as unknown[]
    expect(values).toContain('stale')
    expect(values).toContain('granted')
    expect(values.filter((value) => value === '2026-07-25T10:00:00.000Z')).toHaveLength(2)
  })
})
