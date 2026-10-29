/* 0.0.170（用户反馈②③）：侧栏自建的「本工作区内容索引」。
 *
 * 为什么不用运行时索引：dsh 的 FTS5 表 tokenize 写死 unicode61——连续中文整段算一个词，
 * 二维词（"直接"）在 "请直接回答当前时间" 里 0 命中；换 trigram 也不行（FTS5 trigram 要求
 * ≥3 字符，2 字中文静默返回 0，本机实测复核）。侧栏本来按工作区组织、单工作区会话数有限，
 * 于是改为：把本工作区各会话的投影消息拉下来，做**子串**匹配——不限语言、不限字数，
 * 且命中带 messageId，可直接跳到那条消息。
 *
 * 本模块只放纯逻辑（抽取/搜索/增量/序列化），IO 与 RPC 在 extension.ts 侧。 */

import type { ConversationMessage } from './conversation.js'
import type { RailNodeEntry, RailNodeTables } from './rail-nodes.js'

export type SearchEntryKind = '文本' | '图片' | '文件' | '工具'

export interface SearchEntry {
  /** 消息 id（与 projector / webview 的 data-mid 同源 → 命中可直接跳转）。 */
  id: string
  role: string
  kind: SearchEntryKind
  text: string
  /** 0.1.71：消息时间戳——「最近优先」排序用（缺失按 0）。 */
  time?: number
  /** 0.1.123（G55 Phase 3）：消息事件 seq——搜索结果行的节点编号（「N/M」）（缺失不标）。 */
  seq?: number
}

export interface SessionIndexRecord {
  /** 会话 updatedAt（增量刷新的比较依据；不变则跳过重取）。 */
  revision: number
  entries: SearchEntry[]
  /** 本侧栏删除的会话：内容保留、标「回收站」，恢复后清除。 */
  trashed?: boolean
  /** 0.1.124（数据层根治）：该会话的「轨道节点表」（与 entries 同一次拉取产出；缺 = 待补算）。 */
  rail?: RailNodeTables
  /** 0.1.125：轨道表计算语义版本（窗口口径 + 前缀 endSeq）——版本不符的表作废重算，条目不动。 */
  railVersion?: number
}

/* 0.1.125（数据层根治·真机反例）：轨道表语义版本。v1（无标记）= 单页窗口（historyPullLimit()
   ≈3000 事件）且前缀无 endSeq——视频会话实测致"48 节点（35 前缀幽灵 + 13 真段）+ 首节点点不动"；
   v2 = 有界多页 + 前缀 endSeq，冷会话可能缺全量大纲；
   v3 = 有界多页未完成时必须取得全量大纲，失败不保存局部表；非空摘要仍可能滞后。
   v4 = 完整事件直接派生；未完成时使用覆盖已读事件的新快照。
   v5 = 追加代次/revision 守卫；替换条目截面时旧表作废，避免旧表被贴上新 revision。
   v6 = 超限头部保留详细消息/停点身份，不再合并为轮前缀；精确应答锚点携带 stop。 */
export const RAIL_TABLE_VERSION = 6

export interface SearchIndexFile {
  version: 5
  sessions: Record<string, SessionIndexRecord>
}

/* 0.1.97（真机反馈：中段内容搜不到 —— 大会话 5556 条目只留末 500 ⇒ 09-22 整段断档）：
   三档上限整体抬高——条目 500→2000（覆盖大多数会话全量；巨型会话约覆盖后半）、
   每会话命中 6→12、总命中 40→60。面板脚注自动显示新值。 */
/** 单条文本入索引上限（超长正文截断——搜索够用且控内存）。 */
export const SEARCH_ENTRY_TEXT_MAX = 4_000
/** 每会话条目上限（超出丢最旧的；0.1.97：500→2000）。 */
export const SEARCH_ENTRIES_PER_SESSION_MAX = 2_000
/** 每会话返回命中上限（0.1.97：6→12）。 */
export const SEARCH_HITS_PER_SESSION_MAX = 12
export const SEARCH_TOOL_HITS_PER_SESSION_MAX = 24
/** 一次查询返回命中上限（0.1.97：40→60）。 */
export const SEARCH_HITS_MAX = 60

export function emptySearchIndex(): SearchIndexFile {
  return { version: 5, sessions: {} }
}

function clampText(text: string): string {
  return text.length > SEARCH_ENTRY_TEXT_MAX ? text.slice(0, SEARCH_ENTRY_TEXT_MAX) : text
}

