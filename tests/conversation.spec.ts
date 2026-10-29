import { describe, expect, it } from 'vitest'
import { ConversationProjector, fullTextOfEvent, imagesOfEvent, type DshEvent } from '../src/conversation.js'
import { withIdeContext } from '../src/ide-context.js'
import { mergeHistoryEntries } from '../src/history.js'

function event(type: string, seq: number, data: unknown, time?: number): DshEvent {
  /* 0.1.82：合成 chunk 的 seq 为负、time 仍是真实时间（真机如此）——time 可显式给。 */
  return { type, seq, time: time === undefined ? seq : time, data }
}

describe('ConversationProjector', () => {
  it('keeps human prompts and final assistant text while excluding injected plugin context', () => {
    const projector = new ConversationProjector()
    projector.reset([
      event('user/message', 1, { id: 'plugin', source: { kind: 'plugin' }, content: [{ type: 'text', text: 'hidden context' }] }),
      event('user/message', 2, { id: 'human', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }),
      /* 0.1.82：合成 chunk 的 seq 在真机是**负值**（dsh-client 的 -(++chunkSeq)），真实 seq 可覆盖它 */
      event('assistant/chunk', -3, { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'Hi' } }, 3),
      event('assistant/message', 4, { turn: 1, step: 1, message: { content: [{ type: 'reasoning', text: 'private' }, { type: 'text', text: 'Hi there' }] } }),
    ])

    expect(projector.messages()).toEqual([
      { id: 'human', role: 'user', seq: 2, text: 'hello', time: 2 },
      /* 0.1.89：重放跳过"同 turn/step 已有权威消息"的合成块 ⇒ 时间也以权威帧为准（4）；
         时钟药丸只显示到分钟，真实差值为流内毫秒~秒级、不可见。 */
      { id: 'assistant:1:1', role: 'assistant', seq: 4, text: 'Hi there', time: 4 },
    ])
  })

  it('updates one streaming assistant row instead of duplicating chunks', () => {
    const projector = new ConversationProjector()
    /* 0.1.82：seq **首见为准**——流式期的合成 seq（真机为负）不再被后续 chunk 反复改写；
       真实 seq 只在结算帧到来时从"临时负值"升级一次。 */
    projector.apply(event('assistant/chunk', -1, { turn: 2, step: 1, chunk: { type: 'text-delta', text: 'A' } }, 1))
    projector.apply(event('assistant/chunk', -2, { turn: 2, step: 1, chunk: { type: 'text-delta', text: 'B' } }, 2))

    expect(projector.messages()).toEqual([
      { id: 'assistant:2:1', role: 'assistant', seq: -1, text: 'AB', streaming: true, time: 1 },
    ])
  })

  /* 0.1.79（用户报②"终止状态不统一"）：turn/end = 终止态不变量——结算帧丢失 / 幻影 id / 工具结果丢失
     之类的一切残留路径在此统一收口（真机症状：最后一条助手回复的"白块（光标）+ 蓝鲸头像"永不停止，
     且切走再切回仍在 ⇒ 残留就在投影状态里）。 */
  it('settles leftover streaming assistant rows on turn/end (0.1.79 终止态不变量)', () => {
    const projector = new ConversationProjector()
    projector.apply(event('assistant/chunk', 1, { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'AB' } }))
    expect(projector.messages().some(message => message.streaming === true)).toBe(true)

    projector.apply(event('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }))
    const messages = projector.messages()
    expect(messages.some(message => message.streaming === true)).toBe(false)
    expect(messages).toEqual([{ id: 'assistant:1:1', role: 'assistant', seq: 1, text: 'AB', time: 1 }])
  })

  it('settles phantom-id rows the real assistant/message can not reach (0.1.79)', () => {
    const projector = new ConversationProjector()
    /* 旧客户端兜底曾把未登记 attempt 的 chunk 合成 assistant:0:0 —— 真实结算帧（1:1）结算不到它。 */
    projector.apply(event('assistant/chunk', -1, { turn: 0, step: 0, chunk: { type: 'text-delta', text: 'x' } }))
    projector.apply(event('assistant/message', 2, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'real' }] } }))
    expect(projector.messages().some(message => message.streaming === true)).toBe(true)

    projector.apply(event('turn/end', 3, { turn: 1, reason: { kind: 'completed' } }))
    expect(projector.messages().some(message => message.streaming === true)).toBe(false)
  })

  /* 0.1.89（用户报②"回复完了还一直呼吸"）：**重放不重放合成流式块**——实时链路把 assistant-stream
     帧合成 assistant/chunk（负 seq），窗口缓存合并后按"非正 seq 视为 +∞"排到**最后** ⇒ 重放会在
     turn/end 之后再次应用，把已结算的消息**重新点亮为 streaming**（真机症状 + 探针实测：文本还会被
     delta 二次追加）。同 turn/step 已有权威 assistant/message 时应跳过这些块。 */
  it('0.1.89: reset 跳过"已结算 turn/step"的合成流式块（重放不再回流式态 / 不再二次追加文本）', () => {
    const projector = new ConversationProjector()
    projector.reset([
      event('turn/start', 1, { turn: 1 }),
      event('step/start', 2, { turn: 1, step: 1 }),
      event('user/message', 3, { source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }),
      event('assistant/message', 4, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'AB' }] } }),
      event('step/end', 5, { turn: 1, step: 1 }),
      event('turn/end', 6, { turn: 1, reason: { kind: 'completed' } }),
      /* 真机重放序：合成块（负 seq）排尾（history.ts 的 +∞ 不变量） */
      event('assistant/chunk', -1, { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'A' } }, 3),
      event('assistant/chunk', -2, { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'B' } }, 3),
    ])
    const assistant = projector.messages().find(message => message.id === 'assistant:1:1')
    expect(assistant?.streaming).toBeUndefined()
    expect(assistant?.text).toBe('AB')
  })

  it('0.1.89: 中断流（无权威消息）时保留半截文本；settleStreaming 可收口残留', () => {
    const projector = new ConversationProjector()
    projector.reset([
      event('turn/start', 1, { turn: 1 }),
      event('step/start', 2, { turn: 1, step: 1 }),
      event('assistant/chunk', -1, { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'half' } }, 3),
    ])
    const streaming = projector.messages().find(message => message.id === 'assistant:1:1')
    expect(streaming?.text).toBe('half')
    expect(streaming?.streaming).toBe(true)
    /* 0.1.89（终止态不变量）：扩缩侧在 running=false 时调用它统一收口。 */
    projector.settleStreaming()
    expect(projector.messages().find(message => message.id === 'assistant:1:1')?.streaming).toBeUndefined()
  })

  it('keeps tool rows out of the turn/end settle (their own result events close them)', () => {
    const projector = new ConversationProjector()
    projector.apply(event('tool/call', 1, { callId: 'c1', name: 'write', arguments: '{}' }))
    projector.apply(event('turn/end', 2, { turn: 1, reason: { kind: 'aborted' } }))
    expect(projector.messages().some(message => message.role === 'tool' && message.streaming === true)).toBe(true)
  })

  it('hides extension-owned IDE context from the durable user bubble', () => {
    const projector = new ConversationProjector()
    const text = withIdeContext('Explain this', {
      activeFile: { kind: 'file', path: 'src/example.ts' },
      pinned: [],
      mentions: [],
    })
    projector.apply(event('user/message', 1, {
      id: 'contextual',
      source: { kind: 'user' },
      content: [{ type: 'text', text }],
    }))

    expect(projector.messages()).toEqual([{ id: 'contextual', role: 'user', seq: 1, text: 'Explain this', time: 1 }])
  })

  it('correlates official tool results through message.source.callId', () => {
    const projector = new ConversationProjector()
    projector.apply(event('tool/call', 1, { callId: 'call-1', name: 'bash' }))
    projector.apply(event('tool/result', 2, {
      message: {
        source: { kind: 'tool', callId: 'call-1' },
        content: [{ type: 'tool-result', toolCallId: 'call-1', isError: false }],
      },
    }))

    expect(projector.messages()).toEqual([
      /* 0.1.82：seq 首见为准——工具卡保持 tool/call 的 seq（旧实现被 tool/result 改写成 2，
         使排在它前面的审批决定卡与它失去 seq 单调性 ⇒ 工作段划界/停点锚点错位） */
      { id: 'tool:call-1', role: 'tool', seq: 1, text: 'bash', detail: '已完成', failed: false },
    ])
  })

  /* 0.1.82（停点节点标题成工具名、菱形消失）：**seq 首见为准**。
     旧实现里工具卡在 tool/result 时 seq 被改写成结果 seq，而夹在中间的审批决定卡仍是决定 seq
     ⇒ DOM 顺序与 seq 顺序失去单调性 ⇒ 工作段在该工具卡处切界、停点锚点回溯够不着决定卡。 */
  it('keeps the first seq so decision cards stay monotonic with tool cards (0.1.82)', () => {
    const projector = new ConversationProjector()
    projector.apply(event('tool/call', 82, { callId: 'ws-1', name: 'web_search' }))
    projector.apply(event('approval/asked', 83, { id: 'ap-1', toolName: 'web_search' }))
    projector.apply(event('approval/decided', 84, { id: 'ap-1', outcome: 'allowed-once' }))
    projector.apply(event('tool/result', 88, {
      message: { source: { kind: 'tool', callId: 'ws-1' }, content: [{ type: 'tool-result', toolCallId: 'ws-1', isError: false }] },
    }))

    const seqs = projector.messages().map(message => ({ id: message.id, seq: message.seq }))
    expect(seqs).toEqual([
      { id: 'tool:ws-1', seq: 82 },       /* 不再被 result(88) 改写 */
      { id: 'approval:ap-1', seq: 84 },
    ])
    /* 工具卡 seq(82) < 决定卡 seq(84) ⇒ 与 DOM（创建）顺序单调一致 */
    expect(Number(seqs[0]?.seq)).toBeLessThan(Number(seqs[1]?.seq))
  })

  it('keeps official call and result presentation views for rich tool cards', () => {
    const projector = new ConversationProjector()
    projector.apply(event('tool/call', 1, {
      callId: 'call-rich',
      name: 'bash',
      arguments: '{"command":"pnpm test"}',
    }), {
      for: 'call',
      view: { card: 'terminal', title: 'pnpm test', cwd: '/workspace' },
    })
    projector.apply(event('tool/result', 2, {
      message: {
        source: { kind: 'tool', callId: 'call-rich' },
        content: [{ type: 'tool-result', toolCallId: 'call-rich', content: [{ type: 'text', text: 'passed' }] }],
      },
    }), {
      for: 'result',
      view: { card: 'terminal', output: 'passed', exitCode: 0 },
    })

    expect(projector.messages()).toEqual([expect.objectContaining({
      id: 'tool:call-rich',
      callView: { card: 'terminal', title: 'pnpm test', cwd: '/workspace' },
      resultView: { card: 'terminal', output: 'passed', exitCode: 0 },
      rawInput: '{"command":"pnpm test"}',
      rawResult: 'passed',
    })])
  })

  it('keeps intentionally duplicated user images in order (0.0.55 反馈③)', () => {
    /* 附件库内容寻址：同一张图两次 = 相同 attachmentId。旧实现用 Map 按 id 去重 → 回显后少一张。 */
    const projector = new ConversationProjector()
    projector.apply(event('user/message', 1, {
      id: 'dup',
      source: { kind: 'user' },
      content: [
        { type: 'text', text: '两张一样的图' },
        { type: 'image', attachment: { attachmentId: 'same', mediaType: 'image/png', bytes: 10, width: 8, height: 8, name: 'a.png' } },
        { type: 'image', attachment: { attachmentId: 'same', mediaType: 'image/png', bytes: 10, width: 8, height: 8, name: 'a.png' } },
        { type: 'image', attachment: { attachmentId: 'other', mediaType: 'image/png', bytes: 10, width: 8, height: 8, name: 'b.png' } },
      ],
    }))
    const message = projector.messages()[0]
    expect(message?.images?.map(image => image.attachmentId)).toEqual(['same', 'same', 'other'])
  })

  it('collapses only the same node visited twice, not distinct duplicates (0.0.55 反馈③)', () => {
    const projector = new ConversationProjector()
    const shared = { type: 'image', attachment: { attachmentId: 'shared', mediaType: 'image/png', bytes: 10, width: 4, height: 4 } }
    projector.apply(event('assistant/message', 1, { turn: 1, step: 1, message: { content: [shared, { type: 'tool-result', toolCallId: 'x', content: [shared] }] } }))
    const images = projector.messages()[0]?.images ?? []
    expect(images.map(image => image.attachmentId)).toEqual(['shared'])
  })

  it('keeps durable assistant and nested tool-result images for client-side loading', () => {
    const projector = new ConversationProjector()
    projector.apply(event('assistant/message', 1, {
      turn: 1,
      step: 1,
      message: {
        content: [{
          type: 'image',
          attachment: {
            attachmentId: 'assistant-image',
            mediaType: 'image/png',
            bytes: 100,
            width: 20,
            height: 10,
            name: 'chart.png',
          },
        }],
      },
    }))
    projector.apply(event('tool/call', 2, { callId: 'image-call', name: 'mcp_image' }))
    projector.apply(event('tool/result', 3, {
      message: {
        source: { kind: 'tool', callId: 'image-call' },
        content: [{
          type: 'tool-result',
          toolCallId: 'image-call',
          content: [{
            type: 'tool-result',
            toolCallId: 'nested',
            content: [{
              type: 'image',
              attachment: {
                attachmentId: 'tool-image',
                mediaType: 'image/webp',
                bytes: 200,
                width: 40,
                height: 30,
              },
            }],
          }],
        }],
      },
    }))

    expect(projector.messages()).toEqual([
      expect.objectContaining({
        id: 'assistant:1:1',
        text: '',
        images: [{
          attachmentId: 'assistant-image',
          mediaType: 'image/png',
          width: 20,
          height: 10,
          name: 'chart.png',
        }],
      }),
      expect.objectContaining({
        id: 'tool:image-call',
        images: [{
          attachmentId: 'tool-image',
          mediaType: 'image/webp',
          width: 40,
          height: 30,
        }],
      }),
    ])
  })

  it('folds official command lifecycle events into one card', () => {
    const projector = new ConversationProjector()
    projector.apply(event('command/run', 1, { commandId: 'command-1', name: 'compact' }))
    projector.apply(event('command/done', 2, { commandId: 'command-1', kind: 'success', text: 'Compacted.' }))

    expect(projector.messages()).toEqual([{
      id: 'command:command-1',
      role: 'command',
      /* 0.1.82：seq 首见为准（保持 command/run 的 seq，同工具卡） */
      seq: 1,
      text: '/compact',
      detail: '已完成',
      failed: false,
      rawResult: 'Compacted.',
    }])
  })

  it('hides plan control transitions from the conversation', () => {
    const projector = new ConversationProjector()
    projector.reset([
      event('command/run', 1, { commandId: 'plan', name: 'plan' }),
      event('command/done', 2, { commandId: 'plan', kind: 'success', text: 'Plan mode on.' }),
      event('command/run', 3, { commandId: 'legacy-plan-on', name: 'plan', args: ' on' }),
      event('command/done', 4, { commandId: 'legacy-plan-on', kind: 'success', text: 'Plan mode on.' }),
      event('command/run', 5, { commandId: 'plan-off', name: 'plan', args: ' off' }),
      event('command/done', 6, { commandId: 'plan-off', kind: 'success', text: 'Plan mode off.' }),
    ])

    expect(projector.messages()).toEqual([])
  })
})

