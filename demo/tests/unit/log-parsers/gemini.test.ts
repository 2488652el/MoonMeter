import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  discoverGeminiSessions,
  parseGeminiSessionFile,
  syncGeminiFile
} from '../../../../code/src/main/log-parsers/gemini'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Gemini CLI chat parser', () => {
  it('normalizes a Gemini response record and keeps cached input separate', () => {
    const content = [
      JSON.stringify({ sessionId: 'gemini-session-1', projectHash: 'project-hash' }),
      JSON.stringify({
        id: 'response-1',
        type: 'gemini',
        timestamp: '2026-07-27T01:02:03.000Z',
        model: 'gemini-2.5-pro',
        tokens: { input: 120, cached: 20, output: 30, thoughts: 5, total: 155 }
      })
    ].join('\n')

    expect(
      parseGeminiSessionFile(content, '/Users/tester/.gemini/tmp/project/chats/session.jsonl')
    ).toEqual([
      expect.objectContaining({
        providerId: 'gemini-cli',
        model: 'gemini-2.5-pro',
        promptTokens: 100,
        completionTokens: 30,
        cacheReadTokens: 20,
        totalTokens: 155,
        sessionId: 'gemini-session-1',
        messageId: 'gemini-session-1-response-1'
      })
    ])
  })

  it('discovers official chats directories and ignores malformed lines', () => {
    const root = join(tmpdir(), `gemini-parser-${Date.now()}`)
    roots.push(root)
    const chats = join(root, 'project-hash', 'chats')
    const file = join(chats, 'session.jsonl')
    mkdirSync(chats, { recursive: true })
    const line = JSON.stringify({
      id: 'response-1',
      type: 'gemini',
      timestamp: '2026-07-27T01:02:03.000Z',
      tokens: { input: 1, output: 2, total: 3 }
    })
    writeFileSync(file, `not-json\n${line}\n`, 'utf8')

    expect(discoverGeminiSessions(root)).toEqual([file])
    const result = syncGeminiFile(file)
    expect(result.records).toHaveLength(1)
    expect(result.nextOffset).toBe(Buffer.byteLength(`not-json\n${line}\n`))
  })
})
