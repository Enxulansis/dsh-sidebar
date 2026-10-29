import { describe, expect, it } from 'vitest'
import { buildRailNodeTables, buildSegmentTable, buildTurnTable, deriveOutlinePieces } from '../src/rail-nodes.js'
import type { ConversationMessage } from '../src/conversation.js'

const msg = (id: string, role: string, seq: number | undefined, extra: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id,
  role,
  text: extra.text ?? id,
  ...(seq === undefined ? {} : { seq }),
  ...extra,
} as ConversationMessage)

describe('rail-nodes（G55 Phase 3：跨会话节点表复算）', () => {
  it('基础五段：user 起段 / 停点后首元素起段；key=s<seq>、mid=锚点消息 id', () => {
    const messages = [
      msg('u1', 'user', 10), msg('a1', 'assistant', 11), msg('a1b', 'assistant', 12),
      msg('u2', 'user', 20), msg('a2', 'assistant', 21),
      msg('u3', 'user', 30), msg('a3', 'assistant', 31),
      msg('u4', 'user', 40), msg('a4', 'assistant', 41),
    ]
    const segment = buildSegmentTable({ messages, stops: [11], outline: [] })
    expect(segment.map(entry => [entry.seq, entry.mid, entry.key])).toEqual([
      [10, 'u1', 's10'],
      [12, 'a1b', 's12'],
      [20, 'u2', 's20'],
      [30, 'u3', 's30'],
      [40, 'u4', 's40'],
    ])
  })

  it('停点段向前回溯卡片（提问留痕卡 / 审批决定卡）：锚点=卡片、seq/mid 取卡片', () => {
    const messages = [
      msg('u1', 'user', 10), msg('a1', 'assistant', 11),
      msg('ask', 'tool', 12, { text: 'ask_user_question' }),
      msg('a2', 'assistant', 13),
      msg('u2', 'user', 20),
    ]
    const segment = buildSegmentTable({ messages, stops: [12], outline: [] })
    expect(segment.map(entry => [entry.seq, entry.mid])).toEqual([[10, 'u1'], [12, 'ask'], [20, 'u2']])

    const decision = [
      msg('u1', 'user', 10), msg('t1', 'tool', 11),
      msg('dec', 'decision', 12, { text: 'run_command' }),
      msg('a2', 'assistant', 13),
    ]
    const segment2 = buildSegmentTable({ messages: decision, stops: [12], outline: [] })
    expect(segment2.map(entry => [entry.seq, entry.mid])).toEqual([[10, 'u1'], [12, 'dec']])
  })

  it('回溯 ≤12 跳：卡片在 12 跳之外则不取（回落段首）', () => {
    const messages = [msg('u1', 'user', 10), msg('ask', 'tool', 11, { text: 'ask_user_question' })]
    for (let i = 0; i < 13; i += 1) messages.push(msg('n' + String(i), 'assistant', 12 + i))
    messages.push(msg('end', 'assistant', 30))
    const segment = buildSegmentTable({ messages, stops: [29], outline: [] })
    /* 停点段从 end 起（首个 seq ≥30 的元素）；卡片在 14 跳外 ⇒ 锚点=end。 */
    expect(segment[1]).toEqual({ seq: 30, mid: 'end', key: 's30' })
  })

  it('前缀（轮粒度）：prompt 空跳过；窗口内有用户消息在 [seq,endSeq) 则去重跳过', () => {
    const messages = [msg('u5', 'user', 50), msg('a5', 'assistant', 51)]
    const outline = [
      { seq: 10, prompt: 'A' }, { seq: 20, prompt: '  ' }, { seq: 30, prompt: 'B' }, { seq: 40, prompt: 'C' }, { seq: 50, prompt: 'D' },
    ]
    const segment = buildSegmentTable({ messages, stops: [], outline })
    expect(segment.map(entry => [entry.seq, entry.mid])).toEqual([[10, null], [30, null], [40, null], [50, 'u5']])

    /* 去重：窗口首 seq=35（> 大纲 30）⇒ 30 成为前缀候选；窗口内用户 35 ∈ [30,40) ⇒ 跳过。 */
    const dedupMessages = [msg('u35', 'user', 35), msg('a35', 'assistant', 36)]
    const dedup = buildSegmentTable({ messages: dedupMessages, stops: [], outline: [{ seq: 30, prompt: 'X' }, { seq: 40, prompt: 'Y' }] })
    expect(dedup.map(entry => entry.seq)).toEqual([35])
  })

  it('轮表：窗口内轮 mid= [turnSeq, nextTurnSeq) 首条带 seq 消息；窗口外轮 mid=null', () => {
    const messages = [msg('u50', 'user', 50), msg('a50', 'assistant', 51), msg('u60', 'user', 60)]
    const turn = buildTurnTable({ messages, stops: [], outline: [{ seq: 10, prompt: 'A' }, { seq: 50, prompt: 'B' }, { seq: 60, prompt: '' }] })
    expect(turn).toEqual([
      { seq: 10, mid: null, key: 's10' },
      { seq: 50, mid: 'u50', key: 's50' },
      { seq: 60, mid: 'u60', key: 's60' },
    ])
  })

  it('无 seq 消息：不推进停点游标但归属所在段；锚点无 seq 的段不产出', () => {
    const messages = [msg('u1', 'user', 10), msg('a-noseq', 'assistant', undefined), msg('u2', 'user', 20)]
    const segment = buildSegmentTable({ messages, stops: [], outline: [] })
    expect(segment.map(entry => [entry.seq, entry.mid])).toEqual([[10, 'u1'], [20, 'u2']])

    const noAnchor = [msg('a-only', 'assistant', undefined)]
    expect(buildSegmentTable({ messages: noAnchor, stops: [], outline: [] })).toEqual([])
  })

  it('大纲派生：轮起点=turn/start；prompt=首条非合成 user 消息（时间采样/系统提醒视为合成→空）', () => {
    const messages = [
      msg('u1', 'user', 7, { text: '第一次的真人提问' }),
      msg('u2', 'user', 9, { text: 'Time sampled while preparing turn 1, step 1: …' }),
      msg('u3', 'user', 20, { text: '<system-reminder>\nworkspace instructions…' }),
      msg('u4', 'user', 30, { text: '  ' }),
      msg('u5', 'user', 41, { text: '第二次的真人提问' }),
    ]
    const pieces = deriveOutlinePieces([6, 15, 40], messages)
    expect(pieces).toEqual([
      { seq: 6, prompt: '第一次的真人提问' },
      { seq: 15, prompt: '' },   /* 该轮只有系统提醒/空白 ⇒ 注入轮，prompt 空 */
      { seq: 40, prompt: '第二次的真人提问' },
    ])
  })

  it('0.1.125：前缀条目带 endSeq（区间右界=下一轮起点）——端侧凭它判"整轮是否已加载"', () => {
    const messages = [msg('u5', 'user', 50), msg('a5', 'assistant', 51)]
    const outline = [{ seq: 10, prompt: 'A' }, { seq: 30, prompt: 'B' }, { seq: 50, prompt: 'D' }]
    const segment = buildSegmentTable({ messages, stops: [], outline })
    expect(segment[0]).toEqual({ seq: 10, mid: null, key: 's10', endSeq: 30 })
    expect(segment[1]).toEqual({ seq: 30, mid: null, key: 's30', endSeq: 50 })
  })

  it('buildRailNodeTables 契约：{segment, turn} 双表、key 前缀 s、字段齐全', () => {
    const tables = buildRailNodeTables({
      messages: [msg('u1', 'user', 10), msg('a1', 'assistant', 12)],
      stops: [],
      outline: [{ seq: 10, prompt: 'A' }],
    })
    expect(Object.keys(tables).sort()).toEqual(['segment', 'turn'])
    for (const list of [tables.segment, tables.turn]) {
      for (const entry of list) {
        expect(typeof entry.seq).toBe('number')
        expect(entry.mid === null || typeof entry.mid === 'string').toBe(true)
        expect(entry.key).toBe('s' + String(entry.seq))
      }
    }
  })

  it('重复轮起点保留空区间，同seq消息保持首条身份，右界消息属于下一轮', () => {
    const messages = [msg('first', 'assistant', 10), msg('second', 'user', 10), msg('next', 'user', 20)]
    const turn = buildTurnTable({ messages, stops: [], outline: [{ seq: 20, prompt: 'C' }, { seq: 10, prompt: 'A' }, { seq: 10, prompt: 'B' }] })
    expect(turn).toEqual([
      { seq: 10, mid: null, key: 's10' },
      { seq: 10, mid: 'first', key: 's10' },
      { seq: 20, mid: 'next', key: 's20' },
    ])
  })

  it('窗口边界取原消息的首个有限seq，排序后更早消息不误变成已加载轮', () => {
    const messages = [msg('unknown', 'assistant', undefined), msg('first', 'assistant', 30), msg('earlier', 'user', 10)]
    expect(buildTurnTable({ messages, stops: [], outline: [{ seq: 10, prompt: 'A' }, { seq: 30, prompt: 'B' }] }).map(n => n.mid)).toEqual([null, 'first'])
  })

  it('派生大纲跨空轮、重复起点及合成提示后仍取区间内首个真人文本', () => {
    const messages = [
      msg('late', 'user', 21, { text: '下一轮' }),
      msg('synthetic', 'user', 11, { text: 'Time sampled while preparing turn 1' }),
      msg('blank', 'user', 12, { text: '  ' }),
      msg('system', 'user', 13, { text: '<system-reminder>context' }),
      msg('real', 'user', 14, { text: '  真人问题  ' }),
      msg('same', 'user', 14, { text: '后来的同seq问题' }),
      msg('noseq', 'user', undefined, { text: '不能用' }),
    ]
    expect(deriveOutlinePieces([40, 10, 10, 20, 30], messages)).toEqual([
      { seq: 10, prompt: '' }, { seq: 10, prompt: '真人问题' }, { seq: 20, prompt: '下一轮' }, { seq: 30, prompt: '' }, { seq: 40, prompt: '' },
    ])
  })

  it('前缀区间按用户seq查找，不依赖消息顺序，也不吞重复空区间', () => {
    const messages = [msg('first', 'assistant', 50), msg('u45', 'user', 45), msg('u35', 'user', 35)]
    const outline = [{ seq: 30, prompt: 'C' }, { seq: 10, prompt: 'A' }, { seq: 20, prompt: 'B' }, { seq: 30, prompt: 'repeat' }, { seq: 40, prompt: 'D' }, { seq: 50, prompt: 'E' }]
    const segment = buildSegmentTable({ messages, stops: [], outline })
    expect(segment.slice(0, 3)).toEqual([
      { seq: 10, mid: null, key: 's10', endSeq: 20 },
      { seq: 20, mid: null, key: 's20', endSeq: 30 },
      { seq: 30, mid: null, key: 's30', endSeq: 30 },
    ])
    expect(segment.map(n => n.seq)).toEqual([10, 20, 30, 50, 45, 35])
  })
})
