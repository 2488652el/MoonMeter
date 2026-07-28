export type OtelReceiverState = 'disabled' | 'starting' | 'running' | 'stopping' | 'error'

export interface OtelReceiverStatus {
  enabled: boolean
  state: OtelReceiverState
  host: '127.0.0.1'
  port: number
  tokenConfigured: boolean
  lastEventAt?: string
  lastErrorCode?:
    'port-in-use' | 'invalid-token' | 'rate-limited' | 'invalid-payload' | 'server-error'
  recentEventCount: number
}

export interface OtelReceiverSettings {
  enabled: boolean
  port: number
}

export interface OtelConfigPreview {
  endpoint: string
  acceptedFields: string[]
  droppedFields: string[]
  powershellScript: string
  claudeConfigSnippet: string
}
