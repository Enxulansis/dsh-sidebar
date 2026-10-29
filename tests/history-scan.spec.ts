import { expect, it, vi } from 'vitest'
import { ConversationProjector } from '../src/conversation.js'
import type { HistoryEntry } from '../src/dsh-client.js'
import { olderHistoryPages, readHistoryRail } from '../src/history-scan.js'
import { buildRailNodeTables, deriveOutlinePieces } from '../src/rail-nodes.js'

function start(seq: number): HistoryEntry { return { event: { type: 'turn/start', seq, time: 1, data: { turn: seq } } } }
function user(seq: number, id: string, text: string): HistoryEntry { return { event: { type: 'user/message', seq, time: 1, data: { id, source: { kind: 'user' }, content: [{ type: 'text', text }] } } } }

it('matches full projection prompt presence across split turns, overlap and user replacement', async () => {
  const all = [start(0), user(1, 'u1', '<system-reminder>injected</system-reminder>'), user(2, 'u1b', 'real'), start(3), user(4, 'u2', 'old'), start(5), user(6, 'u2', 'new'), start(7), user(8, 'u3', 'Time sampled while preparing a turn')]
  const seed = all.slice(7)
  const pages = [all.slice(5, 8), all.slice(2, 5), all.slice(0, 3)]
  const read = { historyQuiet: async () => ({ events: pages.shift()!, hasMore: pages.length > 0 }) }
  const { outline } = await readHistoryRail(read, 's', seed)
  const projector = new ConversationProjector(); projector.reset(all)
  expect(outline.map(p => ({ seq: p.seq, hasPrompt: p.prompt !== '' }))).toEqual(deriveOutlinePieces([0, 3, 5, 7], projector.iterMessages()).map(p => ({ seq: p.seq, hasPrompt: p.prompt !== '' })))
})

it.each([[], [start(5)], [start(6)]].map(events => ({ events })))('rejects a nonadvancing prefix rather than accepting a partial outline: %j', async ({ events }) => {
  const read = { historyQuiet: async () => ({ events, hasMore: true }) }
  await expect(readHistoryRail(read, 's', [start(5)])).rejects.toThrow('did not advance')
})

it('cancels before consuming a late page and stops requesting earlier pages', async () => {
  const abort = new AbortController(); let calls = 0
  const read = { historyQuiet: async (_session: string, _limit?: number, _cursor?: number, signal?: AbortSignal) => {
    expect(signal).toBe(abort.signal); calls++; abort.abort(); return { events: [start(0)], hasMore: true }
  } }
  await expect(readHistoryRail(read, 's', [start(5)], abort.signal)).rejects.toThrow('aborted')
  expect(calls).toBe(1)
})

it('excludes newer overlap from earlier pages at the immutable right boundary', async () => {
  const pages: HistoryEntry[][] = []
  for await (const page of olderHistoryPages({ historyQuiet: async () => ({ events: [start(0), start(5), start(6)], hasMore: false }) }, 's', 5)) pages.push(page)
  expect(pages).toEqual([[start(0)]])
})

const event = (seq: number, type: string, data: Record<string, unknown>): HistoryEntry => ({ event: { seq, type, time: 0, data } })
const answer = (seq: number, step: number, text = 'answer'): HistoryEntry => event(seq, 'assistant/message', { turn: 0, step, message: { content: [{ type: 'text', text }] } })
const interactive = [
  start(0), user(1, 'u1', 'prompt'),
  event(2, 'tool/call', { callId: 'normal', name: 'read', arguments: 'LARGE_SECRET_INPUT' }),
  event(3, 'approval/asked', { id: 'approval', toolName: 'read', reason: 'PRIVATE_REASON' }),
  event(4, 'approval/decided', { id: 'approval', outcome: 'approved' }),
  event(5, 'tool/result', { message: { source: { callId: 'normal' }, content: [{ type: 'text', text: 'PRIVATE_TOOL_OUTPUT' }] } }),
  answer(6, 1), event(7, 'tool/call', { callId: 'ask', name: 'ask_user_question' }),
  event(8, 'tool/result', { message: { content: [{ toolCallId: 'ask', type: 'text', text: 'PRIVATE_ANSWER' }] } }),
  answer(9, 2), event(10, 'command/run', { commandId: 'plan', name: 'plan', args: 'on' }),
  event(11, 'command/done', { commandId: 'plan' }), event(12, 'command/run', { commandId: 'normal', name: 'export' }),
  event(13, 'command/done', { commandId: 'normal', text: 'PRIVATE_COMMAND_OUTPUT' }),
  event(14, 'tool/call', { callId: 'ask', name: 'read' }), event(15, 'tool/result', { message: { source: { callId: 'ask' }, content: [] } }),
  event(16, 'tool/call', { callId: 'pending', name: 'ask_user_question' }),
  start(17), user(18, 'u2', 'old'), user(19, 'u2', '<system-reminder>updated synthetic</system-reminder>'),
  answer(20, 3), event(21, 'approval/decided', { id: 'denied', outcome: 'rejected' }), answer(22, 4),
]

