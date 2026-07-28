import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('timeline storage contract', () => {
  const source = readFileSync(resolve('code/src/main/store/timeline-repo.ts'), 'utf8')

  it('keeps timeline queries Main-owned, paginated, and retention bounded', () => {
    expect(source).toContain('LIMIT ?')
    expect(source).toContain('ORDER BY occurred_at DESC, event_id DESC')
    expect(source).toContain('const DETAIL_RETENTION_DAYS = 90')
    expect(source).toContain('INSERT INTO agent_event_daily')
    expect(source).toContain('DELETE FROM agent_events WHERE occurred_at < ?')
  })

  it('does not select or expose prompt, command, code, or tool bodies', () => {
    expect(source).not.toMatch(/\bprompt\s+AS\b|\bcommand\s+AS\b|\braw_body\b/i)
    expect(source).not.toMatch(/tool\.(arguments|input|output)/i)
    expect(source).not.toContain('error_message')
    expect(source).toContain('tool_category')
    expect(source).toContain('error_code')
  })

  it('keeps delivery PR links as stored metadata while leaving task attribution explicit', () => {
    expect(source).toContain('pr_url')
    expect(source).toContain('task_id')
    expect(source).toContain('dedupKeyForParts')
  })
})
