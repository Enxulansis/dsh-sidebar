import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const { PromptAdmissions } = createRequire(import.meta.url)('../runtime/admission-cancellation.cjs')
const cancelled = () => Object.assign(new Error('cancelled'), { code: 'gateway/cancelled' })
describe('prompt preparation ownership', () => {
  it('cancels all old preparations in one session while other sessions and new sends survive', () => {
    const admissions = new PromptAdmissions(cancelled)
    const a = admissions.begin('a'), queued = admissions.begin('a'), b = admissions.begin('b')
    admissions.cancel('a')
    expect(() => a.check()).toThrow('cancelled'); expect(() => queued.check()).toThrow('cancelled')
    expect(() => b.check()).not.toThrow()
    const next = admissions.begin('a'); expect(() => next.check()).not.toThrow()
    for (const entry of [a, queued, b, next]) entry.dispose()
    expect(admissions.pendingCount).toBe(0)
  })
  it('a disconnected caller owns only its request and releases its registration', () => {
    const admissions = new PromptAdmissions(cancelled), caller = new AbortController()
    const first = admissions.begin('a', caller.signal), sibling = admissions.begin('a')
    caller.abort()
    expect(() => first.check()).toThrow('cancelled'); expect(() => sibling.check()).not.toThrow()
    first.dispose(); first.dispose(); expect(admissions.pendingCount).toBe(1)
    sibling.dispose(); expect(admissions.has('a')).toBe(false)
  })
  it('never registers a previously disconnected caller and releases repeated cancellation lifetimes', () => {
    const admissions = new PromptAdmissions(cancelled), caller = new AbortController(); caller.abort()
    expect(() => admissions.begin('a', caller.signal)).toThrow('cancelled')
    for (let i = 0; i < 1000; i++) { const entry = admissions.begin('a'); admissions.cancel('a'); entry.dispose() }
    expect(admissions.pendingCount).toBe(0)
  })
})
