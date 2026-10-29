import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { permissionPresetsOf } from '../src/collaboration-state.js'

const source = ts.createSourceFile('extension.ts', readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const controller = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'DshChatController') as ts.ClassDeclaration
const methods = controller.members.filter(n => ts.isMethodDeclaration(n) && ['loadPermissions', 'executePolicyCommand', 'resyncRunningState', 'answerApproval', 'send'].includes(n.name.getText(source)))
const code = ts.transpileModule('class Probe {' + methods.map(n => n.getText(source)).join('\n') + '}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const catalog = { options: [{ value: 'read-only' }, { value: 'workspace-write' }, { value: 'danger-full-access' }] }
function setup() {
  const Probe = new Function('permissionPresetsOf', code + '; return Probe')(permissionPresetsOf)
  const p = new Probe()
  Object.assign(p, { client: { permissionCatalog: vi.fn(async () => catalog) }, _state: { sessionId: 'a' }, permissionLoadRevision: 0, publish: vi.fn(), output: { appendLine: vi.fn() } })
  return p
}

it('routes policy actions through commands before command discovery and without a routable model', async () => {
  const p = setup(), executeCommand = vi.fn(async () => ({ result: { kind: 'success' } }))
  p.requireClient = () => ({ executeCommand })
  Object.assign(p._state, { phase: 'ready', commands: [], routable: false, running: false })
  await p.executePolicyCommand('/permission read-only', 'a')
  await p.executePolicyCommand('/plan', 'a')
  expect(executeCommand.mock.calls.map(c => c.slice(0, 2))).toEqual([['a', '/permission read-only'], ['a', '/plan']])
  p._state.sessionId = 'b'
  await expect(p.executePolicyCommand('/permission danger-full-access', 'a')).rejects.toThrow('会话已切换')
  expect(executeCommand).toHaveBeenCalledTimes(2)
  p._state.running = true
  await expect(p.executePolicyCommand('/plan', 'b')).rejects.toThrow('当前任务')
})

it('keeps newer live running states and rejects an older resync response', async () => {
  const p = setup(), pending: Array<(v: unknown) => void> = []
  p.runningSyncRevision = 0; p.runningStatusRevisions = new Map()
  p.summaries = [{ sessionId: 'a', running: false }, { sessionId: 'b', running: true }]
  p._state.sessions = [{ id: 'a' }, { id: 'b' }]
  p.client.listSessions = () => new Promise(resolve => pending.push(resolve))
  const first = p.resyncRunningState()
  p.runningStatusRevisions.set('a', 1); p.summaries[0].running = true
  pending[0]!({ items: [{ sessionId: 'a', running: false }, { sessionId: 'b', running: false }] }); await first
  expect(p.summaries.map((s: any) => s.running)).toEqual([true, false])
  const old = p.resyncRunningState(), fresh = p.resyncRunningState()
  pending[2]!({ items: [{ sessionId: 'a', running: false }] }); await fresh
  pending[1]!({ items: [{ sessionId: 'a', running: true }] }); await old
  expect(p.summaries[0].running).toBe(false)
})
it('loads all three permissions and reflects the server-selected value', async () => {
  const p = setup()
  await p.loadPermissions(p.client, 'a', { currentValue: 'workspace-write' })
  expect(p.publish).toHaveBeenCalledWith({ permissions: permissionPresetsOf({ currentValue: 'workspace-write' }, catalog) })
})

it('accepts RC4 command attachments and refuses images for commands without that capability', async () => {
  const p = setup(), executeCommand = vi.fn(async () => ({ result: { kind: 'success' } }))
  p.requireClient = () => ({ executeCommand })
  p.slashRoute = () => ({ kind: 'command', name: 'plan', token: '/plan' })
  p._state.routable = true
  p._state.commands = [{ name: 'plan', input: { attachments: true } }]
  const images = [{ type: 'image', mediaType: 'image/png', data: 'owned-image' }]
  await p.send('/plan inspect image', images)
  expect(executeCommand).toHaveBeenCalledWith('a', '/plan inspect image', images)
  p._state.commands = [{ name: 'plan', input: {} }]
  await expect(p.send('/plan inspect image', images)).rejects.toThrow('does not accept')
  expect(executeCommand).toHaveBeenCalledTimes(1)
})

it('binds an old approval card only to the same live approval, never to another request', async () => {
  const p = setup()
  p.client.respond = vi.fn(async () => ({})); p.client.socketOpen = true
  p.requireClient = () => p.client
  p._state.approval = { approvalId: 'approval-a', rpcId: 'new-rpc' }
  await p.answerApproval('old-rpc', 'approval-a', 'rejected')
  expect(p.client.respond).toHaveBeenCalledWith('new-rpc', { sessionId: 'a', approvalId: 'approval-a', outcome: 'rejected' })
  await expect(p.answerApproval('old-rpc', 'other-request', 'allowed-once')).rejects.toThrow('不再等待')
  p.client.socketOpen = false
  await expect(p.answerApproval('old-rpc', 'approval-a', 'allowed-once')).rejects.toThrow('连接正在恢复')
  expect(p.client.respond).toHaveBeenCalledTimes(1)
})
it('discards stale selection replies and replies for a different session or connection', async () => {
  const p = setup(), pending: Array<(value: unknown) => void> = []
  p.client.permissionCatalog.mockImplementation(() => new Promise(resolve => pending.push(resolve)))
  const first = p.loadPermissions(p.client, 'a', { currentValue: 'read-only' })
  const second = p.loadPermissions(p.client, 'a', { currentValue: 'workspace-write' })
  pending[1]!(catalog); await second
  pending[0]!(catalog); await first
  expect(p.publish).toHaveBeenCalledTimes(1)
  const third = p.loadPermissions(p.client, 'a', { currentValue: 'danger-full-access' })
  p._state.sessionId = 'b'; pending[2]!(catalog); await third
  expect(p.publish).toHaveBeenCalledTimes(1)
  p._state.sessionId = 'a'
  const fourth = p.loadPermissions(p.client, 'a', { currentValue: 'danger-full-access' })
  p.client = {}; pending[3]!(catalog); await fourth
  expect(p.publish).toHaveBeenCalledTimes(1)
})
it('clears unavailable permission choices and records discovery failures', async () => {
  const p = setup()
  p.client.permissionCatalog.mockRejectedValue(new Error('unavailable'))
  await p.loadPermissions(p.client, 'a', { currentValue: 'read-only' })
  expect(p.publish).toHaveBeenCalledWith({ permissions: [] })
  expect(p.output.appendLine).toHaveBeenCalledWith(expect.stringContaining('unavailable'))
})
