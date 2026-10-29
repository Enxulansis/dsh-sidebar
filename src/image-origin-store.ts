/**
 * 0.0.58：发送原图留档的落盘存储（blob 内容寻址 + manifest.json；不 import vscode）。
 * 纯规则在 image-origins.ts；本文件只管磁盘与内存缓存（LRU / 去重 / 剪枝 / 单飞读取）。
 */
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import {
  MAX_TOTAL_BYTES,
  estimateBase64Bytes,
  originFileName,
  originKey,
  planPrune,
  sanitizeManifest,
  type OriginEntry,
  type OriginManifest,
  type OriginRecord,
} from './image-origins.js'

export interface OriginData {
  rawBase64: string
  label: string
  displayMediaType?: string
}

const MANIFEST_FILE = 'manifest.json'
const MAX_MEMORY_BYTES = 128 * 1024 * 1024
const MAX_MEMORY_ENTRIES = 24
const SAVE_DEBOUNCE_MS = 800

export class ImageOriginStore {
  private manifest: OriginManifest = {}
  private dirty = false
  private saveTimer: NodeJS.Timeout | undefined
  private readonly memory = new Map<string, OriginData>()
  private memoryBytes = 0
  private readonly loads = new Map<string, Promise<OriginData | undefined>>()
  /** 挂起中的 blob 写入（flush 需等待——否则"刚记住即重启"会丢文件）。 */
  private readonly writes = new Set<Promise<void>>()
  private maxTotalBytes: number

  constructor(private readonly rootDir: string, options: { maxTotalBytes?: number } = {}) {
    this.maxTotalBytes = options.maxTotalBytes ?? MAX_TOTAL_BYTES
  }

  /** G42-C/批次 3-E1（0.0.97）：运行时热更总量上限（配置改动即生效，改小立即剪枝）；负值 = 哨兵"不剪枝"。 */
  setMaxTotalBytes(maxTotalBytes: number): void {
    if (typeof maxTotalBytes !== 'number' || !Number.isFinite(maxTotalBytes)) return
    this.maxTotalBytes = maxTotalBytes
    this.prune()
    if (this.dirty) this.scheduleSave()
  }

  /** 读 manifest + 剪枝 + 清理孤儿文件。ready 前的 remember/cached 调用安全（盘上条目合并到内存之下）。 */
  async load(): Promise<void> {
    if (this.rootDir === '') return
    let fromDisk: OriginManifest = {}
    try {
      await fsp.mkdir(this.rootDir, { recursive: true })
      const raw = JSON.parse(await fsp.readFile(path.join(this.rootDir, MANIFEST_FILE), 'utf8')) as unknown
      fromDisk = sanitizeManifest(raw)
    } catch {
      fromDisk = {}
    }
    this.manifest = { ...fromDisk, ...this.manifest }
    this.prune()
    try {
      const known = new Set(Object.values(this.manifest).map(record => record.file))
      for (const name of await fsp.readdir(this.rootDir)) {
        if (name === MANIFEST_FILE || known.has(name)) continue
        void fsp.rm(path.join(this.rootDir, name), { force: true })
      }
    } catch { /* 清理失败无害 */ }
    this.scheduleSave()
  }

  recordOf(sessionId: string, attachmentId: string): OriginRecord | undefined {
    return this.manifest[originKey(sessionId, attachmentId)]
  }

  /** 同步取（仅内存命中）——显示层渲染路径用；未命中返回 undefined（调用方回退归一化副本，可另走 dataOf 触发加载）。 */
  cached(sessionId: string, attachmentId: string): OriginData | undefined {
    const key = originKey(sessionId, attachmentId)
    const data = this.memory.get(key)
    if (data === undefined) return undefined
    this.memory.delete(key)
    this.memory.set(key, data)
    this.touch(key)
    return data
  }

  /* 0.0.163（审查 P1-2）：存储根路径（设置台「存储」区展示/打开用）。 */
  get directory(): string {
    return this.rootDir
  }

  /** 内存未命中但 manifest 有记录（且允许显示）→ 供显示层决定是否异步加载。 */
  hasDisplay(sessionId: string, attachmentId: string): boolean {
    return this.recordOf(sessionId, attachmentId)?.displayMediaType !== undefined
  }

  /* 0.0.163（全产品审查 P1-3）：永久删除会话时清该会话的原图留档（键 = sessionId\0attachmentId，
     前缀匹配）；文件删除尽力而为，manifest 立即摘除并落盘。 */
  purgeSession(sessionId: string): void {
    if (sessionId === '') return
    const prefix = originKey(sessionId, '')
    let changed = false
    for (const key of Object.keys(this.manifest)) {
      if (!key.startsWith(prefix)) continue
      const record = this.manifest[key]
      delete this.manifest[key]
      this.forgetInMemory(key)
      if (record !== undefined) this.removeUnreferencedBlob(record.file)
      this.dirty = true
      changed = true
    }
    if (changed) this.scheduleSave()
  }

