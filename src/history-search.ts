import { ConversationProjector, toolMessageIdOfEvent, type ConversationMessage } from './conversation.js'
import { earliestHistorySequence } from './history.js'
import { HISTORY_SCAN_PAGE_MESSAGES, olderHistoryPages, type QuietHistoryReader } from './history-scan.js'
import { messageSearchEntries, searchSessionIndex, SEARCH_HITS_PER_SESSION_MAX, SEARCH_TOOL_HITS_PER_SESSION_MAX, type SearchIndexHit } from './session-search-index.js'

interface ToolSearchState {
  anchor?: number
  latestIsResult: boolean
  callSeen: boolean
  callHit?: SearchIndexHit | undefined
  resultHit?: SearchIndexHit | undefined
  fallbackHit?: SearchIndexHit | undefined
}

/** Retain the earliest bounded hits, matching the index's deliberate middle/early-history ordering. */
function retainHits(hits: SearchIndexHit[]): SearchIndexHit[] {
  const ordered = hits.slice().sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity))
  const seen = new Set<string>()
  let ordinary = 0, tools = 0
  return ordered.filter(hit => {
    if (seen.has(hit.messageId)) return false
    seen.add(hit.messageId)
    return hit.kind === '工具' ? tools++ < SEARCH_TOOL_HITS_PER_SESSION_MAX : ordinary++ < SEARCH_HITS_PER_SESSION_MAX
  })
}

/** Query-time scan: one page of bodies and compact identity/match metadata; final hits are capped. */
export async function scanSessionHistory(reader: QuietHistoryReader, sessionId: string, query: string, excludes: readonly string[] = [], signal?: AbortSignal): Promise<SearchIndexHit[]> {
  signal?.throwIfAborted()
  if (query.trim() === '') return []
  const first = await reader.historyQuiet(sessionId, HISTORY_SCAN_PAGE_MESSAGES, undefined, signal)
  signal?.throwIfAborted()
  const identities = new Map<string, { anchor?: number; hit?: SearchIndexHit }>()
  const tools = new Map<string, ToolSearchState>()
  const match = (message: ConversationMessage): SearchIndexHit | undefined => searchSessionIndex({
    version: 5, sessions: { [sessionId]: { revision: 0, entries: messageSearchEntries([message]) } },
  }, query, 1, excludes)[0]
  const toolProjector = new ConversationProjector()
  const consume = (events: typeof first.events): void => {
    const projector = new ConversationProjector(); projector.reset(events)
    for (const message of projector.iterMessages()) {
      if (message.role === 'tool') continue
      const existing = identities.get(message.id)
      const identity = existing ?? {}
      if (message.seq !== undefined && (identity.anchor === undefined || message.seq < identity.anchor)) identity.anchor = message.seq
      // Body replacements belong to the newest page, but every older occurrence can lower
      // the stable anchor. Apply quotas only after all anchors are known: an updated early
      // message may initially look too recent and must not be discarded prematurely.
      if (existing === undefined) {
        const hit = match(message)
        if (hit !== undefined) identity.hit = hit
      }
      identities.set(message.id, identity)
    }
    // Walk tools newest first. Results replace previous output (including empty output),
    // while the latest call owns name/arguments and a later call clears previous results.
    // Retain only bounded hit snippets, never complete bodies from older pages.
    for (let i = events.length - 1; i >= 0; i--) {
      const entry = events[i]!, event = entry.event
      const id = toolMessageIdOfEvent(event)
      if (id === undefined) continue
      const existing = tools.get(id)
      const state = existing ?? { latestIsResult: event.type === 'tool/result', callSeen: false }
      if (Number.isFinite(event.seq) && (state.anchor === undefined || event.seq < state.anchor)) state.anchor = event.seq
      if (existing === undefined && state.latestIsResult) {
        toolProjector.reset([entry])
        const message = toolProjector.messages()[0]!
        state.resultHit = match({ ...message, text: '' })
        state.fallbackHit = match({ id, role: 'tool', text: message.text })
      }
      if (event.type === 'tool/call' && !state.callSeen) {
        state.callSeen = true
        toolProjector.reset([entry])
        state.callHit = match(toolProjector.messages()[0]!)
      }
      tools.set(id, state)
    }
  }
  consume(first.events)
  if (first.hasMore) for await (const page of olderHistoryPages(reader, sessionId, earliestHistorySequence(first.events), signal)) consume(page)
  signal?.throwIfAborted()
  const matches: SearchIndexHit[] = []
  for (const { anchor, hit } of identities.values()) {
    if (hit !== undefined) matches.push(anchor === undefined ? hit : { ...hit, seq: anchor })
  }
  for (const state of tools.values()) {
    const hit = (state.callSeen ? state.callHit : state.fallbackHit) ?? (state.latestIsResult ? state.resultHit : undefined)
    if (hit !== undefined) matches.push(state.anchor === undefined ? hit : { ...hit, seq: state.anchor })
  }
  return retainHits(matches)
}
