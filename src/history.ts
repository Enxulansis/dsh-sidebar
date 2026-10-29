import type { HistoryEntry } from './dsh-client.js'

/** Diagnostic counts: live synthetic chunks are cache records, not durable append-log events. */
export function historySequenceCounts(entries: readonly HistoryEntry[]): { nonnegative: number; negative: number; invalid: number; duplicate: number } {
  const counts = { nonnegative: 0, negative: 0, invalid: 0, duplicate: 0 }
  const seen = new Set<number>()
  for (const { event } of entries) {
    if (!Number.isSafeInteger(event.seq)) { counts.invalid += 1; continue }
    if (event.seq < 0) counts.negative += 1
    else counts.nonnegative += 1
    if (seen.has(event.seq)) counts.duplicate += 1
    else seen.add(event.seq)
  }
  return counts
}

/** Merge backwards history pages with live entries using the append-log sequence as identity. */
export function mergeHistoryEntries(
  current: HistoryEntry[],
  incoming: readonly HistoryEntry[],
): HistoryEntry[] {
  /* 0.1.4 性能（EUV 长会话实测：扩展宿主反复被判定 UNRESPONSIVE——exthost cpuprofile 里
     本函数（Map 全量重建 + 全量 sort）占 2.4s/3.4s 单次卡顿；实时事件逐个合入是热路径（
     112 步轮次 × 数千条历史 × 每事件 O(n log n) → 秒级停顿，running=false 更新被饿死）。
     快路径：单项合入且为"纯追加"（正 seq ≥ 现有最大正 seq，或非正/缺失 seq 的流式合成块）
     → 直接 O(1) 插入/追加，语义与通用路径逐位一致（去重/乱序/批量仍走下方通用路径）。
     2026-10-06（长会话卡顿测量，W3/W4）：真机剖面本函数链占 29%（真数据 18,448 条实测：慢路径
     2.08ms/次、负 seq 块 2.57ms/次），且重放/流式场景几乎全落在慢路径——两条等价性短路见下。 */
  if (incoming.length === 1) {
    const entry = incoming[0]!
    const seq = entry.event.seq
    const isOrdered = typeof seq === 'number' && Number.isFinite(seq) && seq >= 0
    /* 尾部 ∞ 组（负/缺失 seq）起始下标：正 seq 升序区在前，∞ 组恒排尾（0.0.150 不变量）。 */
    let tailStart = current.length
    while (tailStart > 0) {
      const previous = current[tailStart - 1]!.event.seq
      if (typeof previous === 'number' && Number.isFinite(previous) && previous >= 0) break
      tailStart -= 1
    }
    if (isOrdered) {
      /* W3：已存在 seq → 通用路径的结果与 current 逐位等价（去重为"现有胜出" + 稳定排序保持
         既有不变量），二分短路（O(log n)）省掉 Map 全量重建+全量排序——重放/重复事件每轮数百条。 */
      let lo = 0
      let hi = tailStart - 1
      let found = false
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const value = current[mid]!.event.seq
        if (value === seq) { found = true; break }
        if (typeof value === 'number' && value < seq) lo = mid + 1
        else hi = mid - 1
      }
      if (found) return current
      const before = tailStart > 0 ? current[tailStart - 1]!.event.seq : undefined
      if (tailStart === 0 || (typeof before === 'number' && before < seq)) {
        const next = current.slice()
        next.splice(tailStart, 0, entry)
        return next
      }
    } else {
      /* W4：新负/缺 seq 恒排尾——直接追加与通用路径逐位等价（∞ 组内保插入序、整体排尾；
         合成 seq 为客户端全局唯一计数器）。反例（∞ 组已含同 seq，理论不可达）回落通用路径去重；
         缺失 seq 无唯一性，沿用旧条件（已有缺失 seq 即回落）。 */
      const missing = typeof seq !== 'number' || !Number.isFinite(seq)
      let duplicateInTail = false
      let hasMissingInTail = false
      for (let i = tailStart; i < current.length; i += 1) {
        const value = current[i]!.event.seq
        if (value === seq) { duplicateInTail = true; break }
        if (typeof value !== 'number' || !Number.isFinite(value)) hasMissingInTail = true
      }
      if (!duplicateInTail && (!missing || !hasMissingInTail)) {
        return [...current, entry]
      }
    }
  }
  const bySequence = new Map<number, HistoryEntry>()
  for (const entry of current) bySequence.set(entry.event.seq, entry)
  for (const entry of incoming) if (!bySequence.has(entry.event.seq)) bySequence.set(entry.event.seq, entry)
  /* 0.0.150（实测：运行时点轨道节点 → 正在流式的 AI 回复被顶到对话最顶部）：
     流式增量是**合成事件、seq 取负值**（dsh-client `seq: -(++chunkSeq)`），本质是"此刻"而非历史——
     旧比较器按数值升序把它们排到最前，随后 projector.reset(historyEntries)（翻页/跳转触发）重放时
     流式消息第一个进场 → 整条对话错位且持久（负 seq 一直留在表里）。非正/缺失 seq 一律视为 +∞
     （排尾），数值域内保持升序。 */
  const orderKey = (item: HistoryEntry): number => {
    const seq = item.event.seq
    return typeof seq === 'number' && Number.isFinite(seq) && seq >= 0 ? seq : Number.POSITIVE_INFINITY
  }
  return [...bySequence.values()].sort((left, right) => {
    const a = orderKey(left)
    const b = orderKey(right)
    if (a === b) return 0
    return a < b ? -1 : 1
  })
}

