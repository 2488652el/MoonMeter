/**
 * SegmentedProgress:分段竖条进度(参考形态)。
 *
 * 用一排圆角竖条代替实心进度条:已用部分实色、剩余部分极淡(类比参考图的
 * 8% 透明度),顶端带 0 / 50 / 100 刻度。20 段 × 5% 让 80% / 95% 阈值正好落在
 * 段边界上。竖条逐段向上生长,尊重 reduced-motion。纯展示、数据驱动。
 */
import { type CSSProperties } from 'react'
import clsx from 'clsx'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { clampProgress } from './ProgressBar'

export type SegmentedProgressTone = 'accent' | 'blue' | 'purple' | 'green' | 'amber' | 'red'

export type SegmentedProgressProps = {
  /** 进度 0–1。 */
  value: number
  /** 无障碍标签。 */
  label: string
  tone?: SegmentedProgressTone | undefined
  /** 分段数(默认 20,对应每段 5%)。 */
  segments?: number | undefined
  /** 竖条高度(px,默认 34)。 */
  height?: number | undefined
  /** 是否显示 0/50/100 刻度(默认 true)。 */
  showTicks?: boolean | undefined
  /** 自定义填充色(CSS 颜色);提供时覆盖 tone(仅对"未达阈值"常态生效由调用方控制)。 */
  color?: string | undefined
  className?: string | undefined
}

const TONE_FILL: Record<SegmentedProgressTone, string> = {
  accent: 'rgb(var(--color-accent-strong))',
  blue: '#3B82F6',
  purple: '#8B5CF6',
  green: '#10B981',
  amber: '#F59E0B',
  red: '#EF4444'
}

export function SegmentedProgress({
  value,
  label,
  tone = 'accent',
  segments = 20,
  height = 34,
  showTicks = true,
  color,
  className
}: SegmentedProgressProps) {
  const reducedMotion = useReducedMotion()
  const progress = clampProgress(value)
  const filledCount = Math.round(progress * segments)
  const fill = color ?? TONE_FILL[tone]

  return (
    <div className={clsx('w-full', className)}>
      {showTicks ? (
        <div
          aria-hidden="true"
          className="mb-1.5 flex justify-between font-mono text-[9.5px] leading-none text-text-muted"
        >
          <span>0</span>
          <span>50</span>
          <span>100</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        className="flex items-stretch gap-[3px]"
        style={{ height }}
      >
        {Array.from({ length: segments }, (_, i) => {
          const filled = i < filledCount
          return (
            <span
              key={i}
              aria-hidden="true"
              className="flex-1 rounded-[4px]"
              style={
                {
                  backgroundColor: filled ? fill : 'rgb(var(--color-ink) / 0.07)',
                  transform: reducedMotion || filled ? 'scaleY(1)' : 'scaleY(0.92)',
                  transformOrigin: 'center bottom',
                  transition: reducedMotion
                    ? undefined
                    : `transform var(--motion-data) var(--motion-ease-out), background-color var(--motion-control) var(--motion-ease-standard)`,
                  transitionDelay: reducedMotion ? undefined : `${Math.min(i * 14, 220)}ms`
                } as CSSProperties
              }
            />
          )
        })}
      </div>
    </div>
  )
}
