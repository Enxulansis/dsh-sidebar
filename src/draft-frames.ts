import type { PromptImage } from './dsh-client.js'

/* 0.0.79（GIF②④）：草稿 GIF 的"选帧发送"数据层——
   webview 逐帧解码为 PNG，选中集合随草稿条目走；发送时一帧一张图展开。 */

export const MAX_DRAFT_FRAME_SELECTIONS = 12

export interface DraftFrameSelection {
  index: number
  /* 该帧的 PNG（裸 base64） */
  data: string
}

export type DraftImageEntry = PromptImage & {
  id: string
  /* 转码图（如 SVG→PNG）保留的原字节/原名（G10 复制原格式） */
  originData?: string
  originName?: string
  /* 0.0.79：GIF 选帧集合（多选，一帧一张 PNG 发送） */
  frameSelections?: DraftFrameSelection[]
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** 校验并规范化选帧集合（接受 data URL 或裸 base64；去重按 index 升序；上限 max）。
    G38 批次 2（0.0.96）：上限改由设置 `preview.maxFrameSelections` 驱动（与 webview 拦截同值）；缺省回落常量。 */
export function draftFrameSelectionsOf(raw: unknown, max: number = MAX_DRAFT_FRAME_SELECTIONS): DraftFrameSelection[] {
  if (!Array.isArray(raw)) return []
  const cap = Number.isFinite(max) && max >= 1 ? Math.floor(max) : MAX_DRAFT_FRAME_SELECTIONS
  const byIndex = new Map<number, string>()
  for (const item of raw) {
    const record = recordOf(item)
    if (record === undefined) continue
    const index = typeof record.index === 'number' && Number.isInteger(record.index) && record.index >= 0 ? record.index : undefined
    const rawData = typeof record.data === 'string' ? record.data : ''
    const comma = rawData.indexOf(',')
    const base64 = rawData !== '' && comma >= 0 ? rawData.slice(comma + 1) : rawData
    if (index === undefined || base64 === '') continue
    byIndex.set(index, base64)
  }
  return [...byIndex.entries()]
    .sort((left, right) => left[0] - right[0])
    .slice(0, cap)
    .map(([index, data]) => ({ index, data }))
}

/** 发送展开：有选帧 → 一帧一张 PNG（同一条消息多图）；未选 → 原条目原样（整张 GIF）。 */
export function expandedDraftImages(entries: readonly DraftImageEntry[]): PromptImage[] {
  return entries.flatMap((entry): PromptImage[] => {
    const frames = entry.frameSelections
    if (frames === undefined || frames.length === 0) return [entry]
    return frames.map(frame => ({
      type: 'image' as const,
      mediaType: 'image/png' as const,
      data: frame.data,
      ...(entry.name === undefined ? {} : { name: entry.name }),
    }))
  })
}
