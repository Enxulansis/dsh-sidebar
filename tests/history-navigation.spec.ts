import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, it, expect } from 'vitest'
import { earliestHistorySequence, mergeHistoryEntries, unseenHistoryEntries } from '../src/history.js'

// Execute controller methods with delayed pages. Runtime/VS Code construction is deliberately excluded.
const file = ts.createSourceFile('extension.ts', readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const controller = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'DshChatController') as ts.ClassDeclaration
const names = ['loadOlderHistory', 'fetchOlderHistory', 'loadThroughSequence', 'cancelHistoryNavigation']
const members = controller.members.filter(node => ts.isMethodDeclaration(node) && names.includes(node.name.getText(file)))
const code = ts.transpileModule('class Probe {' + members.map(node => node.getText(file)).join('\n') + '}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const Probe = new Function('earliestHistorySequence', 'unseenHistoryEntries', 'mergeHistoryEntries', 'HISTORY_NAVIGATION_MAX_PAGES', code + ';return Probe;')(earliestHistorySequence, unseenHistoryEntries, mergeHistoryEntries, 12)
const entry = (seq: number) => ({ event: { seq, type: 'test' } })
const tick = () => new Promise(resolve => setImmediate(resolve))
function setup() {
  const p = new Probe()
  const pages: Array<(value: unknown) => void> = []
  const progress: number[] = []
  const ready: unknown[] = []
  Object.assign(p, {
    historyWindowGeneration: 1, historyNavigationGeneration: 0, historyEntries: [entry(100)],
    _state: { sessionId: 's', hasMoreHistory: true, loadingHistory: false },
    client: { history: async () => new Promise(resolve => pages.push(resolve)) },
    requireClient() { return this.client }, historyPullLimit: () => 10,
    publish(patch: unknown) { Object.assign(this._state, patch) },
    projector: { reset() {} }, rememberHistoryWindow() {}, replayUsageLedger() {}, resetTurnMeta() {}, markTurnMeta() {}, messagesPatch: () => ({}), hydrateImages() {},
    diffReviews: { prependHistory: () => [] }, cwd: 'test',
    onRestoreThroughProgress: (_seq: number, count: number) => progress.push(count),
    onRestoreThroughReady: (seq: number, loaded: boolean, reason?: string) => ready.push({ seq, loaded, reason }),
  })
  return { p, pages, progress, ready }
}

describe('background reading-position recovery', () => {
  it('reports completed page counts and only declares ready after the target enters the window', async () => {
    const { p, pages, progress, ready } = setup()
    const task = p.loadThroughSequence(20, 'restore'); await tick()
    expect(progress).toEqual([0]); expect(ready).toEqual([])
    pages.shift()!({ events: [entry(50)], hasMore: true }); await tick()
    expect(progress).toEqual([0, 1]); expect(ready).toEqual([])
    pages.shift()!({ events: [entry(10)], hasMore: true }); await task
    expect(progress).toEqual([0, 1, 2]); expect(ready).toEqual([{ seq: 20, loaded: true, reason: undefined }])
  })

  it('stops progress and continuation after user cancellation while preserving the shared in-flight page', async () => {
    const { p, pages, progress, ready } = setup()
    const task = p.loadThroughSequence(20, 'restore'); await tick(); p.cancelHistoryNavigation()
    pages.shift()!({ events: [entry(50)], hasMore: true }); await task
    expect(progress).toEqual([0]); expect(ready).toEqual([]); expect(pages).toHaveLength(0)
    expect(p.historyEntries[0].event.seq).toBe(50)
  })

  it('reports a current restore failure and releases history loading locks', async () => {
    const { p, ready } = setup()
    p.client.history = async () => { throw new Error('fixture page failure') }
    await p.loadThroughSequence(20, 'restore')
    expect(ready).toEqual([{ seq: 20, loaded: false, reason: 'error' }])
    expect(p.historyLoad).toBeUndefined(); expect(p._state.loadingHistory).toBe(false)
  })

  it('does not report an obsolete failure after a runtime change', async () => {
    const { p, ready, progress } = setup()
    let fail!: (error: Error) => void
    p.client.history = () => new Promise((_resolve, reject) => { fail = reject })
    const task = p.loadThroughSequence(20, 'restore'); await tick(); p.client = {}
    fail(new Error('old page failure')); await task
    expect(ready).toEqual([]); expect(progress).toEqual([0])
  })

  it('keeps the twelve-page limit and reports an unreachable target distinctly from a page failure', async () => {
    const { p, pages, progress, ready } = setup()
    const task = p.loadThroughSequence(1, 'restore'); await tick()
    for (let n = 0; n < 12; n++) { pages.shift()!({ events: [entry(99 - n)], hasMore: true }); await tick() }
    await task
    expect(progress).toEqual(Array.from({ length: 13 }, (_, n) => n))
    expect(ready).toEqual([{ seq: 1, loaded: false, reason: undefined }])
  })

  it('reports a failed node/search load distinctly and releases the loading lock', async () => {
    const { p, ready } = setup()
    p.onTurnJumpReady = (seq: number, loaded: boolean, reason?: string) => ready.push({ seq, loaded, reason })
    p.client.history = async () => { throw new Error('fixture page failure') }
    await p.loadThroughSequence(20)
    expect(ready).toEqual([{ seq: 20, loaded: false, reason: 'error' }])
    expect(p.historyLoad).toBeUndefined(); expect(p._state.loadingHistory).toBe(false)
  })
})

function observeJump(p: any) {
  const progress: any[] = [], ready: any[] = []
  p.onTurnJumpProgress = (seq: number, requestId: number, pages: number, maxPages: number) => progress.push({ seq, requestId, pages, maxPages })
  p.onTurnJumpReady = (seq: number, loaded: boolean, reason: string | undefined, status: any) => ready.push({ seq, loaded, reason, ...status })
  return { progress, ready }
}

describe('explicit bounded jump continuation', () => {
  it('pauses at twelve pages and only a separate request continues from the new cursor', async () => {
    const { p } = setup(); const { ready, progress } = observeJump(p)
    let calls = 0
    p.client.history = async (_id: string, before: number) => { calls++; return { events: [entry(before - 1)], hasMore: true } }
    await p.loadThroughSequence(1, 'jump', 101)
    expect(calls).toBe(12)
    expect(ready).toEqual([{ seq: 1, loaded: false, reason: undefined, requestId: 101, pages: 12, maxPages: 12, canContinue: true }])
    expect(progress.map(s => s.pages)).toEqual(Array.from({ length: 13 }, (_, i) => i))
    await tick(); expect(calls).toBe(12)
    p.client.history = async (_id: string, before: number) => { calls++; return { events: [entry(Math.max(1, before - 10))], hasMore: true } }
    await p.loadThroughSequence(1, 'jump', 102)
    expect(ready.at(-1)).toMatchObject({ loaded: true, requestId: 102, pages: 9, canContinue: false })
    expect(calls).toBe(21)
    expect(p.historyEntries[0].event.seq).toBe(1)
  })

  it('stops continuation after cancellation but merges its shared in-flight page once', async () => {
    const { p, pages } = setup(); const { progress, ready } = observeJump(p)
    const task = p.loadThroughSequence(1, 'jump', 7); await tick(); p.cancelHistoryNavigation()
    pages.shift()!({ events: [entry(80)], hasMore: true }); await task
    expect(progress).toEqual([{ seq: 1, requestId: 7, pages: 0, maxPages: 12 }])
    expect(ready).toEqual([]); expect(pages).toHaveLength(0)
    expect(p.historyEntries[0].event.seq).toBe(80)
  })

  it('supersedes an old request for the same sequence without misidentifying its reply or progress', async () => {
    const { p, pages } = setup(); const { progress, ready } = observeJump(p)
    const first = p.loadThroughSequence(20, 'jump', 1); await tick()
    const second = p.loadThroughSequence(20, 'jump', 2); await tick()
    expect(pages).toHaveLength(1)
    pages.shift()!({ events: [entry(10)], hasMore: true }); await Promise.all([first, second])
    expect(ready).toEqual([{ seq: 20, loaded: true, reason: undefined, requestId: 2, pages: 1, maxPages: 12, canContinue: false }])
    expect(progress.filter(row => row.requestId === 1).map(row => row.pages)).toEqual([0])
  })

  it.each(['session', 'runtime'])('does not report old jump progress after %s replacement', async mode => {
    const { p, pages } = setup(); const { progress, ready } = observeJump(p)
    const task = p.loadThroughSequence(20, 'jump', 7); await tick()
    if (mode === 'session') p._state.sessionId = 'other'; else p.client = {}
    pages.shift()!({ events: [entry(10)], hasMore: true }); await task
    expect(progress).toHaveLength(1); expect(ready).toEqual([])
  })

  it.each([true, false])('stops a nonadvancing page instead of offering endless continuation (hasMore=%s)', async hasMore => {
    const { p } = setup(); const { ready } = observeJump(p); let calls = 0
    p.client.history = async () => { calls++; return { events: [entry(100)], hasMore } }
    await p.loadThroughSequence(1, 'jump', 7)
    expect(calls).toBe(1)
    expect(ready[0]).toMatchObject({ loaded: false, pages: 1, canContinue: false, requestId: 7 })
  })

  it('can retry a page failure without discarding earlier successfully merged pages', async () => {
    const { p } = setup(); const { ready } = observeJump(p); let calls = 0
    p.client.history = async () => { if (++calls === 1) return { events: [entry(50)], hasMore: true }; throw Error('fixture') }
    await p.loadThroughSequence(20, 'jump', 7)
    expect(ready[0]).toMatchObject({ loaded: false, reason: 'error', pages: 1, canContinue: true })
    expect(p.historyEntries[0].event.seq).toBe(50)
    p.client.history = async () => ({ events: [entry(10)], hasMore: true })
    await p.loadThroughSequence(20, 'jump', 8)
    expect(ready[1]).toMatchObject({ loaded: true, requestId: 8, pages: 1, canContinue: false })
  })
})
