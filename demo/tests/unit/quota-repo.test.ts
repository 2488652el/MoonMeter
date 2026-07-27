import { beforeEach, describe, expect, it, vi } from 'vitest'

const run = vi.fn(() => ({ changes: 1 }))
const prepare = vi.fn(() => ({ run, all: () => [] }))
const transaction = vi.fn((work: () => void) => work)

vi.mock('../../../code/src/main/store/db', () => ({
  getDb: () => ({ prepare, transaction })
}))

import { insertQuotaSamples, pruneQuotaSamples } from '../../../code/src/main/store/quota-repo'

describe('quota sample retention', () => {
  beforeEach(() => {
    run.mockClear()
    prepare.mockClear()
    transaction.mockClear()
  })

  it('prunes 90-day history even when no source produces a new sample', () => {
    const now = new Date('2026-07-25T00:00:00.000Z')
    expect(insertQuotaSamples([], now)).toBe(0)
    expect(prepare).toHaveBeenCalledWith('DELETE FROM quota_samples WHERE captured_at < ?')
    expect(run).toHaveBeenCalledWith('2026-04-26T00:00:00.000Z')
  })

  it('also exposes retention as an independent maintenance operation', () => {
    expect(pruneQuotaSamples(new Date('2026-07-25T00:00:00.000Z'))).toBe(1)
    expect(run).toHaveBeenCalledWith('2026-04-26T00:00:00.000Z')
  })
})
