import type { IdeContextReference } from './ide-context.js'

export interface PinnedEntry {
  id: string
  reference: IdeContextReference
}

export const PINNED_SLOT_CAP = 32

/** Keeps the newest session slots; evicts the oldest key beyond the cap. */
export function savePinnedSlot(slots: Map<string, PinnedEntry[]>, sessionId: string, entries: PinnedEntry[]): void {
  // set alone keeps the original insertion order, so delete first to refresh an old slot to newest
  slots.delete(sessionId)
  slots.set(sessionId, entries)
  while (slots.size > PINNED_SLOT_CAP) {
    const oldest = slots.keys().next()
    if (oldest.done) break
    slots.delete(oldest.value)
  }
}

export function stillInSessions(sessions: readonly unknown[] | undefined, sessionId: string): boolean {
  return Array.isArray(sessions) && sessions.some(session => session !== undefined
    && typeof session === 'object' && session !== null
    && (session as { id?: unknown }).id === sessionId)
}

/** Deep-copies entries so restoring never shares mutable state with a live slot. */
export function clonePinnedEntries(entries: readonly PinnedEntry[]): PinnedEntry[] {
  return entries.map(entry => ({
    id: entry.id,
    reference: { ...entry.reference },
  }))
}
