/**
 * 0.0.161（用户需求）：未发送草稿的持久化——Reload 窗口 / 重启 VS Code / 重连运行时后，
 * 按会话恢复 文本 + 图片 + 文件卡（pinned）。判据（2026-09-18 用户确认）：
 * ① 全恢复且各归各会话；② 跨整窗重启同样恢复；③ 成功发出即清（Reload 不复活）；④ 设置台开关（默认开）。
 *
 * 存储形态：<root>/drafts/
 *   index.json            # { version, drafts: { <sessionId>: { text, pinned, images:[{id,name,mediaType,file}], at } } }
 *   <sidHash>/<n>.bin     # 图片原始字节（dataURL 解出的 base64 → Buffer）
 * 会话目录名 = sha1(sessionId)（会话 id 可能含路径不安全字符，不直接入路径）。
 * 已知取舍（v1）：GIF 的逐帧选择集合（frameSelections）不持久化（图片本体在，重开预览可重选）。
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const DRAFT_SESSION_CAP = 32
export const DRAFT_IMAGE_CAP_PER_DRAFT = 12
/* 单会话草稿字节上限（图片合计；文本/pinned 不计）——超出丢大图保小图与文本。 */
export const DRAFT_BYTES_CAP_PER_DRAFT = 24 * 1024 * 1024
export const DRAFT_TEXT_CAP = 100_000

export interface StoredDraftImage {
  id: string
  name: string
  mediaType: string
  /* 相对 <root>/drafts/<sidHash>/ 的文件名。 */
  file: string
}

export interface StoredDraft {
  text: string
  images: StoredDraftImage[]
  pinned: unknown[]
  at: number
}

export interface DraftIndex {
  version: 1
  drafts: Record<string, StoredDraft>
}

export interface SanitizedDraftImage {
  id: string
  name: string
  mediaType: string
  base64: string
}

export interface SanitizedDraft {
  text: string
  images: SanitizedDraftImage[]
}

export function sessionDirName(sessionId: string): string {
  return createHash('sha1').update(sessionId).digest('hex')
}

const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function base64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - padding
}

/* 入站净化（webview 上报的槽位 → 存储形态）：逐字段校验 + 上限护栏。
   images 里 data 为 dataURL；超上限的部分被丢弃（保文本与其余图），不整条拒绝。 */
export function sanitizeDraftPayload(raw: unknown): SanitizedDraft | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const input = raw as Record<string, unknown>
  const text = typeof input.text === 'string' ? input.text.slice(0, DRAFT_TEXT_CAP) : ''
  const images: SanitizedDraftImage[] = []
  let bytes = 0
  if (Array.isArray(input.images)) {
    for (const entry of input.images) {
      if (images.length >= DRAFT_IMAGE_CAP_PER_DRAFT) break
      if (typeof entry !== 'object' || entry === null) continue
      const image = entry as Record<string, unknown>
      if (typeof image.id !== 'string' || image.id === '') continue
      if (typeof image.name !== 'string') continue
      if (typeof image.mediaType !== 'string' || !MEDIA_TYPES.has(image.mediaType)) continue
      if (typeof image.data !== 'string') continue
      const comma = image.data.indexOf(',')
      if (comma < 0 || !image.data.startsWith('data:')) continue
      const base64 = image.data.slice(comma + 1)
      if (base64 === '') continue
      const size = base64Bytes(base64)
      if (bytes + size > DRAFT_BYTES_CAP_PER_DRAFT) continue
      bytes += size
      images.push({ id: image.id, name: image.name, mediaType: image.mediaType, base64 })
    }
  }
  return { text, images }
}

/* 空草稿（无文本无图）不落盘——发出去/清空后自然从存储消失。pinned 单独由调用方并入判定。 */
export function isEmptyDraft(draft: SanitizedDraft): boolean {
  return draft.text.trim() === '' && draft.images.length === 0
}

/* 会话数上限：超出的按 at 最旧淘汰（与内存槽位 32 一致）。 */
export function pruneDrafts(index: DraftIndex, cap = DRAFT_SESSION_CAP): DraftIndex {
  const entries = Object.entries(index.drafts)
  if (entries.length <= cap) return index
  entries.sort((a, b) => (a[1].at || 0) - (b[1].at || 0))
  const drafts: Record<string, StoredDraft> = {}
  for (const [sessionId, draft] of entries.slice(entries.length - cap)) drafts[sessionId] = draft
  return { version: 1, drafts }
}

/* fs 存储门面：root 缺席（无 storageUri）时全部降级为无操作（功能静默关闭，不报错）。 */
export class DraftStore {
  private readonly root: string | undefined

