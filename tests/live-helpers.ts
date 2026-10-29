/* live 场景库公共设施：spawn 真 dsh → parseDshWebUrl 解析 → DshClient 连接。
   每个域 spec 一个 harness 实例（beforeAll 起、afterAll 收），it 之间共享。
   用法见 tests/live-domain-01-sessions.spec.ts。 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { listenOnPrivateTestPort } from './private-test-port.js'
import { parseDshWebUrl, resolveLaunch } from '../src/launch.ts'
import { DshClient, type DshFrame } from '../src/dsh-client.js'

export const LIVE_PROBE_CWD = join(tmpdir(), 'dsh-sidebar-probe')
const BOOT_OUTPUT_MAX_CHARS = 64 * 1024

export interface LiveHarness {
  client: DshClient
  frames: DshFrame[]
  processId?: number
  stop: () => void
}

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** 只清理本测试拥有的运行中进程；Windows 同时清理其子进程。 */
export function killTree(child: ChildProcessWithoutNullStreams): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true, stdio: 'ignore' })
    else child.kill()
  } catch { /* best effort */ }
}

export async function startLiveHarness(
  cwd: string = LIVE_PROBE_CWD,
  options: { home?: string; startupTimeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<LiveHarness> {
  mkdirSync(cwd, { recursive: true })
  if (options.home !== undefined) mkdirSync(options.home, { recursive: true })
  const env = { ...process.env, ...options.env, NO_COLOR: '1', ...(options.home === undefined ? {} : { DSH_HOME: options.home }) }
  const reservation = createServer(), port = await listenOnPrivateTestPort(reservation)
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))
  if (!env.DSH_TEST_CLI || options.home === undefined) throw new Error('Live tests require DSH_TEST_CLI and an explicit isolated home')
  const cliArgs = ['web', '--host', '127.0.0.1', '--port', String(port), '--no-open']
  const launch = /\.[cm]?js$/i.test(env.DSH_TEST_CLI)
    ? { command: process.execPath, args: [env.DSH_TEST_CLI, ...cliArgs], env: {}, windowsVerbatimArguments: false }
    : resolveLaunch(cwd, env.DSH_TEST_CLI, cliArgs, { cwd, env })
  if (launch.windowsVerbatimArguments) throw new Error('live harness: 请在 PATH 中提供可直接启动的 dsh 安装')
  const child: ChildProcessWithoutNullStreams = spawn(
    launch.command, launch.args,
    { cwd, env: { ...env, ...launch.env }, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  ) as ChildProcessWithoutNullStreams
  child.stdin.end()
  let url: string | undefined
  let bootError: Error | undefined
  const bootOutput = { stdout: '', stderr: '' }
  child.on('error', error => { bootError = error })
  for (const [name, output] of [['stdout', child.stdout], ['stderr', child.stderr]] as const) {
    let buffer = ''
    output.setEncoding('utf8')
    output.on('data', (chunk: string) => {
      bootOutput[name] = (bootOutput[name] + chunk).slice(-BOOT_OUTPUT_MAX_CHARS)
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) url ??= parseDshWebUrl(line)
    })
  }
  let client: DshClient | undefined
  try {
    const timeoutMs = options.startupTimeoutMs ?? 60_000
    const deadline = Date.now() + timeoutMs
    while (url === undefined) {
      if (bootError !== undefined) throw new Error('live harness: dsh 进程启动失败', { cause: bootError })
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`live harness: dsh 提前退出（${child.exitCode ?? child.signalCode}）`)
      if (Date.now() >= deadline) throw new Error(`live harness: 未在 ${timeoutMs} 毫秒内解析出 dsh URL`)
      await sleep(100)
    }
    if (new URL(url).port !== String(port)) throw new Error('live harness: runtime did not bind the reserved port')
    client = new DshClient(new URL(url))
    const frames: DshFrame[] = []
    client.onFrame(frame => frames.push(frame))
    client.startStreams()
    await client.settings()
    let stopped = false
    const readyClient = client
    return { client, frames, ...(child.pid === undefined ? {} : { processId: child.pid }), stop: () => {
      if (stopped) return
      stopped = true
      readyClient.dispose()
      killTree(child)
    } }
  } catch (error) {
    client?.dispose()
    killTree(child)
    // Only an explicitly isolated fixture home may retain startup output; never
    // dump a legacy harness using the user's profile into test logs or Git.
    if (options.home !== undefined) {
      const path = join(options.home, 'startup-failure.json')
      writeFileSync(path, JSON.stringify({ pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode, error: String(error), ...bootOutput }, null, 2), 'utf8')
      throw new Error(`live harness: ${String(error)}；隔离诊断已保存至 ${path}`, { cause: error })
    }
    throw error
  }
}