describe('fullTextOfEvent (C3 v1.1)', () => {
  it('extracts full text by event type without truncating', () => {
    const long = '甲'.repeat(200)
    expect(fullTextOfEvent(event('user/message', 1, { source: { kind: 'user' }, content: [{ type: 'text', text: long }] }))).toBe(long)
    expect(fullTextOfEvent(event('assistant/message', 2, { message: { content: [{ type: 'reasoning', text: 'x' }, { type: 'text', text: 'hello' }, { type: 'text', text: 'world' }] } }))).toBe('hello\nworld')
    expect(fullTextOfEvent(event('tool/result', 3, { message: { content: [{ type: 'tool-result', text: 'tool output' }] } }))).toBe('tool output')
  })

  it('returns undefined for unrelated types and empty payloads', () => {
    expect(fullTextOfEvent(event('tool/call', 4, { name: 'read' }))).toBeUndefined()
    expect(fullTextOfEvent(event('assistant/chunk', 5, { chunk: { type: 'text-delta', text: 'x' } }))).toBeUndefined()
    expect(fullTextOfEvent(event('user/message', 6, { source: { kind: 'user' }, content: [] }))).toBeUndefined()
    expect(fullTextOfEvent({ type: 'user/message', seq: 7, time: 7, data: null })).toBeUndefined()
  })
})

