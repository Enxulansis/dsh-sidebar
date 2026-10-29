/* 0.1.123（G55 Phase 3）：跨会话「轨道节点表」复算——纯函数，供索引构建时逐会话产出，
 * 搜索结果里**他会话**行的节点编号/起点跳转由此换算。
 *
 * 接口契约（冻结，与数据层根治同源——见 `_temp/dsh_迁移计划/2026-10-07_数据层根治设计稿_全量轨道节点表.md` §4.1）：
 *   rail = { segment: [{seq, mid, key}], turn: [{seq, mid|null, key}] }
 *   · key = 's' + seq（与 webview 的 railDropped / 收藏 / 标注裸键空间一致——隐藏/合并跨加载天然统一）
 *   · mid = 段锚点消息 id（停点段向前**有界回溯卡片** ≤12 跳、下界=上一段 nodes[0]——与 reorderWorkSegments 同规则）
 *
 * 规则来源 = 镜像 webview 段逻辑（railTurnsOf 段分支 + applyWorkSegmentFold 的边界循环 + 前缀规则）：
 *   · 段起点 = user 消息 / 停点后首个元素（多个停点只切**一次**边界）/ 页首前导段（窗口产物，现状保留）
 *   · 前缀 = 大纲中 seq < 窗口首 seq 且 prompt 非空、且窗口内无 [seq, endSeq) 用户消息的轮
 * 保真硬门槛 = T3.6 A/B 对账探针（本模块输出 vs 打开后 DOM 轨道逐项），未全绿不接线上。
 * 幂等：输入（窗口消息 + 停点 + 全量大纲）确定 ⇒ 输出确定；不做任何 IO。 */

import type { ConversationMessage } from './conversation.js'

export interface RailNodeEntry {
  seq: number
  mid: string | null
  key: string
  /** 0.1.125（数据层根治）：**轮前缀**条目的区间右界（下一轮起点 seq）。端侧据此按整轮区间判
      "是否已加载"——turn/start 的 seq 本身不渲染元素，缺它会令"turn/start seq 低于窗口首元素"的
      轮永远被判未加载（首节点点不动；0.0.137 同款教训）。段条目不需要（seq 即已渲染消息的锚点）。 */
  endSeq?: number
  /** Exact answered card anchor, including cards outside the loaded body window. */
  stop?: true
}

export interface RailNodeTables {
  segment: RailNodeEntry[]
  turn: RailNodeEntry[]
}

/** 大纲条目最小字段（扩展侧 TurnOutlineEntry 的子集）。 */
export interface RailOutlinePiece {
  seq: number
  prompt: string
}

export interface RailNodeInput {
  /** 窗口内消息（时间正序；projector 输出——与 webview 渲染同一来源）。 */
  messages: readonly ConversationMessage[]
  /** 投影停点 seq（未排序也可）。 */
  stops: readonly number[]
  /** 全量轮大纲（含窗口外的轮）；未排序也可。 */
  outline: readonly RailOutlinePiece[]
}

const seqOfMessage = (message: ConversationMessage): number | undefined =>
  typeof message.seq === 'number' && Number.isFinite(message.seq) ? message.seq : undefined

const idOfMessage = (message: ConversationMessage): string | null =>
  typeof message.id === 'string' && message.id !== '' ? message.id : null

/* 卡片判定（与 webview reorderWorkSegments 的回溯谓词同义）：提问留痕卡 = text 'ask_user_question'
   （renderTool 分支）；审批决定卡 = role 'decision'（renderDecision 分支）。 */
const isCardMessage = (message: ConversationMessage): boolean =>
  message.role === 'decision' || message.text === 'ask_user_question'

interface SegmentDraft {
  /** 段首消息下标；null = 停点段/页首前导段（startEl 取 nodes[0] / 回溯卡片）。 */
  startIndex: number | null
  /** 段内**首个被计入的**元素下标（= webview segment.nodes[0]）。 */
  firstIndex: number
  /** 该段实际收进的第一个元素下标（回溯下界用；段为空则 undefined）。 */
  nodes0Index?: number
}

