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

import { describe, expect, it } from 'vitest'

import { Decisions, askRule, covers, decisionId } from './decisions.ts'
import { Outcome, Scope } from './types.ts'
import type { Ask, CommandContext, CommandRule, Decision, HandOff } from './types.ts'

const RULE: CommandRule = { reason: 'sign-off', commands: ['git push'], paths: [], mount: '' }
const ASK: Ask = { kind: 'ask', reason: 'sign-off', rule: RULE }

function ctx(sessionId = 's', argv: readonly string[] = ['push']): CommandContext {
  return {
    command: 'git',
    argv,
    paths: [],
    operands: [],
    cwd: '/repo',
    sessionId,
    registry: { isMountRoot: () => false },
    tokens: ['git', ...argv],
  } as unknown as CommandContext
}

function record(over: Partial<Decision> = {}): Decision {
  return {
    id: 'd1',
    sessionId: 's',
    agentId: '',
    command: 'git',
    argv: ['push'],
    cwd: '/repo',
    paths: [],
    reason: 'sign-off',
    rule: RULE,
    outcome: null,
    scope: Scope.ONCE,
    note: '',
    ...over,
  }
}

describe('decisions', () => {
  it('names a record stably for the same line and session', async () => {
    const same = await decisionId('s', '/repo', ['git', 'push'])
    expect(same).toBe(await decisionId('s', '/repo', ['git', 'push']))
    expect(same).not.toBe(await decisionId('other', '/repo', ['git', 'push']))
    expect(same).not.toBe(await decisionId('s', '/elsewhere', ['git', 'push']))
    expect(same).toHaveLength(12)
  })

  it('synthesizes a rule over the program for a coded ask', () => {
    expect(askRule(ctx(), ASK)).toBe(RULE)
    const coded = askRule(ctx(), { kind: 'ask', reason: 'sign-off' })
    expect(coded.commands).toEqual(['git'])
    expect(coded.reason).toBe('sign-off')
  })

  it('reads scope in covers and never answers a waiting record', () => {
    const argv = ['git', 'push']
    expect(covers(record(), RULE, argv, '/repo')).toBe(false)
    const once = record({ outcome: Outcome.ALLOW, scope: Scope.ONCE })
    expect(covers(once, RULE, argv, '/repo')).toBe(true)
    // A ONCE answer is for the exact line, so a different line or a
    // different directory is not it.
    expect(covers(once, RULE, ['git', 'push', '-f'], '/repo')).toBe(false)
    expect(covers(once, RULE, argv, '/elsewhere')).toBe(false)
    // A SESSION answer covers any line the same rule asks about.
    const forever = record({ outcome: Outcome.ALLOW, scope: Scope.SESSION })
    expect(covers(forever, RULE, ['git', 'push', '-f'], '/elsewhere')).toBe(true)
    // An answer never answers a rule it was not given for: a persisted
    // record reopened under an edited profile must not speak for the
    // new rule.
    const other: CommandRule = { ...RULE, reason: 'different' }
    expect(covers(forever, other, argv, '/repo')).toBe(false)
  })

  it('records a question once and answers it once', async () => {
    const ledger = new Decisions()
    const first = await ledger.resolve(ctx(), ASK)
    expect(first?.kind).toBe('pending')
    // A retry reuses the record rather than filing a second one, so the
    // agent keeps quoting one id.
    const again = await ledger.resolve(ctx(), ASK)
    expect(again?.kind === 'pending' && again.id).toBe(first?.kind === 'pending' && first.id)
    expect(ledger.pending()).toHaveLength(1)
    const id = first?.kind === 'pending' ? first.id : ''
    await ledger.answer(id, Outcome.ALLOW, Scope.ONCE)
    expect(ledger.pending()).toEqual([])
    expect(ledger.list()).toHaveLength(1)
    expect(await ledger.resolve(ctx(), ASK)).toBeNull()
    // ONCE is consumed by the line it answered, so the next asks again.
    expect((await ledger.resolve(ctx(), ASK))?.kind).toBe('pending')
  })

  it('keeps a session answer and refuses on a deny', async () => {
    const ledger = new Decisions()
    const pending = await ledger.resolve(ctx(), ASK)
    await ledger.answer(pending?.kind === 'pending' ? pending.id : '', Outcome.ALLOW, Scope.SESSION)
    for (let i = 0; i < 3; i += 1) expect(await ledger.resolve(ctx(), ASK)).toBeNull()

    const refused = new Decisions()
    const asked = await refused.resolve(ctx(), ASK)
    await refused.answer(asked?.kind === 'pending' ? asked.id : '', Outcome.DENY)
    const action = await refused.resolve(ctx(), ASK)
    expect(action?.kind).toBe('deny')
    expect(action?.kind === 'deny' && action.reason).toBe('sign-off')
  })

  it('reads without recording or spending in held', async () => {
    const ledger = new Decisions()
    // Nothing is on file, so held reports waiting and files nothing.
    for (let i = 0; i < 3; i += 1) expect((await ledger.held(ctx(), ASK))?.kind).toBe('pending')
    expect(ledger.list()).toEqual([])
    const pending = await ledger.resolve(ctx(), ASK)
    await ledger.answer(pending?.kind === 'pending' ? pending.id : '', Outcome.ALLOW, Scope.ONCE)
    // Reading it does not spend it: the run that follows still passes.
    expect(await ledger.held(ctx(), ASK)).toBeNull()
    expect(await ledger.held(ctx(), ASK)).toBeNull()
    expect(await ledger.resolve(ctx(), ASK)).toBeNull()
  })

  it('rejects ASK as an answer and an unknown id', async () => {
    const ledger = new Decisions()
    const pending = await ledger.resolve(ctx(), ASK)
    const id = pending?.kind === 'pending' ? pending.id : ''
    await expect(ledger.answer(id, Outcome.ASK)).rejects.toThrow(/not an answer/)
    await expect(ledger.answer('nosuchid', Outcome.ALLOW)).rejects.toThrow(/no decision waiting/)
    // Answering twice is answering an id nothing is waiting on.
    await ledger.answer(id, Outcome.ALLOW)
    await expect(ledger.answer(id, Outcome.DENY)).rejects.toThrow(/no decision waiting/)
  })

  it('leaves nothing waiting when a host answers inside the line', async () => {
    const allow = (r: Decision): Promise<Decision> =>
      Promise.resolve({ ...r, outcome: Outcome.ALLOW, scope: Scope.SESSION })
    const ledger = new Decisions(null, allow)
    expect(await ledger.resolve(ctx(), ASK)).toBeNull()
    expect(ledger.pending()).toEqual([])
    expect(ledger.list()).toHaveLength(1)

    const waiting = new Decisions(null, () => Promise.resolve(null))
    expect((await waiting.resolve(ctx(), ASK))?.kind).toBe('pending')
    expect(waiting.pending()).toHaveLength(1)
  })

  it('spends an inline grant on the line that asked, not the next one', async () => {
    // The host answers while the line waits, so the grant belongs to that
    // line: allowing once must not let the next identical line through with
    // nobody asked.
    let asked = 0
    const allow = (r: Decision): Promise<Decision> => {
      asked += 1
      return Promise.resolve({ ...r, outcome: Outcome.ALLOW, scope: Scope.ONCE })
    }
    const ledger = new Decisions(null, allow)
    expect(await ledger.resolve(ctx(), ASK)).toBeNull()
    expect(await ledger.resolve(ctx(), ASK)).toBeNull()
    expect(asked).toBe(2)

    // A refusal is the other way round, by design: the human who said no is
    // not asked about the agent's immediate retry. The record stands to
    // refuse that retry, is spent by it, and the run after is a new question.
    let refusals = 0
    const deny = (r: Decision): Promise<Decision> => {
      refusals += 1
      return Promise.resolve({ ...r, outcome: Outcome.DENY, scope: Scope.ONCE })
    }
    const refused = new Decisions(null, deny)
    for (const expected of [1, 1, 2]) {
      expect((await refused.resolve(ctx(), ASK))?.kind).toBe('deny')
      expect(refusals).toBe(expected)
    }

    // A SESSION answer still stands for the rest of the session.
    const forever = new Decisions(null, (r: Decision) =>
      Promise.resolve({ ...r, outcome: Outcome.ALLOW, scope: Scope.SESSION }),
    )
    for (let i = 0; i < 3; i += 1) expect(await forever.resolve(ctx(), ASK)).toBeNull()
  })

  it('spends nothing on a hand-off, so the pass that follows finds every grant', async () => {
    // The pass that judges a line on the gate's behalf asks and leaves the
    // answer standing; the gate runs the line and spends it. One question
    // per run, and a grant already on file when the hand-off began is left
    // exactly as untouched as the one the host gives during it.
    let asked = 0
    const allow = (r: Decision): Promise<Decision> => {
      asked += 1
      return Promise.resolve({ ...r, outcome: Outcome.ALLOW, scope: Scope.ONCE })
    }
    const ledger = new Decisions(null, allow)
    const first: HandOff = { claimed: [], holders: 1 }
    expect(await ledger.resolve(ctx(), ASK, undefined, first, true)).toBeNull()
    expect(await ledger.resolve(ctx(), ASK, undefined, first)).toBeNull()
    expect(asked).toBe(1)
    expect(await ledger.resolve(ctx(), ASK)).toBeNull()
    expect(asked).toBe(2)

    const other: CommandRule = {
      reason: 'twice over',
      commands: ['git push'],
      paths: [],
      mount: '',
    }
    const both: Ask = { kind: 'ask', reason: 'sign-off', rules: [RULE, other] }
    // The first rule is granted to a line that was then held, which
    // releases its claim; the second during this line's own pass.
    const earlier: HandOff = { claimed: [], holders: 1 }
    expect(await ledger.resolve(ctx(), ASK, undefined, earlier, true)).toBeNull()
    ledger.release('s', earlier)
    const line: HandOff = { claimed: [], holders: 1 }
    expect(await ledger.resolve(ctx(), both, undefined, line, true)).toBeNull()
    expect(asked).toBe(4)
    // The gate finds both standing and asks nothing.
    expect(await ledger.resolve(ctx(), both, undefined, line)).toBeNull()
    expect(asked).toBe(4)
    expect(ledger.list('s')).toEqual([])
  })

  it('asks again once a hand-off is revoked', async () => {
    // A grant handed off to a line that was then refused is handed back,
    // and the next identical line is a question again.
    let asked = 0
    const allow = (r: Decision): Promise<Decision> => {
      asked += 1
      return Promise.resolve({ ...r, outcome: Outcome.ALLOW, scope: Scope.ONCE })
    }
    const ledger = new Decisions(null, allow)
    const handed: HandOff = { claimed: [], holders: 1 }
    expect(await ledger.resolve(ctx(), ASK, undefined, handed, true)).toBeNull()
    expect(ledger.list('s')).toHaveLength(1)
    expect(handed.claimed).toEqual(ledger.list('s'))
    await ledger.revoke('s', handed)
    expect(ledger.list('s')).toEqual([])
    expect(handed.claimed).toEqual([])
    expect(await ledger.resolve(ctx(), ASK)).toBeNull()
    expect(asked).toBe(2)
  })

  it('claims a grant for one occurrence of a command on a hand-off', async () => {
    // A command spelled twice on one line is two questions: the grant the
    // first spelling claimed is not standing for the second, and the gate
    // behind the pass spends one per spelling.
    let asked = 0
    const allow = (r: Decision): Promise<Decision> => {
      asked += 1
      return Promise.resolve({ ...r, outcome: Outcome.ALLOW, scope: Scope.ONCE })
    }
    const ledger = new Decisions(null, allow)
    const handed: HandOff = { claimed: [], holders: 1 }
    expect(await ledger.resolve(ctx(), ASK, undefined, handed, true)).toBeNull()
    expect(await ledger.resolve(ctx(), ASK, undefined, handed, true)).toBeNull()
    expect(asked).toBe(2)
    expect(handed.claimed).toHaveLength(2)
    expect(ledger.list('s')).toHaveLength(2)
    expect(await ledger.resolve(ctx(), ASK, undefined, handed)).toBeNull()
    expect(await ledger.resolve(ctx(), ASK, undefined, handed)).toBeNull()
    expect(asked).toBe(2)
    expect(ledger.list('s')).toEqual([])
  })

  it('keeps a grant one line claimed off offer to another', async () => {
    // Two lines judged at once cannot both pass on one nod: the grant the
    // first line claimed is invisible to the second line's pass and to a
    // gate outside any line, and only the first line's own gate spends it.
    const ledger = new Decisions()
    const waiting = await ledger.resolve(ctx(), ASK)
    if (waiting?.kind !== 'pending') throw new Error('unreachable')
    await ledger.answer(waiting.id, Outcome.ALLOW)
    const first: HandOff = { claimed: [], holders: 1 }
    const second: HandOff = { claimed: [], holders: 1 }
    expect(await ledger.resolve(ctx(), ASK, undefined, first, true)).toBeNull()
    expect((await ledger.resolve(ctx(), ASK, undefined, second, true))?.kind).toBe('pending')
    expect((await ledger.resolve(ctx(), ASK))?.kind).toBe('pending')
    expect(await ledger.resolve(ctx(), ASK, undefined, first)).toBeNull()
    expect(ledger.pending('s')).toHaveLength(1)
    expect(ledger.list('s')).toHaveLength(1)
    // Released at the line's end, a claim no longer hides anything.
    await ledger.revoke('s', first)
    await ledger.answer(ledger.pending('s')[0]?.id ?? '', Outcome.ALLOW)
    expect(await ledger.resolve(ctx(), ASK, undefined, second, true)).toBeNull()
  })

  it('spends a borrowed hand-off at its last holder', async () => {
    // A background job borrows the line's hand-off before the line
    // returns, so the line's own revoke leaves the claims standing for the
    // job's gates, and the job's revoke spends them.
    const ledger = new Decisions()
    const waiting = await ledger.resolve(ctx(), ASK)
    if (waiting?.kind !== 'pending') throw new Error('unreachable')
    await ledger.answer(waiting.id, Outcome.ALLOW)
    const handed: HandOff = { claimed: [], holders: 1 }
    expect(await ledger.resolve(ctx(), ASK, undefined, handed, true)).toBeNull()
    ledger.borrow(handed)
    await ledger.revoke('s', handed)
    expect(ledger.list('s')).toHaveLength(1)
    expect(await ledger.resolve(ctx(), ASK, undefined, handed)).toBeNull()
    await ledger.revoke('s', handed)
    expect(ledger.list('s')).toEqual([])
  })

  it('reads held through a live line’s claim', async () => {
    // A dry run reports what a run would find: a grant one line has
    // claimed reads as waiting to everyone else, and as answered to that
    // line.
    const ledger = new Decisions()
    const waiting = await ledger.resolve(ctx(), ASK)
    if (waiting?.kind !== 'pending') throw new Error('unreachable')
    await ledger.answer(waiting.id, Outcome.ALLOW)
    expect(await ledger.held(ctx(), ASK)).toBeNull()
    const handed: HandOff = { claimed: [], holders: 1 }
    expect(await ledger.resolve(ctx(), ASK, undefined, handed, true)).toBeNull()
    expect((await ledger.held(ctx(), ASK))?.kind).toBe('pending')
    expect((await ledger.held(ctx(), ASK, { claimed: [], holders: 1 }))?.kind).toBe('pending')
    ledger.release('s', handed)
    expect(await ledger.held(ctx(), ASK)).toBeNull()
  })

  it('hands back a grant given before the pass when the line is revoked', async () => {
    // A grant answered out of band is claimed by the pass that reads it
    // exactly as an inline one is, so a refusal hands it back too and the
    // next identical line is a question again.
    const ledger = new Decisions()
    const waiting = await ledger.resolve(ctx(), ASK)
    expect(waiting?.kind).toBe('pending')
    if (waiting?.kind !== 'pending') throw new Error('unreachable')
    await ledger.answer(waiting.id, Outcome.ALLOW)
    const handed: HandOff = { claimed: [], holders: 1 }
    expect(await ledger.resolve(ctx(), ASK, undefined, handed, true)).toBeNull()
    expect(handed.claimed).toHaveLength(1)
    await ledger.revoke('s', handed)
    expect(ledger.list('s')).toEqual([])
    expect((await ledger.resolve(ctx(), ASK))?.kind).toBe('pending')
  })

  it('hands the run signal to the host, so a prompt can be taken down', async () => {
    const seen: (AbortSignal | undefined)[] = []
    const controller = new AbortController()
    const ledger = new Decisions(null, (r, signal) => {
      seen.push(signal)
      return Promise.resolve({ ...r, outcome: Outcome.ALLOW, scope: Scope.ONCE })
    })
    expect(await ledger.resolve(ctx(), ASK, controller.signal)).toBeNull()
    expect(seen).toEqual([controller.signal])
  })

  it('stops waiting on a host when the run it belongs to is killed', async () => {
    const controller = new AbortController()
    const ledger = new Decisions(
      null,
      () =>
        new Promise(() => {
          // A host that never answers: without the bound below, the run
          // waiting on this would outlive its own deadline entirely.
        }),
    )
    const asked = ledger.resolve(ctx(), ASK, controller.signal)
    controller.abort()
    expect(await asked).toEqual({ kind: 'abandoned' })
    // Nobody answered, so the question is still open for whoever asks next.
    expect(ledger.pending()).toHaveLength(1)
  })

  it('puts nothing to a host on behalf of a run already over', async () => {
    const controller = new AbortController()
    controller.abort()
    let asked = false
    const ledger = new Decisions(null, () => {
      asked = true
      return Promise.resolve(null)
    })
    expect(await ledger.resolve(ctx(), ASK, controller.signal)).toEqual({ kind: 'abandoned' })
    expect(asked).toBe(false)
    expect(ledger.pending()).toHaveLength(1)
  })

  it('drops an answer that arrives after the kill instead of recording it', async () => {
    const controller = new AbortController()
    const host: { yes?: () => void } = {}
    const ledger = new Decisions(
      null,
      (r) =>
        new Promise<Decision>((resolve) => {
          host.yes = () => {
            resolve({ ...r, outcome: Outcome.ALLOW, scope: Scope.ONCE })
          }
        }),
    )
    const asked = ledger.resolve(ctx(), ASK, controller.signal)
    controller.abort()
    expect(await asked).toEqual({ kind: 'abandoned' })
    host.yes?.()
    await Promise.resolve()
    // Recording it would leave a spent-once grant behind, and the next
    // identical line would take it without anybody being asked.
    expect(ledger.pending()).toHaveLength(1)
    expect(ledger.list()[0]?.outcome).toBeNull()
  })

  it('swallows a host rejection that arrives after the kill', async () => {
    const controller = new AbortController()
    const host: { fail?: () => void } = {}
    const ledger = new Decisions(
      null,
      () =>
        new Promise<Decision>((_resolve, reject) => {
          host.fail = () => {
            reject(new Error('the approval channel fell over'))
          }
        }),
    )
    const asked = ledger.resolve(ctx(), ASK, controller.signal)
    controller.abort()
    expect(await asked).toEqual({ kind: 'abandoned' })
    // Left unhandled this would surface as an unhandled rejection and
    // take the host process down with it.
    host.fail?.()
    await Promise.resolve()
    expect(ledger.pending()).toHaveLength(1)
  })

  it('lists records per session and across them', async () => {
    const ledger = new Decisions()
    await ledger.resolve(ctx('a'), ASK)
    await ledger.resolve(ctx('b'), ASK)
    expect(ledger.list()).toHaveLength(2)
    expect(ledger.list('a')).toHaveLength(1)
    expect(ledger.list('a')[0]?.sessionId).toBe('a')
    expect(ledger.list('nobody')).toEqual([])
  })
})
