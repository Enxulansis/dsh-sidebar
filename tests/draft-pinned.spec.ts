import { describe, expect, it } from 'vitest'
import {
  PINNED_SLOT_CAP,
  clonePinnedEntries,
  savePinnedSlot,
  stillInSessions,
  type PinnedEntry,
} from '../src/draft-pinned.js'

const fileEntry = (path: string): PinnedEntry => ({
  id: `id-${path}`,
  reference: { kind: 'file', path },
})

const selectionEntry = (path: string, text: string): PinnedEntry => ({
  id: `sel-${path}`,
  reference: { kind: 'selection', path, startLine: 1, endLine: 2, text },
})

describe('draft-pinned', () => {
  it('saves and reads back a slot (including selection text)', () => {
    const slots = new Map<string, PinnedEntry[]>()
    savePinnedSlot(slots, 'sA', [fileEntry('a.md'), selectionEntry('a.md', 'text-a')])

    expect(slots.get('sA')).toEqual([
      { id: 'id-a.md', reference: { kind: 'file', path: 'a.md' } },
      { id: 'sel-a.md', reference: { kind: 'selection', path: 'a.md', startLine: 1, endLine: 2, text: 'text-a' } },
    ])
  })

  it('keeps the newest slots and evicts the oldest beyond the cap', () => {
    const slots = new Map<string, PinnedEntry[]>()
    for (let index = 0; index < PINNED_SLOT_CAP + 5; index += 1) {
      savePinnedSlot(slots, `s${index}`, [fileEntry(`${index}.md`)])
    }

    expect(slots.size).toBe(PINNED_SLOT_CAP)
    expect(slots.has('s0')).toBe(false)
    expect(slots.has('s4')).toBe(false)
    expect(slots.has('s5')).toBe(true)
    expect(slots.has(`s${PINNED_SLOT_CAP + 4}`)).toBe(true)
  })

  it('re-saving an existing session refreshes it to newest (not evicted)', () => {
    const slots = new Map<string, PinnedEntry[]>()
    for (let index = 0; index < PINNED_SLOT_CAP; index += 1) savePinnedSlot(slots, `s${index}`, [])
    savePinnedSlot(slots, 's0', [fileEntry('refresh.md')])
    savePinnedSlot(slots, `s${PINNED_SLOT_CAP}`, [])

    expect(slots.has('s0')).toBe(true)
    expect(slots.get('s0')).toEqual([fileEntry('refresh.md')])
    expect(slots.has('s1')).toBe(false)
  })

  it('stillInSessions matches only live session ids', () => {
    const sessions = [{ id: 'sA' }, { id: 'sB' }]
    expect(stillInSessions(sessions, 'sA')).toBe(true)
    expect(stillInSessions(sessions, 'sC')).toBe(false)
    expect(stillInSessions(sessions, 'missing')).toBe(false)
  })

  it('stillInSessions tolerates malformed or empty inputs', () => {
    expect(stillInSessions([], 'sA')).toBe(false)
    expect(stillInSessions(undefined as unknown as readonly unknown[], 'sA')).toBe(false)
    expect(stillInSessions([undefined, null, 'sA', 42], 'sA')).toBe(false)
    expect(stillInSessions([undefined, { id: 'sA' }], 'sA')).toBe(true)
  })

  it('clonePinnedEntries deep-copies so restored state never mutates the slot', () => {
    const source = [selectionEntry('a.md', 'text-a')]
    const clone = clonePinnedEntries(source)
    const cloned = clone[0]
    expect(cloned).toBeDefined()
    if (cloned !== undefined) cloned.reference.text = 'mutated'

    expect(source[0]?.reference.text).toBe('text-a')
  })

  it('stores empty slots and restores them as empty without entries', () => {
    const slots = new Map<string, PinnedEntry[]>()
    savePinnedSlot(slots, 'sA', [])
    expect(slots.get('sA')).toEqual([])

    const restored = slots.get('sA') ?? []
    expect(restored).toEqual([])
  })
})
