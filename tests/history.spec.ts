import { describe, expect, it } from 'vitest'
import { appendLiveEntry, catchUpCoversTail, earliestHistorySequence, historySequenceCounts, latestHistorySequence, mergeHistoryEntries, mergedWindowHasMore, unseenHistoryEntries } from '../src/history.js'
import type { HistoryEntry } from '../src/dsh-client.js'

function entry(seq: number, label: string): HistoryEntry {
  return { event: { type: 'user/message', seq, time: seq, data: { label } }, view: { label } }
}

describe('history pagination', () => {
  it('distinguishes durable sequence records from synthetic chunks without changing the window', () => {
    const entries = [entry(0, 'head'), entry(10, 'event'), entry(-1, 'chunk'), entry(-2, 'chunk')]
    const previous = entries.slice()
    expect(historySequenceCounts(entries)).toEqual({ nonnegative: 2, negative: 2, invalid: 0, duplicate: 0 })
    expect(entries).toEqual(previous)
    expect(historySequenceCounts([])).toEqual({ nonnegative: 0, negative: 0, invalid: 0, duplicate: 0 })
  })

  it('reports duplicate valid sequence identities separately from malformed records', () => {
    const entries = [entry(10, 'one'), entry(10, 'again'), entry(-1, 'chunk'), entry(-1, 'again'), entry(Number.NaN, 'invalid'), entry(Number.POSITIVE_INFINITY, 'invalid')]
    expect(historySequenceCounts(entries)).toEqual({ nonnegative: 2, negative: 2, invalid: 2, duplicate: 2 })
  })

  it('prepends older events in sequence order without duplicating an overlapping event', () => {
    const current = [entry(10, 'current'), entry(11, 'live')]
    const incoming = [entry(2, 'older'), entry(10, 'overlap'), entry(2, 'duplicate in page')]
    const unseen = unseenHistoryEntries(current, incoming)
    const merged = mergeHistoryEntries(current, unseen)

    expect(unseen.map(item => item.event.seq)).toEqual([2])
    expect(merged.map(item => item.event.seq)).toEqual([2, 10, 11])
    expect((merged[1]?.view as { label: string }).label).toBe('current')
    expect(earliestHistorySequence(merged)).toBe(2)
  })

  /* 0.0.150（真机 bug：运行中点轨道节点 → 流式回复被顶到对话最顶部）：
     流式增量是合成事件、seq 取负值（dsh-client `seq: -(++chunkSeq)`）——它们必须排在**尾部**
     （"此刻"），不能按数值升序被排到最前；否则翻页触发的 projector.reset 重放会把它们
     第一个装进对话。无 seq 的事件（session 头）同样排尾（无消息影响）。 */
  it('keeps synthetic negative-seq stream chunks (and seq-less events) at the tail, not the front', () => {
    const page = [entry(2, 'older'), entry(10, 'page')]
    const live = [entry(11, 'live-later'), entry(-1, 'chunk-1'), entry(-2, 'chunk-2')]
    const merged = mergeHistoryEntries(live, page)
    expect(merged.map(item => item.event.seq)).toEqual([2, 10, 11, -1, -2])
    const noSeq = { event: { type: 'session', seq: undefined as unknown as number, time: 0 }, view: undefined }
    const withHeader = mergeHistoryEntries([{ ...noSeq }], page)
    expect(withHeader[withHeader.length - 1]).toBe(withHeader.find(item => item.event.seq === (undefined as unknown as number)))
    /* 数值域内仍严格升序 */
    const numeric = merged.map(item => item.event.seq).filter(seq => typeof seq === 'number' && seq >= 0)
    expect([...numeric].sort((a, b) => a - b)).toEqual(numeric)
  })
})

  /* 0.0.154（O3）：缓存命中的 catch-up 合并——hasMore 归属（页更深取页 / 缓存更深取缓存）。 */
  it('attributes hasMore to the deeper side after a cache catch-up merge', () => {
    /* 页更深（页最早 < 缓存最早）→ 取页 */
    expect(mergedWindowHasMore(5, 100, true, false)).toBe(true)
    expect(mergedWindowHasMore(5, undefined, false, true)).toBe(false)
    /* 页不更深（页最早 ≥ 缓存最早）→ 取缓存 */
    expect(mergedWindowHasMore(200, 100, true, false)).toBe(false)
    expect(mergedWindowHasMore(100, 100, true, true)).toBe(true)
    /* 页无最早（空页）→ 取缓存 */
    expect(mergedWindowHasMore(undefined, 100, true, false)).toBe(false)
  })

