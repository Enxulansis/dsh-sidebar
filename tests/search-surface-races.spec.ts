import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { SearchIndexStore } from '../src/search-index-store.js'

const source = ts.createSourceFile('extension.ts', readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const surface = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'DshSurface') as ts.ClassDeclaration
const names = ['sessionIndexStamp', 'railFor', 'ensureRailTable', 'markIndexDirty', 'buildSearchIndex', 'republishLocalSearch', 'searchEarlyHistory']
const methods = surface.members.filter(n => ts.isMethodDeclaration(n) && names.includes(n.name.getText(source)))
const code = ts.transpileModule('class Probe {' + methods.map(n => n.getText(source)).join('\n') + '}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const rail = (seq: number) => ({ turn: [{ seq, key: 's' + seq, mid: 'm' + seq }], segment: [{ seq, key: 's' + seq, mid: 'm' + seq }] })
const message = (text: string) => ({ id: text, role: 'user' as const, seq: 1, text })
function setup() {
  const store = new SearchIndexStore(undefined)
  const Probe = new Function('searchIndexNow', 'connLog', 'SEARCH_HITS_MAX', 'HISTORY_SNAPSHOT_MAX_ATTEMPTS', code + ';return Probe;')(() => store, () => {}, 60, 2)
  const p = new Probe(), scope = { cwd: 'workspace', generation: 1 }, posted: any[] = []
  let revision = 1
  Object.assign(p, { disposed: false, captureSearchScope: () => scope, isSearchScopeCurrent: () => true, railNodeTables: new Map(), railBuilds: new Map(), dirtyIndexSessions: new Set(), indexChanges: new Map(), railAbort: new AbortController(), searchGeneration: 1,
    controller: { state: { cwd: 'workspace', sessionId: 's' }, searchIndexSessions: () => [{ sessionId: 's', revision, title: 's' }], projectSessionWithRail: vi.fn(async () => ({ messages: [message('new')], rail: rail(2) })) }, output: { appendLine: () => {} }, webview: { postMessage: (v: any) => { posted.push(v); return Promise.resolve(true) } },
    localSearchPayload: (_q: string, _e: string[], hits?: any[]) => ({ items: hits ?? store.search('needle'), nodes: {}, index: {} }),
  })
  // A directory-less store is writable but the surface intentionally needs an owned workspace.
  Object.assign(store, { ownsWorkspace: () => true })
  Object.defineProperty(store, 'active', { get: () => true })
  return { p, store, posted, setRevision: (v: number) => { revision = v } }
}
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }

it('does not return a persisted rail from an older revision', () => {
  const { p, store, setRevision } = setup()
  store.upsert('s', 1, [message('needle')]); store.setRail('s', 1, rail(1))
  expect(p.railFor('s')).toEqual(rail(1))
  setRevision(2)
  expect(p.railFor('s')).toBeUndefined()
})

it('retries a pull invalidated by a new turn/end without losing its dirty marker', async () => {
  const { p, store } = setup(), old = deferred<any>()
  p.markIndexDirty('s')
  p.controller.projectSessionWithRail.mockImplementationOnce(() => old.promise)
  const task = p.buildSearchIndex()
  await vi.waitFor(() => expect(p.controller.projectSessionWithRail).toHaveBeenCalledTimes(1))
  p.markIndexDirty('s'); old.resolve({ messages: [message('old')], rail: rail(1) })
  await task
  expect(p.controller.projectSessionWithRail).toHaveBeenCalledTimes(2)
  expect(store.search('old')).toEqual([])
  expect(store.search('new')).toHaveLength(1)
  expect(p.dirtyIndexSessions.has('s')).toBe(false)
})

it('never labels an old on-demand pull with the revision observed after it finished', async () => {
  const { p, store, setRevision } = setup(), old = deferred<any>()
  p.controller.projectSessionWithRail.mockImplementationOnce(() => old.promise)
  const task = p.ensureRailTable('s')
  setRevision(2); old.resolve({ messages: [message('old')], rail: rail(1) })
  expect(await task).toEqual(rail(2))
  expect(store.indexed('s', 2)).toBe(true)
  expect(store.search('old')).toEqual([])
})

it('does not carry an old rail across replacement of its entry snapshot', () => {
  const { store } = setup()
  store.upsert('s', 1, [message('old')]); store.setRail('s', 1, rail(1))
  store.upsert('s', 2, [message('new')])
  expect(store.rail('s')).toBeUndefined()
})

