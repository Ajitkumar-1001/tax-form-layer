'use client'
import { use, useState } from 'react'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { WorkspaceContext } from '@/components/workspace/context'
import type { Val } from '@/lib/model/claims'
import { displayMasked, type MaskToken, splitMasked } from '@/lib/model/mask-token'

/**
 * Text that may hold masked tokens («ssn·3309·eq:…»). Tokens show as •••-••-3309 with a Reveal button;
 * the server logs every reveal (and every refusal) before answering. `context` is the ref being viewed.
 */
export function MaskedText({ text, context }: { text: Val; context: string }) {
  // A reveal or refusal is held under one viewer's authority: key the tokens on the viewer so a switch remounts them.
  const viewer = use(WorkspaceContext)?.viewer.id
  if (text == null) return <span className="text-muted-foreground">—</span>
  return (
    <span>
      {splitMasked(String(text)).map((part, i) =>
        typeof part === 'string' ? <span key={i}>{part}</span> : <MaskedToken key={`${viewer ?? ''}|${i}`} token={part} context={context} />,
      )}
    </span>
  )
}

function MaskedToken({ token, context }: { token: MaskToken; context: string }) {
  const ws = use(WorkspaceContext)
  const [shown, setShown] = useState<{ value: string } | { reason: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function reveal() {
    if (!ws || busy) return
    setBusy(true)
    const r = await ws.reveal(token.raw, context)
    setBusy(false)
    setShown(r.ok ? { value: r.value } : { reason: r.reason })
  }

  const value = shown && 'value' in shown ? shown.value : null
  const reason = shown && 'reason' in shown ? shown.reason : null
  // Names the value a button opens: a list of them is otherwise a column of identical "Reveal" buttons.
  const what = `${token.kind.replace('_', ' ')}${token.last4 ? ` ending ${token.last4}` : ''}`
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span data-tour="masked-value" aria-live="polite" className="font-mono tabular-nums" title={value ? 'Revealed; this view was logged' : `Masked ${token.kind.replace('_', ' ')}`}>
        {value ?? displayMasked(token)}
      </span>
      {value ? (
        <button type="button" onClick={() => setShown(null)} aria-label={`Hide ${what}`} className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground">
          <EyeOffIcon className="size-3" /> Hide
        </button>
      ) : (
        <button
          type="button"
          onClick={reveal}
          aria-label={`Reveal ${what}`}
          aria-disabled={busy || !ws || undefined}
          aria-busy={busy || undefined}
          className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline aria-disabled:opacity-50"
        >
          <EyeIcon className="size-3" /> {busy ? 'Revealing…' : 'Reveal'}
        </button>
      )}
      <span role="status" className="text-xs whitespace-normal text-destructive">{reason}</span>
    </span>
  )
}
