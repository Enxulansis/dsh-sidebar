import { describe, expect, it } from 'vitest'
import { UsageLedger, costOfSegment, eraAt, familyOfModel, isPeakAt, priceAt, usageCostStateOf, PRICE_ERAS } from '../src/usage-cost.js'

/* 精准计费（J1–J3）——
   官方页快照 2026-09-12：现行价（09-10 起）Flash 空闲 0.02/1/4（峰 ×2）、Pro 0.15/4.5/13.5（峰 ×2）；8 月旧价 Flash 0.05/1.5/4.5。 */
const usageEvent = (model: string, time: number, usage: Record<string, number>, turn = 1, step = 1) => ([
  { type: 'request/header', time, data: { header: { config: { model } } } },
  { type: 'assistant/chunk', time, data: { turn, step, chunk: { type: 'usage', usage } } },
])

describe('unverified connection pricing', () => {
  it('does not apply DeepSeek prices to another connection serving an equal model ID', () => {
    const ledger = new UsageLedger()
    ledger.applyEvent({ type: 'request/header', data: { header: { config: { provider: 'sidebar-gateway', model: 'deepseek-flash' } } } })
    ledger.applyEvent({ type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 100 } } } })
    const state = usageCostStateOf(ledger, undefined, { cost: 999 }, { family: 'flash', peak: false, atMs: Date.now() })
    expect(state.pricingUnavailable).toBe(true)
    expect(state.rows).toEqual([]); expect(state.costMeter).toBeUndefined()
    expect(ledger.covered().uncachedInput).toBe(100)
  })
  it('keeps a mixed-vendor history unpriced after returning to a native model', () => {
    const ledger = new UsageLedger()
    for (const provider of ['deepseek-official', 'sidebar-custom', 'deepseek-official']) ledger.applyEvent({ type: 'request/header', data: { header: { config: { provider, model: 'deepseek-flash' } } } })
    expect(usageCostStateOf(ledger, undefined, undefined, { family: 'flash', peak: false, atMs: Date.now() }).pricingUnavailable).toBe(true)
  })
  it('does not show fallback prices while an unpriced model is selected before its first request', () => {
    expect(usageCostStateOf(new UsageLedger(), { uncachedInputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }, undefined, { family: 'pro', peak: true, atMs: Date.now(), priced: false }).pricingUnavailable).toBe(true)
  })
})

describe('usage-cost price table (J1)', () => {
  it('现行价与官方页逐项一致（09-10 起）', () => {
    const at = Date.parse('2026-09-12T12:00:00Z')
    expect(priceAt('flash', false, at)).toEqual({ hit: 0.02, miss: 1, out: 4 })
    expect(priceAt('flash', true, at)).toEqual({ hit: 0.04, miss: 2, out: 8 })
    expect(priceAt('pro', false, at)).toEqual({ hit: 0.15, miss: 4.5, out: 13.5 })
    expect(priceAt('pro', true, at)).toEqual({ hit: 0.3, miss: 9, out: 27 })
  })

  it('09-10 之前的调用按 8 月旧价（时代边界）', () => {
    const before = Date.parse('2026-09-09T12:00:00Z')
    expect(eraAt(before).id).toBe('aug')
    expect(priceAt('flash', false, before)).toEqual({ hit: 0.05, miss: 1.5, out: 4.5 })
    expect(PRICE_ERAS).toHaveLength(2)
  })

  it('峰谷判定=北京时间工作日 09–12 / 14–18（周末全天空闲）', () => {
    /* 2026-09-11 是周五；2026-09-12 是周六 */
    expect(isPeakAt(Date.parse('2026-09-11T02:00:00Z'))).toBe(true)   /* 北京 10:00 周五 */
    expect(isPeakAt(Date.parse('2026-09-11T04:00:00Z'))).toBe(false)  /* 北京 12:00（午休） */
    expect(isPeakAt(Date.parse('2026-09-11T06:00:00Z'))).toBe(true)   /* 北京 14:00 */
    expect(isPeakAt(Date.parse('2026-09-12T02:00:00Z'))).toBe(false)  /* 周六 */
  })

  it('模型族映射：名含 pro → pro，其余 → flash', () => {
    expect(familyOfModel('deepseek-flash')).toBe('flash')
    expect(familyOfModel('deepseek-v4.1-flash')).toBe('flash')
    expect(familyOfModel('deepseek-v4-flash-vision-exp')).toBe('flash')
    expect(familyOfModel('deepseek-v4-pro-0813')).toBe('pro')
    expect(familyOfModel(undefined)).toBe('flash')
  })
})

