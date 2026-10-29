import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { stripPngMetadataBase64, stripPngMetadataBytes } from '../src/png-meta-strip.ts'

/* 造一张最小 PNG：8 字节签名 + 指定块序列（CRC 用占位字节，结构解析不校验 CRC） */
function makePng(chunks: Array<{ type: string; data: Uint8Array }>): Uint8Array {
  const parts: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (const chunk of chunks) {
    const length = chunk.data.length
    parts.push((length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff)
    for (const ch of chunk.type) parts.push(ch.charCodeAt(0))
    parts.push(...chunk.data)
    parts.push(0, 0, 0, 0)
  }
  return new Uint8Array(parts)
}
const text = (value: string) => new TextEncoder().encode(value)
const ihdr = { type: 'IHDR', data: new Uint8Array(13) }
const idat = { type: 'IDAT', data: text('pixels') }
const iend = { type: 'IEND', data: new Uint8Array(0) }

function chunkTypes(bytes: Uint8Array): string[] {
  const types: string[] = []
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = (bytes[offset] << 24 | bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3]) >>> 0
    types.push(String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]))
    if (types[types.length - 1] === 'IEND') break
    offset += 12 + length
  }
  return types
}

describe('PNG metadata strip (0.0.55 反馈①)', () => {
  it('removes eXIf/tEXt/zTXt/iTXt and keeps pixel/color chunks', () => {
    const png = makePng([ihdr, { type: 'sRGB', data: new Uint8Array(1) }, { type: 'eXIf', data: text('exifdata') }, idat, { type: 'tEXt', data: text('Software\0Paint.NET') }, iend])
    const out = stripPngMetadataBytes(png)
    expect(chunkTypes(out)).toEqual(['IHDR', 'sRGB', 'IDAT', 'IEND'])
    expect(out.length).toBeLessThan(png.length)
  })

  it('returns the same reference when nothing to strip or not a PNG', () => {
    const clean = makePng([ihdr, idat, iend])
    expect(stripPngMetadataBytes(clean)).toBe(clean)
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(stripPngMetadataBytes(jpeg)).toBe(jpeg)
  })

  it('falls back to the input on truncated structures', () => {
    const png = makePng([ihdr, { type: 'eXIf', data: text('abc') }, iend])
    const truncated = png.subarray(0, png.length - 2)
    expect(stripPngMetadataBytes(truncated)).toBe(truncated)
  })

  it('round-trips through base64', () => {
    const png = makePng([ihdr, { type: 'eXIf', data: text('meta') }, idat, iend])
    const base64 = Buffer.from(png).toString('base64')
    const stripped = stripPngMetadataBase64(base64)
    expect(chunkTypes(new Uint8Array(Buffer.from(stripped, 'base64')))).toEqual(['IHDR', 'IDAT', 'IEND'])
    /* 无元数据时原样返回同一字符串 */
    expect(stripPngMetadataBase64(stripped)).toBe(stripped)
  })

  it('strips metadata from the distributed icon without changing its pixel chunks', () => {
    const bytes = new Uint8Array(readFileSync(new URL('../media/deepseek.png', import.meta.url)))
    const before = chunkTypes(bytes)
    expect(before).toContain('eXIf')
    const out = stripPngMetadataBytes(bytes)
    const after = chunkTypes(out)
    expect(after).not.toContain('eXIf')
    expect(after).not.toContain('tEXt')
    expect(after).toContain('IDAT')
    expect(after).toContain('IHDR')
  })
})
