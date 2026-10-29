import { afterEach, expect, it, vi } from 'vitest'
import { DshClient, type DshFrame } from '../src/dsh-client.js'
const clients: DshClient[] = []
afterEach(() => { clients.splice(0).forEach(client => client.dispose()); vi.unstubAllGlobals() })
const message = (id = 'q') => ({ id, source: { kind: 'user', rpcId: 'request-' + id }, content: [{ type: 'text', text: 'queued' }] })
function setup() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })))
  const client = new DshClient(new URL('http://127.0.0.1:54321')); clients.push(client)
  const frames: DshFrame[] = []; client.onFrame(frame => frames.push(frame))
  const p = client as unknown as {
    handleControlStreamItem(value: unknown): void
    handleJobsStreamItem(value: unknown, streamId: string): void
    ensureFollowStream(sessionId: string): void
    handleFollowStreamItem(value: unknown, streamId: string): void
    lastQueueBySession: Map<string, unknown>
    lastJobsBySession: Map<string, Array<{ id: string; startedAt: number }>>
    followSessionByStream: Map<string, string>
    jobsSessionByStream: Map<string, string>
    followStreamId: string
    jobsStreamId: string
    attemptTurnStep: Map<string, unknown>
    openStepBySession: Map<string, unknown>
  }
  const inbox = (sessionId: string, messages: unknown[]) => p.handleControlStreamItem({ type: 'projection', sessionId, key: 'inbox', value: { 'next-turn': messages, 'next-step': [] } })
  const jobs = (list: unknown[]) => p.handleJobsStreamItem({ type: 'rows', jobs: list }, p.jobsStreamId)
  return { client, p, frames, inbox, jobs }
}
it('releases drained inbox payloads and replaces job rows through 1000 session switches', () => {
  const { p, inbox, jobs } = setup()
  for (let i = 0; i < 1000; i++) {
    const sid = `s${i}`; p.ensureFollowStream(sid)
    inbox(sid, [message()]); jobs([{ id: `j${i}`, startedAt: i }])
    expect(p.lastJobsBySession.size).toBe(1)
    inbox(sid, []); jobs([])
  }
  expect(p.lastQueueBySession.size + p.lastJobsBySession.size).toBe(0)
  expect(p.jobsSessionByStream.size).toBe(1)
})

it('orders projection values across control and follow snapshots without rolling back permissions or inbox', () => {
  const { p, frames, client } = setup()
  p.ensureFollowStream('a')
  const update = (seq: number, currentValue: string) => p.handleControlStreamItem({ type: 'projection', sessionId: 'a', key: 'permissions', seq, value: { currentValue } })
  update(11, 'read-only')
  p.handleFollowStreamItem({ type: 'snapshot', records: [], projections: { asOfSeq: 10, values: { permissions: { currentValue: 'danger-full-access' } } } }, p.followStreamId)
  update(9, 'danger-full-access')
  expect(frames.filter(f => f.payload.type === 'session/projection' && f.payload.key === 'permissions').map(f => f.payload.value)).toEqual([{ currentValue: 'read-only' }])
  update(12, 'workspace-write')
  p.handleControlStreamItem({ type: 'baseline', value: { projections: { a: { asOfSeq: 11, values: { permissions: { currentValue: 'read-only' } } } } } })
  expect(frames.filter(f => f.payload.key === 'permissions').at(-1)?.payload.value).toEqual({ currentValue: 'workspace-write' })
  p.handleFollowStreamItem({ type: 'snapshot', records: [], projections: { asOfSeq: 20, values: { inbox: { 'next-turn': [] } } } }, p.followStreamId)
  p.handleControlStreamItem({ type: 'projection', sessionId: 'a', key: 'inbox', seq: 19, value: { 'next-turn': [message('stale')] } })
  expect(p.lastQueueBySession.size).toBe(0)
  client.forgetSession('a')
  expect(Reflect.get(client, 'projectionSequences').size).toBe(0)
})

it('forwards permission catalog invalidation even without a session projection', () => {
  const { client, frames } = setup()
  Reflect.get(client, 'handleEventStreamItem').call(client, { type: 'emit', event: 'permission-presets/catalog-changed', args: [] })
  expect(frames.at(-1)?.payload).toEqual({ type: 'host/permission-catalog-changed' })
})

