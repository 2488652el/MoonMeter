import { describe, expect, it } from 'vitest'
import {
  discoverWslDistributions,
  parseWslDistributionList,
  parseWslVerboseDistributionList,
  resolveWslHome,
  validateWslDistributionName
} from '../../../../code/src/main/platform/wsl'

describe('WSL discovery', () => {
  it('parses quiet output without headers, BOMs, or duplicate names', () => {
    expect(parseWslDistributionList('\uFEFFUbuntu\r\n\u0000Ubuntu\r\n Debian \r\n')).toEqual([
      'Ubuntu',
      'Debian'
    ])
  })

  it('parses verbose running/stopped state and default marker', () => {
    const parsed = parseWslVerboseDistributionList(
      '  NAME      STATE           VERSION\r\n* Ubuntu    Running         2\r\n  Debian    Stopped         1\r\n'
    )
    expect(parsed.get('Ubuntu')).toEqual({ state: 'running', version: 2, isDefault: true })
    expect(parsed.get('Debian')).toEqual({ state: 'stopped', version: 1, isDefault: false })
  })

  it('uses argument arrays, classifies unavailable WSL, and never starts a distro during discovery', async () => {
    const calls: string[][] = []
    const result = await discoverWslDistributions(async (args) => {
      calls.push([...args])
      if (args.includes('--quiet')) return { stdout: 'Ubuntu\n', stderr: '' }
      return { stdout: '* Ubuntu    Stopped         2\n', stderr: '' }
    })
    expect(result).toMatchObject({
      available: true,
      distributions: [{ name: 'Ubuntu', state: 'stopped' }]
    })
    expect(calls).toEqual([
      ['--list', '--quiet'],
      ['--list', '--verbose']
    ])
    expect(calls.flat()).not.toContain('--exec')
  })

  it('returns a safe unavailable result for command-not-found', async () => {
    const result = await discoverWslDistributions(async () => {
      const error = Object.assign(new Error('wsl.exe was not found'), { code: 'ENOENT' })
      throw error
    })
    expect(result).toEqual({
      available: false,
      distributions: [],
      errorCode: 'wsl-unavailable',
      errorMessage: 'WSL 不可用，请安装或启用 Windows Subsystem for Linux'
    })
  })

  it('resolves home only through an explicit distribution command', async () => {
    const calls: string[][] = []
    const home = await resolveWslHome('Ubuntu', async (args) => {
      calls.push([...args])
      return { stdout: '/home/tester\n', stderr: '' }
    })
    expect(home).toBe('/home/tester')
    expect(calls).toEqual([
      ['--distribution', 'Ubuntu', '--exec', 'sh', '-lc', 'printf %s "$HOME"']
    ])
  })

  it('rejects control characters in a renderer-supplied distribution name', () => {
    expect(() => validateWslDistributionName('Ubuntu\n--exec')).toThrow(
      'invalid WSL distribution name'
    )
  })
})
