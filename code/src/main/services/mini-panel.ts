import { app, BrowserWindow, globalShortcut } from 'electron'
import { join } from 'node:path'
import type { MiniPanelSettings } from '@shared/types/mini-panel'
import { getSetting, setSetting } from '../store/settings-store'

const MINI_PANEL_SETTINGS_KEY = 'mini_panel_settings'
const DEFAULT_HOTKEY = 'CommandOrControl+Shift+M'

const DEFAULT_SETTINGS: MiniPanelSettings = {
  enabled: false,
  visible: false,
  hotkeyEnabled: false,
  hotkey: DEFAULT_HOTKEY
}

let miniPanel: BrowserWindow | null = null
let registeredHotkey: string | undefined
let hotkeyError: MiniPanelSettings['errorCode']
let stopping = false

function safeId(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 300) return undefined
  const normalized = value.trim()
  if (!normalized || !/^[A-Za-z0-9:_./-]+$/.test(normalized)) return undefined
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/|~[\\/])/.test(normalized)) return undefined
  return normalized
}

/** Pure, conservative settings normalization used by the IPC and startup paths. */
export function normalizeMiniPanelSettings(
  input: Partial<MiniPanelSettings> | null | undefined
): MiniPanelSettings {
  const fixedWorkspaceId = safeId(input?.fixedWorkspaceId)
  const hotkey = typeof input?.hotkey === 'string' ? input.hotkey.trim() : DEFAULT_HOTKEY
  return {
    enabled: input?.enabled === true,
    visible: input?.visible === true,
    ...(fixedWorkspaceId ? { fixedWorkspaceId } : {}),
    hotkeyEnabled: input?.hotkeyEnabled === true,
    hotkey: hotkey.slice(0, 80) || DEFAULT_HOTKEY
  }
}

function readSettings(): MiniPanelSettings {
  const stored = getSetting<Partial<MiniPanelSettings>>(MINI_PANEL_SETTINGS_KEY)
  return normalizeMiniPanelSettings(stored ?? DEFAULT_SETTINGS)
}

function persistSettings(settings: MiniPanelSettings): void {
  const persisted: MiniPanelSettings = {
    enabled: settings.enabled,
    visible: settings.visible,
    hotkeyEnabled: settings.hotkeyEnabled,
    hotkey: settings.hotkey,
    ...(settings.fixedWorkspaceId ? { fixedWorkspaceId: settings.fixedWorkspaceId } : {})
  }
  setSetting(MINI_PANEL_SETTINGS_KEY, persisted)
}

function currentSettings(): MiniPanelSettings {
  const settings = readSettings()
  return hotkeyError ? { ...settings, errorCode: hotkeyError } : settings
}

function rendererUrl(): string | undefined {
  const configured = process.env['ELECTRON_RENDERER_URL']
  return configured?.trim() || undefined
}

function createMiniPanel(): BrowserWindow {
  if (miniPanel) return miniPanel
  const isDev = !app.isPackaged
  const win = new BrowserWindow({
    width: 380,
    height: 300,
    minWidth: 320,
    minHeight: 220,
    show: false,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: 'MoonMeter Mini Panel',
    backgroundColor: '#F4F1E9',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  miniPanel = win
  win.on('close', (event) => {
    if (stopping) return
    event.preventDefault()
    win.hide()
    const settings = readSettings()
    if (settings.visible) persistSettings({ ...settings, visible: false })
  })
  win.on('closed', () => {
    if (miniPanel === win) miniPanel = null
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (isDev && rendererUrl()) {
    void win.loadURL(`${rendererUrl()!.replace(/\/$/, '')}/#/mini-panel`)
  } else {
    const indexPath = join(app.getAppPath(), 'demo', 'out', 'renderer', 'index.html')
    void win.loadFile(indexPath, { hash: 'mini-panel' })
  }
  return win
}

function applyHotkey(settings: MiniPanelSettings): void {
  if (registeredHotkey) {
    globalShortcut.unregister(registeredHotkey)
    registeredHotkey = undefined
  }
  hotkeyError = undefined
  if (!settings.enabled || !settings.hotkeyEnabled) return
  try {
    if (!globalShortcut.register(settings.hotkey, () => toggleMiniPanel())) {
      hotkeyError = 'hotkey-conflict'
      return
    }
    registeredHotkey = settings.hotkey
  } catch {
    hotkeyError = 'hotkey-conflict'
  }
}

function showPanel(): void {
  const win = createMiniPanel()
  if (win.isMinimized()) win.restore()
  win.showInactive()
}

function hidePanel(): void {
  miniPanel?.hide()
}

function toggleMiniPanel(): void {
  const settings = readSettings()
  if (!settings.enabled) return
  if (miniPanel?.isVisible()) hideMiniPanel()
  else showMiniPanel()
}

export function getMiniPanelSettings(): MiniPanelSettings {
  return currentSettings()
}

export function setMiniPanelSettings(input: MiniPanelSettings): MiniPanelSettings {
  const settings = normalizeMiniPanelSettings(input)
  persistSettings(settings)
  applyHotkey(settings)
  if (!settings.enabled || !settings.visible) {
    hidePanel()
  } else {
    showPanel()
  }
  return currentSettings()
}

export function showMiniPanel(): MiniPanelSettings {
  const settings = readSettings()
  if (!settings.enabled) return currentSettings()
  showPanel()
  if (!settings.visible) persistSettings({ ...settings, visible: true })
  return currentSettings()
}

export function hideMiniPanel(): MiniPanelSettings {
  hidePanel()
  const settings = readSettings()
  if (settings.visible) persistSettings({ ...settings, visible: false })
  return currentSettings()
}

export function initializeMiniPanel(): void {
  const settings = readSettings()
  applyHotkey(settings)
  if (settings.enabled && settings.visible) showPanel()
}

export function stopMiniPanel(): void {
  stopping = true
  if (registeredHotkey) {
    globalShortcut.unregister(registeredHotkey)
    registeredHotkey = undefined
  }
  miniPanel?.destroy()
  miniPanel = null
  stopping = false
}
