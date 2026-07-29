import { expect, test } from '@playwright/test'
import { createServer } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { launchIsolatedElectron } from './electron-test-utils'

async function availableLoopbackPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('expected loopback TCP address')
  const { port } = address
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  return port
}

test('cleans 90-day timeline details from an isolated profile without retaining sensitive fields', async () => {
  const electron = await launchIsolatedElectron('moonmeter-timeline-e2e-')
  try {
    const database = new DatabaseSync(electron.databasePath)
    const oldTimestamp = new Date(Date.now() - 91 * 24 * 60 * 60_000).toISOString()
    database
      .prepare(
        `INSERT INTO agent_events (
           id, dedup_key, event_type, source_id, occurred_at, status, tool_category, created_at
         ) VALUES (?, ?, 'otel', 'fixture-source', ?, 'ok', 'fixture-tool', ?)`
      )
      .run('agent:old-event', 'old-event-dedup', oldTimestamp, oldTimestamp)
    database.close()

    await expect(electron.page.evaluate(() => window.api.timeline.cleanup())).resolves.toEqual({
      removed: 1
    })

    const check = new DatabaseSync(electron.databasePath)
    expect(
      check.prepare("SELECT COUNT(*) AS count FROM agent_events WHERE id = 'agent:old-event'").get()
    ).toEqual({
      count: 0
    })
    const columns = check
      .prepare('PRAGMA table_info(agent_events)')
      .all()
      .map((column) => (column as { name: string }).name)
    check.close()
    expect(columns).not.toEqual(
      expect.arrayContaining([
        'prompt',
        'code',
        'command',
        'command_args',
        'tool_input',
        'tool_output'
      ])
    )
  } finally {
    await electron.close()
  }
})

test('recovers a mini panel from off-screen bounds and keeps the main window alive when hidden', async () => {
  const electron = await launchIsolatedElectron('moonmeter-mini-panel-e2e-')
  try {
    const settings = await electron.page.evaluate(() =>
      window.api.miniPanel.setSettings({
        enabled: true,
        visible: true,
        hotkeyEnabled: false,
        hotkey: 'Control+Shift+M',
        bounds: { x: -100_000, y: -100_000, width: 380, height: 300 }
      })
    )
    expect(settings.bounds).toBeDefined()
    const state = await electron.app.evaluate(({ BrowserWindow, screen }) => {
      const panel = BrowserWindow.getAllWindows().find(
        (window) => window.getTitle() === 'MoonMeter Mini Panel'
      )
      if (!panel) throw new Error('mini panel was not created')
      const bounds = panel.getBounds()
      const workArea = screen.getDisplayMatching(bounds).workArea
      return {
        bounds,
        workArea,
        mainWindowCount: BrowserWindow.getAllWindows().filter(
          (window) => window.getTitle() === 'MoonMeter'
        ).length
      }
    })
    expect(state.bounds.x).toBeGreaterThanOrEqual(state.workArea.x)
    expect(state.bounds.y).toBeGreaterThanOrEqual(state.workArea.y)
    await expect(electron.page.evaluate(() => window.api.miniPanel.hide())).resolves.toMatchObject({
      enabled: true,
      visible: false
    })
    expect(state.mainWindowCount).toBe(1)
  } finally {
    await electron.close()
  }
})

test('keeps OTel loopback-only, authenticated, deduplicated, rate-limited, and free of bodies', async () => {
  const electron = await launchIsolatedElectron('moonmeter-otel-e2e-')
  try {
    const port = await availableLoopbackPort()
    await expect(electron.page.evaluate(() => window.api.otel.status())).resolves.toMatchObject({
      enabled: false,
      state: 'disabled',
      host: '127.0.0.1'
    })
    const status = await electron.page.evaluate(
      (selectedPort) => window.api.otel.setEnabled(true, selectedPort),
      port
    )
    expect(status).toMatchObject({ enabled: true, state: 'running', host: '127.0.0.1', port })
    const { token } = await electron.page.evaluate(() => window.api.otel.rotateToken())
    const endpoint = `http://127.0.0.1:${port}/v1/logs`
    const payload = {
      events: [
        {
          event_id: 'otel-fixture-1',
          session_id: 'fixture-session',
          timestamp: '2026-07-29T08:00:00.000Z',
          event_type: 'model-call',
          input_tokens: 12,
          prompt: 'never store this prompt',
          code: 'never store this code',
          command: 'never store this command',
          tool: { input: 'never store tool input', output: 'never store tool output' }
        }
      ]
    }
    const post = (authorization: string) =>
      fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

    expect((await post('Bearer incorrect')).status).toBe(401)
    await expect(post(`Bearer ${token}`)).resolves.toMatchObject({ status: 202 })
    expect(await (await post(`Bearer ${token}`)).json()).toEqual({ accepted: 0, duplicates: 1 })

    const rateResponses = await Promise.all(
      Array.from({ length: 597 }, () =>
        post('Bearer incorrect').then((response) => response.status)
      )
    )
    expect(rateResponses).toEqual(Array.from({ length: 597 }, () => 401))
    expect((await post('Bearer incorrect')).status).toBe(429)

    const database = new DatabaseSync(electron.databasePath)
    const rows = database
      .prepare("SELECT * FROM agent_events WHERE session_id = 'fixture-session'")
      .all()
    const columns = database
      .prepare('PRAGMA table_info(agent_events)')
      .all()
      .map((column) => (column as { name: string }).name)
    database.close()
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toContain('never store')
    expect(columns).not.toEqual(
      expect.arrayContaining([
        'prompt',
        'code',
        'command',
        'command_args',
        'tool_input',
        'tool_output'
      ])
    )
  } finally {
    await electron.page.evaluate(() => window.api.otel.setEnabled(false)).catch(() => undefined)
    await electron.close()
  }
})

