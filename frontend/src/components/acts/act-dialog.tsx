'use client'
// One dialog body for every act type: the fields of the open type, a live tax-effect preview, plain field errors, and, in place
// of the submit button, the authorize() refusal (or the tour's read-only sentence while the tour is open). Posts the parsed act
// via the workspace.
import { type ComponentProps, type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { balanceWords, MaskedText, refLabel } from '@/components/atoms'
import { sinceSigned } from '@/components/filing/filing-logic'
import { TOUR_READ_ONLY_REASON, tourBlocksWrite } from '@/components/tour/guard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useWorkspace } from '@/components/workspace/context'
import { targetText, VERB } from '@/components/workspace/log'
import type { OpenActRequest, Workspace } from '@/components/workspace/types'
import { ActInputZ, type ApprovalDerived, VERIFICATION_METHODS } from '@/lib/model/acts'
import type { Finding } from '@/lib/model/checks/types'
import { needsPartner, PARTNER_THRESHOLD, whatIfEffect } from '@/lib/model/effects'
import { AREA_LABEL, type AreaKey } from '@/lib/model/ids'
import { plainMasked, sameValue } from '@/lib/model/mask-token'
import { scopeOf } from '@/lib/model/project'
import type { AuthResult } from '@/lib/model/state'
import {
  type AdjustFieldT, type AdjustPreview, type Answer, buildInput, canOpen, DECIDE_KIND_LABEL, DISPOSITION_LABEL, DISPOSITION_NEEDS_REF, disposeNeedsAuthority,
  type Draft, DUE_DILIGENCE_QUESTIONS, type FileT, formatSigned, formatVal, formErrors, initialDraft, issuesByField, type JurT,
  levelsFor, METHOD_INFO, type MethodT, NOTE_KIND_LABEL, parseTo, previewAdjust, probeDraft, proposalText, RESOLUTION_LABEL,
} from './draft'

type ActKind = OpenActRequest['type']

const TITLE: Record<ActKind, string> = {
  verify: 'Verify', adjust: 'Adjust', decide: 'Record a decision', dispose: 'Record a disposition', note: 'Add a note',
  reply: 'Reply', resolve: 'Resolve', attach: 'Attach evidence', signoff: 'Sign off', request_approval: 'Request client approval',
  client_approve: 'Approve and sign', file: 'File the return', amend_open: 'Open an amendment', revert: 'Revert',
  assign: 'Assign', time: 'Log time', clock: 'Advance the season clock',
}
const SUBMIT: Record<ActKind, string> = {
  verify: 'Verify', adjust: 'Save adjustment', decide: 'Record decision', dispose: 'Save disposition', note: 'Add note',
  reply: 'Send reply', resolve: 'Resolve', attach: 'Attach', signoff: 'Sign off', request_approval: 'Send for approval',
  client_approve: 'Approve and sign', file: 'File', amend_open: 'Open amendment', revert: 'Revert', assign: 'Assign',
  time: 'Log time', clock: 'Advance clock',
}
const WIDE = new Set<ActKind>(['adjust', 'decide'])
const MAX_FILE = 2_000_000

interface SectionProps {
  req: OpenActRequest
  d: Draft
  set: (patch: Partial<Draft>) => void
  err: Record<string, string>
  ws: Workspace
  onOpen: (req: OpenActRequest) => void
}

interface ActFormProps {
  req: OpenActRequest
  onDone: () => void
  onOpen: (req: OpenActRequest) => void
}

/** `finalFocus` is the host's close-time focus rule (act-host.tsx, focusReturn), or undefined for Base UI's default. */
export function ActDialog({
  finalFocus,
  ...props
}: ActFormProps & Pick<ComponentProps<typeof DialogContent>, 'finalFocus'>) {
  return (
    <DialogContent
      finalFocus={finalFocus}
      className={`max-h-[90vh] overflow-y-auto ${WIDE.has(props.req.type) ? 'sm:max-w-xl' : 'sm:max-w-md'}`}
    >
      <ActForm {...props} />
    </DialogContent>
  )
}

/** The form itself (exported for render tests: DialogContent portals, so it renders nothing on the server). */
export function ActForm({ req, onDone, onOpen }: ActFormProps) {
  const ws = useWorkspace()
  const { model, state } = ws
  const [d, setDraft] = useState(() => initialDraft(req, model, state))
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  // Read once, when the form opens (act-host keys it per open, and the modal sits above the tour's card).
  const [tourLocked] = useState(() => tourBlocksWrite(ws.engagement))
  // Whether the form is still open. Cancel and Esc stay live during a Save, and a refusal that lands after the close has no
  // form to print in, so the post toasts it (submit). Set again on mount for strict mode's remount; read only in handlers.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const set = (patch: Partial<Draft>) => {
    setDraft((prev) => ({ ...prev, ...patch }))
    // A refusal describes the form as it was sent. Without this, "Verify X instead" would bring the old message
    // back once the footer's refusal (which hides it) clears.
    setServerError(null)
  }

  const input = buildInput(req, d, state)
  const parsed = ActInputZ.safeParse(input)
  const errors = { ...(parsed.success ? {} : issuesByField(parsed.error.issues)), ...formErrors(req, d, state, model) }
  // The tour's read-only state is the demo's own guard (api.ts refuses with the same reason), not a permission rule; the form
  // says so as it opens rather than after a filled-in Save. Otherwise authorize() judges the form with stand-ins for fields
  // still to fill, so the submit button (and with it the field errors) stays reachable.
  const auth: AuthResult = tourLocked
    ? { ok: false, reason: TOUR_READ_ONLY_REASON }
    : ws.can(buildInput(req, probeDraft(req, d, state, model), state))
  const err = attempted ? errors : {}
  const unplaced = err.target ?? err.body ?? err.form

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    // Committed now, so the controls already carry aria-invalid and their errors when focus moves to the first of them.
    flushSync(() => setAttempted(true))
    if (!parsed.success || Object.keys(errors).length > 0) {
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      return
    }
    if (!auth.ok || busy) return
    setBusy(true)
    setServerError(null)
    try {
      // A refusal is printed here (inline, or in the footer once the log pull makes the probe refuse too), so it gets no toast
      // while the form is open. The post asks when the refusal arrives: one that lands after the close is toasted instead.
      const res = await ws.post([parsed.data], { quietRefusal: () => alive.current })
      if (res.ok) onDone()
      else if (alive.current) setServerError(res.reason)
    } catch (x) {
      setServerError(x instanceof Error ? x.message : 'Could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  const claim = model.claims[req.target]
  // A claim is named by its ref and label (a client reads the label alone); anything else by subjectOf, in words, and a target
  // with nothing to name (the season clock) gets no description. plainMasked, not MaskedText: no Reveal button inside a description.
  const subject = claim ? '' : plainMasked(subjectOf(ws, req.target))
  const findings = (req.findings ?? []).map((id) => model.findingsById[id]).filter(Boolean)
  const props: SectionProps = { req, d, set, err, ws, onOpen }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{TITLE[req.type]}</DialogTitle>
        {claim ? (
          <DialogDescription>
            {ws.viewer.kind !== 'client' && <><span className="font-mono text-xs">{req.target}</span> · </>}
            {claim.label}
          </DialogDescription>
        ) : subject && (
          // The clamp is visual only (the element keeps the whole text for a screen reader): a note runs to 4,000 characters, and
          // this sits above the fields. wrap-anywhere: a pasted link has no break to wrap at.
          <DialogDescription className="line-clamp-3 wrap-anywhere">{subject}</DialogDescription>
        )}
        {findings.length > 0 && (
          <ul className="grid gap-1 text-xs">
            {findings.map((f) => (
              <li key={f.id} className="rounded-md bg-muted px-2 py-1">
                <span className="text-muted-foreground">Addresses </span>
                {f.title}
              </li>
            ))}
          </ul>
        )}
      </DialogHeader>

      <Section {...props} />

      {unplaced && <p role="alert" className="text-sm text-destructive">{unplaced}</p>}
      {/* !auth.ok: the footer already says why, so printing the server's reason too would state it twice. */}
      {auth.ok && serverError && <p role="alert" className="text-sm text-destructive"><MaskedText text={serverError} context={req.target} /></p>}

      <DialogFooter>
        {!auth.ok && <p role="status" className="text-sm text-destructive sm:mr-auto sm:self-center"><MaskedText text={auth.reason} context={req.target} /></p>}
        <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
        {auth.ok && <Button type="submit" disabled={busy} focusableWhenDisabled className="data-disabled:opacity-50">{busy ? 'Saving…' : SUBMIT[req.type]}</Button>}
      </DialogFooter>
    </form>
  )
}

function Section(p: SectionProps) {
  switch (p.req.type) {
    case 'verify': return <VerifyFields {...p} />
    case 'adjust': return <AdjustFields {...p} />
    case 'decide': return <DecideFields {...p} />
    case 'dispose': return <DisposeFields {...p} />
    case 'note': return <NoteFields {...p} />
    case 'reply': return <ReplyFields {...p} />
    case 'resolve': return <ResolveFields {...p} />
    case 'attach': return <AttachFields {...p} />
    case 'signoff': return <SignoffFields {...p} />
    case 'revert': return <RevertFields {...p} />
    case 'assign': return <AssignFields {...p} />
    case 'time': return <TimeFields {...p} />
    case 'request_approval': return <RequestApprovalFields {...p} />
    case 'file': return <FileFields {...p} />
    case 'amend_open': return <AmendFields {...p} />
    case 'client_approve': return <ClientApproveFields {...p} />
    case 'clock': return <ClockFields {...p} />
  }
}

// ── Per-type fields ─────────────────────────────────────────────────────────────────────

function VerifyFields({ req, d, set, err, ws }: SectionProps) {
  const methods: MethodT[] = d.method === 'accepted_check_tied' ? [...VERIFICATION_METHODS, 'accepted_check_tied'] : [...VERIFICATION_METHODS]
  // The value attested is the one shown when the form opened; a value polled in since needs an explicit re-confirm.
  const live = ws.state.claims[req.target]?.effective ?? null
  // Refs the form filled in (the claim's sources, a finding's evidence) are not refs the person checked, so the label says so.
  const [prefilled] = useState(() => d.evidence.trim() !== '')
  // The method error names the radios, so a failed Save's focus move (ActForm.submit) lands on the first and reads it there.
  const methodErr = useId()
  // A verify attests the value; it leaves the claim's findings open, so a high one the form does not address is named here,
  // as the radio group's description (the v key opens the form with focus in the group).
  const cautionId = useId()
  const high = (ws.state.claims[req.target]?.openFindings ?? [])
    .filter((id) => !req.findings?.includes(id))
    .map((id): Finding | undefined => ws.model.findingsById[id])
    .filter((f): f is Finding => f?.severity === 'high')
  return (
    <>
      {high.length > 0 && (
        <p id={cautionId} className="text-sm text-destructive">
          {`Open high finding: ${plainMasked(high[0].title)}${high.length > 1 ? ` (+${high.length - 1} more)` : ''}. Verifying does not resolve it.`}
        </p>
      )}
      <RadioGroup value={d.method} onValueChange={(v) => set({ method: v as MethodT })} aria-label="Verification type" aria-describedby={high.length > 0 ? cautionId : undefined}>
        {methods.map((m) => (
          <label key={m} className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 has-data-checked:border-primary">
            <RadioGroupItem value={m} className="mt-0.5" aria-invalid={!!err.method || undefined} aria-describedby={err.method ? methodErr : undefined} />
            <span className="grid gap-0.5">
              <span className="font-medium">
                <span aria-hidden className="mr-1.5 font-mono text-xs text-muted-foreground">{METHOD_INFO[m].letter}</span>
                {METHOD_INFO[m].label}
              </span>
              <span className="text-xs text-muted-foreground">{METHOD_INFO[m].def}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
      {err.method && <p id={methodErr} className="text-xs text-destructive">{err.method}</p>}
      <LevelField req={req} d={d} set={set} err={err} ws={ws} />
      <p className="text-sm">
        Value you agreed: <span className="tabular-nums font-medium">{formatVal(d.seen)}</span>
        {!sameValue(d.seen, live) && (
          <Button type="button" size="xs" variant="outline" className="ml-2" onClick={(e) => {
            // This button unmounts once the value matches, so commit now and hand focus to the submit the footer then renders.
            const form = e.currentTarget.form
            flushSync(() => set({ seen: live }))
            form?.querySelector<HTMLElement>('button[type="submit"]')?.focus()
          }}>{`Verify ${formatVal(live)} instead`}</Button>
        )}
      </p>
      <RefsField label={prefilled ? 'Evidence (pre-filled; keep only refs you checked)' : 'Evidence'} value={d.evidence} onChange={(evidence) => set({ evidence })} error={err.evidence} />
    </>
  )
}

function AdjustFields({ req, d, set, err, ws, onOpen }: SectionProps) {
  const { model, state } = ws
  const line = model.lines[req.target]
  const cs = state.claims[req.target]
  const current = cs?.effective ?? null
  const fields: AdjustFieldT[] = !line ? ['value'] : line.form === 'F8949' ? ['value', 'basis', 'label'] : ['value', 'label']
  const isBool = d.field === 'value' && typeof current === 'boolean'
  const numeric = d.field === 'basis' || (d.field === 'value' && typeof current === 'number')
  const to = d.to.trim() ? parseTo(d.to, d.field, current) : null
  const pv = previewAdjust(model, state, req.target, d.field, to, d.what_if)
  const alts = model.packet.what_if.alternatives.filter((a) => a.id === d.what_if || a.changed_lines.some((c) => c.key === req.target))
  const role = state.viewer.role

  return (
    <>
      {fields.length > 1 && (
        <RadioGroup value={d.field} onValueChange={(v) => set({ field: v as AdjustFieldT, to: '' })} className="flex flex-wrap gap-4" aria-label="What to change">
          {fields.map((f) => (
            <label key={f} className="flex cursor-pointer items-center gap-2 text-sm">
              <RadioGroupItem value={f} />
              {f === 'value' ? 'Amount' : f === 'basis' ? 'Cost basis' : 'Label'}
            </label>
          ))}
        </RadioGroup>
      )}
      <Field label="New value" error={err.to} hint={d.field === 'basis' ? 'The basis reported on this F8949 row.' : undefined}>
        {(id, describedBy) => (
          <div className="flex items-center gap-3">
            <s className="shrink-0 tabular-nums text-muted-foreground">{formatVal(pv.from)}</s>
            <span aria-hidden className="text-muted-foreground">→</span>
            {isBool ? (
              <Choice id={id} value={d.to || null} onChange={(v) => set({ to: v })} invalid={!!err.to} describedBy={describedBy}
                options={[{ value: 'true', label: 'yes' }, { value: 'false', label: 'no' }]} />
            ) : (
              <Input id={id} value={d.to} onChange={(e) => set({ to: e.target.value })} aria-invalid={!!err.to || undefined} aria-describedby={describedBy}
                inputMode={numeric ? 'decimal' : undefined} className={numeric ? 'text-right tabular-nums' : undefined} autoComplete="off" />
            )}
          </div>
        )}
      </Field>
      {d.field === 'value' && cs && cs.original !== cs.effective && (
        <p className="text-xs text-muted-foreground">Packet value {formatVal(cs.original)}; a live adjustment already changed it.</p>
      )}
      <EffectPanel effect={pv.effect} partner={pv.partner} hint={pv.hint} empty={numeric ? 'Enter the new amount to see its effect.' : 'No tax effect to compute.'} />
      <Field label="Reason (at least 10 characters)" error={err.reason}>
        {(id, describedBy) => <Textarea id={id} value={d.reason} onChange={(e) => set({ reason: e.target.value })} aria-invalid={!!err.reason || undefined} aria-describedby={describedBy} />}
      </Field>
      <RefsField label="Evidence" value={d.evidence} onChange={(evidence) => set({ evidence })} error={err.evidence} />
      {alts.length > 0 && (
        <Field label="Cite an engine what-if (optional)" error={err.what_if}
          hint={alts.find((a) => a.id === d.what_if)?.description ?? 'Uses the packet\'s exact engine result instead of the rate estimate.'}>
          {(id, describedBy) => <Choice id={id} value={d.what_if || null} onChange={(what_if) => set({ what_if })} options={whatIfOptions(alts)} describedBy={describedBy} />}
        </Field>
      )}
      {(role === 'reviewer' || role === 'partner') && (
        <p className="text-xs text-muted-foreground">
          Adjusting makes you a preparer of {req.target}, so you could no longer review it.{' '}
          <Button type="button" variant="link" size="xs" className="h-auto p-0"
            onClick={() => onOpen({
              type: 'note', target: req.target, findings: req.findings,
              prefill: { kind: 'review_note', text: proposalText(model, req.target, d.field, pv.from, d.to, d.reason) },
            })}>
            Propose it as a review note
          </Button>
        </p>
      )}
    </>
  )
}

function DecideFields({ d, set, err, ws }: SectionProps) {
  const alts = ws.model.packet.what_if.alternatives
  const wi = d.what_if ? whatIfEffect(ws.model.packet, d.what_if) : null
  const answer = (key: string, a: Answer | undefined) => {
    const checklist = { ...d.checklist }
    if (a) checklist[key] = a
    else delete checklist[key]
    set({ checklist })
  }
  return (
    <>
      <Field label="Kind" error={err.kind}>
        {(id, describedBy) => <Choice id={id} value={d.decideKind} onChange={(decideKind) => set({ decideKind })} options={opts(DECIDE_KIND_LABEL)} describedBy={describedBy} />}
      </Field>
      <Field label="Question" error={err.question}>
        {(id, describedBy) => <Textarea id={id} value={d.question} onChange={(e) => set({ question: e.target.value })} aria-invalid={!!err.question || undefined} aria-describedby={describedBy} />}
      </Field>
      <Field label="Choice made" error={err.choice}>
        {(id, describedBy) => <Textarea id={id} value={d.choice} onChange={(e) => set({ choice: e.target.value })} aria-invalid={!!err.choice || undefined} aria-describedby={describedBy} />}
      </Field>
      <Field label="Alternatives considered (one per line)" error={err.alternatives}>
        {(id, describedBy) => <Textarea id={id} value={d.alternatives} onChange={(e) => set({ alternatives: e.target.value })} aria-describedby={describedBy} />}
      </Field>
      <Field label="Authority relied on" hint="e.g. IRC §179(b); Treas. Reg. §1.263(a)-3; Rev. Proc. 2019-43" error={err.authority}>
        {(id, describedBy) => <Input id={id} value={d.authority} onChange={(e) => set({ authority: e.target.value })} aria-invalid={!!err.authority || undefined} aria-describedby={describedBy} />}
      </Field>
      <RefsField label="Evidence" value={d.evidence} onChange={(evidence) => set({ evidence })} error={err.evidence} />
      <Field label="Engine what-if (optional)" error={err.what_if} hint={alts.find((a) => a.id === d.what_if)?.description}>
        {(id, describedBy) => <Choice id={id} value={d.what_if || null} onChange={(what_if) => set({ what_if })} options={whatIfOptions(alts)} describedBy={describedBy} />}
      </Field>
      {wi && <EffectPanel effect={wi} empty="" />}
      {d.decideKind === 'due_diligence' && (
        <fieldset className="grid gap-2.5 rounded-lg border p-3">
          <legend className="px-1 text-xs font-medium">Form 8867 paid-preparer due diligence</legend>
          {DUE_DILIGENCE_QUESTIONS.map((q) => (
            <div key={q.key} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
              <p className="text-sm">
                <span className="text-xs text-muted-foreground">{q.part} · </span>
                {q.text}
              </p>
              <ToggleGroup variant="outline" size="sm" spacing={0} aria-label={q.text}
                value={d.checklist[q.key] ? [d.checklist[q.key]] : []}
                onValueChange={(v) => answer(q.key, v[0] as Answer | undefined)}>
                {(['yes', 'no', 'n/a'] as const).map((a) => (
                  <ToggleGroupItem key={a} value={a} className="aria-pressed:bg-primary aria-pressed:text-primary-foreground">{a}</ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          ))}
          {err.checklist && <p className="text-xs text-destructive">{err.checklist}</p>}
        </fieldset>
      )}
    </>
  )
}

function DisposeFields({ req, d, set, err, ws }: SectionProps) {
  const needsRef = DISPOSITION_NEEDS_REF.has(d.disposition)
  const judgment = disposeNeedsAuthority(req, d, ws.state, ws.model) // it would clear an open finding that asks for a decision
  return (
    <>
      <Field label="Disposition" error={err.disposition}>
        {(id, describedBy) => <Choice id={id} value={d.disposition} onChange={(disposition) => set({ disposition })} options={opts(DISPOSITION_LABEL)} describedBy={describedBy} />}
      </Field>
      <Field label={needsRef ? 'Points to' : 'Related ref (optional)'} hint="A line, document or ref, e.g. D11 or F8949.B.N1" error={err.ref}>
        {(id, describedBy) => <Input id={id} value={d.ref} onChange={(e) => set({ ref: e.target.value })} className="font-mono" aria-invalid={!!err.ref || undefined} aria-describedby={describedBy} />}
      </Field>
      <Field label="Reason" error={err.reason}>
        {(id, describedBy) => <Textarea id={id} value={d.reason} onChange={(e) => set({ reason: e.target.value })} aria-invalid={!!err.reason || undefined} aria-describedby={describedBy} />}
      </Field>
      <Field label={judgment ? 'Authority relied on' : 'Authority (optional)'} error={err.authority}
        hint={judgment ? 'This clears a finding that asks for a decision. e.g. IRC §61; Rev. Proc. 2019-43; firm policy' : undefined}>
        {(id, describedBy) => <Input id={id} value={d.authority} onChange={(e) => set({ authority: e.target.value })} aria-invalid={!!err.authority || undefined} aria-describedby={describedBy} />}
      </Field>
    </>
  )
}

function NoteFields({ d, set, err, ws }: SectionProps) {
  const people = ws.identities.filter((v) =>
    v.id !== ws.viewer.id && (d.noteKind === 'memo' || (d.noteKind === 'question_client' ? v.kind === 'client' : v.kind === 'staff')))
  return (
    <>
      <Field label="Kind" error={err.kind}>
        {(id, describedBy) => <Choice id={id} value={d.noteKind} onChange={(noteKind) => set({ noteKind, addressee: '' })} options={opts(NOTE_KIND_LABEL)} describedBy={describedBy} />}
      </Field>
      <Field label="To" error={err.to}>
        {(id, describedBy) => (
          <Choice id={id} value={d.addressee || null} onChange={(addressee) => set({ addressee })} invalid={!!err.to} describedBy={describedBy}
            options={[{ value: null, label: 'No one in particular' }, ...people.map((v) => ({ value: v.id, label: `${v.name} (${v.role.replace('_', ' ')})` }))]} />
        )}
      </Field>
      <Field label="Text" error={err.text}>
        {(id, describedBy) => <Textarea id={id} value={d.text} onChange={(e) => set({ text: e.target.value })} aria-invalid={!!err.text || undefined} aria-describedby={describedBy} />}
      </Field>
      {d.noteKind === 'review_note' && (
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={d.blocking} onCheckedChange={(blocking) => set({ blocking })} />
          Blocking: approval and filing wait until it is resolved
        </label>
      )}
      <Field label="Due (optional)" error={err.due}>
        {(id, describedBy) => <Input id={id} type="date" value={d.due} onChange={(e) => set({ due: e.target.value })} className="w-fit" aria-describedby={describedBy} />}
      </Field>
    </>
  )
}

function ReplyFields({ d, set, err }: SectionProps) {
  return (
    <>
      <Field label="Reply" error={err.text}>
        {(id, describedBy) => <Textarea id={id} value={d.text} onChange={(e) => set({ text: e.target.value })} aria-invalid={!!err.text || undefined} aria-describedby={describedBy} />}
      </Field>
      <FileField file={d.file} onChange={(file) => set({ file })} error={err.attachments} />
    </>
  )
}

function ResolveFields({ req, d, set, err }: SectionProps) {
  const finding = req.target.startsWith('chk:') // resolving a finding must cite its authority (a note need not)
  return (
    <>
      <Field label="Resolution" error={err.resolution}>
        {(id, describedBy) => <Choice id={id} value={d.resolution} onChange={(resolution) => set({ resolution })} options={opts(RESOLUTION_LABEL)} describedBy={describedBy} />}
      </Field>
      <Field label="What was done" error={err.text}>
        {(id, describedBy) => <Textarea id={id} value={d.text} onChange={(e) => set({ text: e.target.value })} aria-invalid={!!err.text || undefined} aria-describedby={describedBy} />}
      </Field>
      <Field label={finding ? 'Authority relied on' : 'Authority (optional)'} error={err.authority}
        hint={finding ? 'e.g. IRC §1012; Treas. Reg. §1.6045-1(d)(6); firm policy' : undefined}>
        {(id, describedBy) => <Input id={id} value={d.authority} onChange={(e) => set({ authority: e.target.value })} aria-invalid={!!err.authority || undefined} aria-describedby={describedBy} />}
      </Field>
    </>
  )
}

function AttachFields({ d, set, err }: SectionProps) {
  return (
    <>
      <Field label="Label" error={err.label}>
        {(id, describedBy) => <Input id={id} value={d.label} onChange={(e) => set({ label: e.target.value })} aria-invalid={!!err.label || undefined} aria-describedby={describedBy} />}
      </Field>
      <Field label="Pasted text" hint="An email, a message, call notes." error={err.text}>
        {(id, describedBy) => <Textarea id={id} value={d.text} onChange={(e) => set({ text: e.target.value })} aria-invalid={!!err.text || undefined} aria-describedby={describedBy} />}
      </Field>
      <FileField file={d.file} onChange={(file) => set({ file })} error={err.file} />
      <RefsField label="Filed against" value={d.filedAgainst} onChange={(filedAgainst) => set({ filedAgainst })} error={err.filed_against} />
    </>
  )
}

function SignoffFields({ req, d, set, err, ws }: SectionProps) {
  const { model, state } = ws
  const area = state.areas.find((a) => `area:${a.key}` === req.target)
  const prior = state.signoffs.filter((s) => s.target === req.target)
  return (
    <>
      <p className="text-sm">
        Covers <span className="font-medium tabular-nums">{scopeOf(model, req.target).length.toLocaleString('en-US')}</span> claims in{' '}
        {targetLabel(req.target)}
        {area && <> · {area.open} open · {area.findingsOpen} findings open</>}.
      </p>
      <LevelField req={req} d={d} set={set} err={err} ws={ws} />
      {prior.length > 0 && (
        <ul className="grid gap-1 text-xs text-muted-foreground">
          {prior.map((s) => {
            const since = sinceSigned(model, state, s)
            return (
              <li key={s.seq}>
                {s.level} by {nameOf(ws, s.actor)}: {s.valid ? 'valid' : `reopened (${s.changed.length} changed${since.length ? `; since then: ${since.join('; ')}` : ''})`}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

function RevertFields({ req, d, set, err, ws }: SectionProps) {
  const acts = req.target.startsWith('batch:')
    ? ws.state.acts.filter((a) => a.batch_id === req.target.slice('batch:'.length))
    : ws.state.acts.filter((a) => `act:${a.seq}` === req.target)
  const one = acts.length === 1 ? acts[0] : undefined
  return (
    <>
      <p className="text-sm">
        {one ? <>Reverts {one.type} on <span className="font-mono text-xs">{one.target}</span> by {nameOf(ws, one.actor)}.</> : <>Reverts {acts.length} acts in this batch.</>}{' '}
        <span className="text-muted-foreground">Nothing is deleted; the revert is itself logged.</span>
      </p>
      <Field label="Reason" error={err.reason}>
        {(id, describedBy) => <Textarea id={id} value={d.reason} onChange={(e) => set({ reason: e.target.value })} aria-invalid={!!err.reason || undefined} aria-describedby={describedBy} />}
      </Field>
    </>
  )
}

function AssignFields({ req, d, set, err, ws }: SectionProps) {
  const staff = ws.identities.filter((v) => v.kind === 'staff')
  return (
    <>
      <p className="text-sm">{targetLabel(req.target)}</p>
      <Field label="Assignee" error={err.assignee}>
        {(id, describedBy) => (
          <Choice id={id} value={d.assignee || null} onChange={(assignee) => set({ assignee })} describedBy={describedBy}
            options={staff.map((v) => ({ value: v.id, label: `${v.name} (${v.role.replace('_', ' ')})` }))} />
        )}
      </Field>
    </>
  )
}

function TimeFields({ req, d, set, err, ws }: SectionProps) {
  const area = ws.state.areas.find((a) => `area:${a.key}` === req.target)
  return (
    <>
      <p className="text-sm">
        {targetLabel(req.target)}
        {area && <span className="text-muted-foreground"> · {area.hours} h logged{area.budget !== null && ` of ${area.budget} h budget`}</span>}
      </p>
      <Field label="Hours" error={err.hours}>
        {(id, describedBy) => (
          <Input id={id} value={d.hours} onChange={(e) => set({ hours: e.target.value })} inputMode="decimal" className="w-24 text-right tabular-nums"
            aria-invalid={!!err.hours || undefined} aria-describedby={describedBy} />
        )}
      </Field>
      <Field label="Note (optional)" error={err.note}>
        {(id, describedBy) => <Input id={id} value={d.timeNote} onChange={(e) => set({ timeNote: e.target.value })} aria-describedby={describedBy} />}
      </Field>
    </>
  )
}

function RequestApprovalFields({ ws }: SectionProps) {
  const { gates, totals } = ws.state
  return (
    <>
      <Balances fed={totals.federal.balance_estimate} ca={totals.california.balance_estimate} />
      <p className="text-xs text-muted-foreground">Any later change to an amount invalidates the approval and needs a new request.</p>
      <GateReasons gate={gates.request_approval} />
    </>
  )
}

function FileFields({ d, set, err, ws }: SectionProps) {
  const toggle = (j: JurT, on: boolean) => set({ jurisdictions: on ? [...new Set([...d.jurisdictions, j])] : d.jurisdictions.filter((x) => x !== j) })
  return (
    <>
      <RadioGroup value={d.fileKind} onValueChange={(v) => set({ fileKind: v as Draft['fileKind'] })} className="flex gap-4" aria-label="Filing kind">
        {(['submit', 'extension'] as const).map((k) => (
          <label key={k} className="flex cursor-pointer items-center gap-2 text-sm">
            <RadioGroupItem value={k} />
            {k === 'submit' ? 'E-file the return' : 'File an extension'}
          </label>
        ))}
      </RadioGroup>
      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-sm font-medium">Jurisdictions</legend>
        {(['federal', 'california'] as const).map((j) => (
          <label key={j} className="flex items-center gap-2 text-sm">
            <Checkbox checked={d.jurisdictions.includes(j)} onCheckedChange={(on) => toggle(j, on)} />
            {j === 'federal' ? 'Federal (IRS)' : 'California (FTB)'}
            {ws.state.frozen[j] && <Badge variant="secondary">filed</Badge>}
          </label>
        ))}
        {err.jurisdictions && <p className="text-xs text-destructive">{err.jurisdictions}</p>}
      </fieldset>
      {d.fileKind === 'submit' && <GateReasons gate={ws.state.gates.submit} />}
    </>
  )
}

function AmendFields({ d, set, err, ws }: SectionProps) {
  const accepted = ws.state.filings.filter((f) => f.kind === 'submit' && f.results.some((r) => r.status === 'accepted'))
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {accepted.length ? `Unfreezes the filed return (filed ${accepted.at(-1)!.recorded_at.slice(0, 10)}) for an amendment.` : 'No accepted filing yet.'}
      </p>
      <Field label="Reason (at least 10 characters)" error={err.reason}>
        {(id, describedBy) => <Textarea id={id} value={d.reason} onChange={(e) => set({ reason: e.target.value })} aria-invalid={!!err.reason || undefined} aria-describedby={describedBy} />}
      </Field>
    </>
  )
}

function ClientApproveFields({ req, d, set, err, ws }: SectionProps) {
  const request = ws.state.acts.find((a) => `act:${a.seq}` === req.target)
  const summary = (request?.derived as Partial<ApprovalDerived> | undefined)?.summary
  return (
    <>
      {summary ? <Balances fed={summary.federal_balance} ca={summary.california_balance} client />
        : <p className="text-sm text-muted-foreground">This approves the return as sent to you for review.</p>}
      {/* The client picks the PIN (post-acts hashes whatever five digits are typed) and no code is sent: no one-time-code autofill. */}
      <Field label="Your 5-digit signature PIN" error={err.pin}
        hint="Type any 5 digits you choose; they are your signature on this approval. No code is sent to you.">
        {(id, describedBy) => (
          <Input id={id} value={d.pin} onChange={(e) => set({ pin: e.target.value.replace(/\D/g, '').slice(0, 5) })}
            type="password" inputMode="numeric" autoComplete="off" maxLength={5}
            className="w-28 text-center font-mono tracking-[0.4em]" aria-invalid={!!err.pin || undefined} aria-describedby={describedBy} />
        )}
      </Field>
    </>
  )
}

function ClockFields({ d, set, err, ws }: SectionProps) {
  const next = ws.state.nextEvent
  return (
    <>
      <p className="text-sm">
        Season clock is at <span className="tabular-nums">{ws.state.clock.slice(0, 16).replace('T', ' ')}</span>.
        {next && <> Next: {next.label} ({next.at.slice(0, 10)}).</>}
      </p>
      <Field label="Move to (ISO time)" error={err.to}>
        {(id, describedBy) => <Input id={id} value={d.clockTo} onChange={(e) => set({ clockTo: e.target.value })} className="font-mono" aria-invalid={!!err.to || undefined} aria-describedby={describedBy} />}
      </Field>
    </>
  )
}

// ── Shared pieces ───────────────────────────────────────────────────────────────────────

function LevelField({ req, d, set, err, ws }: Pick<SectionProps, 'req' | 'd' | 'set' | 'err' | 'ws'>) {
  const levels = levelsFor(ws.state.viewer.role)
  if (levels.length < 2) return <p className="text-sm">Level: <span className="font-medium">{d.level}</span> <span className="text-muted-foreground">(from your role)</span></p>
  // canOpen opens at the first level the role may use, so a form below the top one owes the reason the top was refused. Judged on
  // a fresh draft, so a stale seen value cannot pass for a level refusal; at the top level the footer already says it.
  const top = levels[0]
  const own = d.level !== top ? canOpen({ ...req, prefill: { ...req.prefill, level: top } }, ws).auth : undefined
  const hint = own && !own.ok ? `${top[0].toUpperCase()}${top.slice(1)} level is not open to you: ${plainMasked(own.reason)}` : undefined
  return (
    <Field label="Level" error={err.level} hint={hint}>
      {(id, describedBy) => <Choice id={id} value={d.level} onChange={(level) => set({ level })} options={levels.map((l) => ({ value: l, label: l }))} describedBy={describedBy} />}
    </Field>
  )
}

type EffectT = NonNullable<AdjustPreview['effect']>

const BASIS_TEXT: Record<EffectT['basis'], string> = {
  rate: 'Estimate: change × the v3 tax-effect rate for this category.',
  direct: 'Payment or credit: moves tax or balance due one for one.',
  what_if: 'Exact engine result from the packet what-if.',
  none: 'No tax effect.',
}

/** partner: the server's needs_partner for an adjust (judged on the total move); a decide's what-if falls back to its own size. */
function EffectPanel({ effect, partner = !!effect && needsPartner(effect), hint, empty }: { effect: EffectT | null; partner?: boolean; hint?: string; empty: string }) {
  return (
    <div className="grid gap-1.5 rounded-lg border bg-muted/40 p-3" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Tax effect (+ means more tax or balance due)</span>
        {partner && <Badge variant="destructive">Routes to partner</Badge>}
      </div>
      {effect ? (
        <dl className="grid grid-cols-[1fr_auto] gap-x-6 text-sm tabular-nums">
          <dt>Federal</dt>
          <dd className="text-right font-medium">{formatSigned(effect.fed)}</dd>
          <dt>California</dt>
          <dd className="text-right font-medium">{formatSigned(effect.ca)}</dd>
        </dl>
      ) : (
        empty && <p className="text-sm text-muted-foreground">{empty}</p>
      )}
      <p className="text-xs text-muted-foreground">
        {[effect && BASIS_TEXT[effect.basis], partner && `Over ${PARTNER_THRESHOLD.toLocaleString('en-US')} from the packet value: needs a valid partner sign-off before approval or filing.`, hint]
          .filter(Boolean).join(' ')}
      </p>
    </div>
  )
}

function GateReasons({ gate }: { gate: { ok: boolean; reasons: { text: string; ref?: string }[] } }) {
  if (gate.ok || gate.reasons.length === 0) return null
  return (
    <ul className="grid gap-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
      {gate.reasons.map((r) => (
        <li key={r.text}>
          {r.ref ? (
            <a href={`/r/${encodeURIComponent(r.ref)}`} className="underline underline-offset-2">
              {plainMasked(r.text)}
            </a>
          ) : (
            plainMasked(r.text)
          )}
        </li>
      ))}
    </ul>
  )
}

/** Staff read the signed figure under "balance due"; a client reads each side as the portal words it ("$8,256 refund to you"). */
function Balances({ fed, ca, client = false }: { fed: number; ca: number; client?: boolean }) {
  const figure = (owe: number) => {
    if (!client) return formatVal(owe)
    const { amount, words } = balanceWords(owe)
    return `${amount} ${words}`
  }
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-6 text-sm tabular-nums">
      <dt>{client ? 'Federal' : 'Federal balance due'}</dt>
      <dd className="text-right font-medium">{figure(fed)}</dd>
      <dt>{client ? 'California' : 'California balance due'}</dt>
      <dd className="text-right font-medium">{figure(ca)}</dd>
    </dl>
  )
}

/** children gets the control's id and, while the field shows a line under it (its error, else its hint), that line's id for aria-describedby. */
function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: string; children: (id: string, describedBy: string | undefined) => ReactNode }) {
  const id = useId()
  const msgId = `${id}-msg`
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children(id, error || hint ? msgId : undefined)}
      {error ? <p id={msgId} className="text-xs text-destructive">{error}</p> : hint ? <p id={msgId} className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function RefsField({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <Field label={label} hint="Refs separated by commas, e.g. ev-0493, D11, doc:D23#page3" error={error}>
      {(id, describedBy) => <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} className="font-mono" aria-invalid={!!error || undefined} aria-describedby={describedBy} />}
    </Field>
  )
}

function Choice<T extends string>({ id, value, onChange, options, invalid, describedBy }: {
  id?: string
  value: T | null
  onChange: (v: T) => void
  options: { value: T | null; label: string }[]
  invalid?: boolean
  describedBy?: string
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange((v ?? '') as T)} items={options}>
      <SelectTrigger id={id} className="w-full min-w-0" aria-invalid={invalid || undefined} aria-describedby={describedBy}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value ?? ''} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function FileField({ file, onChange, error }: { file: FileT | null; onChange: (f: FileT | null) => void; error?: string }) {
  const [problem, setProblem] = useState<string | null>(null)
  async function pick(f: File | undefined) {
    setProblem(null)
    if (!f) return onChange(null)
    if (f.size > MAX_FILE) return setProblem(`${f.name} is ${(f.size / 1e6).toFixed(1)} MB; the limit is 2 MB.`)
    try {
      onChange(await readFile(f))
    } catch {
      setProblem(`Could not read ${f.name}.`)
    }
  }
  return (
    <Field label="File (optional, up to 2 MB)" error={problem ?? error}>
      {(id, describedBy) =>
        file ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-sm">
            <span className="truncate">{file.name} <span className="text-muted-foreground">· {Math.ceil(file.size / 1000)} KB</span></span>
            <Button type="button" variant="ghost" size="xs" onClick={() => onChange(null)}>Remove</Button>
          </div>
        ) : (
          <Input id={id} type="file" onChange={(e) => pick(e.target.files?.[0])} aria-describedby={describedBy} />
        )
      }
    </Field>
  )
}

function readFile(f: File): Promise<FileT> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(r.error)
    r.onload = () => {
      const url = String(r.result)
      resolve({ name: f.name.slice(0, 200), mime: (f.type || 'application/octet-stream').slice(0, 100), size: f.size, data_base64: url.slice(url.indexOf(',') + 1) })
    }
    r.readAsDataURL(f)
  })
}

const whatIfOptions = (alts: { id: string }[]) =>
  [{ value: null, label: 'None' }, ...alts.map((a) => ({ value: a.id, label: a.id.replaceAll('_', ' ') }))]

const opts = <T extends string>(labels: Record<T, string>) =>
  (Object.entries(labels) as [T, string][]).map(([value, label]) => ({ value, label }))

const nameOf = (ws: Workspace, id: string) => ws.identities.find((v) => v.id === id)?.name ?? id

/**
 * A target that is not a claim, in words for the description: a note is its author and text, an act is its verb and author,
 * anything else its label (a finding, evidence) or targetText's words (an area, the return, a group of changes; '' for the season
 * clock). A note's text may hold mask tokens, so the caller shows the result through plainMasked.
 */
function subjectOf(ws: Workspace, target: string): string {
  const note = ws.state.notes.find((n) => `act:${n.seq}` === target)
  if (note) return `${nameOf(ws, note.actor)}: ${note.text}`
  const act = ws.state.acts.find((a) => `act:${a.seq}` === target)
  if (act) return `${VERB[act.type]} by ${nameOf(ws, act.actor)}`
  return refLabel(ws.model, target) ?? targetText(target)
}

function targetLabel(target: string): string {
  if (target === 'return') return 'the whole return'
  const key = target.slice('area:'.length) as AreaKey
  return AREA_LABEL[key] ?? target
}
