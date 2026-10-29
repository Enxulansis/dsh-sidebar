import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DRAFT_IMAGE_CAP_PER_DRAFT,
  DRAFT_SESSION_CAP,
  DraftStore,
  isEmptyDraft,
  pruneDrafts,
  sanitizeDraftPayload,
  sessionDirName,
  type DraftIndex,
} from '../src/draft-store.js'

/* 0.0.161（用户需求）：未发送草稿持久化——纯逻辑（净化/上限/裁剪/路径名）+ fs 往返。 */

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const dirs: string[] = []
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-draft-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ } }
  }
})

describe('draft persistence (0.0.161)', () => {
  it('sanitizeDraftPayload: 字段校验 + 上限（坏图丢弃、保文本）', () => {
    expect(sanitizeDraftPayload(undefined)).toBeUndefined()
    const ok = sanitizeDraftPayload({
      text: '草稿文本',
      images: [
        { id: 'i1', name: 'a.png', mediaType: 'image/png', data: PNG },
        { id: '', name: 'bad', mediaType: 'image/png', data: PNG },            /* 空 id → 丢 */
        { id: 'i2', name: 'b', mediaType: 'text/plain', data: PNG },           /* 非法 mime → 丢 */
        { id: 'i3', name: 'c.png', mediaType: 'image/png', data: 'not-a-dataurl' }, /* 无 data: 前缀 → 丢 */
      ],
    })
    expect(ok).toEqual({ text: '草稿文本', images: [{ id: 'i1', name: 'a.png', mediaType: 'image/png', base64: PNG.slice(PNG.indexOf(',') + 1) }] })
    /* 图片数上限：超出截断 */
    const many = sanitizeDraftPayload({
      text: '',
      images: Array.from({ length: DRAFT_IMAGE_CAP_PER_DRAFT + 4 }, (_, index) => ({ id: `i${index}`, name: 'x.png', mediaType: 'image/png', data: PNG })),
    })
    expect(many?.images.length).toBe(DRAFT_IMAGE_CAP_PER_DRAFT)
  })

  it('isEmptyDraft: 无文本无图视为空（清除语义）', () => {
    expect(isEmptyDraft({ text: '', images: [] })).toBe(true)
    expect(isEmptyDraft({ text: '   ', images: [] })).toBe(true)
    expect(isEmptyDraft({ text: 'x', images: [] })).toBe(false)
    expect(isEmptyDraft({ text: '', images: [{ id: 'i', name: 'n', mediaType: 'image/png', base64: 'Zm9v' }] })).toBe(false)
  })

  it('pruneDrafts: 超会话上限按 at 最旧淘汰', () => {
    const drafts: DraftIndex['drafts'] = {}
    for (let i = 0; i < DRAFT_SESSION_CAP + 3; i += 1) drafts[`s${String(i)}`] = { text: 't', images: [], pinned: [], at: 1000 + i }
    const pruned = pruneDrafts({ version: 1, drafts })
    expect(Object.keys(pruned.drafts).length).toBe(DRAFT_SESSION_CAP)
    expect(pruned.drafts['s0']).toBeUndefined() /* 最旧被淘汰 */
    expect(pruned.drafts[`s${String(DRAFT_SESSION_CAP + 2)}`]).toBeDefined()
  })

  it('sessionDirName: sha1（对任意字符稳定且路径安全）', () => {
    expect(sessionDirName('ws:~a/b\\c')).toMatch(/^[0-9a-f]{40}$/)
    expect(sessionDirName('x')).toBe(sessionDirName('x'))
    expect(sessionDirName('x')).not.toBe(sessionDirName('y'))
  })

  it('DraftStore 往返：text/images/pinned 落盘 → 读回 dataURL；空草稿自删；purge 清库', () => {
    const store = new DraftStore(tempRoot())
    expect(store.enabled).toBe(true)
    store.upsert('s1', {
      text: 'hello',
      images: [{ id: 'i1', name: 'a.png', mediaType: 'image/png', base64: 'Zm9vYmFy' }],
      pinned: [{ id: 'p1', reference: { kind: 'file', path: 'a.ts' } }],
    })
    const restored = store.restore('s1')
    expect(restored?.text).toBe('hello')
    expect(restored?.images).toEqual([{ id: 'i1', name: 'a.png', mediaType: 'image/png', data: 'data:image/png;base64,Zm9vYmFy' }])
    expect(restored?.pinned).toEqual([{ id: 'p1', reference: { kind: 'file', path: 'a.ts' } }])
    /* 文本分片更新保留图片；仅 pinned 更新保留文本 */
    store.upsert('s1', { text: 'hello2' })
    expect(store.restore('s1')?.images.length).toBe(1)
    store.upsert('s1', { pinned: [] })
    expect(store.restore('s1')?.text).toBe('hello2')
    /* 三者皆空 → 自删 */
    store.upsert('s1', { text: '', images: [] })
    expect(store.restore('s1')).toBeUndefined()
    /* 无 storageUri → 静默关闭 */
    const disabled = new DraftStore(undefined)
    expect(disabled.enabled).toBe(false)
    disabled.upsert('s1', { text: 'x' })
    expect(disabled.restore('s1')).toBeUndefined()
  })
})
