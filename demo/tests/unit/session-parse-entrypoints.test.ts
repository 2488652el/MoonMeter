import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readRendererPage(name: string): string {
  return readFileSync(resolve(process.cwd(), `code/src/renderer/pages/${name}.tsx`), 'utf8')
}

function readRendererComponent(name: string): string {
  return readFileSync(resolve(process.cwd(), `code/src/renderer/components/${name}.tsx`), 'utf8')
}

describe('session parse renderer entrypoints', () => {
  it.each(['Dashboard', 'ProviderSummary', 'RequestLogs'])(
    '%s refresh does not parse local CLI logs',
    (page) => {
      expect(readRendererPage(page)).not.toContain('window.api.log.sync(')
    }
  )

  it('keeps Session discovery and parsing on Sources, not API Keys', () => {
    const apiKeys = readRendererPage('ApiKeys')
    const sources = readRendererPage('Sources')
    const panel = readRendererComponent('LocalSessionSourcesPanel')
    const balance = readRendererPage('BalanceQuery')
    const panelLoad = panel.slice(
      panel.indexOf('const loadSessionPanel'),
      panel.indexOf('function buildSessionStats')
    )

    expect(panelLoad).not.toContain('window.api.log.sync(')
    expect(panel).toContain('window.api.usage.getSessionSummaries()')
    expect(panel).not.toContain('window.api.usage.getLogs(')
    expect(panel.match(/window\.api\.log\.sync\(/g)).toHaveLength(1)
    expect(sources).toContain('<LocalSessionSourcesPanel')
    expect(apiKeys).not.toContain('window.api.log.')
    expect(apiKeys).not.toContain('SessionUsageCard')
    expect(apiKeys).not.toContain('useCodexUsage')
    expect(balance.match(/<CodexQuotaPanel/g)).toHaveLength(1)
    expect(apiKeys).not.toContain('CodexQuotaPanel')
    expect(panel).not.toContain('CodexQuotaPanel')
  })
})