describe('imagesOfEvent (C3 v1.1 / C11)', () => {
  const image = (id: string) => ({ type: 'image', attachment: { attachmentId: id, mediaType: 'image/png', width: 10, height: 20 } })

  it('collects image references from user, assistant and tool-result events', () => {
    expect(imagesOfEvent(event('user/message', 1, { content: [{ type: 'text', text: 'x' }, image('a')] }))).toEqual([
      { attachmentId: 'a', mediaType: 'image/png', width: 10, height: 20 },
    ])
    expect(imagesOfEvent(event('assistant/message', 2, { message: { content: [image('b'), image('c')] } }))).toHaveLength(2)
    expect(imagesOfEvent(event('tool/result', 3, { message: { content: [{ type: 'tool-result', content: [image('d')] }] } }))).toEqual([
      { attachmentId: 'd', mediaType: 'image/png', width: 10, height: 20 },
    ])
  })

  it('ignores unrelated events, malformed blocks and incomplete attachments', () => {
    expect(imagesOfEvent(event('tool/call', 4, { name: 'read' }))).toEqual([])
    expect(imagesOfEvent(event('user/message', 5, { content: [{ type: 'image', attachment: { attachmentId: 'x' } }] }))).toEqual([])
    expect(imagesOfEvent({ type: 'user/message', seq: 6, time: 6, data: null })).toEqual([])
  })
})

