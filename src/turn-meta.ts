import type { DshEvent } from './conversation.js'
import type { MessageMeta } from './conversation.js'

/**
 * G5 (0.0.39) turn 级元信息打点器：纯状态机（无 vscode 依赖，可单测）。
 * - mark()：按事件流顺序推进——user/message 开 turn、assistant/chunk(text-delta) 建 draft、
 *   assistant/message 结算 durationMs（+ 挂上 pending 的 tokS）。
 * - ingestStats()：sessionStats 快照差分 → tok/s；有流式 assistant 直接挂，否则 pending 待结算。
 * - 恢复路径用法：对历史事件按序整体重放 mark() 即可重建（tokS 是实时差分开销，不可恢复）。
 */
export interface MetaDraft {
  startTime: number
  firstTokenMs?: number
  durationMs?: number
  tokS?: number
}

export class TurnMetaTracker {
  private readonly drafts = new Map<string, MetaDraft>()
  private userTime: number | undefined
  /* 0.1.10（用户反馈"首 token 60 秒"）：**步骤起点**表（turn:step → 时间）。
     首 token 的基线必须是"该步开始"，不是"上一条用户消息"——长轮次里后面的步骤
     距用户消息可达数分钟（真机实测 445–533s），旧口径把整轮等待全算进首 token。 */
  private readonly stepStarts = new Map<string, number>()
  private openAssistantId: string | undefined
  private lastSettledId: string | undefined
  private statsAcc: { decodeTokens: number; decodeMs: number } | undefined
  private pendingTokS: number | undefined

  clear(): void {
    this.drafts.clear()
    this.userTime = undefined
    this.stepStarts.clear()
    this.openAssistantId = undefined
    this.lastSettledId = undefined
    this.statsAcc = undefined
    this.pendingTokS = undefined
  }

  mark(event: DshEvent): void {
    const data = typeof event.data === 'object' && event.data !== null
      ? event.data as Record<string, unknown>
      : undefined
    if (event.type === 'user/message') {
      this.userTime = event.time
      this.openAssistantId = undefined
      return
    }
    const turn = typeof data?.turn === 'number' ? data.turn : 0
    const step = typeof data?.step === 'number' ? data.step : 0
    const id = `assistant:${String(turn)}:${String(step)}`
    if (event.type === 'step/start') {
      if (!this.stepStarts.has(id)) this.stepStarts.set(id, event.time)
      return
    }
    const firstTokenOf = (chunkTime: number): { firstTokenMs?: number } => {
      const anchor = this.stepStarts.get(id) ?? this.userTime
      return anchor === undefined ? {} : { firstTokenMs: Math.max(0, chunkTime - anchor) }
    }
    if (event.type === 'assistant/chunk') {
      const chunk = data?.chunk
      const textDelta = typeof chunk === 'object' && chunk !== null
        && (chunk as Record<string, unknown>).type === 'text-delta'
      if (!textDelta) return
      if (!this.drafts.has(id)) {
        this.drafts.set(id, { startTime: event.time, ...firstTokenOf(event.time) })
        this.openAssistantId = id
      }
      return
    }
    if (event.type === 'assistant/message') {
      /* 0.1.5：会话日志无独立 assistant/chunk 事件，chunk 内嵌在 data.stream
         （历史加载/重放路径不会先收到流式帧）——先从 stream 重放 text-delta 以重建 draft。
         实时路径 draft 已由 assistant-stream 合成帧建立（drafts.has 命中即跳过，幂等）。 */
      const stream = Array.isArray(data?.stream) ? data.stream : []
      if (!this.drafts.has(id)) {
        for (const item of stream) {
          const record = typeof item === 'object' && item !== null ? item as Record<string, unknown> : undefined
          if (record === undefined) continue
          /* 0.0.131：0.1.5 历史日志把文本/推理压缩成 { type:'text-chunks'|'reasoning-chunks', time0, dt, texts[] }；
             旧实现只认字面 text-delta → 历史重放恒 0 条 draft（真会话实证：119 条带文本消息全无 meta），
             胶囊"用时/首 token"在旧会话整体缺失。以首个 text-chunks 的 time0 作 startTime，
             语义与实时路径"首个文本增量"一致。 */
          const chunk = record.chunk
          const isTextDelta = typeof chunk === 'object' && chunk !== null
            && (chunk as Record<string, unknown>).type === 'text-delta'
          if (!isTextDelta && record.type !== 'text-chunks') continue
          const chunkTime = typeof record.time === 'number'
            ? record.time
            : (typeof record.time0 === 'number' ? record.time0 : event.time)
          this.drafts.set(id, { startTime: chunkTime, ...firstTokenOf(chunkTime) })
          break
        }
      }
      const draft = this.drafts.get(id)
      if (draft === undefined) return
      if (this.openAssistantId === id) this.openAssistantId = undefined
      /* 2026-10-06（S3，性能）：**替换式写**（不再就地改值）——draft 对象身份即"内容版本"，
         metaOf 的弱键记忆据此自动失效（见 metaOf 注释）。 */
      const next: MetaDraft = {
        ...draft,
        durationMs: Math.max(0, event.time - draft.startTime),
        ...(draft.tokS === undefined && this.pendingTokS !== undefined ? { tokS: this.pendingTokS } : {}),
      }
      this.drafts.set(id, next)
      if (draft.tokS === undefined && this.pendingTokS !== undefined) this.pendingTokS = undefined
      this.lastSettledId = id
    }
  }

