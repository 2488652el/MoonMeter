import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DEFAULT_CNY_RATES } from '../../../code/src/shared/utils/money'

const electronPath = createRequire(__filename)('electron') as string

test('returns one amount for the same filter across dashboard, provider, model, and logs', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'moonmeter-cost-consistency-'))
  let app: ElectronApplication | undefined

  try {
    app = await electron.launch({
      executablePath: electronPath,
      args: ['.', `--user-data-dir=${profile}`, '--disable-gpu'],
      cwd: process.cwd()
    })
    await app.firstWindow()
    const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
    await app.close()
    app = undefined

    const db = new DatabaseSync(join(userData, 'moonmeter.db'))
    const capturedAt = new Date().toISOString()
    db.exec(`
      INSERT INTO app_settings (key, value)
      VALUES ('pricing_exchange_policy', '"fallback"')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value;
    `)
    const insert = db.prepare(`
      INSERT INTO usage_records (
        provider_id, billing_scope, model, prompt_tokens, completion_tokens,
        total_tokens, cost, currency, cost_basis, source, message_id,
        agent_label, captured_at
      ) VALUES (?, 'default', 'acceptance-model', 1, 0, 1, ?, ?, 'provider',
                'session-log', ?, 'acceptance-project', ?)
    `)
    insert.run('provider-usd', 1, 'USD', 'acceptance-usd', capturedAt)
    insert.run('provider-cny', 2, 'CNY', 'acceptance-cny', capturedAt)
    db.close()

    app = await electron.launch({
      executablePath: electronPath,
      args: ['.', `--user-data-dir=${profile}`, '--disable-gpu'],
      cwd: process.cwd()
    })
    const window = await app.firstWindow()
    const amounts = await window.evaluate(async () => {
      const filter = {
        days: 0,
        fromISO: new Date(Date.now() - 86_400_000).toISOString(),
        toISO: new Date(Date.now() + 86_400_000).toISOString(),
        source: 'session-log' as const,
        modelContains: 'acceptance-model',
        projectContains: 'acceptance-project'
      }
      const [dashboard, spend, models, logs] = await Promise.all([
        window.api.usage.getDashboard(filter),
        window.api.usage.getTotalSpend(filter),
        window.api.usage.getModelSpend(filter),
        window.api.usage.getLogs({ ...filter, limit: 100 })
      ])
      return {
        dashboard: dashboard.totalCost,
        providers: dashboard.providers.reduce((sum, row) => sum + row.cost, 0),
        spend: spend.cnyTotal,
        models: models.reduce((sum, row) => sum + row.total, 0),
        logs: logs.reduce((sum, row) => sum + (row.costCny ?? 0), 0),
        counts: [
          dashboard.totalRequests,
          spend.totalRequests,
          models.reduce((sum, row) => sum + row.requests, 0),
          logs.length
        ]
      }
    })

    const expected = DEFAULT_CNY_RATES.USD! + 2
    expect(amounts.counts).toEqual([2, 2, 2, 2])
    for (const amount of [
      amounts.dashboard,
      amounts.providers,
      amounts.spend,
      amounts.models,
      amounts.logs
    ]) {
      expect(amount).toBeCloseTo(expected, 8)
    }
  } finally {
    await app?.close()
    rmSync(profile, { recursive: true, force: true })
  }
})
