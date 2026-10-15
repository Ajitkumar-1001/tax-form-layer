# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

The hand-in for the Miraflores "Redesign the Tax Workpaper" case study: a web-native workpaper for the (invented) Okafor-Lindqvist 2025 return, deployed at https://miraflores-workpaper-seven.vercel.app. `README.md` maps the four hand-in items (app, one-page core idea, errors list, video — the video link is still a placeholder).

**`frontend/` is the only app, and `frontend/CLAUDE.md` is the detailed guide for it** (Next.js 16 quirks, commands, packet loader, UI stack). `frontend/ARCHITECTURE.md` is the module contract and lists the rules the server enforces. Read both before changing the model or API; this file only covers what sits above `frontend/`.

## Repo layout

- `data/okafor_lindqvist_2025_packet.json` — the packet as delivered. `frontend/data/` holds a byte-identical copy that the app reads, pinned by `PACKET_SHA256` in `frontend/src/lib/packet.ts`. Never edit either; if you ever must replace it, both copies and the constant change together (the loader throws on a sha mismatch).
- `analysis/` — working files from the error hunt: `oracle.py` (printed-vs-extracted check), `error-hunt.json` / `synthesis.json` (agent findings; `synthesis.json` feeds the generated errors map), `spec.md`, `contrast.py` (WCAG check for the palette).
- `docs/` — hand-in write-ups (`core-idea.md`, `errors.md`, `video-script.md`) and `superpowers/{specs,plans}/` (design spec, build plan, dashboard brief). The app mirrors the first two at `/about` and `/errors`, so keep them in sync.
- `pdf-docs/` — the brief PDF. Its page 1 is corrupt (renders blank; `pdftotext` returns only flate-stream errors for it, while pages 2–3 extract fine), so the Evidence/Calculation requirements on page 1 come from the task text, not the PDF. The hand-in is supposed to say so.
- `.agents/`, `.claude/`, `.gstack/`, `skills/`, `graphify-out/` (and `frontend/.agents/`, `frontend/.claude/`, `frontend/skills-lock.json` from the Neon CLI) — tool-managed (skills, browse daemon state, knowledge graph). Not project code; ignore them.

## Git state

`main` has no commits yet. The root `.gitignore` only lists `skills-lock.json`, but `analysis/`, `docs/`, `.agents/`, `.claude/`, `.gstack/`, `skills/` and `graphify-out/` each carry their own `.gitignore` containing `*`, so **everything in `docs/` and `analysis/` is untracked and git-ignored** — including the hand-in write-ups the README links to. Check this before committing or pushing (`git check-ignore -v <path>`).

## Commands

From the repo root:

```bash
python3 -I analysis/oracle.py data/okafor_lindqvist_2025_packet.json   # flags values that don't match the printed page (17 of 3,012)
```

Local Postgres (needed for `pnpm dev` and the integration tests in `src/lib/server/db.test.ts` and `src/app/api/acts/route.test.ts`; the schema applies itself on first use):

```bash
docker run -d --name miraflores-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=workpaper -p 54329:5432 postgres:17-alpine
```

From `frontend/` (pnpm): `pnpm dev | build | lint | typecheck | test`. Run one test file or case with `pnpm vitest run src/lib/model/checks/swings.test.ts` / `pnpm vitest run -t "<name>"`. Env vars: `DATABASE_URL` (defaults to the docker URL above), `IDENTITY_SECRET`, `MASK_SECRET` (dev defaults allowed; production must set them).

Regenerate the hand-in errors map after changing `analysis/synthesis.json` (the output is bundled for the browser and masks dashed SSNs; never hand-edit `src/lib/errors-map.ts`):

```bash
cd frontend && node scripts/gen-errors-map.mjs ../analysis/synthesis.json src/lib/errors-map.ts
```

## Deploy

Vercel project `miraflores-workpaper`, linked from `frontend/` (`vercel.json`, `.vercelignore`; deploy with `vercel --prod` from there). The Neon Marketplace integration supplies `DATABASE_URL`; `IDENTITY_SECRET` and `MASK_SECRET` are set in Vercel. A server function only sees files listed in `outputFileTracingIncludes` in `frontend/next.config.ts` (the packet copy and `src/db/schema.sql` are), so any new file read from disk at runtime must be added there or it is missing in production. The production `main` engagement is kept clean for graders: test writes in a Fresh copy.

## Architecture in one pass

The packet is sealed evidence. Everything a person does is an append-only, hash-chained row in the Postgres `acts` table (a trigger refuses update/delete/truncate, so undo is a new act). `src/lib/model/` is pure and isomorphic: `buildModel(maskedPacket)` derives claims and runs the engine-free checks (`checks/`, one file per check family, each with a `.test.ts` pinned against the real packet), and `project(model, acts, viewer)` turns packet + log into all screen state. The same code runs in the browser for speed and in `POST /api/acts` for enforcement (`authorize()` + `deriveFor()` inside one transaction under a per-engagement advisory lock). Sensitive values are masked before transport into equality tokens, so checks can compare SSNs without seeing them; reveals are logged before they are returned.

Non-obvious constraints that cut across files:
- **Ground truth order:** printed page text > `extracted_values` > `return_versions`. The packet is seeded with high-confidence mistakes; the engine can't be rerun, so a tax effect is the change × `tax_effect_rates` (or a `what_if` result).
- **The role switcher is a demo identity picker, not authentication.** The server still enforces the firm's rules for whichever identity is selected, so keep new permission logic in `authorize()`, never only in the UI.
- **Season clock:** acts record both wall-clock `recorded_at` and a replayable `season_at`; actors are refused before their `active_from` date relative to the season clock.
- Admin → Firm › Fresh copy starts a new engagement id with an empty log on the same packet (the `wp_eng` cookie).

## UI design status

`frontend/DESIGN.md` (the "Review Desk" design system): only the header (its section 11, `src/components/shell`) is applied; the rest is still PROPOSED. Check its status line before treating it as the source of truth for styling.
