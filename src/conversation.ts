import { withoutIdeContext } from './ide-context.js'
import type { ImageMediaType } from './dsh-client.js'

export type ConversationRole = 'user' | 'assistant' | 'tool' | 'command' | 'notice' | 'decision'

export interface ConversationMessage {
  id: string
  role: ConversationRole
  text: string
  detail?: string
  streaming?: boolean
  failed?: boolean
  callView?: unknown
  resultView?: unknown
  rawInput?: string
  rawResult?: string
  images?: ConversationImage[]
  deferredBody?: boolean
  deferredBodyRevision?: string
  bodyLength?: number
    /** user 消息的 server 事件序列号（文件卡注入锚；非协议改动，仅本地会话增补） */
  seq?: number
  /** 消息携带的文件卡（G22：extension 从持久化元数据注入，webview 渲染） */
  files?: ConversationMessageFile[]
    /** 消息创建时刻（首帧 event.time；G5 元信息，webview 尾行显示） */
  time?: number
  /** 消息级元信息（G5：用时/首 token/tok/s；extension 侧结算注入，webview 只渲染；恢复会话暂无） */
  meta?: MessageMeta
}

export interface MessageMeta {
  /* 0.1.5：历史重建路径无 durationMs（无独立 chunk 事件）——时长缺省仅剩 tok/s（记忆回填）。 */
  durationMs?: number
  firstTokenMs?: number
  tokS?: number
}

export interface ConversationMessageFile {
  name: string
  path: string
  mime: string
  size: number
  origin: 'paste-copy' | 'workspace'
  status: 'active' | 'expired'
}

interface AssistantStreamNode {
  previous?: AssistantStreamNode
  text: string
}

const assistantStreams = new WeakMap<ConversationMessage, AssistantStreamNode>()

function inheritAssistantStream(source: ConversationMessage | undefined, target: ConversationMessage): void {
  const stream = source === undefined ? undefined : assistantStreams.get(source)
  if (stream !== undefined) assistantStreams.set(target, stream)
}

function appendAssistantStream(source: ConversationMessage | undefined, target: ConversationMessage, text: string): void {
  const previous = source === undefined ? undefined : assistantStreams.get(source)
  assistantStreams.set(target, { ...(previous === undefined ? {} : { previous }), text })
}

/** Returns the exact append represented by two projector snapshots without rescanning their accumulated text. */
export function assistantStreamAppend(left: ConversationMessage, right: ConversationMessage): string | undefined {
  const target = assistantStreams.get(left)
  let current = assistantStreams.get(right)
  if (current === undefined) return undefined
  if (current === target) return left.text.length === right.text.length ? '' : undefined
  const chunks: string[] = []
  while (current !== undefined && current !== target) {
    chunks.push(current.text)
    current = current.previous
  }
  if (current !== target) return undefined
  return chunks.reverse().join('')
}

export interface ConversationImage {
  attachmentId: string
  mediaType: ImageMediaType
  width: number
  height: number
  name?: string
  data?: string
  error?: string
}

export interface DshEvent {
  type: string
  seq: number
  time: number
  data: unknown
}

interface EventData {
  [key: string]: unknown
}

function record(value: unknown): EventData | undefined {
  return typeof value === 'object' && value !== null ? value as EventData : undefined
}

/** Tool calls and results share an identity, including results carrying the ID in their first block. */
export function toolMessageIdOfEvent(event: DshEvent): string | undefined {
  const data = record(event.data)
  if (data === undefined) return undefined
  if (event.type === 'tool/call') return `tool:${typeof data.callId === 'string' ? data.callId : String(event.seq)}`
  if (event.type !== 'tool/result') return undefined
  const message = record(data.message)
  const source = record(message?.source)
  const firstBlock = Array.isArray(message?.content) ? record(message.content[0]) : undefined
  const callId = typeof source?.callId === 'string' ? source.callId
    : typeof firstBlock?.toolCallId === 'string' ? firstBlock.toolCallId : String(event.seq)
  return `tool:${callId}`
}

function textContent(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.flatMap((part) => {
    const item = record(part)
    return item?.type === 'text' && typeof item.text === 'string' ? [item.text] : []
  }).join('\n')
}

function imageMediaType(value: unknown): ImageMediaType | undefined {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif'
    ? value
    : undefined
}