it('bounds repeated invalidation and keeps the session dirty for the next build', async () => {
  const { p, store } = setup()
  p.controller.projectSessionWithRail.mockImplementation(async () => { p.markIndexDirty('s'); return { messages: [message('stale')], rail: rail(1) } })
  await p.buildSearchIndex()
  expect(p.controller.projectSessionWithRail).toHaveBeenCalledTimes(2)
  expect(p.dirtyIndexSessions.has('s')).toBe(true)
  expect(store.search('stale')).toEqual([])
  expect(p.railFor('s')).toBeUndefined()
  p.controller.projectSessionWithRail.mockImplementation(async () => ({ messages: [message('stable')], rail: rail(2) }))
  await p.buildSearchIndex()
  expect(store.search('stable')).toHaveLength(1)
  expect(p.dirtyIndexSessions.has('s')).toBe(false)
})

it('does not resurrect a pre-turn rail while summary revision has not advanced', async () => {
  const { p, store } = setup()
  store.upsert('s', 1, [message('old')]); store.setRail('s', 1, rail(1))
  expect(p.railFor('s')).toEqual(rail(1))
  p.markIndexDirty('s')
  expect(p.railFor('s')).toBeUndefined()
  expect(await p.ensureRailTable('s')).toEqual(rail(2))
  expect(p.railFor('s')).toEqual(rail(2))
  expect(store.search('old')).toEqual([])
})

it('refreshes changed cached hits without dropping another session full-body hit', () => {
  const { p, store, posted } = setup()
  const a = { sessionId: 'a', revision: 1 }, s = { sessionId: 's', revision: 1 }
  p.controller.searchIndexSessions = () => [a, s]
  store.upsert('s', 1, [message('needle-before')])
  p.lastLocalSearch = { query: 'needle', requestId: 1, excludes: [], fulltext: new Map([
    ['a', { stamp: '1:0', hits: [{ sessionId: 'a', messageId: 'early-a' }] }],
    ['s', { stamp: '1:0', hits: [{ sessionId: 's', messageId: 'old-fulltext' }] }],
  ]) }
  p.republishLocalSearch()
  expect(posted.at(-1).index.fulltextComplete).toBe(true)
  p.markIndexDirty('s')
  expect(posted.at(-1).index.fulltextComplete).toBe(false)
  store.upsert('s', 1, [message('needle-after')], true)
  p.republishLocalSearch()
  expect(posted.at(-1).items.map((h: any) => h.messageId)).toEqual(['needle-after', 'early-a'])
  expect(posted.at(-1).index).toMatchObject({ fulltextScanned: 1, fulltextComplete: false })
})

it('merges simultaneous on-demand requests and bounds continuously changing rail pulls', async () => {
  const { p, store } = setup(), old = deferred<any>()
  p.controller.projectSessionWithRail.mockImplementationOnce(() => old.promise).mockImplementation(async () => {
    p.markIndexDirty('s'); return { messages: [message('late')], rail: rail(2) }
  })
  const first = p.ensureRailTable('s'), second = p.ensureRailTable('s')
  expect(second).toBe(first)
  p.markIndexDirty('s'); old.resolve({ messages: [message('old')], rail: rail(1) })
  expect(await first).toBeUndefined()
  expect(p.controller.projectSessionWithRail).toHaveBeenCalledTimes(2)
  expect(p.dirtyIndexSessions.has('s')).toBe(true)
  expect(p.railBuilds.size).toBe(0)
  expect(store.search('old')).toEqual([]); expect(store.search('late')).toEqual([])
})

it.each(['ensure', 'index'])('discards a late %s pull after its workspace scope changes', async kind => {
  const { p, store } = setup(), old = deferred<any>()
  p.controller.projectSessionWithRail.mockImplementationOnce(() => old.promise)
  const task = kind === 'ensure' ? p.ensureRailTable('s') : p.buildSearchIndex()
  await vi.waitFor(() => expect(p.controller.projectSessionWithRail).toHaveBeenCalledTimes(1))
  p.isSearchScopeCurrent = () => false
  old.resolve({ messages: [message('late')], rail: rail(1) })
  await task
  expect(store.search('late')).toEqual([])
  expect(p.railNodeTables.size).toBe(0)
})
