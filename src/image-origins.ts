/**
 * 0.0.58：发送原图留档（落盘）——侧栏显示层优先用原图 +「复制原格式」给真原字节。
 *
 * 背景：运行时会把每张上传图归一化重编码（附件库存归一化副本，侧栏显示的就是它），
 * 用户要求"预览尽量用原图"。原字节改由本模块留档：发送成功且消息被投影时按
 * 「张数 + 文件名」逐位绑定到 attachmentId（见 bindSentOrigins），blob 内容寻址落盘。
 *
 * 纯逻辑模块（不 import vscode），磁盘读写由 extension 注入；测试见 tests/image-origins.spec.ts。
 */
import { createHash } from 'node:crypto'

export interface SentImageLike {
  name?: string
  mediaType: string
  /** 上传字节（base64）；转码图此字段是转码后的 PNG。 */
  data: string
  /** 转码图：转换前的原字节（base64）+ 原名。 */
  originData?: string
  originName?: string
}

export interface ProjectedImageLike {
  attachmentId: string
  mediaType: string
  name?: string
}

export interface OriginEntry {
  /** 原文件字节（base64）。 */
  rawBase64: string
  /** 原文件显示名（复制/另存为命名用）。 */
  label: string
  /** 有值 → 显示层直接用原字节渲染（含 GIF：0.0.77 起放行动图，回显后保持动画）。 */
  displayMediaType?: string
}

/** 显示层可安全直出原字节的媒体类型（浏览器 <img> 原生渲染）。 */
const DISPLAY_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export const MAX_SINGLE_BYTES = 16 * 1024 * 1024
export const MAX_TOTAL_BYTES = 512 * 1024 * 1024

export interface OriginRecord {
  label: string
  displayMediaType?: string
  /** 落盘文件名（内容寻址，同名内容自动去重）。 */
  file: string
  bytes: number
  addedAt: number
  lastUsedAt: number
}

export type OriginManifest = Record<string, OriginRecord>

export const originKey = (sessionId: string, attachmentId: string): string => sessionId + '\u0000' + attachmentId

export const estimateBase64Bytes = (base64: string): number => Math.floor((base64.length * 3) / 4)

/**
 * 发送图 ↔ 投影消息图逐位绑定（0.0.58 核心规则）。
 * 安全优先：张数不等、缺 attachmentId、或两边都有名字但名字不同 → 整体放弃绑定
 * （宁可不显示原图，也不能显示错图）。名字只在"两边都有"时校验——运行时事件可缺名字。
 */
export function bindSentOrigins(
  sent: readonly SentImageLike[],
  projected: readonly ProjectedImageLike[],
  options: { maxSingleBytes?: number } = {},
): Array<{ attachmentId: string; entry: OriginEntry }> | undefined {
  const maxSingleBytes = options.maxSingleBytes ?? MAX_SINGLE_BYTES
  if (sent.length === 0 || sent.length !== projected.length) return undefined
  const bindings: Array<{ attachmentId: string; entry: OriginEntry }> = []
  for (let i = 0; i < sent.length; i += 1) {
    const image = sent[i]
    const target = projected[i]
    if (image === undefined || target === undefined) return undefined
    if (typeof target.attachmentId !== 'string' || target.attachmentId === '') return undefined
    const sentName = image.name ?? ''
    const targetName = target.name ?? ''
    if (sentName !== '' && targetName !== '' && sentName !== targetName) return undefined
    const hasOrigin = typeof image.originData === 'string' && image.originData !== ''
    const rawBase64 = hasOrigin ? image.originData as string : image.data
    if (rawBase64 === '' || estimateBase64Bytes(rawBase64) > maxSingleBytes) return undefined
    const label = hasOrigin ? (image.originName || sentName || 'image') : (sentName || 'image')
    bindings.push({
      attachmentId: target.attachmentId,
      entry: {
        rawBase64,
        label,
        ...(hasOrigin || !DISPLAY_MEDIA_TYPES.has(image.mediaType)
          ? {}
          : { displayMediaType: image.mediaType }),
      },
    })
  }
  return bindings
}

/** 内容寻址文件名：sha256 前 32 位 + 原名扩展名（无扩展名回退 .bin）。 */
export function originFileName(rawBase64: string, label: string): string {
  const hash = createHash('sha256').update(Buffer.from(rawBase64, 'base64')).digest('hex').slice(0, 32)
  const dot = label.lastIndexOf('.')
  const extension = dot > 0 ? label.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : ''
  return hash + (extension === '' ? '.bin' : '.' + extension)
}

/** 超容量时按 lastUsedAt 最旧优先淘汰，返回要删除的 key（够用即停）。
    G42-C（0.0.97）：哨兵 maxTotalBytes = -1 → 不剪枝（显式分支——若直接比较会走进"全删"分支）。 */
export function planPrune(manifest: Readonly<OriginManifest>, maxTotalBytes: number): string[] {
  if (maxTotalBytes < 0) return []
  const entries = Object.entries(manifest)
  let total = entries.reduce((sum, [, record]) => sum + record.bytes, 0)
  if (total <= maxTotalBytes) return []
  const oldestFirst = [...entries].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)
  const drop: string[] = []
  for (const [key, record] of oldestFirst) {
    if (total <= maxTotalBytes) break
    drop.push(key)
    total -= record.bytes
  }
  return drop
}

/** manifest 读回时的净化：丢坏条目（缺字段/负数）。 */
export function sanitizeManifest(raw: unknown): OriginManifest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const manifest: OriginManifest = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue
    const record = value as Record<string, unknown>
    const file = typeof record.file === 'string' ? record.file : ''
    const bytes = typeof record.bytes === 'number' && Number.isFinite(record.bytes) && record.bytes > 0 ? record.bytes : 0
    if (file === '' || bytes === 0) continue
    manifest[key] = {
      label: typeof record.label === 'string' && record.label !== '' ? record.label : 'image',
      file,
      bytes,
      addedAt: typeof record.addedAt === 'number' ? record.addedAt : 0,
      lastUsedAt: typeof record.lastUsedAt === 'number' ? record.lastUsedAt : 0,
      ...(typeof record.displayMediaType === 'string' ? { displayMediaType: record.displayMediaType } : {}),
    }
  }
  return manifest
}
