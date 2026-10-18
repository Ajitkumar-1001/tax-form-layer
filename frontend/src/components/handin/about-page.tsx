'use client'
// /about (hand-in #2): the core idea and data model, what is simulated, and how AI was used. The copy mirrors docs/core-idea.md.
// A client page (AppLoader already loads it with ssr: false). Its background effects live in components/effects and load
// after the text through next/dynamic with ssr: false; the foreground pieces (cards, ticker, ribbon) are in components/ui.
import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { ChainBeam, HeroBackdrop, ModelBackdrop } from '@/components/effects/about-effects'
import { TourLink } from '@/components/tour/tour-link'
import { MagicCard } from '@/components/ui/magic-card'
import { Marquee } from '@/components/ui/marquee'
import { NumberTicker } from '@/components/ui/number-ticker'
import { ChainDemo } from './chain-demo'

// The packet in four numbers, each checked against its source: 74 documents and 3,012 extracted values (the packet itself),
// the 17 of those that fail analysis/oracle.py's printed-page check, and the 70 distinct issues left after merging duplicates
// and dropping 6 (docs/errors.md).
const STATS: [number, string][] = [
  [74, 'documents in the packet'],
  [3012, 'extracted values read'],
  [17, 'values that fail the printed-page check'],
  [70, 'distinct issues found'],
]

// Ids that scroll past in the ribbon; every one is quoted in the copy below.
const RIBBON = ['F1040.26', 'D73', 'qa-45', 'ev-0498', 'D28', 'F8949.B.N1', 'qa-41', 'step:7', 'diag:FBAR_OUTSIDE_RETURN', 'R0000-504-02']

const CLAIM_EXAMPLES: [string, string][] = [
  ['a number on a form', 'F1040.26'],
  ['a household fact', "Theo's SSN"],
  ['a document that must be accounted for', 'D73'],
  ['a client answer', 'qa-45'],
  ['an engine warning', 'diag:FBAR_OUTSIDE_RETURN'],
  ["one of the firm's twelve required steps", 'step:7'],
]

const CHECK_EXAMPLES = [
  "a read that isn't on its printed page",
  "a broker summary that doesn't foot to its lots",
  'a W-2 state split that ignores the move date',
  "an estimated payment the IRS transcript doesn't show",
  'a swing from last year',
  'a document that landed nowhere',
]

const RULES = [
  'no one reviews work they prepared, including packet history (the reviewer filed the extension)',
  'adjustments over 1,000 need a valid partner sign-off',
  'open review notes block approval and filing',
  'the client approves exact amounts, and any amount change reopens approval',
  'masked data is logged before it is revealed, and refusals are logged too',
  'filing freezes the return, and changes after that are amendments layered on top',
]

const SIMULATED: [string, string][] = [
  ['Identity', 'The role switcher is a demo identity picker, not authentication. It sets a signed cookie; the server re-resolves role, clearance and active date on every request and enforces the rules for whoever is selected.'],
  ['E-file transmission and agency responses', 'Nothing is sent to the IRS or FTB. One disclosed rule stands in for the e-file database: if a dependent’s effective SSN differs from the SSN on the last accepted return, federal is rejected with the packet’s own error (R0000-504-02) and California is held; otherwise both are accepted. The rule reads data, not our finding status, so an override cannot fool it.'],
  ['E-signature', 'Form 8879 approval is a 5-digit PIN typed by each spouse in the client portal. It binds to the amounts hash at the time of the request; it is not an IRS-compliant e-signature.'],
  ['Notifications', 'In-app only: the inbox and the client portal. No email or SMS is sent.'],
  ['Record destruction', 'Accepted filings record a retain-until date (filing + 7 years). Destruction is not implemented.'],
  ['Totals', 'The engine cannot be re-run. Every total after a change is a linear estimate: change × the packet’s v3 tax_effect_rates (or the exact what_if result where one exists), with a warning when combined changes cross an engine threshold (SALT cap, child-credit phase-out, AMT).'],
  ['Time', 'The season clock starts at the packet’s “now” (v3, 2026-06-23) and steps forward through the packet’s own events. Documents, messages and agency records after it appear when the clock reaches them, as packet facts, never as our acts.'],
]

const AI_USE: [string, string][] = [
  ['Error hunt', 'A deterministic script compared all 3,012 extracted values with their printed pages. Then ten analyst agents, one per return area, traced every document, answer, agency record and line; a second agent per area tried to refute each finding, and a completeness critic hunted for gaps. 70 issues survived; 6 were dropped.'],
  ['Design', 'A panel of design agents proposed competing concepts; judge agents scored them against the brief, and the winning concept was revised into the spec.'],
  ['Build', 'Parallel build agents each owned a slice of files behind frozen contracts (model, projection, server, screens), with reviewer agents checking each slice.'],
  ['Checks are tested, not trusted', 'Every engine-free check is pinned by tests that run it against the real packet and assert the findings it must raise.'],
  ['The human made the calls', 'Built with Claude Code. The agents proposed, built and challenged each other; a person chose the design, the scope and what to cut.'],
]

