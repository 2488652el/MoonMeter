import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MetricCard } from '../../../code/src/renderer/components/MetricCard'
import { Sparkline } from '../../../code/src/renderer/components/motion/Sparkline'

describe('MetricCard + Sparkline (dashboard stat cards)', () => {
  it('Sparkline 渲染平滑曲线(三次贝塞尔 C 段)与渐变面积,数据绑定', () => {
    const html = renderToStaticMarkup(
      createElement(Sparkline, { values: [3, 5, 2, 8, 6], color: '#917938', label: '成本趋势' })
    )
    // 平滑路径含 C 段,面积闭合
    expect(html).toContain('C')
    expect(html).toContain('Z')
    // 描边色绑定传入色
    expect(html).toContain('#917938')
    // 渐变定义存在
    expect(html).toContain('linearGradient')
  })

  it('MetricCard 渲染大数字、语义色 sparkline 与标签', () => {
    const html = renderToStaticMarkup(
      createElement(MetricCard, {
        label: '总成本',
        icon: 'fa-coins',
        tone: 'accent',
        value: 1284.56,
        format: (v: number) => `¥${v.toFixed(2)}`,
        delta: { direction: 'up', label: '12.4%' },
        series: [10, 14, 9, 20, 26],
        sub: '按发生时成本汇总'
      })
    )
    expect(html).toContain('data-dashboard-metric="总成本"')
    expect(html).not.toContain('<button')
    // 大数字(末态文本经 sr-only 暴露)
    expect(html).toContain('¥1284.56')
    // 涨跌箭头(绿涨)
    expect(html).toContain('12.4%')
    // 趋势曲线已渲染(C 段)
    expect(html).toContain('C')
  })

  it('只有提供详情回调时才渲染可交互按钮', () => {
    const html = renderToStaticMarkup(
      createElement(MetricCard, {
        label: '总请求数',
        icon: 'fa-arrow-right-arrow-left',
        value: 12,
        onLabelClick: () => undefined
      })
    )
    expect(html).toContain('<button')
    expect(html).toContain('aria-label="查看总请求数详情"')
  })

  it('MetricCard 占比模式渲染分段竖条(20 段,按进度填充)而非实心细条', () => {
    const html = renderToStaticMarkup(
      createElement(MetricCard, {
        label: '缓存命中率',
        icon: 'fa-database',
        tone: 'green',
        value: 67.3,
        format: (v: number) => `${v.toFixed(1)}%`,
        progress: 0.673,
        sub: '32.4M 缓存读取'
      })
    )
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow="67"')
    // 分段竖条:20 段,填充数 = round(0.673*20)=13
    const bars = html.match(/rounded-\[4px\]/g) ?? []
    expect(bars.length).toBe(20)
    const filledBars = html.match(/#10B981/g) ?? []
    expect(filledBars.length).toBe(13)
    // 占比模式不画 sparkline 曲线
    expect(html).not.toContain('linearGradient')
    // 0/50/100 刻度
    expect(html).toContain('>0</span>')
    expect(html).toContain('>50</span>')
    expect(html).toContain('>100</span>')
  })

  it('MetricCard 下跌指标使用红色语义', () => {
    const html = renderToStaticMarkup(
      createElement(MetricCard, {
        label: '缓存命中率',
        icon: 'fa-database',
        value: 67.3,
        format: (v: number) => `${v.toFixed(1)}%`,
        delta: { direction: 'down', label: '1.2%' },
        progress: 0.673
      })
    )
    expect(html).toContain('1.2%')
    expect(html).toContain('下降')
    expect(html).toContain('aria-hidden="true">1.2%</span>')
    expect(html).toContain('<span class="sr-only">下降1.2%</span>')
  })

  it('零进度仍然使用进度模式而不渲染 sparkline', () => {
    const html = renderToStaticMarkup(
      createElement(MetricCard, {
        label: '计价覆盖',
        icon: 'fa-tag',
        value: 0,
        progress: 0,
        series: [1, 2, 3]
      })
    )
    expect(html).toContain('role="progressbar"')
    expect(html).not.toContain('linearGradient')
  })
})