/* 0.0.131（用户反馈⑤）：选择/判断留痕——审批决定产出会话流记录 + 停点；
   提问结果停点判定修正（原写 'ask_user'，实际工具名是 'ask_user_question'，该停点从未生效）。 */
describe('ConversationProjector approval & ask stops (0.0.131)', () => {
  it('emits a decision message with tool name and reason, and records the stop seq', () => {
    const projector = new ConversationProjector()
    projector.reset([
      event('tool/call', 10, { callId: 'c1', name: 'write' }),
      event('approval/asked', 11, { id: 'ap-1', toolName: 'write', callId: 'c1', reason: 'escalate sandbox to danger-full-access: 写工作区外文件' }),
      event('approval/decided', 12, { id: 'ap-1', outcome: 'rejected' }),
    ])
    expect(projector.segmentStops()).toEqual([12])
    const decision = projector.messages().find(message => message.role === 'decision')
    expect(decision).toMatchObject({
      id: 'approval:ap-1',
      text: '已拒绝 · write',
      detail: 'escalate sandbox to danger-full-access: 写工作区外文件',
      failed: true,
      time: 12,
    })
  })

  it('marks allowed decisions as non-failed and tolerates missing asked events', () => {
    const projector = new ConversationProjector()
    projector.apply(event('approval/decided', 20, { id: 'ap-2', outcome: 'allowed-once' }))
    const decision = projector.messages().find(message => message.role === 'decision')
    expect(decision).toMatchObject({ id: 'approval:ap-2', text: '已允许一次', failed: false })
  })

  it('records an ask_user_question result as a segment stop (name fix)', () => {
    const projector = new ConversationProjector()
    projector.reset([
      event('tool/call', 30, { callId: 'c9', name: 'ask_user_question' }),
      event('tool/result', 31, {
        message: {
          source: { kind: 'tool', callId: 'c9' },
          content: [{ type: 'tool-result', toolCallId: 'c9', isError: false, content: [{ type: 'text', text: '{"answers":[]}' }] }],
        },
      }),
    ])
    /* 0.1.82：停点 seq 取**留痕卡自身**（tool/call 的 30），保证「停点 == 卡片 data-seq」仍成立 */
    expect(projector.segmentStops()).toEqual([30])
  })
})

  /* 0.0.150 真机回归：运行时点轨道节点（翻页触发 projector.reset 重放）后，正在流式的 AI 回复
     被顶到对话最顶部。根因 = 流式合成块 seq 取负（真实数据里没有）→ mergeHistoryEntries 按数值
     升序把它们排到最前 → 重放时流式消息第一个进场。修复后负 seq 事件排尾、重放顺序正确。 */
  it('keeps a mid-stream synthetic chunk message at the tail after a history reset (0.0.150)', () => {
    const page = [
      { event: event('user/message', 9, { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: '第一句' }] }) },
      { event: event('assistant/message', 10, { turn: 1, step: 1, message: { content: [{ type: 'text', text: '旧的回复' }] } }) },
    ]
    const live = [
      { event: event('user/message', 11, { id: 'u2', source: { kind: 'user' }, content: [{ type: 'text', text: '新一句' }] }) },
      { event: event('assistant/chunk', -1, { turn: 16, step: 1, chunk: { type: 'text-delta', text: '流式' } }) },
    ]
    const older = [
      { event: event('user/message', 2, { id: 'u0', source: { kind: 'user' }, content: [{ type: 'text', text: '更早' }] }) },
    ]
    /* 复刻真机编排：live 增量并入（含负 seq 合成块）→ 翻页 merge → reset 重放 */
    let hist = mergeHistoryEntries(page, live)
    hist = mergeHistoryEntries(hist, older)
    const projector = new ConversationProjector()
    projector.reset(hist)
    expect(projector.messages().map(message => message.id)).toEqual(['u0', 'u1', 'assistant:1:1', 'u2', 'assistant:16:1'])
  })

