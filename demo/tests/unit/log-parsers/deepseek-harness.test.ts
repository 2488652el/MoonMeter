import { appendFileSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  discoverDeepSeekHarnessSessions,
  parseDeepSeekHarnessSessionFile,
  syncDeepSeekHarnessFile
} from '../../../../code/src/main/log-parsers/deepseek-harness'

function harnessLog(): string {
  return [
    JSON.stringify({
      type: 'session',
      version: 0,
      id: 'harness-session-1',
      createdAt: 1_755_250_000_000,
      cwd: 'D:/work/moonmeter'
    }),
    JSON.stringify({ type: 'step/start', seq: 1, time: 1_755_250_001_000 }),
    JSON.stringify({
      type: 'request/header',
      seq: 2,
      time: 1_755_250_001_500,
      data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } } }
    }),
    JSON.stringify({
      type: 'assistant/message',
      seq: 3,
      time: 1_755_250_002_000,
      data: {
        turn: 1,
        step: 1,
        message: { role: 'assistant', content: [] },
        usage: {
          inputTokens: 27,
          outputTokens: 69,
          cacheReadTokens: 256,
          cacheWriteTokens: 8,
          cacheCreationTokens: 99,
          reasoningTokens: 24
        }
      }
    })
  ].join('\n')
}

describe('DeepSeek Harness log parser', () => {
  it('imports assistant/message usage as disjoint session-log tokens', () => {
    const records = parseDeepSeekHarnessSessionFile(harnessLog(), 'D:/logs/session.jsonl')

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
      source: 'session-log',
      sessionId: 'harness-session-1',
      messageId: 'harness-session-1-seq-3',
      promptTokens: 27,
      completionTokens: 69,
      cacheReadTokens: 256,
      cacheCreationTokens: 8,
      totalTokens: 360,
      agentLabel: 'moonmeter'
    })
  })

  it('discovers plaintext session.jsonl files and skips compressed artifacts', () => {
    const root = join(tmpdir(), `deepseek-harness-parser-${process.pid}-${Date.now()}`)
    const sessionDir = join(root, '--project--', 'harness-session-1')
    mkdirSync(sessionDir, { recursive: true })
    const plain = join(sessionDir, 'session.jsonl')
    writeFileSync(plain, harnessLog())
    writeFileSync(join(sessionDir, 'session.jsonl.zstd'), 'compressed')

    expect(discoverDeepSeekHarnessSessions(root)).toEqual([plain])
    rmSync(root, { recursive: true, force: true })
  })

  it('marks non-DeepSeek provider routes unpriced instead of applying DeepSeek rates', () => {
    const content = [
      JSON.stringify({ type: 'session', id: 'other-provider-session' }),
      JSON.stringify({
        type: 'request/header',
        data: { header: { config: { provider: 'anthropic', model: 'deepseek-v4-flash' } } }
      }),
      JSON.stringify({
        type: 'assistant/message',
        seq: 3,
        data: { usage: { inputTokens: 1, outputTokens: 2 } }
      })
    ].join('\n')

    expect(parseDeepSeekHarnessSessionFile(content, 'session.jsonl')[0]).toMatchObject({
      providerId: 'deepseek-harness:anthropic',
      model: 'deepseek-v4-flash',
      totalTokens: 3,
      costBasis: 'unpriced'
    })
  })

  it('falls back to the session timestamp when an event date is out of range', () => {
    const createdAt = 1_755_250_000_000
    const content = [
      JSON.stringify({ type: 'session', id: 'invalid-date-session', createdAt }),
      JSON.stringify({
        type: 'request/header',
        data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-chat' } } }
      }),
      JSON.stringify({
        type: 'assistant/message',
        seq: 3,
        time: 9_000_000_000_000_000,
        data: { usage: { inputTokens: 1, outputTokens: 2 } }
      })
    ].join('\n')

    expect(parseDeepSeekHarnessSessionFile(content, 'session.jsonl')[0]?.capturedAt).toBe(
      new Date(createdAt).toISOString()
    )
  })

  it('parses only appended complete lines while preserving session routing context', () => {
    const root = join(tmpdir(), `deepseek-harness-incremental-${process.pid}-${Date.now()}`)
    mkdirSync(root, { recursive: true })
    const file = join(root, 'session.jsonl')
    const initial = [
      JSON.stringify({ type: 'session', id: 'incremental-session', cwd: 'D:/work/project' }),
      JSON.stringify({
        type: 'request/header',
        data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } } }
      }),
      JSON.stringify({
        type: 'assistant/message',
        seq: 3,
        data: { usage: { inputTokens: 10, outputTokens: 2 } }
      }),
      ''
    ].join('\n')
    writeFileSync(file, initial)

    const first = syncDeepSeekHarnessFile(file)
    expect(first.records).toHaveLength(1)
    expect(first.records[0]).toMatchObject({
      messageId: 'incremental-session-seq-3',
      model: 'deepseek-v4-flash',
      totalTokens: 12
    })
    expect(first.nextOffset).toBe(Buffer.byteLength(initial))

    appendFileSync(
      file,
      `${JSON.stringify({
        type: 'assistant/message',
        seq: 4,
        data: { usage: { inputTokens: 4, outputTokens: 1 } }
      })}\n`
    )
    const second = syncDeepSeekHarnessFile(file, first.nextOffset, first.parserState)

    expect(second.records).toHaveLength(1)
    expect(second.records[0]).toMatchObject({
      messageId: 'incremental-session-seq-4',
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
      totalTokens: 5
    })
    expect(second.nextOffset).toBe(statSync(file).size)
    expect(second.parserState).toContain('"lineNumber":4')
    rmSync(root, { recursive: true, force: true })
  })
})
