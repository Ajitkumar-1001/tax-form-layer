# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A prototype for the "Redesign the Tax Workpaper" case study (Miraflores). The deliverable is a web app that loads one JSON "packet" **exactly as delivered**, persists everything users do, and has a role switcher. The packet is pipeline output only: it contains no reviews, notes, sign-offs or decisions — those are the app's job to design (change tracking with who/why/tax effect, version compare, what-ifs, review notes that block filing, sign-offs that reopen, enforced roles, freeze at filing, etc.).

The repo root (`..`) is the git repo; `frontend/` is the only app. Siblings:
- `../data/okafor_lindqvist_2025_packet.json` — the packet (~2 MB, 74 documents, ~3,000 extracted values, 3 return versions). Its `readme` key defines every field and the cross-reference id formats (`ev-NNNN`, `D01..D74`, `py:/…`, `doc:D12#page2`, line keys like `F1040.11`). **Never rewrite it.**
- `../analysis/oracle.py` — deterministic check of extracted values against printed page text. Run from the repo root: `python3 -I analysis/oracle.py data/okafor_lindqvist_2025_packet.json` (currently flags 17 of 3,012 values).
- `../analysis/error-hunt.json` — prior error-hunt output (`areas[]` with `findings`/`refuted`, plus `gaps`); `error-hunt.raw` is the same result wrapped in the multi-agent run's summary/logs.
- `../pdf-docs/` — the case-study brief PDF (page 1 is corrupt and yields no text; pages 2–3 extract with `pdftotext`).

## Commands

Run from `frontend/` with pnpm (`packageManager: pnpm@11.15.1`).

```bash
pnpm dev                    # next dev (http://localhost:3000)
pnpm build                  # next build
pnpm start                  # next start
pnpm lint                   # eslint (flat config: next core-web-vitals + typescript)
pnpm typecheck              # tsc --noEmit
pnpm test                   # vitest (needs the local Postgres for src/lib/server tests)
```

Don't run `pnpm build` while `pnpm dev` is running: both write `.next/` and it put dev into a reload loop. Stop dev first or build in a copy.

Tests live next to the code (`*.test.ts`) and most are pinned against the real packet. `LayoutProps<"/">` / `PageProps` are global types generated into `.next/types` by `next dev`/`next build`; if `tsc` can't find them, run one of those first.

## Next.js 16 — read the bundled docs first

`AGENTS.md` is authoritative: this Next.js has breaking changes versus training data, so read the relevant guide under `node_modules/next/dist/docs/01-app/` before writing routing, caching or data code. `next dev` rewrites the managed block in `AGENTS.md`; commit it rather than fighting it.

`next.config.ts` turns on several non-default features that shape how code must be written:
- **`cacheComponents: true` + `partialPrefetching: true`** — data access is dynamic by default and there is a prerendered static shell. Request-independent async I/O such as `await readFile()` inside a component counts as uncached data and must be inside `'use cache'` or behind `<Suspense>` (or hoisted to module scope / a memoized promise). Route state is preserved across navigation via `<Activity>`, so effects clean up when a route is hidden and UI state survives back-navigation. See `01-getting-started/08-caching.md`.
- **`reactCompiler: true`** — don't hand-write `useMemo`/`useCallback`/`memo` for performance.
- **`turbopack.rules`** routes `*.css` through `@tailwindcss/turbopack` (Tailwind v4: config lives in CSS — `@import "tailwindcss"` and `@theme inline` in `src/app/globals.css`; there is no `tailwind.config`).
- `experimental.agentFeedback` — enables the `AGENTS.md` feedback block mentioned above.

## Architecture

App Router under `src/app` (`@/*` → `src/*`): staff screens in `src/app/(work)/`, the client portal in `src/app/client/`, the API in `src/app/api/`. **`ARCHITECTURE.md` is the module contract** (owners, API, enforced rules); read it before changing the model.

**Data layer — `src/lib/packet.ts`** is the single entry point to the packet:
- `import 'server-only'`: server components / route handlers only. Client components receive slices as props.
- `loadPacket()` reads `frontend/data/okafor_lindqvist_2025_packet.json` (a byte-identical copy of `../data/…`, shipped to Vercel via `outputFileTracingIncludes`) relative to `process.cwd()`, refuses it unless its SHA-256 matches `PACKET_SHA256`, and memoizes it. The browser never gets the raw packet: `/api/packet` serves a masked copy (`src/lib/server/mask.ts`).
- The `Packet` interface tree hand-mirrors the packet README. Deliberately open-ended maps stay `Record<…>`/`unknown`. These types are unvalidated casts (`JSON.parse(s) as Packet`), so treat the data as untrusted-shape; the packet README says it contains confident mistakes (extracted values that disagree with `documents[].pages[].printed_content`, engine results that apply the wrong rule).
- Ground truth hierarchy: `printed_content` (what is actually on the page) > `extracted_values` (what the pipeline read; may be wrong) and `return_versions` (engine output; may be wrong). `return_versions[2]` (v3, 2026-06-23) is the current return. The engine can't be re-run: tax effect of a change = delta × `return_versions[].tax_effect_rates[category]`.

**Screens load through `AppLoader`** (`src/components/app-loader.tsx`, a client component). Route `page.tsx` files are thin server shells that render `<AppLoader screen="…" />`; each screen is a `next/dynamic` import with `ssr: false` and `PageSkeleton` as the loading state. Screens read the workspace and the URL in the browser, so nothing is prerendered for them and pages need no `<Suspense>`. To add a screen, add an entry to `SCREENS` (options must be an inline object literal) and render it from the page. What still uses `<Suspense>`: the shell parts in `app-shell.tsx` (plus one around the page as a guard, pinned by `provider.test.ts`) and the catch-all in `workspace/provider.tsx`.

Everything people do is an act in the Postgres `acts` table (append-only by trigger, hash-chained; `src/db/schema.sql`). Screens read `project(model, acts, viewer)` (`src/lib/model/project.ts`); the server enforces `authorize()` (`src/lib/model/authorize.ts`) inside `POST /api/acts`.

**UI** — shadcn `base-nova` style (`components.json`) built on **`@base-ui/react`, not Radix**; add components with `pnpm dlx shadcn add <name>` (output goes to `src/components/ui`, aliases `@/components`, `@/lib/utils`, `@/hooks`). Icons are `lucide-react`. Generated components import `cn` directly from the **`cn` npm package** (this shadcn version's registry dependency), and `src/lib/utils.ts` re-exports it for the `@/lib/utils` alias — do not swap in clsx + tailwind-merge. Dark mode is class-based (`.dark`).
