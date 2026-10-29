import { describe, expect, it } from 'vitest'
import { insertSessionAfter, moveSessionBefore, orderSessions, type SessionTabItem } from '../src/session-order.js'

const tab = (id: string): SessionTabItem => ({ id, title: `t-${id}`, running: false, blank: false })

describe('session-order', () => {
  it('inserts the restored session right after the current one (trailing case)', () => {
    const sessions = [tab('a'), tab('b'), tab('c'), tab('d')]

    const moved = insertSessionAfter(sessions, 'd', 'a')

    expect(moved.map(item => item.id)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('fires for an item that sits on the left of the anchor (target after anchor)', () => {
    const sessions = [tab('a'), tab('b'), tab('c'), tab('d')]

    const moved = insertSessionAfter(sessions, 'a', 'd')

    expect(moved.map(item => item.id)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('is a no-op when the moved item already hugs the anchor', () => {
    const sessions = [tab('a'), tab('b'), tab('c'), tab('d')]

    const moved = insertSessionAfter(sessions, 'b', 'a')

    expect(moved).toBe(sessions)
  })

  it('tolerates a missing moved id (returns the same reference)', () => {
    const sessions = [tab('a'), tab('b')]

    expect(insertSessionAfter(sessions, 'zz', 'a')).toBe(sessions)
  })

  it('tolerates a missing anchor id (returns the same reference)', () => {
    const sessions = [tab('a'), tab('b')]

    expect(insertSessionAfter(sessions, 'a', 'zz')).toBe(sessions)
  })

  it('does not mutate the input list', () => {
    const sessions = [tab('a'), tab('b'), tab('c')]

    insertSessionAfter(sessions, 'c', 'a')

    expect(sessions.map(item => item.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('moveSessionBefore', () => {
  it('moves the item to just before the target', () => {
    const sessions = [tab('a'), tab('b'), tab('c'), tab('d')]

    const moved = moveSessionBefore(sessions, 'd', 'a')

    expect(moved.map(item => item.id)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('moves a left item forward', () => {
    const sessions = [tab('a'), tab('b'), tab('c'), tab('d')]

    const moved = moveSessionBefore(sessions, 'a', 'd')

    expect(moved.map(item => item.id)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves to the end when no target is given', () => {
    const sessions = [tab('a'), tab('b'), tab('c')]

    expect(moveSessionBefore(sessions, 'a').map(item => item.id)).toEqual(['b', 'c', 'a'])
  })

  it('is a no-op when already in place', () => {
    const sessions = [tab('a'), tab('b'), tab('c')]

    expect(moveSessionBefore(sessions, 'b', 'c')).toBe(sessions)
    expect(moveSessionBefore(sessions, 'a', 'b')).toBe(sessions)
    expect(moveSessionBefore(sessions, 'c')).toBe(sessions)
  })

  it('tolerates missing or self target ids (returns the same reference)', () => {
    const sessions = [tab('a'), tab('b')]

    expect(moveSessionBefore(sessions, 'zz', 'a')).toBe(sessions)
    expect(moveSessionBefore(sessions, 'a', 'zz')).toBe(sessions)
    expect(moveSessionBefore(sessions, 'a', 'a')).toBe(sessions)
  })

  it('does not mutate the input list', () => {
    const sessions = [tab('a'), tab('b'), tab('c')]

    moveSessionBefore(sessions, 'a')

    expect(sessions.map(item => item.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('orderSessions', () => {
  it('reorders the list to follow the persisted order', () => {
    const sessions = [tab('a'), tab('b'), tab('c')]

    const ordered = orderSessions(sessions, ['c', 'a'])

    expect(ordered.map(item => item.id)).toEqual(['c', 'a', 'b'])
  })

  it('keeps server order for ids absent from the persisted order (appended at tail)', () => {
    const sessions = [tab('a'), tab('b'), tab('c'), tab('d')]

    expect(orderSessions(sessions, ['d']).map(item => item.id)).toEqual(['d', 'a', 'b', 'c'])
    expect(orderSessions(sessions, ['d', 'b']).map(item => item.id)).toEqual(['d', 'b', 'a', 'c'])
  })

  it('returns the original reference when the order already matches', () => {
    const sessions = [tab('a'), tab('b'), tab('c')]

    expect(orderSessions(sessions, ['a', 'b', 'c'])).toBe(sessions)
    expect(orderSessions(sessions, [])).toBe(sessions)
  })

  it('does not mutate the input list', () => {
    const sessions = [tab('a'), tab('b'), tab('c')]

    orderSessions(sessions, ['c', 'a'])

    expect(sessions.map(item => item.id)).toEqual(['a', 'b', 'c'])
  })
})