/* 2026-10-06（长会话卡顿测量，W1/W2/W5/W6）：
   - iterMessages/lastUserMessage：只读轻迭代替代全量拷贝（hydrateImages/索引构建/尾查的消费面）；
   - settleStreaming O(1) 门控：语义不变、无流式时不做全表扫描。 */
describe('投影器轻迭代与流式门控（W1/W2/W5/W6）', () => {
  const build = (): ConversationProjector => {
    const projector = new ConversationProjector()
    projector.reset([
      { event: event('user/message', 1, { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] }) },
      { event: event('assistant/message', 2, { turn: 1, step: 1, message: { content: [{ type: 'text', text: '回复一' }] } }) },
      { event: event('user/message', 3, { id: 'u2', source: { kind: 'user' }, content: [{ type: 'text', text: '第二问' }] }) },
      { event: event('assistant/chunk', -1, { turn: 2, step: 1, chunk: { type: 'text-delta', text: '流式中' } }) },
    ])
    return projector
  }

  it('iterMessages：顺序与字段与 messages() 逐位一致（不拷贝，只读引用）', () => {
    const projector = build()
    expect(projector.iterMessages()).toEqual(projector.messages())
    // 同一引用返回（无拷贝）：同一 id 连续两次迭代取到同一对象
    const first = projector.iterMessages()
    const second = projector.iterMessages()
    expect(first[0]).toBe(second[0])
  })

  it('lastUserMessage：取尾部最后一条 user 消息（含空文本的纯文件消息）', () => {
    const projector = new ConversationProjector()
    projector.reset([
      { event: event('user/message', 1, { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: '旧问' }] }) },
      { event: event('assistant/message', 2, { turn: 1, step: 1, message: { content: [{ type: 'text', text: '答' }] } }) },
      { event: event('user/message', 3, { id: 'u2', source: { kind: 'user' }, content: [{ type: 'image', attachment: { attachmentId: 'img1', mediaType: 'image/png', bytes: 3, width: 2, height: 2 } }] }) },
    ])
    const tail = projector.lastUserMessage()
    expect(tail?.id).toBe('u2')
    expect(tail?.text).toBe('')
  })

  it('settleStreaming：有流式 → 结算；无流式 → 幂等空操作（门控不改变语义）', () => {
    const projector = build()
    expect(projector.messages().some(message => message.streaming === true)).toBe(true)
    projector.settleStreaming()
    expect(projector.messages().some(message => message.streaming === true)).toBe(false)
    // 再次调用：无流式，门控直接返回、结果不变
    const before = projector.messages()
    projector.settleStreaming()
    expect(projector.messages()).toEqual(before)
  })

  it('settleStreaming 计数不变量：结算后再流式 → 重新可被结算', () => {
    const projector = build()
    projector.settleStreaming()
    projector.apply(event('assistant/chunk', -2, { turn: 3, step: 1, chunk: { type: 'text-delta', text: '再来' } }))
    expect(projector.messages().some(message => message.streaming === true)).toBe(true)
    projector.settleStreaming()
    expect(projector.messages().some(message => message.streaming === true)).toBe(false)
  })
})

