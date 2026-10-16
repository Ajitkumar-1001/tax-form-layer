import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TourLink } from '@/components/tour/tour-link'

describe('TourLink', () => {
  it('is a button that offers the tour', () => {
    const html = renderToString(h(TourLink))
    expect(html).toContain('<button')
    expect(html).toContain('Take the tour')
  })
})
