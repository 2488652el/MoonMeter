export const INTERNAL_SETTING_PREFIXES = [
  'pricing_catalog_',
  'pricing_exchange_',
  'quota_',
  'budget_',
  'report_'
] as const

export function isInternalSettingKey(key: string): boolean {
  return INTERNAL_SETTING_PREFIXES.some((prefix) => key.startsWith(prefix))
}
