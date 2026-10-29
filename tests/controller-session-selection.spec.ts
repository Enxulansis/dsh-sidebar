import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'

const source = ts.createSourceFile('extension.ts', readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const controller = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'DshChatController') as ts.ClassDeclaration
const names = ['acceptFrame', 'loadSessions']
const code = ts.transpileModule('class Probe {' + controller.members.filter(n => ts.isMethodDeclaration(n) && names.includes(n.name.getText(source))).map(n => n.getText(source)).join('\n') + '}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function setup() {
  const Probe = new Function('sameCwd', 'extDeletedSessions', 'EXT_CONTEXT', 'titleOf', code + ';return Probe;')(
    (a: string, b: string) => a === b, () => new Set(), undefined, (s: any) => s.sessionId,
  )
  const p = new Probe()
  Object.assign(p, {
    cwd: 'project', generation: 1, historyWindowGeneration: 1, _state: { sessionId: 'a' },
    client: { listSessions: vi.fn(async () => ({ items: [{ sessionId: 'a', cwd: 'project' }, { sessionId: 'd', cwd: 'project' }] })) },
    requireClient() { return this.client }, draftfulSessions: new Set(), visitedSessions: new Set(), sessionCreatedAt: new Map(),
    applyProjectionBaseline: vi.fn(), applySessionOrder: (items: any) => items,
    recycleView: vi.fn(async () => ({ items: [], others: [] })), publish: vi.fn(),
    loadSession: vi.fn(async () => {}), report: vi.fn(),
  })
  return p
}
const added = (id: string, cwd = 'project') => ({ channel: 'host', payload: { type: 'host/session-added', sessionId: id, cwd } })

it('late runtime discovery refreshes tabs without replacing an already loaded user selection', async () => {
  const p = setup()
  p.acceptFrame(added('d'))
  await vi.waitFor(() => expect(p.publish).toHaveBeenCalled())
  expect(p.publish.mock.calls[0][0].sessions.map((s: any) => s.id)).toEqual(['a', 'd'])
  expect(p.loadSession).not.toHaveBeenCalled()
  expect(p._state.sessionId).toBe('a')
  expect(p.report).not.toHaveBeenCalled()
})

it('pending discovery cannot reclaim a conversation selected during its list RPC', async () => {
  const p = setup()
  let release!: (value: any) => void
  p.client.listSessions.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  p._state.sessionId = 'd'
  p.acceptFrame(added('d'))
  p._state.sessionId = 'a'; p.historyWindowGeneration++
  release({ items: [{ sessionId: 'a', cwd: 'project' }, { sessionId: 'd', cwd: 'project' }] })
  await vi.waitFor(() => expect(p.publish).toHaveBeenCalled())
  expect(p.loadSession).not.toHaveBeenCalled()
  expect(p.report).not.toHaveBeenCalled()
})

it('explicit new or restored ids still select their target and foreign additions are ignored', async () => {
  const p = setup()
  p.acceptFrame(added('foreign', 'other-project'))
  expect(p.client.listSessions).not.toHaveBeenCalled()
  await p.loadSessions('d')
  expect(p.loadSession).toHaveBeenCalledExactlyOnceWith('d')
})
