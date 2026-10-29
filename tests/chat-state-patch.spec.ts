import { describe, expect, it } from 'vitest'
import { diffConversationMessages, messageForWebview, messagesPatchForWebview } from '../src/chat-state-patch.js'
import { ConversationProjector, type ConversationMessage, type DshEvent } from '../src/conversation.js'

function message(id: string, text: string, extra: Partial<ConversationMessage> = {}): ConversationMessage {
  return { id, role: 'assistant', text, ...extra }
}

describe('0.0.140 瘦身保留小字段', () => {
  it('提问消息整条保留（留痕卡渲染依赖 rawInput/rawResult）', () => {
    const ask: ConversationMessage = {
      id: 'tool:ask', role: 'tool', text: 'ask_user_question',
      rawInput: '{"questions":[]}', rawResult: '{"answers":[{"id":"a","selected":["x"]}]}',
      callView: { card: 'ask', title: '提问' }, seq: 30, time: 1234,
    }
    const out = messageForWebview(ask)
    expect(out).toEqual(ask)
    expect(out.deferredBody).toBeUndefined()
    expect(out.rawInput).toBe(ask.rawInput)
    expect(out.rawResult).toBe(ask.rawResult)
  })

  it('大载荷工具卡照旧瘦身，但 seq/time 不再丢', () => {
    const big: ConversationMessage = {
      id: 'tool:bash', role: 'tool', text: 'bash',
      rawInput: 'x'.repeat(6000), rawResult: 'y'.repeat(60_000), seq: 41, time: 5678,
    }
    const out = messageForWebview(big)
    expect(out.deferredBody).toBe(true)
    expect(out.rawInput).toBeUndefined()
    expect(out.rawResult).toBeUndefined()
    expect(out.seq).toBe(41)
    expect(out.time).toBe(5678)
    expect(out.bodyLength).toBe(60_000)
  })
})

