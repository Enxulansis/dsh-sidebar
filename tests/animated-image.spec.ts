import { describe, expect, it } from 'vitest'
import { animatedKindOfBytes } from '../src/webview-chrome.js'

/* G34（0.0.82）多格式动图嗅探单测。
   夹具来源（与 harness 同素材，生成命令）：
   node -e "…" 见 _temp/dsh_harness/gif-fixture.mjs（GIF）+ _temp/dsh_harness/apng-fixture.mjs（APNG），
   WebP/JPEG 由 dsh 自带 sharp 从前者转出（动图 WebP 用无损档）。 */
const FIXTURES = {
  GIF_MULTI: 'R0lGODlhAgACAIAAAP8AAAAA/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAgACAAACA4ShAAAh+QQACgAAACwAAAAAAgACAAACA4yjAAAh+QQACgAAACwAAAAAAgACAAACA4ShAAA7', /* 111B，3 帧 */
  GIF_SINGLE: 'R0lGODlhAgACAIAAAP8AAAAA/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAgACAAACA4ShAAA7', /* 63B，1 帧 */
  APNG_MULTI: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACGFjVEwAAAADAAAAAM7tusAAAAAaZmNUTAAAAAAAAAACAAAAAgAAAAAAAAAAAGQD6AAAAVWPHQAAABFJREFUeNpj+M/A8J8BjIEUAB/uA/2vv+IEAAAAGmZjVEwAAAABAAAAAgAAAAIAAAAAAAAAAABkA+gAAJomZckAAAATZmRBVAAAAAJ42mNgYPgPRmAKABf2A/0IA9ToAAAAGmZjVEwAAAADAAAAAgAAAAIAAAAAAAAAAABkA+gAAHewtiAAAAAVZmRBVAAAAAR42mP4z8DwnwGMgRQAH+4D/UwZzy8AAAAASUVORK5CYII=', /* 272B，APNG 3 帧 */
  PNG_STATIC: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAE0lEQVQImWP4z8DwnwGM/zMwAAAf7gP9qS/A4gAAAABJRU5ErkJggg==', /* 97B，静态 PNG */
  WEBP_ANIM: 'UklGRrQAAABXRUJQVlA4WAoAAAACAAAAAQAAAQAAQU5JTQYAAAD/////AABBTk1GKAAAAAAAAAAAAAEAAAEAAGQAAAJWUDhMDwAAAC8BQAAABxD9j/4HIqL/AQBBTk1GKAAAAAAAAAAAAAEAAAEAAGQAAABWUDhMDwAAAC8BQAAABxDR//4HIqL/AQBBTk1GKAAAAAAAAAAAAAEAAAEAAGQAAABWUDhMDwAAAC8BQAAABxD9j/4HIqL/AQA=', /* 188B，动图 WebP 3 帧 */
  WEBP_STATIC: 'UklGRhwAAABXRUJQVlA4TA8AAAAvAUAAAAcQ/Y/+ByKi/wEA', /* 36B，静态 WebP */
  JPEG_STATIC: '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z', /* 270B，JPEG */
} as const

const bytesOf = (base64: string): Uint8Array => Uint8Array.from(Buffer.from(base64, 'base64'))

describe('animatedKindOfBytes (G34 多格式动图嗅探)', () => {
  it('recognizes multi-frame GIF, APNG and animated WebP', () => {
    expect(animatedKindOfBytes(bytesOf(FIXTURES.GIF_MULTI))).toBe('gif')
    expect(animatedKindOfBytes(bytesOf(FIXTURES.APNG_MULTI))).toBe('png')
    expect(animatedKindOfBytes(bytesOf(FIXTURES.WEBP_ANIM))).toBe('webp')
  })

  it('keeps single-frame and non-animated formats on the static path', () => {
    expect(animatedKindOfBytes(bytesOf(FIXTURES.GIF_SINGLE))).toBeUndefined()
    expect(animatedKindOfBytes(bytesOf(FIXTURES.PNG_STATIC))).toBeUndefined()
    expect(animatedKindOfBytes(bytesOf(FIXTURES.WEBP_STATIC))).toBeUndefined()
    expect(animatedKindOfBytes(bytesOf(FIXTURES.JPEG_STATIC))).toBeUndefined()
  })

  it('never throws on truncated or foreign bytes', () => {
    const gif = bytesOf(FIXTURES.GIF_MULTI)
    expect(animatedKindOfBytes(gif.subarray(0, 40))).toBeUndefined()
    expect(animatedKindOfBytes(new Uint8Array(0))).toBeUndefined()
    expect(animatedKindOfBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]))).toBeUndefined()
    const apng = bytesOf(FIXTURES.APNG_MULTI)
    expect(animatedKindOfBytes(apng.subarray(0, 20))).toBeUndefined()
  })

  it('ignores a colour-table-like 0x2C byte inside pixel data (structure walk, not byte scan)', () => {
    /* 单帧 GIF：把色表后的 LZW 数据换成含 0x2C 的字节——朴素扫描会误判，结构走查必须仍是静态。 */
    const single = bytesOf(FIXTURES.GIF_SINGLE)
    const tampered = single.slice()
    tampered[30] = 0x2c
    tampered[31] = 0x2c
    expect(animatedKindOfBytes(tampered)).toBeUndefined()
  })
})
