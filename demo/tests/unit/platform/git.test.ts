import { describe, expect, it } from 'vitest'
import { readGitCommits, resolveGitRoot } from '../../../../code/src/main/platform/git'

describe('read-only git root adapter', () => {
  it('uses an argument array for Windows and accepts a normalized root', async () => {
    let call: { executable: string; args: readonly string[]; timeoutMs: number } | undefined
    const result = await resolveGitRoot(
      'C:\\Work Space\\project',
      'windows',
      undefined,
      async (executable, args, options) => {
        call = { executable, args, timeoutMs: options.timeoutMs }
        return { stdout: 'C:\\Work Space\\project\\\r\n', stderr: '' }
      }
    )
    expect(result).toEqual({ root: 'C:\\Work Space\\project\\' })
    expect(call).toEqual({
      executable: 'git',
      args: ['-C', 'C:\\Work Space\\project', 'rev-parse', '--show-toplevel'],
      timeoutMs: 5_000
    })
  })

  it('wraps WSL git without shell concatenation', async () => {
    let call: { executable: string; args: readonly string[] } | undefined
    const result = await resolveGitRoot(
      '/mnt/c/Work Space/project',
      'wsl',
      'Ubuntu',
      async (executable, args) => {
        call = { executable, args }
        return { stdout: '/mnt/c/Work Space/project\n', stderr: '' }
      }
    )
    expect(result).toEqual({ root: '/mnt/c/Work Space/project' })
    expect(call).toEqual({
      executable: 'wsl.exe',
      args: [
        '--distribution',
        'Ubuntu',
        '--exec',
        'git',
        '-C',
        '/mnt/c/Work Space/project',
        'rev-parse',
        '--show-toplevel'
      ]
    })
  })

  it('treats missing repositories and timeouts as advisory failures', async () => {
    await expect(
      resolveGitRoot('C:\\not-repo', 'windows', undefined, async () => ({ stdout: '', stderr: '' }))
    ).resolves.toEqual({ errorCode: 'not-repository' })
    await expect(
      resolveGitRoot('C:\\slow', 'windows', undefined, async () => {
        throw Object.assign(new Error('timed out'), { killed: true })
      })
    ).resolves.toEqual({ errorCode: 'timeout' })
  })

  it('rejects unsafe roots or distro names before process execution', async () => {
    let called = false
    const runner = async () => {
      called = true
      return { stdout: '/tmp', stderr: '' }
    }
    await expect(resolveGitRoot('/tmp\nunsafe', 'wsl', 'Ubuntu', runner)).resolves.toEqual({
      errorCode: 'unknown-error'
    })
    await expect(resolveGitRoot('/tmp', 'wsl', 'Ubuntu\n--exec', runner)).resolves.toEqual({
      errorCode: 'unknown-error'
    })
    expect(called).toBe(false)
  })

  it('keeps only commit metadata and numstat totals', async () => {
    const result = await readGitCommits(
      'C:\\Work Space\\project',
      'windows',
      undefined,
      10,
      async () => ({
        stdout:
          '0123456789abcdef0123456789abcdef01234567\u001fAlice\u001f2026-07-25T03:00:00+00:00\u001fAdd feature\u001e\n2\t3\tsrc/secret.ts\n-\t4\tbinary.bin\n',
        stderr: ''
      })
    )
    expect(result).toEqual({
      commits: [
        {
          commitId: '0123456789abcdef0123456789abcdef01234567',
          authorName: 'Alice',
          authoredAt: '2026-07-25T03:00:00+00:00',
          title: 'Add feature',
          changedFiles: 2,
          additions: 2,
          deletions: 7
        }
      ]
    })
  })
})
