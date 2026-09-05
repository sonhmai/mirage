// ========= Copyright 2026 @ Strukto.AI All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2026 @ Strukto.AI All Rights Reserved. =========

import { sha256Hex } from '../utils/hash.ts'
import { Outcome } from './types.ts'
import type {
  Abandoned,
  Ask,
  Claim,
  Claimant,
  CommandContext,
  CommandRule,
  Decision,
  Deny,
  HandOff,
  Occurrence,
  Pending,
  SessionDecisionsQuery,
} from './types.ts'
import { Scope } from './types.ts'

const ABANDONED: Abandoned = { kind: 'abandoned' }

/**
 * Tell the abandonment of a question from a host's answer.
 *
 * Structural, not by identity: a `Decision` carries no `kind`, so the
 * field alone separates the two without depending on this module being
 * the only place the sentinel is built.
 *
 * @param said what the wait produced.
 * @returns true when the run went away mid-question.
 */
function isAbandoned(said: Decision | null | Abandoned): said is Abandoned {
  return said !== null && 'kind' in said
}

/**
 * A host's answer, or the abandonment of the question when the run
 * waiting on it is killed first.
 *
 * The wait is taken as a thunk so a run already over never starts one:
 * nothing should be put to a host on behalf of a line that no longer
 * exists. An abandoned wait is not cancelled, because a promise cannot
 * be; its value is dropped, and the rejection handler stays attached so
 * a channel that falls over afterwards does not surface as an unhandled
 * rejection.
 *
 * @param start begins the wait; called at most once.
 * @param signal the run's abort signal; absent leaves the wait alone.
 * @returns the answer, or ABANDONED once the run is gone.
 */
async function answered(
  start: () => Promise<Decision | null>,
  signal: AbortSignal | undefined,
): Promise<Decision | null | Abandoned> {
  if (signal === undefined) return start()
  if (signal.aborted) return ABANDONED
  const pending = start()
  return new Promise<Decision | null | Abandoned>((resolve, reject) => {
    const onAbort = (): void => {
      resolve(ABANDONED)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort)
    })
  })
}

/**
 * A host that answers an Ask inside the line.
 *
 * `signal` is the run's, so a host that puts a question to a person can
 * take its prompt down when the run it belongs to is killed. Ignoring it
 * is safe: the ledger stops waiting on the handler either way.
 */
export type AskHandler = (record: Decision, signal?: AbortSignal) => Promise<Decision | null>

/**
 * The id a record is named by: a digest of what was asked, so a retry
 * of the same line quotes the same id and a host answers it once.
 *
 * The id names the record; it does not decide what a retry matches.
 * That comparison is made against the recorded fields themselves
 * (`covers`), so a line the digest cannot tell apart from another still
 * cannot borrow its answer.
 */
export async function decisionId(
  sessionId: string,
  cwd: string,
  argv: readonly string[],
): Promise<string> {
  const enc = new TextEncoder()
  const parts = [sessionId, cwd, ...argv].map((part) => enc.encode(part + '\0'))
  const total = parts.reduce((n, p) => n + p.byteLength, 0)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  return (await sha256Hex(bytes)).slice(0, 12)
}

/**
 * The rule an Ask is keyed on: the document's, or for a coded Ask one
 * synthesized over the program that asked, so a session answer reads
 * "stop asking me about this program".
 */
export function askRule(ctx: CommandContext, ask: Ask): CommandRule {
  if (ask.rule != null) return ask.rule
  const program = (ctx.program ?? [ctx.command]).join(' ')
  return { reason: ask.reason, commands: [program] }
}

function sameList(a: readonly string[] = [], b: readonly string[] = []): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function sameRule(a: CommandRule, b: CommandRule): boolean {
  return (
    a.reason === b.reason &&
    a.mount === b.mount &&
    sameList(a.commands, b.commands) &&
    sameList(a.paths, b.paths)
  )
}

