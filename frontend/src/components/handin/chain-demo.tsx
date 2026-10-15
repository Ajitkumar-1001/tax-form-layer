'use client'
// The About page's live thing: three example acts chained by SHA-256, hashed in the browser. Edit one and every row after
// it stops matching, the way the hash chain in the acts table makes a changed past visible. The head and packet hash
// underneath are the workspace's real ones.
import { useRef, useState } from 'react'
import { RotateCcwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/components/workspace/context'
import { cn } from '@/lib/utils'

// Hashes of these rows as written (sha256(previous hash + "\n" + text), starting from "genesis"), so the page reads
// correctly before any script has run.
const ROWS: [string, string][] = [
  ['verify F1040.26 · agreed to source document D12', '74e7af8bea9338671cf20bdb4107dbdbe2293ce4cd9413888636084694aeb79c'],
  ['adjust SchC.1 to 151,300 · Paywell 1099-K is inside the Atlas deposits', '8d48f6c5559c7bef57a72736893e6039c6e1b3882ec2be11ebcd9b7ac0d97438'],
  ['sign off · partner · adjustment over 1,000', 'bb30618b634631ce55a0c2429988b5ac3b560f178b00cd0ac485ae14de98fe63'],
]
const ORIGINAL = ROWS.map(([text]) => text)

async function chain(texts: string[]): Promise<string[]> {
  const out: string[] = []
  let prev = 'genesis'
  for (const t of texts) {
    const bytes = new TextEncoder().encode(`${prev}\n${t}`)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    prev = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
    out.push(prev)
  }
  return out
}

export function ChainDemo() {
  const { state, packetSha } = useWorkspace()
  const [texts, setTexts] = useState(ORIGINAL)
  const [hashes, setHashes] = useState(ROWS.map(([, h]) => h))
  const latest = useRef(0)

  const set = (next: string[]) => {
    const id = ++latest.current
    setTexts(next)
    // Latest edit wins if hashing finishes out of order.
    void chain(next).then((h) => id === latest.current && setHashes(h))
  }
  const edited = texts.some((t, i) => t !== ORIGINAL[i])

  return (
    <div className="flex flex-col gap-5 bg-foreground/[0.05] p-5 sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-2xl font-semibold">Try to change the past</h2>
        <Button variant="outline" size="sm" disabled={!edited} onClick={() => set(ORIGINAL)}>
          <RotateCcwIcon /> Restore
        </Button>
      </div>
      <p className="max-w-md text-base">Edit any act below. Each one carries a hash of the act before it, so a change shows in every act after it.</p>
      <ol className="flex flex-col gap-3">
        {texts.map((text, i) => {
          const ok = hashes[i] === ROWS[i][1]
          return (
            <li key={i} className={cn('flex flex-col gap-2 p-4 transition-colors duration-300 motion-reduce:transition-none', ok ? 'bg-background' : 'bg-danger-soft')}>
              <label className="flex flex-col gap-1 text-sm">
                <span>Act {i + 1}</span>
                <textarea
                  rows={2}
                  value={text}
                  onChange={(e) => set(texts.map((t, j) => (j === i ? e.target.value : t)))}
                  className="w-full resize-none bg-transparent text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                />
              </label>
              <p className="flex flex-wrap items-center gap-x-3 text-sm">
                <code className="font-mono tabular-nums">{hashes[i].slice(0, 16)}</code>
                <span className={cn('font-medium', ok ? 'text-success' : 'text-danger')}>{ok ? 'Chain intact' : 'Chain broken'}</span>
              </p>
            </li>
          )
        })}
      </ol>
      <p role="status" className="sr-only">
        {edited ? 'An act was changed: the acts from there on no longer match.' : 'All acts match their hashes.'}
      </p>
      <p className="text-sm">
        This workpaper&rsquo;s log is at act <span className="font-semibold tabular-nums">#{state.head}</span>; the packet it reads is sealed as{' '}
        <code className="font-mono">{packetSha.slice(0, 12)}</code>.
      </p>
    </div>
  )
}