const FLOW: [string, string][] = [
  ['The packet', 'Sealed and SHA-256 pinned: the only copy of client data. The server masks SSNs, bank numbers and IP PINs into tokens of kind, last four and an equality tag, so even an uncleared preparer can see •••3309 and •••3390 differ.'],
  ['Claims', 'buildModel turns the masked packet into claims and runs the engine-free checks on them. Pure TypeScript, the same in the browser and on the server.'],
  ['Acts', 'A Postgres table, append-only by trigger, each row hash-chained to the one before it. Undo is another row.'],
  ['Screens', 'project(model, acts, viewer) computes the status of every claim, effective values, tax effects, open items, sign-off validity, gates, the inbox and the view log.'],
]

/** Position in the entrance: each part rises 70 ms after the one before (the .rise class in globals.css). */
const at = (i: number) => ({ '--i': i }) as CSSProperties

const Code = ({ children }: { children: ReactNode }) => <code className="font-mono text-[0.9em]">{children}</code>

/** A heading on the left that stays in view while its text runs on the right. */
function Chapter({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16">
      <h2 className="text-3xl font-semibold tracking-tight lg:sticky lg:top-8 lg:self-start lg:text-4xl">{title}</h2>
      <div className="flex max-w-2xl flex-col gap-5 text-base leading-relaxed">{children}</div>
    </section>
  )
}

function Terms({ items }: { items: [string, string][] }) {
  return (
    <dl className="grid gap-x-16 gap-y-10 lg:grid-cols-2">
      {items.map(([what, how]) => (
        <div key={what} className="flex flex-col gap-2">
          <dt className="text-xl font-semibold">{what}</dt>
          <dd className="text-base leading-relaxed">{how}</dd>
        </div>
      ))}
    </dl>
  )
}

