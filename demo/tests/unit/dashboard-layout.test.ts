import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'code/src/renderer/pages/Dashboard.tsx'), 'utf8')

describe('dashboard information hierarchy', () => {
  it('puts scope and core metrics before exceptions and management panels', () => {
    const filter = source.indexOf('data-usage-filter-bar')
    const metrics = source.indexOf('核心指标')
    const actions = source.indexOf(
      '<ActionCenter actions={quotaPlanning.overview?.actions ?? []} />'
    )
    const management = source.indexOf('data-dashboard-management')

    expect(filter).toBeGreaterThan(0)
    expect(metrics).toBeGreaterThan(filter)
    expect(actions).toBeGreaterThan(metrics)
    expect(management).toBeGreaterThan(actions)
  })
})
