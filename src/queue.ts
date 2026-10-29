import { withoutIdeContext } from './ide-context.js'

export interface QueueItemState {
  id: string
  placement: 'queued' | 'steering'
  preview: string
  text: string | null
  /* 0.0.59：发送方 rpcId（source.kind === 'user' 时）。stop 时以此判断"消息是否仍在队列"——
     仍在 = 运行时尚未消费它（下一回合会发送），**不得**还回草稿（否则队列+草稿出现双份）。 */
  rpcId?: string
}

export interface QueueSnapshot {
  items: QueueItemState[]
  rawText: Map<string, string>
}

interface UnknownRecord {
  [key: string]: unknown
}

const PREVIEW_CHARS = 200

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as UnknownRecord : undefined
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const characters = Array.from(flat)
  return characters.length > PREVIEW_CHARS ? `${characters.slice(0, PREVIEW_CHARS).join('')}…` : flat
}

/** RC4 inbox lanes contain UserMessages; plugin context must never become an editable user draft. */
export function queueRowsFromInbox(value: unknown): unknown[] {
  const inbox = record(value)
  return (['next-turn', 'next-step'] as const).flatMap(lane => {
    const messages = inbox?.[lane]
    if (!Array.isArray(messages)) return []
    return messages.flatMap(message => {
      const item = record(message)
      if (typeof item?.id !== 'string' || record(item.source)?.kind !== 'user') return []
      return [{ id: item.id, placement: lane === 'next-turn' ? 'queued' : 'steering', message: item }]
    })
  })
}

/** Projects the normalized inbox rows without exposing extension-owned IDE context. */
export function queueSnapshotOf(value: unknown): QueueSnapshot {
  const rawText = new Map<string, string>()
  if (!Array.isArray(value)) return { items: [], rawText }
  const items = value.flatMap((candidate): QueueItemState[] => {
    const item = record(candidate)
    const message = record(item?.message)
    if (
      typeof item?.id !== 'string'
      || (item.placement !== 'queued' && item.placement !== 'steering')
      || !Array.isArray(message?.content)
    ) return []

    const content = message.content.map(record)
    const allText = content.every(part => typeof part?.text === 'string' && part.type === 'text')
    const joined = allText ? content.map(part => String(part?.text ?? '')).join('') : undefined
    if (joined !== undefined) rawText.set(item.id, joined)
    const visible = joined === undefined
      ? content.map(part => part?.type === 'text' && typeof part.text === 'string'
        ? withoutIdeContext(part.text)
        : `[${typeof part?.type === 'string' ? part.type : 'attachment'}]`).join(' ')
      : withoutIdeContext(joined)
    const source = record(message.source)
    const rpcId = source?.kind === 'user' && typeof source.rpcId === 'string' && source.rpcId !== '' ? source.rpcId : undefined
    return [{
      id: item.id,
      placement: item.placement,
      preview: preview(visible),
      text: joined === undefined ? null : visible,
      ...(rpcId === undefined ? {} : { rpcId }),
    }]
  })
  return { items, rawText }
}