/** 2026-10-06（S3/摊销，性能）：实时事件**就地合入**——快路径不再整表 slice 拷贝
    （真机剖面：13.6k 条目 × 每事件全量拷贝 ≈ 21.8s/285s）。分支语义与 mergeHistoryEntries 快路径
    逐条对齐；需慢路径（乱序/重复/缺失 seq 等）时回落不可变通用路径。
    **仅供独占持有 `current` 的调用方**（acceptFrame 的 historyEntries）。共享引用方已审计：
    rememberHistoryWindow 缓存随变更可见（该引用本就每次事件重记，且切走后不再变更）=可接受且更完整；
    其余读取方（reset/unseen/最早-最新 seq 扫描/contextDetailImages）均只读即时消费，无快照假设。 */
export function appendLiveEntry(current: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const seq = entry.event.seq
  const isOrdered = typeof seq === 'number' && Number.isFinite(seq) && seq >= 0
  /* 尾部 ∞ 组（负/缺失 seq）起始下标：正 seq 升序区在前，∞ 组恒排尾（0.0.150 不变量）。 */
  let tailStart = current.length
  while (tailStart > 0) {
    const previous = current[tailStart - 1]!.event.seq
    if (typeof previous === 'number' && Number.isFinite(previous) && previous >= 0) break
    tailStart -= 1
  }
  if (isOrdered) {
    /* 二分找 lower_bound（正序区内）：命中 → 原样返回（W3 同款）；未命中 → lo 即插入点，
       直接就地 splice（中段插入/尾部追加/∞ 组前插入三态统一，无需再判 before）。 */
    let lo = 0
    let hi = tailStart - 1
    let found = false
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const value = current[mid]!.event.seq
      if (value === seq) { found = true; break }
      if (typeof value === 'number' && value < seq) lo = mid + 1
      else hi = mid - 1
    }
    if (found) return current
    current.splice(lo, 0, entry)
    return current
  } else {
    const missing = typeof seq !== 'number' || !Number.isFinite(seq)
    let duplicateInTail = false
    let hasMissingInTail = false
    for (let i = tailStart; i < current.length; i += 1) {
      const value = current[i]!.event.seq
      if (value === seq) { duplicateInTail = true; break }
      if (typeof value !== 'number' || !Number.isFinite(value)) hasMissingInTail = true
    }
    if (!duplicateInTail && (!missing || !hasMissingInTail)) {
      current.push(entry)
      return current
    }
  }
  return mergeHistoryEntries(current, [entry])
}

/** Keep only entries whose append-log sequence has not already been loaded. */
export function unseenHistoryEntries(
  current: readonly HistoryEntry[],
  incoming: readonly HistoryEntry[],
): HistoryEntry[] {
  const seen = new Set(current.map(entry => entry.event.seq))
  return incoming.filter((entry) => {
    if (seen.has(entry.event.seq)) return false
    seen.add(entry.event.seq)
    return true
  })
}

export function earliestHistorySequence(entries: readonly HistoryEntry[]): number | undefined {
  let earliest: number | undefined
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.event.seq) || entry.event.seq < 0) continue
    if (earliest === undefined || entry.event.seq < earliest) earliest = entry.event.seq
  }
  return earliest
}

/** 0.0.154（O3）：窗口缓存命中（catch-up 合并）后的 hasMore 归属——
    页面比缓存更深（页最早 seq < 缓存最早 seq，或缓存为空）→ 窗最早点来自页面，取 pageHasMore；
    否则窗最早点仍是缓存的 → 取 cachedHasMore（page 的 hasMore 谈的是它自己的更早处，与合并窗无关）。 */
export function mergedWindowHasMore(
  pageEarliest: number | undefined,
  cachedEarliest: number | undefined,
  pageHasMore: boolean,
  cachedHasMore: boolean,
): boolean {
  const deeperFromPage = pageEarliest !== undefined && (cachedEarliest === undefined || pageEarliest < cachedEarliest)
  return deeperFromPage ? pageHasMore : cachedHasMore
}

/** 0.1.53（D6-0）：窗口缓存尾部的最大 seq（与 earliest 同口径：跳过合成块的非正/非法 seq）。 */
export function latestHistorySequence(entries: readonly HistoryEntry[]): number | undefined {
  let latest: number | undefined
  for (const entry of entries) {
    const seq = entry.event.seq
    if (!Number.isSafeInteger(seq) || seq < 0) continue
    if (latest === undefined || seq > latest) latest = seq
  }
  return latest
}

/** 0.1.53（D6-0）：catch-up **小页**是否与缓存尾部接得上。
    判定：页内最早 seq ≤ 缓存最新 seq + 1 ⇒ 有重叠/相邻（安全）。
    以下视为接得上（无需回退）：页 hasMore=false（整会话都在这一页内）、页内无可用 seq、缓存无可用 seq。
    接不上 ⇒ 调用方回退为全量大页（最坏 = 旧行为，**不会读到错数据**）。 */
export function catchUpCoversTail(cached: readonly HistoryEntry[], page: readonly HistoryEntry[], pageHasMore: boolean): boolean {
  if (pageHasMore !== true) return true
  const cachedLatest = latestHistorySequence(cached)
  const pageEarliest = earliestHistorySequence(page)
  if (cachedLatest === undefined || pageEarliest === undefined) return true
  return pageEarliest <= cachedLatest + 1
}
