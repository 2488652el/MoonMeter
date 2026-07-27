import { describe, expect, it } from 'vitest'
import { CLI_LOG_SOURCES, getCliLogSource } from '../../../../code/src/main/log-parsers/registry'

describe('CLI log source registry', () => {
  it('keeps discovery, health and sync identities together for every native parser', () => {
    expect(CLI_LOG_SOURCES.map((source) => source.id)).toEqual([
      'claude-code',
      'codex',
      'kimi-code',
      'gemini-cli',
      'opencode'
    ])
    for (const source of CLI_LOG_SOURCES) {
      expect(source.healthSourceId).toBe(`cli:${source.id}`)
      expect(source.syncStateSource).toBeTruthy()
      expect(source.displayName).toBeTruthy()
      expect(getCliLogSource(source.id)).toBe(source)
    }
  })
})
