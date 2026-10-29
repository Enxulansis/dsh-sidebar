import { describe, expect, it } from 'vitest'
import {
  formatMessageClock,
  formatRunDuration,
  formatLatencySeconds,
  formatTokensPerSecond,
} from '../src/webview-chrome.js'

describe('webview-chrome (G5 元信息格式函数)', () => {
  const day = new Date('2026-09-07T10:30:00').getTime() // 本周样件内幕 clock
  const sameDay = new Date('2026-09-07T19:51:00').getTime()
  const otherDay = new Date('2026-08-29T19:51:00').getTime() // 同年
  const otherYear = new Date('2025-08-29T19:51:00').getTime() // 跨年

  it('formatMessageClock: 同日 HH:mm', () => {
    expect(formatMessageClock(sameDay, day)).toBe('19:51')
  })
  it('formatMessageClock: 同年 ' + '8月29日 19:51', () => {
    expect(formatMessageClock(otherDay, day)).toBe('8月29日 19:51')
  })
  it('formatMessageClock: 跨年带年', () => {
    expect(formatMessageClock(otherYear, day)).toBe('2025年8月29日 19:51')
  })
  it('formatMessageClock: 无 now 时以当前时刻为参考', () => {
    const todayLabel = String(new Date().getHours()).padStart(2, '0')
    expect(formatMessageClock(Date.now()).slice(0, 2)).toBe(todayLabel)
  })

  it('formatRunDuration: 秒级', () => {
    expect(formatRunDuration(45_000)).toBe('45秒')
    expect(formatRunDuration(999)).toBe('0秒')
  })
  it('formatRunDuration: 分秒', () => {
    expect(formatRunDuration(4 * 60_000 + 15_000)).toBe('4分15秒')
    expect(formatRunDuration(4 * 60_000 + 5_000)).toBe('4分05秒')
  })

  it('formatLatencySeconds: 10 秒内 1 位小数', () => {
    expect(formatLatencySeconds(400)).toBe('0.4')
    expect(formatLatencySeconds(9600)).toBe('9.6')
  })
  it('formatLatencySeconds: ≥10 秒取整', () => {
    expect(formatLatencySeconds(10_400)).toBe('10')
  })

  it('formatTokensPerSecond: ≥10 取整', () => {
    expect(formatTokensPerSecond(114.3)).toBe('114')
  })
  it('formatTokensPerSecond: <10 保留 1 位小数', () => {
    expect(formatTokensPerSecond(4.25)).toBe('4.3')
  })
})