/* 段循环：镜像 applyWorkSegmentFold 的边界判定（停点消费/一次性边界/页首前导段）。 */
function segmentDrafts(messages: readonly ConversationMessage[], stops: readonly number[]): SegmentDraft[] {
  const sortedStops = stops.filter(value => typeof value === 'number' && Number.isFinite(value)).slice().sort((a, b) => a - b)
  const drafts: SegmentDraft[] = []
  let stopCursor = 0
  let boundaryPending = false
  let open: SegmentDraft | undefined
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]
    if (message === undefined) continue
    const seq = seqOfMessage(message)
    if (seq !== undefined) {
      let consumed = false
      while (stopCursor < sortedStops.length && (sortedStops[stopCursor] ?? Infinity) < seq) {
        stopCursor += 1
        consumed = true
      }
      if (consumed) boundaryPending = true
    }
    if (message.role === 'user') {
      boundaryPending = false
      open = { startIndex: i, firstIndex: i }
      drafts.push(open)
      continue
    }
    if (open === undefined || boundaryPending) {
      boundaryPending = false
      open = { startIndex: null, firstIndex: i }
      drafts.push(open)
    }
    if (open !== undefined && open.nodes0Index === undefined) open.nodes0Index = i
  }
  return drafts
}

/* 段锚点（镜像 reorderWorkSegments 的 startEl 解析 + 有界回溯）：
   user 开段 → 段首消息；停点段/前导段 → 从段首元素向前找最近的卡片（≤12 跳；下界 = 上一段 nodes[0]——
   DOM 侧"折叠条不是内容"由"段循环前已移除折叠条"保证，此处消息序列天然无折叠条）。 */
function anchorIndexFor(drafts: readonly SegmentDraft[], messages: readonly ConversationMessage[], draftIndex: number): number {
  const draft = drafts[draftIndex]
  if (draft === undefined) return -1
  if (draft.startIndex !== null) return draft.startIndex
  const previous = drafts[draftIndex - 1]
  const floorIndex = previous === undefined
    ? undefined
    : (previous.startIndex === null ? previous.firstIndex : previous.nodes0Index)
  let hop = 0
  for (let i = draft.firstIndex - 1; i >= 0 && hop < 12; i -= 1, hop += 1) {
    const candidate = messages[i]
    if (candidate === undefined) break
    if (isCardMessage(candidate)) return i
    if (floorIndex !== undefined && i === floorIndex) break
  }
  return draft.firstIndex
}

/* 段锚点的 seq（镜像 seqOfElement：锚点元素无 data-seq 时退段首节点）：
   卡片消息若带 seq 用卡片 seq；否则用段首（nodes[0] 或 startIndex）消息的 seq。 */
function anchorSeqFor(messages: readonly ConversationMessage[], anchorIndex: number, draft: SegmentDraft): number | undefined {
  const anchor = messages[anchorIndex]
  const anchorSeq = anchor === undefined ? undefined : seqOfMessage(anchor)
  if (anchorSeq !== undefined) return anchorSeq
  const fallbackIndex = draft.startIndex !== null ? draft.startIndex : draft.firstIndex
  const fallback = messages[fallbackIndex]
  return fallback === undefined ? undefined : seqOfMessage(fallback)
}

/* 段表（含前缀）：节点顺序 = 前缀（轮粒度）在前 + 段节点在后（与 railTurnsOf 返回序一致）。 */
export function buildSegmentTable(input: RailNodeInput): RailNodeEntry[] {
  const { messages } = input
  const entries: RailNodeEntry[] = []
  const outline = input.outline.slice().sort((a, b) => a.seq - b.seq)

  /* 前缀（railTurnsOf 段分支 W2161-2202 的镜像）。 */
  let firstSeq: number | undefined
  for (const message of messages) {
    const seq = seqOfMessage(message)
    if (seq !== undefined) { firstSeq = seq; break }
  }
  if (firstSeq !== undefined) {
    const loadedUserSeqs: number[] = []
    for (const message of messages) {
      if (message.role !== 'user') continue
      const seq = seqOfMessage(message)
      if (seq !== undefined) loadedUserSeqs.push(seq)
    }
    loadedUserSeqs.sort((a, b) => a - b)
    let userCursor = 0
    for (let i = 0; i < outline.length; i += 1) {
      const entry = outline[i]
      if (entry === undefined) continue
      if (entry.seq >= firstSeq) break
      if (entry.prompt.trim() === '') continue
      const endSeq = outline[i + 1]?.seq
      while (userCursor < loadedUserSeqs.length && loadedUserSeqs[userCursor]! < entry.seq) userCursor += 1
      const userSeq = loadedUserSeqs[userCursor]
      if (userSeq !== undefined && userSeq >= entry.seq && (endSeq === undefined || userSeq < endSeq)) continue
      entries.push({ seq: entry.seq, mid: null, key: 's' + String(entry.seq), ...(endSeq === undefined ? {} : { endSeq }) })
    }
  }

  /* 段节点。 */
  const stops = new Set(input.stops)
  const drafts = segmentDrafts(messages, input.stops)
  for (let i = 0; i < drafts.length; i += 1) {
    const draft = drafts[i]
    if (draft === undefined) continue
    const anchorIndex = anchorIndexFor(drafts, messages, i)
    const seq = anchorSeqFor(messages, anchorIndex, draft)
    if (seq === undefined) continue   /* 无 seq 的段无法与 railDropped/编号对账——不产出（与 webview "无 seq 不标"一致）。 */
    const anchor = messages[anchorIndex]
    entries.push({ seq, mid: anchor === undefined ? null : idOfMessage(anchor), key: 's' + String(seq), ...(anchor !== undefined && isCardMessage(anchor) && stops.has(seq) ? { stop: true as const } : {}) })
  }
  return entries
}

