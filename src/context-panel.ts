import { isIdeContextEnvelope, withoutIdeContext } from './ide-context.js'

export interface ContextComposition {
  system: number
  tools: number
  user: number
  inject: number
  skill: number
  assistant: number
  tool: number
  total: number
}

export interface ContextRequestStep {
  turn: number
  step: number
  time: number
  system: number
  tools: number
  user: number
  inject: number
  skill: number
  assistant: number
  tool: number
  total: number
  prompt?: number
  cacheRead?: number
  output?: number
}

export type ContextEventKind = 'inject' | 'compaction' | 'prune' | 'model' | 'mode'

export interface ContextEventItem {
  seq: number
  time: number
  kind: ContextEventKind
  tokens: number
  turn?: number
  step?: number
  fromTurn?: number
  fromStep?: number
  form?: string
  name?: string
  sub?: string
  detail?: string
  from?: string
  to?: string
  count?: number
}

export interface ContextCounts {
  injects: number
  compactions: number
  prunes: number
  switches: number
  modes: number
}

/* 0.0.130：dsh-context v0.9 增 skill 类目（技能注入）——补进类型与解析，否则该类条目被静默丢弃。 */
export type ContextItemCat = 'user' | 'inject' | 'skill' | 'assistant' | 'tool'

/* C3 v1.1：组成明细条目（轻量元数据；全文按需另取——contextDetailOf）。 */
export interface ContextDetailItem {
  seq: number
  time: number
  cat: ContextItemCat
  tokens: number
  form?: string
  tool?: string
  name?: string
  skill?: string
  err?: boolean
  calls?: string[]
  imgs?: number
  preview?: string
}

export interface ContextToolItem {
  name: string
  tokens: number
}

export interface ContextItemsCount {
  user: number
  inject: number
  skill: number
  assistant: number
  tool: number
}

export interface ContextPanelState {
  available: boolean
  model?: string
  provider?: string
  contextWindow?: number
  current?: ContextComposition
  images: number
  toolCalls: number
  counts: ContextCounts
  events: ContextEventItem[]
  /* 压缩/剪枝专用回溯窗（比 events 尾窗长）：趋势图 ✂ 标记用——
     注入事件高频，可能把 60 步内的压缩挤出 events 尾 12 条。 */
  cuts: ContextEventItem[]
  requests: ContextRequestStep[]
  /* ---- C3 v1.1：组成明细（当前窗口） ---- */
  systemPreview?: string
  tools: ContextToolItem[]
  items: ContextDetailItem[]
  itemsCount: ContextItemsCount
  itemsTruncated: boolean
  droppedNodes: number
}

/* 保留上限：仅影响发往 webview 的派生载荷体积（投影原文上限 400 事件 / 1500 步） */
export const CONTEXT_EVENTS_LIMIT = 12
export const CONTEXT_CUTS_LIMIT = 24
export const CONTEXT_REQUESTS_LIMIT = 60
/* v1.1 明细：每类只带最近 N 条（真实条数在 itemsCount），预览截断字符数 */
export const CONTEXT_ITEMS_PER_CAT_LIMIT = 50
export const CONTEXT_PREVIEW_CHARS = 60

const EVENT_KINDS: readonly ContextEventKind[] = ['inject', 'compaction', 'prune', 'model', 'mode']

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/* 压缩/剪枝事件的 tokens 是净回收量（负值）——不能用非负校验。 */
function signedNumberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

export function unavailableContextPanelState(): ContextPanelState {
  return {
    available: false,
    images: 0,
    toolCalls: 0,
    counts: { injects: 0, compactions: 0, prunes: 0, switches: 0, modes: 0 },
    events: [],
    cuts: [],
    requests: [],
    tools: [],
    items: [],
    itemsCount: { user: 0, inject: 0, skill: 0, assistant: 0, tool: 0 },
    itemsTruncated: false,
    droppedNodes: 0,
  }
}

