import { describe, expect, it } from 'vitest'
import {
  bindSentOrigins,
  estimateBase64Bytes,
  originFileName,
  originKey,
  planPrune,
  sanitizeManifest,
  type OriginManifest,
} from '../src/image-origins.ts'

const png = (name: string, data = 'AAAA') => ({ name, mediaType: 'image/png', data })
const target = (id: string, name?: string) => ({ attachmentId: id, mediaType: 'image/png', ...(name === undefined ? {} : { name }) })

describe('bindSentOrigins（0.0.58 发送图 ↔ 投影图逐位绑定）', () => {
  it('binds a native PNG by index and enables display of the original bytes', () => {
    const bound = bindSentOrigins([png('shot.png', 'BBBB')], [target('sha256:1', 'shot.png')])
    expect(bound).toEqual([
      { attachmentId: 'sha256:1', entry: { rawBase64: 'BBBB', label: 'shot.png', displayMediaType: 'image/png' } },
    ])
  })

  it('binds GIF for the display override too (0.0.77: animated bubble after echo)', () => {
    const sent = [{ name: 'anim.gif', mediaType: 'image/gif', data: 'GIFDATA' }]
    const bound = bindSentOrigins(sent, [target('sha256:2', 'anim.gif')])
    expect(bound?.[0]?.entry).toEqual({ rawBase64: 'GIFDATA', label: 'anim.gif', displayMediaType: 'image/gif' })
  })

  it('stores the pre-conversion bytes for rasterized formats (no display override — the rasterized PNG stays)', () => {
    const sent = [{ name: 'icon.svg', mediaType: 'image/png', data: 'PNGRASTER', originData: 'SVGRAW', originName: 'icon.svg' }]
    const bound = bindSentOrigins(sent, [target('sha256:3', 'icon.svg')])
    expect(bound?.[0]?.entry).toEqual({ rawBase64: 'SVGRAW', label: 'icon.svg' })
  })

  it('abandons the whole binding when counts differ', () => {
    expect(bindSentOrigins([png('a.png'), png('b.png')], [target('sha256:1', 'a.png')])).toBeUndefined()
  })

  it('abandons the binding when both sides carry names and they differ', () => {
    expect(bindSentOrigins([png('a.png')], [target('sha256:1', 'b.png')])).toBeUndefined()
  })

  it('tolerates a missing name on either side (runtime events may omit it)', () => {
    expect(bindSentOrigins([png('a.png')], [target('sha256:1')])).toHaveLength(1)
    const noName = [{ mediaType: 'image/png', data: 'CCCC' }]
    expect(bindSentOrigins(noName, [target('sha256:1', 'a.png')])).toHaveLength(1)
  })

  it('rejects images without an attachment id or over the size cap', () => {
    expect(bindSentOrigins([png('a.png')], [{ attachmentId: '', mediaType: 'image/png', name: 'a.png' }])).toBeUndefined()
    expect(bindSentOrigins([png('a.png')], [target('sha256:1', 'a.png')], { maxSingleBytes: 2 })).toBeUndefined()
  })

  it('estimateBase64Bytes approximates decoded size', () => {
    expect(estimateBase64Bytes('AAAA')).toBe(3)
    expect(estimateBase64Bytes('')).toBe(0)
  })
})

describe('originFileName（内容寻址 + 原名扩展名）', () => {
  it('is stable for identical bytes and keeps a lowercased extension', () => {
    const a = originFileName('QUJD', 'Shot.PNG')
    const b = originFileName('QUJD', 'other.png')
    expect(a).toBe(b)
    expect(a.endsWith('.png')).toBe(true)
    expect(a).toMatch(/^[0-9a-f]{32}\.png$/)
  })

  it('falls back to .bin without an extension', () => {
    expect(originFileName('QUJD', 'noext')).toMatch(/\.bin$/)
    expect(originFileName('QUJD', '')).toMatch(/\.bin$/)
  })
})

describe('planPrune（超容量按最久未用淘汰）', () => {
  const record = (bytes: number, lastUsedAt: number) => ({ label: 'x.png', file: 'f', bytes, addedAt: 0, lastUsedAt })
  it('keeps everything under the cap', () => {
    const manifest: OriginManifest = { a: record(100, 1) }
    expect(planPrune(manifest, 1000)).toEqual([])
  })
  it('drops oldest-first until within the cap', () => {
    const manifest: OriginManifest = { a: record(100, 3), b: record(100, 1), c: record(100, 2) }
    expect(planPrune(manifest, 150)).toEqual(['b', 'c'])
  })
  it('G42-C (0.0.97): maxTotalBytes = -1 → 不剪枝（显式哨兵分支，绝不走进"全删"）', () => {
    const manifest: OriginManifest = { a: record(600, 1), b: record(600, 2) }
    expect(planPrune(manifest, -1)).toEqual([])
  })
})

describe('sanitizeManifest（读回净化）', () => {
  it('drops broken entries and defaults the rest', () => {
    const manifest = sanitizeManifest({ good: { file: 'f.png', bytes: 5 }, bad: { file: '' }, junk: 3, nonobj: null })
    expect(Object.keys(manifest)).toEqual(['good'])
    expect(manifest.good?.label).toBe('image')
  })
  it('returns an empty manifest for non-objects', () => {
    expect(sanitizeManifest([])).toEqual({})
    expect(sanitizeManifest('x')).toEqual({})
    expect(sanitizeManifest(undefined)).toEqual({})
  })
})

describe('originKey', () => {
  it('is unique per session + attachment pair', () => {
    expect(originKey('s1', 'a')).toBe(originKey('s1', 'a'))
    expect(originKey('s1', 'a')).not.toBe(originKey('s2', 'a'))
    expect(originKey('s1', 'a')).not.toBe(originKey('s1', 'b'))
  })
})
