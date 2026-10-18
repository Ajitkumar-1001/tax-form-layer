// Whether a post's refusal goes untoasted (workspace/provider.tsx, post): under `quiet`, under `quietRefusal: true`, and,
// for a function, as it answers when the refusal arrives. The act form passes one that is true only while the form is
// mounted, so a refusal that lands after its dialog was closed is toasted instead of shown nowhere.
import { describe, expect, it } from 'vitest'
import { refusalQuiet } from '@/components/workspace/types'

describe('refusalQuiet', () => {
  it('toasts a refusal unless the post asked for quiet', () => {
    expect(refusalQuiet({})).toBe(false)
    expect(refusalQuiet({ quiet: true })).toBe(true)
    expect(refusalQuiet({ quietRefusal: true })).toBe(true)
  })

  it('takes a function at its answer: quiet while the form is open, toasted once it has closed', () => {
    expect(refusalQuiet({ quietRefusal: () => true })).toBe(true)
    expect(refusalQuiet({ quietRefusal: () => false })).toBe(false)
  })

  it('asks the function on each decision, not when the options are made', () => {
    let asked = 0
    let open = true
    const opts = { quietRefusal: () => (asked++, open) }
    expect(asked).toBe(0)
    expect(refusalQuiet(opts)).toBe(true)
    open = false // the dialog was closed while the post was in flight
    expect(refusalQuiet(opts)).toBe(false)
    expect(asked).toBe(2)
  })
})