/** Finds durable DSH image references, including images nested inside tool results.
 *  0.0.55（反馈③）: 顺序保留、**合法重复保留**——附件库是内容寻址（同一张图 = 同一个 attachmentId），
 *  用户有意附加两次同图时，旧实现用 Map 按 id 去重 → 回显后重复项消失（实测"看着一样的图片/文件
 *  回显后少了一个"）。改为数组收集；仅用**节点身份**防重复遍历（同一节点被访问两次时跳过），
 *  不同节点即使 attachmentId 相同也各自计入。 */
function imageContent(value: unknown): ConversationImage[] {
  const found: ConversationImage[] = []
  const visited = new Set<object>()
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      if (visited.has(candidate)) return
      visited.add(candidate)
      for (const item of candidate) visit(item)
      return
    }
    const item = record(candidate)
    if (item === undefined || visited.has(item)) return
    visited.add(item)
    if (item.type === 'image') {
      const attachment = record(item.attachment)
      const mediaType = imageMediaType(attachment?.mediaType)
      if (attachment !== undefined
        && typeof attachment.attachmentId === 'string'
        && mediaType !== undefined
        && typeof attachment.width === 'number'
        && typeof attachment.height === 'number') {
        found.push({
          attachmentId: attachment.attachmentId,
          mediaType,
          width: attachment.width,
          height: attachment.height,
          ...(typeof attachment.name === 'string' ? { name: attachment.name } : {}),
        })
      }
    }
    if (Array.isArray(item.content)) visit(item.content)
  }
  visit(value)
  return found
}

function resultContent(value: unknown): string {
  const item = record(value)
  if (item === undefined) return ''
  if (typeof item.text === 'string') return item.text
  if (Array.isArray(item.content)) return textContent(item.content)
  if (typeof item.content === 'string') return item.content
  return ''
}

function toolView(value: unknown, expected: 'call' | 'result'): unknown {
  const wrapper = record(value)
  return wrapper?.for === expected ? wrapper.view : undefined
}

/** C3 v1.1（0.0.72）：从一条会话事件抽取图片引用（与 projector 的抽取同源）——明细里
    图片消息节点只有计数（node.imgs），实际图片靠它回事件里取 attachmentId 再按需加载。 */
export function imagesOfEvent(event: DshEvent): ConversationImage[] {
  const data = record(event.data)
  if (data === undefined) return []
  if (event.type === 'user/message') return imageContent(data.content)
  if (event.type === 'assistant/message' || event.type === 'tool/result') {
    const message = record(data.message)
    return imageContent(message?.content)
  }
  return []
}

/** C3 v1.1（0.0.71）：从一条会话事件抽取完整文本——与 projector 的抽取同源（不截断），
    供上下文「组成明细」按需取全文（投影里的 node.text 被插件截到 80 字符）。 */
export function fullTextOfEvent(event: DshEvent): string | undefined {
  const data = record(event.data)
  if (data === undefined) return undefined
  if (event.type === 'user/message') {
    const text = withoutIdeContext(textContent(data.content))
    return text === '' ? undefined : text
  }
  if (event.type === 'assistant/message') {
    const message = record(data.message)
    const text = textContent(message?.content)
    return text === '' ? undefined : text
  }
  if (event.type === 'tool/result') {
    const message = record(data.message)
    const firstBlock = Array.isArray(message?.content) ? message.content[0] : undefined
    const text = resultContent(firstBlock)
    return text === '' ? undefined : text
  }
  return undefined
}

/** Projects the official append-only DSH event log into the small chat surface. */
export class ConversationProjector {
  private readonly orderedIds: string[] = []
  private readonly byId = new Map<string, ConversationMessage>()
  private readonly hiddenCommandIds = new Set<string>()
  /* G49 v2（0.0.121）：工作段的"已应答停点"——审批决定与 ask_user 结果，作为分段边界（用户界定：
     "我输入一次（发消息 / 回答提问 / 审批）"）。存事件 seq，重载后由日志重放重建。 */
  private readonly stopSeqs: number[] = []
  /* 0.0.131（用户反馈⑤）：审批留痕——asked 存因（工具名/原因），decided 产出一条"决定"消息，
     否则"我允许/拒绝了什么"在会话里无处可查。 */
  private readonly pendingApprovals = new Map<string, { toolName: string; reason?: string }>()
  private currentSeq: number | undefined
  /* 2026-10-06（W5）：流式消息计数——settleStreaming 的 O(1) 门控（真机剖面：每拍全表扫 ~3200 条，
     占 495ms/27min 且带 GC 压力）。所有 streaming 写入都经 set()/settleStreaming/reset 维护。 */
  private streamingCount = 0

