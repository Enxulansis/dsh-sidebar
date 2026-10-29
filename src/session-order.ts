export interface SessionTabItem {
  id: string
  title: string
  running: boolean
  blank: boolean
}

/** G24: moves `movedId` right after `afterId` (tab order = render order).
 *  Missing ids are tolerated and an already-placed item is left as-is:
 *  the original reference is returned so callers can skip a republish. */
export function insertSessionAfter(sessions: readonly SessionTabItem[], movedId: string, afterId: string): SessionTabItem[] {
  const idx = sessions.findIndex(item => item.id === movedId)
  const afterIdx = sessions.findIndex(item => item.id === afterId)
  if (idx < 0 || afterIdx < 0 || idx === afterIdx + 1) return sessions as SessionTabItem[]
  const list = [...sessions]
  const [item] = list.splice(idx, 1)
  const at = list.findIndex(rest => rest.id === afterId) + 1
  list.splice(at, 0, item as SessionTabItem)
  return list
}

/** G5 v9: moves `movedId` to just before `beforeId` (drop-before semantics;
 *  `beforeId` 缺省 = 移到末尾). 缺失 id 容忍、已就位时返回原引用（调用方可跳过 republish）。
 *  泛型 T 只需带 `id`（SessionItem / 包装过的 SessionSummary 均可）。 */
export function moveSessionBefore<T extends { id: string }>(sessions: readonly T[], movedId: string, beforeId?: string): T[] {
  const idx = sessions.findIndex(item => item.id === movedId)
  if (idx < 0) return sessions as T[]
  const rest = [...sessions]
  const [item] = rest.splice(idx, 1)
  let at: number
  if (beforeId === undefined) {
    if (idx === sessions.length - 1) return sessions as T[]
    at = rest.length
  } else {
    at = rest.findIndex(candidate => candidate.id === beforeId)
    if (at < 0 || at === idx) return sessions as T[]
  }
  rest.splice(at, 0, item as T)
  return rest
}

/** G5 v9: 按持久化顺序 `order` 重排 `list`；order 未收录的 id 保持原相对顺序排到尾部
 *  （Array.sort 稳定）。顺序未变时返回原引用。 */
export function orderSessions<T extends { id: string }>(list: readonly T[], order: readonly string[]): T[] {
  const position = new Map<string, number>()
  order.forEach((id, index) => position.set(id, index))
  const sorted = [...list].sort((a, b) => {
    const pa = position.get(a.id)
    const pb = position.get(b.id)
    if (pa === undefined && pb === undefined) return 0
    if (pa === undefined) return 1
    if (pb === undefined) return -1
    return pa - pb
  })
  for (let i = 0; i < list.length; i += 1) {
    if (list[i]!.id !== sorted[i]!.id) return sorted
  }
  return list as T[]
}
