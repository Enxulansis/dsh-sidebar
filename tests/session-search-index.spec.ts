import { describe, expect, it } from 'vitest'
import {
  SEARCH_ENTRIES_PER_SESSION_MAX,
  SEARCH_HITS_PER_SESSION_MAX,
  SEARCH_ENTRY_TEXT_MAX,
  buildSessionEntries,
  countOccurrences,
  emptySearchIndex,
  markSessionTrashed,
  parseSearchIndex,
  pruneSearchIndex,
  searchSessionIndex,
  serializeSearchIndex,
  setSessionRail,
  snippetOf,
  upsertSessionEntries,
} from '../src/session-search-index.js'
import { SearchIndexStore } from '../src/search-index-store.js'
import type { ConversationMessage } from '../src/conversation.js'

const message = (over: Partial<ConversationMessage>): ConversationMessage => ({
  id: 'm1',
  role: 'assistant',
  text: '',
  ...over,
})

describe('0.0.170 本工作区内容索引', () => {
  it('抽取条目：正文/图片名/文件名/工具参数与输出（同一消息多来源）', () => {
    const entries = buildSessionEntries([
      message({ id: 'u1', role: 'user', text: '请直接回答当前时间' }),
      message({ id: 'u2', role: 'user', text: '看这张图', images: [{ attachmentId: 'a1', mediaType: 'image/png', name: '浙江大学-logo.png', width: 1, height: 1 }] }),
      message({ id: 'tool:1', role: 'tool', text: 'edit', rawInput: '{"path":"D:\\\\proj\\\\deploy.ps1"}', rawResult: 'ok 已写入', files: [{ name: 'deploy.ps1', path: 'D:/proj/deploy.ps1', mime: 'text', size: 1, origin: 'workspace', status: 'active' }] }),
      message({ id: 'a1', role: 'assistant', text: '已完成。' }),
    ])
    const kinds = entries.map(entry => `${entry.id}:${entry.kind}`)
    expect(kinds).toContain('u1:文本')
    expect(kinds).toContain('u2:图片')
    expect(kinds).toContain('tool:1:工具')
    expect(kinds).toContain('tool:1:文件')
    expect(entries.find(entry => entry.id === 'u2' && entry.kind === '图片')?.text).toBe('浙江大学-logo.png')
    expect(entries.filter(entry => entry.id === 'tool:1' && entry.kind === '工具').map(entry => entry.text)).toEqual(['edit', 'edit {"path":"D:\\\\proj\\\\deploy.ps1"}', 'ok 已写入'])
  })

  it('工具名称遵循工具配额，既有缓存条目的角色也决定名称分类', () => {
    const file = emptySearchIndex()
    file.sessions.s = { revision: 1, entries: [
      ...Array.from({ length: 30 }, (_, i) => ({ id: `tool:${i}`, role: 'tool', kind: '文本' as const, text: 'needle_tool', time: i })),
      ...buildSessionEntries(Array.from({ length: 13 }, (_, i) => message({ id: `u${i}`, role: 'user', text: 'needle' }))),
    ] }
    const hits = searchSessionIndex(file, 'needle')
    expect(hits.filter(hit => hit.kind === '文本')).toHaveLength(12)
    expect(hits.filter(hit => hit.kind === '工具')).toHaveLength(24)
    expect(hits.every(hit => hit.role !== 'tool' || hit.kind === '工具')).toBe(true)
  })

  it('两字中文子串可命中（运行时 unicode61 搜不到的场景）', () => {
    const file = emptySearchIndex()
    upsertSessionEntries(file, 's1', 1, [message({ id: 'u1', role: 'user', text: '请直接回答当前时间' })])
    const hits = searchSessionIndex(file, '直接')
    expect(hits).toHaveLength(1)
    expect(hits[0].messageId).toBe('u1')
    expect(hits[0].kind).toBe('文本')
    expect(hits[0].snippet).toContain('直接')
    expect(hits[0].trashed).toBe(false)
    /* 大小写不敏感 + 空查询 */
    expect(searchSessionIndex(file, '直接')).toHaveLength(1)
    expect(searchSessionIndex(file, '  ')).toHaveLength(0)
  })

  it('同消息多类条目只出一次；每会话与全局都有上限', () => {
    const file = emptySearchIndex()
    upsertSessionEntries(file, 's1', 1, [
      message({ id: 'tool:9', role: 'tool', text: 'edit', rawInput: 'deploy.ps1', rawResult: 'deploy.ps1 ok' }),
    ])
    expect(searchSessionIndex(file, 'deploy.ps1')).toHaveLength(1)

    const many = Array.from({ length: 20 }, (_, i) => message({ id: `m${String(i)}`, role: 'user', text: `测试 检索 词 ${String(i)}` }))
    const big = emptySearchIndex()
    upsertSessionEntries(big, 's2', 1, many)
    /* 0.1.97（真机反馈"中段搜不到"）：每会话命中上限 6→12。 */
    expect(searchSessionIndex(big, '检索').length).toBeLessThanOrEqual(SEARCH_HITS_PER_SESSION_MAX)
    expect(SEARCH_HITS_PER_SESSION_MAX).toBeGreaterThanOrEqual(12)
  })

  it('revision 未变不重建；trashed 标记保留；序列化往返一致', () => {
    const file = emptySearchIndex()
    expect(upsertSessionEntries(file, 's1', 5, [message({ id: 'm1', role: 'user', text: '一' })])).toBe(true)
    expect(upsertSessionEntries(file, 's1', 5, [message({ id: 'm1', role: 'user', text: '二' })])).toBe(false)
    expect(file.sessions['s1'].entries[0].text).toBe('一')
    expect(upsertSessionEntries(file, 's1', 6, [message({ id: 'm1', role: 'user', text: '三' })])).toBe(true)
    expect(file.sessions['s1'].entries[0].text).toBe('三')

    expect(markSessionTrashed(file, 's1', true)).toBe(true)
    expect(markSessionTrashed(file, 's1', true)).toBe(false)
    const round = parseSearchIndex(serializeSearchIndex(file))
    expect(round.sessions['s1'].trashed).toBe(true)
    expect(searchSessionIndex(round, '三')[0].trashed).toBe(true)
    expect(markSessionTrashed(round, 's1', false)).toBe(true)
    expect(round.sessions['s1'].trashed).toBeUndefined()
  })

  it('裁剪/prune/损坏数据回落', () => {
    const file = emptySearchIndex()
    upsertSessionEntries(file, 'keep', 1, [message({ id: 'm1', role: 'user', text: 'x' })])
    upsertSessionEntries(file, 'drop', 1, [message({ id: 'm2', role: 'user', text: 'y' })])
    expect(pruneSearchIndex(file, new Set(['keep']))).toBe(true)
    expect(Object.keys(file.sessions)).toEqual(['keep'])
    expect(pruneSearchIndex(file, new Set(['keep']))).toBe(false)

    expect(parseSearchIndex('not json').sessions).toEqual({})
    /* 0.1.71：索引文件版本升 2（条目带 time）；0.1.90：升 3（作废 v2——期间混入过跨会话条目）；
       0.1.123（G55 Phase 3）：升 4（条目带 seq——结果行节点编号；作废 v3 同策重建）。
       0.1.124（数据层根治）：升 5（会话记录加轨道表 rail）——v4 兼容读（条目有效，缺 rail 补算）。 */
    expect(parseSearchIndex('{"version":1,"sessions":{"s1":{"revision":1,"entries":[{"id":"m1","role":"user","kind":"文本","text":"旧"}]}}}').sessions).toEqual({})
    expect(parseSearchIndex('{"version":2,"sessions":{"s1":{"revision":1,"entries":[{"id":"m1","role":"user","kind":"文本","text":"旧"}]}}}').sessions).toEqual({})
    expect(parseSearchIndex('{"version":3,"sessions":{"s1":{"revision":1,"entries":[{"id":"m1","role":"user","kind":"文本","text":"旧"}]}}}').sessions).toEqual({})
    expect(parseSearchIndex(serializeSearchIndex(emptySearchIndex())).version).toBe(5)
    const v4 = parseSearchIndex('{"version":4,"sessions":{"s1":{"revision":7,"entries":[{"id":"m1","role":"user","kind":"文本","text":"旧"}]}}}')
    expect(v4.version).toBe(5)
    expect(v4.sessions.s1.entries[0].text).toBe('旧')
    expect(v4.sessions.s1.rail).toBeUndefined()
  })

  it('0.1.123（G55 Phase 3）：条目带 seq——写入/透传/解析（缺失不标）', () => {
    const file = emptySearchIndex()
    upsertSessionEntries(file, 's1', 1, [
      message({ id: 'm1', role: 'user', text: '带序号 hit', seq: 42 }),
      message({ id: 'm2', role: 'user', text: '无序号 hit' }),
    ])
    const entries = file.sessions.s1.entries
    expect(entries[0].seq).toBe(42)
    expect(entries[1].seq).toBeUndefined()
    const hits = searchSessionIndex(file, 'hit')
    const byId = new Map(hits.map(hit => [hit.messageId, hit]))
    expect(byId.get('m1')?.seq).toBe(42)
    expect(byId.get('m2')?.seq).toBeUndefined()
    /* 序列化往返：seq 保留；无 seq 条目序列化后不带该键。 */
    const round = parseSearchIndex(serializeSearchIndex(file))
    expect(round.sessions.s1.entries[0].seq).toBe(42)
    expect(round.sessions.s1.entries[1].seq).toBeUndefined()
    /* 脏数据：seq 非数字 → 丢弃（不标）。 */
    const dirty = parseSearchIndex('{"version":4,"sessions":{"s1":{"revision":1,"entries":[{"id":"m3","role":"user","kind":"文本","text":"x","seq":"nope"}]}}}')
    expect(dirty.sessions.s1.entries[0].seq).toBeUndefined()
  })

  it('超长正文截断，条目数上限丢最旧', () => {
    const long = 'a'.repeat(SEARCH_ENTRY_TEXT_MAX + 500)
    const entries = buildSessionEntries([message({ id: 'm1', role: 'user', text: long })])
    expect(entries[0].text.length).toBe(SEARCH_ENTRY_TEXT_MAX)

    const many = Array.from({ length: SEARCH_ENTRIES_PER_SESSION_MAX + 10 }, (_, i) => message({ id: `m${String(i)}`, role: 'user', text: `第${String(i)}条` }))
    const trimmed = buildSessionEntries(many)
    expect(trimmed.length).toBe(SEARCH_ENTRIES_PER_SESSION_MAX)
    expect(trimmed[0].text).toBe('第10条')
  })

  it('片段抽取带前后文与省略号', () => {
    const text = '前言'.repeat(20) + '直接' + '后语'.repeat(20)
    const snippet = snippetOf(text, text.indexOf('直接'), 2)
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet).toContain('直接')
  })

  /* 0.1.65（T3-3 / T3-7） */
  it('命中计数：不重叠计数并随命中带回（面板"共 N 处"）', () => {
    expect(countOccurrences('甲 乙 甲 乙 甲', '甲')).toBe(3)
    expect(countOccurrences('aaaa', 'aa')).toBe(2)
    expect(countOccurrences('任意', '')).toBe(0)
    expect(countOccurrences('无', '有')).toBe(0)

    const file = emptySearchIndex()
    upsertSessionEntries(file, 's1', 1, [message({ id: 'm1', role: 'user', text: '甲 乙 甲 乙 甲' })])
    expect(searchSessionIndex(file, '甲')[0].total).toBe(3)
    expect(searchSessionIndex(file, '乙')[0].total).toBe(2)
  })

  it('store.stats 反映索引规模（面板脚注用）', () => {
    const store = new SearchIndexStore(undefined)
    expect(store.active).toBe(false)
    expect(store.stats).toEqual({ sessions: 0, entries: 0 })
    store.upsert('s1', 1, [message({ id: 'm1', role: 'user', text: 'x' }), message({ id: 'm2', role: 'user', text: 'y' })])
    expect(store.stats.sessions).toBe(1)
    expect(store.stats.entries).toBeGreaterThanOrEqual(2)
  })
})