/** 从一个会话的投影消息抽取可搜条目：正文 / 图片名 / 文件名·路径 / 工具调用参数与输出。 */
export function messageSearchEntries(messages: readonly ConversationMessage[]): SearchEntry[] {
  const entries: SearchEntry[] = []
  for (const message of messages) {
    if (typeof message.id !== 'string' || message.id === '') continue
    const role = message.role
    const entryTime = typeof message.time === 'number' ? message.time : 0
    /* 0.1.123（G55 Phase 3）：条目带事件 seq——结果行的节点编号由此换算（缺失则不标）。 */
    const entrySeq = typeof message.seq === 'number' && Number.isFinite(message.seq) ? message.seq : undefined
    const text = typeof message.text === 'string' ? message.text.trim() : ''
    if (text !== '') entries.push({ id: message.id, role, kind: role === 'tool' ? '工具' : '文本', text, time: entryTime, ...(entrySeq === undefined ? {} : { seq: entrySeq }) })
    if (typeof message.rawInput === 'string' && message.rawInput.trim() !== '') {
      entries.push({ id: message.id, role, kind: '工具', text: `${text} ${message.rawInput}`.trim(), time: entryTime, ...(entrySeq === undefined ? {} : { seq: entrySeq }) })
    }
    if (typeof message.rawResult === 'string' && message.rawResult.trim() !== '') {
      entries.push({ id: message.id, role, kind: '工具', text: message.rawResult, time: entryTime, ...(entrySeq === undefined ? {} : { seq: entrySeq }) })
    }
    for (const image of message.images ?? []) {
      const name = typeof image.name === 'string' ? image.name.trim() : ''
      if (name !== '') entries.push({ id: message.id, role, kind: '图片', text: name, time: entryTime, ...(entrySeq === undefined ? {} : { seq: entrySeq }) })
    }
    for (const file of message.files ?? []) {
      const parts = [file.name, file.path].filter(part => typeof part === 'string' && part.trim() !== '')
      if (parts.length > 0) entries.push({ id: message.id, role, kind: '文件', text: parts.join(' '), time: entryTime, ...(entrySeq === undefined ? {} : { seq: entrySeq }) })
    }
  }
  return entries
}

/** Persisted cache stays bounded; query-time history matching uses the same extraction without truncation. */
export function buildSessionEntries(messages: readonly ConversationMessage[]): SearchEntry[] {
  const entries = messageSearchEntries(messages).map(entry => entry.kind === '图片' ? entry : { ...entry, text: clampText(entry.text) })
  return entries.length > SEARCH_ENTRIES_PER_SESSION_MAX
    ? entries.slice(entries.length - SEARCH_ENTRIES_PER_SESSION_MAX)
    : entries
}

export interface SearchIndexHit {
  sessionId: string
  messageId: string
  role: string
  kind: SearchEntryKind
  snippet: string
  /** 0.1.71（悬停展开）：同一命中的**长片段**（命中前后各 120/240 字）。 */
  snippetLong: string
  /** 0.1.71（排序开关）：命中所属消息的时间戳（缺失 0）。 */
  time: number
  trashed: boolean
  /** 0.1.65（T3-3）：该命中来源文本里同一词的出现次数（面板"共 N 处"；只报次数不报序号）。 */
  total: number
  /** 0.1.123（G55 Phase 3）：命中所属消息的事件 seq（结果行节点编号换算；缺失不标）。 */
  seq?: number
}

/** 0.1.65（T3-3）：同一文本里**不重叠**出现次数。 */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0
  let count = 0
  let at = haystack.indexOf(needle)
  while (at >= 0) {
    count += 1
    at = haystack.indexOf(needle, at + needle.length)
  }
  return count
}

/** 片段：命中处前后各截一段（默认前 16 / 后 30 字），压平空白。
 *  0.1.71：可传 before/after —— 结果行"悬停展开"要一段更长的上下文（扩展侧直接给长片段，视图层无需全文）。 */
export function snippetOf(text: string, index: number, length: number, before = 16, after = 30): string {
  const from = Math.max(0, index - before)
  const body = text.slice(from, index + length + after).replace(/\s+/g, ' ').trim()
  return (from > 0 ? '…' : '') + body + (index + length + after < text.length ? '…' : '')
}

/** 子串搜索（大小写不敏感）。同一条消息的多类条目只在首条命中处出一次。
 *  0.1.110（审查中危2）：**每会话配额只算"非工具"条目**——旧实现工具条目同样吃 12 条配额，
 *  真机 12 条里 11 条是工具行（视图层默认又不展示）⇒ 正文命中被挤到只剩 1 条。工具条目改为
 *  不计数、**兜底追加**（每会话另限 24 条、总数仍受 hitsMax 约束）：视图层按 includeTools 开关
 *  即时显示/隐藏，开关打开时不会"什么都没有"。
 *  条目遍历保持**时间正序**（取"最旧 12"）是刻意的：本地扫描取"最新 60"覆盖尾部，
 *  索引侧取窗口内最旧的一批才能补上**中段**（0.1.97 的目标）；两侧方向不同是有意为之，勿"顺手统一"。 */
