import {
  assistantStreamAppend,
  type ConversationImage,
  type ConversationMessage,
  type ConversationMessageFile,
  type MessageMeta,
} from './conversation.js'

export const WEBVIEW_INLINE_CHAR_LIMIT = 20_000

export interface ConversationMessagesPatch {
  reset?: ConversationMessage[]
  prepends?: ConversationMessage[]
  upserts?: ConversationMessage[]
  appends?: ConversationMessageAppend[]
}

export interface ConversationMessageAppend {
  id: string
  text: string
  streaming: boolean
  /* 结算帧可顺带 meta/time；字段移除或身份变化则整条 upsert，避免旧值残留。 */
  meta?: MessageMeta
  time?: number
}

function compactToolView(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const compact: Record<string, unknown> = {}
  if (typeof source.card === 'string') compact.card = source.card
  if (typeof source.title === 'string') compact.title = source.title
  return Object.keys(compact).length === 0 ? undefined : compact
}

function bodyRevision(message: ConversationMessage): string {
  const images = (message.images ?? []).map(image => `${image.attachmentId}:${image.data?.length ?? 0}:${image.error ?? ''}`).join('|')
  return `${message.streaming === true ? 'streaming' : 'settled'}:${message.text.length}:${message.rawInput?.length ?? 0}:${message.rawResult?.length ?? 0}:${images}`
}

/** Keeps large or structured message bodies lightweight until they are displayed. */
export function messageForWebview(message: ConversationMessage): ConversationMessage {
  if (message.deferredBody === true) return message
  const hasToolBody = message.role === 'tool' && (message.callView !== undefined
    || message.resultView !== undefined
    || message.rawInput !== undefined
    || message.rawResult !== undefined
    || (message.images?.length ?? 0) > 0)
  const hasLargeCommandBody = message.role === 'command' && (message.rawResult?.length ?? 0) > WEBVIEW_INLINE_CHAR_LIMIT
  // Only text length defers an assistant body: deferring on hydrated images
  // alone would blank an already-visible short answer behind a load button.
  const hasLargeAssistantBody = message.role === 'assistant'
    && message.streaming !== true
    && message.text.length > WEBVIEW_INLINE_CHAR_LIMIT
  if (!hasToolBody && !hasLargeCommandBody && !hasLargeAssistantBody) return message
  /* 0.0.140（真机缺陷：提问留痕卡从未渲染）：交互式提问的载荷本来就小（几百字符），
     但它决定留痕卡能否渲染（webview 端 parseAskRecord 只认 rawInput/rawResult）——
     被瘦身丢弃后卡片退化回普通工具卡、"我选了什么"看不见、轨道停点节点也锚不到它。
     小于阈值就整条原样传。 */
  if (message.role === 'tool' && message.text === 'ask_user_question'
    && (message.rawInput?.length ?? 0) + (message.rawResult?.length ?? 0) <= WEBVIEW_INLINE_CHAR_LIMIT) {
    return message
  }
  const callView = compactToolView(message.callView)
  const resultView = compactToolView(message.resultView)
  return {
    id: message.id,
    role: message.role,
    text: hasLargeAssistantBody ? '' : message.text,
    ...(message.streaming === undefined ? {} : { streaming: message.streaming }),
    ...(message.detail === undefined ? {} : { detail: message.detail }),
    ...(message.failed === undefined ? {} : { failed: message.failed }),
    ...(callView === undefined ? {} : { callView }),
    ...(resultView === undefined ? {} : { resultView }),
    /* 0.0.140：seq/time 是小字段但影响行为——seq 是工作段停点切段与轨道穿透定位的锚
       （此前瘦身后工具卡元素没有 data-seq），time 供卡头时钟。 */
    ...(message.seq === undefined ? {} : { seq: message.seq }),
    ...(message.time === undefined ? {} : { time: message.time }),
    deferredBody: true,
    deferredBodyRevision: bodyRevision(message),
    ...(message.role === 'assistant'
      ? { bodyLength: message.text.length }
      : message.rawResult === undefined ? {} : { bodyLength: message.rawResult.length }),
  }
}

export function messagesPatchForWebview(patch: ConversationMessagesPatch): ConversationMessagesPatch {
  return {
    ...(patch.reset === undefined ? {} : { reset: patch.reset.map(messageForWebview) }),
    ...(patch.prepends === undefined ? {} : { prepends: patch.prepends.map(messageForWebview) }),
    ...(patch.upserts === undefined ? {} : { upserts: patch.upserts.map(messageForWebview) }),
    ...(patch.appends === undefined ? {} : { appends: patch.appends }),
  }
}

function sameImage(left: ConversationImage, right: ConversationImage): boolean {
  return left.attachmentId === right.attachmentId
    && left.mediaType === right.mediaType
    && left.width === right.width
    && left.height === right.height
    && left.name === right.name
    && left.data === right.data
    && left.error === right.error
}

