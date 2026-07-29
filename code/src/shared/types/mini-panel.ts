export interface MiniPanelBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface MiniPanelSettings {
  enabled: boolean
  visible: boolean
  fixedWorkspaceId?: string
  bounds?: MiniPanelBounds
  hotkeyEnabled: boolean
  hotkey: string
  errorCode?: 'hotkey-conflict'
}
