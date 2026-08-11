import { describe, expect, it } from 'vitest'
import { monotonePath } from '../../../code/src/shared/utils/usage-trend'

/** 解析 path 命令中出现的所有 y 坐标(M/L/C 的最后一个数值)。 */
function pathYs(d: string): number[] {
  return d
    .split(/(?=[MLC])/)
    .filter(Boolean)
    .flatMap((seg) => {
      const nums = seg.slice(1).trim().split(/[ ,]+/).map(Number)
      // C 段有 3 个坐标对,M/L 段 1 个;取每个坐标对的 y
      const ys: number[] = []
      for (let i = 1; i < nums.length; i += 2) ys.push(nums[i]!)
      return ys
    })
}

describe('monotonePath (Fritsch–Carlson)', () => {
  it('空点与单点不产生曲线段', () => {
    expect(monotonePath([])).toBe('')
    expect(monotonePath([[5, 10]])).toBe('M5,10')
  })

  it('两点退化为直线,不含三次贝塞尔', () => {
    const d = monotonePath([
      [0, 0],
      [10, 20]
    ])
    expect(d).toBe('M0,0L10,20')
    expect(d.includes('C')).toBe(false)
  })

  it('多点生成平滑三次贝塞尔路径,并穿过所有数据点', () => {
    const pts: Array<[number, number]> = [
      [0, 46],
      [22, 42],
      [44, 45],
      [66, 34],
      [88, 38]
    ]
    const d = monotonePath(pts)
    expect(d.startsWith('M0.00,46.00')).toBe(true)
    expect(d.includes('C')).toBe(true)
    expect(d.includes('L')).toBe(false)
    // 终点应等于最后一个数据点
    expect(d.trim().endsWith('88.00,38.00')).toBe(true)
  })

  it('对含零桶的稀疏序列不产生负值过冲(不低于最小 y)', () => {
    // 模拟 30 天中大量为 0 的稀疏用量序列(SVG 坐标系,y 越小值越大)
    const pts: Array<[number, number]> = [
      [0, 50],
      [10, 50],
      [20, 12],
      [30, 50],
      [40, 50],
      [50, 30]
    ]
    const d = monotonePath(pts)
    const minY = Math.min(...pts.map((p) => p[1]))
    const maxY = Math.max(...pts.map((p) => p[1]))
    // 所有控制点/锚点 y 都应落在数据 y 的上下界内(单调插值不过冲)
    for (const y of pathYs(d)) {
      expect(y).toBeGreaterThanOrEqual(minY - 0.5)
      expect(y).toBeLessThanOrEqual(maxY + 0.5)
    }
  })

  it('局部极值处切线归零,不越过相邻数据点', () => {
    // 尖峰:中间点明显高于两侧,曲线不应向上鼓出超过该点
    const pts: Array<[number, number]> = [
      [0, 40],
      [10, 10],
      [20, 40]
    ]
    const d = monotonePath(pts)
    for (const y of pathYs(d)) {
      expect(y).toBeGreaterThanOrEqual(10 - 0.5)
      expect(y).toBeLessThanOrEqual(40 + 0.5)
    }
  })
})