/* 0.1.4（性能修复）：合入快路径语义锁定——正 seq 尾部追加 / ∞ 组追加 / 去重与乱序回落通用路径。
   背景：EUV 长会话实测本函数每事件全量 Map+sort（cpuprofile 2.4s/3.4s 单次停顿，扩展宿主被判
   UNRESPONSIVE）；快路径 O(1) 直插，语义须与通用路径逐位一致。 */
describe('mergeHistoryEntries 快路径语义', () => {
  const seqs = (entries: HistoryEntry[]) => entries.map(item => item.event.seq)

  it('正 seq 追加：插到 ∞ 尾组之前，保持数值升序', () => {
    const merged = mergeHistoryEntries([entry(1, 'a'), entry(2, 'b'), entry(-5, 'chunk')], [entry(3, 'live')])
    expect(seqs(merged)).toEqual([1, 2, 3, -5])
  })

  it('负 seq 流式块：尾部已为非正时直接追加', () => {
    const merged = mergeHistoryEntries([entry(1, 'a'), entry(-2, 'chunk-1')], [entry(-3, 'chunk-2')])
    expect(seqs(merged)).toEqual([1, -2, -3])
  })

  it('尾部为正序时负 seq 追加（2026-10-06 W4：直追与通用路径对合法输入逐位等价；正序仍在前）', () => {
    /* 旧实现此形态回落通用路径（真数据实测 2.57ms/次，流式热路径）；W4 改直追——对满足不变量的
       输入（正序在前、∞ 组在尾）两者逐位一致；违反不变量的输入不在契约内。 */
    const merged = mergeHistoryEntries([entry(2, 'pos'), entry(-2, 'chunk')], [entry(-1, 'new-chunk')])
    expect(seqs(merged)).toEqual([2, -2, -1])
  })

  it('重复 seq 保留先者；乱序正 seq 回落通用路径', () => {
    const duplicate = mergeHistoryEntries([entry(3, 'first')], [entry(3, 'again')])
    expect(seqs(duplicate)).toEqual([3])
    expect((duplicate[0]?.view as { label: string }).label).toBe('first')
    const outOfOrder = mergeHistoryEntries([entry(1, 'a'), entry(5, 'b'), entry(-1, 'chunk')], [entry(3, 'mid')])
    expect(seqs(outOfOrder)).toEqual([1, 3, 5, -1])
  })
})
describe('catchUpCoversTail / latestHistorySequence（0.1.53 D6-0 小页 catch-up 守卫）', () => {
  it('latestHistorySequence 取最大合法 seq（跳过非正/非法，与 earliest 同口径）', () => {
    expect(latestHistorySequence([])).toBeUndefined()
    expect(latestHistorySequence([entry(3, 'a'), entry(9, 'b'), entry(5, 'c')])).toBe(9)
    expect(latestHistorySequence([entry(-1, 'x'), entry(4, 'y'), entry(0, 'z')])).toBe(4)
  })
  it('页 hasMore=false ⇒ 一定接得上（整会话都在这一页）', () => {
    expect(catchUpCoversTail([entry(1, 'c')], [entry(999, 'p')], false)).toBe(true)
  })
  it('重叠 / 相邻 ⇒ 接得上；出现空档 ⇒ 接不上（调用方回退大页）', () => {
    expect(catchUpCoversTail([entry(1, 'c1'), entry(10, 'c10')], [entry(10, 'p10'), entry(12, 'p12')], true)).toBe(true)
    expect(catchUpCoversTail([entry(1, 'c1'), entry(10, 'c10')], [entry(11, 'p11'), entry(12, 'p12')], true)).toBe(true)
    expect(catchUpCoversTail([entry(1, 'c1'), entry(10, 'c10')], [entry(30, 'p30'), entry(31, 'p31')], true)).toBe(false)
  })
  it('缓存无可用 seq / 页内无可用 seq ⇒ 保守视为接得上（不误触发回退）', () => {
    expect(catchUpCoversTail([entry(-1, 'neg')], [entry(50, 'p')], true)).toBe(true)
    expect(catchUpCoversTail([entry(5, 'c')], [entry(-1, 'pneg')], true)).toBe(true)
  })
})

