import type { MessageMeta } from './conversation.js'

/**
 * G5 (0.0.39 v4) 胶囊记忆：tokS / 用时（durationMs）/ 首 token（firstTokenMs）都是实时帧
 * 差分的产物，恢复路径重建 meta 时无法重算（历史事件流里只有 token 计数、没有时延）→
 * 把实时算出的三项按 会话×assistant 记住，恢复/切换会话时补回。
 * 0.0.123：由"只记 tokS"扩展为三项都记（用户反馈：切回会话只剩 tok/s，希望与实时一致）。
 * 纯模块（无 vscode 依赖），持久化由 extension 委托 globalState；旧数据（数字=tokS）兼容读。
 */
export interface RememberedMeta {
  tokS?: number
  durationMs?: number
  firstTokenMs?: number
}

export type TurnTokSMemory = Map<string, Map<string, RememberedMeta>>

/** 记录三项；值变化才写（返回 true=发生变化，extension 据此决定是否持久化）。 */
export function rememberMeta(
  memory: TurnTokSMemory,
  sessionId: string,
  assistantId: string,
  meta: RememberedMeta,
): boolean {
  let per = memory.get(sessionId)
  if (per === undefined) {
    per = new Map()
    memory.set(sessionId, per)
  }
  const previous = per.get(assistantId)
  const next: RememberedMeta = { ...previous, ...Object.fromEntries(Object.entries(meta).filter(([, value]) => typeof value === 'number' && Number.isFinite(value))) }
  const changed = previous === undefined
    || previous.tokS !== next.tokS || previous.durationMs !== next.durationMs || previous.firstTokenMs !== next.firstTokenMs
  if (!changed) return false
  per.set(assistantId, next)
  return true
}

export function rememberedMeta(
  memory: TurnTokSMemory,
  sessionId: string,
  assistantId: string,
): RememberedMeta | undefined {
  return memory.get(sessionId)?.get(assistantId)
}

export function memoryToPlain(memory: TurnTokSMemory): Record<string, Record<string, RememberedMeta>> {
  const plain: Record<string, Record<string, RememberedMeta>> = {}
  for (const [sessionId, per] of memory) plain[sessionId] = Object.fromEntries(per)
  return plain
}

export function memoryFromPlain(plain: unknown): TurnTokSMemory {
  const memory: TurnTokSMemory = new Map()
  if (typeof plain !== 'object' || plain === null) return memory
  for (const [sessionId, per] of Object.entries(plain as Record<string, unknown>)) {
    const inner = new Map<string, RememberedMeta>()
    if (typeof per === 'object' && per !== null) {
      for (const [assistantId, value] of Object.entries(per as Record<string, unknown>)) {
        /* 兼容旧格式：数字 = tokS。 */
        if (typeof value === 'number' && Number.isFinite(value)) inner.set(assistantId, { tokS: value })
        else if (typeof value === 'object' && value !== null) {
          const entry = value as Record<string, unknown>
          const next: RememberedMeta = {}
          if (typeof entry.tokS === 'number' && Number.isFinite(entry.tokS)) next.tokS = entry.tokS
          if (typeof entry.durationMs === 'number' && Number.isFinite(entry.durationMs)) next.durationMs = entry.durationMs
          if (typeof entry.firstTokenMs === 'number' && Number.isFinite(entry.firstTokenMs)) next.firstTokenMs = entry.firstTokenMs
          if (Object.keys(next).length > 0) inner.set(assistantId, next)
        }
      }
    }
    memory.set(sessionId, inner)
  }
  return memory
}

/** 恢复路径 meta 缺项 → 用记忆补回；实时差分值优先（记忆只补 undefined 项）。 */
export function mergeRememberedMeta(
  candidate: MessageMeta | undefined,
  remembered: RememberedMeta | undefined,
): MessageMeta | undefined {
  if (remembered === undefined) return candidate
  const next: MessageMeta = { ...(candidate ?? {}) }
  if (next.tokS === undefined && remembered.tokS !== undefined) next.tokS = remembered.tokS
  if (next.durationMs === undefined && remembered.durationMs !== undefined) next.durationMs = remembered.durationMs
  if (next.firstTokenMs === undefined && remembered.firstTokenMs !== undefined) next.firstTokenMs = remembered.firstTokenMs
  return next
}