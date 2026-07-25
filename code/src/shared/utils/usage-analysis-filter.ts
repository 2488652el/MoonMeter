import type { UsageSource } from '../types/usage'
import type { UsageAnalysisFilter } from '../types/usage'
import type { UsageTrendRange } from './usage-trend'
import { readDashboardRange, writeDashboardRange } from './dashboard-range'

export const USAGE_ANALYSIS_FILTER_STORAGE_KEY = 'usage_analysis_filter_v1'

export interface PersistedUsageAnalysisFilter {
  range: UsageTrendRange
  source: UsageSource | 'all'
  modelContains: string
  projectContains: string
  customFrom: string
  customTo: string
}

type FilterStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const RANGE_VALUES = new Set<UsageTrendRange>([
  'today',
  '7d',
  '30d',
  'month-to-date',
  'custom',
  'all'
])
const SOURCE_VALUES = new Set<UsageSource | 'all'>(['all', 'vendor-api', 'session-log'])

/** 读取 Dashboard 与请求日志共享的筛选状态；旧版仅保存时间范围时仍可平滑迁移。 */
export function readUsageAnalysisFilter(storage: FilterStorage): PersistedUsageAnalysisFilter {
  const fallback: PersistedUsageAnalysisFilter = {
    range: readDashboardRange(storage),
    source: 'all',
    modelContains: '',
    projectContains: '',
    customFrom: '',
    customTo: ''
  }
  try {
    const raw = storage.getItem(USAGE_ANALYSIS_FILTER_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<PersistedUsageAnalysisFilter>
    return {
      range: parsed.range && RANGE_VALUES.has(parsed.range) ? parsed.range : fallback.range,
      source: parsed.source && SOURCE_VALUES.has(parsed.source) ? parsed.source : 'all',
      modelContains:
        typeof parsed.modelContains === 'string' ? parsed.modelContains.slice(0, 200) : '',
      projectContains:
        typeof parsed.projectContains === 'string' ? parsed.projectContains.slice(0, 200) : '',
      customFrom: validLocalDate(parsed.customFrom) ? parsed.customFrom : '',
      customTo: validLocalDate(parsed.customTo) ? parsed.customTo : ''
    }
  } catch {
    return fallback
  }
}

/** 保存共享筛选状态，并同步旧版 Dashboard 时间范围键以保持向后兼容。 */
export function writeUsageAnalysisFilter(
  storage: FilterStorage,
  filter: PersistedUsageAnalysisFilter
): void {
  writeDashboardRange(storage, filter.range)
  try {
    storage.setItem(USAGE_ANALYSIS_FILTER_STORAGE_KEY, JSON.stringify(filter))
  } catch {
    // localStorage 不可用时保留当前页面内状态即可。
  }
}

function localDate(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function validLocalDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function fromLocalDate(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString()
}

function toLocalDateEnd(value: string): string {
  return new Date(`${value}T23:59:59.999`).toISOString()
}

/** 把首页时间范围转换为请求日志日期输入使用的本地日期边界。 */
export function usageRangeToLocalDates(
  range: UsageTrendRange,
  now = new Date(),
  customFrom = '',
  customTo = ''
): { from: string; to: string } {
  const to = localDate(now)
  if (range === 'custom') {
    return {
      from: validLocalDate(customFrom) ? customFrom : '',
      to: validLocalDate(customTo) ? customTo : to
    }
  }
  if (range === 'all') return { from: '', to }
  const from = new Date(now)
  if (range === 'month-to-date') {
    from.setDate(1)
  } else {
    from.setDate(from.getDate() - (range === 'today' ? 0 : range === '7d' ? 6 : 29))
  }
  return { from: localDate(from), to }
}

/** 将持久化筛选统一转换为 Dashboard/Provider/Model 聚合接口的精确查询边界。 */
export function usageAnalysisFilterToQuery(
  filter: PersistedUsageAnalysisFilter,
  now = new Date()
): UsageAnalysisFilter {
  const dates = usageRangeToLocalDates(filter.range, now, filter.customFrom, filter.customTo)
  const query: UsageAnalysisFilter = { days: 0 }
  if (dates.from) query.fromISO = fromLocalDate(dates.from)
  if (dates.to) query.toISO = toLocalDateEnd(dates.to)
  if (filter.source !== 'all') query.source = filter.source
  if (filter.modelContains.trim()) query.modelContains = filter.modelContains.trim()
  if (filter.projectContains.trim()) query.projectContains = filter.projectContains.trim()
  return query
}

export function usageRangeLabel(filter: PersistedUsageAnalysisFilter): string {
  switch (filter.range) {
    case 'today':
      return '当日'
    case '7d':
      return '7 天'
    case '30d':
      return '30 天'
    case 'month-to-date':
      return '本月至今'
    case 'custom':
      return filter.customFrom || filter.customTo
        ? `${filter.customFrom || '最早'} 至 ${filter.customTo || '今天'}`
        : '自定义账期'
    default:
      return '全部'
  }
}