function compositionOf(value: unknown): ContextComposition | undefined {
  const record = recordOf(value)
  if (record === undefined) return undefined
  const system = numberOf(record.system)
  const tools = numberOf(record.tools)
  const user = numberOf(record.user)
  const inject = numberOf(record.inject)
  const skill = numberOf(record.skill) ?? 0
  const assistant = numberOf(record.assistant)
  const tool = numberOf(record.tool)
  if (system === undefined || tools === undefined || user === undefined
    || inject === undefined || assistant === undefined || tool === undefined) {
    return undefined
  }
  const total = numberOf(record.total) ?? system + tools + user + inject + skill + assistant + tool
  return { system, tools, user, inject, skill, assistant, tool, total }
}

function requestOf(value: unknown): ContextRequestStep | undefined {
  const record = recordOf(value)
  if (record === undefined) return undefined
  const turn = numberOf(record.turn)
  const step = numberOf(record.step)
  const total = numberOf(record.total)
  if (turn === undefined || step === undefined || total === undefined) return undefined
  const prompt = numberOf(record.prompt)
  const cacheRead = numberOf(record.cacheRead)
  const output = numberOf(record.output)
  return {
    turn,
    step,
    time: numberOf(record.time) ?? 0,
    system: numberOf(record.system) ?? 0,
    tools: numberOf(record.tools) ?? 0,
    user: numberOf(record.user) ?? 0,
    inject: numberOf(record.inject) ?? 0,
    skill: numberOf(record.skill) ?? 0,
    assistant: numberOf(record.assistant) ?? 0,
    tool: numberOf(record.tool) ?? 0,
    total,
    ...(prompt === undefined ? {} : { prompt }),
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(output === undefined ? {} : { output }),
  }
}

