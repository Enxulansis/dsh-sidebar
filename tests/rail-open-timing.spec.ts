import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { afterEach, expect, it, vi } from 'vitest'

const source = ts.createSourceFile('extension.ts', readFileSync(process.env.HARNESS_RAIL_TIMING_SOURCE ?? new URL('../src/extension.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const surface = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'DshSurface') as ts.ClassDeclaration
const names = ['pushRailTable', 'queueState', 'postFullState', 'postStateUpdate', 'resyncState']
const code = ts.transpileModule('class Probe {' + surface.members.filter(n => ts.isMethodDeclaration(n) && names.includes(n.name.getText(source))).map(n => n.getText(source)).join('\n') + '}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const rail = { segment: [{ seq: 1, key: 's1', mid: 'u1' }], turn: [{ seq: 0, key: 's0', mid: 'u1' }] }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
function setup() {
  const Probe = new Function('stateForWebview', 'stateUpdateForWebview', 'stateUpdate', code + ';return Probe;')((v: unknown) => v, (v: unknown) => v, (a: unknown, b: unknown) => a === b ? undefined : { patch: b })
  const p = new Probe(), scope = {}, posted: any[] = []
  Object.assign(p, { disposed: false, ready: true, pendingState: undefined, statePosts: Promise.resolve(), controller: { state: { sessionId: 'b', phase: 'ready', running: false } }, postedState: { sessionId: 'a' },
    captureSearchScope: () => scope, isSearchScopeCurrent: (v: unknown) => v === scope, railFor: () => rail, ensureRailTable: vi.fn(async () => rail),
    webview: { postMessage: vi.fn(async (v: any) => { posted.push(v); return true }) }, output: { appendLine: vi.fn() }, applyPinnedSlots: vi.fn(), postSessionTitles: vi.fn(),
  })
  return { p, posted }
}
afterEach(() => vi.useRealTimers())

it('flushes a pending selecting state with its cached table before any separate rail message', async () => {
  vi.useFakeTimers()
  const { p, posted } = setup()
  p.queueState(p.controller.state)
  await p.pushRailTable('b')
  expect(posted[0]).toMatchObject({ type: 'state', state: { sessionId: 'b' }, rail })
  expect(posted.filter(v => v.type === 'rail-nodes')).toHaveLength(0)
  await vi.runAllTimersAsync()
  expect(posted).toHaveLength(1)
})

it('prepares a missing table while opening history is still loading and delivers it with ready body', async () => {
  vi.useFakeTimers()
  const { p, posted } = setup(), build = deferred<typeof rail>()
  let prepared = false
  p.railFor = () => prepared ? rail : undefined
  p.ensureRailTable.mockImplementation(() => build.promise)
  p.controller.state = { sessionId: 'b', phase: 'loading', running: false }
  p.queueState(p.controller.state)
  expect(p.ensureRailTable).toHaveBeenCalledTimes(1)
  prepared = true; build.resolve(rail)
  p.controller.state = { ...p.controller.state, phase: 'ready' }
  p.queueState(p.controller.state)
  await p.pushRailTable('b')
  expect(posted[0]).toMatchObject({ type: 'state', state: { sessionId: 'b', phase: 'ready' }, rail })
  await vi.runAllTimersAsync()
  expect(posted.filter(v => v.type === 'rail-nodes')).toHaveLength(0)
})

it('never blocks the opening body on an unfinished cold table', async () => {
  vi.useFakeTimers()
  const { p, posted } = setup(), build = deferred<typeof rail>()
  p.railFor = () => undefined
  p.ensureRailTable.mockImplementation(() => build.promise)
  p.controller.state = { sessionId: 'b', phase: 'loading', running: false }
  p.queueState(p.controller.state)
  p.controller.state = { ...p.controller.state, phase: 'ready' }
  p.queueState(p.controller.state)
  await vi.advanceTimersByTimeAsync(16)
  expect(posted[0]).toMatchObject({ type: 'state', state: { phase: 'ready' } })
  expect(posted[0].rail).toBeUndefined()
  build.resolve(rail)
})

it('waits for a selecting state already in transit before delivering a late cold table', async () => {
  const { p, posted } = setup(), delivery = deferred<boolean>()
  p.webview.postMessage.mockImplementationOnce(async (v: any) => { posted.push(v); return delivery.promise })
  p.statePosts = p.postFullState(p.controller.state)
  const push = p.pushRailTable('b')
  await Promise.resolve()
  expect(posted.map(v => v.type)).toEqual(['state'])
  delivery.resolve(true); await push
  expect(posted).toHaveLength(1)
})

it('rejects a table after another session takes over during state delivery', async () => {
  const { p, posted } = setup(), delivery = deferred<boolean>()
  p.webview.postMessage.mockImplementationOnce(async (v: any) => { posted.push(v); return delivery.promise })
  const push = p.pushRailTable('b')
  await Promise.resolve()
  p.controller.state = { sessionId: 'c', phase: 'ready' }
  delivery.resolve(true); await push
  expect(posted.filter(v => v.type === 'rail-nodes')).toEqual([])
})

it('does not mark an undelivered table as sent and explicitly retries it', async () => {
  const { p, posted } = setup()
  p.postedState = p.controller.state
  p.webview.postMessage.mockResolvedValueOnce(false)
  await p.pushRailTable('b')
  expect(p.lastPushedRail).toBeUndefined()
  await p.pushRailTable('b')
  expect(p.lastPushedRail).toEqual({ sessionId: 'b', rail })
  expect(posted.filter(v => v.type === 'rail-nodes')).toHaveLength(1)
  expect(p.webview.postMessage).toHaveBeenCalledTimes(2)
})

it('prepares before webview ready but only records delivery after its initial full state', async () => {
  const { p, posted } = setup()
  p.ready = false
  await p.pushRailTable('b')
  expect(posted).toEqual([]); expect(p.lastPushedRail).toBeUndefined()
  p.ready = true
  await p.postFullState(p.controller.state)
  await p.pushRailTable('b')
  expect(posted).toHaveLength(1)
  expect(posted[0].rail).toEqual(rail)
})

it('adds a newly available table to the same-session ready patch without repeating it on streamed patches', async () => {
  const { p, posted } = setup()
  p.postedState = { sessionId: 'b', phase: 'loading' }
  await p.postStateUpdate(p.controller.state)
  expect(posted[0]).toMatchObject({ type: 'state-update', sessionId: 'b', rail })
  await p.postStateUpdate({ ...p.controller.state, running: true })
  expect(posted[1].rail).toBeUndefined()
})

it('reports a failed cold table for an explicit retry without publishing a foreign failure', async () => {
  const { p, posted } = setup()
  p.railFor = () => undefined
  p.ensureRailTable.mockResolvedValue(undefined)
  await p.pushRailTable('b')
  expect(posted.map(row => row.type)).toEqual(['state', 'rail-unavailable'])
  expect(posted[0].state.sessionId).toBe('b')
  p.ensureRailTable.mockImplementation(async () => { p.controller.state = { sessionId: 'c' }; return undefined })
  await p.pushRailTable('b')
  expect(posted).toHaveLength(2)
})

it('orders a cold failure behind the selecting state already in transit', async () => {
  const { p, posted } = setup(), delivery = deferred<boolean>()
  p.railFor = () => undefined; p.ensureRailTable.mockResolvedValue(undefined)
  p.webview.postMessage.mockImplementationOnce(async (row: any) => { posted.push(row); return delivery.promise })
  p.statePosts = p.postFullState(p.controller.state)
  const push = p.pushRailTable('b'); await Promise.resolve()
  expect(posted.map(row => row.type)).toEqual(['state'])
  delivery.resolve(true); await push
  expect(posted.map(row => row.type)).toEqual(['state', 'rail-unavailable'])
})
