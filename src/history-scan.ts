import { ConversationProjector, toolMessageIdOfEvent, type DshEvent } from './conversation.js'
import type { HistoryEntry } from './dsh-client.js'
import { earliestHistorySequence } from './history.js'
import { buildRailNodeTables, deriveOutlinePieces, isSyntheticPromptText, type RailNodeTables, type RailOutlinePiece } from './rail-nodes.js'

/** Smaller pages for the early prefix; detailed rail and persisted search limits stay unchanged. */
export const HISTORY_SCAN_PAGE_MESSAGES = 2_000
export interface QuietHistoryReader {
  historyQuiet(sessionId: string, maxMessages?: number, beforeSeq?: number, signal?: AbortSignal): Promise<{ events: HistoryEntry[]; hasMore: boolean }>
}

/** A strictly decreasing cursor bounds traversal to the initial history cut. Never opens a follow. */
export async function* olderHistoryPages(reader: QuietHistoryReader, sessionId: string, beforeSeq: number | undefined, signal?: AbortSignal): AsyncGenerator<HistoryEntry[]> {
  if (beforeSeq === undefined) throw new Error('Incomplete history: missing page cursor.')
  let cursor = beforeSeq
  for (;;) {
    signal?.throwIfAborted()
    const page = await reader.historyQuiet(sessionId, HISTORY_SCAN_PAGE_MESSAGES, cursor, signal)
    signal?.throwIfAborted()
    const next = earliestHistorySequence(page.events)
    if (next === undefined || next >= cursor) throw new Error('Incomplete history: older page did not advance.')
    // Some hosts overlap page boundaries; newer pages own duplicate events.
    yield page.events.filter(entry => entry.event.seq < cursor)
    if (!page.hasMore) return
    cursor = next
  }
}

/** Keep only creation/stop semantics. The real projector owns cards, hidden commands and cross-page identity. */
function compactRailEvent(entry: HistoryEntry, probe: ConversationProjector): DshEvent | undefined {
  const event = entry.event
  const data = typeof event.data === 'object' && event.data !== null ? event.data as Record<string, unknown> : undefined
  if (data === undefined) return undefined
  const compact = (data: Record<string, unknown>, type = event.type): DshEvent => ({ type, seq: event.seq, time: 0, data })
  if (event.type === 'user/message' || event.type === 'assistant/message' || event.type === 'assistant/chunk') {
    // Reuse content/source/image/context validation; never retain body, image bytes or attachments.
    probe.reset([entry])
    const message = probe.iterMessages()[0]
    if (message === undefined) return undefined
    if (event.type === 'user/message') {
      const text = message.text.trim()
      return compact({ id: message.id, source: { kind: 'user' }, content: [{ type: 'text', text: text !== '' && !isSyntheticPromptText(text) ? 'prompt' : '<system-reminder>' }] })
    }
    const identity = { turn: String(data.turn), step: String(data.step) }
    const text = message.text === 'ask_user_question' ? 'ask_user_question' : 'message'
    return event.type === 'assistant/chunk'
      ? compact({ ...identity, chunk: { type: 'text-delta', text } })
      : compact({ ...identity, message: { content: [{ type: 'text', text }] } })
  }
  if (event.type === 'tool/call') return compact({ callId: toolMessageIdOfEvent(event)!.slice(5), name: data.name === 'ask_user_question' ? 'ask_user_question' : 'Tool' })
  if (event.type === 'tool/result') return compact({ message: { source: { callId: toolMessageIdOfEvent(event)!.slice(5) }, content: [] } })
  if (event.type === 'approval/decided') return compact({ id: typeof data.id === 'string' ? data.id : '' })
  if (event.type === 'command/run' && typeof data.commandId === 'string' && typeof data.name === 'string') {
    const args = typeof data.args === 'string' ? data.args.trim() : ''
    return compact({ commandId: data.commandId, name: data.name === 'plan' ? 'plan' : 'command', args: ['', 'on', 'off'].includes(args) ? args : 'other' })
  }
  if (event.type === 'command/done' && typeof data.commandId === 'string') return compact({ commandId: data.commandId })
  return undefined
}

/** Full rail from small read-only pages; retained metadata scales with visible events, never their bodies. */
export async function readHistoryRail(reader: QuietHistoryReader, sessionId: string, seed: HistoryEntry[], signal?: AbortSignal): Promise<{ outline: RailOutlinePiece[]; rail: RailNodeTables; stops: number[] }> {
  const starts = new Set<number>()
  const events = new Map<number, DshEvent>()
  const probe = new ConversationProjector()
  const consume = (entries: HistoryEntry[]): void => {
    for (const entry of entries) {
      signal?.throwIfAborted()
      if (entry.event.type === 'turn/start') starts.add(entry.event.seq)
      if (events.has(entry.event.seq)) continue
      const compact = compactRailEvent(entry, probe)
      if (compact !== undefined) events.set(entry.event.seq, compact)
    }
  }
  consume(seed)
  for await (const page of olderHistoryPages(reader, sessionId, earliestHistorySequence(seed), signal)) consume(page)
  signal?.throwIfAborted()
  const projector = new ConversationProjector()
  projector.reset([...events.values()].sort((a, b) => a.seq - b.seq))
  const messages = projector.iterMessages(), stops = projector.segmentStops()
  const outline = deriveOutlinePieces([...starts], messages)
  return { outline, rail: buildRailNodeTables({ messages, stops, outline }), stops }
}
