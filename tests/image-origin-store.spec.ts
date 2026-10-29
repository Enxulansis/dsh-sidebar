import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ImageOriginStore } from '../src/image-origin-store.ts'

let dir = ''
const makeStore = (options = {}) => new ImageOriginStore(dir, options)

const PNG_BYTES = Buffer.from('PNG-PAYLOAD-1')
const b64 = (buffer: Buffer) => buffer.toString('base64')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-origins-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('ImageOriginStore（0.0.58 落盘留档）', () => {
  it('round-trips remembered bytes through memory and disk', async () => {
    const store = makeStore()
    await store.load()
    store.remember('s1', 'sha256:a', { rawBase64: b64(PNG_BYTES), label: 'shot.png', displayMediaType: 'image/png' })

    const cached = store.cached('s1', 'sha256:a')
    expect(cached?.rawBase64).toBe(b64(PNG_BYTES))
    expect(cached?.displayMediaType).toBe('image/png')
    await store.flush()

    /* 新实例（模拟重启）：内存为空，靠 manifest + blob 读回 */
    const reloaded = makeStore()
    await reloaded.load()
    expect(reloaded.cached('s1', 'sha256:a')).toBeUndefined()
    const data = await reloaded.dataOf('s1', 'sha256:a')
    expect(data?.rawBase64).toBe(b64(PNG_BYTES))
    expect(data?.label).toBe('shot.png')
    expect(data?.displayMediaType).toBe('image/png')
  })

  it('dedupes identical bytes across keys into one blob file', async () => {
    const store = makeStore()
    await store.load()
    store.remember('s1', 'sha256:a', { rawBase64: b64(PNG_BYTES), label: 'a.png', displayMediaType: 'image/png' })
    store.remember('s1', 'sha256:b', { rawBase64: b64(PNG_BYTES), label: 'b.png', displayMediaType: 'image/png' })
    await store.flush()
    const files = readdirSync(dir).filter(name => name !== 'manifest.json')
    expect(files).toHaveLength(1)
  })

  it('hasDisplay is true only for displayable entries and persists across reloads', async () => {
    const store = makeStore()
    await store.load()
    store.remember('s1', 'sha256:a', { rawBase64: b64(PNG_BYTES), label: 'a.png', displayMediaType: 'image/png' })
    store.remember('s1', 'sha256:g', { rawBase64: b64(Buffer.from('GIF')), label: 'a.gif' })
    await store.flush()

    const reloaded = makeStore()
    await reloaded.load()
    expect(reloaded.hasDisplay('s1', 'sha256:a')).toBe(true)
    expect(reloaded.hasDisplay('s1', 'sha256:g')).toBe(false)
    /* 非显示条目仍可取原字节（复制原格式用） */
    const gif = await reloaded.dataOf('s1', 'sha256:g')
    expect(gif?.rawBase64).toBe(b64(Buffer.from('GIF')))
  })

  it('drops the manifest entry when the blob is missing on disk', async () => {
    const store = makeStore()
    await store.load()
    store.remember('s1', 'sha256:a', { rawBase64: b64(PNG_BYTES), label: 'a.png', displayMediaType: 'image/png' })
    await store.flush()
    for (const name of readdirSync(dir)) {
      if (name !== 'manifest.json') rmSync(join(dir, name))
    }
    /* 新实例（内存缓存为空）→ 读盘失败 → 记录被丢弃 */
    const reloaded = makeStore()
    await reloaded.load()
    expect(await reloaded.dataOf('s1', 'sha256:a')).toBeUndefined()
    expect(reloaded.recordOf('s1', 'sha256:a')).toBeUndefined()
  })

  it('prunes oldest entries beyond the total-bytes cap and deletes their blobs', async () => {
    const store = makeStore({ maxTotalBytes: 8 })
    await store.load()
    store.remember('s1', 'sha256:old', { rawBase64: b64(Buffer.from('123456')), label: 'old.png', displayMediaType: 'image/png' })
    store.remember('s1', 'sha256:keep', { rawBase64: b64(Buffer.from('ab')), label: 'keep.png', displayMediaType: 'image/png' })
    expect(store.recordOf('s1', 'sha256:old')).toBeUndefined()
    expect(store.recordOf('s1', 'sha256:keep')).toBeDefined()
    await store.flush()
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>
    expect(Object.keys(manifest)).toEqual(['s1' + String.fromCharCode(0) + 'sha256:keep'])
  })

  it('removes orphan blob files on load', async () => {
    const store = makeStore()
    await store.load()
    store.remember('s1', 'sha256:a', { rawBase64: b64(PNG_BYTES), label: 'a.png', displayMediaType: 'image/png' })
    await store.flush()
    writeFileSync(join(dir, 'orphan.png'), 'x')
    const reloaded = makeStore()
    await reloaded.load()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(readdirSync(dir)).not.toContain('orphan.png')
  })

  it('removes purged and pruned bytes from the memory budget before caching new originals', async () => {
    const store = makeStore({ maxTotalBytes: 1024 })
    await store.load()
    store.remember('removed', 'a', { rawBase64: b64(Buffer.from('old bytes')), label: 'a.png' })
    await store.flush()
    store.purgeSession('removed')
    expect(store).toHaveProperty('memoryBytes', 0)
    store.remember('kept', 'b', { rawBase64: b64(Buffer.from('new')), label: 'b.png' })
    expect(store).toHaveProperty('memoryBytes', 3)
    store.setMaxTotalBytes(0)
    expect(store).toHaveProperty('memoryBytes', 0)
    expect(store.cached('kept', 'b')).toBeUndefined()
    await store.flush()
  })

  it.each(['purge', 'prune'])('keeps a shared original blob when only one session reference is removed by %s', async reason => {
    const store = makeStore({ maxTotalBytes: 1024 })
    await store.load()
    const entry = { rawBase64: b64(PNG_BYTES), label: 'shared.png', displayMediaType: 'image/png' }
    store.remember('removed', 'a', entry)
    store.remember('kept', 'b', entry)
    await store.flush()
    if (reason === 'purge') store.purgeSession('removed')
    else store.setMaxTotalBytes(store.recordOf('kept', 'b')!.bytes)
    await store.flush()
    await new Promise(r => setTimeout(r, 50))
    const cold = makeStore()
    await cold.load()
    expect(await cold.dataOf('kept', 'b')).toEqual({ rawBase64: entry.rawBase64, label: entry.label, displayMediaType: entry.displayMediaType })
    await cold.flush()
  })

  it('G42-C (0.0.97): setMaxTotalBytes 热更——改小立即剪枝（最旧优先）；-1 = 不剪枝', async () => {
    const store = makeStore({ maxTotalBytes: 1024 })
    await store.load()
    store.remember('s1', 'sha256:k1', { rawBase64: b64(Buffer.from('A'.repeat(300))), label: 'a.png', displayMediaType: 'image/png' })
    store.remember('s1', 'sha256:k2', { rawBase64: b64(Buffer.from('B'.repeat(300))), label: 'b.png', displayMediaType: 'image/png' })
    expect(store.cached('s1', 'sha256:k1')).toBeDefined()
    expect(store.cached('s1', 'sha256:k2')).toBeDefined()
    /* 哨兵 -1：不剪枝（600B 总量在 -1 下原样保留） */
    store.setMaxTotalBytes(-1)
    expect(store.cached('s1', 'sha256:k1')).toBeDefined()
    expect(store.cached('s1', 'sha256:k2')).toBeDefined()
    /* 改小到 100B：总量 600 > 100 → 最旧优先全部淘汰 */
    store.setMaxTotalBytes(100)
    expect(store.cached('s1', 'sha256:k1')).toBeUndefined()
    expect(store.cached('s1', 'sha256:k2')).toBeUndefined()
    /* 非法值忽略（不炸） */
    store.setMaxTotalBytes(Number.NaN)
    expect(store.cached('s1', 'sha256:k1')).toBeUndefined()
  })
})
