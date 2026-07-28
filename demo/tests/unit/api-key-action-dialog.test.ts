import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'code/src/renderer/pages/ApiKeys.tsx'), 'utf8')

describe('API Key action dialogs', () => {
  it('uses application modals instead of browser dialogs for delete and connection testing', () => {
    const actionSection = source.slice(
      source.indexOf('/** 打开删除确认弹窗。 */'),
      source.indexOf('/** 从本机 CLI 凭据导入 Key */')
    )

    expect(actionSection).not.toContain('window.confirm(')
    expect(actionSection).not.toContain('window.alert(')
    expect(source).toContain('<DeleteKeyDialog')
    expect(source).toContain('<TestConnectionDialog')
  })

  it('keeps destructive confirmation and asynchronous test result states visible in the dialog', () => {
    expect(source).toContain('确认删除')
    expect(source).toContain("status: 'testing'")
    expect(source).toContain('aria-live="polite"')
  })
})
