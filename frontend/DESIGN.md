# Design System: Miraflores Workpaper (Review Desk)

**Status 2026-10-14: the header (section 11) is applied. Everything else here is still PROPOSED and not applied.** The proposed look
was previewed on a running build by injecting CSS in the browser; only the header files under `src/components/shell` changed.
After approval this file becomes the source of truth for UI work (CLAUDE.md should point here). Every number in section 2 was
computed (WCAG 2.x contrast, OKLCH chroma), not eyeballed.

## 1. Visual Theme & Atmosphere

A ledger-dense, ink-quiet instrument for people who compare numbers all day. Closest feeling: a well-lit audit workpaper with blue
pen corrections. Nothing decorative; colour appears only when it means something (a problem, a caution, a confirmation, a person's change).

- **Density 8, "Cockpit Dense".** Rows are 36 px or less, tables carry 6 to 9 columns, hints are inline.
- **Variance 3, "Predictable Symmetric".** Fixed columns, right-aligned figures, one split layout (list | detail). Reviewers scan
  columns; asymmetry costs scan speed. The stitch skill's default baseline (variance 8, motion 6, density 4) is deliberately inverted.
- **Motion 2, "Static Restrained".** Colour and opacity transitions of 120 to 160 ms. No perpetual loops: attention belongs to the numbers.

## 2. Color Palette & Roles

One neutral family (Zinc), one accent, four signal roles. No pure black, no purple, no neon, no gradients.

| Token (shadcn name) | Name | Light | Dark (defined, not reachable) | Role |
|---|---|---|---|---|
| `--background` | Canvas | `#FAFAFA` | `#09090B` | Page |
| `--card`, `--popover` | Surface | `#FFFFFF` | `#18181B` | Cards, menus, inputs |
| `--foreground` | Ink | `#18181B` | `#FAFAFA` | Body text |
| `--muted-foreground` | Quiet ink | `#52525B` | `#A1A1AA` | Secondary text, labels |
| `--muted`, `--secondary`, `--accent` | Wash | `#F4F4F5` | `#27272A` | Table heads, hover fill, neutral chips (shadcn's `--accent` is a hover fill, not the brand accent) |
| `--border` / `--input` | Hairline / Field edge | `#E4E4E7` / `#D4D4D8` | white 10% / 15% | 1 px structure |
| `--primary` (= info) | **Pen Blue**, the one accent | `#27467F` | `#9DB7E5` | Links, primary button, selection, focus, "a person changed this" |
| `--ring` | Ring Blue | `#4B6CA8` | `#6F8FC6` | Focus ring |
| `--danger` / soft / line | Problem | `#B42318` / `#FEE4E2` / `#FDA29B` | `#FDA29B` / `#2B1311` | Open errors, blocks filing |
| `--warning` / soft / line | Caution | `#93370D` / `#FEF0C7` / `#FEC84B` | `#FEC84B` / `#2B2008` | Stale, reopened, client-approval stage |
| `--success` / soft / line | Confirmed | `#05603A` / `#D1FADF` / `#75E0A7` | `#6CE9A6` / `#0C2A1B` | Verified, accepted, gates met |
| `--info` / soft / line | Person's act | `#27467F` / `#DDE6F4` / `#B8C7E0` | `#9DB7E5` / `#14203A` | Adjusted, needs partner, in-house stages |

Rules: signal colours carry meaning only and always come with a word or icon (never colour alone). Blue ink means "a person did or must
do something"; red and amber mean "the system or the data says so". The chart and sidebar tokens that shadcn ships are re-pointed to
this palette so no violet survives in unused tokens.

**Computed checks** (local script `analysis/contrast.py`, git-ignored with the rest of `analysis/`; run `python3 -I analysis/contrast.py`; all pass): ink on canvas 16.97:1; quiet ink on card 7.73:1 and on wash 7.03:1
(the current `#737373` on `#F5F5F5` is **4.35:1, an AA fail**); Pen Blue on card 9.26:1; white on Pen Blue 9.26:1; ring vs canvas
5.02:1; chips: danger 5.45:1, warning 6.62:1, success 6.73:1, info 7.36:1; faint support letter 4.57:1. Accent chroma 0.103 against
0.27 declared for the current violet; signal chroma 0.099 to 0.182 (neon is above 0.20).

## 3. Typography Rules

- **UI:** Geist. **Identifiers, refs, codes, hashes:** Geist Mono. Banned: Inter, serif faces anywhere in the app.
- **Why Geist replaces DM Sans (measured on the running app, 20 px):** DM Sans has no tabular figures, so `tabular-nums` does nothing:
  "11,111" is 34.8 px wide and "19,240" is 59.5 px. Geist gives 64.0 px for both. The app uses `tabular-nums` in 41 places.
- **Numbers:** money and counts use Geist tabular figures, right-aligned. The skill's "all numbers monospace at density above 7" is
  not followed for amounts: Geist Mono gives the comma a full cell (72 px for "19,240" against 64 px). Codes with digits stay mono.
- **Scale:** 11 px floor for metadata only (kbd hints, mono ids); 12 px captions and chips; 14 px body and table cells; 18 to 20 px
  page title, weight 600, tight tracking. Nothing below 11 px (today the D R C P T support letters are 10 px and `RefLink` is `0.9em`, about 10.8 px inside 12 px text).
Hierarchy by weight and colour, not size.
- Body line length stays at or under 65 characters in prose blocks (the Errors intro is capped for this).

## 4. Component Stylings

- **Buttons.** Radius 8 px (token `--radius: 0.5rem`, was 10). Primary = Pen Blue fill, white label. Secondary actions are the outline
  variant. 1 px press on active (already in base-nova). Pointer cursor on every enabled button (Tailwind v4 defaults buttons to the
  arrow). Disabled = 50% and the reason sits beside it (the app already prints `authorize()` reasons).
- **Chips.** 20 px high, soft fill + ink, no border. Mapping: Open = quiet outline pill with a red dot (so 70 open rows stop shouting);
  Blocks filing = danger; Stale, Reopened = warning; Verified, Accepted = success; Adjusted, Needs partner = info; Read OK, Unreviewed,
  Frozen, Not yet in file = neutral. Stage chips: preparation, review, partner = info; client approval, amending = warning; filed = success.
- **Cards.** Only for grouped forms (Filing, Firm). Lists use hairline dividers. Selected row = `primary/10` tint.
- **Inputs.** Label above, error below, 32 px high. Native `<select>` gets a caret and the same edge and focus ring as `Input`;
  checkboxes use `accent-color: primary`. One shared field class instead of three divergent strings.
- **Tables.** Header 12 px quiet ink on wash; body 14 px; figures tabular and right-aligned; hairline row dividers; wide tables scroll
  inside their own `overflow-x-auto` box, never the page.
- **Loading.** Skeletons matching the layout (exists). No spinners except inside a button that is busy.
- **Empty states.** Icon, one line, and how to fill it. The queue's right pane is the first screen's biggest empty area and gets one.
- **Errors.** Inline, beside the control, in the server's own words. Resolved findings keep full-contrast text (no `opacity-70`).

## 5. Layout Principles

Queue = two columns (list | claim pane) from `lg`, one column below. Trace = one reading column. Filing and Firm = two-column grids that
collapse to one under 768 px. One `<h1>` per page. Sticky top bar and sticky gate bar; full-height uses `svh`. No horizontal page scroll
at 390 px. Touch targets are 32 px on pointer devices; 44 px is not forced because rows are dense (documented trade-off for a
desktop review tool).

## 6. Motion & Interaction

150 ms ease-out on colour and opacity. Popovers use `tw-animate-css`. A single `prefers-reduced-motion: reduce` block collapses every
animation and transition. No springs, no parallax, no infinite loops. Keyboard model stays as built (j/k, Enter, Esc, x, a, v, n, u, /).

## 7. Anti-Patterns (Banned)

No emojis. No Inter. No serif. No `#000`. No violet, indigo or neon as an accent. No outer glow shadows. No gradient text. No custom
cursors. No more than one accent. No colour-only status. No text under 11 px. No `opacity-*` on text to show state. No spinner for page
loads. No `h-screen` or `100vh`. No marketing patterns (hero, centred CTA, equal feature cards). Skipped on purpose: the skill's hero,
inline-image headline, spring-physics and perpetual-micro-interaction rules (wrong product class).

## 8. Build mapping (Next.js 16, Tailwind v4, shadcn base-nova)

- `src/app/globals.css`: new `:root` and `.dark` values; add `--danger|warning|success|info` with `-soft` and `-line`, mapped in
  `@theme inline` to utilities (`text-danger`, `bg-danger-soft`, `border-danger-line`); `--destructive` = `--danger`; `--radius: 0.5rem`;
  base layer gains pointer cursor, `select` caret, checkbox accent, selection colour, tabular figures in tables; one reduced-motion block.
- `src/app/layout.tsx`: `Geist` replaces `DM_Sans` under the same `--font-sans` variable (Geist Mono stays).
- Replace raw palette classes (72 of the 78 lines, in 22 files; eight hues with `dark:` twins) by the signal utilities; hub files first
  (`atoms/status.tsx`, `shell/app-shell.tsx`). `doc/simulated-page.tsx` and the highlight in `doc/doc-page.tsx` stay literal: they paint paper.
- `components/ui/*` is not edited; the new tokens reach it. All changes are CSS or markup inside existing client components.
- Dark mode: tokens are defined but nothing sets `.dark` (no ThemeProvider), so it is out of scope.

## 9. Measured defects this resolves (dev build, 2026-10-14)

| Finding | Evidence | Fix |
|---|---|---|
| Violet primary on links, Go, nav, Next card | declared chroma 0.27 | Pen Blue (0.103) |
| `tabular-nums` is a no-op | 34.8 px vs 59.5 px for same-length amounts | Geist |
| Arrow cursor on every button | 168 of 168 on `/` | base-layer cursor rule |
| Quiet text on wash fails AA | 4.35:1 | `#52525B`, 7.03:1 |
| Eight chip hues plus `dark:` twins | 78 lines, 24 files | four signal roles |
| Text under 11 px | `/`: 680 elements, all the D R C P T letters at 10 px (625 of them faint `/40`). `/documents` 30 and `/errors` 70: all `RefLink` at `0.9em` = 10.8 px | `SupportLetters` to 11 px, faint to `/80` (4.57:1); `RefLink` to `text-[max(0.9em,11px)]`. Two components, not a hunt |
| No reduced-motion handling | 0 hits; 9 `animate-in`, 8 `animate-out`, pulse, spin | one media block |
| Horizontal scroll at 390 px | `/firm` +186 px (two sections with unwrapped tables); `/filing` +27 px (long mono ref link) | wrap tables, `min-w-0`, `break-all` on refs |
| No `<h1>` | `/` and `/client` | heading element |
| Resolved findings faded | `opacity-70` on the whole article | keep contrast, change border and chip |
| Native controls unstyled | 8 `<select>`, 3 checkboxes, 3 field class strings | base rule, one shared field class |

## 10. Decisions for the owner

1. **Accent hue.** Pen Blue is the default (no collision with red, amber, green; matches the brief's blue). To change it, edit
   `--primary`, `--info`, `--ring` only.
2. **Geist swap.** Recommended on the evidence in section 3. Reverting is one import in `layout.tsx`.
3. **Quiet "Open" pill.** Changes what the most common chip looks like; recommended, reversible in `atoms/status.tsx`.

## 11. Header (applied 2026-10-14)

Files: `shell/app-shell.tsx`, `season-clock.tsx`, `role-switcher.tsx`, `nav.tsx`, `command-palette.tsx`, `inbox.tsx`, `workspace/skeleton.tsx`.
It uses existing tokens only, so it follows the palette whenever section 2 is applied.

- **Height contract.** From `lg` up the header is one 48 px row plus the 36 px nav (85 px with the border). The queue's claim pane
  (`lg:top-21` in `queue/queue-screen.tsx`) assumes exactly this: change both together. Measured against the old build: 1440 px 85
  (same), 1024 px 103 to 85, 768 px 103 to 121 (three clean rows instead of a ragged wrap), 390 px 161 to 121.
- **Rows below `lg`.** Title with search, inbox and identity; then the stage pill with the season clock; then the nav. The skeleton
  mirrors that box so nothing shifts when the workspace loads.
- **Season clock.** One bordered chip: time, then a "Next: <event>" button that opens the confirm popover. "Move clock" writes a
  shared clock act, so it still asks first.
- **Identity.** Avatar initials, name and role, plus "no clearance" when the person has none. Below `sm` only the avatar shows and
  the text stays for screen readers; the accessible name carries the person and role.
- **Nav.** Workflow tabs on the left; Client view, Errors and About (the client portal and the hand-in pages) right of a divider.
  Hover cue, visible focus ring, and the current tab is centred on narrow screens with `scrollLeft`. Do not use `scrollIntoView`
  there: it moves the browser's sequential-focus starting point to that tab, so the first Tab press skips the skip link (found in testing).
- **Keyboard and touch.** The skip link is first in tab order and lands on `<main id="main" tabIndex={-1}>`. Below `lg` on coarse
  pointers the search, inbox and identity controls grow to 44 px; every header button has a pointer cursor.