function sameLine(record: Decision, argv: readonly string[], cwd: string): boolean {
  const words = [record.command, ...record.argv]
  return record.cwd === cwd && words.length === argv.length && words.every((w, i) => w === argv[i])
}

/**
 * Whether an answered record answers this rule of this line.
 *
 * A ONCE answer covers the exact line it was given for, compared field
 * by field. A SESSION answer covers every line the same rule asks
 * about. Both are keyed on the rule as well as the words: an answer
 * that outlives a rule change (a persisted store reopened under an
 * edited profile) must not answer the new rule's ask, and a stale
 * refusal must not speak in its voice.
 */
export function covers(
  record: Decision,
  rule: CommandRule,
  argv: readonly string[],
  cwd: string,
): boolean {
  if (record.outcome === null || !sameRule(record.rule, rule)) return false
  if (record.scope === Scope.SESSION) return record.outcome === Outcome.ALLOW
  return sameLine(record, argv, cwd)
}

/**
 * The workspace's decision ledger: turns an Ask into run, refuse or
 * pending, and is the host's handle on every question raised and every
 * answer given.
 *
 * One record type, one store. A `Decision` with no outcome is a
 * question waiting; one with an outcome is a question settled, and how
 * far the answer reaches is its `scope`. Keeping both in one place is
 * the point: they used to be two stores, a pending map that vanished on
 * restart and a per-session answer list that did not, so a host could
 * see a question that no longer existed or miss one that did.
 *
 * Mirrors the Python Decisions.
 */
/**
 * A hand-off and every line it was evaluated from, innermost first;
 * empty outside a line.
 */
export function lineage(handed: HandOff | null): HandOff[] {
  const out: HandOff[] = []
  for (let h = handed; h !== null; h = h.parent) out.push(h)
  return out
}

/**
 * Whether two occurrences are one place: the same span of the same
 * text, under the same node all the way up.
 */
export function sameOccurrence(a: Occurrence | null, b: Occurrence | null): boolean {
  let x = a
  let y = b
  while (x !== null && y !== null) {
    if (x.source !== y.source || x.start !== y.start || x.end !== y.end) return false
    x = x.parent
    y = y.parent
  }
  return x === null && y === null
}

/**
 * Whether a command stands inside a scope: within the scope's span of
 * the same text, or on a line evaluated from a node that does.
 *
 * @param scope the enclosing node, a background job's.
 * @param occurrence the command's place.
 */
export function encloses(scope: Occurrence, occurrence: Occurrence): boolean {
  for (let within: Occurrence | null = occurrence; within !== null; within = within.parent) {
    if (sameOccurrence(within.parent, scope.parent) && within.source === scope.source) {
      return scope.start <= within.start && within.end <= scope.end
    }
  }
  return false
}

export class Decisions {
  private readonly sessions: SessionDecisionsQuery | null
  private readonly onAsk: AskHandler | null
  private readonly memory = new Map<string, Decision[]>()
  // The hand-offs holding a claim, per session: a reservation is a fact
  // about a line running in this process, so it lives here and not in
  // the store the records persist to.
  private readonly live = new Map<string, Set<HandOff>>()

  constructor(sessions: SessionDecisionsQuery | null = null, onAsk: AskHandler | null = null) {
    this.sessions = sessions
    this.onAsk = onAsk
  }

  /** Every record, oldest first: questions waiting and questions settled. */
  list(sessionId = ''): Decision[] {
    if (sessionId) return [...this.records(sessionId)]
    return this.keys().flatMap((key) => [...this.records(key)])
  }

  /** The records nobody has answered, oldest first. */
  pending(sessionId = ''): Decision[] {
    return this.list(sessionId).filter((r) => r.outcome === null)
  }

