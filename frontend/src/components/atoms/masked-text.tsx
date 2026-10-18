'use client'
import { use, useState } from 'react'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { WorkspaceContext } from '@/components/workspace/context'
import type { Workspace } from '@/components/workspace/types'
import type { Val } from '@/lib/model/claims'
import { displayMasked, type MaskToken, splitMasked } from '@/lib/model/mask-token'
import { cn } from '@/lib/utils'

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

// Both buttons sit in hosts of any face (mono, semibold, 20 px): font-sans font-normal puts the page's type back. The ::after
// stretches the target vertically only (24 px, 32 px on touch), so it never covers what sits beside the button. Reveal takes
// the pointer back while it is aria-disabled (busy, or no workspace); Hide is never inert.
const TARGET = 'relative cursor-pointer font-sans font-normal after:absolute after:inset-x-0 after:-inset-y-1 pointer-coarse:after:-inset-y-2'

type Shown = { value: string } | { reason: string }

/**
 * What pressing Reveal sets, and in what order, apart from React so Node can run it with recording setters. The last
 * answer is cleared before the server is asked: the same refusal set twice is no change, and a polite status stays
 * silent on no change.
 */
export async function runReveal(
  ask: () => ReturnType<Workspace['reveal']>,
  set: { busy(on: boolean): void; shown(next: Shown | null): void },
): Promise<void> {
  set.busy(true)
  set.shown(null)
  const r = await ask()
  set.busy(false)
  set.shown(r.ok ? { value: r.value } : { reason: r.reason })
}

function MaskedToken({ token, context }: { token: MaskToken; context: string }) {
  const ws = use(WorkspaceContext)
  const [shown, setShown] = useState<Shown | null>(null)
  const [busy, setBusy] = useState(false)

  async function reveal() {
    if (!ws || busy) return
    await runReveal(() => ws.reveal(token.raw, context), { busy: setBusy, shown: setShown })
  }

  const value = shown && 'value' in shown ? shown.value : null
  const reason = shown && 'reason' in shown ? shown.reason : null
  // Names the value a button opens: a list of them is otherwise a column of identical "Reveal" buttons. It trails the word
  // the button shows, as sr-only text, so the accessible name still starts with that word (an aria-label would replace it).
  const what = `${token.kind.replace('_', ' ')}${token.last4 ? ` ending ${token.last4}` : ''}`
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      <span data-tour="masked-value" aria-live="polite" className="font-mono tabular-nums whitespace-nowrap" title={value ? 'Revealed; this view was logged' : `Masked ${token.kind.replace('_', ' ')}`}>
        {value ?? displayMasked(token)}
      </span>
      {/* No space before a label: the icon's gap spaces it, and a pre-wrap host (the D08 page, a JSON view) would render one. */}
      {value ? (
        <button type="button" onClick={() => setShown(null)} className={cn('inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground', TARGET)}>
          <EyeOffIcon className="size-3" />Hide<span className="sr-only">{` ${what}`}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={reveal}
          aria-disabled={busy || !ws || undefined}
          aria-busy={busy || undefined}
          className={cn('inline-flex items-center gap-0.5 text-xs text-primary hover:not-aria-disabled:underline aria-disabled:opacity-50 aria-disabled:cursor-default', TARGET)}
        >
          <EyeIcon className="size-3" />{busy ? 'Revealing…' : 'Reveal'}<span className="sr-only">{` ${what}`}</span>
        </button>
      )}
      {/* Empty, it leaves the row (a flex item still counts its column gap). Never empty:hidden: a display:none live region is not announced. */}
      <span role="status" className="basis-full font-sans text-xs font-normal whitespace-normal text-muted-foreground empty:absolute">{reason}</span>
    </span>
  )
}
