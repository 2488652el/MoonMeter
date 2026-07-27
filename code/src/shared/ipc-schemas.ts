/**
 * IPC 输入校验 Schema:使用 zod 定义各 IPC 通道入参的校验规则,
 * 在主进程 handle 入口处统一校验,防止非法输入写入数据库。
 */
import { z } from 'zod'
import { isInternalSettingKey } from './settings'

// API key
/** 创建 API Key 入参校验。 */
export const apiKeyCreateInputSchema = z.object({
  providerId: z.string().min(1),
  alias: z.string().min(1).max(100),
  apiKey: z.string().min(1),
  baseUrlOverride: z.string().url().optional(),
  notes: z.string().max(500).optional(),
  extra: z.record(z.string().min(1).max(64), z.string().min(1)).optional()
})

/** 更新 API Key 入参校验。 */
export const apiKeyUpdateInputSchema = z.object({
  id: z.string().uuid(),
  alias: z.string().min(1).max(100),
  apiKey: z.string().min(1).optional(),
  baseUrlOverride: z.string().url().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  extra: z.record(z.string().min(1).max(64), z.string().min(1)).optional()
})

// Usage
/** 用量查询过滤条件校验。 */
export const usageFilterSchema = z.object({
  providerId: z.string().optional(),
  fromISO: z.string().datetime().optional(),
  toISO: z.string().datetime().optional(),
  source: z.enum(['vendor-api', 'session-log']).optional(),
  limit: z.number().int().positive().max(10000).optional(),
  offset: z.number().int().nonnegative().optional(),
  modelContains: z.string().max(200).optional(),
  projectContains: z.string().max(200).optional()
})

/** 仪表盘聚合查询过滤条件校验。 */
export const usageAnalysisFilterSchema = usageFilterSchema
  .omit({ limit: true, offset: true })
  .extend({ days: z.number().int().min(0).max(3650).optional() })

// Pricing
/** 设置定价条目入参校验。 */
export const pricingSetInputSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
  promptPricePerMtok: z.number().nonnegative(),
  completionPricePerMtok: z.number().nonnegative(),
  cacheReadPricePerMtok: z.number().nonnegative().optional(),
  cacheCreationPricePerMtok: z.number().nonnegative().optional(),
  currency: z.string().min(1).max(8),
  billingScope: z.string().min(1).max(64).optional(),
  source: z.enum(['catalog', 'user'])
})

export const pricingCatalogApplyInputSchema = z.object({
  previewId: z.string().uuid()
})

export const pricingExchangePolicySetInputSchema = z.object({
  policy: z.enum(['realtime', 'fallback', 'fixed']),
  fixedRates: z.record(z.string().min(3).max(8), z.number().positive()).default({})
})

// Alerts
/** 新增告警规则入参校验。 */
export const alertAddInputSchema = z.object({
  scope: z.enum(['provider', 'global']),
  providerId: z.string().optional(),
  threshold: z.number(),
  metric: z.enum(['remaining_amount', 'remaining_pct'])
})

/** 编辑告警规则入参校验。 */
export const alertUpdateInputSchema = alertAddInputSchema.extend({
  id: z.string().uuid()
})

/** 切换告警规则启用状态入参校验。 */
export const alertToggleInputSchema = z.object({
  id: z.string().uuid(),
  enabled: z.boolean()
})

export const alertEventIdInputSchema = z.object({
  id: z.string().uuid()
})

export const alertEventListInputSchema = z.object({
  limit: z.number().int().positive().max(500).default(100)
})

// Soft budgets
const budgetRuleFields = {
  name: z.string().trim().min(1).max(80),
  periodKind: z.enum(['calendar-month', 'custom-cycle']),
  customCycleStartDay: z.number().int().min(1).max(28).optional(),
  scope: z.enum(['total', 'provider', 'project']),
  scopeValue: z.string().trim().min(1).max(200).optional(),
  limitCny: z.number().positive().max(10_000_000),
  enabled: z.boolean().optional()
} as const

function refineBudgetRule<T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T> {
  return schema.superRefine((value, context) => {
    const rule = value as z.infer<z.ZodObject<typeof budgetRuleFields>>
    if (rule.periodKind === 'custom-cycle' && rule.customCycleStartDay === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customCycleStartDay'],
        message: 'required'
      })
    }
    if (rule.scope !== 'total' && !rule.scopeValue) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['scopeValue'], message: 'required' })
    }
  })
}

export const budgetAddInputSchema = refineBudgetRule(z.object(budgetRuleFields))
export const budgetUpdateInputSchema = refineBudgetRule(
  z.object({ ...budgetRuleFields, id: z.string().uuid() })
)
export const budgetToggleInputSchema = z.object({ id: z.string().uuid(), enabled: z.boolean() })
export const budgetEventIdInputSchema = z.object({ id: z.string().uuid() })

// Local reports
export const localReportPeriodInputSchema = z.enum(['week', 'month'])
export const localReportsSetEnabledInputSchema = z.object({ enabled: z.boolean() })
export const localRecommendationsSetEnabledInputSchema = z.object({ enabled: z.boolean() })

// Read-only AccountIdentity display preferences. The identities themselves are
// derived by the main process; renderer input can only rename or order them.
export const accountIdentityPreferencesInputSchema = z.object({
  order: z.array(z.string().min(1).max(300)).max(500),
  aliasById: z.record(z.string().min(1).max(300), z.string().trim().min(1).max(100))
})

// Settings
/** 设置项写入入参校验。 */
export const settingsSetInputSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .refine((key) => !isInternalSettingKey(key), {
      message: 'internal settings cannot be changed through IPC'
    }),
  value: z.unknown()
})

export const syncLoginInputSchema = z.object({
  baseUrl: z.string().url(),
  email: z.string().email(),
  password: z.string().min(1),
  deviceId: z.string().min(1),
  mode: z.enum(['upload', 'restore', 'merge']).default('merge')
})

export const syncModeSchema = z.enum(['upload', 'restore', 'merge'])

export const syncDeviceIdInputSchema = z.object({ deviceId: z.string().min(1) })

// Log sync (Phase D2)
/** 会话日志同步入参校验。 */
export const logSyncInputSchema = z.object({
  source: z.enum(['claude-code', 'codex', 'kimi-code', 'gemini-cli', 'opencode'])
})

/** 打开日志文件夹入参校验。 */
export const logOpenFolderInputSchema = z.object({
  path: z.string().min(1)
})

// PR-3: per-key usage-query toggle
/** 按 Key 切换用量查询开关入参校验。 */
export const keysSetUsageQueryInputSchema = z.object({
  id: z.string().uuid(),
  enabled: z.boolean()
})
