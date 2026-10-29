'use strict'

/** Tracks preparations, not accepted inbox work. Owned by one Session controller. */
class PromptAdmissions {
  #sessions = new Map()
  #cancelled
  constructor(cancelledError) {
    if (typeof cancelledError !== 'function') throw new TypeError('A cancellation error factory is required')
    this.#cancelled = cancelledError
  }
  begin(sessionId, callerSignal) {
    const controller = new AbortController()
    const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal
    const check = () => { if (signal.aborted) throw this.#cancelled() }
    check()
    let pending = this.#sessions.get(sessionId)
    if (!pending) { pending = new Set(); this.#sessions.set(sessionId, pending) }
    pending.add(controller)
    let disposed = false
    return { signal, check, dispose: () => {
      if (disposed) return
      disposed = true
      pending.delete(controller)
      if (pending.size === 0 && this.#sessions.get(sessionId) === pending) this.#sessions.delete(sessionId)
    } }
  }
  cancel(sessionId) {
    for (const controller of this.#sessions.get(sessionId) ?? []) controller.abort(this.#cancelled())
  }
  has(sessionId) { return (this.#sessions.get(sessionId)?.size ?? 0) > 0 }
  get pendingCount() { let count = 0; for (const pending of this.#sessions.values()) count += pending.size; return count }
}
exports.PromptAdmissions = PromptAdmissions
