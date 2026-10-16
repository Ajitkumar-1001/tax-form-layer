import { describe, expect, it } from 'vitest'
import { formatClock, formatMoney, initials, refHref, relativeTime } from '@/components/atoms/format'

describe('formatMoney', () => {
  it('formats with grouping, a true minus, optional plus, and a dash for missing', () => {
    expect(formatMoney(1234.5)).toBe('1,234.50')
    expect(formatMoney(1234)).toBe('1,234')
    expect(formatMoney(-0.5)).toBe('−0.50')
    expect(formatMoney(-15536)).toBe('−15,536')
    expect(formatMoney(200, true)).toBe('+200')
    expect(formatMoney(-0.001, true)).toBe('0')
    expect(formatMoney(null)).toBe('—')
    expect(formatMoney(Number.NaN)).toBe('—')
  })
})

describe('refHref', () => {
  it('URI-encodes refs as in ARCHITECTURE.md', () => {
    expect(refHref('F8949.B.N1')).toBe('/r/F8949.B.N1')
    expect(refHref('household:theo#ssn')).toBe('/r/household%3Atheo%23ssn')
    expect(refHref('py:/prior_preparer_workpaper/notes/0')).toBe('/r/py%3A%2Fprior_preparer_workpaper%2Fnotes%2F0')
  })
})

describe('time', () => {
  it('formats the season clock in UTC', () => {
    expect(formatClock('2026-06-23T06:05:00Z')).toBe('2026-06-23 06:05')
  })
  it('gives relative time in both directions', () => {
    const now = Date.parse('2026-06-23T06:05:00Z')
    expect(relativeTime('2026-06-23T06:05:20Z', now)).toBe('just now')
    expect(relativeTime('2026-06-23T05:05:00Z', now)).toBe('1 hour ago')
    expect(relativeTime('2026-06-30T06:05:00Z', now)).toBe('in 7 days')
  })
})

describe('initials', () => {
  it('takes the first letters of the first two words, upper-cased', () => {
    expect(initials('Priya Raman')).toBe('PR')
    expect(initials('  helen   strand ')).toBe('HS')
    expect(initials('Ama Okafor Lindqvist')).toBe('AO')
    expect(initials('System')).toBe('S')
    expect(initials('')).toBe('')
  })
})
