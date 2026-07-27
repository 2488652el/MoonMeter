import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../../..')

describe('packaged upgrade smoke test', () => {
  it('derives its version expectation from package.json instead of a stale release literal', () => {
    const source = readFileSync(
      resolve(root, 'demo/tests/e2e/windows-packaged-upgrade.spec.ts'),
      'utf8'
    )
    expect(source).toContain("createRequire(__filename)('../../../package.json')")
    expect(source).toContain('resolves.toBe(packageVersion)')
    expect(source).not.toContain("resolves.toBe('1.2.1')")
  })
})
