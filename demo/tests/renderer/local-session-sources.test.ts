import { describe, expect, it } from 'vitest'
import { buildSessionStats } from '../../../code/src/renderer/components/LocalSessionSourcesPanel'

describe('LocalSessionSourcesPanel session summaries', () => {
  it('maps normalized Harness summaries to the DeepSeek Harness card', () => {
    const stats = buildSessionStats([
      {
        providerId: 'deepseek-harness',
        requests: 2,
        inputTokens: 11,
        outputTokens: 7,
        cacheReadTokens: 5,
        cacheCreationTokens: 3,
        totalTokens: 26,
        sessions: 1,
        models: 2,
        lastCapturedAt: '2026-08-15T08:00:00.000Z'
      }
    ])

    expect(stats['deepseek-harness']).toEqual({
      requests: 2,
      inputTokens: 11,
      outputTokens: 7,
      cacheReadTokens: 5,
      cacheCreationTokens: 3,
      tokens: 26,
      sessions: 1,
      models: 2,
      lastCapturedAt: '2026-08-15T08:00:00.000Z'
    })
  })
})
