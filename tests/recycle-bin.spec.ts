import { mkdtemp, mkdir, writeFile, readFile, access, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classifyRecycle, sameCwd, SessionRecycleBin } from '../src/recycle-bin.js'

let root: string
let home: string
let recycle: SessionRecycleBin

const UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const SID = `session-${UUID}`

async function seedSession(id: string): Promise<void> {
  const dir = join(home, 'sessions', 'ws-a', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'session.jsonl.zstd'), 'seed', 'utf8')
}

describe('SessionRecycleBin', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'recycle-bin-'))
    home = join(root, 'dsh')
    recycle = new SessionRecycleBin(home)
  })

  afterEach(async () => {
    const { rm } = await import('node:fs/promises')
    await rm(root, { recursive: true, force: true })
  })

  it('trashes a session by moving it out of the sessions tree (runtime prefixed id)', async () => {
    await seedSession(SID)
    await recycle.trash(SID, 'ws-a', 'My convo')
    await expect(access(join(home, 'sessions', 'ws-a', SID))).rejects.toThrow()
    const items = await recycle.list()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: SID, workspace: 'ws-a', title: 'My convo' })
  })

  it('restores a trashed session back to its original workspace', async () => {
    await seedSession(SID)
    await recycle.trash(SID, 'ws-a', 'My convo')
    const restored = await recycle.restore(SID)
    expect(restored).toBe(true)
    expect(await recycle.list()).toHaveLength(0)
    const back = join(home, 'sessions', 'ws-a', SID)
    await expect(access(back)).resolves.toBeUndefined()
    expect(await readFile(join(back, 'session.jsonl.zstd'), 'utf8')).toBe('seed')
  })

  it('accepts the bare-uuid id form and normalizes it to the runtime prefix', async () => {
    await seedSession(SID)
    await recycle.trash(UUID, 'ws-a', 'Bare')
    const items = await recycle.list()
    expect(items[0]?.id).toBe(SID)
    const restored = await recycle.restore(UUID)
    expect(restored).toBe(true)
    await expect(access(join(home, 'sessions', 'ws-a', SID))).resolves.toBeUndefined()
  })

  it('purges a trashed session permanently', async () => {
    await seedSession(SID)
    await recycle.trash(SID, 'ws-a', '')
    const purged = await recycle.purge(SID)
    expect(purged).toBe(true)
    expect(await recycle.list()).toHaveLength(0)
    expect(await readdir(join(home, 'recycle-bin'))).not.toContain(SID)
  })

  it('sorts recycle entries by last message time, newest first, with deletedAt fallback (G23)', async () => {
    const laterTalked = 'session-aaaaaaaa-eeee-ffff-8888-abcdef000001'
    const earlierTalked = 'session-bbbbbbbb-eeee-ffff-8888-abcdef000002'
    const legacy = 'session-cccccccc-eeee-ffff-8888-abcdef000003'
    const manifest = join(home, 'recycle-bin', 'manifest.json')
    await mkdir(join(home, 'recycle-bin'), { recursive: true })
    await writeFile(manifest, JSON.stringify({ items: [
      { id: earlierTalked, workspace: 'ws-a', title: 'talked earlier but deleted later', deletedAt: 1000, lastMessageAt: 100 },
      { id: laterTalked, workspace: 'ws-a', title: 'talked later but deleted earlier', deletedAt: 500, lastMessageAt: 900 },
      { id: legacy, workspace: 'ws-a', title: 'legacy no lastMessageAt', deletedAt: 500 },
    ] }), 'utf8')
    const items = await recycle.list()
    expect(items.map(item => item.id)).toEqual([laterTalked, legacy, earlierTalked])
  })

  it('physically drops entries older than the retention window', async () => {
    const oldSid = 'session-aaaaaaaa-eeee-ffff-8888-abcdef000001'
    const newSid = 'session-bbbbbbbb-eeee-ffff-8888-abcdef000002'
    await seedSession(oldSid)
    await seedSession(newSid)
    await recycle.trash(oldSid, 'ws-a', 'old')
    await recycle.trash(newSid, 'ws-a', 'new')
    const edited = (await recycle.list()).map(item => item.id === oldSid
      ? { ...item, deletedAt: Date.now() - 31 * 24 * 3600 * 1000 }
      : item)
    const manifest = join(home, 'recycle-bin', 'manifest.json')
    await writeFile(manifest, JSON.stringify({ items: edited }), 'utf8')
    await recycle.prune(30 * 24 * 3600 * 1000)
    const remaining = await recycle.list()
    expect(remaining.map(item => item.id)).toEqual([newSid])
  })

  it('rejects invalid session ids', async () => {
    await expect(recycle.trash('../escape', 'ws-a', '')).resolves.toBe(false)
    await expect(recycle.restore('../../etc/passwd')).resolves.toBe(false)
    await expect(recycle.purge('not-a-uuid')).resolves.toBe(false)
  })

  /* 0.0.147（用户反馈②）：回收站按项目隔离——条目记录原 cwd，旧条目从 dsh projcache 回填。 */
  it('records the origin cwd on trash', async () => {
    await seedSession(SID)
    await recycle.trash(SID, 'ws-a', 'T', undefined, 'D:\\proj\\a')
    const items = await recycle.list()
    expect(items[0]?.cwd).toBe('D:\\proj\\a')
  })

  it('backfills missing cwd from the dsh project cache and writes back once (0.0.147)', async () => {
    const legacy = 'session-bbbbbbbb-eeee-ffff-8888-abcdef000002'
    const orphan = 'session-cccccccc-eeee-ffff-8888-abcdef000003'
    await seedSession(legacy)
    await seedSession(orphan)
    /* 两个旧条目都无 cwd（0.0.147 之前 trash 的形态）。 */
    await recycle.trash(legacy, 'ws-a', 'legacy')
    await recycle.trash(orphan, 'ws-a', 'orphan')
    await mkdir(join(home, 'storages'), { recursive: true })
    await writeFile(join(home, 'storages', 'session_projcache.json'), JSON.stringify({
      tables: { sessions: { [legacy]: { identity: { createdAt: 1, cwd: 'd:/proj/a' } } } },
    }), 'utf8')
    await expect(recycle.backfillCwd()).resolves.toBe(1)
    const items = await recycle.list()
    expect(items.find(item => item.id === legacy)?.cwd).toBe('d:/proj/a')
    /* 缓存里没有的条目保持无 cwd（分类时走 workspace 目录兜底）；再次回填无新增写入。 */
    expect(items.find(item => item.id === orphan)?.cwd).toBeUndefined()
    await expect(recycle.backfillCwd()).resolves.toBe(0)
  })

  it('classifies items by cwd first and falls back to workspace dirs (0.0.147)', () => {
    const mineByCwd = { id: 'session-11111111-1111-1111-1111-111111111111', workspace: 'ws-x', title: 'a', deletedAt: 1, cwd: 'D:\\Proj\\A' }
    const otherByCwd = { id: 'session-22222222-2222-2222-2222-222222222222', workspace: 'ws-y', title: 'b', deletedAt: 1, cwd: 'D:\\Proj\\B' }
    const unknownInDir = { id: 'session-33333333-3333-3333-3333-333333333333', workspace: 'ws-mine', title: 'c', deletedAt: 1 }
    const unknownOutDir = { id: 'session-44444444-4444-4444-4444-444444444444', workspace: 'ws-other', title: 'd', deletedAt: 1 }
    /* cwd 主键（含斜杠/大小写规范化）；无 cwd 走 workspace 目录集合。 */
    const scoped = classifyRecycle([mineByCwd, otherByCwd, unknownInDir, unknownOutDir], 'd:/proj/a/', new Set(['ws-mine']))
    expect(scoped.mine.map(item => item.id)).toEqual([mineByCwd.id, unknownInDir.id])
    expect(scoped.others.map(item => item.id)).toEqual([otherByCwd.id, unknownOutDir.id])
    /* 本项目暂无活会话（目录集合为空）→ 无 cwd 条目宁可多显示，不丢数据。 */
    const fallback = classifyRecycle([unknownInDir, unknownOutDir], 'D:\\Proj\\A', new Set())
    expect(fallback.mine).toHaveLength(2)
    expect(fallback.others).toHaveLength(0)
    /* cwd 已知但目录集合为空时仍以 cwd 为准。 */
    const cwdOnly = classifyRecycle([mineByCwd, otherByCwd], 'D:\\Proj\\A', new Set())
    expect(cwdOnly.mine.map(item => item.id)).toEqual([mineByCwd.id])
  })

  it('sameCwd normalizes separators, trailing slashes and case', () => {
    expect(sameCwd('D:\\Proj\\A', 'd:/proj/a')).toBe(true)
    expect(sameCwd('d:/proj/a/', 'D:\\Proj\\A')).toBe(true)
    expect(sameCwd('D:\\Proj\\B', 'D:\\Proj\\A')).toBe(false)
    expect(sameCwd(undefined, 'D:\\Proj\\A')).toBe(false)
    expect(sameCwd('', 'D:\\Proj\\A')).toBe(false)
  })
})
