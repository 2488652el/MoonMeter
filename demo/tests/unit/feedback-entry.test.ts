import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('feedback entry', () => {
  it('opens the public issue pages in the browser without attaching diagnostics', () => {
    const source = readFileSync(
      resolve(__dirname, '../../../code/src/renderer/pages/Settings.tsx'),
      'utf8'
    )
    expect(source).toContain("https://github.com/2488652el/MoonMeter/issues'")
    expect(source).toContain("https://github.com/2488652el/MoonMeter/issues/new/choose'")
    expect(source).toContain('target="_blank"')
    expect(source).toContain('不会自动附加诊断包')
    expect(source).toContain('自行选择是否附加到反馈')
  })
})