it('recovers pending approval audit identities and removes decided queue entries', async () => {
  const { client, p, frames } = setup()
  p.ensureFollowStream('a')
  const event = (type: string, id: string) => ({ type, data: { id } })
  p.handleFollowStreamItem({ type: 'snapshot', records: [
    { event: event('approval/asked', 'done') }, { event: event('approval/decided', 'done') }, { event: event('approval/asked', 'pending') },
  ] }, p.followStreamId)
  Reflect.set(client, 'eventClientId', 'client-1')
  const waterfall = { event: 'approval/request', eventId: 'event-1', agentId: 'a', request: { toolName: 'pwsh' } }
  Reflect.get(client, 'registerWaterfall').call(client, waterfall)
  expect(frames.at(-1)?.payload.approvalId).toBe('pending')
  const disconnectedRpc = frames.at(-1)!.rpcId
  Reflect.set(client, 'eventClientId', undefined)
  await expect(client.respond(disconnectedRpc, { outcome: 'allowed-once' })).rejects.toThrow('本次决定尚未提交')
  Reflect.set(client, 'eventClientId', 'client-2')
  Reflect.get(client, 'registerWaterfall').call(client, waterfall)
  expect(frames.at(-1)?.payload.approvalId).toBe('pending')
  p.handleFollowStreamItem({ type: 'event', event: event('approval/asked', 'completed-before-waterfall') }, p.followStreamId)
  p.handleFollowStreamItem({ type: 'event', event: event('approval/decided', 'completed-before-waterfall') }, p.followStreamId)
  expect(Reflect.get(client, 'pendingAskedBySession').size).toBe(0)
})
it('restores a background approval using only the live event-client identity and clears it on cancel', () => {
  const { client, p, frames } = setup()
  p.ensureFollowStream('other')
  Reflect.set(client, 'eventClientId', 'client-1')
  const request = { event: 'approval/request', eventId: 'event-a', agentId: 'a', request: { toolName: 'pwsh', reason: 'owned' } }
  Reflect.get(client, 'registerWaterfall').call(client, request)
  const first = client.pendingApproval('a')!
  expect(first).toEqual({ rpcId: frames.at(-1)!.rpcId, approvalId: 'event-a', toolName: 'pwsh', reason: 'owned' })
  expect(client.pendingApproval('other')).toBeNull()
  Reflect.set(client, 'eventClientId', undefined)
  expect(client.pendingApproval('a')).toBeNull()
  Reflect.set(client, 'eventClientId', 'client-2')
  expect(client.pendingApproval('a')).toBeNull()
  Reflect.get(client, 'registerWaterfall').call(client, request)
  expect(client.pendingApproval('a')?.approvalId).toBe(first.approvalId)
  expect(client.pendingApproval('a')?.rpcId).not.toBe(first.rpcId)
  Reflect.get(client, 'handleEventStreamItem').call(client, { type: 'cancel', eventId: 'event-a' })
  expect(client.pendingApproval('a')).toBeNull()
  expect(frames.at(-1)?.payload).toEqual({ type: 'approval/resolved', sessionId: 'a', approvalId: first.approvalId })
})
it.each(['event', 'snapshot'])('does not restore an approval decided by another client through %s', type => {
  const { client, p } = setup()
  p.ensureFollowStream('a')
  Reflect.set(client, 'eventClientId', 'client-1')
  Reflect.get(client, 'registerWaterfall').call(client, { event: 'approval/request', eventId: 'approval-a', agentId: 'a', request: { toolName: 'pwsh' } })
  expect(client.pendingApproval('a')).not.toBeNull()
  const event = { type: 'approval/decided', data: { id: 'approval-a' } }
  p.handleFollowStreamItem(type === 'event' ? { type, event } : { type, records: [{ event }] }, p.followStreamId)
  expect(client.pendingApproval('a')).toBeNull()
})
it('preserves backend timestamps and ignores traffic from a cancelled job stream', () => {
  const { p, frames, jobs } = setup()
  p.ensureFollowStream('a'); const oldStream = p.jobsStreamId
  jobs([{ id: 'same', startedAt: 100 }]); jobs([{ id: 'same', startedAt: 100 }, { id: 'next', startedAt: 200 }])
  expect(p.lastJobsBySession.get('a')?.map(job => job.startedAt)).toEqual([100, 200])
  p.ensureFollowStream('b'); jobs([{ id: 'same', startedAt: 300 }])
  const count = frames.length
  p.handleJobsStreamItem({ type: 'rows', jobs: [{ id: 'late' }] }, oldStream)
  expect(frames).toHaveLength(count)
  expect([...p.lastJobsBySession.keys()]).toEqual(['b'])
  expect(p.lastJobsBySession.get('b')?.[0]?.startedAt).toBe(300)
})
it('replaces reconnect baselines and consumes follow inbox snapshots with plugin context hidden', () => {
  const { p, frames } = setup()
  p.handleControlStreamItem({ type: 'baseline', value: { projections: { old: { values: { inbox: { 'next-turn': [message()] } } } } } })
  p.handleControlStreamItem({ type: 'baseline', value: { projections: {} } })
  expect(p.lastQueueBySession.size).toBe(0)
  const queueFrames = frames.filter(f => f.payload.type === 'session/queue')
  expect(queueFrames).toHaveLength(2); expect(queueFrames.at(-1)?.payload.items).toEqual([])
  p.ensureFollowStream('old')
  p.handleFollowStreamItem({ type: 'snapshot', records: [], projections: { values: { inbox: { 'next-step': [message('steer'), { id: 'context', source: { kind: 'plugin' } }] } } } }, p.followStreamId)
  expect(p.lastQueueBySession.get('old')).toEqual([{ id: 'steer', placement: 'steering', message: message('steer') }])
})
it('drops cancelled identities and unfinished coordinates during 1000 switches', () => {
  const { p } = setup()
  for (let i = 0; i < 1000; i++) {
    p.ensureFollowStream(`s${i}`)
    p.handleFollowStreamItem({ type: 'snapshot', assistantStream: { activeAttempt: { attemptId: `a${i}`, turn: i, step: 1 } } }, p.followStreamId)
    p.handleFollowStreamItem({ type: 'event', event: { type: 'step/start', data: { turn: i, step: 1 } } }, p.followStreamId)
  }
  expect(p.followSessionByStream.size).toBe(1); expect(p.jobsSessionByStream.size).toBe(1)
  expect(p.attemptTurnStep.size).toBe(1); expect(p.openStepBySession.size).toBe(1)
})
it('forgets deleted sessions and ignores late inbox/job traffic until followed again', () => {
  const { client, p, frames, inbox, jobs } = setup()
  p.ensureFollowStream('deleted'); const oldJobs = p.jobsStreamId, oldFollow = p.followStreamId
  Reflect.get(client, 'cursorBySession').set('deleted', 100)
  Reflect.get(client, 'pendingAskedBySession').set('deleted', ['asked'])
  Reflect.get(client, 'pendingEventResults').set('deleted-rpc', { sessionId: 'deleted' })
  Reflect.get(client, 'pendingEventResults').set('other-rpc', { sessionId: 'other' })
  inbox('deleted', [message()]); jobs([{ id: 'j' }]); client.forgetSession('deleted')
  const count = frames.length
  inbox('deleted', [message('late')]); p.handleJobsStreamItem({ type: 'rows', jobs: [{ id: 'late' }] }, oldJobs)
  expect(frames).toHaveLength(count)
  expect(p.followSessionByStream.size + p.jobsSessionByStream.size + p.lastJobsBySession.size + p.lastQueueBySession.size).toBe(0)
  expect(Reflect.get(client, 'cursorBySession').size + Reflect.get(client, 'pendingAskedBySession').size).toBe(0)
  expect([...Reflect.get(client, 'pendingEventResults').keys()]).toEqual(['other-rpc'])
  expect(Reflect.get(client, 'streamKinds').has(oldFollow)).toBe(false)
  p.ensureFollowStream('deleted'); jobs([{ id: 'restored' }])
  expect(p.lastJobsBySession.get('deleted')?.[0]?.id).toBe('restored')
  client.dispose()
  expect(p.lastJobsBySession.size + p.lastQueueBySession.size + p.followSessionByStream.size + p.jobsSessionByStream.size).toBe(0)
  expect(Reflect.get(client, 'forgottenSessions').size).toBe(0)
})
