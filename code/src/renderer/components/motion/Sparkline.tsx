/**
 * Sparkline:无边框渐变面积 + 单调平滑曲线的迷你趋势图。
 *
 * 数据驱动:传入一组数值序列,内部用 Fritsch–Carlson 单调三次(shared
 * `monotonePath`)生成顺滑曲线,面积按当前色(currentColor)做纵向渐隐。
 * 纯展示、无坐标轴,适配 KPI 卡底部与紧凑趋势位。尊重 reduced-motion。
 */
import { useId, useMemo } from 'react'
import clsx from 'clsx'
import { monotonePath } from '@shared/utils/usage-trend'
import { useReducedMotion } from '../../hooks/useReducedMotion'

export type SparklineProps = {
  /** 趋势数值序列(按时间升序)。少于 2 个点时退化为直线。 */
  values: number[]
  /** 曲线描边色(CSS 颜色,默认 currentColor 跟随父级 text 色)。 */
  color?: string | undefined
  /** 是否绘制面积渐隐(默认 true)。 */
  filled?: boolean | undefined
  /** viewBox 高度(坐标系单位,默认 60)。 */
  height?: number | undefined
  /** 是否显示末端圆点(默认 true)。 */
  showEndDot?: boolean | undefined
  className?: string | undefined
  /** 无障碍标签(描述趋势含义)。 */
  label?: string | undefined
}

export function Sparkline({
  values,
  color,
  filled = true,
  height = 60,
  showEndDot = true,
  className,
  label
}: SparklineProps) {
  const reducedMotion = useReducedMotion()
  const gradientId = useId()

  const geometry = useMemo(() => {
    const clean = values.map((v) => (Number.isFinite(v) ? v : 0))
    const n = clean.length
    if (n === 0) return null
    const width = 100
    const pad = 3
    const min = Math.min(...clean)
    const max = Math.max(...clean)
    const span = max - min || 1
    const usable = height - pad * 2
    const stepX = n > 1 ? width / (n - 1) : 0
    const pts: Array<[number, number]> = clean.map((v, i) => [
      i * stepX,
      // y 轴向下,值越大越靠上
      pad + (1 - (v - min) / span) * usable
    ])
    const line = monotonePath(pts)
    const area = `${line}L${width},${height}L0,${height}Z`
    return { line, area, end: pts[n - 1]!, width }
  }, [values, height])

  if (!geometry) return null

  const stroke = color ?? 'currentColor'
  const dur = reducedMotion ? 0 : 600

  return (
    <svg
      viewBox={`0 0 ${geometry.width} ${height}`}
      preserveAspectRatio="none"
      className={clsx('block h-full w-full', className)}
      role="img"
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      {filled && (
        <path
          d={geometry.area}
          fill={`url(#${gradientId})`}
          stroke="none"
          style={reducedMotion ? undefined : { transition: `opacity ${dur}ms ease-out` }}
        />
      )}
      <path
        d={geometry.line}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        style={reducedMotion ? undefined : { transition: `opacity ${dur}ms ease-out` }}
      />
      {showEndDot && (
        <circle cx={geometry.end[0]} cy={geometry.end[1]} r={2.6} fill={stroke} stroke="none" />
      )}
    </svg>
  )
}
