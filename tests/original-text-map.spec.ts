import { describe, expect, it } from 'vitest'
// G50（0.0.109）：生成物本体校验——映射非空、关键条目正确（官方 dict 再生成后仍应成立）。
import { ORIGINAL_TEXT_MAP } from '../src/original-text-map.js'

describe('original-text-map (G50 0.0.109)', () => {
  it('carries the official translations for key UI strings', () => {
    const map = ORIGINAL_TEXT_MAP as Record<string, string>
    expect(map['已完成']).toBe('Completed')
    expect(map['允许一次']).toBe('Allow once')
    expect(map['拒绝']).toBe('Reject')
    expect(map['等待审批']).toBe('Waiting for approval')
    expect(map['失败']).toBe('Failed')
    expect(map['已停止']).toBe('Stopped')
  })

  it('excludes placeholders and self-authored copy', () => {
    const map = ORIGINAL_TEXT_MAP as Record<string, string>
    expect(map['变更文件']).toBeUndefined()
    for (const key of Object.keys(map)) expect(key.includes('{')).toBe(false)
  })

  it('has a reasonable size (regenerated from the official dictionaries)', () => {
    const size = Object.keys(ORIGINAL_TEXT_MAP as Record<string, string>).length
    expect(size).toBeGreaterThan(200)
    expect(size).toBeLessThan(2000)
  })
})
