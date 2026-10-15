// /about (hand-in #2): the core idea and data model, what is simulated, and how AI was used. Static.
import type { ReactNode } from 'react'
import Link from 'next/link'

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
  ['The human made the calls', 'The agents proposed, built and challenged each other; a person chose the design, the scope and what to cut.'],
]

const DIAGRAM = `packet.json  (sealed, sha256-pinned; the only copy of client data)
  │  server masks SSNs, bank numbers, IP PINs → tokens of kind · last 4 · equality tag
  │  (equal tags = equal values, so even an uncleared preparer can see •••3309 ≠ •••3390)
  ▼
buildModel(masked) → claims + findings from engine-free checks          pure TypeScript
  ▼
acts  (Postgres table, append-only by trigger, SHA-256 hash chain)
  ▼
project(model, acts, viewer) → State: status per claim, effective values, tax effects,
                                       open items, sign-off validity, gates, inbox, view log`

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export function AboutPage() {
  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-8 p-6 text-sm leading-relaxed">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">A return is a list of claims, and the workpaper clears them</h1>
        <p className="text-muted-foreground">
          How to read this workpaper in five minutes: the core idea, the data model, what is simulated, and how AI was used.
        </p>
      </header>

      <Section title="The idea">
        <p>A claim is anything that must be true for the return to be right:</p>
        <ul className="ml-5 list-disc">
          {CLAIM_EXAMPLES.map(([what, id]) => (
            <li key={id}>
              {what} (<code className="font-mono text-xs">{id}</code>)
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
          <strong>Every screen is computed from packet + log.</strong> One pure function, <code className="font-mono text-xs">project(model, acts, viewer)</code>,
          produces everything the screens need. The browser runs it for speed; the server runs the same code to enforce the firm&rsquo;s rules before
          an act is accepted. So &ldquo;who changed this, why, and what did it do to the tax?&rdquo;, &ldquo;what changed since I last looked?&rdquo; and
          &ldquo;what was signed?&rdquo; all have the same answer source.
        </p>
        <p>Engine-free checks attach problems to claims, for example:</p>
        <ul className="ml-5 list-disc">
          {CHECK_EXAMPLES.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p>The reviewer sees root problems first, largest money first, each with the one act that would clear it.</p>
        <p>
          <strong>Sign-offs fingerprint exactly what they covered,</strong> values and evidence together, and reopen themselves when either changes.
          Nobody unchecks a box.
        </p>
      </Section>

      <Section title="Why not a spreadsheet">
        <p>
          A spreadsheet stores <em>results</em>. The workpaper&rsquo;s job is to prove <em>why each result is right</em>, and that proof is relational: a
          number connects to its source page, to how it was built, to who checked it, to the client message that changed it, and to last year.
          Storing claims plus acts makes every one of those questions a lookup, not a document someone has to keep in sync.
        </p>
      </Section>

      <Section title="Data model">
        <pre className="overflow-x-auto rounded-lg bg-muted p-4 font-mono text-xs leading-snug" aria-label="Data flow from the sealed packet to the screens">
          {DIAGRAM}
        </pre>
        <p>
          <strong>acts</strong>: seq, id, engagement, recorded_at (wall clock), season_at (season clock), actor, actor_role, type, target, refs[], body,
          derived, batch_id, prev_hash, hash.
        </p>
        <ul className="ml-5 list-disc">
          <li>
            <code className="font-mono text-xs">type</code> is one of the Zod-validated act kinds.
          </li>
          <li>
            <code className="font-mono text-xs">target</code> and <code className="font-mono text-xs">refs</code> use the packet&rsquo;s own reference formats
            (ev-0498, D28, F8949.B.N1, qa-41, py:/…, agency:/…).
          </li>
          <li>
            <code className="font-mono text-xs">derived</code> is computed only by the server: tax effect, partner routing, fingerprints, approval hashes.
          </li>
        </ul>
        <p>Rules enforced on the server, in the same transaction that writes the act:</p>
        <ul className="ml-5 list-disc">
          {RULES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Section>

      <Section title="What is simulated">
        <dl className="grid gap-3">
          {SIMULATED.map(([what, how]) => (
            <div key={what} className="grid gap-0.5">
              <dt className="font-medium">{what}</dt>
              <dd className="text-muted-foreground">{how}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="How AI was used">
        <dl className="grid gap-3">
          {AI_USE.map(([what, how]) => (
            <div key={what} className="grid gap-0.5">
              <dt className="font-medium">{what}</dt>
              <dd className="text-muted-foreground">{how}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <footer className="flex flex-wrap gap-4 border-t pt-4 text-muted-foreground">
        <Link href="/errors" className="text-primary underline-offset-2 hover:underline">
          The errors found and how they surfaced
        </Link>
        <Link href="/filing" className="text-primary underline-offset-2 hover:underline">
          The filing desk
        </Link>
        <Link href="/" className="text-primary underline-offset-2 hover:underline">
          The queue
        </Link>
      </footer>
    </article>
  )
}