  constructor(storageRoot: string | undefined) {
    this.root = storageRoot === undefined || storageRoot === '' ? undefined : join(storageRoot, 'drafts')
  }

  get enabled(): boolean {
    return this.root !== undefined
  }

  /* 0.0.163（审查 P1-2）：存储根路径（设置台「存储」区展示/打开用）。 */
  get directory(): string | undefined {
    return this.root
  }

  private indexFile(): string | undefined {
    return this.root === undefined ? undefined : join(this.root, 'index.json')
  }

  private sessionDir(sessionId: string): string | undefined {
    return this.root === undefined ? undefined : join(this.root, sessionDirName(sessionId))
  }

  load(): DraftIndex {
    const file = this.indexFile()
    if (file === undefined || !existsSync(file)) return { version: 1, drafts: {} }
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as DraftIndex
      if (typeof parsed !== 'object' || parsed === null || typeof parsed.drafts !== 'object' || parsed.drafts === null) {
        return { version: 1, drafts: {} }
      }
      return { version: 1, drafts: parsed.drafts }
    } catch {
      /* 损坏 → 空索引（下次写入自愈），不拖垮启动。 */
      return { version: 1, drafts: {} }
    }
  }

  private writeIndex(index: DraftIndex): void {
    const file = this.indexFile()
    if (file === undefined) return
    try {
      mkdirSync(this.root as string, { recursive: true })
      writeFileSync(file, JSON.stringify(index))
    } catch {
      /* 写失败静默（磁盘满/权限）——持久化是增强，不阻塞主链路。 */
    }
  }

  /* 分片 upsert：text / images / pinned 各自可选——webview 只在**图片集合变化**时才带 images
     （dataURL 体积大），文本变化走 text-only，pinned 变化由扩展侧单独喂。缺省字段沿用已存值；
     三者皆空 → 视作删除（草稿发出/清空后自然消失）。 */
  upsert(sessionId: string, patch: { text?: string; images?: SanitizedDraftImage[]; pinned?: unknown[] }): void {
    if (this.root === undefined || sessionId === '') return
    try {
      const index = this.load()
      const prev = index.drafts[sessionId]
      const text = patch.text ?? prev?.text ?? ''
      const pinned = patch.pinned ?? prev?.pinned ?? []
      let images = prev?.images ?? []
      if (patch.images !== undefined) {
        const dir = this.sessionDir(sessionId)
        if (dir === undefined) return
        rmSync(dir, { recursive: true, force: true })
        mkdirSync(dir, { recursive: true })
        images = []
        patch.images.forEach((image, position) => {
          const file = `img-${String(position)}.bin`
          writeFileSync(join(dir, file), Buffer.from(image.base64, 'base64'))
          images.push({ id: image.id, name: image.name, mediaType: image.mediaType, file })
        })
      }
      if (text.trim() === '' && images.length === 0 && pinned.length === 0) {
        this.remove(sessionId)
        return
      }
      index.drafts[sessionId] = { text, images, pinned, at: Date.now() }
      this.writeIndex(pruneDrafts(index))
    } catch {
      /* 同上：失败静默。 */
    }
  }

  remove(sessionId: string): void {
    const dir = this.sessionDir(sessionId)
    try {
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
      const index = this.load()
      if (index.drafts[sessionId] !== undefined) {
        delete index.drafts[sessionId]
        this.writeIndex(index)
      }
    } catch {
      /* 静默。 */
    }
  }

  /* 读回（恢复用）：返回 webview 可直接消费的 dataURL 形态；文件缺失的图片被跳过。 */
  restore(sessionId: string): { text: string; images: Array<{ id: string; name: string; mediaType: string; data: string }>; pinned: unknown[] } | undefined {
    const index = this.load()
    const record = index.drafts[sessionId]
    if (record === undefined) return undefined
    const dir = this.sessionDir(sessionId)
    const images: Array<{ id: string; name: string; mediaType: string; data: string }> = []
    for (const image of record.images) {
      if (dir === undefined) break
      const file = join(dir, image.file)
      try {
        if (!existsSync(file)) continue
        const base64 = readFileSync(file).toString('base64')
        images.push({ id: image.id, name: image.name, mediaType: image.mediaType, data: `data:${image.mediaType};base64,${base64}` })
      } catch {
        continue
      }
    }
    return { text: record.text, images, pinned: Array.isArray(record.pinned) ? record.pinned : [] }
  }

  /* 关开关时的清理（用户关掉「保留草稿」→ 已存的草稿不再无声复活）。 */
  purge(): void {
    if (this.root === undefined) return
    try {
      rmSync(this.root, { recursive: true, force: true })
    } catch {
      /* 静默。 */
    }
  }
}