describe('diffConversationMessages', () => {
  it('publishes late statistics and timestamp updates after text has settled', () => {
    const previous = [message('assistant:1', 'Done', { time: 100, meta: { durationMs: 500 } })]
    const next = [message('assistant:1', 'Done', { time: 120, meta: { durationMs: 500, tokS: 80 } })]
    expect(diffConversationMessages(previous, next)).toEqual({ upserts: next })
  })

  it('replaces the provisional sequence with the authoritative sequence on settlement', () => {
    const previous = [message('assistant:1', 'Done', { seq: -7, streaming: true })]
    const next = [message('assistant:1', 'Done', { seq: 71 })]
    expect(diffConversationMessages(previous, next)).toEqual({ upserts: next })
  })

  it('does not retain removed metadata through an append', () => {
    const previous = [message('assistant:1', 'Done', { streaming: true, meta: { tokS: 80 }, time: 100 })]
    const next = [message('assistant:1', 'Done')]
    expect(diffConversationMessages(previous, next)).toEqual({ upserts: next })
  })

  it('keeps equivalent metadata projections unchanged', () => {
    const previous = [message('assistant:1', 'Done', { meta: { durationMs: 500, tokS: 80 } })]
    const next = [message('assistant:1', 'Done', { meta: { durationMs: 500, tokS: 80 } })]
    expect(diffConversationMessages(previous, next)).toBeUndefined()
  })

  it('uses projector deltas across batched chunks', () => {
    const projector = new ConversationProjector()
    const chunk = (seq: number, text: string): DshEvent => ({
      type: 'assistant/chunk', seq, time: seq,
      data: { turn: 1, step: 1, chunk: { type: 'text-delta', text } },
    })
    projector.apply(chunk(1, 'A'.repeat(50_000)))
    const previous = projector.messages()
    projector.apply(chunk(2, 'second'))
    projector.apply(chunk(3, ' third'))

    expect(diffConversationMessages(previous, projector.messages())).toEqual({
      appends: [{ id: 'assistant:1:1', text: 'second third', streaming: true, time: 1 }],
    })
  })

  it('sends only the streaming message that changed', () => {
    const previous = [message('tool:1', 'Tool', { role: 'tool', rawResult: 'large output' }), message('assistant:1', 'Hel', { streaming: true })]
    const next = [message('tool:1', 'Tool', { role: 'tool', rawResult: 'large output' }), message('assistant:1', 'Hello', { streaming: true })]

    expect(diffConversationMessages(previous, next)).toEqual({
      appends: [{ id: 'assistant:1', text: 'lo', streaming: true }],
    })
  })

  it('appends new messages without resetting existing output', () => {
    const previous = [message('assistant:1', 'Done')]
    const next = [...previous, message('assistant:2', 'Next', { streaming: true })]

    expect(diffConversationMessages(previous, next)).toEqual({ upserts: [next[1]] })
  })

  it('finishes a streaming message without resending its full text', () => {
    const previous = [message('assistant:1', 'Complete response', { streaming: true })]
    const next = [message('assistant:1', 'Complete response')]

    expect(diffConversationMessages(previous, next)).toEqual({
      appends: [{ id: 'assistant:1', text: '', streaming: false }],
    })
  })

  /* G5 fix 回归: 结算帧 meta/time 首次出现——append 必须顺带，否则 webview 增量链路丢时钟药丸 */
  it('carries settle meta and time on the finishing append', () => {
    const previous = [message('assistant:1', 'Complete response', { streaming: true })]
    const next = [message('assistant:1', 'Complete response', {
      time: 1725000001000,
      meta: { durationMs: 1391, firstTokenMs: 559 },
    })]

    expect(diffConversationMessages(previous, next)).toEqual({
      appends: [{
        id: 'assistant:1',
        text: '',
        streaming: false,
        meta: { durationMs: 1391, firstTokenMs: 559 },
        time: 1725000001000,
      }],
    })
  })

  it('keeps plain streaming appends meta-free', () => {
    const previous = [message('assistant:1', 'Hel', { streaming: true })]
    const next = [message('assistant:1', 'Hello', { streaming: true, time: 1725000000000 })]

    expect(diffConversationMessages(previous, next)).toEqual({
      appends: [{ id: 'assistant:1', text: 'lo', streaming: true, time: 1725000000000 }],
    })
  })

  it('falls back to an upsert when streamed text is rewritten', () => {
    const previous = [message('assistant:1', 'Original', { streaming: true })]
    const next = [message('assistant:1', 'Replacement', { streaming: true })]

    expect(diffConversationMessages(previous, next)).toEqual({ upserts: next })
  })

  it('treats equivalent image projections as unchanged', () => {
    const images = [{ attachmentId: 'image-1', mediaType: 'image/png' as const, width: 20, height: 10, data: 'abc' }]
    const previous = [message('assistant:1', '', { images })]
    const next = [message('assistant:1', '', { images: images.map(image => ({ ...image })) })]

    expect(diffConversationMessages(previous, next)).toBeUndefined()
  })

  it('prepends history without resending existing messages', () => {
    const previous = [message('assistant:2', 'Current')]
    const next = [message('assistant:1', 'Earlier'), ...previous]

    expect(diffConversationMessages(previous, next)).toEqual({ prepends: [next[0]] })
  })

  it('keeps hydrated images out of a history prepend while publishing changed messages', () => {
    const image = message('user:1', 'Photo', { role: 'user', images: [{ attachmentId: 'photo', mediaType: 'image/png', width: 20, height: 10, data: 'x'.repeat(100_000) }] })
    const previous = [image, message('assistant:1', 'Hel', { streaming: true })]
    const next = [message('older', 'Old'), { ...image, images: image.images!.map(i => ({ ...i })) }, message('assistant:1', 'Hello', { streaming: true })]
    expect(diffConversationMessages(previous, next)).toEqual({ prepends: [next[0]], appends: [{ id: 'assistant:1', text: 'lo', streaming: true }] })
    expect(JSON.stringify(messagesPatchForWebview(diffConversationMessages(previous, next)!))).not.toContain('photo')
    const changed = { ...image, images: image.images!.map(i => ({ ...i, error: 'unavailable' })) }
    expect(diffConversationMessages(previous, [next[0]!, changed, previous[1]!])).toEqual({ prepends: [next[0]], upserts: [changed] })
  })

  it('defers large prepended bodies', () => {
    const older = message('older', 'x'.repeat(100_000))
    const patch = messagesPatchForWebview({ prepends: [older] })
    expect(patch.prepends?.[0]).toMatchObject({ id: 'older', text: '', deferredBody: true })
  })

  it('resets for removals, reordered tails, interior insertions, or duplicate prefix IDs', () => {
    const previous = [message('a', 'A'), message('b', 'B')]
    for (const next of [[previous[1]!], [message('old', 'Old'), previous[1]!, previous[0]!], [previous[0]!, message('middle', 'M'), previous[1]!], [previous[1]!, ...previous], [message('old', 'Old'), message('old', 'Old'), ...previous]]) {
      expect(diffConversationMessages(previous, next)).toEqual({ reset: next })
    }
  })

  it('defers completed tool bodies while preserving their summary', () => {
    const tool = message('tool:large', 'mcp_router_status', {
      role: 'tool',
      detail: '已完成',
      rawInput: '{"verbose":true}',
      rawResult: 'x'.repeat(100_000),
      callView: { card: 'generic', title: 'Router status', rawInput: 'large input' },
      resultView: { card: 'generic', title: 'Router status', content: 'large output' },
    })

    expect(messageForWebview(tool)).toEqual({
      id: 'tool:large',
      role: 'tool',
      text: 'mcp_router_status',
      detail: '已完成',
      callView: { card: 'generic', title: 'Router status' },
      resultView: { card: 'generic', title: 'Router status' },
      deferredBody: true,
      deferredBodyRevision: 'settled:17:16:100000:',
      bodyLength: 100_000,
    })
  })

  it('defers tool bodies inside resets and upserts', () => {
    const tool = message('tool:large', 'Tool', { role: 'tool', rawResult: 'large output' })
    const patch = messagesPatchForWebview({ reset: [tool], upserts: [tool] })

    expect(patch.reset?.[0]?.deferredBody).toBe(true)
    expect(patch.upserts?.[0]?.deferredBody).toBe(true)
  })

  it('defers streaming tools, large commands, and completed long responses', () => {
    expect(messageForWebview(message('tool:running', 'Write', {
      role: 'tool', streaming: true, rawInput: 'x'.repeat(50_000), callView: { card: 'diff', title: 'Write' },
    })).deferredBody).toBe(true)

    expect(messageForWebview(message('command:1', '/compact', {
      role: 'command', rawResult: 'x'.repeat(50_000),
    })).deferredBody).toBe(true)

    const assistant = messageForWebview(message('assistant:large', 'x'.repeat(50_000)))
    expect(assistant).toMatchObject({ role: 'assistant', text: '', deferredBody: true, bodyLength: 50_000 })
  })

  it('keeps the streaming flag on a deferred running tool', () => {
    const tool = messageForWebview(message('tool:running', 'Write', {
      role: 'tool', streaming: true, detail: '运行中…', callView: { card: 'diff', title: 'Write' },
    }))
    expect(tool.deferredBody).toBe(true)
    expect(tool.streaming).toBe(true)
  })

  it('keeps a short assistant answer with hydrated images inline', () => {
    const answer = message('assistant:1', 'Here it is.', {
      images: [{ attachmentId: 'image', mediaType: 'image/png', width: 10, height: 10, data: 'abc' }],
    })
    expect(messageForWebview(answer)).toBe(answer)
  })

  it('changes the deferred revision when an image finishes hydrating', () => {
    const base = message('tool:image', 'Image', {
      role: 'tool', images: [{ attachmentId: 'image', mediaType: 'image/png', width: 10, height: 10 }],
    })
    const hydrated = messageForWebview({ ...base, images: base.images?.map(image => ({ ...image, data: 'abc' })) })
    expect(hydrated.deferredBodyRevision).not.toBe(messageForWebview(base).deferredBodyRevision)
  })
})