  reset(entries: readonly (DshEvent | { event: DshEvent; view?: unknown })[]): void {
    this.orderedIds.length = 0
    this.byId.clear()
    this.hiddenCommandIds.clear()
    this.stopSeqs.length = 0
    this.pendingApprovals.clear()
    this.currentSeq = undefined
    this.streamingCount = 0
    /* 0.1.89（用户报②"回复完了还一直呼吸"）：**重放不重放"合成流式块"**——真凶路径：
       实时链路把 assistant-stream 帧合成为 assistant/chunk 事件、带**负 seq**（客户端计数器，
       仅供流式增量渲染）；窗口缓存的合并排序把"非正 seq"当 +∞ 排到**最后**（0.0.150 的不变量），
       于是重放时这些块落在 assistant/message / turn/end **之后**被再次应用 ⇒ 已结算的消息被
       **重新点亮为 streaming**（探针实测：文本还会被 delta 二次追加）。
       规则：同 turn/step 已有权威 assistant/message 时跳过这些块；**没有**权威消息
       （中断流、只有半截文本的场景）时保留——重放仍能还原那半截内容。 */
    const settled = new Set<string>()
    const eventOf = (entry: DshEvent | { event: DshEvent; view?: unknown }): DshEvent => ('event' in entry ? entry.event : entry)
    for (const entry of entries) {
      const event = eventOf(entry)
      if (event.type !== 'assistant/message') continue
      const data = record(event.data)
      if (data !== undefined) settled.add(`${String(data.turn)}:${String(data.step)}`)
    }
    for (const entry of entries) {
      const event = eventOf(entry)
      if (event.type === 'assistant/chunk' && !(typeof event.seq === 'number' && event.seq > 0)) {
        const data = record(event.data)
        if (data !== undefined && settled.has(`${String(data.turn)}:${String(data.step)}`)) continue
      }
      if ('event' in entry) this.apply(entry.event, entry.view)
      else this.apply(entry)
    }
  }

