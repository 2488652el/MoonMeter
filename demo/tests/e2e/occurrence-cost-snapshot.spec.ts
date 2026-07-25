import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const electronPath = createRequire(__filename)('electron') as string

test('keeps occurrence-time cost frozen after the pricing catalog changes', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'moonmeter-cost-snapshot-'))
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
    db.prepare(
      `
      INSERT INTO pricing_entries (
        provider_id, billing_scope, model, prompt_price_per_mtok,
        completion_price_per_mtok, currency, source, catalog_active, updated_at
      ) VALUES ('snapshot-provider', 'default', 'snapshot-model', 3, 8, 'USD',
                'user', 1, ?)
    `
    ).run(capturedAt)
    const insert = db.prepare(`
      INSERT INTO usage_records (
        provider_id, billing_scope, model, prompt_tokens, completion_tokens,
        total_tokens, cost, currency, cost_basis, pricing_entry_id,
        pricing_updated_at, snapshot_prompt_price, snapshot_completion_price,
        snapshot_currency, source, message_id, captured_at
      ) VALUES (
        'snapshot-provider', 'default', 'snapshot-model', 1000000, 500000,
        1500000, ?, 'USD', ?, 1, ?, ?, ?, 'USD', 'session-log', ?, ?
      )
    `)
    insert.run(7, 'price-snapshot', capturedAt, 3, 8, 'frozen-row', capturedAt)
    insert.run(null, 'current-estimate', null, null, null, 'legacy-row', capturedAt)
    db.close()

    app = await electron.launch({
      executablePath: electronPath,
      args: ['.', `--user-data-dir=${profile}`, '--disable-gpu'],
      cwd: process.cwd()
    })
    const window = await app.firstWindow()
    const result = await window.evaluate(async () => {
      const filter = { modelContains: 'snapshot-model', limit: 10 }
      const before = await window.api.usage.getLogs(filter)
      await window.api.pricing.set({
        providerId: 'snapshot-provider',
        billingScope: 'default',
        model: 'snapshot-model',
        promptPricePerMtok: 100,
        completionPricePerMtok: 200,
        currency: 'USD',
        source: 'user'
      })
      const after = await window.api.usage.getLogs(filter)
      return { before, after }
    })

    const frozenBefore = result.before.find((row) => row.messageId === 'frozen-row')
    const frozenAfter = result.after.find((row) => row.messageId === 'frozen-row')
    const legacyBefore = result.before.find((row) => row.messageId === 'legacy-row')
    const legacyAfter = result.after.find((row) => row.messageId === 'legacy-row')
    expect(frozenBefore).toMatchObject({
      cost: 7,
      costBasis: 'price-snapshot',
      priceSnapshot: {
        promptPricePerMtok: 3,
        completionPricePerMtok: 8,
        currency: 'USD'
      }
    })
    expect(frozenAfter).toMatchObject({
      cost: 7,
      costBasis: 'price-snapshot',
      priceSnapshot: {
        promptPricePerMtok: 3,
        completionPricePerMtok: 8,
        currency: 'USD'
      }
    })
    expect(legacyBefore).toMatchObject({ cost: 7, costBasis: 'current-estimate' })
    expect(legacyAfter).toMatchObject({ cost: 200, costBasis: 'current-estimate' })
  } finally {
    await app?.close()
    rmSync(profile, { recursive: true, force: true })
  }
})
