import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertTemporaryProfile, createIsolatedEnvironment } from './electron-test-utils'

const electronPath = createRequire(__filename)('electron') as string

test('delivers native alerts in foreground, minimized, and background states', async () => {
  test.skip(
    process.platform !== 'win32' && process.platform !== 'darwin',
    'Native alert acceptance targets Windows and macOS.'
  )
  const profile = mkdtempSync(join(tmpdir(), 'moonmeter-native-alert-'))
  assertTemporaryProfile(profile, profile)
  let app: ElectronApplication | undefined

  try {
    app = await electron.launch({
      executablePath: electronPath,
      args: ['.', `--user-data-dir=${profile}`, '--disable-gpu'],
      cwd: process.cwd(),
      env: createIsolatedEnvironment(profile)
    })
    await app.firstWindow()

    const result = await app.evaluate(async ({ BrowserWindow, Notification }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) throw new Error('MoonMeter main window is missing')

      const deliver = (state: string) =>
        new Promise<string>((resolve, reject) => {
          const notification = new Notification({
            title: `MoonMeter native alert acceptance · ${state}`,
            body: 'Isolated automated notification; safe to ignore.'
          })
          const timer = setTimeout(
            () => reject(new Error(`${state} notification show timeout`)),
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

      const supported = Notification.isSupported()
      if (!supported) return { supported, delivered: [] }
      win.show()
      win.focus()
      const foreground = await deliver('foreground')
      win.minimize()
      const minimized = await deliver('minimized')
      win.restore()
      win.hide()
      const background = await deliver('background')
      win.show()
      return { supported, delivered: [foreground, minimized, background] }
    })

    expect(result).toEqual({
      supported: true,
      delivered: ['foreground', 'minimized', 'background']
    })
  } finally {
    await app?.close()
    rmSync(profile, { recursive: true, force: true })
  }
})
