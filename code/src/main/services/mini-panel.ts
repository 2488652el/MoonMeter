import { app, BrowserWindow, globalShortcut, screen } from 'electron'
import { join } from 'node:path'
import type { MiniPanelBounds, MiniPanelSettings } from '@shared/types/mini-panel'
import { getSetting, setSetting } from '../store/settings-store'

const MINI_PANEL_SETTINGS_KEY = 'mini_panel_settings'
const DEFAULT_HOTKEY = 'CommandOrControl+Shift+M'

const DEFAULT_SETTINGS: MiniPanelSettings = {
  enabled: false,
  visible: false,
  hotkeyEnabled: false,
  hotkey: DEFAULT_HOTKEY
}

const DEFAULT_BOUNDS = { width: 380, height: 300 }

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

function safeBounds(value: unknown): MiniPanelBounds | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Record<string, unknown>
  const x = candidate['x']
  const y = candidate['y']
  const width = candidate['width']
  const height = candidate['height']
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height)
  ) {
    return undefined
  }
  if (
    x < -100_000 ||
    x > 100_000 ||
    y < -100_000 ||
    y > 100_000 ||
    width < 320 ||
    width > 4_000 ||
    height < 220 ||
    height > 4_000
  ) {
    return undefined
  }
  return { x, y, width, height }
}

function recoverBounds(bounds: MiniPanelBounds | undefined): MiniPanelBounds {
  const candidate = bounds ?? { x: 0, y: 0, ...DEFAULT_BOUNDS }
  const display = screen.getDisplayMatching(candidate)
  const workArea = display.workArea
  const width = Math.min(candidate.width, workArea.width)
  const height = Math.min(candidate.height, workArea.height)
  return {
    x: Math.min(Math.max(candidate.x, workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(candidate.y, workArea.y), workArea.y + workArea.height - height),
    width,
    height
  }
}

/** Pure, conservative settings normalization used by the IPC and startup paths. */
export function normalizeMiniPanelSettings(
  input: Partial<MiniPanelSettings> | null | undefined
): MiniPanelSettings {
  const fixedWorkspaceId = safeId(input?.fixedWorkspaceId)
  const bounds = safeBounds(input?.bounds)
  const hotkey = typeof input?.hotkey === 'string' ? input.hotkey.trim() : DEFAULT_HOTKEY
  return {
    enabled: input?.enabled === true,
    visible: input?.visible === true,
    ...(fixedWorkspaceId ? { fixedWorkspaceId } : {}),
    ...(bounds ? { bounds } : {}),
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
    ...(settings.fixedWorkspaceId ? { fixedWorkspaceId: settings.fixedWorkspaceId } : {}),
    ...(settings.bounds ? { bounds: settings.bounds } : {})
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
  const settings = readSettings()
  const bounds = recoverBounds(settings.bounds)
  if (
    !settings.bounds ||
    settings.bounds.x !== bounds.x ||
    settings.bounds.y !== bounds.y ||
    settings.bounds.width !== bounds.width ||
    settings.bounds.height !== bounds.height
  ) {
    persistSettings({ ...settings, bounds })
  }
  const isDev = !app.isPackaged
  const win = new BrowserWindow({
    ...bounds,
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
  const rememberBounds = () => {
    const current = readSettings()
    persistSettings({ ...current, bounds: recoverBounds(win.getBounds()) })
  }
  win.on('move', rememberBounds)
  win.on('resize', rememberBounds)
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