  async dataOf(sessionId: string, attachmentId: string): Promise<OriginData | undefined> {
    const key = originKey(sessionId, attachmentId)
    const hit = this.cached(sessionId, attachmentId)
    if (hit !== undefined) return hit
    const record = this.manifest[key]
    if (record === undefined) return undefined
    const existing = this.loads.get(key)
    if (existing !== undefined) return existing
    const load = (async () => {
      try {
        const file = path.join(this.rootDir, record.file)
        const rawBase64 = (await fsp.readFile(file)).toString('base64')
        // Purge/prune/replacement can finish while the old disk read is pending.
        if (this.manifest[key] !== record) return undefined
        const data: OriginData = {
          rawBase64,
          label: record.label,
          ...(record.displayMediaType === undefined ? {} : { displayMediaType: record.displayMediaType }),
        }
        this.rememberInMemory(key, data)
        this.touch(key)
        return data
      } catch {
        if (this.manifest[key] === record) {
          delete this.manifest[key]
          this.dirty = true
          this.scheduleSave()
        }
        return undefined
      } finally {
        this.loads.delete(key)
      }
    })()
    this.loads.set(key, load)
    return load
  }

  /** 发送绑定成功后调用：内存立即生效（本次渲染即可用原图），磁盘写尽力而为。 */
  remember(sessionId: string, attachmentId: string, entry: OriginEntry): void {
    if (this.rootDir === '' || entry.rawBase64 === '' || entry.label === '') return
    const key = originKey(sessionId, attachmentId)
    const file = originFileName(entry.rawBase64, entry.label)
    const bytes = estimateBase64Bytes(entry.rawBase64)
    const now = Date.now()
    const known = Object.values(this.manifest).some(record => record.file === file)
    if (!known) {
      const target = path.join(this.rootDir, file)
      const write = fsp.mkdir(this.rootDir, { recursive: true })
        .then(() => fsp.writeFile(target, Buffer.from(entry.rawBase64, 'base64')))
        .catch(() => { /* 磁盘写失败：显示仍走内存缓存，重启后回退 */ })
        .finally(() => { this.writes.delete(write) })
      this.writes.add(write)
    }
    this.manifest[key] = {
      label: entry.label,
      file,
      bytes,
      addedAt: now,
      lastUsedAt: now,
      ...(entry.displayMediaType === undefined ? {} : { displayMediaType: entry.displayMediaType }),
    }
    this.rememberInMemory(key, {
      rawBase64: entry.rawBase64,
      label: entry.label,
      ...(entry.displayMediaType === undefined ? {} : { displayMediaType: entry.displayMediaType }),
    })
    this.prune()
    this.dirty = true
    this.scheduleSave()
  }

  /** 更新使用时间（显示/复制命中时）——只改内存，随下次结构性保存落盘。 */
  private touch(key: string): void {
    const record = this.manifest[key]
    if (record !== undefined) record.lastUsedAt = Date.now()
  }

  private rememberInMemory(key: string, data: OriginData): void {
    this.forgetInMemory(key)
    this.memory.set(key, data)
    this.memoryBytes += estimateBase64Bytes(data.rawBase64)
    while (this.memory.size > MAX_MEMORY_ENTRIES || this.memoryBytes > MAX_MEMORY_BYTES) {
      const oldest = this.memory.keys().next().value
      if (oldest === undefined || this.memory.size === 1) break
      this.forgetInMemory(oldest)
    }
  }

  private forgetInMemory(key: string): void {
    const data = this.memory.get(key)
    if (data === undefined) return
    this.memory.delete(key)
    this.memoryBytes -= estimateBase64Bytes(data.rawBase64)
  }

  private prune(): void {
    for (const key of planPrune(this.manifest, this.maxTotalBytes)) {
      const record = this.manifest[key]
      delete this.manifest[key]
      this.forgetInMemory(key)
      this.dirty = true
      if (record !== undefined) this.removeUnreferencedBlob(record.file)
    }
  }

  private removeUnreferencedBlob(file: string): void {
    if (this.rootDir === '' || Object.values(this.manifest).some(record => record.file === file)) return
    void fsp.rm(path.join(this.rootDir, file), { force: true }).catch(() => { /* 尽力而为 */ })
  }

  private scheduleSave(): void {
    if (this.saveTimer !== undefined) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      void this.saveNow()
    }, SAVE_DEBOUNCE_MS)
  }

  private async saveNow(): Promise<void> {
    if (!this.dirty || this.rootDir === '') return
    this.dirty = false
    try {
      const target = path.join(this.rootDir, MANIFEST_FILE)
      const temp = target + '.tmp'
      await fsp.writeFile(temp, JSON.stringify(this.manifest))
      await fsp.rename(temp, target)
    } catch { /* 下次 dirty 时重试 */ }
  }

  /** 立即落盘（可等待——测试与停用路径用）：先等挂起的 blob 写入，再写 manifest。 */
  async flush(): Promise<void> {
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer)
      this.saveTimer = undefined
    }
    while (this.writes.size > 0) await Promise.all([...this.writes])
    await this.saveNow()
  }

  /** 析构：立即落盘（扩展停用/窗口关闭）。 */
  dispose(): void {
    void this.flush()
  }
}
