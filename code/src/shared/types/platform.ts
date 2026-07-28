export type SupportedDesktopPlatform = 'win32' | 'darwin'
export type CliPathEnvironment = SupportedDesktopPlatform | 'wsl'

export interface CliPaths {
  claudeProjects: string
  claudeCredentialFiles: string[]
  codexSessions: string
  codexArchivedSessions: string
  codexAuthFile: string
  kimiCodeHome: string
  kimiCodeSessions: string
  kimiCodeSessionIndex: string
  geminiTemp: string
  opencodeStorage: string
  opencodeMessages: string
}

export interface CliDisplayPaths {
  claudeProjects: string
  codexSessions: string
  kimiCodeSessions: string
  geminiTemp: string
  opencodeMessages: string
}