  /**
   * Answer a waiting record, yes or no.
   *
   * ALLOW at ONCE passes the one line it was given for and is consumed
   * by it — the line that asked, when the host answers while it waits,
   * or that line's retry when the answer comes later; at SESSION it
   * passes every line the rule covers for the rest of the session. DENY
   * refuses the retry of the line in the deny voice, once, whether the
   * host answered inline or later, and asking again raises a new
   * record.
   */
  async answer(
    decisionId: string,
    outcome: Outcome,
    scope: Scope = Scope.ONCE,
    note = '',
  ): Promise<void> {
    if (outcome === Outcome.ASK) throw new Error('ASK is the question, not an answer')
    for (const key of this.keys()) {
      const records = [...this.records(key)]
      const index = records.findIndex((r) => r.id === decisionId && r.outcome === null)
      if (index === -1) continue
      const record = records[index]
      if (record === undefined) continue
      records[index] = { ...record, outcome, scope, note }
      this.set(key, records)
      await this.flush()
      return
    }
    throw new Error(`no decision waiting with id ${decisionId}`)
  }

  /**
   * The executor's branch for an Ask: settled records answer it, else
   * the question is raised now.
   *
   * Every rule the ask names has to be answered, because each won a
   * subject of its own and a nod covers the subject it was given for.
   * They are asked one at a time, the retry of the line raising the
   * next, and a ONCE grant is only spent once the whole line is
   * answered: spending one while another is still waiting would make
   * the first question come back on every retry. Once the line IS
   * answered, the pass that runs it spends every ONCE grant behind it,
   * the ones already on file and the one a host gave inline moments
   * ago alike, so a nod never outlives the line it was given for.
   *
   * A refusal is deliberately not spent by the line it was given for.
   * The record stands to refuse the agent's immediate retry of the
   * same line from the ledger, and is spent by that retry, so a human
   * who said no is not asked twice about it; the run after that is an
   * open question again.
   *
   * @param ctx the classified command being admitted.
   * @param ask the chain's Ask.
   * @param signal the run's abort signal, so a question outlives
   *   neither its run's deadline nor a caller's kill.
   * @param claimant the reading command and its line, null outside a
   *   line (a bare chain). A claimed grant is on offer to a reader at
   *   the occurrence it was claimed for, on the same line or one
   *   evaluated from it, and to nobody else: not to another spelling
   *   of the command on the line, and not to another line judged at
   *   the same time.
   * @param judging true for a pass that judges the line on behalf of
   *   the one that runs it — the env pre-pass, the compound-line pass
   *   that judges every command before any runs, and the pass over a
   *   line a runtime takes whole. Nothing is spent then: every ONCE
   *   grant behind the command, the one the host gives now and any
   *   already on file, is claimed on the line's hand-off for the
   *   claimant's occurrence, for the gate behind the pass, which runs
   *   the line and spends them. False for that gate.
   * @returns the refusal, the question left waiting, an Abandoned for a
   *   run killed mid-question, or null to run.
   */
  async resolve(
    ctx: CommandContext,
    ask: Ask,
    signal?: AbortSignal,
    claimant: Claimant | null = null,
    judging = false,
  ): Promise<Deny | Pending | Abandoned | null> {
    const rules = ask.rules ?? [askRule(ctx, ask)]
    const argv = [ctx.command, ...ctx.argv]
    const sessionId = ctx.sessionId ?? ''
    const held = this.standing(sessionId, claimant)
    const answers = rules.map(
      (rule) => [rule, Decisions.settled(held, rule, argv, ctx.cwd)] as const,
    )
    const refused = answers.find(([, r]) => r !== null && r.outcome === Outcome.DENY)
    if (refused !== undefined) {
      // A standing refusal refuses this line in place, whichever pass reads
      // it: a line that does not run has no later pass to hand anything to.
      await this.spend(
        sessionId,
        answers
          .map(([, r]) => r)
          .filter((r): r is Decision => r !== null && r.scope === Scope.ONCE),
      )
      return { kind: 'deny', reason: refused[0].reason, scope: 'command' }
    }
    for (const [rule, record] of answers) {
      if (record !== null) continue
      const action = await this.raise(ctx, rule, argv, signal)
      if (action !== null) return action
    }
    // Every rule is answered and the line may run. The ledger is read again
    // rather than trusting the entry snapshot, because a host that answered
    // inline settled its record during the loop above: without the re-read,
    // the grant it gave THIS line would still be standing for the next
    // identical one, and whoever allowed once would have allowed twice.
    const once = this.onceAnswers(sessionId, rules, argv, ctx.cwd, claimant)
    if (!judging || claimant === null) {
      await this.spend(sessionId, once)
      return null
    }
    const handed = claimant.line
    handed.claimed.push(...once.map((decision) => ({ occurrence: claimant.occurrence, decision })))
    if (once.length > 0) {
      const live = this.live.get(sessionId) ?? new Set<HandOff>()
      live.add(handed)
      this.live.set(sessionId, live)
    }
    return null
  }