/* 轮表：全量大纲逐轮 —— mid 仅当该轮**在窗口内**（seq ≥ 窗口首 seq）时解析为窗口内
   [turnSeq, nextTurnSeq) 的首条带 seq 消息；窗口外的轮 mid=null（跳转回退行跳）。 */
export function buildTurnTable(input: RailNodeInput): RailNodeEntry[] {
  const { messages } = input
  const outline = input.outline.slice().filter(item => typeof item.seq === 'number' && Number.isFinite(item.seq)).sort((a, b) => a.seq - b.seq)
  let firstSeq: number | undefined
  for (const message of messages) {
    const seq = seqOfMessage(message)
    if (seq !== undefined) { firstSeq = seq; break }
  }
  const windowMessages: Array<{ seq: number; id: string | null }> = []
  for (const message of messages) {
    const seq = seqOfMessage(message)
    if (seq !== undefined) windowMessages.push({ seq, id: idOfMessage(message) })
  }
  windowMessages.sort((a, b) => a.seq - b.seq)
  const entries: RailNodeEntry[] = []
  let messageCursor = 0
  for (let i = 0; i < outline.length; i += 1) {
    const turn = outline[i]
    if (turn === undefined) continue
    const nextSeq = outline[i + 1]?.seq
    let mid: string | null = null
    if (firstSeq !== undefined && turn.seq >= firstSeq) {
      // Both lists are sorted. Leave a candidate at the right boundary for the next turn;
      // duplicate turn starts have an empty interval and must not consume that candidate.
      while (messageCursor < windowMessages.length && windowMessages[messageCursor]!.seq < turn.seq) messageCursor += 1
      const found = windowMessages[messageCursor]
      if (found !== undefined && (nextSeq === undefined || found.seq < nextSeq)) mid = found.id
    }
    entries.push({ seq: turn.seq, mid, key: 's' + String(turn.seq) })
  }
  return entries
}

export function buildRailNodeTables(input: RailNodeInput): RailNodeTables {
  return { segment: buildSegmentTable(input), turn: buildTurnTable(input) }
}

/* 0.1.123（G55 Phase 3）：大纲派生——他会话拿不到运行时 turnOutline（0.1.5 起投影基线随 follow 快照，
   只对活动会话可得），改由**事件流同源派生**：turn/start 的 seq = 轮起点；轮的 prompt = 该轮内
   **首条非合成 user 消息**的正文（无则空串——与运行时"goal 自动续轮 / 插件注入轮 prompt 为空"同判）。
   合成判定：'Time sampled while preparing…'（时间采样）与 '<system-reminder>'（IDE/工作区上下文注入）。
   保真验证：扩展侧对"在线可得的运行时 outline"做计数/首差自检留痕（outline drift），A/B 探针另对账。 */
export const isSyntheticPromptText = (text: string): boolean => {
  const flat = text.trim()
  return flat.startsWith('Time sampled while preparing') || flat.startsWith('<system-reminder>')
}

export function deriveOutlinePieces(
  turnStarts: readonly number[],
  messages: readonly ConversationMessage[],
): RailOutlinePiece[] {
  const starts = turnStarts.filter(seq => typeof seq === 'number' && Number.isFinite(seq)).slice().sort((a, b) => a - b)
  const users = messages
    .filter(message => message.role === 'user')
    .map(message => ({ seq: seqOfMessage(message), text: typeof message.text === 'string' ? message.text.trim() : '' }))
    .filter((item): item is { seq: number; text: string } => item.seq !== undefined && item.text !== '' && !isSyntheticPromptText(item.text))
    .sort((a, b) => a.seq - b.seq)
  let userCursor = 0
  return starts.map((start, i) => {
    const end = starts[i + 1]
    while (userCursor < users.length && users[userCursor]!.seq < start) userCursor += 1
    const first = users[userCursor]
    return { seq: start, prompt: first !== undefined && (end === undefined || first.seq < end) ? first.text : '' }
  })
}
