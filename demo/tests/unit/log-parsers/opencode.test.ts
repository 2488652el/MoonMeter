import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  discoverOpenCodeSessions,
  parseOpenCodeMessage,
  syncOpenCodeFile
} from '../../../../code/src/main/log-parsers/opencode'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('OpenCode assistant message parser', () => {
  it('normalizes final assistant token counters and provider cost', () => {
    const content = JSON.stringify({
      id: 'message-1',
      role: 'assistant',
      metadata: {
        sessionID: 'session-1',
        time: { created: 1785238923000 },
        assistant: {
          modelID: 'gpt-5',
          cost: 0.0125,
          path: { root: 'D:/work/demo' },
          tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 30, write: 10 } }
        }
      }
    })

    expect(
      parseOpenCodeMessage(content, 'D:/data/opencode/storage/message/session-1/message-1.json')
    ).toEqual(
      expect.objectContaining({
        providerId: 'opencode',
        model: 'gpt-5',
        promptTokens: 100,
        completionTokens: 20,
        cacheReadTokens: 30,
        cacheCreationTokens: 10,
        totalTokens: 165,
        cost: 0.0125,
        currency: 'USD',
        sessionId: 'session-1',
        messageId: 'session-1-message-1',
        agentLabel: 'demo'
      })
    )
  })

  it('discovers message JSON files and fails closed for corrupt content', () => {
    const root = join(tmpdir(), `opencode-parser-${Date.now()}`)
    roots.push(root)
    const session = join(root, 'session-1')
    const file = join(session, 'message-1.json')
    mkdirSync(session, { recursive: true })
    writeFileSync(file, '{not-json', 'utf8')

    expect(discoverOpenCodeSessions(root)).toEqual([file])
    expect(syncOpenCodeFile(file)).toMatchObject({ records: [], nextOffset: 9 })
  })

  it('preserves an explicit zero provider cost instead of pricing it locally', () => {
    const record = parseOpenCodeMessage(
      JSON.stringify({
        id: 'message-free',
        role: 'assistant',
        metadata: {
          sessionID: 'session-free',
          assistant: {
            modelID: 'free-model',
            cost: 0,
            tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }
          }
        }
      }),
      '/tmp/opencode/storage/message/session-free/message-free.json'
    )

    expect(record).toMatchObject({ cost: 0, currency: 'USD', costBasis: 'provider' })
  })
})