export function searchSessionIndex(
  file: SearchIndexFile,
  query: string,
  hitsMax = SEARCH_HITS_MAX,
  excludes: readonly string[] = [],   /* 0.1.76（T3-5）：`-词` 排除项（条目全文含任一项即跳过） */
): SearchIndexHit[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []
  const hits: SearchIndexHit[] = []
  for (const [sessionId, record] of Object.entries(file.sessions)) {
    let perSession = 0
    const seen = new Set<string>()
    const deferredTools: SearchIndexHit[] = []
    for (const entry of record.entries) {
      if (hits.length >= hitsMax) break
      const lowered = entry.text.toLowerCase()
      const index = lowered.indexOf(needle)
      if (index < 0 || seen.has(entry.id)) continue
      if (excludes.length > 0 && excludes.some(word => word !== '' && lowered.indexOf(word) >= 0)) continue
      seen.add(entry.id)
      // Tool names belong to the tool toggle/quota as well as arguments and output.
      // Role also classifies name rows already present in an unchanged on-disk cache.
      const kind = entry.role === 'tool' && entry.kind === '文本' ? '工具' : entry.kind
      const hit: SearchIndexHit = {
        sessionId,
        messageId: entry.id,
        total: countOccurrences(lowered, needle),
        time: typeof entry.time === 'number' ? entry.time : 0,
        role: entry.role,
        kind,
        snippet: snippetOf(entry.text, index, needle.length),
        snippetLong: snippetOf(entry.text, index, needle.length, 120, 240),
        trashed: record.trashed === true,
        ...(typeof entry.seq === 'number' && Number.isFinite(entry.seq) ? { seq: entry.seq } : {}),
      }
      if (kind === '工具') {
        if (deferredTools.length < SEARCH_TOOL_HITS_PER_SESSION_MAX) deferredTools.push(hit)
        continue   /* 不占配额、不立即入列 */
      }
      if (perSession >= SEARCH_HITS_PER_SESSION_MAX) continue
      hits.push(hit)
      perSession += 1
    }
    for (const hit of deferredTools) {
      if (hits.length >= hitsMax) break
      hits.push(hit)
    }
  }
  return hits
}

/** 写入/更新一个会话的索引记录（revision 未变则返回 false，不重建）。
 *  0.1.110（审查高危1）：加 `force` —— 回合结束打的**脏标记**（updatedAt 滞后于内容）走这条路时
 *  必须**真的重建**：旧实现 revision 相同即 return false ⇒ 刚拉回来的新消息被直接丢弃、
 *  脏标记又被清掉 ⇒ "回合结束刷新索引"在它设计针对的场景里空转（还白付一次 RPC）。 */
export function upsertSessionEntries(
  file: SearchIndexFile,
  sessionId: string,
  revision: number,
  messages: readonly ConversationMessage[],
  force = false,
): boolean {
  const existing = file.sessions[sessionId]
  if (!force && existing !== undefined && existing.revision === revision && existing.entries.length > 0) return false
  file.sessions[sessionId] = {
    revision,
    entries: buildSessionEntries(messages),
    ...(existing?.trashed === true ? { trashed: true } : {}),
    // A replaced entry snapshot cannot certify the previous rail; its caller supplies the matching table.
  }
  return true
}

/** 0.1.124（数据层根治）：写入该会话的轨道节点表（与条目同源快照——revision 必须一致，防错位）。
 *  缺表会话由构建批"缺表判据"补算（extension 侧 railFor / pending 过滤）。 */
export function setSessionRail(file: SearchIndexFile, sessionId: string, revision: number, rail: RailNodeTables): boolean {
  const record = file.sessions[sessionId]
  if (record === undefined || record.revision !== revision) return false
  record.rail = rail
  record.railVersion = RAIL_TABLE_VERSION
  return true
}

export function markSessionTrashed(file: SearchIndexFile, sessionId: string, trashed: boolean): boolean {
  const record = file.sessions[sessionId]
  if (record === undefined || (record.trashed === true) === trashed) return false
  if (trashed) record.trashed = true
  else delete record.trashed
  return true
}

/** 是否已按该 revision 建过索引（避免多余的 RPC 重取）。 */
export function sessionIndexed(file: SearchIndexFile, sessionId: string, revision: number): boolean {
  const record = file.sessions[sessionId]
  return record !== undefined && record.revision === revision && record.entries.length > 0
}

/** 永久删除时清掉该会话的条目（回收站里的会话由 trashed 标记保留）。 */
export function removeSession(file: SearchIndexFile, sessionId: string): boolean {
  if (file.sessions[sessionId] === undefined) return false
  delete file.sessions[sessionId]
  return true
}