/* 2026-10-06（S3 L1）：messages() 拷贝缓存契约——未变共享、变更换新、内容与无缓存参考逐位一致。 */
describe('messages() 拷贝缓存（S3 L1）', () => {
  const seed = (): ConversationProjector => {
    const projector = new ConversationProjector()
    projector.reset([
      { event: event('user/message', 1, { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: '问' }] }) },
      { event: event('assistant/message', 2, { turn: 1, step: 1, message: { content: [{ type: 'text', text: '答一' }] } }) },
      { event: event('assistant/chunk', -1, { turn: 2, step: 1, chunk: { type: 'text-delta', text: '流' } }) },
    ])
    return projector
  }

  it('未变消息跨调用共享同一拷贝；内容与参考（新投影器重放）逐位一致', () => {
    const projector = seed()
    const first = projector.messages()
    const second = projector.messages()
    expect(second.map((m, i) => m === first[i])).toEqual([true, true, true])
    const reference = seed().messages()
    expect(second).toEqual(reference)
  })

  it('变更消息换新拷贝、其余保持共享（自动失效）', () => {
    const projector = seed()
    const before = projector.messages()
    const streaming = before[before.length - 1]!
    projector.apply(event('assistant/chunk', -2, { turn: 2, step: 1, chunk: { type: 'text-delta', text: '追加' } }))
    const after = projector.messages()
    expect(after[0]).toBe(before[0])
    expect(after[after.length - 1]).not.toBe(streaming)
    expect(after[after.length - 1]!.text.startsWith(streaming.text)).toBe(true)
  })

  it('settleStreaming 替换式写 → 被结算消息换新拷贝', () => {
    const projector = seed()
    const before = projector.messages()
    projector.settleStreaming()
    const after = projector.messages()
    expect(after[after.length - 1]).not.toBe(before[before.length - 1])
    expect(after[after.length - 1]!.streaming).toBeUndefined()
  })
})
