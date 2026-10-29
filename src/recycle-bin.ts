import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveDshHome } from './plugin-profile.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Session ids arrive either as the dsh runtime form (`session-<uuid>`) or a bare uuid. */
export function normalizeSessionId(value: string): string {
  return value.startsWith('session-') ? value : `session-${value}`
}

const isSessionId = (value: string): boolean => (
  UUID_PATTERN.test(value.startsWith('session-') ? value.slice('session-'.length) : value)
)

const invalidWorkspace = (workspace: string): boolean => (
  workspace === '' || workspace.includes('..') || workspace.includes('/') || workspace.includes('\\')
)

async function renameWithRetry(source: string, target: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await fs.mkdir(dirname(target), { recursive: true })
      await fs.rename(source, target)
      return true
    } catch {
      if (attempt === 2) return false
      await new Promise<void>(resolve => { setTimeout(resolve, 250) })
    }
  }
  return false
}

export interface RecycleItem {
  id: string
  workspace: string
  title: string
  deletedAt: number
  /** Snapshot of SessionSummary.updatedAt at trash time; the runtime dir is gone afterwards. */
  lastMessageAt?: number
  /** 0.0.147：删除时记录的原项目路径（旧条目由 backfillCwd 从 dsh projcache 回填）。
   *  回收站按项目隔离的归属主键——workspace 目录名只作兜底（同目录可因写法差异落到不同目录）。 */
  cwd?: string
}

/** 0.0.147：会话归属比较的路径规范化（自 extension.ts 迁入，单一来源）——
    dsh 原样保存 session/create 传入的 cwd 字符串，脚本/CLI 用正斜杠或不同盘符大小写
    在同目录建的会话会被严格 === 过滤掉（0.0.138 用户实测）。Windows 路径大小写不敏感，
    统一反斜杠 + 小写。 */
export function sameCwd(left: string | undefined, right: string): boolean {
  if (left === undefined || right === '') return false
  const norm = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(left) === norm(right)
}

/** 0.0.147：回收站条目按项目分类——cwd 已知按 sameCwd；未知（旧条目回填失败）按
    workspace 目录名比对当前项目的活会话目录；都判不了（本项目暂无活会话）→ 归本项目显示
    （宁可多显示，不让旧数据"消失"）。 */
export function classifyRecycle(
  items: readonly RecycleItem[],
  cwd: string,
  workspaceDirs: ReadonlySet<string>,
): { mine: RecycleItem[]; others: RecycleItem[] } {
  const mine: RecycleItem[] = []
  const others: RecycleItem[] = []
  for (const item of items) {
    if (typeof item.cwd === 'string' && item.cwd !== '') {
      ;(sameCwd(item.cwd, cwd) ? mine : others).push(item)
    } else if (workspaceDirs.size > 0) {
      ;(workspaceDirs.has(item.workspace) ? mine : others).push(item)
    } else {
      mine.push(item)
    }
  }
  return { mine, others }
}

export interface RecycleItemView {
  id: string
  title: string
  deletedAt: number
  lastMessageAt?: number
}

/** Find which workspace directory under DSH_HOME/sessions holds this session. */
export async function findSessionWorkspace(dshHome: string, sessionId: string): Promise<string | undefined> {
  if (!isSessionId(sessionId)) return undefined
  const dirName = normalizeSessionId(sessionId)
  const sessionsRoot = join(dshHome, 'sessions')
  let entries: { name: string; isDirectory: () => boolean }[]
  try {
    entries = await fs.readdir(sessionsRoot, { withFileTypes: true })
  } catch {
    return undefined
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      await fs.access(join(sessionsRoot, entry.name, dirName))
      return entry.name
    } catch {
      // keep scanning
    }
  }
  return undefined
}

/**
 * Soft-delete store for local sessions: the runtime has no delete RPC, so we
 * move the session directory into DSH_HOME/recycle-bin and remember the
 * original workspace in a manifest (required to restore it verbatim later).
 * Expired entries are physically removed, never silently restored.
 */
