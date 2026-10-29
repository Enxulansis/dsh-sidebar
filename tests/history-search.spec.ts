import { expect, it } from 'vitest'
import { scanSessionHistory } from '../src/history-search.js'
import type { HistoryEntry } from '../src/dsh-client.js'
import { ConversationProjector } from '../src/conversation.js'
import { messageSearchEntries, searchSessionIndex } from '../src/session-search-index.js'

function user(seq: number, id: string, text: string): HistoryEntry { return { event: { type: 'user/message', seq, time: seq, data: { id, source: { kind: 'user' }, content: [{ type: 'text', text }] } } } }
function reader(pages: HistoryEntry[][]) {
  const calls: number[] = []
  return { calls, historyQuiet: async (_id: string, _limit?: number, cursor?: number, _signal?: AbortSignal) => {
    calls.push(cursor ?? -1); const events = pages.shift()!; return { events, hasMore: pages.length > 0 }
  } }
}

function call(seq: number, name = 'read_file', args = 'other'): HistoryEntry {
  return { event: { type: 'tool/call', seq, time: seq, data: { callId: 't', name, arguments: args } } }
}
function result(seq: number, text: string, blockId = false): HistoryEntry {
  return { event: { type: 'tool/result', seq, time: seq, data: { message: {
    source: blockId ? { kind: 'tool' } : { kind: 'tool', callId: 't' },
    content: [{ type: 'text', text, ...(blockId ? { toolCallId: 't' } : {}) }],
  } } } }
}
function imageResult(seq: number, name: string): HistoryEntry {
  return { event: { type: 'tool/result', seq, time: seq, data: { message: {
    source: { kind: 'tool', callId: 't' }, content: [{ type: 'image', attachment: {
      attachmentId: 'image', mediaType: 'image/png', width: 1, height: 1, name,
    } }],
  } } } }
}

const toolCases = [
  { name: 'replaced matching result', events: [call(1), result(2, 'old needle'), result(3, 'revised')] },
  { name: 'latest matching snippet', events: [call(1), result(2, 'old needle'), result(3, 'latest needle needle')] },
  { name: 'empty latest result', events: [call(1), result(2, 'needle'), result(3, '')] },
  { name: 'later call clears old result', events: [call(1), result(2, 'needle'), call(3)] },
  { name: 'latest call arguments', events: [call(1, 'read_file', 'old needle'), call(2), result(3, 'done')] },
  { name: 'call arguments survive result replacement', events: [call(1, 'read_file', 'needle'), result(2, 'old needle'), result(3, 'done')] },
  { name: 'call hit has priority over result', events: [call(1, 'needle_tool', 'needle'), result(2, 'output needle')] },
  { name: 'block call ID owns latest result', events: [call(1), result(2, 'old needle'), result(3, 'done', true)] },
  { name: 'excluded latest result cannot revive old result', events: [call(1), result(2, 'needle'), result(3, 'needle excluded')], excludes: ['excluded'] },
  { name: 'latest images replace old images', events: [call(1), imageResult(2, 'needle.png'), imageResult(3, 'new.png')] },
  { name: 'empty result clears old images', events: [call(1), imageResult(2, 'needle.png'), result(3, '')] },
  { name: 'call hit precedes image hit', events: [call(1, 'read_file', 'needle'), imageResult(2, 'needle.png')] },
  { name: 'excluded arguments allow matching output', events: [call(1, 'read_file', 'needle excluded'), result(2, 'needle output')], excludes: ['excluded'] },
  { name: 'replacement call and output after an earlier result', events: [call(0, 'read_file', 'needle'), result(1, 'needle'), call(2), result(3, 'latest needle')] },
  { name: 'result-only tool has fallback name', events: [result(1, 'done'), result(2, 'done')], query: 'Tool' },
  { name: 'result-only page does not invent matching fallback name', events: [call(1, 'read_file'), result(2, 'done')], query: 'Tool' },
  { name: 'call name plus arguments remains one searchable entry', events: [call(1, 'needle', 'args'), result(2, 'done')], query: 'needle args' },
]

for (const fixture of toolCases) it(`matches full projection across every page partition: ${fixture.name}`, async () => {
  const projector = new ConversationProjector(); projector.reset(fixture.events)
  const query = fixture.query ?? 'needle'
  const expected = searchSessionIndex({ version: 5, sessions: { s: { revision: 0, entries: messageSearchEntries(projector.messages()) } } }, query, 60, fixture.excludes)
  const events = fixture.events
  for (let mask = 0; mask < 1 << (events.length - 1); mask++) {
    const pages: HistoryEntry[][] = [[]]
    for (let i = 0; i < events.length; i++) {
      pages[pages.length - 1].push(events[i])
      if (i < events.length - 1 && (mask & (1 << i)) !== 0) pages.push([])
    }
    expect(await scanSessionHistory(reader(pages.reverse()), 's', query, fixture.excludes), `partition ${mask}`).toEqual(expected)
  }
})

