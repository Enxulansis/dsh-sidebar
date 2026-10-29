import { describe, expect, it } from 'vitest'
import { mergeProjectionBlocks } from '../src/projection-merge.js'

/* 0.0.89：投影块合并——asOfSeq 大者胜（陈旧列表块不得压住完整历史基线）。 */

describe('mergeProjectionBlocks', () => {
  it('真实场景：列表陈旧块（asOfSeq=2、统计全 0、无 title）不压历史基线（title/统计/用量）', () => {
    const staleList = {
      asOfSeq: 2,
      values: {
        sessionStats: { turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 },
        contextTimeline: { ok: true, current: { total: 0 }, requests: [] },
      },
    }
    const freshBaseline = {
      asOfSeq: 238,
      values: {
        title: '说出当前时间',
        sessionStats: { turns: 2, steps: 2, llmMs: 2088, toolMs: 0, ttftMs: 1220, ttftSteps: 2, decodeMs: 868, decodeTokens: 201 },
        tokenUsage: { uncachedInputTokens: 2726, outputTokens: 201, cacheReadTokens: 2688, cacheWriteTokens: 0 },
      },
    }
    const merged = mergeProjectionBlocks(staleList, freshBaseline)
    expect(merged.asOfSeq).toBe(238)
    expect(merged.values?.title).toBe('说出当前时间')
    expect((merged.values?.sessionStats as { turns: number }).turns).toBe(2)
    expect((merged.values?.tokenUsage as { outputTokens: number }).outputTokens).toBe(201)
    /* 陈旧块独有的键保留（基线没带的键不动） */
    expect(merged.values?.contextTimeline).toBeDefined()
  })

  it('热会话（列表块更新）维持现有值优先', () => {
    const freshList = { asOfSeq: 300, values: { title: '新标题', sessionStats: { turns: 5 } } }
    const olderBaseline = { asOfSeq: 238, values: { title: '旧标题', tokenUsage: { outputTokens: 1 } } }
    const merged = mergeProjectionBlocks(freshList, olderBaseline)
    expect(merged.asOfSeq).toBe(300)
    expect(merged.values?.title).toBe('新标题')
    /* 基线独有的键补进来 */
    expect(merged.values?.tokenUsage).toEqual({ outputTokens: 1 })
  })

  it('asOfSeq 并列 → 维持旧行为（现有值优先）', () => {
    const merged = mergeProjectionBlocks(
      { asOfSeq: 10, values: { title: '现有' } },
      { asOfSeq: 10, values: { title: '基线' } },
    )
    expect(merged.values?.title).toBe('现有')
  })

  it('现有无 seq → 基线胜；双方无 seq → 现有值优先', () => {
    expect(mergeProjectionBlocks({ values: { a: 1 } }, { asOfSeq: 5, values: { b: 2 } })).toEqual({ asOfSeq: 5, values: { a: 1, b: 2 } })
    expect(mergeProjectionBlocks({ values: { a: 1 } }, { values: { a: 9, b: 2 } })).toEqual({ values: { a: 1, b: 2 } })
  })

  it('空 values/undefined 安全', () => {
    expect(mergeProjectionBlocks(undefined, { asOfSeq: 3, values: { title: 't' } })).toEqual({ asOfSeq: 3, values: { title: 't' } })
    expect(mergeProjectionBlocks({ asOfSeq: 1, values: { a: 1 } }, { asOfSeq: 2 })).toEqual({ asOfSeq: 2, values: { a: 1 } })
  })
})
