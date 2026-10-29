/**
 * G22 a3：消息文件卡持久化元数据层（workspaceState 键 `dshMessageFiles`）。
 * 纯逻辑模块，不 import vscode（供 vitest 直测）；extension 负责 vscode/workspaceState 接入。
 * 设计见 `_temp/g22_文件徽标卡调研/2026-09-01_G22_a3设计_文件卡持久化.md`（用户拍板：TTL 30 天 / 宽松策略）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

export type AttachmentOrigin = 'paste-copy' | 'workspace'

export interface AttachedFile {
  name: string
  path: string
  mime: string
  size: number
  origin: AttachmentOrigin
  addedAt: number
}

export interface MessageFiles {
  sessionId: string
  seq?: number
  textTail: string
  files: AttachedFile[]
  addedAt: number
}

export type MessageFilesStore = Record<string, MessageFiles[]>

export const MESSAGE_FILES_CAP = 200
export const DEFAULT_FILE_CARD_RETENTION_DAYS = 30
export const DSH_PASTE_PREFIX = '_temp/.dsh-paste/'
export const TAIL_MAX = 40

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  md: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  yml: 'text/yaml',
  yaml: 'text/yaml',
  html: 'text/html',
  css: 'text/css',
  xml: 'application/xml',
  js: 'text/javascript',
  ts: 'text/typescript',
  py: 'text/x-python',
  log: 'text/plain',
  ini: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

export function retentionMs(retentionDays: number): number {
  /* G42-B（0.0.97）：哨兵 -1 = 永不删除——剪枝比较 `now - base > ttl` 在 Infinity 下恒 false，条目长留。 */
  if (retentionDays === -1) return Number.POSITIVE_INFINITY
  return Math.max(1, Math.floor(retentionDays)) * 24 * 3600 * 1000
}

export function nameOf(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

export function mimeForFileName(name: string): string {
  const extension = (name.split('.').at(-1) || '').toLowerCase()
  return MIME_BY_EXTENSION[extension] ?? ''
}

export function isPasteCopyPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized === DSH_PASTE_PREFIX.slice(0, -1) || normalized.startsWith(DSH_PASTE_PREFIX)
}

export function textTailOf(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= TAIL_MAX ? normalized : normalized.slice(-TAIL_MAX)
}

/** 工作区越界防护：cwd 相对/绝对路径统一解析，越界返回 undefined（同 diff-review projectPath 语义）。 */
export function normalizeWithin(cwd: string, filePath: string): string | undefined {
  if (cwd === '') return undefined
  const resolved = path.resolve(cwd, filePath)
  const relative = path.relative(cwd, resolved)
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined
  return resolved
}

/** 发送时快照：push 新条目（seq 由 acceptFrame 二阶段附着）。写入返回新 store 引用，不就地修改入参。 */
export function storeMessageFiles(
  store: MessageFilesStore,
  sessionId: string,
  seq: number | undefined,
  text: string,
  files: AttachedFile[],
  addedAt: number,
): MessageFilesStore {
  const bucket = (store[sessionId] ?? []).slice()
  bucket.push({
    sessionId,
    ...(seq === undefined ? {} : { seq }),
    textTail: textTailOf(text),
    files: files.slice(),
    addedAt,
  })
  return trimStore({ ...store, [sessionId]: bucket })
}

function trimStore(store: MessageFilesStore): MessageFilesStore {
  let total = 0
  for (const bucket of Object.values(store)) total += bucket.length
  if (total <= MESSAGE_FILES_CAP) return store
  const entries: Array<[string, MessageFiles]> = []
  for (const [sessionId, bucket] of Object.entries(store)) {
    for (const entry of bucket) entries.push([sessionId, entry])
  }
  entries.sort((a, b) => a[1].addedAt - b[1].addedAt)
  const excess = total - MESSAGE_FILES_CAP
  const discarded = new Set<MessageFiles>(entries.slice(0, excess).map(([, entry]) => entry))
  const next: MessageFilesStore = {}
  for (const [sessionId, bucket] of Object.entries(store)) {
    const kept = bucket.filter(entry => !discarded.has(entry))
    if (kept.length > 0) next[sessionId] = kept
  }
  return next
}

