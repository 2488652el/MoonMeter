/**
 * 预加载脚本(preload):运行在沙箱化渲染进程中,作为主进程与渲染进程之间唯一的桥梁。
 * 通过 `contextBridge.exposeInMainWorld` 暴露一组白名单化的 IPC 方法,渲染进程只能调用这些方法,
 * 无法直接访问 `ipcRenderer` 或 Node 能力。所属模块:preload。
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { ApiKeyCreateInput, ApiKeyRecord, ApiKeyUpdateInput } from '../shared/types/api-key'
import type {
  UsageRecord,
  UsageLogPage,
  SessionUsageSummary,
  DashboardSummary,
  RefreshAllResult,
  TotalSpendSummary,
  KeySpendSummary,
  ModelSpendAggregate,
  UsageAnalysisFilter,
  UsageLogFilter
} from '../shared/types/usage'
import type {
  CnyRateQuote,
  PricingCatalogStatus,
  PricingCatalogSyncResult,
  PricingCatalogPreview,
  PricingHistoryEntry,
  PricingExchangePolicyConfig,
  PricingEntry
} from '../shared/types/pricing'
import type {
  AlertEvent,
  AlertNotificationStatus,
  AlertOpenDestination,
  AlertRule,
  AlertRuleInput
} from '../shared/types/alert'
import type { ProviderManifest, BalanceSnapshot } from '../shared/types/provider'
import type { ProviderTestResult } from '../shared/types/provider'
import type { ProviderCatalogEntry } from '../shared/provider-catalog'
import type { SyncMode } from '../shared/sync-mode'
import type { SyncPreview } from '../shared/sync-preview'
import type { AppUpdateStatus } from '../shared/types/app-update'
import type { CodexUsageSnapshot } from '../shared/types/codex-usage'
import type { QuotaPlanningOverview } from '../shared/types/quota-planning'
import type { BudgetOverview, BudgetRule, BudgetRuleInput } from '../shared/types/budget'
import type { LocalReportOverview, LocalReportPeriodKind } from '../shared/types/local-report'
import type { SanitizedDiagnosticPack } from '../shared/types/diagnostics'
import type {
  AccountIdentityOverview,
  AccountIdentityPreferences
} from '../shared/types/account-identity'

window.addEventListener('online', () => {
  void ipcRenderer.invoke(IPC.syncOnline).catch(() => undefined)
})

/**
 * Whitelisted API surface exposed to the renderer via contextBridge.
 * Renderer code can ONLY call these methods — no raw ipcRenderer.
 *
 * no zod in preload. Sandbox mode disallows asar-internal npm
 * modules at require-time, and the main-process IPC handler already runs
 * the same zod schema before dispatching. Validating twice is YAGNI.
 */