  apply(event: DshEvent, view?: unknown): void {
    const data = record(event.data)
    if (data === undefined) return
    this.currentSeq = typeof event.seq === 'number' && Number.isFinite(event.seq) ? event.seq : undefined
    /* 审批：asked 存因（含工具名与原因原文），decided 产出决定记录（0.0.131）。 */
    if (event.type === 'approval/asked') {
      const approvalId = typeof data.id === 'string' ? data.id : ''
      if (approvalId !== '') {
        this.pendingApprovals.set(approvalId, {
          toolName: typeof data.toolName === 'string' ? data.toolName : '工具',
          ...(typeof data.reason === 'string' ? { reason: data.reason } : {}),
        })
      }
      return
    }
    /* 审批决定 = 一次"我输入"（回答审批）→ 记停点（分段边界）+ 决定记录消息。 */
    if (event.type === 'approval/decided') {
      if (this.currentSeq !== undefined && !this.stopSeqs.includes(this.currentSeq)) this.stopSeqs.push(this.currentSeq)
      const approvalId = typeof data.id === 'string' ? data.id : ''
      const outcome = typeof data.outcome === 'string' ? data.outcome : ''
      const asked = this.pendingApprovals.get(approvalId)
      this.pendingApprovals.delete(approvalId)
      const allowed = outcome !== 'rejected'
      const recordId = `approval:${approvalId === '' ? String(event.seq) : approvalId}`
      this.set(recordId, {
        id: recordId,
        role: 'decision',
        text: (allowed ? '已允许一次' : '已拒绝') + (asked === undefined ? '' : ' · ' + asked.toolName),
        ...(asked?.reason === undefined ? {} : { detail: asked.reason }),
        failed: !allowed,
        time: event.time,
        ...(typeof event.seq === 'number' ? { seq: event.seq } : {}),
      })
      return
    }

    /* 0.1.79（用户报②"终止状态不统一"）：**turn/end = 终止态不变量**——一轮结束就没有任何东西还在生成。
       结算帧丢失（0.1.20 那类丢帧）/ 幻影 id / 工具结果丢失等一切残留路径在此统一收口
       （与 extension 侧既有 `turn/end ⇒ running=false` 兜底同源、同一事件）。
       真机症状：最后一条助手回复的"白块（.streaming::after 光标）+ 蓝鲸头像"呼吸永不停止，
       且切走再切回仍在（整树重渲也带回来 ⇒ 残留就在投影状态里）。 */
    if (event.type === 'turn/end') {
      this.settleStreaming()
      return
    }

    if (event.type === 'user/message') {
      const source = record(data.source)
      if (source?.kind !== 'user') return
      const id = typeof data.id === 'string' ? data.id : `user:${String(event.seq)}`
      const text = withoutIdeContext(textContent(data.content))
      const images = imageContent(data.content)
      if (text !== '' || images.length > 0) this.set(id, { id, seq: event.seq, role: 'user', text, time: event.time, ...(images.length > 0 ? { images } : {}) })
      return
    }

    if (event.type === 'assistant/chunk') {
      const chunk = record(data.chunk)
      const id = `assistant:${String(data.turn)}:${String(data.step)}`
      const current = this.byId.get(id)
      if (chunk?.type === 'block-end') {
        const images = imageContent(chunk.block)
        if (images.length === 0) return
        const next: ConversationMessage = {
          id,
          role: 'assistant',
          text: current?.text ?? '',
          images: mergeImages(current?.images, images),
          streaming: true,
          time: current?.time ?? event.time,
        }
        inheritAssistantStream(current, next)
        this.set(id, next)
        return
      }
      if (chunk?.type !== 'text-delta' || typeof chunk.text !== 'string') return
      const next: ConversationMessage = {
        id,
        role: 'assistant',
        text: `${current?.text ?? ''}${chunk.text}`,
        streaming: true,
        time: current?.time ?? event.time,
      }
      appendAssistantStream(current, next, chunk.text)
      this.set(id, next)
      return
    }

    if (event.type === 'assistant/message') {
      const message = record(data.message)
      const id = `assistant:${String(data.turn)}:${String(data.step)}`
      const current = this.byId.get(id)
      const text = textContent(message?.content)
      const images = imageContent(message?.content)
      if (text !== '' || images.length > 0) {
        const next: ConversationMessage = { id, role: 'assistant', text, time: current?.time ?? event.time, ...(images.length > 0 ? { images } : {}) }
        if (current !== undefined && text === current.text) inheritAssistantStream(current, next)
        this.set(id, next)
      }
      return
    }

    if (event.type === 'tool/call') {
      const id = toolMessageIdOfEvent(event)!
      const name = typeof data.name === 'string' ? data.name : 'Tool'
      this.set(id, {
        id,
        role: 'tool',
        text: name,
        detail: '运行中…',
        streaming: true,
        callView: toolView(view, 'call'),
        ...(typeof data.arguments === 'string' ? { rawInput: data.arguments } : {}),
      })
      return
    }

    if (event.type === 'tool/result') {
      const message = record(data.message)
      const firstBlock = Array.isArray(message?.content) ? record(message.content[0]) : undefined
      const id = toolMessageIdOfEvent(event)!
      const current = this.byId.get(id)
      /* 交互式提问的应答 = 一次"我输入" → 记停点。0.0.131：原判定写 'ask_user'，实际工具名为
         'ask_user_question'——该停点自 0.0.121 起从未生效（审批那条一直是好的，提问这条是死的）。
         0.1.82：停点 seq 取**留痕卡自身的 seq**（= 提问卡创建时的 tool/call seq）——与 `set` 的"seq 首见为准"
         配套后，划段判据"停点 == 卡片 seq"仍成立（0.1.11 的末段立即结束依赖它），且不会再让卡片 seq 随结果跳变。 */
      if (current?.text === 'ask_user_question') {
        const stopSeq = typeof current.seq === 'number' ? current.seq : this.currentSeq
        if (stopSeq !== undefined && !this.stopSeqs.includes(stopSeq)) this.stopSeqs.push(stopSeq)
      }
      const failed = data.error !== undefined || firstBlock?.isError === true
      const rawResult = resultContent(firstBlock)
      const images = imageContent(message?.content)
      this.set(id, {
        id,
        role: 'tool',
        text: current?.text ?? 'Tool',
        detail: failed ? '失败' : '已完成',
        failed,
        ...(current?.callView === undefined ? {} : { callView: current.callView }),
        ...(current?.rawInput === undefined ? {} : { rawInput: current.rawInput }),
        resultView: toolView(view, 'result'),
        ...(rawResult === '' ? {} : { rawResult }),
        ...(images.length > 0 ? { images } : {}),
      })
      return
    }

    if (event.type === 'command/run') {
      if (typeof data.commandId !== 'string' || typeof data.name !== 'string') return
      // Plan entry/exit is a composer control transition as well as a slash
      // command. Keep its durable DSH events for the projection, but do not
      // turn a Shield click into a synthetic chat card.
      const planArgs = typeof data.args === 'string' ? data.args.trim() : ''
      if (data.name === 'plan'
        && (planArgs === '' || planArgs === 'on' || planArgs === 'off')) {
        this.hiddenCommandIds.add(data.commandId)
        return
      }
      const id = `command:${data.commandId}`
      this.set(id, {
        id,
        role: 'command',
        text: `/${data.name}${typeof data.args === 'string' ? data.args : ''}`,
        detail: '运行中…',
        streaming: true,
      })
      return
    }

    if (event.type === 'command/done') {
      if (typeof data.commandId !== 'string') return
      if (this.hiddenCommandIds.has(data.commandId)) return
      const id = `command:${data.commandId}`
      const current = this.byId.get(id)
      const failed = data.kind === 'error'
      this.set(id, {
        id,
        role: 'command',
        text: current?.text ?? 'DeepSeek 命令',
        detail: failed ? '失败' : '已完成',
        failed,
        ...(typeof data.text === 'string' && data.text !== '' ? { rawResult: data.text } : {}),
      })
    }
  }

