import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'

const source = ts.createSourceFile('extension.ts', readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const controller = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'DshChatController') as ts.ClassDeclaration
const names = ['trashSession', 'purgeSession', 'purgeAllRecycle', 'pruneRecycleBin', 'purgeSessionMetadata', 'releaseSessionCaches', 'removePurgedSearchEntry', 'runSessionOp']
const code = ts.transpileModule('class Probe {' + controller.members.filter(n => ts.isMethodDeclaration(n) && names.includes(n.name.getText(source))).map(n => n.getText(source)).join('\n') + '}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function setup() {
  const writes = new Map<string, unknown>(), draftRemove = vi.fn(), originPurge = vi.fn(), forgetView = vi.fn()
  const saved = new Map<string, unknown>([['dshSessionCreatedAt', { a: 1, b: 2, unloaded: 3 }], ['dshSessionTokS', { a: { m: { tokS: 1 } }, b: { m: { tokS: 2 } }, unloaded: { m: { tokS: 3 } } }]])
  const store = { indexed: () => true, useWorkspace: vi.fn(async (_cwd: string) => {}), markTrashed: vi.fn(), remove: vi.fn() }
  const Probe = new Function('findSessionWorkspace', 'dshHomeNow', 'searchIndexNow', 'visibleSessionTitles', 'titleOf', 'draftStoreNow', 'ORIGIN_STORE', 'EXT_CONTEXT', 'commitVisitedSessions', 'vscode', 'forgetSessionViewState', code + ';return Probe;')(
    async () => 'workspace', () => 'private-home', () => store, () => ({}), () => 'title', () => ({ remove: draftRemove }), { purgeSession: originPurge }, { globalState: { get: (key: string) => saved.get(key), update: (key: string, value: unknown) => { saved.set(key, value); writes.set(key, value) } } }, () => {}, { workspace: { getConfiguration: () => ({ get: () => 30 }) } }, forgetView,
  )
  const p = new Probe()
  Object.assign(p, { cwd: 'project', summaries: [{ sessionId: 'a', running: false, cwd: 'project' }, { sessionId: 'b', running: false, cwd: 'project' }], visitedSessions: new Set(['a', 'b']), sessionOrder: ['a', 'b'], sessionOps: Promise.resolve(), recycleBin: { trash: vi.fn(async () => true), purge: vi.fn(async () => true), list: vi.fn(async () => []), prune: vi.fn(async () => []) }, client: { forgetSession: vi.fn() }, diffReviews: { releaseSession: vi.fn(), purgeSession: vi.fn() }, throwIfUnknownSession: vi.fn(), shadowSession: vi.fn(), persistSessionOrder: vi.fn(), publishRecycle: vi.fn(), loadSessions: vi.fn(async () => {}), output: { appendLine: vi.fn() } })
  for (const name of ['historyBySession', 'jobsBySession', 'projectionBaselines', 'modelSelections', 'sessionCreatedAt', 'sessionTokS']) p[name] = new Map([['a', { data: 'large' }], ['b', { data: 'keep' }]])
  p.runningStatusRevisions = new Map()
  p._state = { sessionId: 'a' }; p.historyWindowGeneration = 1; p.historyNavigationGeneration = 1
  p.historyEntries = [{ large: 'payload' }]; p.historyLoad = { task: Promise.resolve() }; p.sessionHistoryLoad = { task: Promise.resolve() }
  p.attachmentLoads = new Map(); p.attachmentResults = new Map([['a\0image', { data: 'large' }], ['b\0image', { data: 'keep' }]])
  for (const name of ['originDisplays', 'originLoads']) p[name] = new Map([['a\0image', { data: 'large' }], ['b\0image', { data: 'keep' }]])
  p.persistTokS = vi.fn(() => writes.set('dshSessionTokS', Object.fromEntries(p.sessionTokS)))
  return { p, writes, saved, draftRemove, originPurge, store, forgetView }
}