/** 二阶段 seq 附着：acceptFrame 收到 user/message 事件后，定位同 tail 的最近未附着条目。返回 true=有变更。 */
export function attachSeq(store: MessageFilesStore, sessionId: string, seq: number, text: string): boolean {
  const bucket = store[sessionId]
  if (bucket === undefined) return false
  const tail = textTailOf(text)
  for (let i = bucket.length - 1; i >= 0; i -= 1) {
    const entry = bucket[i]
    if (entry === undefined || entry.seq !== undefined || entry.textTail !== tail) continue
    entry.seq = seq
    return true
  }
  return false
}

export function lookup(
  store: MessageFilesStore,
  sessionId: string,
  anchor: { seq?: number; textTail?: string },
): MessageFiles | undefined {
  const bucket = store[sessionId]
  if (bucket === undefined) return undefined
  // seq 优先（附着成功即权威）；seq 未命中（历史恢复/被 cap 淘汰）回退 textTail 兜底
  if (anchor.seq !== undefined) {
    for (let i = bucket.length - 1; i >= 0; i -= 1) {
      const entry = bucket[i]
      if (entry?.seq === anchor.seq) return entry
    }
  }
  if (anchor.textTail !== undefined) {
    const tail = textTailOf(anchor.textTail)
    for (let i = bucket.length - 1; i >= 0; i -= 1) {
      const entry = bucket[i]
      if (entry?.textTail === tail) return entry
    }
  }
  return undefined
}

/** 渲染态判定：文件真实存在于磁盘 → active；否则 expired（宽松策略下与过期无关，只认文件存在）。 */
export function attachmentStatus(cwd: string, file: AttachedFile): 'active' | 'expired' {
  const absolute = normalizeWithin(cwd, file.path)
  if (absolute === undefined) return 'expired'
  try {
    return fs.statSync(absolute).isFile() ? 'active' : 'expired'
  } catch {
    return 'expired'
  }
}

export interface PruneResult {
  /** undefined = 无变化（调用方跳过 commit；否则为新 store 引用） */
  store: MessageFilesStore | undefined
  /** 过期 .dsh-paste 副本的相对路径（调用方负责带守卫删除；workspace 引用永不列入） */
  staleCopyPaths: string[]
}

/** 宽松策略 prune：过期 + paste-copy → 列待删并移除条目；过期 + workspace → 保留（文件在即可用）；未过期 → 保留。 */
export function pruneMessageFiles(store: MessageFilesStore, nowMs: number, ttlMs: number): PruneResult {
  let changed = false
  const staleCopyPaths: string[] = []
  const next: MessageFilesStore = {}
  for (const [sessionId, bucket] of Object.entries(store)) {
    const kept: MessageFiles[] = []
    for (const entry of bucket) {
      const keptFiles: AttachedFile[] = []
      for (const file of entry.files) {
        const base = Math.max(file.addedAt || 0, entry.addedAt || 0)
        if (nowMs - base > ttlMs && file.origin === 'paste-copy') {
          staleCopyPaths.push(file.path)
          changed = true
        } else {
          keptFiles.push(file)
        }
      }
      if (keptFiles.length === entry.files.length) {
        kept.push(entry)
      } else if (keptFiles.length > 0) {
        kept.push({ ...entry, files: keptFiles })
      } else {
        changed = true
      }
    }
    if (kept.length > 0) next[sessionId] = kept
  }
  return { store: changed ? next : undefined, staleCopyPaths }
}

/** 批 C P2-13（0.0.61）：孤儿副本——.dsh-paste 目录里"未被 store 引用"且已过期的文件。
    成因：trimStore 超 MESSAGE_FILES_CAP 淘汰条目后，其磁盘副本不再出现在 staleCopyPaths
    （条目已不在 store，过期判定永远轮不到它）→ 孤儿堆积。免责：被引用文件（无论过没过期）
    与新贴入未发送的文件（mtime 新）都不会列入。 */
export function orphanPasteCopies(
  store: MessageFilesStore,
  listing: readonly { name: string; mtimeMs: number }[],
  nowMs: number,
  ttlMs: number,
): string[] {
  const referenced = new Set<string>()
  for (const bucket of Object.values(store)) {
    for (const entry of bucket) {
      for (const file of entry.files) {
        if (file.origin !== 'paste-copy') continue
        const slash = file.path.lastIndexOf('/')
        referenced.add(slash < 0 ? file.path : file.path.slice(slash + 1))
      }
    }
  }
  return listing
    .filter(item => !referenced.has(item.name) && nowMs - item.mtimeMs > ttlMs)
    .map(item => '_temp/.dsh-paste/' + item.name)
}
