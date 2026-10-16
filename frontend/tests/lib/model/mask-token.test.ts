import { describe, expect, it } from 'vitest'
import { makeToken, plainMasked } from '@/lib/model/mask-token'

describe('plainMasked', () => {
  it('shows one token in its masked form and keeps the text around it', () => {
    expect(plainMasked(`Theo's SSN ${makeToken('ssn', '3309', 'Kq7xT2')} is on D06`)).toBe("Theo's SSN •••-••-3309 is on D06")
  })

  it('shows every token, each by its kind, including at the ends of the text', () => {
    const ssn = makeToken('ssn', '3309', 'a1')
    expect(plainMasked(`${ssn} ≠ ${makeToken('ssn', '3390', 'b2')}`)).toBe('•••-••-3309 ≠ •••-••-3390')
    expect(plainMasked(`${makeToken('ein', '1234', 'c3')}${makeToken('account', '6789', 'd4')}`)).toBe('••-•••1234••••6789')
  })

  it('returns text without tokens unchanged', () => {
    expect(plainMasked('Wages on W-2 box 1 do not match line 1a')).toBe('Wages on W-2 box 1 do not match line 1a')
    expect(plainMasked('')).toBe('')
  })
})