test('paginates more than 10,000 project records and keeps task and delivery confirmation manual', async () => {
  const electron = await launchIsolatedElectron('moonmeter-projects-e2e-')
  try {
    const database = new DatabaseSync(electron.databasePath)
    const capturedAt = new Date().toISOString()
    const insertUsage = database.prepare(
      `INSERT INTO usage_records (
         provider_id, billing_scope, model, prompt_tokens, completion_tokens, total_tokens,
         cost, currency, cost_basis, source, message_id, agent_label, captured_at
       ) VALUES ('fixture-provider', 'default', 'fixture-model', 1, 1, 2, 0.01, 'CNY',
                 'provider', 'session-log', ?, ?, ?)`
    )
    database.exec('BEGIN')
    try {
      for (let index = 0; index < 10_001; index++) {
        insertUsage.run(`fixture-project-${index}`, 'Paginated Fixture', capturedAt)
      }
      insertUsage.run('fixture-project-other', 'Other Fixture', capturedAt)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    database.close()

    const firstPage = await electron.page.evaluate(() =>
      window.api.projects.overview({ days: 30, limit: 1, offset: 0 })
    )
    const secondPage = await electron.page.evaluate(() =>
      window.api.projects.overview({ days: 30, limit: 1, offset: 1 })
    )
    expect(firstPage).toMatchObject({ total: 2, limit: 1, offset: 0 })
    expect(firstPage.rows).toHaveLength(1)
    expect(firstPage.rows[0]).toMatchObject({ name: 'Paginated Fixture', requests: 10_001 })
    expect(secondPage).toMatchObject({ total: 2, limit: 1, offset: 1 })
    expect(secondPage.rows[0]).toMatchObject({ name: 'Other Fixture', requests: 1 })

    const task = await electron.page.evaluate(() =>
      window.api.tasks.add({ name: 'Manual delivery fixture' })
    )
    const manualPr = await electron.page.evaluate(
      (taskId) =>
        window.api.tasks.addPr({
          taskId,
          url: 'https://example.test/pull/1',
          label: 'Fixture PR'
        }),
      task.id
    )
    expect(manualPr).toMatchObject({ kind: 'pr', taskId: task.id, confirmed: true })

    const confirmation = await electron.page.evaluate(
      ({ deliveryId, taskId }) => window.api.tasks.confirmDelivery(deliveryId, taskId),
      { deliveryId: manualPr.id, taskId: task.id }
    )
    expect(confirmation).toMatchObject({ id: manualPr.id, taskId: task.id, confirmed: true })

    const check = new DatabaseSync(electron.databasePath)
    const stored = check
      .prepare('SELECT title, pr_url, pr_label FROM delivery_events WHERE id = ?')
      .get(manualPr.id)
    check.close()
    expect(JSON.stringify(stored)).not.toContain('C:\\')
  } finally {
    await electron.close()
  }
})

test('does not scan unauthorized WSL sources and classifies an enabled fake WSL permission failure', async () => {
  const electron = await launchIsolatedElectron('moonmeter-wsl-e2e-', {
    MOONMETER_E2E_WSL_ERROR: 'permission-denied'
  })
  try {
    await expect(electron.page.evaluate(() => window.api.localSources.sync())).resolves.toEqual({
      started: true,
      results: []
    })

    const database = new DatabaseSync(electron.databasePath)
    const now = new Date().toISOString()
    database
      .prepare(
        `INSERT INTO local_source_configs (
           id, environment, wsl_distribution, cli_source, root_dir, normalized_root,
           enabled, status, created_at, updated_at
         ) VALUES ('fixture-wsl-source', 'wsl', 'Fixture Ubuntu', 'codex',
                   '\\\\wsl.localhost\\Fixture Ubuntu\\home\\fixture\\.codex',
                   'wsl:Fixture Ubuntu:/home/fixture/.codex', 1, 'enabled', ?, ?)`
      )
      .run(now, now)
    database.close()

    const result = await electron.page.evaluate(() => window.api.localSources.sync())
    expect(result).toMatchObject({
      started: true,
      results: [
        {
          sourceId: 'fixture-wsl-source',
          cliSource: 'codex',
          files: 0,
          inserted: 0,
          error: expect.stringContaining('缺少读取权限')
        }
      ]
    })
    const check = new DatabaseSync(electron.databasePath)
    expect(
      check
        .prepare(
          "SELECT status, error_code FROM local_source_configs WHERE id = 'fixture-wsl-source'"
        )
        .get()
    ).toEqual({ status: 'permission-denied', error_code: 'permission-denied' })
    check.close()
  } finally {
    await electron.close()
  }
})

test('receives a notification deep link through the isolated preload bridge', async () => {
  const electron = await launchIsolatedElectron('moonmeter-notification-e2e-')
  try {
    const destination = { eventId: 'alert-fixture-1', providerId: 'fixture-provider' }
    await electron.page.evaluate(() => {
      ;(
        window as typeof window & { __notificationDestination?: Promise<unknown> }
      ).__notificationDestination = new Promise<unknown>((resolve) => {
        const unsubscribe = window.api.alerts.onOpenDestination((value) => {
          unsubscribe()
          resolve(value)
        })
      })
    })
    await electron.app.evaluate(({ BrowserWindow }, value) => {
      const window = BrowserWindow.getAllWindows().find((item) => item.getTitle() === 'MoonMeter')
      if (!window) throw new Error('main window was not created')
      window.webContents.send('subscribe:alerts-open-destination', value)
    }, destination)
    await expect(
      electron.page.evaluate(
        () =>
          (window as typeof window & { __notificationDestination?: Promise<unknown> })
            .__notificationDestination
      )
    ).resolves.toEqual(destination)
  } finally {
    await electron.close()
  }
})
