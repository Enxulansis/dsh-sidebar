import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DshFrame } from '../src/dsh-client.js'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), spawnSync: vi.fn(), dispose: vi.fn(), settings: vi.fn(), streams: vi.fn(), resolve: vi.fn(), reservePort: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn, spawnSync: mocks.spawnSync }))
vi.mock('node:fs', () => ({ mkdirSync: vi.fn(), writeFileSync: vi.fn() }))
vi.mock('node:net', () => ({ createServer: () => ({ close: (callback: () => void) => callback() }) }))
vi.mock('./private-test-port.js', () => ({ listenOnPrivateTestPort: mocks.reservePort }))
vi.mock('../src/launch.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/launch.ts')>(), resolveLaunch: mocks.resolve,
}))
vi.mock('../src/dsh-client.js', () => ({ DshClient: class {
  dispose = mocks.dispose
  settings = mocks.settings
  startStreams = mocks.streams
  onFrame() {}
} }))
import { askTurn, startLiveHarness as isolatedHarness, type LiveHarness } from './live-helpers.js'
const startLiveHarness: typeof isolatedHarness = (cwd, options) => isolatedHarness(cwd, { home: 'isolated-home', ...options })

function child() {
  const output = () => Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  return Object.assign(new EventEmitter(), {
    pid: 123, exitCode: null as number | null, signalCode: null as string | null,
    stdin: { end: vi.fn() }, stdout: output(), stderr: output(), kill: vi.fn(),
  })
}
function frame(type: string, sessionId = 'own'): DshFrame {
  return { channel: 'mux', rpcId: 'fixture', payload: { type: 'session/event', sessionId, event: { type } } }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  vi.stubEnv('DSH_TEST_CLI', 'isolated-dsh')
  mocks.resolve.mockReturnValue({ command: process.execPath, args: ['fixture.js'], sourceCheckout: false })
  mocks.settings.mockResolvedValue({ namespaces: [] })
  mocks.reservePort.mockResolvedValue(55000)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('real runtime test ownership and readiness', () => {
  it('refuses to launch without an explicit isolated CLI and home', async () => {
    await expect(isolatedHarness('fixture')).rejects.toThrow('explicit isolated home')
    vi.stubEnv('DSH_TEST_CLI', '')
    await expect(startLiveHarness('fixture')).rejects.toThrow('DSH_TEST_CLI')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('reports spawn failure promptly without attempting to kill an undefined PID', async () => {
    const proc = child(); Object.assign(proc, { pid: undefined }); mocks.spawn.mockReturnValue(proc)
    const boot = startLiveHarness('fixture')
    const assertion = expect(boot).rejects.toThrow('启动失败')
    await vi.advanceTimersByTimeAsync(0)
    proc.emit('error', new Error('ENOENT'))
    await vi.advanceTimersByTimeAsync(100); await assertion
    expect(mocks.spawnSync).not.toHaveBeenCalled(); expect(proc.kill).not.toHaveBeenCalled()
  })
  it('reports an early exit without waiting for the startup deadline', async () => {
    const proc = child(); mocks.spawn.mockReturnValue(proc)
    const boot = startLiveHarness('fixture')
    const assertion = expect(boot).rejects.toThrow('提前退出（7）')
    await vi.advanceTimersByTimeAsync(0)
    proc.exitCode = 7
    await vi.advanceTimersByTimeAsync(100); await assertion
    expect(mocks.spawnSync).not.toHaveBeenCalled()
  })
  it('cleans its running process tree on startup timeout', async () => {
    const proc = child(); mocks.spawn.mockReturnValue(proc)
    const boot = startLiveHarness('fixture', { startupTimeoutMs: 200 })
    const assertion = expect(boot).rejects.toThrow('200 毫秒')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(200); await assertion
    if (process.platform === 'win32') expect(mocks.spawnSync).toHaveBeenCalledWith('taskkill', ['/F', '/T', '/PID', '123'], expect.any(Object))
    else expect(proc.kill).toHaveBeenCalledOnce()
  })
  it('accepts a chunked URL on stderr, waits for the real service, and stops only once', async () => {
    const proc = child(); mocks.spawn.mockReturnValue(proc)
    const boot = startLiveHarness('fixture', { home: 'isolated-home' })
    await vi.advanceTimersByTimeAsync(0)
    proc.stderr.emit('data', 'dsh web: http://127.0.0.1:55000/?token=')
    proc.stderr.emit('data', 'fixture\n')
    await vi.advanceTimersByTimeAsync(100)
    const harness = await boot
    expect(mocks.settings).toHaveBeenCalledOnce()
    expect(mocks.spawn.mock.calls[0]?.[2]).toMatchObject({ shell: false, windowsHide: true, env: { DSH_HOME: 'isolated-home' } })
    harness.stop(); harness.stop()
    expect(mocks.dispose).toHaveBeenCalledOnce()
  })
  it('disposes the client and process if service readiness fails', async () => {
    const proc = child(); mocks.spawn.mockReturnValue(proc); mocks.settings.mockRejectedValue(new Error('service unavailable'))
    const boot = startLiveHarness('fixture'); const assertion = expect(boot).rejects.toThrow('service unavailable')
    await vi.advanceTimersByTimeAsync(0)
    proc.stdout.emit('data', 'dsh web: http://127.0.0.1:55000/\n')
    await vi.advanceTimersByTimeAsync(100); await assertion
    expect(mocks.dispose).toHaveBeenCalledOnce()
    if (process.platform === 'win32') expect(mocks.spawnSync).toHaveBeenCalledOnce()
    else expect(proc.kill).toHaveBeenCalledOnce()
  })
  it('rejects a reported endpoint that does not use its reserved port', async () => {
    const proc = child(); mocks.spawn.mockReturnValue(proc)
    const boot = startLiveHarness('fixture'), assertion = expect(boot).rejects.toThrow('reserved port')
    await vi.advanceTimersByTimeAsync(0)
    proc.stdout.emit('data', 'dsh web: http://127.0.0.1:55001/\n')
    await vi.advanceTimersByTimeAsync(100); await assertion
    expect(mocks.settings).not.toHaveBeenCalled()
    if (process.platform === 'win32') expect(mocks.spawnSync).toHaveBeenCalledOnce()
    else expect(proc.kill).toHaveBeenCalledOnce()
  })
})

describe('completed turn evidence', () => {
  it('ignores old and other-session end events, cancels on timeout, and rejects incomplete evidence', async () => {
    const frames = [frame('turn/end'), frame('turn/end', 'other')]
    const cancel = vi.fn().mockResolvedValue({ accepted: true })
    const harness = { frames, client: { prompt: vi.fn().mockImplementation(async () => { frames.push(frame('assistant/chunk')) }), cancel } } as unknown as LiveHarness
    const turn = askTurn(harness, 'own', 'fixture', 500, 0)
    const assertion = expect(turn).rejects.toThrow('未在 500 毫秒内收到 turn/end')
    await vi.advanceTimersByTimeAsync(500); await assertion
    expect(cancel).toHaveBeenCalledWith('own')
  })
  it('returns only newly completed events including trailing frames', async () => {
    const frames = [frame('turn/end')]
    const cancel = vi.fn()
    const harness = { frames, client: { prompt: vi.fn().mockImplementation(async () => {
      frames.push(frame('assistant/chunk'), frame('turn/end'))
      setTimeout(() => frames.push(frame('assistant/message')), 50)
    }), cancel } } as unknown as LiveHarness
    const turn = askTurn(harness, 'own', 'fixture', 500, 100)
    await vi.advanceTimersByTimeAsync(100)
    expect((await turn).map(event => event.type)).toEqual(['assistant/chunk', 'turn/end', 'assistant/message'])
    expect(cancel).not.toHaveBeenCalled()
  })
})