/* 2026-10-06（长会话卡顿测量，W3/W4）：mergeHistoryEntries 两条短路等价性锁死。
   真数据实测——慢路径（已存在 seq）2.08ms/次、负 seq 块回落 2.57ms/次；重放/流式场景几乎全走这两条。 */
describe('mergeHistoryEntries 短路等价性（W3/W4）', () => {
  /** 通用路径参考实现（incoming.length>1 恒走通用路径）——对照快路径结果。 */
  const generalPath = (current: readonly HistoryEntry[], items: HistoryEntry[]): HistoryEntry[] => {
    // 先合入一条无关的批量触发（会被去重/排序），再比对：用两条 incoming 走通用路径。
    // 更直接：把 incoming 拆成 [item] 用两参签名没有通用路径入口；改用一条同 item 的重复 + 一条新 seq
    const probe = mergeHistoryEntries([...current] as HistoryEntry[], [items[0]!, entry(999999, 'probe')])
    return probe.filter(item => item.event.seq !== 999999)
  }

  it('W3：已存在 seq → 返回原引用、内容不变（重放/重复热路径）', () => {
    const current = [entry(1, 'a'), entry(5, 'b'), entry(-3, 'chunk'), entry(-2, 'chunk2')]
    const merged = mergeHistoryEntries(current, [entry(1, 'a-dup')])
    expect(merged).toBe(current)
    expect(merged.map(item => item.event.seq)).toEqual([1, 5, -3, -2])
    // 重复项不得改写现有条目（旧通用路径语义：现有胜出）
    expect((merged[0]?.view as { label: string }).label).toBe('a')
  })

  it('W3：乱序旧 seq（缺口中段补页）走快路径插入且保持升序不变量', () => {
    const current = [entry(1, 'a'), entry(5, 'b'), entry(-3, 'chunk')]
    const merged = mergeHistoryEntries(current, [entry(3, 'c')])
    expect(merged.map(item => item.event.seq)).toEqual([1, 3, 5, -3])
    // 与通用路径对照（同输入）
    const expected = generalPath(current, [entry(3, 'c')])
    expect(merged.map(item => item.event.seq)).toEqual(expected.map(item => item.event.seq))
  })

  it('W4：新负 seq 在尾为正时仍直接追加（与通用路径逐位等价）', () => {
    const current = [entry(1, 'a'), entry(5, 'b')]
    const chunk = entry(-7, 'chunk')
    const merged = mergeHistoryEntries(current, [chunk])
    expect(merged.map(item => item.event.seq)).toEqual([1, 5, -7])
    const expected = generalPath(current, [chunk])
    expect(merged.map(item => item.event.seq)).toEqual(expected.map(item => item.event.seq))
  })

  it('W4 反例：∞ 组已含同 seq（理论不可达）→ 回落通用路径去重、不产生重复', () => {
    const current = [entry(1, 'a'), entry(-7, 'chunk-old')]
    const merged = mergeHistoryEntries(current, [entry(-7, 'chunk-dup')])
    expect(merged.map(item => item.event.seq)).toEqual([1, -7])
    expect((merged[1]?.view as { label: string }).label).toBe('chunk-old')
  })

  it('W4 边界：缺失 seq 的条目无唯一性——已存在缺失 seq 时报文不重复', () => {
    const missing = (label: string): HistoryEntry => ({ event: { type: 'assistant/message', time: 0, data: { label } } as HistoryEntry['event'], view: { label } })
    const current = [entry(1, 'a'), missing('m1')]
    const merged = mergeHistoryEntries(current, [missing('m2')])
    expect(merged.length).toBe(2)
    expect((merged[1]?.view as { label: string }).label).toBe('m1')
    // 空表/无缺失时仍可追加
    const merged2 = mergeHistoryEntries([entry(1, 'a')], [missing('m3')])
    expect(merged2.length).toBe(2)
  })
})

