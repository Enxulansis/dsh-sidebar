/* 精准计费（0.0.85 / G9）——价表（带时点边界）与"按事件时刻分段"的账本。
   一手来源：官方定价页（2026-09-12 抓取，快照 _temp/inbox/ds_pricing.html）：
   - 现行价（2026-09-10 12:00 北京时间起）：V4.1-Flash 空闲 命中 0.02 / 未命中 1 / 输出 4（CNY/百万，峰价 ×2）；
     V4-Pro-0813 空闲 0.15 / 4.5 / 13.5（峰 ×2）；9/14 后 Pro 计费保持不变（官方页备注(2)）。
   - 8 月旧价（09-10 之前）：Flash 0.05 / 1.5 / 4.5，Pro 0.15 / 4.5 / 13.5（谷），峰 ×2。
   官方未单列 cache write 价：按参考实现（dsh-cost-meter）口径并入**命中桶**。
   峰时段：北京时间周一至周五 09:00–12:00、14:00–18:00；其余（含周末全天）为空闲半价。 */

export type ModelFamily = 'flash' | 'pro'
export interface PriceTier { hit: number; miss: number; out: number }
export interface FamilyPrices { peak: PriceTier; off: PriceTier }

const AUGUST: Record<ModelFamily, FamilyPrices> = {
  flash: { peak: { hit: 0.1, miss: 3, out: 9 }, off: { hit: 0.05, miss: 1.5, out: 4.5 } },
  pro: { peak: { hit: 0.3, miss: 9, out: 27 }, off: { hit: 0.15, miss: 4.5, out: 13.5 } },
}
const SEPTEMBER: Record<ModelFamily, FamilyPrices> = {
  flash: { peak: { hit: 0.04, miss: 2, out: 8 }, off: { hit: 0.02, miss: 1, out: 4 } },
  pro: { peak: { hit: 0.3, miss: 9, out: 27 }, off: { hit: 0.15, miss: 4.5, out: 13.5 } },
}

/** 计价时代（半开区间 [from, until)；until=Infinity 为现行价）。 */
export interface PriceEra { id: string; label: string; from: number; until: number; prices: Record<ModelFamily, FamilyPrices> }
export const PRICE_ERAS: readonly PriceEra[] = [
  { id: 'aug', label: '8月价', from: -Infinity, until: Date.parse('2026-09-10T04:00:00Z'), prices: AUGUST },
  { id: 'sep', label: '现行价', from: Date.parse('2026-09-10T04:00:00Z'), until: Infinity, prices: SEPTEMBER },
]

export function eraAt(atMs: number): PriceEra {
  return PRICE_ERAS.find((era) => atMs >= era.from && atMs < era.until) ?? PRICE_ERAS[PRICE_ERAS.length - 1]!
}

export function priceAt(family: ModelFamily, peak: boolean, atMs: number): PriceTier {
  const tier = eraAt(atMs).prices[family]
  return peak ? tier.peak : tier.off
}

/** 模型 → 价目族（与面板既有约定一致：名含 pro 走 pro 价，其余（flash / vision 系列）走 flash 价）。 */
export function familyOfModel(modelId: string | undefined): ModelFamily {
  return /pro/i.test(String(modelId ?? '')) ? 'pro' : 'flash'
}

const DEEPSEEK_PRICED_ROUTES = new Set(['deepseek-official', 'deepseek-vision', 'deepseek-modlens', 'deepseek-modlens-vision'])
export function hasDeepSeekPricing(provider: string | undefined, model: string | undefined): boolean {
  return (provider === undefined || DEEPSEEK_PRICED_ROUTES.has(provider))
    && (model === undefined || /^deepseek-(?:v4(?:\.1)?-)?(?:flash|pro)(?:-|$)/i.test(model))
}

/** 北京时间是否处于高峰时段（UTC+8，无夏令时；周末全天空闲）。 */
export function isPeakAt(atMs: number): boolean {
  if (!Number.isFinite(atMs)) return false
  const bj = new Date(atMs + 8 * 3600 * 1000)
  const weekday = bj.getUTCDay() /* 0=周日 */
  if (weekday === 0 || weekday === 6) return false
  const minutes = bj.getUTCHours() * 60 + bj.getUTCMinutes()
  const within = (from: number, to: number) => minutes >= from * 60 && minutes < to * 60
  return within(9, 12) || within(14, 18)
}

