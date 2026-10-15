// Shared atoms. Import from '@/components/atoms'.
//
//   <Money value={1234.5} signed? className? />   tabular figures, "−" for negatives, "+" when signed, "—" for null
//   <Stake fed={n} ca={n} />                       "Fed 1,200 · CA 300"; zero sides omitted
//   <RefLink to="F8949.B.N1">children?</RefLink>   link to /r/<encoded ref>, titled with the claim/doc/finding label.
//                                                  The prop is `to`, not `ref`: React 19 reserves `ref`.
//   <StatusPill status={claim.status} />           open | adjusted | verified | accepted | read_ok | unreviewed
//   <SupportLetters support={claim.support} />     D R C P T, filled / outlined (check) / ringed (bulk) / faint (none)
//   <FlagChips flags={claim.flags} />              needs partner, reopened, stale, blocks filing, not yet in file, frozen
//   <MaskedText text={value} context={ref} />      masked tokens as •••-••-3309 + Reveal (logged; refusals shown inline)
//   <Ago iso={at} now?={state.clock} />            relative time; pass `now` to measure from the season clock
//
// Helpers: refHref(ref), refLabel(model, ref), formatMoney(v, signed?), formatClock(iso), relativeTime(iso, nowMs).
// RefLink, MaskedText and Ago are client components; RefLink and MaskedText degrade gracefully outside the provider.
export { Ago } from './ago'
export { formatClock, formatMoney, refHref, refLabel, relativeTime } from './format'
export { MaskedText } from './masked-text'
export { Money, Stake } from './money'
export { RefLink } from './ref-link'
export { FlagChips, StatusPill, SupportLetters } from './status'