/* 2026-10-06（S3/摊销）：appendLiveEntry——就地合入与 mergeHistoryEntries 快路径逐位等价；
   慢路径场景自动回落（结果同不可变通用路径）。 */
describe('appendLiveEntry 就地合入（S3/摊销）', () => {
  it('正 seq 尾部追加：就地（同数组引用）且与 mergeHistoryEntries 结果逐位一致', () => {
    const live = [entry(1, 'a'), entry(2, 'b')]
    const immutable = [entry(1, 'a'), entry(2, 'b')]
    const out = appendLiveEntry(live, entry(3, 'c'))
    expect(out).toBe(live)
    expect(out.map(e => e.event.seq)).toEqual(mergeHistoryEntries(immutable, [entry(3, 'c')]).map(e => e.event.seq))
  })

  it('已存在 seq：原样返回（同引用）', () => {
    const live = [entry(1, 'a'), entry(2, 'b')]
    const out = appendLiveEntry(live, entry(1, 'dup'))
    expect(out).toBe(live)
    expect(live.length).toBe(2)
  })

  it('乱序插入（∞ 组前）：就地 splice，结果同通用路径', () => {
    const live = [entry(1, 'a'), entry(5, 'b'), entry(-1, 'chunk')]
    const immutable = [entry(1, 'a'), entry(5, 'b'), entry(-1, 'chunk')]
    appendLiveEntry(live, entry(3, 'mid'))
    expect(live.map(e => e.event.seq)).toEqual([1, 3, 5, -1])
    expect(live.map(e => e.event.seq)).toEqual(mergeHistoryEntries(immutable, [entry(3, 'mid')]).map(e => e.event.seq))
  })

  it('负 seq 流式块：就地追加；重复块回落去重', () => {
    const live = [entry(1, 'a')]
    appendLiveEntry(live, entry(-1, 'chunk'))
    expect(live.map(e => e.event.seq)).toEqual([1, -1])
    appendLiveEntry(live, entry(-2, 'chunk2'))
    expect(live.map(e => e.event.seq)).toEqual([1, -1, -2])
    appendLiveEntry(live, entry(-1, 'chunk-dup'))
    expect(live.map(e => e.event.seq)).toEqual([1, -1, -2])   // 去重回落，不重复
  })

  it('缓存互作：就地追加后 catchUpCoversTail / earliest / latest 与不可变结果同值', () => {
    const live = [entry(10, 'c10')]
    appendLiveEntry(live, entry(12, 'live'))
    appendLiveEntry(live, entry(-1, 'chunk'))
    const immutable = mergeHistoryEntries(mergeHistoryEntries([entry(10, 'c10')], [entry(12, 'live')]), [entry(-1, 'chunk')])
    expect(earliestHistorySequence(live)).toBe(earliestHistorySequence(immutable))
    expect(latestHistorySequence(live)).toBe(latestHistorySequence(immutable))
    expect(catchUpCoversTail(live, [entry(11, 'p11'), entry(13, 'p13')], true))
      .toBe(catchUpCoversTail(immutable, [entry(11, 'p11'), entry(13, 'p13')], true))
  })
})