it('keeps independent tool identities and ordinary/tool quotas over interleaved pages', async () => {
  const events: HistoryEntry[] = []
  for (let i = 0; i < 30; i++) {
    const entry = call(i * 3, 'needle_tool', 'needle')
    ;(entry.event.data as { callId: string }).callId = `t${i}`
    events.push(entry, user(i * 3 + 1, `u${i}`, 'needle'))
    const output = result(i * 3 + 2, 'needle output')
    ;((output.event.data as { message: { source: { callId: string } } }).message.source).callId = `t${i}`
    events.push(output)
  }
  for (const size of [1, 7, 19, 90]) {
    const pages: HistoryEntry[][] = []
    for (let start = 0; start < events.length; start += size) pages.push(events.slice(start, start + size))
    const hits = await scanSessionHistory(reader(pages.reverse()), 's', 'needle')
    expect(hits.filter(hit => hit.kind === '文本').map(hit => hit.messageId)).toEqual(Array.from({ length: 12 }, (_, i) => `u${i}`))
    expect(hits.filter(hit => hit.kind === '工具').map(hit => [hit.messageId, hit.seq, hit.snippet])).toEqual(Array.from({ length: 24 }, (_, i) => [`tool:t${i}`, i * 3, 'needle_tool']))
  }
})

it('classifies tool names as tool hits without consuming the ordinary quota', async () => {
  const events = [call(1, 'needle_tool'), user(2, 'ordinary', 'needle')]
  const projector = new ConversationProjector(); projector.reset(events)
  expect(messageSearchEntries(projector.messages()).find(entry => entry.id === 'tool:t')?.kind).toBe('工具')
  expect((await scanSessionHistory(reader([events]), 's', 'needle')).find(hit => hit.messageId === 'tool:t')?.kind).toBe('工具')
})

it('finds early messages and matches beyond 4000 characters without changing persisted limits', async () => {
  const r = reader([[user(20001, 'last', 'tail')], [user(0, 'early', 'x'.repeat(4500) + 'NEEDLE needle')]])
  const hits = await scanSessionHistory(r, 's', 'needle')
  expect(hits).toHaveLength(1)
  expect(hits[0]).toMatchObject({ sessionId: 's', messageId: 'early', seq: 0, total: 2 })
  expect(hits[0].snippet).toContain('NEEDLE')
  expect(hits[0].snippetLong.length).toBeLessThan(500)
  expect(r.calls).toEqual([-1, 20001])
})

it('keeps the earliest 12 ordinary hits across pages and separate tool quota', async () => {
  const hits = await scanSessionHistory(reader([Array.from({ length: 20 }, (_, i) => user(20 + i, 'b' + i, 'needle')), Array.from({ length: 20 }, (_, i) => user(i, 'a' + i, 'needle'))]), 's', 'needle')
  expect(hits.map(h => h.messageId)).toEqual(Array.from({ length: 12 }, (_, i) => 'a' + i))
})

it('owns replacements by the newest page even when the new body does not match', async () => {
  const hits = await scanSessionHistory(reader([[user(2, 'same', 'revised'), user(3, 'another', 'needle')], [user(1, 'same', 'needle')]]), 's', 'needle')
  expect(hits.map(h => h.messageId)).toEqual(['another'])
})

it('uses the earliest anchor with latest matching body, even after the candidate was beyond the page quota', async () => {
  const r = reader([[user(100, 'updated', 'latest needle')], Array.from({ length: 20 }, (_, i) => user(20 + i, 'b' + i, 'needle')), [user(1, 'updated', 'old body')]])
  const hits = await scanSessionHistory(r, 's', 'needle')
  expect(hits).toHaveLength(12)
  expect(hits[0]).toMatchObject({ messageId: 'updated', seq: 1, snippet: 'latest needle' })
})

it('retains tool creation sequence when only a result on a later page contains the query', async () => {
  const result: HistoryEntry = { event: { type: 'tool/result', seq: 2, time: 2, data: { message: { source: { kind: 'tool', callId: 't' }, content: [{ type: 'text', text: 'needle' }] } } } }
  const call: HistoryEntry = { event: { type: 'tool/call', seq: 1, time: 1, data: { callId: 't', name: 'read_file', arguments: 'other' } } }
  expect((await scanSessionHistory(reader([[result], [call]]), 's', 'needle'))[0]).toMatchObject({ messageId: 'tool:t', kind: '工具', seq: 1 })
})

it('applies exclusions to the full text after the cache text limit', async () => {
  expect(await scanSessionHistory(reader([[user(1, 's', 'needle' + 'x'.repeat(4500) + 'excluded')]]), 's', 'needle', ['excluded'])).toEqual([])
})

it('finds tool call arguments when a later result is on another page', async () => {
  const result: HistoryEntry = { event: { type: 'tool/result', seq: 2, time: 2, data: { message: { source: { kind: 'tool', callId: 't' }, content: [{ type: 'text', text: 'done' }] } } } }
  const call: HistoryEntry = { event: { type: 'tool/call', seq: 1, time: 1, data: { callId: 't', name: 'read_file', arguments: 'needle' } } }
  expect((await scanSessionHistory(reader([[result], [call]]), 's', 'needle'))[0]).toMatchObject({ messageId: 'tool:t', kind: '工具', seq: 1 })
})

it('does not consume canceled pages, and propagates failures without claiming full coverage', async () => {
  const abort = new AbortController()
  await expect(scanSessionHistory({ historyQuiet: async () => { abort.abort(); return { events: [user(1, 'x', 'needle')], hasMore: false } } }, 's', 'needle', [], abort.signal)).rejects.toThrow('aborted')
  await expect(scanSessionHistory({ historyQuiet: async () => { throw new Error('read failed') } }, 's', 'needle')).rejects.toThrow('read failed')
})