  /**
   * Spend every grant claimed on a hand-off that no gate spent.
   *
   * The hand-off in `resolve` leaves the grants behind a command
   * standing for the gate that runs the line, and that gate spends each
   * at the command it was claimed for. Anything that ends the line short
   * of that gate leaves one unspent: the pass refuses the line on a
   * later command, a fetch fails before the run, the run is killed, or
   * a short-circuit skips the command. Either way the grant would stand
   * for the next line spelling that command, which would then run on a
   * nod given to a line that never did, so the executor spends what the
   * gates did not, however the line ended, except when it is held on a
   * question still waiting. A grant a gate already spent is gone from
   * the ledger and is passed over; the hand-off is emptied so a second
   * call is a no-op.
   *
   * @param sessionId the session the line was judged in.
   * @param handed the line's hand-off.
   */
  async revoke(sessionId: string, handed: HandOff): Promise<void> {
    await this.spend(
      sessionId,
      handed.claimed.map((c) => c.decision),
    )
    this.release(sessionId, handed)
  }

  /**
   * Hand the claims made for one part of a line to a run of its own: a
   * background job, whose gates run after the line has returned and
   * which ends on its own clock.
   *
   * Every claim standing inside the scope leaves the line and its
   * ancestors for the new hand-off, so the line's end touches only
   * what its own gates would have spent, whether it revokes or, held on a
   * question still waiting, releases: the job's grants stay reserved
   * until its gates spend them or its own end revokes them. Held on
   * the line's hand-off, a release for a pending foreground gate let
   * go of the job's grants with the rest, and a line judged while the
   * job slept could take them.
   *
   * @param sessionId the session the line was judged in.
   * @param handed the line's hand-off.
   * @param scope the job's node on the line.
   * @returns the job's hand-off, live while it holds a claim.
   */
  split(sessionId: string, handed: HandOff, scope: Occurrence): HandOff {
    const job: HandOff = { claimed: [], parent: handed.parent, origin: handed.origin }
    for (const owner of lineage(handed)) {
      const kept: Claim[] = []
      for (const claim of owner.claimed) {
        if (!encloses(scope, claim.occurrence)) kept.push(claim)
        else if (!job.claimed.some((c) => c.decision === claim.decision)) job.claimed.push(claim)
      }
      owner.claimed.splice(0, owner.claimed.length, ...kept)
    }
    if (job.claimed.length > 0) {
      const live = this.live.get(sessionId) ?? new Set<HandOff>()
      live.add(job)
      this.live.set(sessionId, live)
    }
    return job
  }

  /**
   * Let go of a hand-off's claims without spending them.
   *
   * For a line held on a question still waiting: its retry is a new
   * line with a hand-off of its own, and it has to find the grants this
   * one claimed standing, or the human is asked again for what they
   * already allowed. Left live, the held line would hide them from every
   * line after it.
   */
  release(sessionId: string, handed: HandOff): void {
    handed.claimed.length = 0
    this.live.get(sessionId)?.delete(handed)
  }