const api = {
  version: '1.2.54',

  keys: {
    list: (): Promise<ApiKeyRecord[]> => ipcRenderer.invoke(IPC.keysList),
    add: (input: ApiKeyCreateInput): Promise<ApiKeyRecord> =>
      ipcRenderer.invoke(IPC.keysAdd, input),
    update: (input: ApiKeyUpdateInput): Promise<ApiKeyRecord> =>
      ipcRenderer.invoke(IPC.keysUpdate, input),
    delete: (id: string): Promise<{ ok: true }> => ipcRenderer.invoke(IPC.keysDelete, id),
    test: (id: string): Promise<ProviderTestResult> => ipcRenderer.invoke(IPC.keysTest, id),
    setUsageQuery: (id: string, enabled: boolean): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.keysSetUsageQuery, { id, enabled }),
    importFromCLI: (
      source: 'claude' | 'codex'
    ): Promise<{
      imported: boolean
      key?: ApiKeyRecord
      reason?: string
    }> => ipcRenderer.invoke(IPC.keysImportFromCLI, { source })
  },

  usage: {
    getDashboard: (filter?: number | UsageAnalysisFilter): Promise<DashboardSummary> =>
      ipcRenderer.invoke(IPC.usageGetDashboard, filter ?? 30),
    getTotalSpend: (filter?: number | UsageAnalysisFilter): Promise<TotalSpendSummary> =>
      ipcRenderer.invoke(IPC.usageGetTotalSpend, filter ?? 30),
    getModelSpend: (filter?: UsageAnalysisFilter): Promise<ModelSpendAggregate[]> =>
      ipcRenderer.invoke(IPC.usageGetModelSpend, filter ?? {}),
    getLogs: (filter?: UsageLogFilter): Promise<UsageRecord[]> =>
      ipcRenderer.invoke(IPC.usageGetLogs, filter ?? {}),
    getLogsPage: (filter?: UsageLogFilter): Promise<UsageLogPage> =>
      ipcRenderer.invoke(IPC.usageGetLogsPage, filter ?? {}),
    getSessionSummaries: (): Promise<SessionUsageSummary[]> =>
      ipcRenderer.invoke(IPC.usageGetSessionSummaries),
    refreshAll: (): Promise<RefreshAllResult> => ipcRenderer.invoke(IPC.usageRefreshAll),
    /**
     * Per-key spend estimate. Backed by `computeSpendByKey` in
     * `code/src/main/store/usage-repo.ts`; reads `usage_records` filtered by
     * `apiKeyId` × `days`, multiplies tokens by current pricing, and returns
     * the total in the primary currency (the one with the largest amount).
     */
    getKeySpend: (apiKeyId: string, days?: number): Promise<KeySpendSummary> =>
      ipcRenderer.invoke(IPC.usageGetKeySpend, { apiKeyId, days: days ?? 30 })
  },

  codex: {
    usage: (): Promise<CodexUsageSnapshot> => ipcRenderer.invoke(IPC.codexUsage)
  },

  quotaPlanning: {
    overview: (): Promise<QuotaPlanningOverview> => ipcRenderer.invoke(IPC.quotaPlanningOverview)
  },

  budgets: {
    overview: (): Promise<BudgetOverview> => ipcRenderer.invoke(IPC.budgetsOverview),
    add: (input: BudgetRuleInput): Promise<BudgetRule> => ipcRenderer.invoke(IPC.budgetsAdd, input),
    update: (input: BudgetRuleInput & { id: string }): Promise<BudgetRule> =>
      ipcRenderer.invoke(IPC.budgetsUpdate, input),
    toggle: (id: string, enabled: boolean): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.budgetsToggle, { id, enabled }),
    delete: (id: string): Promise<{ ok: true }> => ipcRenderer.invoke(IPC.budgetsDelete, id),
    markEventRead: (id: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.budgetsMarkEventRead, { id })
  },

  localReports: {
    get: (kind: LocalReportPeriodKind): Promise<LocalReportOverview> =>
      ipcRenderer.invoke(IPC.localReportsGet, kind),
    setEnabled: (enabled: boolean): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.localReportsSetEnabled, { enabled })
  },

  localRecommendations: {
    setEnabled: (enabled: boolean): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.localRecommendationsSetEnabled, { enabled })
  },

  diagnostics: {
    getSanitized: (): Promise<SanitizedDiagnosticPack> =>
      ipcRenderer.invoke(IPC.diagnosticsGetSanitized)
  },

  accountIdentities: {
    overview: (): Promise<AccountIdentityOverview> =>
      ipcRenderer.invoke(IPC.accountIdentitiesOverview),
    savePreferences: (
      preferences: AccountIdentityPreferences
    ): Promise<AccountIdentityPreferences> =>
      ipcRenderer.invoke(IPC.accountIdentitiesSavePreferences, preferences)
  },

  sync: {
    login: (input: {
      baseUrl: string
      email: string
      password: string
      deviceId: string
      mode: SyncMode
    }): Promise<{ deviceId: string; expiresAt: string }> =>
      ipcRenderer.invoke(IPC.syncLogin, input),
    devices: (): Promise<
      Array<{
        id: string
        userId: string
        name: string
        createdAt: string
        revokedAt: string | null
      }>
    > => ipcRenderer.invoke(IPC.syncDevices),
    revokeDevice: (deviceId: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.syncRevokeDevice, { deviceId }),
    status: (): Promise<{
      configured: boolean
      state: 'idle' | 'syncing' | 'error' | 'needs_login'
      revision: number
      mode?: SyncMode
      lastSuccessAt?: string
      lastError?: string
    }> => ipcRenderer.invoke(IPC.syncStatus),
    preview: (mode: SyncMode): Promise<SyncPreview> => ipcRenderer.invoke(IPC.syncPreview, mode),
    trigger: (): Promise<{ started: true }> => ipcRenderer.invoke(IPC.syncNow)
  },

  balance: {
    latest: (): Promise<Array<BalanceSnapshot & { id: number; apiKeyId?: string }>> =>
      ipcRenderer.invoke(IPC.balanceListLatest)
  },

  pricing: {
    list: (): Promise<PricingEntry[]> => ipcRenderer.invoke(IPC.pricingList),
    set: (entry: Omit<PricingEntry, 'id' | 'updatedAt'>): Promise<PricingEntry> =>
      ipcRenderer.invoke(IPC.pricingSet, entry),
    restore: (id: number): Promise<{ ok: true }> => ipcRenderer.invoke(IPC.pricingRestore, id),
    syncCatalog: (): Promise<PricingCatalogSyncResult> => ipcRenderer.invoke(IPC.pricingCatalog),
    catalogPreview: (): Promise<PricingCatalogPreview | null> =>
      ipcRenderer.invoke(IPC.pricingCatalogPreview),
    applyCatalogPreview: (previewId: string): Promise<PricingCatalogSyncResult> =>
      ipcRenderer.invoke(IPC.pricingCatalogApply, { previewId }),
    history: (limit?: number): Promise<PricingHistoryEntry[]> =>
      ipcRenderer.invoke(IPC.pricingHistory, limit ?? 100),
    exchangePolicy: (): Promise<PricingExchangePolicyConfig> =>
      ipcRenderer.invoke(IPC.pricingExchangePolicy),
    setExchangePolicy: (
      config: PricingExchangePolicyConfig
    ): Promise<PricingExchangePolicyConfig> =>
      ipcRenderer.invoke(IPC.pricingExchangePolicySet, config),
    catalogStatus: (): Promise<PricingCatalogStatus> =>
      ipcRenderer.invoke(IPC.pricingCatalogStatus),
    setCatalogAutoUpdate: (enabled: boolean): Promise<PricingCatalogStatus> =>
      ipcRenderer.invoke(IPC.pricingCatalogAutoUpdate, enabled),
    setCatalogApprovalRequired: (enabled: boolean): Promise<PricingCatalogStatus> =>
      ipcRenderer.invoke(IPC.pricingCatalogApprovalRequired, enabled),
    cnyRate: (currency = 'USD'): Promise<CnyRateQuote> =>
      ipcRenderer.invoke(IPC.pricingCnyRate, currency)
  },

  appUpdate: {
    getStatus: (): Promise<AppUpdateStatus> => ipcRenderer.invoke(IPC.appUpdateGetStatus),
    check: (): Promise<AppUpdateStatus> => ipcRenderer.invoke(IPC.appUpdateCheck),
    onStatusChange: (cb: (status: AppUpdateStatus) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, status: AppUpdateStatus) => cb(status)
      ipcRenderer.on(IPC.appUpdateStatusChanged, listener)
      return () => ipcRenderer.off(IPC.appUpdateStatusChanged, listener)
    }
  },

  settings: {
    get: (): Promise<Record<string, unknown>> => ipcRenderer.invoke(IPC.settingsGet),
    set: (key: string, value: unknown): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.settingsSet, { key, value }),
    chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke(IPC.settingsChooseDirectory)
  },

  alerts: {
    list: (): Promise<AlertRule[]> => ipcRenderer.invoke(IPC.alertsList),
    add: (input: AlertRuleInput): Promise<AlertRule> => ipcRenderer.invoke(IPC.alertsAdd, input),
    update: (id: string, input: AlertRuleInput): Promise<AlertRule> =>
      ipcRenderer.invoke(IPC.alertsUpdate, { id, ...input }),
    toggle: (id: string, enabled: boolean): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.alertsToggle, { id, enabled }),
    delete: (id: string): Promise<{ ok: true }> => ipcRenderer.invoke(IPC.alertsDelete, id),
    listEvents: (limit = 100): Promise<AlertEvent[]> =>
      ipcRenderer.invoke(IPC.alertsListEvents, { limit }),
    markEventRead: (id: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.alertsMarkEventRead, { id }),
    markAllRead: (): Promise<{ ok: true }> => ipcRenderer.invoke(IPC.alertsMarkAllRead),
    notificationStatus: (): Promise<AlertNotificationStatus> =>
      ipcRenderer.invoke(IPC.alertsNotificationStatus),
    onOpenDestination: (cb: (destination: AlertOpenDestination) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, destination: AlertOpenDestination) =>
        cb(destination)
      ipcRenderer.on(IPC.alertsOpenDestination, listener)
      return () => ipcRenderer.off(IPC.alertsOpenDestination, listener)
    }
  },

  providers: {
    list: (): Promise<ProviderManifest[]> => ipcRenderer.invoke(IPC.providersList),
    /**
     * Rich catalog used by the "create new key" modal — default base URL,
     * signup link, suggested models, region/currency hint. Returned as a
     * frozen list so the renderer can't mutate shared state.
     */
    catalog: (): Promise<readonly ProviderCatalogEntry[]> =>
      ipcRenderer.invoke(IPC.providersCatalog)
  },

  log: {
    discover: (): Promise<{
      claude: string[]
      codex: string[]
      kimiCode: string[]
      gemini: string[]
      opencode: string[]
    }> => ipcRenderer.invoke(IPC.logDiscover),
    locations: (): Promise<{
      claudeProjects: string
      codexSessions: string
      kimiCodeSessions: string
      geminiTemp: string
      opencodeMessages: string
    }> => ipcRenderer.invoke(IPC.logLocations),
    sync: (
      source: 'claude-code' | 'codex' | 'kimi-code' | 'gemini-cli' | 'opencode'
    ): Promise<{ started: boolean }> => ipcRenderer.invoke(IPC.logSync, { source }),
    detectCodexKey: (): Promise<{ found: boolean; maskedKey?: string; path?: string }> =>
      ipcRenderer.invoke(IPC.logDetectCodexKey),
    detectClaudeKey: (): Promise<{ found: boolean; maskedKey?: string; path?: string }> =>
      ipcRenderer.invoke(IPC.logDetectClaudeKey),
    openFolder: (path: string): Promise<{ ok: boolean; path: string; error?: string }> =>
      ipcRenderer.invoke(IPC.logOpenFolder, { path }),
    onSyncProgress: (
      cb: (e: { source: string; file: string; lines: number; tokens: number }) => void
    ): (() => void) => {
      const listener = (_e: IpcRendererEvent, payload: unknown) =>
        cb(payload as { source: string; file: string; lines: number; tokens: number })
      ipcRenderer.on(IPC.logSyncProgress, listener)
      return () => ipcRenderer.off(IPC.logSyncProgress, listener)
    },
    onSyncDone: (
      cb: (e: {
        source: string
        totals: { lines: number; tokens: number; inserted: number }
        error?: string
      }) => void
    ): (() => void) => {
      const listener = (_e: IpcRendererEvent, payload: unknown) => cb(payload as never)
      ipcRenderer.on(IPC.logSyncDone, listener)
      return () => ipcRenderer.off(IPC.logSyncDone, listener)
    }
  }
} as const

export type MoonMeterAPI = typeof api
/** @deprecated Use MoonMeterAPI. Retained for source compatibility with integrations. */
export type TokenLubAPI = MoonMeterAPI

contextBridge.exposeInMainWorld('api', api)
