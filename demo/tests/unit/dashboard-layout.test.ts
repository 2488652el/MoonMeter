import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readRendererFile(path: string): string {
  return readFileSync(resolve(process.cwd(), `code/src/renderer/${path}`), 'utf8')
}

const source = readRendererFile('pages/Dashboard.tsx')
const sidebar = readRendererFile('layout/Sidebar.tsx')
const app = readRendererFile('App.tsx')
const actionCenter = readRendererFile('components/ActionCenter.tsx')

describe('dashboard information hierarchy', () => {
  it('puts scope, actions, core metrics, trend, and secondary details in order', () => {
    const scope = source.indexOf('data-dashboard-scope')
    const actions = source.indexOf('data-action-center')
    const metrics = source.indexOf('data-dashboard-primary-metrics')
    const trend = source.indexOf('data-dashboard-trend')
    const secondary = source.indexOf('data-dashboard-secondary')

    expect(scope).toBeGreaterThan(0)
    expect(actions).toBeGreaterThan(scope)
    expect(metrics).toBeGreaterThan(actions)
    expect(trend).toBeGreaterThan(metrics)
    expect(secondary).toBeGreaterThan(trend)
    expect(source.match(/data-dashboard-primary-metric(?!s)/g)).toHaveLength(4)
    expect(source.match(/data-dashboard-secondary-metric(?!s)/g)).toHaveLength(4)
    expect(source).toContain('<details')
    expect(actionCenter).toContain('slice(0, 3)')
    expect(source.match(/<SourceActivation/g)).toHaveLength(1)
  })

  it('keeps exactly six labelled primary entries and a unique active state', () => {
    expect(sidebar.match(/activePaths:\s*\[/g)).toHaveLength(6)
    expect(sidebar).toContain('data-primary-nav-item')
    for (const label of ['概览', '分析', '额度', '来源', '告警', '设置']) {
      expect(sidebar).toContain(`label: '${label}'`)
    }
    expect(sidebar).toContain('const activePrimary =')
    expect(sidebar).toContain('aria-current={isActive ?')
    expect(sidebar).not.toContain('NAV_SECTIONS')
  })

  it('keeps every legacy route reachable in the route table', () => {
    for (const route of [
      '/',
      '/projects',
      '/providers',
      '/models',
      '/logs',
      '/sources',
      '/timeline',
      '/balance',
      '/apikeys',
      '/pricing',
      '/alerts',
      '/settings',
      '/agents',
      '/sessions'
    ]) {
      expect(app).toContain(`path="${route}"`)
    }
  })
})
