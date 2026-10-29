import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it } from 'vitest'

const file = ts.createSourceFile('extension.ts', readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const surface = file.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'DshSurface') as ts.ClassDeclaration
const methods = surface.members.filter(n => ts.isMethodDeclaration(n) && ['searchCurrentHistory', 'searchEarlyHistory', 'republishLocalSearch', 'sessionIndexStamp'].includes(n.name.getText(file)))
const code = ts.transpileModule('class Probe {' + methods.map(n => n.getText(file)).join('\n') + '}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function setup(searchHistory: (...args: any[]) => Promise<any[]>) {
  const cached = [{ sessionId: 'a', messageId: 'cached-a' }, { sessionId: 'b', messageId: 'cached-b' }]
  const Probe = new Function('searchIndexNow', 'SEARCH_HITS_MAX', 'HISTORY_SNAPSHOT_MAX_ATTEMPTS', code + ';return Probe;')(() => ({ search: () => cached, ownsWorkspace: () => true, searchSession: (id: string) => cached.filter(hit => hit.sessionId === id) }), 60, 2)
  const p = new Probe(), scope = {}, posted: any[] = [], logs: string[] = []
  Object.assign(p, { indexChanges: new Map(), controller: { state: { sessionId: 'a', cwd: 'D:/fixture' }, searchIndexSessions: () => [{ sessionId: 'a', revision: 1 }, { sessionId: 'b', revision: 1 }], searchHistory }, captureSearchScope: () => scope, isSearchScopeCurrent: () => true, searchGeneration: 1, lastLocalSearch: { query: 'needle', requestId: 1, excludes: [] }, output: { appendLine: (s: string) => logs.push(s) }, localSearchPayload: (_q: string, _e: string[], hits: any[]) => ({ items: hits, index: {}, nodes: {} }), webview: { postMessage: (v: any) => posted.push(structuredClone(v)) } })
  return { p, posted, logs }
}

it('progressively replaces each cache, preserves already scanned hits and reports completion', async () => {
  const { p, posted } = setup(async id => [{ sessionId: id, messageId: 'early-' + id }])
  await p.searchEarlyHistory('needle', 1, [], 1, new AbortController().signal)
  expect(posted[0].items.map((h: any) => h.messageId)).toEqual(['cached-a', 'cached-b'])
  expect(posted[1].items.map((h: any) => h.messageId)).toEqual(['early-a', 'cached-b'])
  expect(posted[2].items.map((h: any) => h.messageId)).toEqual(['early-a', 'early-b'])
  expect(posted.at(-1).index).toMatchObject({ fulltextScanning: false, fulltextComplete: true, fulltextScanned: 2 })
})

it.each(['cancel', 'query', 'workspace'])('ignores stale completion on %s and does not start another session', async mode => {
  let calls = 0; const abort = new AbortController()
  const { p, posted } = setup(async () => { calls++; if (mode === 'cancel') abort.abort(); else if (mode === 'query') p.searchGeneration++; else p.isSearchScopeCurrent = () => false; return [{ messageId: 'late' }] })
  await p.searchEarlyHistory('needle', 1, [], 1, abort.signal)
  expect(calls).toBe(1); expect(posted).toHaveLength(1)
})

it('retains cached hits on read failure and never reports full coverage', async () => {
  const { p, posted, logs } = setup(async id => { if (id === 'a') throw new Error('offline'); return [] })
  await p.searchEarlyHistory('needle', 1, [], 1, new AbortController().signal)
  expect(posted.at(-1).items.map((h: any) => h.messageId)).toEqual(['cached-a'])
  expect(posted.at(-1).index).toMatchObject({ fulltextComplete: false, fulltextFailed: 1, fulltextScanning: false })
  expect(logs).toHaveLength(1)
})

it('retries a changed history cut once and publishes only the stable replacement', async () => {
  let calls = 0
  const { p, posted } = setup(async id => {
    calls++
    if (calls === 1) p.indexChanges.set('a', 1)
    return [{ sessionId: id, messageId: calls === 1 ? 'stale' : 'stable-' + id }]
  })
  await p.searchEarlyHistory('needle', 1, [], 1, new AbortController().signal)
  expect(calls).toBe(3)
  expect(posted.every(row => !row.items.some((h: any) => h.messageId === 'stale'))).toBe(true)
  expect(posted.at(-1).index.fulltextComplete).toBe(true)
})

it('does not call continuously changing cuts complete or retry without a bound', async () => {
  let calls = 0
  const { p, posted } = setup(async id => {
    calls++
    if (id === 'a') p.indexChanges.set('a', (p.indexChanges.get('a') ?? 0) + 1)
    return [{ sessionId: id, messageId: 'changing-' + id }]
  })
  await p.searchEarlyHistory('needle', 1, [], 1, new AbortController().signal)
  expect(calls).toBe(3)
  expect(posted.at(-1).items.map((h: any) => h.messageId)).toEqual(['cached-a', 'changing-b'])
  expect(posted.at(-1).index).toMatchObject({ fulltextComplete: false, fulltextScanning: false, fulltextScanned: 1 })
})