export class SessionRecycleBin {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly dshHome: string = resolveDshHome()) {}

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => {})
    return run
  }

  private binRoot(): string {
    return join(this.dshHome, 'recycle-bin')
  }

  private manifestPath(): string {
    return join(this.binRoot(), 'manifest.json')
  }

  list(): Promise<RecycleItem[]> {
    return this.enqueue(async () => {
      const items = await this.readItems()
      // G23: 按最后对话时间排序（最新在前）；旧 manifest 条目无 lastMessageAt（0/undefined）时回退 deletedAt。
      return items.filter(item => isSessionId(item.id))
        .sort((a, b) => (b.lastMessageAt || b.deletedAt) - (a.lastMessageAt || a.deletedAt))
    })
  }

  trash(sessionId: string, workspace: string, title: string, lastMessageAt?: number, cwd?: string): Promise<boolean> {
    return this.enqueue(async () => {
      if (!isSessionId(sessionId) || invalidWorkspace(workspace)) return false
      const dirName = normalizeSessionId(sessionId)
      const source = join(this.dshHome, 'sessions', workspace, dirName)
      const target = join(this.binRoot(), dirName)
      if (!await renameWithRetry(source, target)) return false
      try {
        const items = await this.readItems()
        const rest = items.filter(item => item.id !== sessionId && item.id !== dirName)
        rest.push({
          id: dirName, workspace, title, deletedAt: Date.now(), lastMessageAt: lastMessageAt ?? 0,
          ...(typeof cwd === 'string' && cwd !== '' ? { cwd } : {}),
        })
        await this.writeItems(rest)
      } catch (error) {
        // Directory already moved; give the session back rather than leaving it untracked.
        await fs.rename(target, source).catch(() => {})
        throw error
      }
      return true
    })
  }

  restore(sessionId: string): Promise<boolean> {
    return this.enqueue(async () => {
      if (!isSessionId(sessionId)) return false
      const dirName = normalizeSessionId(sessionId)
      const items = await this.readItems()
      const item = items.find(candidate => candidate.id === sessionId || candidate.id === dirName)
      if (item === undefined) return false
      if (invalidWorkspace(item.workspace)) return false
      const target = join(this.dshHome, 'sessions', item.workspace, dirName)
      // Already back in place (e.g. the runtime re-flushed it): the restore is idempotent.
      try {
        await fs.access(target)
        await this.writeItems(items.filter(candidate => candidate.id !== item.id))
        return true
      } catch {
        // continue with the move
      }
      if (!await renameWithRetry(join(this.binRoot(), dirName), target)) return false
      try {
        await this.writeItems(items.filter(candidate => candidate.id !== item.id))
      } catch (error) {
        await fs.rename(target, join(this.binRoot(), dirName)).catch(() => {})
        throw error
      }
      return true
    })
  }

  purge(sessionId: string): Promise<boolean> {
    return this.enqueue(async () => {
      if (!isSessionId(sessionId)) return false
      const dirName = normalizeSessionId(sessionId)
      const items = await this.readItems()
      await fs.rm(join(this.binRoot(), dirName), { recursive: true, force: true })
      await this.writeItems(items.filter(candidate => candidate.id !== sessionId && candidate.id !== dirName))
      return true
    })
  }

  /** 0.0.147：旧条目补 cwd（回收站按项目隔离需要）。只读 dsh 的会话项目缓存
      `storages/session_projcache.json`（`tables.sessions.<id>.identity.cwd`，容错解析），
      有回填才写回 manifest。返回回填条数。 */
  backfillCwd(): Promise<number> {
    return this.enqueue(async () => {
      const items = await this.readItems()
      const missing = items.filter(item => typeof item.cwd !== 'string' || item.cwd === '')
      if (missing.length === 0) return 0
      let sessions: Record<string, unknown>
      try {
        const raw = JSON.parse(await fs.readFile(join(this.dshHome, 'storages', 'session_projcache.json'), 'utf8')) as unknown
        const tables = (raw as { tables?: { sessions?: unknown } } | null)?.tables
        const candidate = tables?.sessions
        if (typeof candidate !== 'object' || candidate === null) return 0
        sessions = candidate as Record<string, unknown>
      } catch {
        return 0
      }
      let filled = 0
      for (const item of missing) {
        const bare = normalizeSessionId(item.id).slice('session-'.length)
        const record = sessions[item.id] ?? sessions[`session-${bare}`] ?? sessions[bare]
        const cwd = (record as { identity?: { cwd?: unknown } } | undefined)?.identity?.cwd
        if (typeof cwd === 'string' && cwd !== '') {
          item.cwd = cwd
          filled += 1
        }
      }
      if (filled > 0) await this.writeItems(items)
      return filled
    })
  }

  /** Physically delete entries whose retention period elapsed. */
  prune(retentionMs: number): Promise<RecycleItem[]> {
    return this.enqueue(async () => {
      if (!(retentionMs > 0)) return []
      const items = await this.readItems()
      const now = Date.now()
      const expired = items.filter(item => isSessionId(item.id) && now - item.deletedAt > retentionMs)
      if (expired.length === 0) return []
      for (const item of expired) {
        await fs.rm(join(this.binRoot(), normalizeSessionId(item.id)), { recursive: true, force: true })
      }
      await this.writeItems(items.filter(item => !expired.includes(item)))
      return expired
    })
  }

  private async readItems(): Promise<RecycleItem[]> {
    let source: string
    try {
      source = await fs.readFile(this.manifestPath(), 'utf8')
    } catch {
      return []
    }
    try {
      const parsed = JSON.parse(source) as { items?: unknown }
      if (!Array.isArray(parsed.items)) return []
      return parsed.items.filter((value): value is RecycleItem => (
        typeof value === 'object' && value !== null
        && typeof (value as { id?: unknown }).id === 'string'
        && typeof (value as { workspace?: unknown }).workspace === 'string'
        && typeof (value as { deletedAt?: unknown }).deletedAt === 'number'
      ))
    } catch {
      // Corrupt manifest: keep a copy for inspection instead of silently dropping entries.
      await fs.rename(this.manifestPath(), join(this.binRoot(), `manifest.corrupt-${Date.now()}.json`)).catch(() => {})
      return []
    }
  }

  private async writeItems(items: RecycleItem[]): Promise<void> {
    await fs.mkdir(this.binRoot(), { recursive: true })
    const tmp = join(this.binRoot(), 'manifest.json.tmp')
    await fs.writeFile(tmp, JSON.stringify({ items }, null, 2), 'utf8')
    // Atomic-ish replace so a crash mid-write cannot corrupt the manifest.
    await fs.rm(this.manifestPath(), { force: true })
    await fs.rename(tmp, this.manifestPath())
  }
}