export function AboutPage() {
  return (
    <div className="relative isolate">
      <HeroBackdrop />
      <article className="mx-auto flex max-w-6xl flex-col gap-20 px-4 pt-8 pb-24 sm:px-6 lg:gap-28 lg:pt-16">
        <header className="grid items-start gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
          <div className="flex flex-col gap-6">
            <h1 style={at(0)} className="rise text-5xl leading-none font-semibold tracking-tight text-balance sm:text-6xl xl:text-8xl">
              Every number has a proof.
            </h1>
            <p style={at(1)} className="rise max-w-xl text-2xl">
              A return is a list of claims, and the workpaper clears them.
            </p>
            <p style={at(2)} className="rise max-w-xl text-base">
              How to read this workpaper in five minutes: the core idea, the data model, what is simulated, and how AI was used.
            </p>
            <div style={at(3)} className="rise">
              <TourLink />
            </div>
          </div>
          <div style={at(3)} className="rise relative">
            <ChainDemo />
            <ChainBeam />
          </div>
        </header>

        <div className="-mt-8 flex flex-col gap-8 lg:-mt-14">
          <dl aria-label="The packet in numbers" className="grid grid-cols-2 gap-px border border-foreground/15 bg-foreground/15 lg:grid-cols-4">
            {STATS.map(([n, what]) => (
              <div key={what} className="flex flex-col gap-2 bg-background p-5 sm:p-6">
                <dt className="order-2 text-base">{what}</dt>
                <dd className="order-1 font-mono text-4xl leading-none font-medium sm:text-5xl">
                  <span aria-hidden="true">
                    <NumberTicker value={n} />
                  </span>
                  <span className="sr-only">{n.toLocaleString('en-US')}</span>
                </dd>
              </div>
            ))}
          </dl>
          <Marquee aria-hidden="true" pauseOnHover className="[mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)] motion-reduce:[mask-image:none]">
            {RIBBON.map((id) => (
              <code key={id} className="shrink-0 bg-foreground/[0.05] px-3 py-1.5 font-mono text-sm">
                {id}
              </code>
            ))}
          </Marquee>
        </div>

        <Chapter title="The idea">
          <p>A claim is anything that must be true for the return to be right:</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {CLAIM_EXAMPLES.map(([what, id]) => (
              <li key={id} className="min-w-0">
                <MagicCard className="h-full">
                  <div className="flex min-w-0 flex-col gap-1 p-4">
                    <code className="font-mono text-xl font-medium break-all sm:text-2xl">{id}</code>
                    <span className="text-base">{what}</span>
                  </div>
                </MagicCard>
              </li>
            ))}
          </ul>
          <p>Every claim keeps the id the pipeline gave it, so a URL, a note, a check result and a sign-off all point at the same thing.</p>
          <p>
            <strong>The packet is sealed evidence.</strong> It is loaded exactly as delivered, pinned by its SHA-256, and never edited.
          </p>
          <p>
            <strong>Everything people do is one row in an append-only log of acts:</strong> verify, adjust, decide, dispose, note, ask, reply, attach,
            sign off, approve, file, reveal an SSN. Rows are never edited or deleted (a database trigger refuses), and undo is just another row.
            Each row is hash-chained to the one before it.
          </p>
          <p>
            <strong>Every screen is computed from packet + log.</strong> One pure function, <Code>project(model, acts, viewer)</Code>, produces everything
            the screens need. The browser runs it for speed; the server runs the same code to enforce the firm&rsquo;s rules before an act is accepted.
            So &ldquo;who changed this, why, and what did it do to the tax?&rdquo;, &ldquo;what changed since I last looked?&rdquo; and &ldquo;what was
            signed?&rdquo; all have the same answer source.
          </p>
          <p>Engine-free checks attach problems to claims, for example:</p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {CHECK_EXAMPLES.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p>The reviewer sees root problems first, largest money first, each with the one act that would clear it.</p>
          <p>
            <strong>Sign-offs fingerprint exactly what they covered,</strong> values and evidence together, and reopen themselves when either changes.
            Nobody unchecks a box.
          </p>
        </Chapter>

        <Chapter title="Why not a spreadsheet">
          <p className="text-xl leading-snug">
            A spreadsheet stores <em>results</em>. The workpaper&rsquo;s job is to prove <em>why each result is right</em>.
          </p>
          <p>
            That proof is relational: a number connects to its source page, to how it was built, to who checked it, to the client message that changed
            it, and to last year. Storing claims plus acts makes every one of those questions a lookup, not a document someone has to keep in sync.
          </p>
        </Chapter>

        <section className="relative isolate flex flex-col gap-10 overflow-hidden bg-foreground p-6 text-background sm:p-10 lg:p-16" aria-labelledby="flow-h">
          <ModelBackdrop />
          <h2 id="flow-h" className="text-3xl font-semibold tracking-tight lg:text-4xl">
            Data model
          </h2>
          <ol className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {FLOW.map(([title, text], i) => (
              <li key={title} className="flex flex-col gap-3">
                <span aria-hidden className="text-6xl leading-none font-semibold tabular-nums">
                  {i + 1}
                </span>
                <h3 className="text-xl font-semibold">{title}</h3>
                <p className="text-base leading-relaxed">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <Chapter title="What is stored, and what is enforced">
          <p>
            <strong>acts</strong>: seq, id, engagement, recorded_at (wall clock), season_at (season clock), actor, actor_role, type, target, refs[], body,
            derived, batch_id, prev_hash, hash.
          </p>
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            <li>
              <Code>type</Code> is one of the Zod-validated act kinds.
            </li>
            <li>
              <Code>target</Code> and <Code>refs</Code> use the packet&rsquo;s own reference formats (ev-0498, D28, F8949.B.N1, qa-41, py:/…, agency:/…).
            </li>
            <li>
              <Code>derived</Code> is computed only by the server: tax effect, partner routing, fingerprints, approval hashes.
            </li>
          </ul>
          <p>Rules enforced on the server, in the same transaction that writes the act:</p>
          <ol className="flex flex-col gap-px">
            {RULES.map((r, i) => (
              <li key={r} className="flex gap-4 bg-foreground/[0.05] p-4">
                <span aria-hidden className="w-6 shrink-0 text-xl font-semibold tabular-nums">
                  {i + 1}
                </span>
                <span>{r}</span>
              </li>
            ))}
          </ol>
        </Chapter>

        <section className="flex flex-col gap-8">
          <h2 className="text-3xl font-semibold tracking-tight lg:text-4xl">What is simulated</h2>
          <Terms items={SIMULATED} />
        </section>

        <section className="flex flex-col gap-8">
          <h2 className="text-3xl font-semibold tracking-tight lg:text-4xl">How AI was used</h2>
          <Terms items={AI_USE} />
        </section>

        <footer className="flex flex-wrap gap-x-8 gap-y-3 text-lg">
          <Link href="/errors" className="underline underline-offset-4 hover:text-primary">
            The errors found and how they surfaced
          </Link>
          <Link href="/filing" className="underline underline-offset-4 hover:text-primary">
            The filing desk
          </Link>
          <Link href="/queue" className="underline underline-offset-4 hover:text-primary">
            The queue
          </Link>
        </footer>
      </article>
    </div>
  )
}