/** 轮询等待某一帧出现（默认 60 秒）。 */
export async function waitForFrame(
  frames: readonly DshFrame[],
  predicate: (frame: DshFrame) => boolean,
  timeoutMs = 60_000,
): Promise<DshFrame | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const hit = frames.find(predicate)
    if (hit !== undefined) return hit
    await sleep(400)
  }
  return undefined
}

export function eventsOf(frames: readonly DshFrame[], sessionId: string): Array<Record<string, unknown>> {
  return frames
    .filter(f => f.payload.type === 'session/event' && f.payload.sessionId === sessionId)
    .map(f => f.payload.event as Record<string, unknown>)
}

/** 发送一条 prompt 并收集本轮新增的会话事件：等到 `turn/end`，再留 settleMs 让尾帧落定。 */
export async function askTurn(
  harness: LiveHarness,
  sessionId: string,
  text: string,
  timeoutMs = 180_000,
  settleMs = 2_500,
): Promise<Array<Record<string, unknown>>> {
  const before = eventsOf(harness.frames, sessionId).length
  await harness.client.prompt(sessionId, text)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const fresh = eventsOf(harness.frames, sessionId).slice(before)
    if (fresh.some(e => e.type === 'turn/end')) {
      await sleep(settleMs)
      return eventsOf(harness.frames, sessionId).slice(before)
    }
    await sleep(Math.min(400, Math.max(1, deadline - Date.now())))
  }
  await harness.client.cancel(sessionId).catch(() => { /* 保留原始超时原因 */ })
  throw new Error(`live harness: 会话 ${sessionId} 未在 ${timeoutMs} 毫秒内收到 turn/end，已请求取消`)
}

/** 自动应答审批（默认 allowed-once），返回停止函数。
    背景（2026-09-19）：本机运行时的审批策略为 ask，部分命令（如 git reset --hard）会先走
    approval/asked；无应答者的探针若不接此助手会一直挂到超时（域13/13c 曾因此整批 180s 超时）。
    仅对"审批门在守卫之前"的用例启用（守卫是否拦截仍需断言其后行为）。 */
export function autoApprove(harness: Pick<LiveHarness, 'client' | 'frames'>, outcome: 'allowed-once' | 'rejected' = 'allowed-once'): () => void {
  const seen = new Set<string>()
  const timer = setInterval(() => {
    for (const frame of harness.frames) {
      if (frame.payload.type !== 'approval/requested' || seen.has(frame.rpcId)) continue
      seen.add(frame.rpcId)
      const payload = frame.payload as { sessionId?: string; approvalId?: string }
      void harness.client
        .respond(frame.rpcId, { sessionId: payload.sessionId ?? '', approvalId: payload.approvalId ?? '', outcome })
        .catch(() => { /* 已被应答/会话已收尾 */ })
    }
  }, 400)
  timer.unref?.()
  return () => clearInterval(timer)
}

/** 工具结果文本（tool/result 事件的文本块，展平）。 */
export function toolTextsOf(events: Array<Record<string, unknown>>): string[] {
  return events
    .filter(e => e.type === 'tool/result')
    .flatMap(e => {
      const data = e.data as { message?: { content?: Array<{ content?: Array<{ text?: string }> }> } } | undefined
      return (data?.message?.content ?? []).flatMap(c => (c.content ?? []).map(x => x.text ?? ''))
    })
}

export function projectionsOf(frames: readonly DshFrame[], sessionId: string, key: string): unknown[] {
  return frames
    .filter(f => f.payload.type === 'session/projection' && f.payload.sessionId === sessionId && f.payload.key === key)
    .map(f => f.payload.value)
}