function sameImages(left: readonly ConversationImage[] | undefined, right: readonly ConversationImage[] | undefined): boolean {
  if (left === right) return true
  if (left === undefined || right === undefined || left.length !== right.length) return false
  return left.every((image, index) => {
    const candidate = right[index]
    return candidate !== undefined && sameImage(image, candidate)
  })
}

function sameFile(left: ConversationMessageFile, right: ConversationMessageFile): boolean {
  return left.name === right.name
    && left.path === right.path
    && left.mime === right.mime
    && left.size === right.size
    && left.origin === right.origin
    && left.status === right.status
}

function sameFiles(
  left: readonly ConversationMessageFile[] | undefined,
  right: readonly ConversationMessageFile[] | undefined,
): boolean {
  if (left === right) return true
  if (left === undefined || right === undefined || left.length !== right.length) return false
  return left.every((file, index) => {
    const candidate = right[index]
    return candidate !== undefined && sameFile(file, candidate)
  })
}

function sameMeta(left: MessageMeta | undefined, right: MessageMeta | undefined): boolean {
  return left === right || (left !== undefined && right !== undefined
    && left.durationMs === right.durationMs
    && left.firstTokenMs === right.firstTokenMs
    && left.tokS === right.tokS)
}

function sameMessage(left: ConversationMessage, right: ConversationMessage): boolean {
  return left.id === right.id
    && left.role === right.role
    && left.text === right.text
    && left.seq === right.seq
    && left.time === right.time
    && sameMeta(left.meta, right.meta)
    && left.detail === right.detail
    && left.streaming === right.streaming
    && left.failed === right.failed
    && left.callView === right.callView
    && left.resultView === right.resultView
    && left.rawInput === right.rawInput
    && left.rawResult === right.rawResult
    && left.deferredBody === right.deferredBody
    && left.deferredBodyRevision === right.deferredBodyRevision
    && left.bodyLength === right.bodyLength
    && sameImages(left.images, right.images)
    && sameFiles(left.files, right.files)
}

function appendedAssistantText(left: ConversationMessage, right: ConversationMessage): string | undefined {
  const compatible = left.id === right.id
    && left.role === 'assistant'
    && right.role === 'assistant'
    && left.streaming === true
    && left.seq === right.seq
    && (right.meta !== undefined || left.meta === undefined)
    && (right.time !== undefined || left.time === undefined)
    && left.detail === right.detail
    && left.failed === right.failed
    && left.callView === right.callView
    && left.resultView === right.resultView
    && left.rawInput === right.rawInput
    && left.rawResult === right.rawResult
    && left.deferredBody === right.deferredBody
    && sameImages(left.images, right.images)
    && sameFiles(left.files, right.files)
  if (!compatible) return undefined
  const projected = assistantStreamAppend(left, right)
  if (projected !== undefined) return projected
  return right.text.startsWith(left.text) ? right.text.slice(left.text.length) : undefined
}

/**
 * Keeps existing bodies in the webview when older history is prepended.
 * Removal, insertion within the loaded window, and reordering require a reset.
 */
export function diffConversationMessages(
  previous: readonly ConversationMessage[],
  next: readonly ConversationMessage[],
): ConversationMessagesPatch | undefined {
  let offset = 0
  if (previous.length > 0 && previous[0]?.id !== next[0]?.id) {
    offset = next.findIndex(message => message.id === previous[0]?.id)
    if (offset <= 0 || offset + previous.length !== next.length) return { reset: [...next] }
    const ids = new Set(previous.map(message => message.id))
    for (const message of next.slice(0, offset)) {
      if (ids.has(message.id)) return { reset: [...next] }
      ids.add(message.id)
    }
  }
  const sharedLength = Math.min(previous.length, next.length - offset)
  for (let index = 0; index < sharedLength; index += 1) {
    if (previous[index]?.id !== next[index + offset]?.id) return { reset: [...next] }
  }
  if (next.length < previous.length) return { reset: [...next] }

  const upserts: ConversationMessage[] = []
  const appends: ConversationMessageAppend[] = []
  for (let index = offset; index < next.length; index += 1) {
    const message = next[index]
    if (message === undefined) continue
    const current = previous[index - offset]
    if (current === undefined) {
      upserts.push(message)
      continue
    }
    if (sameMessage(current, message)) continue
    const appendedText = appendedAssistantText(current, message)
    if (appendedText !== undefined) {
      appends.push({
        id: message.id,
        text: appendedText,
        streaming: message.streaming === true,
        ...(message.meta === undefined ? {} : { meta: message.meta }),
        ...(message.time === undefined ? {} : { time: message.time }),
      })
    } else {
      upserts.push(message)
    }
  }
  return offset === 0 && upserts.length === 0 && appends.length === 0
    ? undefined
    : {
        ...(offset === 0 ? {} : { prepends: next.slice(0, offset) }),
        ...(upserts.length === 0 ? {} : { upserts }),
        ...(appends.length === 0 ? {} : { appends }),
      }
}