  /**
   * The session's records as one line may read them.
   *
   * A claimed grant is on offer to exactly one reader: the command it
   * was claimed for, on the line that claimed it or a line evaluated
   * from that line, whether the pass or the gate is reading. Every
   * other claim is hidden. A grant claimed by another line is that
   * line's to spend, and reading it here would let two lines judged at
   * once both pass on one nod, the second of them running its earlier
   * commands before its gate found the grant gone. A grant claimed for
   * another occurrence on this line is that occurrence's: reading it
   * would let a word that expands at run time into the same command
   * run on the nod a literal spelling was given, and would let one nod
   * answer two spellings. A pass re-reading an occurrence its outer
   * line's pass already claimed finds it answered, which is how a
   * nested line runs on the outer line's questions rather than asking
   * them again.
   */
  private standing(sessionId: string, claimant: Claimant | null): readonly Decision[] {
    const held = this.records(sessionId)
    const own = claimant === null ? [] : lineage(claimant.line)
    const taken: Decision[] = []
    for (const other of this.live.get(sessionId) ?? []) {
      const mine = own.includes(other)
      for (const claim of other.claimed) {
        if (mine && claimant !== null && sameOccurrence(claim.occurrence, claimant.occurrence)) {
          continue
        }
        taken.push(claim.decision)
      }
    }
    if (taken.length === 0) return held
    return held.filter((r) => !taken.some((t) => t === r))
  }

  /** Every ONCE answer standing behind this line, as the ledger holds it now. */
  private onceAnswers(
    sessionId: string,
    rules: readonly CommandRule[],
    argv: readonly string[],
    cwd: string,
    claimant: Claimant | null,
  ): Decision[] {
    const held = this.standing(sessionId, claimant)
    return rules
      .map((rule) => Decisions.settled(held, rule, argv, cwd))
      .filter((r): r is Decision => r !== null && r.scope === Scope.ONCE)
  }

  /**
   * What the settled records alone say about an asked line.
   *
   * The read-only half of `resolve`, and the only half a dry run may
   * take: it consults what the session already holds and stops there,
   * spending nothing, recording no question and never reaching the
   * host. So `explain` can report that a line would be refused, or
   * would still be waiting, without a question arriving for a line
   * nobody typed. It reads through the same reservations a judging
   * pass does, so a grant a live line has claimed reads as waiting here
   * exactly as a run would find it.
   *
   * @param claimant the reading command and its line, null for a dry
   *   run outside any line.
   */
  async held(
    ctx: CommandContext,
    ask: Ask,
    claimant: Claimant | null = null,
  ): Promise<Deny | Pending | null> {
    const argv = [ctx.command, ...ctx.argv]
    const sessionId = ctx.sessionId ?? ''
    const records = this.standing(sessionId, claimant)
    const answers = (ask.rules ?? [askRule(ctx, ask)]).map(
      (rule) => [rule, Decisions.settled(records, rule, argv, ctx.cwd)] as const,
    )
    const refused = answers.find(([, r]) => r !== null && r.outcome === Outcome.DENY)
    if (refused !== undefined) {
      return { kind: 'deny', reason: refused[0].reason, scope: 'command' }
    }
    const unanswered = answers.find(([, r]) => r === null)
    if (unanswered === undefined) return null
    return {
      kind: 'pending',
      id: await decisionId(ctx.sessionId ?? '', ctx.cwd, argv),
      reason: unanswered[0].reason,
    }
  }

