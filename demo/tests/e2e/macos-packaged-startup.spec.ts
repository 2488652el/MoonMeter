import { expect, test } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

const appBundle = process.env['MOONMETER_PACKAGED_APP'] ?? process.env['TOKENLUB_PACKAGED_APP']
const packageVersion = (createRequire(__filename)('../../../package.json') as { version: string })
  .version

function executablePath(appPath: string): string {
  return appPath.endsWith('.app') ? join(appPath, 'Contents', 'MacOS', 'MoonMeter') : appPath
}

function verifyMacCodeSignature(appPath: string): void {
  if (!appPath.endsWith('.app')) {
    throw new Error('MOONMETER_PACKAGED_APP must point to the signed MoonMeter.app bundle')
  }
  const verification = spawnSync('codesign', ['--verify', '--deep', '--strict', appPath], {
    encoding: 'utf8'
  })
  if (verification.status !== 0) {
    throw new Error(`macOS code-sign verification failed: ${verification.stderr.trim()}`)
  }
  const inspection = spawnSync('codesign', ['-dv', '--verbose=4', appPath], {
    encoding: 'utf8'
  })
  const details = `${inspection.stdout}\n${inspection.stderr}`
  if (
    inspection.status !== 0 ||
    details.includes('Signature=adhoc') ||
    !details.includes('Authority=')
  ) {
    throw new Error('MoonMeter.app must use an Apple identity; ad-hoc signatures are not accepted')
  }
}

test('starts the packaged macOS app with an isolated profile', async () => {
  test.skip(process.platform !== 'darwin', 'macOS packaged smoke test')
  test.skip(!appBundle, 'MOONMETER_PACKAGED_APP is required')
  verifyMacCodeSignature(appBundle!)

  const configuredRoot =
    process.env['MOONMETER_TEST_USER_DATA'] ?? process.env['TOKENLUB_TEST_USER_DATA']
  const root = configuredRoot
    ? resolve(configuredRoot)
    : mkdtempSync(join(tmpdir(), 'tokenlub-macos-e2e-'))
  if (configuredRoot) {
    if (existsSync(root)) throw new Error('MOONMETER_TEST_USER_DATA must not already exist')
    mkdirSync(root, { recursive: true })
  }

  const home = join(root, 'home')
  const userData = join(root, 'user-data')
  mkdirSync(home, { recursive: true })
  let app: ElectronApplication | undefined

  try {
    app = await electron.launch({
      executablePath: executablePath(appBundle!),
      args: [`--user-data-dir=${userData}`, '--disable-gpu'],
      env: { ...process.env, HOME: home }
    })
    const window = await app.firstWindow()

    await expect(window).toHaveTitle('MoonMeter')
    await expect(window.locator('body')).not.toBeEmpty()
    await expect(window.evaluate(() => window.api.version)).resolves.toBe(packageVersion)

    const nativeNotifications = await app.evaluate(async ({ BrowserWindow, Notification }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) throw new Error('MoonMeter main window is missing')

      const deliver = (state: string) =>
        new Promise<string>((resolve, reject) => {
          const notification = new Notification({
            title: `MoonMeter packaged notification · ${state}`,
            body: 'Automated macOS acceptance notification; safe to ignore.'
          })
          const timer = setTimeout(
            () => reject(new Error(`${state} notification delivery timeout`)),
            5_000
          )
          notification.once('show', () => {
            clearTimeout(timer)
            resolve(state)
          })
          notification.once('failed', (_event, error) => {
            clearTimeout(timer)
            reject(new Error(String(error)))
          })
          notification.show()
        })

      if (!Notification.isSupported()) {
        return { supported: false, delivered: [] as string[] }
      }
      win.show()
      win.focus()
      const foreground = await deliver('foreground')
      win.minimize()
      const minimized = await deliver('minimized')
      win.restore()
      win.hide()
      const background = await deliver('background')
      win.show()
      return { supported: true, delivered: [foreground, minimized, background] }
    })
    expect(nativeNotifications).toEqual({
      supported: true,
      delivered: ['foreground', 'minimized', 'background']
    })

    const locations = await window.evaluate(() => window.api.log.locations())
    expect(isAbsolute(locations.claudeProjects)).toBe(true)
    expect(isAbsolute(locations.codexSessions)).toBe(true)
    expect(locations).toEqual({
      claudeProjects: join(home, '.claude', 'projects'),
      codexSessions: join(home, '.codex', 'sessions'),
      kimiCodeSessions: join(home, '.kimi-code', 'sessions')
    })
    await expect(window.evaluate(() => window.api.log.discover())).resolves.toEqual({
      claude: [],
      codex: [],
      kimiCode: []
    })

    await window.evaluate(() => window.api.settings.set('macos_e2e_probe', 'ok'))
    await expect(window.evaluate(() => window.api.settings.get())).resolves.toMatchObject({
      macos_e2e_probe: 'ok'
    })

    const created = await window.evaluate(() =>
      window.api.keys.add({
        providerId: 'manual',
        alias: 'macOS E2E synthetic',
        apiKey: 'sk-tokenlub-e2e-only'
      })
    )
    await expect(window.evaluate(() => window.api.keys.list())).resolves.toContainEqual(created)
    await window.evaluate((id) => window.api.keys.delete(id), created.id)
    await expect(window.evaluate(() => window.api.keys.list())).resolves.toEqual([])
    expect(existsSync(join(userData, 'moonmeter.db'))).toBe(true)

    await window.evaluate(() => {
      window.location.hash = '#/logs'
    })
    await expect(window.getByText('请求日志', { exact: true }).first()).toBeVisible()
  } finally {
    await app?.close()
    rmSync(root, { recursive: true, force: true })
  }
})
