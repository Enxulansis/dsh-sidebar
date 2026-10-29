import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { ConversationProjector } from '../src/conversation.js'
import type { HistoryEntry } from '../src/dsh-client.js'
import { earliestHistorySequence, mergeHistoryEntries } from '../src/history.js'
import { buildRailNodeTables, deriveOutlinePieces } from '../src/rail-nodes.js'
import { readHistoryRail } from '../src/history-scan.js'
import { buildSessionEntries, emptySearchIndex, searchSessionIndex } from '../src/session-search-index.js'

// Execute the production controller method with real projection and deterministic RPC pages.
const file = ts.createSourceFile('extension.ts', readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const controller = file.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'DshChatController') as ts.ClassDeclaration
const method = controller.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(file) === 'projectSessionWithRail')!
const outline = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'turnOutlineOf')!
const limits = file.statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => ['RAIL_PULL_MAX_PAGES', 'RAIL_PULL_MAX_EVENTS'].includes(d.name.getText(file))))
const code = ts.transpileModule(limits.map(n => n.getText(file)).join('\n') + outline.getText(file) + 'class Probe {' + method.getText(file) + '}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const Probe = new Function('ConversationProjector', 'earliestHistorySequence', 'deriveOutlinePieces', 'buildRailNodeTables', 'mergeHistoryEntries', 'readHistoryRail', code + ';return Probe;')(ConversationProjector, earliestHistorySequence, deriveOutlinePieces, buildRailNodeTables, mergeHistoryEntries, readHistoryRail)
const surface = file.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'DshSurface') as ts.ClassDeclaration
const scopeMethods = surface.members.filter(n => ts.isMethodDeclaration(n) && ['captureSearchScope', 'isSearchScopeCurrent', 'dispose'].includes(n.name.getText(file)))
const scopeCode = ts.transpileModule('class ScopeProbe {' + scopeMethods.map(n => n.getText(file)).join('\n') + '}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const ScopeProbe = new Function('EXT_CONTEXT', scopeCode + ';return ScopeProbe;')(undefined)

function events(start: number, count: number, stride = 1000): HistoryEntry[] {
  return Array.from({ length: count }, (_, offset) => {
    const seq = start + offset, turn = Math.floor((seq - 1) / stride) + 1
    const at = (seq - 1) % stride
    const event = at === 0 ? { type: 'turn/start', seq, time: seq, data: { turn } }
      : at === 1 ? { type: 'user/message', seq, time: seq, data: { id: 'u' + turn, source: { kind: 'user' }, content: [{ type: 'text', text: 'prompt-' + turn + ' needle' }] } }
      : at === 2 ? { type: 'assistant/message', seq, time: seq, data: { turn, step: 1, message: { content: [{ type: 'text', text: 'answer-' + turn }] } } }
      : { type: 'step/end', seq, time: seq, data: { turn, step: 1 } }
    return { event }
  })
}
type Page = { events: HistoryEntry[]; hasMore: boolean }
function setup(pages: Page[], totalTurns = 0, stride = 1000) {
  const p = new Probe(), calls: Array<{ limit: number; cursor?: number }> = [], logs: string[] = []
  const client = { historyQuiet: async (_session: string, limit?: number, cursor?: number, _signal?: AbortSignal) => {
    calls.push({ limit: limit ?? 500, cursor }); const page = pages.shift(); if (!page) throw new Error('Unexpected extra page'); return page
  }, projectionsQuiet: async (_session: string, _signal?: AbortSignal): Promise<{ asOfSeq?: number; values: Record<string, unknown> }> => {
    if (!totalTurns) throw new Error('Unexpected snapshot')
    return { asOfSeq: totalTurns * stride, values: { turnOutline: Array.from({ length: totalTurns }, (_, i) => ({ turn: i + 1, seq: i * stride + 1, prompt: 'prompt-' + (i + 1) })) } }
  } }
  Object.assign(p, { client, requireClient: () => client, historyPullLimit: () => 3000, output: { appendLine: (line: string) => logs.push(line) },
    summaries: totalTurns ? [{ sessionId: 's', projections: { values: { turnOutline: Array.from({ length: totalTurns }, (_, i) => ({ turn: i + 1, seq: i * stride + 1, prompt: 'prompt-' + (i + 1) })) } } }] : [] })
  return { p, client, calls, logs }
}

describe('long-session production projection and search coverage', () => {
  it.each(['workspace', 'runtime', 'dispose'])('cancels owned rail work on %s change while keeping the new scope independent', mode => {
    const p = new ScopeProbe()
    Object.assign(p, { disposed: false, railAbort: new AbortController(), controller: { state: { cwd: 'a' }, runtimeGeneration: 1 }, railBuilds: new Map(), railNodeTables: new Map(), dirtyIndexSessions: new Set(), indexChanges: new Map(), searchGeneration: 0, disposables: [] })
    const scope = p.captureSearchScope(), signal = p.railAbort.signal
    expect(p.captureSearchScope()).toBe(scope)
    expect(signal.aborted).toBe(false)
    if (mode === 'dispose') p.dispose()
    else {
      if (mode === 'workspace') p.controller.state.cwd = 'b'
      else p.controller.runtimeGeneration += 1
      const next = p.captureSearchScope()
      expect(p.isSearchScopeCurrent(next)).toBe(true)
      expect(p.railAbort.signal.aborted).toBe(false)
    }
    expect(signal.aborted).toBe(true)
    expect(p.isSearchScopeCurrent(scope)).toBe(false)
  })

  it('pulls the first page plus at most five supplements, leaving full-outline prefix turns navigable', async () => {
    const pages = Array.from({ length: 7 }, (_, i) => ({ events: events((6 - i) * 1000 + 1, 1000), hasMore: i < 6 }))
    const { p, calls } = setup(pages, 7), result = await p.projectSessionWithRail('s')
    expect(calls).toHaveLength(7)
    expect(calls.map(call => call.cursor)).toEqual([undefined, 6001, 5001, 4001, 3001, 2001, 1001])
    expect(calls.slice(0, 6).every(call => call.limit === 20_000)).toBe(true)
    expect(calls[6].limit).toBe(2000)
    expect(result.rail.segment.map((n: { key: string }) => n.key)).toEqual(['s2', 's1002', 's2002', 's3002', 's4002', 's5002', 's6002'])
    expect(result.rail.segment[0]).toEqual({ seq: 2, mid: 'u1', key: 's2' })
    expect(result.messages.map((m: { id: string }) => m.id)).toEqual(['u7', 'assistant:7:1'])
  })

  it('stops exactly at the 100,000-event pre-request threshold', async () => {
    const pages = Array.from({ length: 7 }, (_, i) => ({ events: events((6 - i) * 20_000 + 1, 20_000), hasMore: i < 6 }))
    const { p, calls } = setup(pages, 140), result = await p.projectSessionWithRail('s')
    expect(calls).toHaveLength(7)
    expect(calls.slice(0, 5).every(call => call.limit === 20000)).toBe(true)
    expect(calls.slice(5).every(call => call.limit === 2000)).toBe(true)
    expect(result.rail.segment).toHaveLength(140)
    expect(result.rail.segment.filter((n: { mid: string | null }) => n.mid === null)).toHaveLength(0)
    expect(result.messages).toHaveLength(40)
  })

  it('finishes the final page rather than slicing it when the threshold is crossed', async () => {
    const pages = [{ events: events(110001, 10_000), hasMore: true }, ...Array.from({ length: 5 }, (_, i) => ({ events: events(90001 - i * 20_000, 20_000), hasMore: true })), { events: events(1, 10000), hasMore: false }]
    const { p, calls } = setup(pages, 120), started = performance.now(), result = await p.projectSessionWithRail('s')
    expect(calls).toHaveLength(7)
    expect(result.rail.segment).toHaveLength(120)
    expect(result.rail.segment.filter((n: { mid: string | null }) => n.mid === null)).toHaveLength(0)
    expect(result.rail.segment.at(-1).mid).toBe('u120')
    console.info('long-session 110000 real-shaped events:', JSON.stringify({ milliseconds: Math.round(performance.now() - started), heapMiB: Math.round(process.memoryUsage().heapUsed / 1048576), nodes: result.rail.segment.length, RPCs: calls.length }))
  })

  it('uses the same loaded-node identities after truncation and full projection, while prefix detail is bounded', async () => {
    const { p } = setup(Array.from({ length: 7 }, (_, i) => ({ events: events((6 - i) * 1000 + 1, 1000), hasMore: i < 6 })), 7)
    const result = await p.projectSessionWithRail('s')
    const projector = new ConversationProjector(); projector.reset(events(1, 7000))
    const full = buildRailNodeTables({ messages: projector.iterMessages(), stops: [], outline: deriveOutlinePieces([1, 1001, 2001, 3001, 4001, 5001, 6001], projector.iterMessages()) })
    expect(result.rail.segment.slice(-6)).toEqual(full.segment.slice(-6))
    expect(result.rail.segment).toEqual(full.segment)
    const index = emptySearchIndex(); index.sessions.s = { revision: 1, entries: buildSessionEntries(result.messages), rail: result.rail }
    expect(searchSessionIndex(index, 'prompt-1')).toEqual([])
    expect(searchSessionIndex(index, 'prompt-7')[0]).toMatchObject({ messageId: 'u7', seq: 6002 })
  })

  it('acquires a cold full outline beyond the page boundary without enlarging the search window', async () => {
    const { p, client, calls } = setup(Array.from({ length: 7 }, (_, i) => ({ events: events((6 - i) * 1000 + 1, 1000), hasMore: i < 6 })))
    let snapshots = 0
    client.projectionsQuiet = async session => {
      expect(session).toBe('s'); snapshots += 1
      return { asOfSeq: 7000, values: { turnOutline: Array.from({ length: 7 }, (_, i) => ({ seq: i * 1000 + 1, turn: i + 1, prompt: 'prompt-' + (i + 1) })) } }
    }
    const result = await p.projectSessionWithRail('s')
    expect(result.rail.turn.map((n: { seq: number }) => n.seq)).toEqual([1, 1001, 2001, 3001, 4001, 5001, 6001])
    expect(result.rail.segment[0]).toEqual({ seq: 2, mid: 'u1', key: 's2' })
    expect(result.messages.map((m: { id: string }) => m.id)).toEqual(['u7', 'assistant:7:1'])
    expect(calls).toHaveLength(7)
    expect(snapshots).toBe(0)
  })

  it('does not need a snapshot when all events were obtained', async () => {
    const { p } = setup([{ events: events(1, 1000), hasMore: false }])
    expect((await p.projectSessionWithRail('s')).rail.turn).toHaveLength(1)
  })

  it('matches early approval and split ask-user detail against complete projection beyond the 100000-event cap', async () => {
    const all = events(1, 140000)
    const put = (seq: number, type: string, data: Record<string, unknown>) => { all[seq - 1] = { event: { seq, type, time: seq, data } } }
    put(4, 'approval/decided', { id: 'a', outcome: 'approved' })
    put(5, 'assistant/message', { turn: 1, step: 2, message: { content: [{ type: 'text', text: 'after approval' }] } })
    put(19999, 'tool/call', { callId: 'q', name: 'ask_user_question' })
    put(20001, 'tool/result', { message: { source: { callId: 'q' }, content: [{ type: 'text', text: 'answered' }] } })
    put(20002, 'assistant/message', { turn: 21, step: 2, message: { content: [{ type: 'text', text: 'after question' }] } })
    const pages = Array.from({ length: 7 }, (_, i) => ({ events: all.slice((6 - i) * 20000, (7 - i) * 20000), hasMore: i < 6 }))
    const { p, calls } = setup(pages), result = await p.projectSessionWithRail('s')
    const projector = new ConversationProjector(); projector.reset(all)
    const messages = projector.iterMessages(), starts = all.filter(e => e.event.type === 'turn/start').map(e => e.event.seq)
    expect(result.rail).toEqual(buildRailNodeTables({ messages, stops: projector.segmentStops(), outline: deriveOutlinePieces(starts, messages) }))
    expect(result.rail.segment.find((n: { mid: string }) => n.mid === 'approval:a')).toMatchObject({ seq: 4, stop: true })
    expect(result.rail.segment.find((n: { mid: string }) => n.mid === 'tool:q')).toMatchObject({ seq: 19999, stop: true })
    expect(result.messages).toHaveLength(40)
    expect(calls.slice(5).every(c => c.limit === 2000)).toBe(true)
  })

  it('uses complete events when a nonempty summary lags the newest turn', async () => {
    const { p } = setup([{ events: events(1, 2000), hasMore: false }], 1)
    expect((await p.projectSessionWithRail('s')).rail.turn.map((n: { seq: number }) => n.seq)).toEqual([1, 1001])
  })

  it('ignores summary turns outside the complete event snapshot', async () => {
    const { p, client } = setup([{ events: events(1, 1000), hasMore: false }], 2)
    client.projectionsQuiet = async () => { throw new Error('Unexpected snapshot') }
    expect((await p.projectSessionWithRail('s')).rail.turn.map((n: { seq: number }) => n.seq)).toEqual([1])
  })

  it.each(['failed', 'client-replaced', 'canceled'])('does not publish stale prefix work: %s', async mode => {
    const { p, client } = setup(Array.from({ length: 6 }, (_, i) => ({ events: events((6 - i) * 1000 + 1, 1000), hasMore: true })))
    const abort = new AbortController()
    const original = client.historyQuiet
    client.historyQuiet = async (session, limit, cursor, signal) => {
      if (limit !== 2000) return original(session, limit, cursor)
      expect(signal).toBe(abort.signal)
      if (mode === 'failed') throw new Error('prefix failed')
      if (mode === 'client-replaced') p.client = {}
      if (mode === 'canceled') abort.abort()
      return { events: events(1, 1000), hasMore: false }
    }
    if (mode === 'client-replaced') expect(await p.projectSessionWithRail('s', abort.signal)).toEqual({ messages: [], rail: { segment: [], turn: [] } })
    else await expect(p.projectSessionWithRail('s', abort.signal)).rejects.toThrow(mode === 'failed' ? 'prefix failed' : 'aborted')
  })

  it.each([
    { name: 'empty older page', older: [] },
    { name: 'repeated page', older: events(1001, 1000) },
    { name: 'invalid cursor', older: [{ event: { type: 'step/end', seq: NaN, time: 0, data: {} } }] },
  ])('stops on $name without corrupting the initial search window', async ({ older }) => {
    const { p } = setup([{ events: events(1001, 1000), hasMore: true }, { events: older, hasMore: true }], 2)
    await expect(p.projectSessionWithRail('s')).rejects.toThrow()
  })

  it.each([1, 2])('discards projection when the client changes during request %i', async request => {
    const { p, client } = setup([]); let called = 0
    client.historyQuiet = async () => { called += 1; if (called === request) p.client = {}; return { events: events(called === 1 ? 1001 : 1, 1000), hasMore: called === 1 } }
    expect(await p.projectSessionWithRail('s')).toEqual({ messages: [], rail: { segment: [], turn: [] } })
    expect(called).toBe(request)
  })

  it('propagates supplement errors instead of persisting a partial result as complete', async () => {
    const { p, client } = setup([]); let called = 0
    client.historyQuiet = async () => { if (++called === 2) throw new Error('fixture failure'); return { events: events(1001, 1000), hasMore: true } }
    await expect(p.projectSessionWithRail('s')).rejects.toThrow('fixture failure')
  })

  it('deduplicates overlapping older pages so a turn cannot acquire two ordinal slots', async () => {
    const { p } = setup([{ events: events(1001, 1000), hasMore: true }, { events: events(1, 2000), hasMore: false }])
    const result = await p.projectSessionWithRail('s')
    expect(result.rail.turn.map((n: { seq: number }) => n.seq)).toEqual([1, 1001])
    expect(new Set(result.rail.turn.map((n: { key: string }) => n.key)).size).toBe(result.rail.turn.length)
    expect(result.messages.map((m: { id: string }) => m.id)).toEqual(['u2', 'assistant:2:1'])
  })
})
