// Pure half of the client portal (spec §3.10). It reads only what a client may see: questions addressed
// to them, requested items, the approval request and the filed summary. Never findings, memos or staff notes.
import type { Model } from '@/lib/model/build'
import type { NoteView, State, Viewer } from '@/lib/model/state'

/** The client the portal shows: the viewer when they are a client, else the first client (a staff preview). */
export function portalClient(viewer: Viewer, identities: Viewer[]): Viewer | undefined {
  return viewer.kind === 'client' ? viewer : identities.find((v) => v.kind === 'client')
}

const addressedTo = (n: NoteView, clientId: string) => n.kind === 'question_client' && (!n.to || n.to === 'client' || n.to === clientId)

/** Questions to this client: open first (oldest first), then answered ones (newest first). */
export function clientQuestions(state: State, clientId: string): { open: NoteView[]; answered: NoteView[] } {
  const mine = state.notes.filter((n) => addressedTo(n, clientId))
  return {
    open: mine.filter((n) => n.open),
    answered: mine.filter((n) => !n.open).reverse(),
  }
}

export interface NeedItem {
  key: string
  text: string
  due?: string
}

/** "What we still need": open questions to this client, then items the firm marked as requested from the client. */
export function stillNeeded(model: Model, state: State, clientId: string): NeedItem[] {
  const questions = clientQuestions(state, clientId).open.map((n) => ({ key: `act:${n.seq}`, text: n.text, ...(n.due && { due: n.due.slice(0, 10) }) }))
  const requested = Object.values(state.claims)
    .filter((c) => c.disposition?.disposition === 'requested')
    .map((c) => ({ key: c.id, text: model.claims[c.id]?.label ?? c.id }))
  return [...questions, ...requested]
}

export type SignState =
  | { kind: 'none' }
  | { kind: 'filed' }
  | { kind: 'changed'; requestSeq: number }
  | { kind: 'ready'; requestSeq: number }
  | { kind: 'signed'; requestSeq: number; waitingFor: string[] }

/** Where this client stands on the e-file authorization. */
export function signState(model: Model, state: State, clientId: string): SignState {
  if (state.frozen.federal || state.frozen.california) return { kind: 'filed' }
  const ap = state.approval
  if (!ap) return { kind: 'none' }
  if (!ap.current) return { kind: 'changed', requestSeq: ap.request_seq }
  const signed = (id: string) => ap.approvals.some((x) => x.signer === id && x.valid)
  if (!signed(clientId)) return { kind: 'ready', requestSeq: ap.request_seq }
  const waitingFor = model.packet.firm.client_users.filter((u) => !signed(u.id)).map((u) => u.name)
  return { kind: 'signed', requestSeq: ap.request_seq, waitingFor }
}

const things = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`)

/**
 * The one-line answer to "what do I do now?", for the top of the portal. `questions` are the open questions to this
 * client and `requested` the items the firm asked for beyond them; both are what is left for the client to do.
 */
export function portalHeadline(questions: number, requested: number, sign: SignState): string {
  if (sign.kind === 'filed') return 'Your return has been filed.'
  if (sign.kind === 'signed') return 'You have signed.'
  if (sign.kind === 'changed') return 'Some amounts changed.'
  const todo = questions + requested
  if (sign.kind === 'ready') return todo === 0 ? 'Your return is ready to sign.' : `${things(todo, 'One thing', 'things')} to do, then sign.`
  if (todo === 0) return 'Nothing for you to do right now.'
  if (requested === 0) return `${things(questions, 'One question needs', 'questions need')} your answer.`
  return `We still need ${things(todo, 'one item', 'items')} from you.`
}