it.each(Array.from({ length: interactive.length - 1 }, (_, i) => i + 1))('matches complete projection cards and identities when the newest seed starts at event %i', async cut => {
  const projector = new ConversationProjector(); projector.reset(interactive)
  const messages = projector.iterMessages(), stops = projector.segmentStops()
  const expected = buildRailNodeTables({ messages, stops, outline: deriveOutlinePieces([0, 17], messages) })
  const remaining = interactive.slice(0, cut), pages: HistoryEntry[][] = []
  while (remaining.length) pages.push(remaining.splice(Math.max(0, remaining.length - 3)))
  const scanned = await readHistoryRail({ historyQuiet: async () => ({ events: pages.shift()!, hasMore: pages.length > 0 }) }, 's', interactive.slice(cut))
  expect(scanned.rail).toEqual(expected)
  expect(scanned.stops).toEqual(stops)
  expect(JSON.stringify(scanned)).not.toMatch(/PRIVATE_|LARGE_SECRET/)
  expect(scanned.rail.segment.find(n => n.mid === 'tool:ask')?.stop).toBeUndefined() // later call changes card identity, but historical stop seq survives
  expect(scanned.rail.segment.some(n => n.mid === 'approval:approval' && n.stop === true)).toBe(true)
})

it('preserves image-only users, context-only filtering and answered tool identity with huge discarded bodies', async () => {
  const all = [start(0), user(1, 'hidden', '<ide-context>file</ide-context>'),
    event(2, 'user/message', { id: 'image', source: { kind: 'user' }, content: [{ type: 'image', attachment: { attachmentId: 'img', mediaType: 'image/png', width: 10, height: 10 } }] }),
    event(3, 'tool/call', { callId: 'q', name: 'ask_user_question', arguments: 'x'.repeat(100000) }),
    event(4, 'tool/result', { message: { source: { callId: 'q' }, content: [{ type: 'text', text: 'x'.repeat(200000) }] } }), answer(5, 1, 'x'.repeat(200000)),
  ]
  const projector = new ConversationProjector(); projector.reset(all)
  const messages = projector.iterMessages(), stops = projector.segmentStops()
  const scanned = await readHistoryRail({ historyQuiet: async () => ({ events: all.slice(0, 4), hasMore: false }) }, 's', all.slice(4))
  expect(scanned.rail).toEqual(buildRailNodeTables({ messages, stops, outline: deriveOutlinePieces([0], messages) }))
  expect(JSON.stringify(scanned).length).toBeLessThan(1000)
})

it('discards even short assistant bodies from retained replay metadata while preserving exact card classification', async () => {
  const all = [start(0), user(1, 'u', 'private-user'), answer(2, 1, 'secret'), answer(3, 2, 'ask_user_question')]
  const full = new ConversationProjector(); full.reset(all)
  const expected = buildRailNodeTables({ messages: full.iterMessages(), stops: full.segmentStops(), outline: deriveOutlinePieces([0], full.iterMessages()) })
  const reset = vi.spyOn(ConversationProjector.prototype, 'reset')
  try {
    const result = await readHistoryRail({ historyQuiet: async () => ({ events: all.slice(0, 3), hasMore: false }) }, 's', all.slice(3))
    expect(result.rail).toEqual(expected)
    const retainedReplay = JSON.stringify(reset.mock.calls.at(-1)?.[0])
    expect(retainedReplay).not.toMatch(/secret|private-user/)
    expect(retainedReplay).toContain('ask_user_question')
  } finally { reset.mockRestore() }
})