  ingestStats(stats: unknown): void {
    /* 真实会话实证（~/.dsh/storages/session_projcache.json, 2026-09-08）：
       sessionStats 快照 = {ver, seq, val: {turns, steps, llmMs, toolMs, ttftMs, ttftSteps,
       decodeMs, decodeTokens, ...}}（投影行壳）——直接读 decodeTokens 得 undefined，
       首版 tok/s 从不产生。兼容 val 直供与壳两种形态。 */
    const wrapped = typeof stats === 'object' && stats !== null ? stats as Record<string, unknown> : undefined
    const val = wrapped?.val
    const record = typeof val === 'object' && val !== null ? val as Record<string, unknown> : wrapped
    const decodeTokens = typeof record?.decodeTokens === 'number' ? record.decodeTokens : undefined
    const decodeMs = typeof record?.decodeMs === 'number' ? record.decodeMs : undefined
    if (decodeTokens === undefined || decodeMs === undefined) return
    const acc = this.statsAcc
    this.statsAcc = { decodeTokens, decodeMs }
    if (acc === undefined) return
    const deltaTokens = decodeTokens - acc.decodeTokens
    const deltaMs = decodeMs - acc.decodeMs
    if (deltaTokens <= 0 || deltaMs <= 0) return
    const tokS = deltaTokens / (deltaMs / 1000)
    if (this.openAssistantId !== undefined) {
      const draft = this.drafts.get(this.openAssistantId)
      /* 替换式写（S3 同源）：对象换新 ⇒ metaOf 记忆自动失效。 */
      if (draft !== undefined && draft.tokS === undefined) this.drafts.set(this.openAssistantId, { ...draft, tokS })
    } else if (this.lastSettledId !== undefined) {
      /* stats 帧晚于 assistant/message 到达 → 回填刚结算的 turn（实测帧序：finish 后 stats
         先于结算，open 分支常命中；此分支防御多 turn 交错与晚到） */
      const last = this.drafts.get(this.lastSettledId)
      if (last !== undefined && last.tokS === undefined) this.drafts.set(this.lastSettledId, { ...last, tokS })
      else this.pendingTokS = tokS
    } else {
      this.pendingTokS = tokS
    }
  }

  /* 2026-10-06（S3，性能）：metaOf 弱键记忆——draft 为**替换式写**（身份即内容版本），
     同一 draft 对象 ⇒ 同一 meta（对象身份稳定，供上层视图缓存的键比较）。null = 已算过"无 meta"。 */
  private readonly metaMemo = new WeakMap<MetaDraft, MessageMeta | null>()

  /** 无时长（≤0）且无 tok/s 视为无 meta；仅 tok/s（历史重放/记忆回填）也产出。 */
  metaOf(id: string): MessageMeta | undefined {
    const draft = this.drafts.get(id)
    if (draft === undefined) return undefined
    const cached = this.metaMemo.get(draft)
    if (cached !== undefined) return cached ?? undefined
    const hasDuration = (draft.durationMs ?? 0) > 0
    const hasTokS = draft.tokS !== undefined
    const meta: MessageMeta | undefined = !hasDuration && !hasTokS ? undefined : {
      ...(hasDuration ? { durationMs: draft.durationMs } : {}),
      ...(draft.firstTokenMs === undefined ? {} : { firstTokenMs: draft.firstTokenMs }),
      ...(draft.tokS === undefined ? {} : { tokS: draft.tokS }),
    }
    this.metaMemo.set(draft, meta ?? null)
    return meta
  }
}