  /**
   * Record one rule of a line as a question and put it to the host,
   * null when the host said yes.
   *
   * A question already waiting is reused rather than duplicated, so a
   * retry keeps quoting one id.
   *
   * The host is given the run's signal and the wait is bounded by it,
   * because a host that asks a person can take an unbounded amount of
   * time and the executor's own cooperative abort checks cannot reach
   * inside that wait: without this a killed or timed-out run would sit
   * here until somebody answered.
   *
   * A run killed mid-question is reported as Abandoned and its record is
   * left waiting, with whatever the host eventually says dropped rather
   * than recorded: an ALLOW banked against a run that is already dead
   * would leave a spent-once grant in the ledger for the next identical
   * line to take, with nobody asked.
   *
   * @param ctx the classified command being admitted.
   * @param rule the one rule of the line being asked about.
   * @param argv the line, command name first.
   * @param signal the run's abort signal.
   * @returns the refusal, the question left waiting, an Abandoned for a
   *   run killed mid-question, or null to run.
   */
  private async raise(
    ctx: CommandContext,
    rule: CommandRule,
    argv: readonly string[],
    signal?: AbortSignal,
  ): Promise<Deny | Pending | Abandoned | null> {
    let record = this.waiting(ctx, rule, argv)
    if (record === null) {
      record = {
        id: await decisionId(ctx.sessionId ?? '', ctx.cwd, argv),
        sessionId: ctx.sessionId ?? '',
        agentId: ctx.agentId ?? '',
        command: ctx.command,
        argv: [...ctx.argv],
        cwd: ctx.cwd,
        paths: ctx.paths.map((p) => p.virtual),
        reason: rule.reason,
        rule,
        outcome: null,
        scope: Scope.ONCE,
        note: '',
      }
      this.add(ctx.sessionId ?? '', record)
      await this.flush()
    }
    const onAsk = this.onAsk
    if (onAsk === null) return { kind: 'pending', id: record.id, reason: rule.reason }
    const said = await answered(() => onAsk(record, signal), signal)
    if (isAbandoned(said)) return said
    if (said?.outcome == null) {
      return { kind: 'pending', id: record.id, reason: rule.reason }
    }
    await this.answer(record.id, said.outcome, said.scope, said.note)
    if (said.outcome === Outcome.DENY) {
      return { kind: 'deny', reason: rule.reason, scope: 'command' }
    }
    return null
  }

  /** The question already recorded for this rule of this line. */
  private waiting(
    ctx: CommandContext,
    rule: CommandRule,
    argv: readonly string[],
  ): Decision | null {
    for (const record of this.records(ctx.sessionId ?? '')) {
      if (record.outcome === null && sameRule(record.rule, rule) && sameLine(record, argv, ctx.cwd))
        return record
    }
    return null
  }

  /**
   * The answered record standing behind one rule of a line, null when
   * nobody has answered it.
   */
  private static settled(
    held: readonly Decision[],
    rule: CommandRule,
    argv: readonly string[],
    cwd: string,
  ): Decision | null {
    for (const record of held) {
      if (record.scope === Scope.ONCE && covers(record, rule, argv, cwd)) return record
    }
    for (const record of held) {
      if (record.scope === Scope.SESSION && covers(record, rule, argv, cwd)) return record
    }
    return null
  }

  /** Drop the ONCE answers this line just used up. */
  private async spend(sessionId: string, spent: readonly Decision[]): Promise<void> {
    if (spent.length === 0) return
    const held = this.records(sessionId)
    this.set(
      sessionId,
      held.filter((r) => !spent.some((s) => s === r)),
    )
    await this.flush()
  }

  private keys(): string[] {
    if (this.sessions !== null) return [...this.sessions.decisionSessions()]
    return [...this.memory.keys()]
  }

  private records(sessionId: string): readonly Decision[] {
    if (this.sessions !== null) return this.sessions.decisionsOf(sessionId)
    return this.memory.get(sessionId) ?? []
  }

  private set(sessionId: string, records: Decision[]): void {
    if (this.sessions !== null) this.sessions.setDecisions(sessionId, records)
    else this.memory.set(sessionId, records)
  }

  private add(sessionId: string, record: Decision): void {
    this.set(sessionId, [...this.records(sessionId), record])
  }

  private async flush(): Promise<void> {
    if (this.sessions !== null) await this.sessions.flush()
  }
}