describe('usage ledger（J2/J3 分段与桶）', () => {
  it('切模型前后各成一段，各按自身族计价（总额=各段之和）', () => {
    const ledger = new UsageLedger()
    const t = Date.parse('2026-09-11T02:00:00Z') /* 北京 10:00 周五 = 高峰 */
    for (const event of usageEvent('deepseek-flash', t, { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 })) ledger.applyEvent(event)
    for (const event of usageEvent('deepseek-v4-pro', t, { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 }, 1, 2)) ledger.applyEvent(event)
    const { segments, breakdown } = ledger.cost()
    expect(segments).toHaveLength(2)
    const flash = segments.find((s) => s.family === 'flash')!
    const pro = segments.find((s) => s.family === 'pro')!
    expect(flash.peak).toBe(true)
    expect(costOfSegment(flash).total).toBeCloseTo(2, 10)   /* 1M × 高峰未命中 ¥2 */
    expect(costOfSegment(pro).total).toBeCloseTo(9, 10)     /* 1M × 高峰未命中 ¥9 */
    expect(breakdown.total).toBeCloseTo(11, 10)
  })

  it('跨峰谷边界两段分开计价（同一模型）', () => {
    const ledger = new UsageLedger()
    const peak = Date.parse('2026-09-11T02:00:00Z')    /* 周五 10:00 北京 = 峰 */
    const off = Date.parse('2026-09-11T05:00:00Z')     /* 周五 13:00 北京 = 谷（午休） */
    for (const event of usageEvent('deepseek-flash', peak, { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 })) ledger.applyEvent(event)
    for (const event of usageEvent('deepseek-flash', off, { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 }, 1, 2)) ledger.applyEvent(event)
    const rows = ledger.list()
    expect(rows).toHaveLength(2)
    expect(rows.find((s) => s.peak)!.buckets.uncachedInput).toBe(1_000_000)
    expect(rows.find((s) => !s.peak)!.buckets.uncachedInput).toBe(1_000_000)
    expect(ledger.cost().breakdown.total).toBeCloseTo(2 + 1, 10)
  })

  it('cacheWrite 记入命中桶（J3）', () => {
    const ledger = new UsageLedger()
    const t = Date.parse('2026-09-11T02:00:00Z')
    for (const event of usageEvent('deepseek-flash', t, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 })) ledger.applyEvent(event)
    const { breakdown } = ledger.cost()
    expect(breakdown.miss).toBe(0)
    expect(breakdown.hit).toBeCloseTo((1_000_000 + 1_000_000) / 1e6 * 0.04, 10)
  })

  it('同一 (turn,step) 重复上报按替换语义（幂等，重放不重复计）', () => {
    const ledger = new UsageLedger()
    const t = Date.parse('2026-09-11T02:00:00Z')
    for (const event of usageEvent('deepseek-flash', t, { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0 })) ledger.applyEvent(event)
    for (const event of usageEvent('deepseek-flash', t, { inputTokens: 300, outputTokens: 30, cacheReadTokens: 0 })) ledger.applyEvent(event)
    const covered = ledger.covered()
    expect(covered.uncachedInput).toBe(300)
    expect(covered.output).toBe(30)
  })

  it('时代边界：09-10 前的调用落 8 月价段（重放历史不串价）', () => {
    const ledger = new UsageLedger()
    const old = Date.parse('2026-09-09T02:00:00Z') /* 峰 */
    for (const event of usageEvent('deepseek-flash', old, { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 })) ledger.applyEvent(event)
    const segment = ledger.list()[0]!
    expect(segment.era).toBe('aug')
    expect(costOfSegment(segment).total).toBeCloseTo(3, 10) /* 8 月峰价未命中 ¥3 */
  })

  /* 0.1.10（用户反馈「价格统计有大问题」）：持久日志里 usage 挂在 assistant/message（无 assistant/chunk），
     旧账本因此对历史**零覆盖** → "历史未分段"≈整会话累计（真机实证 2.5 亿 tokens）。 */
  const settleEvent = (model: string, time: number, usage: Record<string, number>, turn = 1, step = 1) => ([
    { type: 'request/header', time, data: { header: { config: { model } } } },
    { type: 'assistant/message', time, data: { turn, step, usage } },
  ])

  it('结算事件（assistant/message）计入账本；与实时 chunk 形态同键替换（不重复计）', () => {
    const ledger = new UsageLedger()
    const t = Date.parse('2026-09-11T02:00:00Z')
    for (const event of settleEvent('deepseek-flash', t, { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 9000 })) ledger.applyEvent(event)
    let covered = ledger.covered()
    expect(covered.uncachedInput).toBe(1000)
    expect(covered.cacheRead).toBe(9000)
    for (const event of usageEvent('deepseek-flash', t, { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 9000 })) ledger.applyEvent(event)
    covered = ledger.covered()
    expect(covered.uncachedInput).toBe(1000)
    expect(covered.output).toBe(50)
  })

  it('stream 内嵌 usage 块（历史日志形态）按"最后一个 usage"取值', () => {
    const ledger = new UsageLedger()
    const t = Date.parse('2026-09-11T02:00:00Z')
    ledger.applyEvent({ type: 'request/header', time: t, data: { header: { config: { model: 'deepseek-flash' } } } })
    ledger.applyEvent({
      type: 'assistant/message', time: t, seq: 5,
      data: {
        turn: 2, step: 1, message: { content: [] },
        stream: [
          { type: 'chunk', time: t - 100, chunk: { type: 'text-delta', text: 'x' } },
          { type: 'chunk', time: t, chunk: { type: 'usage', usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 11 } } },
        ],
      },
    })
    const covered = ledger.covered()
    expect(covered.uncachedInput).toBe(7)
    expect(covered.cacheRead).toBe(11)
    expect(covered.output).toBe(3)
  })

  it('压缩摘要（compaction/summary）按 compactionId 计费且重放幂等', () => {
    const ledger = new UsageLedger()
    const t = Date.parse('2026-09-11T02:00:00Z')
    const summary = { type: 'compaction/summary', time: t, seq: 9, data: { compactionId: 'cp1', usage: { inputTokens: 500, outputTokens: 4000, cacheReadTokens: 200000 } } }
    ledger.applyEvent(summary); ledger.applyEvent(summary)
    const covered = ledger.covered()
    expect(covered.uncachedInput).toBe(500)
    expect(covered.output).toBe(4000)
    expect(covered.cacheRead).toBe(200000)
  })

  it('未分段残留按已覆盖构成估算（不再一律按未命中价放大约 50×）', () => {
    const ledger = new UsageLedger()
    const t = Date.parse('2026-09-11T05:00:00Z') /* 周五 13:00 北京 = 谷；flash 命中 0.02 / 未命中 1 / 输出 4 */
    for (const event of settleEvent('deepseek-flash', t, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 999_000, cacheWriteTokens: 1000 })) ledger.applyEvent(event)
    const state = usageCostStateOf(
      ledger,
      { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 1_998_000, cacheWriteTokens: 2000 },
      undefined,
      { family: 'flash', peak: false, atMs: t },
    )
    expect(state.unsegmentedTokens).toBe(1_000_000)
    expect(state.unsegmentedCost).toBeCloseTo(0.02, 10) /* 构成 100% 命中 → 1M × ¥0.02 */
  })
})
