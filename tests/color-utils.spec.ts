import { describe, expect, it } from 'vitest'
import { hexToRgb, hslToRgb, normalizeHexColor, rgbToHex, rgbToHsl } from '../src/color-utils.js'

describe('color-utils (G45 0.0.103)', () => {
  it('normalizes hex forms and rejects invalid input', () => {
    expect(normalizeHexColor('#A1B2C3')).toBe('#a1b2c3')
    expect(normalizeHexColor('#abc')).toBe('#aabbcc')
    expect(normalizeHexColor(' #FFF ')).toBe('#ffffff')
    expect(normalizeHexColor('red')).toBeUndefined()
    expect(normalizeHexColor('#12345')).toBeUndefined()
    expect(normalizeHexColor(42)).toBeUndefined()
  })

  it('converts hex → rgb and back', () => {
    expect(hexToRgb('#4d6bfe')).toEqual({ r: 77, g: 107, b: 254 })
    expect(rgbToHex(77, 107, 254)).toBe('#4d6bfe')
    expect(rgbToHex(300, -20, 12.6)).toBe('#ff000d')
    expect(hexToRgb('nope')).toBeUndefined()
  })

  it('round-trips rgb ↔ hsl within rounding tolerance', () => {
    const samples = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [77, 107, 254], [70, 167, 88], [139, 141, 152]]
    for (const [r, g, b] of samples) {
      const hsl = rgbToHsl(r, g, b)
      const back = hslToRgb(hsl.h, hsl.s, hsl.l)
      expect(Math.abs(back.r - r)).toBeLessThanOrEqual(3)
      expect(Math.abs(back.g - g)).toBeLessThanOrEqual(3)
      expect(Math.abs(back.b - b)).toBeLessThanOrEqual(3)
    }
  })

  it('keeps grayscale stable and wraps hue', () => {
    expect(hslToRgb(0, 0, 50)).toEqual({ r: 128, g: 128, b: 128 })
    expect(hslToRgb(370, 100, 50)).toEqual(hslToRgb(10, 100, 50))
    expect(rgbToHsl(128, 128, 128)).toEqual({ h: 0, s: 0, l: 50 })
  })
})