  notice(id: string, text: string, failed = false): void {
    this.set(id, { id, role: 'notice', text, failed })
  }

  /* 2026-10-06（S3，性能）：messages() 的**拷贝缓存**——L1 层。set()/settleStreaming 每次以新对象
     替换 byId 值 ⇒ 未变条目弱键命中旧拷贝（结构共享）；数组重建仅 N 次 push。
     `inheritAssistantStream` 的 WeakMap 关联随缓存的拷贝保留（流式追加差分链路不变）。
     真机剖面：本函数逐条拷贝占 messagesPatch 链的大头（35s/285s 级）。 */
  private readonly messageCopies = new WeakMap<ConversationMessage, ConversationMessage>()

  messages(): ConversationMessage[] {
    const out: ConversationMessage[] = []
    for (const id of this.orderedIds) {
      const value = this.byId.get(id)
      if (value === undefined) continue
      let copy = this.messageCopies.get(value)
      if (copy === undefined) {
        copy = { ...value }
        inheritAssistantStream(value, copy)
        this.messageCopies.set(value, copy)
      }
      out.push(copy)
    }
    return out
  }

  /* 2026-10-06（长会话卡顿测量，W1/W2/W6）：**只读轻迭代**——按 orderedIds 顺序返回 byId 中的
     消息**引用**（不做逐条 {...} 拷贝；字段与 messages() 的拷贝逐位一致，仅少了载体对象）。
     供"字段提取类"消费方使用（图片收集 / 索引构建 / 尾消息查找）——真机剖面中 hydrateImages
     每事件一次全量拷贝独占 9s/27min，索引构建同族。**返回对象禁止改动**（调用方只读约定）。 */
  iterMessages(): ConversationMessage[] {
    const out: ConversationMessage[] = []
    for (const id of this.orderedIds) {
      const value = this.byId.get(id)
      if (value !== undefined) out.push(value)
    }
    return out
  }

  /** 2026-10-06（W6）：尾部最后一条 user 消息（只读引用）——替掉 attachUserEventSeq 的全量拷贝。 */
  lastUserMessage(): ConversationMessage | undefined {
    for (let i = this.orderedIds.length - 1; i >= 0; i -= 1) {
      const value = this.byId.get(this.orderedIds[i]!)
      if (value !== undefined && value.role === 'user' && typeof value.text === 'string') return value
    }
    return undefined
  }

