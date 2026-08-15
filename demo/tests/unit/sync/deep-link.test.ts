import { describe, expect, it } from 'vitest'
import { parseSyncBindingLink } from '../../../../code/src/main/sync/deep-link'

describe('sync binding deep link', () => {
  const ticket = 'a'.repeat(43)

  it.each(['moonmeter', 'tokenlub'])('accepts the %s binding route', (scheme) => {
    const server = encodeURIComponent('https://sync.example.com')
    expect(parseSyncBindingLink(`${scheme}://sync/bind?server=${server}&ticket=${ticket}`)).toEqual(
      {
        baseUrl: 'https://sync.example.com',
        ticket
      }
    )
  })

  it.each([
    `https://sync/bind?server=https://sync.example.com&ticket=${ticket}`,
    `tokenlub://other/bind?server=https://sync.example.com&ticket=${ticket}`,
    `tokenlub://sync/delete?server=https://sync.example.com&ticket=${ticket}`,
    `tokenlub://sync/bind?server=https://user:pw@sync.example.com&ticket=${ticket}`,
    `tokenlub://sync/bind?server=file:///tmp/server&ticket=${ticket}`,
    'tokenlub://sync/bind?server=https://sync.example.com&ticket=short'
  ])('rejects an unsafe link: %s', (link) => {
    expect(() => parseSyncBindingLink(link)).toThrow('invalid sync binding link')
  })

  it('rejects HTTP sync servers unless explicitly allowed', () => {
    const link = `moonmeter://sync/bind?server=${encodeURIComponent('http://sync.example.com')}&ticket=${ticket}`
    expect(() => parseSyncBindingLink(link)).toThrow('invalid sync binding link')
    expect(parseSyncBindingLink(link, { allowHttp: true })).toEqual({
      baseUrl: 'http://sync.example.com',
      ticket
    })
  })
})
