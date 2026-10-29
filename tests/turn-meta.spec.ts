import { describe, expect, it } from 'vitest'
import { TurnMetaTracker } from '../src/turn-meta.js'
import type { DshEvent } from '../src/conversation.js'

function event(type: string, seq: number, time: number, data: unknown): DshEvent {
  return { type, seq, time, data }
}

function delta(seq: number, text: string, time: number): DshEvent {
  return event('assistant/chunk', seq, time, { turn: 1, step: 1, chunk: { type: 'text-delta', text } })
}

describe('TurnMetaTracker (G5 打点器/差分器)', () => {
  it('完整 turn：firstTokenMs + durationMs 结算', () => {
    const tracker = new TurnMetaTracker()
    tracker.mark(event('user/message', 1, 1000, { id: 'm', source: { kind: 'user' }, content: [] }))
    tracker.mark(delta(2, 'A', 1400))
    tracker.mark(delta(3, 'B', 1500))
    tracker.mark(event('assistant/message', 4, 1900, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'AB' }] } }))

    expect(tracker.metaOf('assistant:1:1')).toEqual({ durationMs: 500, firstTokenMs: 400 })
  })

  it('0.1.10：首 token 基线=步骤开始（step/start）——长轮次里不再把整轮等待算进首 token', () => {
    const tracker = new TurnMetaTracker()
    tracker.mark(event('user/message', 1, 1000, { id: 'm', source: { kind: 'user' }, content: [] }))
    /* 真机形态：用户消息 60s 后才轮到本步（turn 里第 3 步），本步自身起手 3s */
    tracker.mark(event('step/start', 2, 61_000, { turn: 1, step: 3 }))
    tracker.mark(event('assistant/chunk', 3, 64_000, { turn: 1, step: 3, chunk: { type: 'text-delta', text: 'A' } }))
    tracker.mark(event('assistant/message', 4, 66_000, { turn: 1, step: 3, message: { content: [{ type: 'text', text: 'A' }] } }))
    expect(tracker.metaOf('assistant:1:3')).toEqual({ durationMs: 2000, firstTokenMs: 3000 })
  })

  it('无 user/message 的 turn：无 firstTokenMs，durationMs 照常', () => {
    const tracker = new TurnMetaTracker()
    tracker.mark(delta(1, 'A', 500))
    tracker.mark(event('assistant/message', 2, 800, { turn: 1, step: 1, message: { content: [] } }))

    expect(tracker.metaOf('assistant:1:1')).toEqual({ durationMs: 300 })
  })

  it('0.1.5 历史重放：assistant/message 的 data.stream 重建 draft', () => {
    const tracker = new TurnMetaTracker()
    tracker.mark(event('user/message', 1, 1000, { id: 'm', source: { kind: 'user' }, content: [] }))
    /* 历史事件形态：无独立 chunk 事件，chunk 内嵌于 stream（0.1.5 会话日志）。 */
    tracker.mark(event('assistant/message', 2, 1900, {
      turn: 1,
      step: 1,
      message: { content: [{ type: 'text', text: 'AB' }] },
      stream: [
        { type: 'chunk', time: 1500, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
        { type: 'chunk', time: 1600, chunk: { type: 'text-delta', text: 'A' } },
        { type: 'chunk', time: 1700, chunk: { type: 'text-delta', text: 'B' } },
      ],
    }))

    expect(tracker.metaOf('assistant:1:1')).toEqual({ durationMs: 300, firstTokenMs: 600 })
  })

  it('0.1.5 实时路径不受 stream 重放影响（draft 已由合成 chunk 建立，幂等）', () => {
    const tracker = new TurnMetaTracker()
    tracker.mark(event('user/message', 1, 1000, { id: 'm', source: { kind: 'user' }, content: [] }))
    tracker.mark(delta(2, 'A', 1400))
    tracker.mark(event('assistant/message', 3, 1900, {
      turn: 1, step: 1,
      message: { content: [] },
      stream: [{ type: 'chunk', time: 1300, chunk: { type: 'text-delta', text: 'A' } }],
    }))

    expect(tracker.metaOf('assistant:1:1')).toEqual({ durationMs: 500, firstTokenMs: 400 })
  })

  it('未结算（无 assistant/message）：metaOf 返回 undefined', () => {
    const tracker = new TurnMetaTracker()
    tracker.mark(delta(1, 'A', 500))

    expect(tracker.metaOf('assistant:1:1')).toBeUndefined()
  })

  it('durationMs 为 0（同毫秒结算）→ undefined', () => {
    const tracker = new TurnMetaTracker()
    tracker.mark(delta(1, 'A', 500))
    tracker.mark(event('assistant/message', 2, 500, { turn: 1, step: 1, message: { content: [] } }))

    expect(tracker.metaOf('assistant:1:1')).toBeUndefined()
  })

  it('恢复路径整体重放：与实时同样重建 meta（0.0.39 修复回归）', () => {
    const tracker = new TurnMetaTracker()
    const history = [
      event('user/message', 1, 1000, { id: 'm', source: { kind: 'user' }, content: [] }),
      delta(2, 'A', 1400),
      delta(3, 'B', 1500),
      event('assistant/message', 4, 1900, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'AB' }] } }),
    ]
    tracker.clear()
    for (const entry of history) tracker.mark(entry)

    expect(tracker.metaOf('assistant:1:1')).toEqual({ durationMs: 500, firstTokenMs: 400 })
  })

  it('sessionStats 差分：流式中直接挂 tokS', () => {
    const tracker = new TurnMetaTracker()
    tracker.mark(event('user/message', 1, 1000, { id: 'm', source: { kind: 'user' }, content: [] }))
    tracker.mark(delta(2, 'A', 1400))
    tracker.ingestStats({ decodeTokens: 200, decodeMs: 8000 })
    tracker.ingestStats({ decodeTokens: 1700, decodeMs: 20000 })
    tracker.mark(event('assistant/message', 3, 2500, { turn: 1, step: 1, message: { content: [] } }))

    // Δtokens = 1500, Δms = 12000 → 1500 / 12 = 125 tok/s
    expect(tracker.metaOf('assistant:1:1')?.tokS).toBe(125)
    expect(tracker.metaOf('assistant:1:1')?.durationMs).toBe(1100)
  })

  it('sessionStats 投影壳 {ver,seq,val} 形态（真实会话实证）：tokS 正常', () => {
    const tracker = new TurnMetaTracker()
    tracker.mark(delta(1, 'A', 500))
    tracker.ingestStats({ ver: 1, seq: 10, val: { decodeTokens: 0, decodeMs: 0 } })
    tracker.ingestStats({ ver: 1, seq: 11, val: { decodeTokens: 1500, decodeMs: 12000 } })
    tracker.mark(event('assistant/message', 2, 900, { turn: 1, step: 1, message: { content: [] } }))

    expect(tracker.metaOf('assistant:1:1')?.tokS).toBe(125)
  })

  it('差分在结算前到达 → pending 挂到结算帧', () => {
    const tracker = new TurnMetaTracker()
    tracker.mark(delta(1, 'A', 500))
    tracker.ingestStats({ decodeTokens: 0, decodeMs: 0 })
    tracker.ingestStats({ decodeTokens: 120, decodeMs: 4000 })
    tracker.mark(event('assistant/message', 2, 900, { turn: 1, step: 1, message: { content: [] } }))

    // Δtokens = 120, Δms = 4000 → 30 tok/s
    expect(tracker.metaOf('assistant:1:1')?.tokS).toBe(30)
  })

  it('stats 帧晚于结算到达 → 回填刚结算的 turn（lastSettledId）', () => {
    const tracker = new TurnMetaTracker()
    tracker.mark(delta(1, 'A', 500))
    tracker.mark(event('assistant/message', 2, 900, { turn: 1, step: 1, message: { content: [] } }))
    // 结算后 sessionStats 帧才到（实测帧序存在此形态）
    tracker.ingestStats({ decodeTokens: 0, decodeMs: 0 })
    tracker.ingestStats({ decodeTokens: 1500, decodeMs: 12000 })

    expect(tracker.metaOf('assistant:1:1')?.tokS).toBe(125)
  })

  it('stats 阈值：无增量（≤0）忽略，不产生 tokS', () => {
    const tracker = new TurnMetaTracker()
    tracker.mark(delta(1, 'A', 500))
    tracker.ingestStats({ decodeTokens: 0, decodeMs: 0 })
    tracker.ingestStats({ decodeTokens: 0, decodeMs: 100 })
    tracker.mark(event('assistant/message', 2, 900, { turn: 1, step: 1, message: { content: [] } }))

    expect(tracker.metaOf('assistant:1:1')?.tokS).toBeUndefined()
  })

  it('clear 后重置：重放不残留旧 turn', () => {
    const tracker = new TurnMetaTracker()
    tracker.mark(event('user/message', 1, 1000, { id: 'm', source: { kind: 'user' }, content: [] }))
    tracker.mark(delta(2, 'A', 1400))
    tracker.clear()
    tracker.mark(delta(3, 'X', 2000))
    tracker.mark(event('assistant/message', 4, 2100, { turn: 1, step: 1, message: { content: [] } }))

    // clear 后无 userTime → firstTokenMs undefined；startTime 从 chunk 帧起 → durationMs=100
    expect(tracker.metaOf('assistant:1:1')).toEqual({ durationMs: 100 })
  })
})
/* 2026-10-06（S3）：metaOf 弱键记忆契约——draft 为替换式写（身份即版本）：
   未变 → 同一 meta 对象（上层视图缓存以此为键）；结算/统计更新 → 换新对象且值正确。 */
