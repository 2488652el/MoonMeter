/**
 * 用量趋势工具:把 UsageRecord 列表按时间桶(小时/天)聚合为多模型堆叠序列,
 * 供 Dashboard 折线图渲染。自动补齐空桶,取 Top6 模型 + "其他模型"汇总。
 */
import type { UsageRecord } from '../types/usage'

/** 用量趋势时间范围:当日 / 7 天 / 30 天 / 本月至今 / 自定义 / 全部。 */
export type UsageTrendRange = 'today' | '7d' | '30d' | 'month-to-date' | 'custom' | 'all'

/** 趋势图中的单条模型序列描述(key/标签/颜色)。 */
export interface UsageTrendModel {
  key: string
  label: string
  color: string
}

/** 趋势序列结果:数据点 + 模型列表 + 桶类型(小时/天)。 */
export interface UsageTrendSeries {
  points: Array<Record<string, string | number>>
  models: UsageTrendModel[]
  bucketKind: 'hour' | 'day'
}

export interface UsageSeriesDelta {
  direction: 'up' | 'down' | 'flat'
  /** Absolute percentage change. Null means the previous window was zero. */
  percent: number | null
}

/** Compare equally sized leading and trailing windows, dropping the middle sample when needed. */
export function compareUsageSeriesWindows(series: readonly number[]): UsageSeriesDelta | undefined {
  if (series.length < 2) return undefined
  const windowSize = Math.floor(series.length / 2)
  const sum = (values: readonly number[]) =>
    values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0)
  const previous = sum(series.slice(0, windowSize))
  const current = sum(series.slice(-windowSize))

  if (current === previous) return { direction: 'flat', percent: 0 }
  if (previous === 0) {
    return { direction: current > 0 ? 'up' : 'down', percent: null }
  }

  const percent = ((current - previous) / previous) * 100
  return {
    direction: percent >= 0 ? 'up' : 'down',
    percent: Math.abs(percent)
  }
}

/** 模型折线颜色循环表。 */
const MODEL_COLORS = ['#10B981', '#2563EB', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#64748B']

/** 将 Date 转为本地时区 YYYY-MM-DD 字符串。 */
function toLocalISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 取本地时区当日 00:00 的 Date。 */
function startOfLocalDay(now: Date): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d
}

/** 计算某条记录应归属的时间桶 key(按小时或按天),非法时间返回 null。 */
function bucketKeyFor(record: UsageRecord, bucketKind: 'hour' | 'day'): string | null {
  const captured = new Date(record.capturedAt)
  if (Number.isNaN(captured.getTime())) return null
  const date = toLocalISODate(captured)
  if (bucketKind === 'hour') {
    return `${date} ${String(captured.getHours()).padStart(2, '0')}:00`
  }
  return date
}

/** 把桶 key 转为图表展示用的短标签。 */
function bucketLabel(bucket: string, bucketKind: 'hour' | 'day'): string {
  return bucketKind === 'hour' ? bucket.slice(11) : bucket.slice(5)
}

/** 按时间范围生成连续的空桶(补齐无数据时段),当日按 24 小时,7d/30d 按天。 */
function buildDenseBuckets(
  range: UsageTrendRange,
  now: Date
): Array<{ bucket: string; label: string }> {
  if (range === 'today') {
    const date = toLocalISODate(now)
    return Array.from({ length: 24 }, (_, hour) => {
      const bucket = `${date} ${String(hour).padStart(2, '0')}:00`
      return { bucket, label: bucketLabel(bucket, 'hour') }
    })
  }

  if (range === '7d' || range === '30d') {
    const days = range === '7d' ? 7 : 30
    const start = startOfLocalDay(now)
    return Array.from({ length: days }, (_, index) => {
      const d = new Date(start)
      d.setDate(start.getDate() - (days - 1 - index))
      const bucket = toLocalISODate(d)
      return { bucket, label: bucketLabel(bucket, 'day') }
    })
  }

  return []
}

/**
 * 构建按模型堆叠的用量趋势序列:取 Top6 模型 + 其余合并为"其他模型",
 * 按时间桶聚合 Token 数,并补齐空桶。
 * @param logs 用量记录列表
 * @param range 时间范围
 * @param now 当前时间(默认 new Date),用于锚定窗口
 * @returns 趋势序列(数据点 + 模型列表 + 桶类型)
 */