/* 0.1.110（代码审查修复） */
describe('0.1.110 索引审查修复', () => {
  it('高危1：脏标记路径 force=true 时 revision 未变也重建（旧实现被守卫丢弃 ⇒ 回合结束刷新索引空转）', () => {
    const file = emptySearchIndex()
    const first = [message({ id: 'm1', role: 'user', text: '旧内容' })]
    expect(upsertSessionEntries(file, 's1', 7, first)).toBe(true)
    /* revision 相同、内容已变（updatedAt 滞后场景）：常规路径被守卫吞，force 路径必须重建 */
    const next = [message({ id: 'm1', role: 'user', text: '旧内容' }), message({ id: 'm2', role: 'assistant', text: '刚回复完的新内容' })]
    expect(upsertSessionEntries(file, 's1', 7, next)).toBe(false)
    expect(searchSessionIndex(file, '新内容').length).toBe(0)
    expect(upsertSessionEntries(file, 's1', 7, next, true)).toBe(true)
    expect(searchSessionIndex(file, '新内容').length).toBe(1)
  })

  it('中危2：工具条目不吃每会话配额（正文命中不再被工具行挤掉），工具兜底追加', () => {
    const file = emptySearchIndex()
    const tools = Array.from({ length: SEARCH_HITS_PER_SESSION_MAX }, (_, i) =>
      message({ id: `tool:${String(i)}`, role: 'tool', text: 'edit', rawInput: `needle ${String(i)}` }))
    const texts = [message({ id: 't1', role: 'user', text: 'needle 正文一' }), message({ id: 't2', role: 'assistant', text: 'needle 正文二' })]
    upsertSessionEntries(file, 's1', 1, [...tools, ...texts])
    const hits = searchSessionIndex(file, 'needle')
    const kinds = hits.map(hit => `${hit.messageId}:${hit.kind}`)
    expect(kinds).toContain('t1:文本')
    expect(kinds).toContain('t2:文本')
    expect(hits.filter(hit => hit.kind === '工具').length).toBe(SEARCH_HITS_PER_SESSION_MAX)
    /* 每会话**非工具**上限仍生效：20 条正文命中只回 12 条 */
    const many = emptySearchIndex()
    upsertSessionEntries(many, 's2', 1, Array.from({ length: 20 }, (_, i) => message({ id: `x${String(i)}`, role: 'user', text: `needle ${String(i)}` })))
    expect(searchSessionIndex(many, 'needle').length).toBe(SEARCH_HITS_PER_SESSION_MAX)
  })

  it('低8：parseSearchIndex 对未知 kind 回落「文本」（不让任意串以条目类型身份流入面板）', () => {
    const file = emptySearchIndex()
    upsertSessionEntries(file, 's1', 1, [message({ id: 'm1', role: 'user', text: 'needle' })])
    const raw = JSON.parse(serializeSearchIndex(file)) as { sessions: Record<string, { entries: Array<Record<string, unknown>> }> }
    raw.sessions.s1.entries[0].kind = '任意串'
    const parsed = parseSearchIndex(JSON.stringify(raw))
    expect(parsed.sessions.s1.entries[0].kind).toBe('文本')
  })
})

