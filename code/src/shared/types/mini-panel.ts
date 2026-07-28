export interface MiniPanelSettings {
  enabled: boolean
  visible: boolean
  fixedWorkspaceId?: string
  hotkeyEnabled: boolean
  hotkey: string
  errorCode?: 'hotkey-conflict'
}
