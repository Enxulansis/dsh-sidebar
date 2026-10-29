import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promises as fsPromises } from 'node:fs'
import { SearchIndexStore } from '../src/search-index-store.js'
import type { ConversationMessage } from '../src/conversation.js'

/* 2026-10-06（W9）：索引落库往返锁死——真机曾出现"视频工作区索引文件从不落盘且全链无日志"。
   本用例覆盖：upsert → flush → 文件出现 → 重载 → indexed()/search() 可用；
   以及 force/去重语义与 flush 失败外露（warn）通路。 */
const messages: ConversationMessage[] = [
  { id: 'a0', role: 'assistant', text: '回复内容 hello', time: 1 },
  { id: 'u1', role: 'user', text: '用户的搜索词在这里', time: 2 },
]

describe('SearchIndexStore 落库往返（W9）', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('single-session lookup applies scope before the global quota and retains exclusions', async () => {
    const store = new SearchIndexStore(undefined)
    for (let session = 0; session < 8; session++) {
      store.upsert('s' + session, 1, Array.from({ length: 12 }, (_, i) => ({ id: 'm' + i, role: 'user' as const, text: 'needle' + (i === 0 ? ' skip' : ''), time: session * 100 + i })))
    }
    // This session is absent from the globally limited results.
    expect(store.search('needle').some(hit => hit.sessionId === 's7')).toBe(false)
    const selected = store.searchSession('s7', 'needle', ['skip'])
    expect(selected).toHaveLength(11)
    expect(selected.every(hit => hit.sessionId === 's7' && hit.messageId !== 'm0')).toBe(true)
    expect(store.searchSession('missing', 'needle')).toEqual([])
    await store.dispose()
  })

  it('同工作区并发读取等待同一任务，随后写入不会被迟到读盘覆盖', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'idx-concurrent-'))
    const seed = new SearchIndexStore(dir)
    await seed.useWorkspace('D:/same')
    seed.upsert('seed', 1, messages)
    await seed.flush()
    const raw = readFileSync(join(dir, readdirSync(dir)[0]!), 'utf8')
    let release!: (value: string) => void
    const gate = new Promise<string>(resolve => { release = resolve })
    const spy = vi.spyOn(fsPromises, 'readFile').mockImplementationOnce(async () => gate)
    const store = new SearchIndexStore(dir)
    const first = store.useWorkspace('D:/same')
    await vi.waitFor(() => { expect(spy).toHaveBeenCalledTimes(1) })
    let finished = false
    const second = store.useWorkspace('D:/same').then(() => { finished = true })
    await Promise.resolve()
    expect(finished).toBe(false)
    expect(store.active).toBe(false)
    release(raw)
    await Promise.all([first, second])
    expect(store.indexed('seed', 1)).toBe(true)
    expect(store.upsert('new', 2, messages)).toBe(true)
    await store.flush()
    expect(store.stats.sessions).toBe(2)
    await store.dispose()
  })

  it('移除后在去抖窗口内退出也落盘，关闭后拒绝新的写入', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'idx-close-'))
    const store = new SearchIndexStore(dir)
    await store.useWorkspace('D:/close')
    store.upsert('s1', 1, messages)
    await store.flush()
    store.remove('s1')
    await store.dispose()
    expect(store.active).toBe(false)
    expect(store.upsert('s2', 2, messages)).toBe(false)
    await expect(store.useWorkspace('D:/other')).rejects.toThrow('closed')
    const reloaded = new SearchIndexStore(dir)
    await reloaded.useWorkspace('D:/close')
    expect(reloaded.stats.sessions).toBe(0)
  })

  it('工作区切换时不提交迟到的读盘，也不覆盖旧文件', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'idx-switch-'))
    const seed = new SearchIndexStore(dir)
    await seed.useWorkspace('D:/a')
    seed.upsert('old', 1, messages)
    await seed.flush()
    const raw = readFileSync(join(dir, readdirSync(dir)[0]!), 'utf8')
    let release!: (value: string) => void
    const gate = new Promise<string>(resolve => { release = resolve })
    const spy = vi.spyOn(fsPromises, 'readFile').mockImplementationOnce(async () => gate)
    const store = new SearchIndexStore(dir)
    const old = store.useWorkspace('D:/a')
    await vi.waitFor(() => { expect(spy).toHaveBeenCalledTimes(1) })
    await store.useWorkspace('D:/b')
    store.upsert('new', 2, messages)
    await store.flush()
    release(raw)
    await old
    expect(store.ownsWorkspace('D:/b')).toBe(true)
    expect(store.indexed('old', 1)).toBe(false)
    expect(store.indexed('new', 2)).toBe(true)
    const reloaded = new SearchIndexStore(dir)
    await reloaded.useWorkspace('D:/a')
    expect(reloaded.indexed('old', 1)).toBe(true)
    await store.dispose()
  })

  it('读盘未完时的两次关闭都等待最终落盘，不把空快照覆盖到已有索引', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'idx-close-load-'))
    const seed = new SearchIndexStore(dir)
    await seed.useWorkspace('D:/a')
    seed.upsert('old', 1, messages)
    await seed.flush()
    const raw = readFileSync(join(dir, readdirSync(dir)[0]!), 'utf8')
    let release!: (value: string) => void
    const gate = new Promise<string>(resolve => { release = resolve })
    const spy = vi.spyOn(fsPromises, 'readFile').mockImplementationOnce(async () => gate)
    const store = new SearchIndexStore(dir)
    const loaded = store.useWorkspace('D:/a')
    await vi.waitFor(() => { expect(spy).toHaveBeenCalledTimes(1) })
    const closed = store.dispose()
    expect(store.dispose()).toBe(closed)
    release(raw)
    await Promise.all([loaded, closed])
    const reloaded = new SearchIndexStore(dir)
    await reloaded.useWorkspace('D:/a')
    expect(reloaded.indexed('old', 1)).toBe(true)
  })

  it('upsert → flush → 文件存在且可重载检索（期望文件名 = sha1(key)）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'idx-store-'))
    const workspace = 'E:' + String.fromCharCode(92) + '视频压缩'
    const store = new SearchIndexStore(dir)
    await store.useWorkspace(workspace)
    expect(store.active).toBe(true)
    expect(store.upsert('session-1', 12345, messages)).toBe(true)
    await store.flush()
    const files = readdirSync(dir).filter(name => name.startsWith('search-index-'))
    expect(files).toHaveLength(1)
    const reloaded = new SearchIndexStore(dir)
    await reloaded.useWorkspace(workspace)
    expect(reloaded.indexed('session-1', 12345)).toBe(true)
    expect(reloaded.stats.sessions).toBe(1)
    expect(reloaded.search('搜索词').length).toBe(1)
  })

  it('revision 未变 → upsert 不重建；force → 强制重建', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'idx-store-'))
    const store = new SearchIndexStore(dir)
    await store.useWorkspace('D:' + String.fromCharCode(92) + 'proj')
    expect(store.upsert('s1', 100, messages)).toBe(true)
    expect(store.upsert('s1', 100, messages)).toBe(false)
    expect(store.upsert('s1', 100, messages, true)).toBe(true)
  })

  it('flush 失败经 warn 外露（不再全静默）', async () => {
    const warnings: string[] = []
    // 用一个必然失败的“目录”（以文件充当目录）触发 mkdir/write 失败
    const filePath = mkdtempSync(join(tmpdir(), 'idx-store-')) + '/blocker'
    const fsMod = await import('node:fs')
    fsMod.writeFileSync(filePath, 'x')
    const store = new SearchIndexStore(join(filePath, 'sub'), message => { warnings.push(message) })
    await store.useWorkspace('D:' + String.fromCharCode(92) + 'proj2')
    store.upsert('s1', 1, messages)
    await store.flush()
    expect(warnings.some(message => message.startsWith('flush failed'))).toBe(true)
  })

  it('0.1.124：轨道表随 store 落盘/重载（revision 错位拒绝；缺会话 undefined）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'idx-store-'))
    const workspace = 'D:' + String.fromCharCode(92) + 'proj-rail'
    const store = new SearchIndexStore(dir)
    await store.useWorkspace(workspace)
    store.upsert('s1', 100, messages)
    const rail = { segment: [{ seq: 3, mid: 'x', key: 's3' }], turn: [{ seq: 3, mid: 'x', key: 's3' }] }
    expect(store.setRail('s1', 99, rail)).toBe(false)   /* 错位快照拒绝 */
    expect(store.setRail('s1', 100, rail)).toBe(true)
    await store.flush()
    const reloaded = new SearchIndexStore(dir)
    await reloaded.useWorkspace(workspace)
    expect(reloaded.rail('s1')?.segment[0].key).toBe('s3')
    expect(reloaded.rail('missing')).toBeUndefined()
  })
})
