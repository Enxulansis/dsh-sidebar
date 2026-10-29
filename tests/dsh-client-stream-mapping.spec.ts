import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer, type WebSocket as WsSocket } from 'ws'
import { DshClient, type DshFrame } from '../src/dsh-client.js'
import { appendLiveEntry } from '../src/history.js'
import type { DshEvent } from '../src/conversation.js'

/* 0.1.79（用户报②"终止状态不统一"）回归面：
   assistant-stream 的 chunk 帧只带 attemptId，turn/step 靠 start 帧登记。旧实现兜底 `{turn:0,step:0}`
   会合成 `assistant:0:0` 幻影消息（负 seq ⇒ 排到对话末尾），而真实的结算帧是 `assistant:${turn}:${step}`
   ⇒ 该消息永不结算 ⇒ webview 里"白块（光标）+ 蓝鲸头像"永久呼吸、切会话也不消失。
   三条口径：① 订阅时吸收快照 assistantStream.activeAttempt 的 turn/step；
             ② 未登记的 attempt 落到"该会话当前未结束的 step"；
             ③ 连它也没有 ⇒ 丢弃本帧（绝不伪造）。 */

const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms) })

interface ServerHandle {
  httpUrl: string
  followReady: Promise<string>
  push: (streamId: string, value: unknown) => void
  close: () => Promise<void>
}

async function startServer(): Promise<ServerHandle> {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>(resolve => { server.once('listening', () => { resolve() }) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  const sockets: WsSocket[] = []
  let resolveFollow: ((id: string) => void) | undefined
  const followReady = new Promise<string>(resolve => { resolveFollow = resolve })
  let followSeen = false
  server.on('connection', socket => {
    sockets.push(socket)
    socket.on('error', () => { /* 测试期断链不惊动 */ })
    socket.on('message', data => {
      const frame = JSON.parse(data.toString()) as { type?: string; streamId?: string; endpoint?: string }
      if (frame.type !== 'open' || frame.endpoint !== 'session/follow' || followSeen) return
      followSeen = true
      resolveFollow?.(String(frame.streamId))
    })
  })
  return {
    httpUrl: `http://127.0.0.1:${String(port)}`,
    followReady,
    push: (streamId, value) => { for (const socket of sockets) socket.send(JSON.stringify({ streamId, type: 'item', value })) },
    close: () => new Promise<void>(resolve => {
      for (const socket of sockets) socket.terminate()
      server.close(() => { resolve() })
    }),
  }
}

const clients: DshClient[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.dispose()
  vi.unstubAllGlobals()
})

async function setup(): Promise<{ server: ServerHandle; client: DshClient; streamId: string; frames: DshFrame[] }> {
  const server = await startServer()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })))
  const client = new DshClient(new URL(server.httpUrl))
  clients.push(client)
  const frames: DshFrame[] = []
  client.onFrame(frame => frames.push(frame))
  client.startStreams()
  /* follow 流的开启由 history() 触发（ensureFollowStream 在 RPC 之前同步执行）。 */
  void client.history('s1').catch(() => undefined)
  const streamId = await server.followReady
  await sleep(150)
  return { server, client, streamId, frames }
}

const chunkFrames = (frames: readonly DshFrame[]): Array<Record<string, unknown>> => frames
  .filter(frame => frame.payload.type === 'session/event' && (frame.payload.event as { type?: string } | undefined)?.type === 'assistant/chunk')
  .map(frame => frame.payload.event as Record<string, unknown>)

const pushStepStart = (server: ServerHandle, streamId: string, turn: number, step: number): void => {
  server.push(streamId, { type: 'event', event: { type: 'step/start', seq: 6, time: 1, data: { turn, step } } })
}
const pushChunk = (server: ServerHandle, streamId: string, attemptId: string, text: string): void => {
  server.push(streamId, { type: 'assistant-stream', frame: { type: 'chunk', attemptId, revision: 1, index: 0, time: 1, chunk: { type: 'text-delta', index: 0, text } } })
}

describe('DshClient assistant-stream 归并（0.1.79 终止态）', () => {
  it('重建client后合成seq仍唯一，保留窗口不会吞掉新chunk', async () => {
    const servers: ServerHandle[] = []
    try {
      const chunks: DshEvent[] = []
      for (const text of ['old', 'new']) {
        const { server, client, streamId, frames } = await setup()
        servers.push(server)
        pushStepStart(server, streamId, 1, 1)
        pushChunk(server, streamId, 'attempt', text)
        await sleep(100)
        expect(chunkFrames(frames)).toHaveLength(1)
        chunks.push(chunkFrames(frames)[0] as unknown as DshEvent)
        client.dispose()
      }
      expect(chunks[0]!.seq).toBeLessThan(0)
      expect(chunks[1]!.seq).toBeLessThan(0)
      expect(chunks[1]!.seq).not.toBe(chunks[0]!.seq)
      const retained = [{ event: chunks[0]! }]
      expect(appendLiveEntry(retained, { event: chunks[1]! })).toHaveLength(2)
    } finally {
      await Promise.all(servers.map(server => server.close()))
    }
  })

  it('订阅时吸收快照 assistantStream.activeAttempt 的 turn/step', async () => {
    const { server, streamId, frames } = await setup()
    server.push(streamId, {
      type: 'snapshot', cursor: 17, records: [], projections: { values: {} },
      assistantStream: { revision: 586, activeAttempt: { attemptId: 'a1', startedAfterSeq: 14, turn: 1, step: 1, nextIndex: 585, stream: [] } },
    })
    await sleep(120)
    pushChunk(server, streamId, 'a1', '在途文本')
    await sleep(120)

    const chunks = chunkFrames(frames)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.data).toMatchObject({ turn: 1, step: 1, chunk: { type: 'text-delta', text: '在途文本' } })
    await server.close()
  })

  it('未登记的 attempt 归并到"当前未结束的 step"（不是 0:0 幻影）', async () => {
    const { server, streamId, frames } = await setup()
    pushStepStart(server, streamId, 3, 2)
    await sleep(120)
    pushChunk(server, streamId, 'unknown-attempt', '迟到文本')
    await sleep(120)

    const chunks = chunkFrames(frames)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.data).toMatchObject({ turn: 3, step: 2 })
    expect(chunks[0]?.data).not.toMatchObject({ turn: 0, step: 0 })
    await server.close()
  })

  it('没有未结束 step 时丢弃 chunk——绝不伪造 assistant:0:0', async () => {
    const { server, streamId, frames } = await setup()
    pushStepStart(server, streamId, 1, 1)
    await sleep(80)
    server.push(streamId, { type: 'event', event: { type: 'step/end', seq: 7, time: 1, data: { turn: 1, step: 1 } } })
    await sleep(120)
    pushChunk(server, streamId, 'orphan', '孤儿文本')
    await sleep(150)

    expect(chunkFrames(frames)).toHaveLength(0)
    await server.close()
  })

  it('快照 activeAttempt 缺 turn/step 时不登记（不制造新的伪造源）', async () => {
    const { server, streamId, frames } = await setup()
    server.push(streamId, {
      type: 'snapshot', cursor: 3, records: [], projections: { values: {} },
      assistantStream: { revision: 2, activeAttempt: { attemptId: 'a2' } },
    })
    await sleep(120)
    pushChunk(server, streamId, 'a2', '无坐标文本')
    await sleep(150)

    expect(chunkFrames(frames)).toHaveLength(0)
    await server.close()
  })
})
