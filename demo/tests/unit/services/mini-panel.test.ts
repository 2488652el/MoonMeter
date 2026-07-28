import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: true, getAppPath: () => '/app' },
  BrowserWindow: class {},
  globalShortcut: { register: () => true, unregister: () => undefined }
}))

import { normalizeMiniPanelSettings } from '../../../../code/src/main/services/mini-panel'

describe('mini panel settings boundary', () => {
  it('is disabled by default and keeps only stable project identifiers', () => {
    expect(normalizeMiniPanelSettings(undefined)).toEqual({
      enabled: false,
      visible: false,
      hotkeyEnabled: false,
      hotkey: 'CommandOrControl+Shift+M'
    })
    expect(
      normalizeMiniPanelSettings({
        enabled: true,
        visible: true,
        fixedWorkspaceId: 'C:\\Users\\private\\project',
        hotkeyEnabled: true,
        hotkey: '  Ctrl+Alt+M  '
      })
    ).toEqual({
      enabled: true,
      visible: true,
      hotkeyEnabled: true,
      hotkey: 'Ctrl+Alt+M'
    })
  })

  it('truncates oversized accelerators and preserves a non-path workspace key', () => {
    const result = normalizeMiniPanelSettings({
      enabled: true,
      visible: false,
      fixedWorkspaceId: 'workspace:abc-123',
      hotkeyEnabled: false,
      hotkey: 'x'.repeat(200)
    })
    expect(result.fixedWorkspaceId).toBe('workspace:abc-123')
    expect(result.hotkey).toHaveLength(80)
  })
})
