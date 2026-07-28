import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true
  }
}))

import { sanitizeOtelRecord } from '../../../../code/src/main/services/otel-receiver'

describe('OTLP event privacy boundary', () => {
  it('keeps only allowlisted scalar telemetry and drops prompt/tool bodies', () => {
    const result = sanitizeOtelRecord({
      event_id: 'event-1',
      event_type: 'model-call',
      source_id: 'claude-code',
      session_id: 'session-1',
      workspace_id: 'workspace:abc123',
      task_id: 'task-1',
      timestamp: '2026-07-28T08:00:00.000Z',
      status: 'warning',
      model: 'claude-sonnet',
      input_tokens: 12.9,
      output_tokens: 34,
      total_tokens: 46,
      cost_cny: 0.12,
      duration_ms: 250,
      tool_category: 'filesystem',
      prompt: 'do not persist this prompt',
      command: 'Get-ChildItem C:\\private',
      command_args: ['--secret'],
      code: 'private source',
      tool: { arguments: { path: 'C:\\private' }, output: 'secret output' },
      path: 'C:\\private',
      unknown_field: 'drop me'
    })

    expect(result).toMatchObject({
      eventType: 'model-call',
      sourceId: 'claude-code',
      sessionId: 'session-1',
      workspaceId: 'workspace:abc123',
      taskId: 'task-1',
      status: 'warning',
      model: 'claude-sonnet',
      inputTokens: 12,
      outputTokens: 34,
      totalTokens: 46,
      costCny: 0.12,
      durationMs: 250,
      toolCategory: 'filesystem'
    })
    expect(result).not.toHaveProperty('prompt')
    expect(result).not.toHaveProperty('command')
    expect(result).not.toHaveProperty('commandArgs')
    expect(result).not.toHaveProperty('code')
    expect(result).not.toHaveProperty('path')
    expect(result).not.toHaveProperty('tool')
    expect(result).not.toHaveProperty('unknownField')
  })

  it('reads OTLP attribute values without accepting path-like identities', () => {
    const result = sanitizeOtelRecord({
      attributes: [
        { key: 'event_id', value: { stringValue: 'attribute-event' } },
        { key: 'session_id', value: { stringValue: 'session-2' } },
        { key: 'workspace_id', value: { stringValue: '/mnt/c/private/project' } },
        { key: 'input_tokens', value: { intValue: 9 } }
      ]
    })

    expect(result).toMatchObject({
      sessionId: 'session-2',
      inputTokens: 9
    })
    expect(result).not.toHaveProperty('workspaceId')
  })

  it('accepts standard OTLP nanosecond timestamps encoded as strings', () => {
    const result = sanitizeOtelRecord({
      event_id: 'otlp-time',
      timeUnixNano: '1785225600000000000'
    })

    expect(result?.occurredAt).toBe('2026-07-28T08:00:00.000Z')
  })

  it('drops invalid values and requires an event or session identity', () => {
    expect(sanitizeOtelRecord({ event_type: 'model-call' })).toBeNull()

    const result = sanitizeOtelRecord({
      event_id: 'bounded',
      event_type: 'not-allowlisted',
      status: 'not-allowlisted',
      input_tokens: -1,
      output_tokens: Number.POSITIVE_INFINITY,
      total_tokens: 1_000_000_000_001,
      cost_cny: -0.01,
      duration_ms: 86_400_001,
      model: 'x'.repeat(201)
    })

    expect(result).toMatchObject({ eventType: 'otel', status: 'ok' })
    expect(result).not.toHaveProperty('inputTokens')
    expect(result).not.toHaveProperty('outputTokens')
    expect(result).not.toHaveProperty('totalTokens')
    expect(result).not.toHaveProperty('costCny')
    expect(result).not.toHaveProperty('durationMs')
    expect(result).not.toHaveProperty('model')
  })
})