export function buildModelUsageSeries(
  logs: UsageRecord[],
  range: UsageTrendRange,
  now = new Date()
): UsageTrendSeries {
  const bucketKind = range === 'today' ? 'hour' : 'day'
  const modelTotals = new Map<string, number>()
  for (const row of logs) {
    const model = row.model || '(unknown)'
    const tokens = row.totalTokens ?? (row.promptTokens ?? 0) + (row.completionTokens ?? 0)
    modelTotals.set(model, (modelTotals.get(model) ?? 0) + tokens)
  }

  const topModels = [...modelTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([model]) => model)
  const visibleModels = new Set(topModels)
  const hasOther = [...modelTotals.keys()].some((m) => !visibleModels.has(m))
  const models = [...topModels, ...(hasOther ? ['其他模型'] : [])].map((label, i) => ({
    key: `m${i}`,
    label,
    color: MODEL_COLORS[i % MODEL_COLORS.length]!
  }))
  const keyByModel = new Map(models.map((m) => [m.label, m.key]))
  const otherKey = keyByModel.get('其他模型')

  const buckets = new Map<string, Record<string, string | number>>()
  for (const row of logs) {
    const bucket = bucketKeyFor(row, bucketKind)
    if (!bucket) continue
    const rawModel = row.model || '(unknown)'
    const key = keyByModel.get(rawModel) ?? otherKey
    if (!key) continue
    const tokens = row.totalTokens ?? (row.promptTokens ?? 0) + (row.completionTokens ?? 0)
    const point = buckets.get(bucket) ?? { bucket, label: bucketLabel(bucket, bucketKind) }
    point[key] = Number(point[key] ?? 0) + tokens
    buckets.set(bucket, point)
  }

  const denseBuckets = buildDenseBuckets(range, now)
  let points: Array<Record<string, string | number>>
  if (denseBuckets.length > 0) {
    points = denseBuckets.map(({ bucket, label }) => ({
      bucket,
      label,
      ...(buckets.get(bucket) ?? {})
    }))
  } else {
    points = [...buckets.values()].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)))
  }

  for (const point of points) {
    point.bucket = String(point.bucket)
    point.label = String(point.label)
    for (const model of models) {
      if (point[model.key] === undefined) point[model.key] = 0
    }
  }

  return { points, models, bucketKind }
}

/**
 * 单调三次插值(Fritsch–Carlson)→ SVG 平滑路径命令。
 *
 * 与折线相比转角更圆润,且通过限制切线斜率保证曲线不越过任何数据点、
 * 不产生回勾或负值过冲——对稀疏、含零桶的用量序列尤为重要(镜像流图、
 * sparkline 都依赖这一点)。供 Dashboard sparkline / 流图等复用。
 *
 * @param points 按 x 升序的 [x, y] 坐标点
 * @returns SVG path 命令字符串(M + 若干 C 段);少于 2 点时退化为 M/L
 */
export function monotonePath(points: Array<[number, number]>): string {
  const n = points.length
  if (n === 0) return ''
  if (n === 1) return `M${points[0]![0]},${points[0]![1]}`
  if (n === 2) return `M${points[0]![0]},${points[0]![1]}L${points[1]![0]},${points[1]![1]}`

  // 每个区间的斜率 m 与每个点的切线斜率 t
  const m: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1]![0] - points[i]![0] || 1e-6
    m.push((points[i + 1]![1] - points[i]![1]) / dx)
  }
  const t: number[] = new Array(n)
  t[0] = m[0]!
  t[n - 1] = m[n - 2]!
  for (let i = 1; i < n - 1; i++) {
    // 局部极值处切线归零,避免越过数据点
    t[i] = m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2
  }
  // Fritsch–Carlson 单调性约束:限制切线幅度
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0
      t[i + 1] = 0
      continue
    }
    const a = t[i]! / m[i]!
    const b = t[i + 1]! / m[i]!
    const s = a * a + b * b
    if (s > 9) {
      const tau = 3 / Math.sqrt(s)
      t[i] = tau * a * m[i]!
      t[i + 1] = tau * b * m[i]!
    }
  }

  let d = `M${points[0]![0].toFixed(2)},${points[0]![1].toFixed(2)}`
  for (let i = 0; i < n - 1; i++) {
    const dx = (points[i + 1]![0] - points[i]![0]) / 3
    d +=
      `C${(points[i]![0] + dx).toFixed(2)},${(points[i]![1] + t[i]! * dx).toFixed(2)} ` +
      `${(points[i + 1]![0] - dx).toFixed(2)},${(points[i + 1]![1] - t[i + 1]! * dx).toFixed(2)} ` +
      `${points[i + 1]![0].toFixed(2)},${points[i + 1]![1].toFixed(2)}`
  }
  return d
}
