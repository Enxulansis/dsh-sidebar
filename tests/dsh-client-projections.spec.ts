import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'
import { DshClient, type DshFrame } from '../src/dsh-client.js'

type Wire = { type: string; streamId: string; endpoint?: string; payload?: { args: { request: Record<string, unknown> } } }
const resources: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of resources.splice(0)) await close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function setup() {
  vi.stubGlobal('fetch', vi.fn(async (_url: URL, init?: RequestInit) => {
    if (!init?.body) return new Response()
    const request = JSON.parse(String(init.body))
    return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: { records: [], hasMore: false } } }))
  }))
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>(resolve => server.once('listening', resolve))
  const port = (server.address() as { port: number }).port
  const wires: Array<{ socket: WebSocket; frame: Wire }> = []
  const sockets: WebSocket[] = []
  server.on('connection', socket => {
    sockets.push(socket)
    socket.on('message', data => wires.push({ socket, frame: JSON.parse(String(data)) }))
  })
  const client = new DshClient(new URL(`http://127.0.0.1:${port}`)), frames: DshFrame[] = [], errors: Error[] = []
  client.onFrame(frame => frames.push(frame))
  client.onError(error => errors.push(error))
  resources.push(async () => {
    client.dispose()
    for (const socket of sockets) socket.terminate()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  client.startStreams()
  await vi.waitFor(() => expect(client.socketOpen).toBe(true))
  const snapshotOpen = async (index = 0) => {
    await vi.waitFor(() => expect(wires.filter(w => w.frame.type === 'open' && w.frame.streamId.startsWith('snapshot-')).length).toBeGreaterThan(index))
    return wires.filter(w => w.frame.type === 'open' && w.frame.streamId.startsWith('snapshot-'))[index]!
  }
  const push = (wire: { socket: WebSocket; frame: Wire }, type: string, fields: object) => wire.socket.send(JSON.stringify({ streamId: wire.frame.streamId, type, ...fields }))
  const baseline = { asOfSeq: 100, values: { turnOutline: [{ seq: 1, prompt: 'early' }, { seq: 80, prompt: 'late' }] } }
  return { client, frames, errors, wires, sockets, snapshotOpen, push, baseline }
}

describe('owned quiet projection snapshots', () => {
  it('reads and cancels only its own snapshot, preserving the active follow and ignoring late foreign records', async () => {
    const h = await setup()
    await h.client.history('current')
    await vi.waitFor(() => expect(h.wires.some(w => w.frame.endpoint === 'session/follow')).toBe(true))
    const active = h.wires.find(w => w.frame.endpoint === 'session/follow')!
    h.push(active, 'item', { value: { type: 'snapshot', projections: { values: {} }, records: [] } })
    await vi.waitFor(() => expect(h.frames.some(f => f.payload.type === 'session/subscribed')).toBe(true))
    const initial = h.frames.length
    const pending = h.client.projectionsQuiet('foreign'), owned = await h.snapshotOpen()
    expect(owned.frame.payload?.args.request).toEqual({ address: { kind: 'session', sessionId: 'foreign' }, maxMessages: 1 })
    h.push(owned, 'item', { value: { type: 'event', event: { seq: 90, type: 'turn/end' } } })
    h.push(owned, 'item', { value: { type: 'snapshot', projections: h.baseline, records: [{ event: { seq: 90, type: 'turn/end' } }] } })
    await expect(pending).resolves.toEqual(h.baseline)
    await vi.waitFor(() => expect(h.wires.filter(w => w.frame.type === 'cancel' && w.frame.streamId === owned.frame.streamId)).toHaveLength(1))
    h.push(owned, 'item', { value: { type: 'snapshot', projections: h.baseline } })
    await h.client.history('current')
    expect(h.wires.filter(w => w.frame.type === 'open' && w.frame.endpoint === 'session/follow' && !w.frame.streamId.startsWith('snapshot-'))).toHaveLength(1)
    expect(h.frames.slice(initial)).toEqual([])
    expect(h.errors).toEqual([])
  })

  it('isolates simultaneous sessions and one canceled request from another successful request', async () => {
    const h = await setup(), abort = new AbortController()
    const first = h.client.projectionsQuiet('a', abort.signal), rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    const second = h.client.projectionsQuiet('b')
    const a = await h.snapshotOpen(), b = await h.snapshotOpen(1)
    abort.abort()
    await rejected
    h.push(a, 'item', { value: { type: 'snapshot', projections: { values: { turnOutline: ['a'] } } } })
    h.push(b, 'item', { value: { type: 'snapshot', projections: h.baseline } })
    await expect(second).resolves.toEqual(h.baseline)
    await vi.waitFor(() => expect(h.wires.filter(w => w.frame.type === 'cancel')).toHaveLength(2))
    expect(h.frames).toEqual([])
  })

  it.each(['error', 'end', 'missing-baseline'])('rejects %s locally without locking the current chat', async kind => {
    const h = await setup(), pending = h.client.projectionsQuiet('foreign')
    const rejected = expect(pending).rejects.toThrow(kind === 'error' ? 'fixture failure' : kind === 'end' ? 'ended before' : 'missing projections')
    const owned = await h.snapshotOpen()
    h.push(owned, kind === 'missing-baseline' ? 'item' : kind, kind === 'error' ? { error: { message: 'fixture failure' } } : { value: { type: 'snapshot' } })
    await rejected
    expect(h.errors).toEqual([])
    expect(h.client.socketOpen).toBe(true)
  })

  it('cancels and rejects a timed out snapshot instead of retaining its stream', async () => {
    const h = await setup(), timeout = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    const pending = h.client.projectionsQuiet('foreign'), rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    const owned = await h.snapshotOpen()
    timeout.abort(new DOMException('deadline', 'TimeoutError'))
    await rejected
    await vi.waitFor(() => expect(h.wires.some(w => w.frame.type === 'cancel' && w.frame.streamId === owned.frame.streamId)).toBe(true))
  })

  it('rejects pending work on disposal and never opens a new stream afterward', async () => {
    const h = await setup(), pending = h.client.projectionsQuiet('foreign'), rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await h.snapshotOpen()
    h.client.dispose()
    await rejected
    await expect(h.client.projectionsQuiet('later')).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects old-generation work on disconnect and allows a new snapshot after reconnect', async () => {
    const h = await setup(), pending = h.client.projectionsQuiet('foreign'), rejected = expect(pending).rejects.toThrow('connection closed')
    const old = await h.snapshotOpen()
    const lifecycle = h.client as unknown as { socket: WebSocket; livenessTimer: unknown; teardownSocket: (socket: WebSocket) => void }
    const oldClientSocket = lifecycle.socket
    old.socket.terminate()
    await rejected
    await vi.waitFor(() => expect(h.sockets).toHaveLength(2), { timeout: 4000 })
    await vi.waitFor(() => expect(h.client.socketOpen).toBe(true))
    const newTimer = lifecycle.livenessTimer
    lifecycle.teardownSocket(oldClientSocket)
    expect(newTimer).toBeDefined()
    expect(lifecycle.livenessTimer).toBe(newTimer)
    const next = h.client.projectionsQuiet('new'), owned = await h.snapshotOpen(1)
    expect(owned.frame.streamId).not.toBe(old.frame.streamId)
    // Simulate a frame already queued by the old socket before close; its ownership was removed.
    const raw = h.client as unknown as { handleSocketText: (text: string) => void }
    raw.handleSocketText(JSON.stringify({ type: 'item', streamId: old.frame.streamId, value: { type: 'snapshot', projections: { values: { wrong: true } } } }))
    h.push(owned, 'item', { value: { type: 'snapshot', projections: h.baseline } })
    await expect(next).resolves.toEqual(h.baseline)
    expect(h.frames.every(f => f.payload.type === 'host/socket-open')).toBe(true)
  }, 6000)

  it('does not open work canceled during authentication or while offline', async () => {
    let authenticate!: (response: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => { authenticate = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new DshClient(new URL('http://127.0.0.1:1')), abort = new AbortController()
    resources.push(async () => client.dispose())
    const pending = client.projectionsQuiet('foreign', abort.signal), rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    abort.abort()
    authenticate(new Response())
    await rejected
    await expect(client.projectionsQuiet('offline')).rejects.toThrow('open connection')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