it('invalidates an already scanned session that changes while a later session is scanning', async () => {
  const { p, posted } = setup(async id => {
    if (id === 'b') p.indexChanges.set('a', 1)
    return [{ sessionId: id, messageId: 'early-' + id }]
  })
  await p.searchEarlyHistory('needle', 1, [], 1, new AbortController().signal)
  expect(posted[1].items.map((h: any) => h.messageId)).toEqual(['early-a', 'cached-b'])
  expect(posted.at(-1).items.map((h: any) => h.messageId)).toEqual(['cached-a', 'early-b'])
  expect(posted.at(-1).index).toMatchObject({ fulltextScanned: 1, fulltextComplete: false, fulltextScanning: false })
})

it('explicit session lookup searches only the session selected at request start, without workspace or foreign lookup', async () => {
  const calls: any[][] = []
  const { p, posted } = setup(async (...args) => { calls.push(args); return [{ sessionId: args[0], messageId: 'early-a', seq: 5 }] })
  p.ensureSearchIndex = p.controller.searchSessions = () => { throw Error('Must not search other sessions') }
  await p.searchCurrentHistory('a', 'needle', ['skip'], 9)
  expect(calls).toHaveLength(1)
  expect(calls[0].slice(0, 3)).toEqual(['a', 'needle', ['skip']])
  expect(posted[0]).toMatchObject({ requestId: 9, sessionId: 'a', items: [{ messageId: 'cached-a' }] })
  expect(posted.at(-1)).toMatchObject({ sessionId: 'a', items: [{ seq: 5 }], index: { fulltextSessions: 1, fulltextScanned: 1, fulltextComplete: true, fulltextScanning: false } })
  p.republishLocalSearch()
  expect(posted.at(-1).items).toHaveLength(1)
})

it.each(['', 'b', 'foreign'])('rejects an explicit lookup for an unselected or empty session %s', async id => {
  let calls = 0
  const { p, posted } = setup(async () => { calls++; return [] })
  await p.searchCurrentHistory(id, 'needle', [], 9)
  expect(calls).toBe(0); expect(posted).toHaveLength(0)
})

it('rejects a current session absent from the owned ordinary-session list', async () => {
  let calls = 0
  const { p, posted } = setup(async () => { calls++; return [] })
  p.controller.state.sessionId = 'foreign'
  await p.searchCurrentHistory('foreign', 'needle', [], 9)
  expect(calls).toBe(0)
  expect(posted).toEqual([{ type: 'search-results', requestId: 9, sessionId: 'foreign', local: true, items: [], index: { fulltextScanning: false, fulltextComplete: false, fulltextFailed: 1 } }])
})

it.each(['session', 'cancel', 'query', 'workspace'])('does not publish old selected-session bodies after %s changes', async mode => {
  const { p, posted } = setup(async () => {
    if (mode === 'session') p.controller.state.sessionId = 'b'
    if (mode === 'cancel') p.searchAbort.abort()
    if (mode === 'query') { p.searchGeneration++; p.lastLocalSearch = undefined }
    if (mode === 'workspace') p.isSearchScopeCurrent = () => false
    return [{ sessionId: 'a', messageId: 'late' }]
  })
  await p.searchCurrentHistory('a', 'needle', [], 9)
  expect(posted).toHaveLength(1)
  expect(posted[0].index.fulltextScanning).toBe(true)
  expect(p.searchAbort).toBeUndefined()
  if (mode === 'session') { p.republishLocalSearch(); expect(posted).toHaveLength(1) }
})

it('retains selected-session cache after failure, invalidates completion on append and allows explicit retry', async () => {
  let calls = 0
  const { p, posted } = setup(async () => { if (++calls === 1) throw Error('offline'); return [{ sessionId: 'a', messageId: 'early-a' }] })
  await p.searchCurrentHistory('a', 'needle', [], 9)
  expect(posted.at(-1)).toMatchObject({ items: [{ messageId: 'cached-a' }], index: { fulltextFailed: 1, fulltextComplete: false } })
  await p.searchCurrentHistory('a', 'needle', [], 10)
  expect(posted.at(-1).index.fulltextComplete).toBe(true)
  p.indexChanges.set('a', 1); p.republishLocalSearch()
  expect(posted.at(-1)).toMatchObject({ items: [{ messageId: 'cached-a' }], index: { fulltextScanned: 0, fulltextComplete: false } })
  expect(calls).toBe(2)
})