/** 清掉不在 keep 名单里的会话（删会话/换工作区时）；**回收站条目标记的会话自动保留**。返回是否变化。 */
export function pruneSearchIndex(file: SearchIndexFile, keep: ReadonlySet<string>): boolean {
  let changed = false
  for (const [sessionId, record] of Object.entries(file.sessions)) {
    if (keep.has(sessionId) || record.trashed === true) continue
    delete file.sessions[sessionId]
    changed = true
  }
  return changed
}

export function serializeSearchIndex(file: SearchIndexFile): string {
  return JSON.stringify(file)
}

/* 0.1.110（审查低8）：落盘数据的 kind 也要过白名单——未知串回落「文本」，不让任意值冒充条目类型。 */
function kindOf(value: unknown): SearchEntryKind {
  return value === '图片' || value === '文件' || value === '工具' ? value : '文本'
}

/* 0.1.124（数据层根治）：落盘轨道表过白名单——seq 必须为有限数字（**key 由 seq 重建**，不信任落盘串）；
   mid 非字符串回落 null；任一侧数组缺失/非数组 ⇒ 整表作废（回落"缺表"补算，不半残）。 */
function railOf(value: unknown): RailNodeTables | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const source = value as { segment?: unknown; turn?: unknown }
  const readEntries = (list: unknown): RailNodeEntry[] | undefined => {
    if (!Array.isArray(list)) return undefined
    const entries: RailNodeEntry[] = []
    for (const item of list) {
      if (item === null || typeof item !== 'object') continue
      const record = item as { seq?: unknown; mid?: unknown; endSeq?: unknown; stop?: unknown }
      if (typeof record.seq !== 'number' || !Number.isFinite(record.seq)) continue
      entries.push({
        seq: record.seq,
        mid: typeof record.mid === 'string' ? record.mid : null,
        key: 's' + String(record.seq),
        ...(typeof record.endSeq === 'number' && Number.isFinite(record.endSeq) ? { endSeq: record.endSeq } : {}),
        ...(record.stop === true ? { stop: true as const } : {}),
      })
    }
    return entries
  }
  const segment = readEntries(source.segment)
  const turn = readEntries(source.turn)
  if (segment === undefined || turn === undefined) return undefined
  return { segment, turn }
}

export function parseSearchIndex(raw: string): SearchIndexFile {
  try {
    const value = JSON.parse(raw) as { version?: unknown; sessions?: unknown }
    /* 0.1.71：版本 2 = 条目带 time；旧版本文件直接作废（下次构建重建，代价是一次后台索引）。
       0.1.90（用户报① 索引条目串会话）：**版本 3 = 作废 2**——v2 期间写入路径混入过跨会话条目
       （旧记录可能出现别会话的 message id），无法逐条甄别 ⇒ 直接重建更安全。
       0.1.123（G55 Phase 3）：**版本 4 = 条目加 seq**（结果行节点编号）——v3 无 seq，直接作废重建
       （旧条目 revision 不变则永不补 seq，静默半残；重建一次后台索引，与 v2→v3 同策）。
       0.1.124（数据层根治）：**版本 5 = 会话记录加轨道节点表 rail**——v4 **兼容读**（条目有效；
       缺 rail 走"缺表判据"补算，不整档重建）。 */
    if (value === null || typeof value !== 'object'
      || (value.version !== 5 && value.version !== 4)
      || value.sessions === null || typeof value.sessions !== 'object') {
      return emptySearchIndex()
    }
    const sessions: Record<string, SessionIndexRecord> = {}
    for (const [sessionId, record] of Object.entries(value.sessions as Record<string, unknown>)) {
      if (record === null || typeof record !== 'object') continue
      const source = record as { revision?: unknown; entries?: unknown; trashed?: unknown; rail?: unknown; railVersion?: unknown }
      const entries = Array.isArray(source.entries)
        ? source.entries.filter(entry => entry !== null && typeof entry === 'object'
          && typeof entry.id === 'string' && typeof entry.text === 'string')
          .map(entry => ({
            id: entry.id, role: String(entry.role ?? ''), kind: kindOf(entry.kind), text: String(entry.text),
            time: typeof entry.time === 'number' ? entry.time : 0,
            ...(typeof entry.seq === 'number' && Number.isFinite(entry.seq) ? { seq: entry.seq } : {}),
          }))
        : []
      /* 0.1.125：轨道表带语义版本——旧版本表（单页窗口/前缀无 endSeq，真机反例）作废重算，条目不受影响。 */
      const rail = source.railVersion === RAIL_TABLE_VERSION ? railOf(source.rail) : undefined
      sessions[sessionId] = {
        revision: typeof source.revision === 'number' ? source.revision : 0,
        entries,
        ...(source.trashed === true ? { trashed: true } : {}),
        ...(rail === undefined ? {} : { rail, railVersion: RAIL_TABLE_VERSION }),
      }
    }
    return { version: 5, sessions }
  } catch {
    return emptySearchIndex()
  }
}
