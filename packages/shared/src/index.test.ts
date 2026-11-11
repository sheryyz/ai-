import { describe, expect, it } from 'vitest'
import { isSlug, PROTOCOL_VERSION } from './index'

describe('protocol §1 identifiers', () => {
  it('exposes protocol version 1', () => {
    expect(PROTOCOL_VERSION).toBe(1)
  })

  it.each(['attendee', 'checkedIn', 'filter_unchecked', 'a'])('accepts slug %s', (s) => {
    expect(isSlug(s)).toBe(true)
  })

  it.each(['', 'Attendee', '1field', 'has-dash', '中文', `a${'b'.repeat(40)}`])(
    'rejects invalid slug %j',
    (s) => {
      expect(isSlug(s)).toBe(false)
    },
  )
})
