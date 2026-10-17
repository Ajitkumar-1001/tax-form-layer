// The shared print sheet (Response bundle, Client copy, the client's "Open your copy") is built from Base UI Dialog parts,
// so Tab stays inside, Esc works from anywhere in it and closing returns focus to the opener. Those behaviours need a DOM
// and are checked in the browser; here, server-rendered, only the shape that carries them is pinned.
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PrintSheet, PrintSheetBody } from '@/components/filing/print-sheet'

describe('print sheet', () => {
  it('renders through a Base UI portal, nothing in place, and leaves first focus to the Dialog', () => {
    // A portal renders nothing on the server, so the sheet leaves no markup in the page it is opened from.
    expect(renderToString(h(PrintSheet, { title: 'Client copy', onClose: () => {}, children: 'x' }))).toBe('')

    // Print must not take focus itself: it would run before Base UI records the opener, and become the return target.
    const body = renderToString(h(PrintSheetBody, { onClose: () => {}, children: h('p', null, 'BODY') }))
    for (const part of ['class="print-sheet', '@media print', 'Print', 'Close', 'BODY']) expect(body).toContain(part)
    expect(body).not.toContain('autofocus=')
  })
})