  /* 0.1.79：结算所有仍在流式的消息（turn/end 兜底；工具/命令卡不在此列——它们的"运行中…"文案
     与 ✓ 图标由各自的结果事件闭合，这里只负责助手回复的流式态，避免"✓ + 运行中…"的自相矛盾）。
     0.1.89（用户报②，终止态不变量）：改为 public——扩缩侧在"运行态已落 false"时也调用它收口
     （丢帧 / 订阅窗口错过 / 重放残留等一切路径），幂等。 */
  settleStreaming(): void {
    /* 2026-10-06（W5）：无流式消息时直接返回——该函数每次 messagesPatch 都被调用（!running 时），
       真机剖面全表扫占 495ms/27min + GC。计数由 set()/本函数/reset 维护，语义不变。 */
    if (this.streamingCount === 0) return
    for (const [id, message] of this.byId) {
      if (message.streaming !== true) continue
      if (message.role !== 'assistant') continue
      const settled: ConversationMessage = { ...message }
      delete settled.streaming
      this.byId.set(id, settled)
      this.streamingCount -= 1
    }
  }

  private set(id: string, message: ConversationMessage): void {
    if (!this.byId.has(id)) this.orderedIds.push(id)
    /* G49 v2：全量消息盖章事件 seq（分段/加载穿透按 seq 对齐；user 消息自带 seq 不受影响）。 */
    const stamped = message.seq === undefined && this.currentSeq !== undefined ? { ...message, seq: this.currentSeq } : message
    /* 0.1.82（真机 EUV 会话：停点节点标题成工具名、菱形消失）：**真实 seq 首见为准、不再被后续事件改写**。
       旧实现每次 set 都重盖 ⇒ 工具卡在 tool/result 时 seq 从 82 跳到 88，而它前面刚落地的**审批决定卡仍是
       决定 seq=84** ⇒ DOM 顺序（创建序）与 seq 顺序失去单调性 ⇒ 工作段划界切在工具卡上（而不是留痕卡之后），
       停点锚点回溯也够不着决定卡 ⇒ 节点显示"✓read已完成"、无紫菱形。
       唯一例外：**负 seq = 客户端合成 chunk 的临时值**（见 dsh-client 的 `seq: -(++chunkSeq)`），
       可被后续真实 seq 覆盖（0.0.150 依赖它把流式消息的真 seq 落定）。 */
    const previous = this.byId.get(id)
    const next = keepFirstSeq(previous, stamped)
    /* 2026-10-06（W5）：流式计数维护（进出 streaming 状态各 ±1）。 */
    if ((previous?.streaming === true) !== (next.streaming === true)) {
      this.streamingCount += next.streaming === true ? 1 : -1
    }
    this.byId.set(id, next)
  }

  /** 已应答停点（升序 seq 列表）——0.0.121 起供工作段分段与轨道加载穿透使用。 */
  segmentStops(): number[] {
    return [...this.stopSeqs].sort((a, b) => a - b)
  }
}

/* 0.0.55（反馈③）: 同样保留合法重复——同形状（含重复项逐个对齐）时直接采用新帧；
   其余情形按旧语义合并（同 id 覆盖、新 id 追加），但用数组实现避免 Map 去重。 */
/* 0.1.82：消息 seq 的"首见为准"策略（动机见 ConversationProjector.set 的注释）——
   真实 seq 一旦落定就不再被后续事件改写；只有"临时负值"（客户端合成 chunk）允许升级为真实正值。 */
function keepFirstSeq(previous: ConversationMessage | undefined, next: ConversationMessage): ConversationMessage {
  const kept = previous === undefined ? undefined : previous.seq
  if (typeof kept !== 'number') return next
  if (kept < 0) return typeof next.seq === 'number' && next.seq >= 0 ? next : { ...next, seq: kept }
  return next.seq === kept ? next : { ...next, seq: kept }
}

function mergeImages(current: readonly ConversationImage[] | undefined, next: readonly ConversationImage[]): ConversationImage[] {
  const previous = current ?? []
  if (previous.length === 0) return [...next]
  const sameShape = previous.length === next.length
    && previous.every((image, index) => image.attachmentId === next[index]?.attachmentId)
  if (sameShape) return [...next]
  const merged = [...previous]
  for (const image of next) {
    const index = merged.findIndex(candidate => candidate.attachmentId === image.attachmentId)
    if (index >= 0) merged[index] = image
    else merged.push(image)
  }
  return merged
}