function eventOf(value: unknown): ContextEventItem | undefined {
  const record = recordOf(value)
  if (record === undefined) return undefined
  const kind = stringOf(record.kind) as ContextEventKind | undefined
  if (kind === undefined || !EVENT_KINDS.includes(kind)) return undefined
  const turn = numberOf(record.turn)
  const step = numberOf(record.step)
  const fromTurn = numberOf(record.fromTurn)
  const fromStep = numberOf(record.fromStep)
  const form = stringOf(record.form)
  const name = stringOf(record.name)
  const sub = stringOf(record.sub)
  const detail = stringOf(record.detail)
  const from = stringOf(record.from)
  const to = stringOf(record.to)
  const count = numberOf(record.count)
  return {
    seq: numberOf(record.seq) ?? 0,
    time: numberOf(record.time) ?? 0,
    kind,
    tokens: signedNumberOf(record.tokens) ?? 0,
    ...(turn === undefined ? {} : { turn }),
    ...(step === undefined ? {} : { step }),
    ...(fromTurn === undefined ? {} : { fromTurn }),
    ...(fromStep === undefined ? {} : { fromStep }),
    ...(form === undefined ? {} : { form }),
    ...(name === undefined ? {} : { name }),
    ...(sub === undefined ? {} : { sub }),
    ...(detail === undefined ? {} : { detail }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(count === undefined ? {} : { count }),
  }
}

const ITEM_CATS: readonly ContextItemCat[] = ['user', 'inject', 'skill', 'assistant', 'tool']

function previewOf(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  let candidate = text
  if (isIdeContextEnvelope(candidate)) {
    const stripped = withoutIdeContext(candidate)
    // 壳被插件 80 字符裁剪过（去不完整）→ 无有效正文，留给图片/空态标签兜底
    if (stripped === candidate) return undefined
    candidate = stripped
  }
  const collapsed = candidate.replace(/\s+/g, ' ').trim().slice(0, CONTEXT_PREVIEW_CHARS)
  return collapsed === '' ? undefined : collapsed
}

function itemOf(value: unknown): ContextDetailItem | undefined {
  const record = recordOf(value)
  if (record === undefined) return undefined
  const cat = stringOf(record.cat) as ContextItemCat | undefined
  if (cat === undefined || !ITEM_CATS.includes(cat)) return undefined
  const form = stringOf(record.form)
  const tool = stringOf(record.tool)
  const name = stringOf(record.name)
  const skill = stringOf(record.skill)
  const preview = previewOf(stringOf(record.text))
  const imgs = numberOf(record.imgs)
  const calls = Array.isArray(record.calls)
    ? record.calls.filter((name): name is string => typeof name === 'string' && name !== '').slice(0, 3)
    : []
  return {
    seq: numberOf(record.seq) ?? 0,
    time: numberOf(record.time) ?? 0,
    cat,
    tokens: numberOf(record.tokens) ?? 0,
    ...(form === undefined ? {} : { form }),
    ...(tool === undefined ? {} : { tool }),
    ...(name === undefined ? {} : { name }),
    ...(skill === undefined ? {} : { skill }),
    ...(record.err === true ? { err: true } : {}),
    ...(calls.length === 0 ? {} : { calls }),
    ...(imgs === undefined || imgs === 0 ? {} : { imgs }),
    ...(preview === undefined ? {} : { preview }),
  }
}

function toolItemOf(value: unknown): ContextToolItem | undefined {
  const record = recordOf(value)
  if (record === undefined) return undefined
  const name = stringOf(record.name)
  return name === undefined ? undefined : { name, tokens: numberOf(record.tokens) ?? 0 }
}

/** 最近一代请求头（contextHeaders.headers 的末位；内容字段在 ≥0.40 上游改为按需读，此处只取元数据）。 */
function lastEpochOf(values: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const headers = recordOf(values?.contextHeaders)
  const list = Array.isArray(headers?.headers) ? headers.headers : []
  return recordOf(list[list.length - 1])
}

export type ContextDetailRequest =
  | { kind: 'node'; seq: number }
  | { kind: 'system' }
  | { kind: 'tool'; name: string }

/** webview 请求载荷校验（防御式；非法形状返回 undefined）。 */
export function contextDetailRequestOf(value: unknown): ContextDetailRequest | undefined {
  const record = recordOf(value)
  if (record === undefined) return undefined
  const kind = stringOf(record.kind)
  if (kind === 'system') return { kind: 'system' }
  if (kind === 'node') {
    const seq = numberOf(record.seq)
    return seq === undefined ? undefined : { kind: 'node', seq }
  }
  if (kind === 'tool') {
    const name = stringOf(record.name)
    return name === undefined ? undefined : { kind: 'tool', name }
  }
  return undefined
}

export interface ContextDetailResult {
  ok: boolean
  text?: string
  description?: string
  schema?: unknown
  /* true = 文本来自投影摘要（插件截断 ≤80 字符），非会话日志全文 */
  capped?: boolean
}

/** C3 v1.1：按需取明细内容（当前安装的 dsh-context 0.34 直接读投影原文；
    上游 ≥0.40/0.44 载荷瘦身后，本函数是唯一需要改为"按需读"的接缝）。 */
export function contextDetailOf(
  values: Record<string, unknown> | undefined,
  request: ContextDetailRequest,
): ContextDetailResult {
  if (request.kind === 'node') {
    const timeline = recordOf(values?.contextTimeline)
    const nodes = Array.isArray(timeline?.nodes) ? timeline.nodes : []
    for (const raw of nodes) {
      const record = recordOf(raw)
      if (record === undefined || numberOf(record.seq) !== request.seq) continue
      const text = stringOf(record.text)
      return text === undefined ? { ok: false } : { ok: true, text }
    }
    return { ok: false }
  }
  const last = lastEpochOf(values)
  if (last === undefined) return { ok: false }
  if (request.kind === 'system') {
    const system = stringOf(last.system)
    return system === undefined ? { ok: false } : { ok: true, text: system }
  }
  const tools = Array.isArray(last.tools) ? last.tools : []
  for (const raw of tools) {
    const record = recordOf(raw)
    if (record === undefined || stringOf(record.name) !== request.name) continue
    const description = stringOf(record.description)
    return {
      ok: true,
      ...(description === undefined ? {} : { description }),
      ...(record.schema === undefined ? {} : { schema: record.schema }),
    }
  }
  return { ok: false }
}

/** Derives the compact context-panel state from the session projection values.
    `contextTimeline` is supplied by the third-party dsh-context plugin; every
    field is treated as untrusted input and the whole state degrades to
    `available: false` when the projection is absent or malformed. */
export function contextPanelStateOf(values: Record<string, unknown> | undefined): ContextPanelState {
  const timeline = recordOf(values?.contextTimeline)
  if (timeline === undefined || timeline.ok !== true) return unavailableContextPanelState()
  const model = stringOf(timeline.model)
  const provider = stringOf(timeline.provider)
  const contextWindow = numberOf(timeline.contextWindow)
  const current = compositionOf(timeline.current)
  const counts: ContextCounts = { injects: 0, compactions: 0, prunes: 0, switches: 0, modes: 0 }
  const events: ContextEventItem[] = []
  const cuts: ContextEventItem[] = []
  if (Array.isArray(timeline.events)) {
    for (const raw of timeline.events) {
      const event = eventOf(raw)
      if (event === undefined) continue
      events.push(event)
      if (event.kind === 'inject') counts.injects += 1
      else if (event.kind === 'compaction') { counts.compactions += 1; cuts.push(event) }
      else if (event.kind === 'prune') { counts.prunes += 1; cuts.push(event) }
      else if (event.kind === 'model') counts.switches += 1
      else counts.modes += 1
    }
  }
  const requests: ContextRequestStep[] = []
  if (Array.isArray(timeline.requests)) {
    for (const raw of timeline.requests) {
      const request = requestOf(raw)
      if (request !== undefined) requests.push(request)
    }
  }
  /* v1.1 明细：条目（当前窗口 nodes）+ 工具定义元数据 + 系统提示词预览（headers 末代） */
  const itemsCount: ContextItemsCount = { user: 0, inject: 0, skill: 0, assistant: 0, tool: 0 }
  const byCat: Record<ContextItemCat, ContextDetailItem[]> = { user: [], inject: [], skill: [], assistant: [], tool: [] }
  if (Array.isArray(timeline.nodes)) {
    for (const raw of timeline.nodes) {
      const item = itemOf(raw)
      if (item === undefined) continue
      itemsCount[item.cat] += 1
      byCat[item.cat].push(item)
    }
  }
  const items: ContextDetailItem[] = []
  let itemsTruncated = false
  for (const cat of ITEM_CATS) {
    const list = byCat[cat]
    if (list.length > CONTEXT_ITEMS_PER_CAT_LIMIT) itemsTruncated = true
    items.push(...list.slice(-CONTEXT_ITEMS_PER_CAT_LIMIT))
  }
  const tools: ContextToolItem[] = []
  const lastEpoch = lastEpochOf(values)
  if (lastEpoch !== undefined && Array.isArray(lastEpoch.tools)) {
    for (const raw of lastEpoch.tools) {
      const tool = toolItemOf(raw)
      if (tool !== undefined) tools.push(tool)
    }
  }
  const systemPreview = previewOf(lastEpoch === undefined ? undefined : stringOf(lastEpoch.system))
  return {
    available: true,
    ...(model === undefined ? {} : { model }),
    ...(provider === undefined ? {} : { provider }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(current === undefined ? {} : { current }),
    images: numberOf(timeline.images) ?? 0,
    toolCalls: numberOf(timeline.toolCalls) ?? 0,
    counts,
    events: events.slice(-CONTEXT_EVENTS_LIMIT),
    cuts: cuts.slice(-CONTEXT_CUTS_LIMIT),
    requests: requests.slice(-CONTEXT_REQUESTS_LIMIT),
    ...(systemPreview === undefined ? {} : { systemPreview }),
    tools,
    items,
    itemsCount,
    itemsTruncated,
    droppedNodes: numberOf(timeline.droppedNodes) ?? 0,
  }
}
