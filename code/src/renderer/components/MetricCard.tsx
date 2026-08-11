/**
 * MetricCard:核心指标统计卡(参考形态)。
 *
 * 结构:大数字 + 数字旁涨跌箭头(绿涨红跌)+ 带链接箭头的标签 + 副说明 +
 * 底部无边框渐变 sparkline(单调平滑曲线)。语义色:钱=金 / 量=蓝 / 请求=紫 /
 * 命中=绿。缓存命中率等占比指标切换为 0–100 细条。曲线绑定真实数据序列。
 */
import { type CSSProperties, type ReactNode } from 'react'
import clsx from 'clsx'
import { Icon } from './Icon'
import { CARD_SURFACE_CLASS } from './cardStyles'
import { AnimatedNumber, SegmentedProgress, Sparkline } from './motion'

export type MetricTone = 'accent' | 'blue' | 'purple' | 'green' | 'amber' | 'red' | 'neutral'

/** 涨跌方向。 */
export type MetricDeltaDirection = 'up' | 'down' | 'flat'

export interface MetricDelta {
  direction: MetricDeltaDirection
  /** 展示文本,如 "12.4%"。 */
  label: string
  /** 该指标"上涨为好"还是"下跌为好",决定配色语义(默认 up=好=绿)。 */
  positiveWhen?: 'up' | 'down'
}

export interface MetricCardProps {
  label: string
  icon: string
  /** 主数值(交给 AnimatedNumber 动画)。 */
  value: number
  /** 数值格式化(如 fmtMoney / fmtCount / 百分比)。 */
  format?: ((value: number) => string) | undefined
  /** 数值后缀单位节点(如 ".56"、"M"、"%")。 */
  unit?: ReactNode | undefined
  /** 副说明(数值下方灰色小字)。 */
  sub?: ReactNode | undefined
  tone?: MetricTone | undefined
  /** 涨跌信息;不传则不显示。 */
  delta?: MetricDelta | undefined
  /** sparkline 数据序列;提供时渲染底部渐变曲线。 */
  series?: number[] | undefined
  /** 占比进度(0–1);提供时替代 sparkline,渲染 0–100 细条。 */
  progress?: number | undefined
  /** 标签点击(链接箭头)回调;提供时标签可点。 */
  onLabelClick?: (() => void) | undefined
  motionOrder?: number | undefined
}

const TONE_HEX: Record<MetricTone, string> = {
  accent: '#917938',
  blue: '#3B82F6',
  purple: '#8B5CF6',
  green: '#10B981',
  amber: '#F59E0B',
  red: '#EF4444',
  neutral: '#77736B'
}

const TONE_ICON: Record<MetricTone, string> = {
  accent: 'text-accent-text bg-accent-dim',
  blue: 'text-status-blue bg-status-blue-dim',
  purple: 'text-status-purple bg-status-purple-dim',
  green: 'text-emerald-600 bg-emerald-500/10',
  amber: 'text-status-amber bg-status-amber-dim',
  red: 'text-status-red bg-status-red-dim',
  neutral: 'text-text-secondary bg-bg-hover'
}

function DeltaChip({ delta }: { delta: MetricDelta }) {
  const good =
    delta.direction === 'flat'
      ? null
      : delta.positiveWhen === 'down'
        ? delta.direction === 'down'
        : delta.direction === 'up'
  const arrow = delta.direction === 'up' ? '▲' : delta.direction === 'down' ? '▼' : '—'
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-0.5 font-mono text-[12px] font-bold leading-none',
        delta.direction === 'flat'
          ? 'text-text-muted'
          : good
            ? 'text-emerald-500'
            : 'text-status-red'
      )}
    >
      <span aria-hidden="true" className="text-[9px]">
        {arrow}
      </span>
      <span aria-hidden="true">{delta.label}</span>
      <span className="sr-only">
        {delta.direction === 'up' ? '上涨' : delta.direction === 'down' ? '下降' : '持平'}
        {delta.label}
      </span>
    </span>
  )
}

export function MetricCard({
  label,
  icon,
  value,
  format,
  unit,
  sub,
  tone = 'neutral',
  delta,
  series,
  progress,
  onLabelClick,
  motionOrder = 0
}: MetricCardProps) {
  const hasSpark = progress === undefined && series && series.length > 1
  const showProgress = progress !== undefined

  return (
    <div
      data-dashboard-metric={label}
      className={clsx(
        CARD_SURFACE_CLASS,
        'motion-card group relative flex h-full min-h-[168px] flex-col transition-colors hover:bg-bg-card/80'
      )}
      style={{ '--motion-order': motionOrder } as CSSProperties}
    >
      {onLabelClick ? (
        <div className="pointer-events-none absolute right-3.5 top-3.5 flex translate-y-[-4px] gap-1.5 opacity-0 transition-all duration-200 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100">
          <button
            type="button"
            aria-label={`查看${label}详情`}
            onClick={onLabelClick}
            className="grid h-7 w-7 place-items-center rounded-md border border-border-light bg-bg-hover text-[11px] text-text-secondary transition-colors hover:border-border hover:text-text-primary"
          >
            <Icon name="fa-arrow-right" />
          </button>
        </div>
      ) : null}

      <div className="flex flex-1 flex-col px-4 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="text-[12px] font-semibold text-text-secondary">{label}</div>
          <span
            className={clsx(
              'flex h-7 w-7 flex-none items-center justify-center rounded-md text-[10px]',
              TONE_ICON[tone]
            )}
          >
            <Icon name={icon} />
          </span>
        </div>

        <div className="mt-2 flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate font-mono text-[34px] font-bold leading-none tracking-[-0.03em] text-text-primary">
            <AnimatedNumber value={value} {...(format ? { format } : {})} durationMs={520} />
            {unit ? (
              <span className="ml-0.5 text-[15px] font-semibold text-text-muted">{unit}</span>
            ) : null}
          </span>
          {delta ? <DeltaChip delta={delta} /> : null}
        </div>

        {sub ? (
          <div
            className="mt-1.5 truncate text-[11px] text-text-muted"
            title={typeof sub === 'string' ? sub : undefined}
          >
            {sub}
          </div>
        ) : null}

        {showProgress ? (
          /* 与 sparkline 卡等高:固定 footer 高度,分段条在其中垂直居中,保证整行卡片齐平 */
          <div className="mt-auto flex h-[54px] flex-col justify-center pb-1">
            <SegmentedProgress
              value={progress!}
              label={`${label}进度`}
              tone={tone === 'neutral' ? 'accent' : tone}
            />
          </div>
        ) : null}
      </div>

      {/* 底部无边框渐变 sparkline(绑定真实序列) */}
      {hasSpark ? (
        <div className="mt-auto h-[54px] w-full" style={{ color: TONE_HEX[tone] }}>
          <Sparkline values={series!} height={54} label={`${label}趋势`} />
        </div>
      ) : null}
    </div>
  )
}
