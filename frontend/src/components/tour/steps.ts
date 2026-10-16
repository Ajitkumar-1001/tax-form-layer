// The tour's script (docs/superpowers/specs/2026-10-15-guided-tour-design.md, section 2): one typed list and no React, so the
// copy can be checked by tests and edited without touching the engine. Copy rules: two or three plain sentences; nothing
// that depends on the engagement's log (dollar amounts, counts of open items, act numbers); stable ids and refs only; never
// the word "click" (the tour only looks).

/** Kill switch: false removes the tour from the page. Nothing else changes, because the tour writes nothing. */
export const TOUR_ENABLED = true

/** The closing card's id in the stored state: it is a card, not a stop. */
export const END = 'end'

export interface TourStep {
  /** Stable key kept in localStorage: never renumber or reuse one. */
  id: string
  title: string
  body: string
  /** Where the stop happens: a staff route, with its query when the query matters. */
  href: string
  /** CSS selector of what to ring: `[attr="value"]`, `[attr="value"] > summary`, `section[attr="value"]` or `#id`, or a comma-separated list of them (the
   *  first visible match in the page is rung). Only a VISIBLE match counts (earlier pages stay mounted, hidden), and only on
   *  this stop's own page. Absent, or never found: the card shows without a ring. Never a control that writes (Reveal, Save,
   *  Accept, Dispose, Move clock): the ring is a picture, and a ring invites a click. */
  anchor?: string
  /** A link inside the card for a closer look. */
  more?: { label: string; href: string }
}

export const STEPS: readonly TourStep[] = [
  {
    id: 'idea',
    title: 'Every number can show its proof',
    body: 'A return here is a list of claims, and everything people do to clear them is an act in a log nobody can rewrite. Edit a past act in this demo and every later hash breaks, so tampering shows.',
    href: '/about',
    anchor: '[data-tour="chain-demo"]',
  },
  {
    id: 'standing',
    title: 'One screen says where the return stands',
    body: "Start with 'Where we are': how far the return is. The rest shows what blocks filing and who acts, where the money is at stake, and your next step. The role switcher (top right) is a demo picker, not a login, and changes whose next step you see. Dollar effects are estimates.",
    href: '/overview',
    anchor: '#ov-where',
  },
  {
    id: 'checks',
    title: 'The checks already ran',
    body: 'Most problems are found for you. Checks run on load and attach findings to the claims they affect, and the queue sorts them by consequence, filing blockers first, then by money at stake.',
    href: '/queue',
    // The group's header row, not the whole group: a group can be taller than the window.
    anchor: '[data-tour="queue-group"] > summary',
    more: { label: 'See what it caught', href: '/r/F8949.B.N1' },
  },
  {
    id: 'proof',
    title: 'Proof sits beside the number',
    body: 'Open any number to see its Evidence, how it was Built, and its History. Here a broker\'s "not reported" was stored as zero, and the document with the real figure sits beside it.',
    href: '/r/F8949.B.N1',
    anchor: '[data-tour="claim-tabs"]',
  },
  {
    id: 'evidence',
    title: 'A document no number came from',
    body: 'Every document should land on a line or say why not. The paystub D73 is marked used, yet no number came from it. It holds the California-period wages, so the whole-year W-2 figure overstates California wages.',
    href: '/documents?unlanded=1',
    anchor: '[data-tour="unlanded"]',
    more: { label: 'Open D73', href: '/r/D73' },
  },
  {
    id: 'sensitive',
    title: 'Sensitive values are masked but comparable',
    body: "The organizer's SSN ends in 3309 and the 2024 return's in 3390, so even a preparer without clearance (Marcus Bell) can spot the mismatch. Reveal is logged, even when refused, so this tour never presses it.",
    href: '/r/household:theo%23ssn',
    anchor: '[data-tour="masked-value"]',
  },
  {
    id: 'rules',
    title: 'Rules are enforced, not just displayed',
    body: 'The required steps are derived from the work, never ticked by hand. Below them, Request approval and Submit stay disabled and say why. The server refuses a reviewer, partner or quality sign-off from anyone who prepared the work, and a sign-off reopens by itself when its evidence changes.',
    href: '/filing',
    anchor: 'section[aria-labelledby="steps"]',
  },
  {
    id: 'time',
    title: 'Time and attribution',
    body: 'The season clock in the header is shared and only moves forward; a message that arrives later appears when the clock reaches its date. Below, every line that differs between versions says what changed it: an engine version or a named adjustment. Look, do not touch: moving the clock is permanent.',
    href: '/compare?a=v2&b=v3',
    anchor: '[data-tour="season-time"]',
  },
  {
    id: 'errors',
    title: 'All 70 problems, and which check raises each',
    body: 'This is the full list from the error hunt, with the check that raises each. For some no check exists and a reviewer decides; for a few a check runs and raised nothing. The Overview counts what the checks have raised, so its numbers differ.',
    href: '/errors',
    anchor: 'section[aria-label="Summary"]',
  },
]
