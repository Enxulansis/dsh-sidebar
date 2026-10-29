import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer, type WebSocket as WsSocket } from 'ws'
import { DshClient, livenessExpired } from '../src/dsh-client.js'

/* 0.1.20（2026-09-22 真机事故）回归面：
   ① 帧消费方抛异常不得外泄到 socket 'message' 回调——外泄会砸断 Node 流读取机构，
      同一次 TCP 读取里后续帧全丢且 close 永不触发（连接僵尸化、重连永不启动）。
   ② 僵尸连接不会自己发 close，只能靠看门狗（ws ping / pong）发现并主动拔掉。
   这里用真 ws 服务端（非 mock）：既验证我方隔离，也顺带验证 ws 层确实会自动回 pong。 */

const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms) })

interface StreamReady {
  socket: WsSocket
  eventsStreamId: string
}

interface ServerHandle {
  /* 客户端由 baseUrl 推导 socket 地址（http→ws 换协议），故测试必须把服务端端口喂给它。 */
  httpUrl: string
  sockets: WsSocket[]
  pingCount: () => number
  /** 等下一次"客户端连上并开好 $events 流"；先登记再 startStreams，避免竞争。 */
  nextEventsStream: () => Promise<StreamReady>
  close: () => Promise<void>
}

/** 本地 mux 服务端：抓客户端的 open 帧拿 $events 的 streamId，之后可推 emit 帧。 */
async function startServer(options: { autoPong: boolean; pongLimit?: number }): Promise<ServerHandle> {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1', autoPong: options.autoPong })
  await new Promise<void>(resolve => { server.once('listening', () => { resolve() }) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  const sockets: WsSocket[] = []
  const readyQueue: StreamReady[] = []
  const readyWaiters: Array<(value: StreamReady) => void> = []
  let pings = 0
  let pongsSent = 0

  server.on('connection', (socket) => {
    sockets.push(socket)
    socket.on('error', () => { /* 测试期断链不惊动 */ })
    /* autoPong:false 时手动回 pong——pongLimit 用完后停供，模拟"连接还在但读循环已死"。 */
    socket.on('ping', () => {
      pings += 1
      if (options.pongLimit !== undefined && pongsSent >= options.pongLimit) return
      pongsSent += 1
      socket.pong()
    })
    socket.on('message', (data) => {
      const frame = JSON.parse(data.toString()) as { type?: string; streamId?: string; endpoint?: string }
      if (frame.type !== 'open' || frame.endpoint !== '$events') return
      const ready: StreamReady = { socket, eventsStreamId: String(frame.streamId) }
      const waiter = readyWaiters.shift()
      if (waiter === undefined) readyQueue.push(ready)
      else waiter(ready)
    })
  })

  return {
    httpUrl: `http://127.0.0.1:${String(port)}`,
    sockets,
    pingCount: () => pings,
    nextEventsStream: () => {
      const queued = readyQueue.shift()
      if (queued !== undefined) return Promise.resolve(queued)
      return new Promise<StreamReady>(resolve => { readyWaiters.push(resolve) })
    },
    /* 先拔掉存量连接再关：ws 的 server.close() 只等连接自然结束，不会主动断开。 */
    close: () => new Promise<void>(resolve => {
      for (const socket of sockets) socket.terminate()
      server.close(() => { resolve() })
    }),
  }
}

function pushStatus(socket: WsSocket, eventsStreamId: string, sessionId: string, running: boolean): void {
  socket.send(JSON.stringify({
    streamId: eventsStreamId,
    type: 'item',
    value: { type: 'emit', event: 'api-session/status', args: [sessionId, running] },
  }))
}

const clients: DshClient[] = []

afterEach(() => {
  for (const client of clients.splice(0)) client.dispose()
  vi.unstubAllGlobals()
})

/* 认证失败不影响本测试（客户端把缺 cookie 当正常降级）——桩掉避免真发请求。 */
function stubAuth(): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })))
}

function newClient(server: ServerHandle, liveness?: { pingMs: number; deadMs: number }): DshClient {
  const client = new DshClient(new URL(server.httpUrl), liveness)
  clients.push(client)
  return client
}

describe('DshClient 帧处理隔离（0.1.20 事故回归）', () => {
  it('监听器抛异常既不外泄、也不拖累后续帧与其它监听器', async () => {
    const server = await startServer({ autoPong: true })
    stubAuth()
    const client = newClient(server)
    const seen: string[] = []
    const diagnostics: string[] = []
    client.onFrame(frame => {
      if (frame.payload.type !== 'host/session-status') return
      throw new Error('boom（模拟 publish 里漏出的 ReferenceError）')
    })
    client.onFrame(frame => {
      if (frame.payload.type === 'host/session-status') seen.push(String(frame.payload.sessionId))
    })
    client.onFrameError(message => { diagnostics.push(message) })
    const ready = server.nextEventsStream()
    client.startStreams()
    const { socket, eventsStreamId } = await ready

    /* 三条帧连发（真机事故里结算帧与 turn/end 同批到达的形态） */
    pushStatus(socket, eventsStreamId, 's1', true)
    pushStatus(socket, eventsStreamId, 's2', true)
    pushStatus(socket, eventsStreamId, 's3', true)
    await sleep(250)

    expect(seen).toEqual(['s1', 's2', 's3'])
    expect(diagnostics).toHaveLength(3)
    expect(diagnostics[0]).toContain('boom')
    await server.close()
  })
})

describe('DshClient 连接看门狗（0.1.20 僵尸连接）', () => {
  it('pong 正常时不误杀（心跳照发）', async () => {
    const server = await startServer({ autoPong: true })
    stubAuth()
    const client = newClient(server, { pingMs: 20, deadMs: 80 })
    const ready = server.nextEventsStream()
    client.startStreams()
    const { socket } = await ready
    await sleep(220)
    expect(server.pingCount()).toBeGreaterThanOrEqual(2)
    expect(socket.readyState).toBe(1)
    await server.close()
  })

  it('对端证明过会回 pong 后断供 → 主动断开并重连（僵尸连接不会自己给 close）', async () => {
    const server = await startServer({ autoPong: false, pongLimit: 2 })
    stubAuth()
    const client = newClient(server, { pingMs: 20, deadMs: 60 })
    const diagnostics: string[] = []
    client.onFrameError(message => { diagnostics.push(message) })
    const first = server.nextEventsStream()
    client.startStreams()
    const { socket } = await first
    expect(socket.readyState).toBe(1)

    /* 先登记重连等待器，再看门狗判死 → terminate → 既有 close→重连链路接管（退避 2s）。 */
    const reconnected = await Promise.race([
      server.nextEventsStream().then(() => true),
      sleep(4000).then(() => false),
    ])
    expect(diagnostics.some(message => message.includes('静默'))).toBe(true)
    expect(reconnected).toBe(true)
    await server.close()
  })

  it('livenessExpired：未见过 pong 一律不判死，见过后超时才判死', () => {
    expect(livenessExpired(false, 0, 10_000_000, 60)).toBe(false)
    expect(livenessExpired(true, 1_000, 1_060, 60)).toBe(false)
    expect(livenessExpired(true, 1_000, 1_061.5, 60)).toBe(true)
  })
})