it('successful trash evicts transient caches but retains persistent metadata/drafts and failed trash evicts nothing', async () => {
  const { p, draftRemove, originPurge, store, forgetView } = setup()
  p.recycleBin.trash.mockResolvedValueOnce(false)
  await expect(p.trashSession('a')).rejects.toThrow('无法移入')
  expect(p.historyBySession.has('a')).toBe(true)
  expect(p.shadowSession).not.toHaveBeenCalled()
  expect(store.markTrashed).not.toHaveBeenCalled()
  await p.trashSession('a')
  expect(p.historyBySession.has('a')).toBe(false)
  expect([...p.originDisplays.keys()]).toEqual(['b\0image']); expect([...p.originLoads.keys()]).toEqual(['b\0image'])
  expect(p.sessionCreatedAt.has('a') && p.sessionTokS.has('a')).toBe(true)
  expect(draftRemove).not.toHaveBeenCalled(); expect(originPurge).not.toHaveBeenCalled()
  expect(p.diffReviews.releaseSession).toHaveBeenCalledWith('a')
  expect(p.diffReviews.purgeSession).not.toHaveBeenCalled()
  expect(p.summaries.map((s: any) => s.sessionId)).toEqual(['b'])
  expect(store.markTrashed).toHaveBeenCalledWith('a', true)
  expect(p.historyWindowGeneration).toBe(2)
  expect(p.historyNavigationGeneration).toBe(2)
  expect(p.historyEntries).toEqual([])
  expect(p.historyLoad).toBeUndefined(); expect(p.sessionHistoryLoad).toBeUndefined()
  expect(forgetView).not.toHaveBeenCalled()
})

it('successful purge removes only target persistent data and failed purge preserves it', async () => {
  const { p, writes, draftRemove, originPurge, store, forgetView } = setup()
  p.recycleBin.purge.mockResolvedValueOnce(false)
  await expect(p.purgeSession('a')).rejects.toThrow('无法永久删除')
  expect(writes.size).toBe(0)
  expect(forgetView).not.toHaveBeenCalled()
  await p.purgeSession('a')
  expect([...p.sessionCreatedAt.keys()]).toEqual(['b'])
  expect([...p.sessionTokS.keys()]).toEqual(['b'])
  expect(Object.keys(writes.get('dshSessionCreatedAt') as object)).toEqual(['b', 'unloaded'])
  expect(Object.keys(writes.get('dshSessionTokS') as object)).toEqual(['b', 'unloaded'])
  expect(draftRemove).toHaveBeenCalledWith('a'); expect(originPurge).toHaveBeenCalledWith('a')
  expect(p.diffReviews.purgeSession).toHaveBeenCalledWith('a'); expect(store.remove).toHaveBeenCalledWith('a')
  expect(forgetView).toHaveBeenCalledExactlyOnceWith('a')
})

it('automatic expiration and empty-bin use the same purge cleanup and restore the active search workspace', async () => {
  const { p, store, draftRemove, forgetView } = setup()
  p.recycleBin.prune.mockResolvedValueOnce([{ id: 'a', cwd: 'foreign' }])
  await p.pruneRecycleBin()
  expect(draftRemove).toHaveBeenCalledWith('a')
  expect(store.useWorkspace.mock.calls.map(c => c[0])).toEqual(['foreign', 'project'])
  p.recycleBin.list.mockResolvedValueOnce([{ id: 'b', cwd: 'project' }])
  expect(await p.purgeAllRecycle()).toBe(1)
  expect(p.sessionCreatedAt.size + p.sessionTokS.size + p.historyBySession.size).toBe(0)
  expect(draftRemove).toHaveBeenCalledWith('b')
  expect(forgetView.mock.calls.map(c => c[0])).toEqual(['a', 'b'])
})

it('expires durable metadata before the sidebar/client has started without dropping unloaded sessions', async () => {
  const { p, saved } = setup()
  p.client = undefined
  p.sessionCreatedAt.clear(); p.sessionTokS.clear()
  p.recycleBin.prune.mockResolvedValueOnce([{ id: 'a', cwd: 'project' }])
  await p.pruneRecycleBin()
  expect(saved.get('dshSessionCreatedAt')).toEqual({ b: 2, unloaded: 3 })
  expect(saved.get('dshSessionTokS')).toEqual({ b: { m: { tokS: 2 } }, unloaded: { m: { tokS: 3 } } })
})
