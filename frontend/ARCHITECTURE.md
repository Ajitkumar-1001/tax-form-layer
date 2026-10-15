# Workpaper architecture (contract for implementers)

**Core idea.** The return is a list of *claims*: every number on a form, every household fact, every document,
every client answer, every firm step. The packet is sealed evidence: it is loaded exactly as delivered and never
edited. Everything people do is one row in an append-only log of *acts*. Every screen is computed from
`packet + acts`, using one pure projection that runs in the browser for speed and on the server for enforcement.

```
packet.json (sealed, sha-pinned)
  └─ server: maskPacket()       sensitive values → «ssn·3309·eq:Kq7xT2» equality tokens
       └─ buildModel(masked)    claims + engine-free checks → findings   (pure, src/lib/model/build.ts)
acts (Postgres, append-only, hash-chained)
  └─ project(model, acts, viewer) → State                                 (pure, src/lib/model/project.ts)
       ├─ browser: every screen reads State
       └─ server: authorize() + deriveFor() inside POST /api/acts
```

## Files and owners (do not edit files you do not own; ask instead)

| Area | Files |
|---|---|
| Contracts (main loop, frozen) | `src/lib/model/{packet-types,ids,claims,effects,hash,mask-token,acts,state,build,viewer}.ts`, `src/lib/model/checks/{types,index}.ts`, `src/db/schema.sql` |
| Checks C1 | `src/lib/model/checks/{printed-vs-extracted,sum-vs-detail,duplicates,coverage}.ts` |
| Checks C2 | `src/lib/model/checks/{cross-document,agency,client-answers,swings}.ts` |
| Checks C3 | `src/lib/model/checks/{carryovers,recompute,state-sourcing,process}.ts` |
| Projection P | `src/lib/model/{project,authorize,derive}.ts` (+ `*.test.ts` next to them) |
| Server S | `src/lib/server/*`, `src/app/api/**` |
| UI | `src/app/(work)/**`, `src/app/client/**`, `src/components/**` (split per agent in the prompt) |

## Server API (owner S)

| Route | Behaviour |
|---|---|
| `GET /api/bootstrap` | `{ engagement, viewer, identities, packetSha }`. Identity from the signed `wp_actor` cookie (default st-01); engagement from the `wp_eng` cookie (default `main`). |
| `GET /api/packet` | The **masked** packet JSON (same for every viewer; long-cache by sha). |
| `GET /api/acts?engagement=&after=<seq>` | `{ acts: Act[], head }`. The client polls every 3 s. |
| `POST /api/acts` | Body `PostActs`. One transaction: Zod-validate → `pg_advisory_xact_lock(engagement)` → load acts → `project` → for each act `authorize` (refusal = 403 `{reason}` and nothing written) → 409 if a value-changing act on the same target landed after `base_seq` → `deriveFor` → hash-chain → insert. A `file{submit}` also inserts the simulated `agency_result` acts (actor `system`). Returns `{ acts: Act[] }`. |
| `POST /api/reveal` | `{ engagement, token, context }`. Authorize (cleared staff only; `st-04` refused), insert a `view_sensitive` act **first** (with `denied` if refused), then return `{ value }` or 403. |
| `POST /api/identity` | `{ actor }` → sets `wp_actor` (HMAC-signed). Demo identity picker, not authentication. |
| `POST /api/engagement` | `{ fresh: true }` → new engagement id with an empty log (admin "fresh copy"); or `{ id }` to switch. |

Environment: `DATABASE_URL` (Postgres; local `postgres://postgres:postgres@localhost:54329/workpaper`),
`IDENTITY_SECRET`, `MASK_SECRET` (dev defaults allowed, production must set them).

## Rules that must be enforced on the server (authorize)

- **No self-review.** Reviewer, partner and quality sign-offs, reviewer-level verify, and accept are refused when the actor is in `preparedBy` of anything in scope. That includes packet timeline actors: `Sch3.10` is prepared by st-02 (extension 2026-04-14).
- **Partner over 1,000.** An adjust with |fed| or |ca| effect over 1,000 sets `needs_partner`. The gates refuse until a *valid* partner sign-off covers it, from a partner who did not prepare it.
- **Blocking review notes** that are open block `request_approval` and `file`.
- **Masking.** Masking happens before transport. Reveals are logged before they are returned, and refusals are logged too. st-04 has no clearance.
- **Freeze.** After an accepted `file{submit}` for a jurisdiction, value acts on it are refused until `amend_open`.
- **Active dates.** An actor is refused before `active_from` relative to the season clock (st-06 is active from 2027-01-04).
- **Clients** may only `reply`, `attach` (to questions addressed to them) and `client_approve` (their own signature).
- **Judgment calls** carry an authority (Zod requires it).

## UI conventions

- shadcn base-nova on **@base-ui/react** (not Radix). Components are already in `src/components/ui`. Icons come from lucide-react. Use the `cn` package (via `@/lib/utils`).
- Every claim, document, act and finding has a URL: `/r/<ref>`, where ref is URI-encoded (e.g. `/r/F8949.B.N1`, `/r/D28`, `/r/household%3Atheo%23ssn`).
- Money is right-aligned in tabular-nums. Masked tokens render via `splitMasked`/`displayMasked`, with a Reveal button.
- Disabled actions say why, using `authorize()` reasons.
- No `useMemo`/`useCallback` (the React compiler is on). Client components read `useWorkspace()` (see `src/components/workspace`).
