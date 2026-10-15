# Workpaper

A web-native tax workpaper. It treats a return as a **list of claims** and keeps an **append-only log of everything people do** to clear them. You can answer "who changed this, why, and what did it do to the tax?" by clicking, without hunting through a spreadsheet.

**Live demo: https://miraflores-workpaper-seven.vercel.app**

> All data is synthetic. The sample return (the Okafor-Lindqvist household, tax year 2025), the firm and its staff are invented. No real taxpayer information is used anywhere.

## The problem

A spreadsheet workpaper stores *results*. A reviewer needs *proof*: where a number came from, who checked it, which client message changed it, how it compares with last year, and what the partner actually signed. That proof is relational, and spreadsheets lose it.

Extraction pipelines make it worse: they are usually right and confidently wrong the rest of the time. A misread digit or a broker summary that doesn't foot looks exactly like a correct value until someone ties it to the page.

## The idea

- **Claims.** Anything that must be true for the return to be right is a claim: a number on a form (`F1040.26`), a household fact (a dependent's SSN), a document that must be accounted for (`D73`), a client answer (`qa-45`), an engine warning, a required firm step. Each keeps the pipeline's id, so URLs, notes, checks and sign-offs all point at the same thing.
- **Sealed evidence.** The pipeline's output packet is loaded exactly as produced, pinned by SHA-256, and never edited.
- **Acts.** Everything people do is one row in an append-only, hash-chained Postgres log. That covers verify, adjust, decide, note, reply, sign off, approve, file, reveal an SSN and the rest (17 validated kinds). A database trigger refuses updates and deletes, so undo is just another act.
- **One projection.** Every screen is computed by one pure function, `project(model, acts, viewer)`. The browser runs it for speed. The server runs the same code to enforce the firm's rules before it accepts an act.
- **Engine-free checks.** 38 checks in 12 families attach problems to claims: a read that isn't on its printed page, a broker summary that doesn't foot to its lots, a W-2 state split that ignores a mid-year move, an estimated payment the IRS transcript doesn't show, a swing from last year, a document that landed nowhere. The reviewer sees root problems first, largest money first, each with the one act that would clear it.
- **Sign-offs that reopen.** A sign-off fingerprints the values and evidence it covered, and it reopens itself when either changes. Nobody has to remember to uncheck a box.

The in-app [About](https://miraflores-workpaper-seven.vercel.app/about) page has the full data model.

## Try it in two minutes

The role switcher (top right) lists every staff member and both clients. It is a demo identity picker, not a login. The server still enforces the rules for whoever you pick.

1. **Queue** (as Priya Raman, preparer, the default). The Next card shows the biggest open problem and the act that clears it. Press <kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> to jump anywhere.
2. **Trace any number.** Every claim, document, act and finding has a URL under `/r/…`, for example [`/r/F1040.26`](https://miraflores-workpaper-seven.vercel.app/r/F1040.26). Keys <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> switch between Evidence, how the value was Built, and its History.
3. **Switch to Marcus Bell**, a preparer without data clearance. SSNs stay masked, but equality tags still show that `•••-••-3309 ≠ •••-••-3390`. Reveal is refused, and the refusal is logged.
4. **Compare** return versions, last year and what-ifs claim by claim, or see [what changed since you last looked](https://miraflores-workpaper-seven.vercel.app/compare?since=me).
5. **Filing** (as Helen Strand, partner) shows sign-offs, the partner desk, client approval, e-file, and the freeze and amendment that follow.
6. **Client view** is the household's own portal: questions, what's still needed, approve and sign.
7. **Errors** lists all 70 problems in the sample packet, the checks that catch each one and their live status. Problems no rule can decide are marked as reviewer judgment.

> **Want to make changes?** Switch to Jo Kimura (firm administrator) and choose **Firm › Fresh copy**. You get an empty log on the same packet, and the shared demo stays untouched.

## Rules the server enforces

These checks run inside the same transaction that writes the act, not just in the UI:

- **No self-review.** Reviewer, partner and quality sign-offs are refused for work the actor prepared, and that includes the packet's own history.
- **Partner over 1,000.** An adjustment with a federal or California effect over 1,000 needs a valid sign-off from a partner who didn't prepare it.
- **Blocking review notes.** Open review notes block the approval request and filing.
- **Exact-amount client approval.** Any change to an amount reopens the approval.
- **Masking.** Sensitive values are masked before they reach the browser. Reveals are logged before the value is returned, and refusals are logged too.
- **Freeze at filing.** After an accepted submission, value changes are refused until an amendment is opened.
- **Active dates and client scope.** Staff can't act before their start date on the season clock. Clients can only reply, attach and approve their own signature.

## What is simulated

| Area | Behaviour |
|---|---|
| Identity | Demo identity picker with a signed cookie. Role, clearance and active date are re-resolved on the server for every request. |
| E-file | Nothing is sent to the IRS or FTB. One disclosed rule stands in for the agency: if a dependent's SSN differs from the last accepted return, federal is rejected with the packet's own error code and California is held. |
| E-signature | Form 8879 approval is a 5-digit PIN per spouse, bound to a hash of the amounts. Not an IRS-compliant e-signature. |
| Notifications | In-app only: the inbox and the client portal. |
| Tax totals | The tax engine can't be re-run, so every total after a change is an estimate: change × the packet's tax-effect rates (or the engine's exact what-if where one exists). It warns when combined changes cross a threshold such as the SALT cap, the child-credit phase-out or AMT. |
| Time | A shared season clock starts at the packet's "now" and steps through the packet's own events. Documents, messages and agency letters appear when the clock reaches them. |

## Run it locally

Requires Node 20.9+, pnpm 11 (`corepack enable`) and Docker.

```bash
docker run -d --name workpaper-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=workpaper \
  -p 54329:5432 postgres:17-alpine

cd frontend
pnpm install
pnpm dev            # http://localhost:3000
```

No environment file is needed locally. The database URL and both secrets have development defaults, and the schema applies itself on first use.

| Command (from `frontend/`) | What it does |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm test` | 454 Vitest tests, most pinned against the real packet. Needs the Postgres container above. |
| `pnpm vitest run src/lib/model` | The model and check tests only, no database needed |
| `pnpm typecheck` / `pnpm lint` | `tsc --noEmit` / ESLint |

| Variable | Local | Production |
|---|---|---|
| `DATABASE_URL` | Defaults to `postgres://postgres:postgres@localhost:54329/workpaper` | Required |
| `IDENTITY_SECRET` | Dev default | Required (signs the identity cookie) |
| `MASK_SECRET` | Dev default | Required (keys the masking tokens) |

## How it's built

```
packet.json (sealed, sha-pinned)
  └─ server: maskPacket()       sensitive values → «ssn·3309·eq:Kq7xT2» equality tokens
       └─ buildModel(masked)    claims + engine-free checks → findings   (pure, src/lib/model/build.ts)
acts (Postgres, append-only, hash-chained)
  └─ project(model, acts, viewer) → State                                 (pure, src/lib/model/project.ts)
       ├─ browser: every screen reads State
       └─ server: authorize() + deriveFor() inside POST /api/acts
```

`POST /api/acts` does all of its work in one transaction under a per-engagement advisory lock. It validates with Zod, replays the log, authorizes each act (a refusal writes nothing), rejects stale edits with a 409, derives tax effects and fingerprints, extends the hash chain and inserts. The browser polls for new acts every 3 seconds.

**Stack:** Next.js 16 (App Router, Cache Components, React Compiler) · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui on Base UI · Zod 4 · PostgreSQL via `postgres` · Vitest · deployed on Vercel with Neon.

## Repository layout

```
data/                         the sample packet (synthetic)
frontend/
  data/                       byte-identical copy the app reads, pinned by SHA-256
  src/lib/model/              pure, isomorphic: claims, checks/, projection, authorize, tax effects
  src/lib/server/             Postgres act log, masking, reveal logging, simulated e-file
  src/db/schema.sql           acts table, append-only trigger
  src/app/(work)/             staff screens: queue, documents, records, compare, filing, firm, notice
  src/app/client/             client portal
  src/app/api/                acts, bootstrap, packet, reveal, identity, engagement
  src/components/             screen components and act forms
  ARCHITECTURE.md             module contract, API and the rules the server enforces
  DESIGN.md                   design system notes
```

Read [`frontend/ARCHITECTURE.md`](frontend/ARCHITECTURE.md) before you change the model or the API.

## Deploying

The app deploys to Vercel from `frontend/` (`vercel --prod`), with Postgres from the Neon integration. Set `IDENTITY_SECRET` and `MASK_SECRET` in the project. A server function only sees files listed under `outputFileTracingIncludes` in `frontend/next.config.ts`. The packet and `schema.sql` are listed there already; add any new file the server reads at runtime.