describe('metaOf 记忆化（S3）', () => {
  it('draft 未变 → 返回同一 meta 对象（身份稳定）', () => {
    const tracker = new TurnMetaTracker()
    tracker.mark(delta(1, 'A', 500))
    tracker.mark(event('assistant/message', 2, 900, { turn: 1, step: 1, message: { content: [] } }))
    const first = tracker.metaOf('assistant:1:1')
    const second = tracker.metaOf('assistant:1:1')
    expect(first).toEqual({ durationMs: 400 })
    expect(second).toBe(first)
  })

  it('结算/统计更新（替换式写）→ 新对象且数值随之更新', () => {
    const tracker = new TurnMetaTracker()
    tracker.mark(delta(1, 'A', 500))
    const beforeSettle = tracker.metaOf('assistant:1:1')
    expect(beforeSettle).toBeUndefined()   // 未结算、无 tokS ⇒ 无 meta（记忆 null 分支）
    tracker.mark(event('assistant/message', 2, 900, { turn: 1, step: 1, message: { content: [] } }))
    const settled = tracker.metaOf('assistant:1:1')
    expect(settled?.durationMs).toBe(400)
    tracker.ingestStats({ decodeTokens: 0, decodeMs: 0 })
    tracker.ingestStats({ decodeTokens: 1500, decodeMs: 12000 })
    const withTokS = tracker.metaOf('assistant:1:1')
    expect(withTokS).not.toBe(settled)
    expect(withTokS?.tokS).toBe(125)
  })
})