export interface UsageBuckets { uncachedInput: number; output: number; cacheRead: number; cacheWrite: number }
export const emptyBuckets = (): UsageBuckets => ({ uncachedInput: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

export interface UsageSegment {
  family: ModelFamily
  peak: boolean
  era: string
  buckets: UsageBuckets
}

export interface UsageCostBreakdown {
  /** 命中桶（cacheRead + cacheWrite）金额。 */
  hit: number
  /** 未命中桶（uncachedInput）金额。 */
  miss: number
  /** 输出桶金额。 */
  out: number
  total: number
}

const taskTokens = (buckets: UsageBuckets): { hit: number; miss: number; out: number } => ({
  hit: (buckets.cacheRead + buckets.cacheWrite) / 1e6,
  miss: buckets.uncachedInput / 1e6,
  out: buckets.output / 1e6,
})

/** 单段计价：点的价取该段**自身时刻**（era 由段记录）与**自身模型族**。 */
export function costOfSegment(segment: UsageSegment): UsageCostBreakdown {
  const era = PRICE_ERAS.find((item) => item.id === segment.era) ?? eraAt(Date.now())
  const price = segment.peak ? era.prices[segment.family].peak : era.prices[segment.family].off
  const tokens = taskTokens(segment.buckets)
  const hit = tokens.hit * price.hit
  const miss = tokens.miss * price.miss
  const out = tokens.out * price.out
  return { hit, miss, out, total: hit + miss + out }
}

export function sumCost(parts: readonly UsageCostBreakdown[]): UsageCostBreakdown {
  return parts.reduce((acc, item) => ({
    hit: acc.hit + item.hit, miss: acc.miss + item.miss, out: acc.out + item.out, total: acc.total + item.total,
  }), { hit: 0, miss: 0, out: 0, total: 0 })
}

const addBuckets = (target: UsageBuckets, source: UsageBuckets, sign: number): void => {
  target.uncachedInput += sign * source.uncachedInput
  target.output += sign * source.output
  target.cacheRead += sign * source.cacheRead
  target.cacheWrite += sign * source.cacheWrite
}

/* 0.1.10（用户反馈「价格统计有大问题」）：与运行时 token-meter 折叠口径对齐 + 压缩摘要。
   - assistant/message / assistant/attempt：usage 可能在 data.usage，也可能在 data.stream 的
     **最后一个** usage 块里（历史日志形态；运行时 usageOf 的同一规则）。
   - compaction/summary：摘要调用自带 data.usage（无 turn/step）→ 键用 compactionId。 */
function usageOfEvent(type: string, data: Record<string, unknown>): Record<string, unknown> | undefined {
  const record = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
  if (type === 'assistant/chunk') {
    const chunk = record(data.chunk)
    return chunk?.type === 'usage' ? record(chunk.usage) : undefined
  }
  if (type === 'assistant/message' || type === 'assistant/attempt') {
    const direct = record(data.usage)
    if (direct !== undefined) return direct
    const stream = Array.isArray(data.stream) ? data.stream : []
    for (let i = stream.length - 1; i >= 0; i -= 1) {
      const item = record(stream[i])
      const chunk = record(item?.chunk)
      if (chunk?.type === 'usage') {
        const usage = record(chunk.usage)
        if (usage !== undefined) return usage
      }
    }
    return undefined
  }
  if (type === 'compaction/summary') return record(data.usage)
  return undefined
}

function usageKeyOfEvent(type: string, data: Record<string, unknown>, seq: unknown): string | undefined {
  if (type === 'compaction/summary') {
    const id = typeof data.compactionId === 'string' && data.compactionId !== ''
      ? data.compactionId
      : (typeof seq === 'number' ? 'seq:' + String(seq) : undefined)
    return id === undefined ? undefined : 'c:' + id
  }
  return `${String(data.turn ?? 0)}:${String(data.step ?? 0)}`
}

/**
 * 逐事件账本：按 (turn, step) 替换语义累计（幂等，重放/重连不重复计），
 * 段键 = 模型族 × 峰谷 × 价表时代 —— 落段时取**该事件时刻**的判定。
 */
export class UsageLedger {
  private readonly steps = new Map<string, UsageBuckets>()
  private readonly segments = new Map<string, UsageSegment>()
  private model: string | undefined
  private unpriced = false
  get hasUnpricedUsage(): boolean { return this.unpriced }

  /** 处理一条会话事件（形如 { type, time, data, seq }）；认三类带 usage 的事件：
      - `assistant/chunk`（流式 usage 块；实时链路）
      - `assistant/message` / `assistant/attempt`（结算事件：`data.usage` 或 `data.stream` 里**最后一个** usage 块；
        **历史重放的主口径**——持久日志里没有 assistant/chunk，旧实现因此覆盖率恒为 0，0.1.10 修复）
      - `compaction/summary`（压缩摘要调用，键 = compactionId——同样要计费） */
  applyEvent(event: { type?: unknown; time?: unknown; data?: unknown; seq?: unknown }): void {
    const type = typeof event.type === 'string' ? event.type : ''
    const data = typeof event.data === 'object' && event.data !== null ? event.data as Record<string, unknown> : undefined
    if (data === undefined) return
    if (type === 'request/header') {
      const header = typeof data.header === 'object' && data.header !== null ? data.header as Record<string, unknown> : undefined
      const config = typeof header?.config === 'object' && header.config !== null ? header.config as Record<string, unknown> : undefined
      if (typeof config?.model === 'string' && config.model !== '') this.model = config.model
      if (config !== undefined && !hasDeepSeekPricing(typeof config.provider === 'string' ? config.provider : undefined, typeof config.model === 'string' ? config.model : undefined)) this.unpriced = true
      return
    }
    const usage = usageOfEvent(type, data)
    if (usage === undefined) return
    const key = usageKeyOfEvent(type, data, event.seq)
    if (key === undefined) return
    const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)
    const next: UsageBuckets = {
      uncachedInput: num(usage.inputTokens),
      output: num(usage.outputTokens),
      cacheRead: num(usage.cacheReadTokens),
      cacheWrite: num(usage.cacheWriteTokens),
    }
    const previous = this.steps.get(key)
    const atMs = typeof event.time === 'number' ? event.time : Date.now()
    const family = familyOfModel(this.model)
    const peak = isPeakAt(atMs)
    const era = eraAt(atMs).id
    const segmentKey = `${family}|${peak ? 'peak' : 'off'}|${era}`
    let segment = this.segments.get(segmentKey)
    if (segment === undefined) {
      segment = { family, peak, era, buckets: emptyBuckets() }
      this.segments.set(segmentKey, segment)
    }
    if (previous !== undefined) addBuckets(segment.buckets, previous, -1)
    addBuckets(segment.buckets, next, 1)
    this.steps.set(key, next)
  }

  /** 有 token 的段（按族/峰谷/时代聚合），用于计价与展示。 */
  list(): UsageSegment[] {
    return [...this.segments.values()]
      .filter((segment) => segment.buckets.uncachedInput + segment.buckets.output + segment.buckets.cacheRead + segment.buckets.cacheWrite > 0)
  }

  /** 账本覆盖的桶合计（与运行时投影对齐用于算"未覆盖残留"）。 */
  covered(): UsageBuckets {
    const total = emptyBuckets()
    for (const segment of this.segments.values()) addBuckets(total, segment.buckets, 1)
    return total
  }

  cost(): { segments: UsageSegment[]; breakdown: UsageCostBreakdown } {
    const segments = this.list()
    return { segments, breakdown: sumCost(segments.map(costOfSegment)) }
  }
}

/** 面板展示用：金额格式（与既有 formatCost 一致）。 */
export function formatCost(value: number): string {
  return value >= 1 ? value.toFixed(2) : value.toPrecision(2)
}

/** 一段的 token 明细（面板行用）。 */
export interface UsageCostRow {
  family: ModelFamily
  peak: boolean
  era: string
  tokens: { hit: number; miss: number; out: number }
  cost: UsageCostBreakdown
}

export interface CostMeterView {
  /** dsh-cost-meter 的 costUsage 投影总额。 */
  cost: number
  byModel: Record<string, number>
  byProviderModel?: Record<string, number>
}

export interface UsageCostState {
  pricingUnavailable?: boolean
  rows: UsageCostRow[]
  total: UsageCostBreakdown
  /** 账本覆盖的 token 数（四桶合计）。 */
  coveredTokens: number
  /** 运行时投影总量 − 账本覆盖量（>0 时说明有历史未回放：按现行价估算并标注）。 */
  unsegmentedTokens: number
  unsegmentedCost: number
  /** 装了 dsh-cost-meter 时其投影值（只读展示，来源标注）。 */
  costMeter?: CostMeterView
}

export function rowOfSegment(segment: UsageSegment): UsageCostRow {
  return {
    family: segment.family,
    peak: segment.peak,
    era: segment.era,
    tokens: {
      hit: segment.buckets.cacheRead + segment.buckets.cacheWrite,
      miss: segment.buckets.uncachedInput,
      out: segment.buckets.output,
    },
    cost: costOfSegment(segment),
  }
}

const numberAt = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

/** 组装面板要用的费用状态：分段账本 + 未覆盖残留（按现行价估算）+（可选）cost-meter 投影。 */
export function usageCostStateOf(
  ledger: UsageLedger,
  tokenUsage: { uncachedInputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number } | undefined,
  costMeterValue: unknown,
  fallback: { family: ModelFamily; peak: boolean; atMs: number; priced?: boolean },
): UsageCostState {
  if (ledger.hasUnpricedUsage || fallback.priced === false) {
    return { pricingUnavailable: true, rows: [], total: sumCost([]), coveredTokens: 0, unsegmentedTokens: 0, unsegmentedCost: 0 }
  }
  const segments = ledger.list()
  const rows = segments.map(rowOfSegment)
  const total = sumCost(rows.map((row) => row.cost))
  const coveredBuckets = ledger.covered()
  const coveredTokens = coveredBuckets.uncachedInput + coveredBuckets.output + coveredBuckets.cacheRead + coveredBuckets.cacheWrite
  const projectedTokens = tokenUsage === undefined
    ? coveredTokens
    : tokenUsage.uncachedInputTokens + tokenUsage.outputTokens + tokenUsage.cacheReadTokens + tokenUsage.cacheWriteTokens
  const unsegmentedTokens = Math.max(0, projectedTokens - coveredTokens)
  const price = priceAt(fallback.family, fallback.peak, fallback.atMs)
  /* 0.1.10（用户反馈）：残留估算**按已覆盖桶的构成比例**折算（把历史整体按未命中价算会放大 ~50×——
     长会话绝大多数 token 是缓存命中 0.02/百万）；没有任何覆盖数据时退回未命中价（保守）。 */
  let unsegmentedCost: number
  if (unsegmentedTokens <= 0) unsegmentedCost = 0
  else if (coveredTokens <= 0) unsegmentedCost = (unsegmentedTokens / 1e6) * price.miss
  else {
    const hitTokens = coveredBuckets.cacheRead + coveredBuckets.cacheWrite
    const mix: UsageBuckets = {
      uncachedInput: unsegmentedTokens * (coveredBuckets.uncachedInput / coveredTokens),
      output: unsegmentedTokens * (coveredBuckets.output / coveredTokens),
      cacheRead: unsegmentedTokens * (hitTokens / coveredTokens),
      cacheWrite: 0,
    }
    unsegmentedCost = costOfSegment({ family: fallback.family, peak: fallback.peak, era: eraAt(fallback.atMs).id, buckets: mix }).total
  }
  const state: UsageCostState = {
    rows,
    total,
    coveredTokens,
    unsegmentedTokens,
    unsegmentedCost,
  }
  const meter = typeof costMeterValue === 'object' && costMeterValue !== null ? costMeterValue as Record<string, unknown> : undefined
  if (meter !== undefined && typeof meter.cost === 'number') {
    const byModel: Record<string, number> = {}
    const rawByModel = typeof meter.byModel === 'object' && meter.byModel !== null ? meter.byModel as Record<string, unknown> : {}
    for (const [model, bucket] of Object.entries(rawByModel)) {
      const entry = typeof bucket === 'object' && bucket !== null ? bucket as Record<string, unknown> : undefined
      byModel[model] = numberAt(entry?.cost)
    }
    state.costMeter = { cost: numberAt(meter.cost), byModel }
  }
  return state
}
