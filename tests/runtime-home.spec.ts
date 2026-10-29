import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { join, parse } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), probe: vi.fn(), pick: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('../src/process-tree.js', () => ({ terminateProcessTree: vi.fn() }))
vi.mock('../src/runtime-endpoint.js', async original => ({ ...await original<typeof import('../src/runtime-endpoint.js')>(), probeDshServer: mocks.probe }))
vi.mock('vscode', () => ({
  EventEmitter: class { event = vi.fn(); fire() {}; dispose() {} },
  Uri: { parse: (value: string) => ({ toString: () => value }), file: (fsPath: string) => ({ fsPath }) },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: process.cwd() } }],
    getWorkspaceFolder: () => undefined,
    // spawn is mocked: use a known native executable so PATH-installed DSH
    // and Windows shell fallback cannot change this home-isolation fixture.
    getConfiguration: () => ({ get: (key: string, fallback: unknown) => key === 'executable' ? process.execPath : fallback, inspect: () => undefined }),
  },
  window: { showQuickPick: mocks.pick, withProgress: (_options: unknown, action: Function) => action({}, { onCancellationRequested: () => ({ dispose() {} }) }) },
  ProgressLocation: { Notification: 1 },
  QuickPickItemKind: { Separator: -1 },
}))

import { DshRuntime } from '../src/runtime.js'
import { DshPluginManager } from '../src/plugin-manager.js'

const home = join(parse(process.cwd()).root, 'dsh-test-home-explicit')
const context = { extensionUri: { fsPath: process.cwd() }, secrets: { get: async () => undefined } }
const output = { appendLine: vi.fn(), append: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.spawn.mockImplementation((_command: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() })
    queueMicrotask(() => {
      if (args.includes('--version')) { child.stdout.write('0.2.1-rc.4\n'); child.emit('close', 0) }
      else if (args.includes('plugin')) child.emit('close', 0)
      else child.stdout.write('dsh web: http://127.0.0.1:31337/\n')
    })
    return child
  })
})

describe('explicit DSH home isolation', () => {
  it('uses the selected home for version and backend processes and never probes an unrelated host', async () => {
    const inherited = process.env.DSH_HOME
    const runtime = new DshRuntime(context as never, output as never, undefined, home)
    await runtime.start()
    expect(mocks.probe).not.toHaveBeenCalled()
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    for (const call of mocks.spawn.mock.calls) expect(call[2].env.DSH_HOME).toBe(home)
    expect(process.env.DSH_HOME).toBe(inherited)
    await runtime.stop()
  })

  it('uses the same home for official plugin commands', async () => {
    const manager = new DshPluginManager(context as never, { cwd: process.cwd() } as never, output as never, home)
    await (manager as unknown as { runOfficialPluginCommand(args: string[], title: string): Promise<void> }).runOfficialPluginCommand(['list'], 'test')
    expect(mocks.spawn.mock.calls[0]![2].env.DSH_HOME).toBe(home)
  })
})
