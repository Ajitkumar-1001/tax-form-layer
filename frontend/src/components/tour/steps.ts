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
  /** CSS selector of what to ring: `[attr="value"]`, `section[attr="value"]` or `#id`, or a comma-separated list of them (the
   *  first visible match in the page is rung). Only a VISIBLE match counts (earlier
   *  pages stay mounted, hidden). Absent, or never found: the card shows without a ring. Never a control that writes
   *  (Reveal, Save, Accept, Dispose, Move clock): the ring is a picture, and a ring invites a click. */
  anchor?: string
  /** A link inside the card for a closer look. */
  more?: { label: string; href: string }
}

export const STEPS: readonly TourStep[] = [
  {
    id: 'idea',
    title: 'Every number has a proof',
    body: 'A return here is a list of claims, and everything people do to clear them is an act in a log nobody can rewrite. Edit a past act in this demo and every later hash breaks, so tampering shows.',
    href: '/about',
    anchor: '[data-tour="chain-demo"]',
  },
  {
    id: 'standing',
    title: 'One screen says where the return stands',
    body: "The overview shows how far the return is, what blocks filing and who has to act, where the money is at stake, and your own next step. It is computed from the work, and dollar effects are estimates from the packet's own rates.",
    href: '/overview',
    anchor: '[aria-labelledby="ov-where"]',
  },
  {
    id: 'checks',
    title: 'The checks already ran',
    body: 'Nobody hunts for errors. Checks run on load and attach findings to the claims they affect, and the queue sorts them by consequence, filing blockers first, then by money at stake. This tour never presses Save, so nothing is recorded.',
    href: '/queue',
    // A list: the first visible match is rung. The Next card goes when the queue worklist lands (docs/superpowers/specs/
    // 2026-10-15-queue-worklist-design.md, section 7) and the top group takes over; drop the first alternative then.
    anchor: 'section[aria-label="Next"], [data-tour="queue-group"]',
    more: { label: 'See what it caught', href: '/r/F8949.B.N1' },
  },
  {
    id: 'proof',
    title: 'Proof sits beside the number',
    body: 'Open any number to see its Evidence, how it was Built, and its History; keys 1, 2 and 3 switch tabs. Here a broker\'s "not reported" was stored as zero, and the document with the real figure sits beside it.',
    href: '/r/F8949.B.N1',
    anchor: '[data-tour="claim-tabs"]',
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
    body: 'The required steps are derived from the work, never ticked by hand. Request approval and Submit stay disabled and say why, and the server refuses a sign-off from anyone who prepared the work.',
    href: '/filing',
    anchor: '#steps',
  },
  {
    id: 'errors',
    title: 'All 70 problems, and what catches each',
    body: 'This page lists every problem found in the sample packet, which check raises it, and its live status. Problems no rule can decide are marked as reviewer judgment.',
    href: '/errors',
    anchor: 'section[aria-label="Summary"]',
  },
]
