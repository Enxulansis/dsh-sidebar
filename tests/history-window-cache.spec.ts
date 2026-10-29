import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mergedWindowHasMore } from '../src/history.js'

/* 2026-10-06（滚顶案根治）静态防线 + 纯函数契约：
   事故根因 = `rememberHistoryWindow` 读 `this._state.hasMoreHistory`，而 loadSession /
   loadOlderHistory 都在"发布新值**之前**"调用它 ⇒ 窗口缓存被写入**陈旧值** ⇒ 用户"切走→切回"
   走缓存命中 catch-up 时 `mergedWindowHasMore`（catch-up 小页必非 deeper）取缓存值
   误判 hasMore=false ⇒ 按钮不渲染 + 滚轮预取被挡 + 节点点击 loadThroughSequence 即 break
   （三路死，直到 Reload 清缓存）。修复 = hasMore **必传显式值**；此处按源码扫描封死复活。 */
const source = readFileSync(join(process.cwd(), 'src', 'extension.ts'), 'utf8')

describe('rememberHistoryWindow 显式 hasMore（滚浪案静态防线）', () => {
  it('签名必传布尔（不可回退"读 state"形态）', () => {
    expect(source).toContain('private rememberHistoryWindow(sessionId: string, hasMore: boolean): void')
  })

  it('三处调用全部显式传值；不存在裸调用', () => {
    /* loadSession：传本次加载算出的真值 */
    expect(source).toContain('this.rememberHistoryWindow(sessionId, hasMore)')
    /* loadOlderHistory：传本次翻页页面的真值 */
    expect(source).toContain('this.rememberHistoryWindow(sessionId, page.hasMore === true)')
    /* acceptFrame：实时事件不改 hasMore，state 即真值（显式写出，不再隐式读） */
    expect(source).toContain('this.rememberHistoryWindow(sessionId, this._state.hasMoreHistory)')
    const bareCalls = [...source.matchAll(/rememberHistoryWindow\(sessionId\)/g)]
    expect(bareCalls).toHaveLength(0)
  })

  it('catch-up 日志行含四输入留痕（真机对账通道）', () => {
    expect(source).toContain('pageHM=')
    expect(source).toContain('cachedHM=')
    expect(source).toContain('pageE=')
    expect(source).toContain('cachedE=')
  })
})

describe('mergedWindowHasMore 翻假渠道契约（事故读数复现对）', () => {
  it('catch-up 小页非 deeper ⇒ 结果取缓存值——缓存毒化即翻假、缓存健康即保持真', () => {
    /* 事故现场口径：pageEarliest 晚于 cachedEarliest（catch-up 页必非 deeper）⇒ 取 cachedHasMore。 */
    expect(mergedWindowHasMore(19100, 17, true, false)).toBe(false)
    expect(mergedWindowHasMore(19100, 17, true, true)).toBe(true)
  })

  it('页更深（回退大页场景）⇒ 取页值（另一侧语义不变）', () => {
    expect(mergedWindowHasMore(5, 100, true, false)).toBe(true)
    expect(mergedWindowHasMore(5, 100, false, true)).toBe(false)
  })
})
