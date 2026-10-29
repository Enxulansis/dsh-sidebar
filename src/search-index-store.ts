/* 0.0.170（用户反馈②③）：本工作区内容索引的落盘层——每个工作区一个 JSON 文件（sha1(cwd) 命名），
 * 写盘去抖（构建期间多次 upsert 只落一次）。纯逻辑在 session-search-index.ts。 */

import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { ConversationMessage } from './conversation.js'
import type { RailNodeTables } from './rail-nodes.js'
import {
  SEARCH_HITS_MAX,
  emptySearchIndex,
  markSessionTrashed,
  parseSearchIndex,
  pruneSearchIndex,
  removeSession,
  searchSessionIndex,
  serializeSearchIndex,
  sessionIndexed,
  setSessionRail,
  upsertSessionEntries,
  type SearchIndexFile,
  type SearchIndexHit,
} from './session-search-index.js'

export class SearchIndexStore {
  private data: SearchIndexFile = emptySearchIndex()
  private workspace = ''
  private loaded = false
  private closed = false
  private workspaceLoad: { workspace: string; task: Promise<void> } | undefined
  private saveTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly directory: string | undefined, private readonly warn?: (message: string) => void) {}

  private fileFor(workspace: string): string | undefined {
    if (this.directory === undefined || workspace === '') return undefined
    const key = workspace.toLowerCase().replace(/\\/g, '/')
    const hash = createHash('sha1').update(key).digest('hex').slice(0, 16)
    return join(this.directory, `search-index-${hash}.json`)
  }

  /** 切到某工作区（含首个工作区）：读盘一次；同工作区重复调用为 no-op。
   *  0.1.110（审查中危3）：加载是异步的，两个并发 useWorkspace 会交错（后者的读盘结果覆盖前者的写入
   *  ⇒ 丢条目）；加**代际守卫**——过期的那次加载丢弃结果。落盘则由 writeChain 串行化（L5：两次
   *  writeFile 交错可落半截 JSON，被 parseSearchIndex 静默降级为空索引）。 */
  private loadGeneration = 0
  useWorkspace(workspace: string): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Search index store is closed.'))
    if (this.workspaceLoad?.workspace === workspace) return this.workspaceLoad.task
    if (this.loaded && this.workspace === workspace && this.workspaceLoad === undefined) return Promise.resolve()
    const generation = ++this.loadGeneration
    this.loaded = false
    const task = this.loadWorkspace(workspace, generation).finally(() => {
      if (this.workspaceLoad?.task === task) this.workspaceLoad = undefined
    })
    this.workspaceLoad = { workspace, task }
    return task
  }

  private async loadWorkspace(workspace: string, generation: number): Promise<void> {
    await this.flush()
    if (generation !== this.loadGeneration) return   /* 期间又切过工作区 ⇒ 本次作废 */
    let data = emptySearchIndex()
    const file = this.fileFor(workspace)
    if (file !== undefined) {
      try {
        const raw = await fs.readFile(file, 'utf8')
        data = parseSearchIndex(raw)
      } catch {
        /* 首次运行 / 文件损坏 → 空索引（下次构建重建） */
      }
    }
    if (generation !== this.loadGeneration) return
    // Commit workspace and data together, after the read; concurrent callers await the same load.
    this.workspace = workspace
    this.data = data
    this.loaded = true
  }

  get active(): boolean {
    return !this.closed && this.loaded && this.directory !== undefined && this.workspace !== ''
  }

  ownsWorkspace(workspace: string): boolean { return this.active && this.workspace === workspace }

  // A directory-less store supports pure in-memory indexing. Neither mode accepts writes
  // while a workspace snapshot is loading, or after closure.
  private get writable(): boolean {
    return !this.closed && this.workspaceLoad === undefined && (this.loaded || this.directory === undefined)
  }

  search(query: string, excludes: readonly string[] = []): SearchIndexHit[] {
    return searchSessionIndex(this.data, query, SEARCH_HITS_MAX, excludes)
  }

  /** Restrict before applying the global quota, so other sessions cannot crowd out this one. */
  searchSession(sessionId: string, query: string, excludes: readonly string[] = []): SearchIndexHit[] {
    const record = this.data.sessions[sessionId]
    return record === undefined ? [] : searchSessionIndex({ version: 5, sessions: { [sessionId]: record } }, query, SEARCH_HITS_MAX, excludes)
  }

  /** 0.1.65（T3-7）：面板脚注用的索引规模（会话数 / 条目数）。 */
  get stats(): { sessions: number; entries: number } {
    const records = Object.values(this.data.sessions)
    let entries = 0
    for (const record of records) entries += record.entries.length
    return { sessions: records.length, entries }
  }

  /** 写入/更新一个会话（revision 未变返回 false，不重建不落盘）；`force` 供脏标记路径强制重建。 */
  upsert(sessionId: string, revision: number, messages: readonly ConversationMessage[], force = false): boolean {
    if (!this.writable) return false
    const changed = upsertSessionEntries(this.data, sessionId, revision, messages, force)
    if (changed) this.scheduleSave()
    return changed
  }

  markTrashed(sessionId: string, trashed: boolean): void {
    if (!this.writable) return
    if (markSessionTrashed(this.data, sessionId, trashed)) this.scheduleSave()
  }

  /** 已按该 revision 建过索引？（用于跳过多余的 RPC 重取） */
  indexed(sessionId: string, revision: number): boolean {
    return sessionIndexed(this.data, sessionId, revision)
  }

  /** 0.1.124（数据层根治）：轨道节点表落盘（与条目同快照 revision，错位拒绝）。 */
  setRail(sessionId: string, revision: number, rail: RailNodeTables): boolean {
    if (!this.writable) return false
    if (!setSessionRail(this.data, sessionId, revision, rail)) return false
    this.scheduleSave()
    return true
  }

  /** 0.1.124（数据层根治）：读持久化轨道表（调用方内存缓存未命中时的回落）。 */
  rail(sessionId: string): RailNodeTables | undefined {
    return this.data.sessions[sessionId]?.rail
  }

  /** 永久删除：清掉条目（回收站的会话靠 trashed 标记保留）。 */
  remove(sessionId: string): void {
    if (!this.writable) return
    if (removeSession(this.data, sessionId)) this.scheduleSave()
  }

  prune(keep: ReadonlySet<string>): void {
    if (!this.writable) return
    if (pruneSearchIndex(this.data, keep)) this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.directory === undefined) return
    if (this.saveTimer !== undefined) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => { void this.flush() }, 1500)
  }

  /* 0.1.110（审查低5）：落盘串行化——去抖 flush 与 useWorkspace 里的 flush 可重叠，
     同一文件两次 writeFile 交错会落出半截 JSON（被 parse 静默降级为空索引）。同时**快照**
     工作区与数据（写盘期间切了工作区也不会把旧数据写进新文件）。 */
  private writeChain: Promise<void> = Promise.resolve()
  private closing: Promise<void> | undefined
  dispose(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.closed = true
    if (this.saveTimer !== undefined) clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    this.closing = (async () => {
      await this.workspaceLoad?.task
      ++this.loadGeneration
      await this.flush()
    })()
    return this.closing
  }

  async flush(): Promise<void> {
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer)
      this.saveTimer = undefined
    }
    const file = this.fileFor(this.workspace)
    if (file === undefined || this.directory === undefined) return
    const payload = serializeSearchIndex(this.data)
    const directory = this.directory
    this.writeChain = this.writeChain.then(async () => {
      try {
        await fs.mkdir(directory, { recursive: true })
        await fs.writeFile(file, payload, 'utf8')
      } catch (error) {
        /* 尽力而为：落盘失败只影响下次启动的重建成本。
           2026-10-06（W9 留痕）：真机曾出现"索引文件从不落盘且全链无日志"——此处不再全吞，
           首次失败经 warn 外露（调用方接输出通道），定位"为何不落库"。 */
        this.warn?.('flush failed: ' + (error instanceof Error ? error.message : String(error)))
      }
    })
    await this.writeChain
  }
}
