import { describe, expect, it } from 'vitest'
import type { DshEvent } from '../src/conversation.js'
import { synthesizeDiffView } from '../src/diff-view.js'

/* 0.1.5 的 view 合成：write/edit/str_replace_editor 的调用参数推导 + 结果 meta.diffs
   （与官方 dsh-client-ui-tool 的 intendedDiff / appliedDiffs 同款）。 */

const call = (name: string, args: Record<string, unknown>): DshEvent =>
  ({ type: 'tool/call', seq: 1, time: 1, data: { turn: 1, step: 1, callId: 'c1', name, arguments: JSON.stringify(args) } })
const result = (meta: unknown): DshEvent =>
  ({ type: 'tool/result', seq: 2, time: 2, data: { turn: 1, step: 1, message: { source: { callId: 'c1' } }, meta } })

describe('synthesizeDiffView', () => {
  it('write 调用 → 整文件差异（oldText null）', () => {
    expect(synthesizeDiffView(call('write', { file_path: 'a.txt', content: 'hello' }))).toEqual({
      for: 'call',
      view: { card: 'diff', title: 'write a.txt', diffs: [{ path: 'a.txt', oldText: null, newText: 'hello' }] },
    })
  })

  it('edit 调用 → 片段差异；空 old_string 归一为 null', () => {
    expect(synthesizeDiffView(call('edit', { file_path: 'a.txt', old_string: 'x', new_string: 'y' }))?.view.diffs)
      .toEqual([{ path: 'a.txt', oldText: 'x', newText: 'y' }])
    expect(synthesizeDiffView(call('edit', { file_path: 'a.txt', old_string: '', new_string: 'y' }))?.view.diffs)
      .toEqual([{ path: 'a.txt', oldText: null, newText: 'y' }])
  })

  it('edit 的沙箱升级字段须成对合法（官方 validEscalationFields 同款）', () => {
    const base = { file_path: 'a.txt', old_string: 'x', new_string: 'y' }
    expect(synthesizeDiffView(call('edit', { ...base, sandbox_permissions: 'danger-full-access', justification: '需要写越界路径' }))).toBeDefined()
    expect(synthesizeDiffView(call('edit', { ...base, sandbox_permissions: 'danger-full-access' }))).toBeUndefined()
    expect(synthesizeDiffView(call('edit', { ...base, sandbox_permissions: 'anything', justification: 'x' }))).toBeUndefined()
  })

  it('str_replace_editor：create / str_replace；insert 不产卡', () => {
    expect(synthesizeDiffView(call('str_replace_editor', { command: 'create', path: 'b.txt', file_text: 'hi' }))?.view.diffs)
      .toEqual([{ path: 'b.txt', oldText: null, newText: 'hi' }])
    expect(synthesizeDiffView(call('str_replace_editor', { command: 'str_replace', path: 'b.txt', old_str: 'h', new_str: 'H' }))?.view.diffs)
      .toEqual([{ path: 'b.txt', oldText: 'h', newText: 'H' }])
    expect(synthesizeDiffView(call('str_replace_editor', { command: 'insert', path: 'b.txt', new_str: 'x' }))).toBeUndefined()
  })

  it('非写类工具 / 参数不合法 → 不产卡', () => {
    expect(synthesizeDiffView(call('read', { file_path: 'a.txt' }))).toBeUndefined()
    expect(synthesizeDiffView(call('bash', { command: 'ls' }))).toBeUndefined()
    expect(synthesizeDiffView(call('write', { file_path: '', content: 'x' }))).toBeUndefined()
    expect(synthesizeDiffView(call('write', { file_path: 'a.txt' }))).toBeUndefined()
    expect(synthesizeDiffView({ type: 'tool/call', seq: 1, time: 1, data: { name: 'write', arguments: 'not-json' } })).toBeUndefined()
    expect(synthesizeDiffView({ type: 'tool/call', seq: 1, time: 1, data: undefined })).toBeUndefined()
  })

  it('结果 meta.diffs → result 卡；空数组/坏形状 → 不产卡（消费面回落到调用侧）', () => {
    expect(synthesizeDiffView(result({ diffs: [{ path: 'a.txt', oldText: 'x', newText: 'y' }] }))?.for).toBe('result')
    expect(synthesizeDiffView(result({ diffs: [] }))).toBeUndefined()
    expect(synthesizeDiffView(result({ diffs: [{ path: 'a.txt', oldText: 1, newText: 'y' }] }))).toBeUndefined()
    expect(synthesizeDiffView(result({ diffs: 'oops' }))).toBeUndefined()
    expect(synthesizeDiffView(result({}))).toBeUndefined()
  })

  it('非工具事件不产卡', () => {
    expect(synthesizeDiffView({ type: 'user/message', seq: 1, time: 1, data: {} })).toBeUndefined()
    expect(synthesizeDiffView({ type: 'assistant/chunk', seq: 1, time: 1, data: {} })).toBeUndefined()
  })
})