/* 0.1.124（数据层根治）：轨道节点表随索引持久化（v5） */
describe('0.1.124 轨道表持久化（v5）', () => {
  const rail = {
    segment: [{ seq: 10, mid: 'u1', key: 's10' }, { seq: 20, mid: null, key: 's20' }],
    turn: [{ seq: 10, mid: 'u1', key: 's10' }],
  }

  it('setSessionRail 与条目同快照（revision 一致才写）；往返保留、key 由 seq 重建', () => {
    const file = emptySearchIndex()
    upsertSessionEntries(file, 's1', 5, [message({ id: 'm1', role: 'user', text: 'x' })])
    expect(setSessionRail(file, 's1', 4, rail)).toBe(false)   /* 错位快照 → 拒绝 */
    expect(setSessionRail(file, 's1', 5, rail)).toBe(true)
    const round = parseSearchIndex(serializeSearchIndex(file))
    expect(round.sessions.s1.rail?.segment.map(entry => entry.key)).toEqual(['s10', 's20'])
    expect(round.sessions.s1.rail?.segment[1].mid).toBeNull()
    expect(round.sessions.s1.rail?.turn).toHaveLength(1)
    /* 0.1.125：语义版本随表落盘（无标记的旧表在 parse 侧作废）。 */
    expect(round.sessions.s1.railVersion).toBe(6)
  })

  it('revision 变更重建条目时旧轨道作废；只接受同截面表', () => {
    const file = emptySearchIndex()
    upsertSessionEntries(file, 's1', 1, [message({ id: 'm1', role: 'user', text: 'x' })])
    setSessionRail(file, 's1', 1, rail)
    upsertSessionEntries(file, 's1', 2, [message({ id: 'm1', role: 'user', text: 'y' })])
    expect(file.sessions.s1.rail).toBeUndefined()
    expect(setSessionRail(file, 's1', 1, rail)).toBe(false)   /* 旧 revision 不可再写 */
    expect(setSessionRail(file, 's1', 2, rail)).toBe(true)
  })

  it('脏表回落：seq 非数字丢弃、key 重建、mid 非串回落 null、缺数组整表作废；无版本标记的旧表作废', () => {
    const dirty = parseSearchIndex('{"version":5,"sessions":{"s1":{"revision":1,"entries":[],"railVersion":6,"rail":{"segment":[{"seq":7,"mid":12,"key":"伪造"},{"seq":"x","mid":"a","key":"s9"},{"seq":9,"mid":"c","key":"s9","endSeq":100}],"turn":[{"seq":7,"mid":"a","key":"s7"}]}}}}')
    expect(dirty.sessions.s1.rail?.segment).toEqual([{ seq: 7, mid: null, key: 's7' }, { seq: 9, mid: 'c', key: 's9', endSeq: 100 }])
    const broken = parseSearchIndex('{"version":5,"sessions":{"s1":{"revision":1,"entries":[],"railVersion":6,"rail":{"segment":[{"seq":7}]}}}}')
    expect(broken.sessions.s1.rail).toBeUndefined()
    /* 0.1.125（真机反例）：v1 表（无 railVersion 标记 = 单页窗口 + 前缀无 endSeq 缺陷版）作废重算。 */
    const stale = parseSearchIndex('{"version":5,"sessions":{"s1":{"revision":1,"entries":[],"rail":{"segment":[{"seq":7,"mid":"a","key":"s7"}],"turn":[]}}}}')
    expect(stale.sessions.s1.rail).toBeUndefined()
  })

  it.each([2, 3, 4, 5])('invalidates old v%i rail while retaining existing search entries', version => {
    const file = emptySearchIndex()
    upsertSessionEntries(file, 's1', 1, [message({ id: 'm1', role: 'user', text: 'retained' })])
    setSessionRail(file, 's1', 1, rail)
    file.sessions.s1.railVersion = version
    const parsed = parseSearchIndex(serializeSearchIndex(file))
    expect(parsed.sessions.s1.rail).toBeUndefined()
    expect(parsed.sessions.s1.entries[0]).toMatchObject({ id: 'm1', text: 'retained' })
  })

  it('round-trips exact stop markers without accepting truthy fabricated flags', () => {
    const file = emptySearchIndex()
    upsertSessionEntries(file, 's', 1, [])
    setSessionRail(file, 's', 1, { segment: [{ seq: 2, mid: 'approval:a', key: 's2', stop: true }], turn: [] })
    expect(parseSearchIndex(serializeSearchIndex(file)).sessions.s.rail?.segment[0]).toMatchObject({ stop: true })
    const fake = serializeSearchIndex(file).replace('"stop":true', '"stop":"true"')
    expect(parseSearchIndex(fake).sessions.s.rail?.segment[0].stop).toBeUndefined()
  })
})
