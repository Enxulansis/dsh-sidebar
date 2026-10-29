import { describe, expect, it } from 'vitest'
import {
  memoryFromPlain,
  memoryToPlain,
  mergeRememberedMeta,
  rememberMeta,
  rememberedMeta,
} from '../src/turn-meta-memory.js'
import type { MessageMeta } from '../src/conversation.js'

describe('TurnMetaMemory (G5 v4 胶囊持久记忆；0.0.123 扩展为三项)', () => {
  it('remember → get 同会话同 turn 命中（三项）', () => {
    const memory = new Map()
    expect(rememberMeta(memory, 's1', 'assistant:1:1', { tokS: 125, durationMs: 1391, firstTokenMs: 559 })).toBe(true)
    expect(rememberedMeta(memory, 's1', 'assistant:1:1')).toEqual({ tokS: 125, durationMs: 1391, firstTokenMs: 559 })
  })

  it('值未变不重复写（持久化触发信号）；新增字段也算变化', () => {
    const memory = new Map()
    rememberMeta(memory, 's1', 'assistant:1:1', { tokS: 125 })
    expect(rememberMeta(memory, 's1', 'assistant:1:1', { tokS: 125 })).toBe(false)
    expect(rememberMeta(memory, 's1', 'assistant:1:1', { durationMs: 900 })).toBe(true)
    expect(rememberedMeta(memory, 's1', 'assistant:1:1')).toEqual({ tokS: 125, durationMs: 900 })
  })

  it('会话/会话、turn 之间隔离', () => {
    const memory = new Map()
    rememberMeta(memory, 's1', 'assistant:1:1', { tokS: 125 })
    rememberMeta(memory, 's1', 'assistant:1:2', { tokS: 30 })
    rememberMeta(memory, 's2', 'assistant:1:1', { tokS: 99 })
    expect(rememberedMeta(memory, 's1', 'assistant:1:2')).toEqual({ tokS: 30 })
    expect(rememberedMeta(memory, 's1', 'assistant:1:1')).toEqual({ tokS: 125 })
    expect(rememberedMeta(memory, 's2', 'assistant:1:1')).toEqual({ tokS: 99 })
    expect(rememberedMeta(memory, 's1', 'assistant:2:1')).toBeUndefined()
    expect(rememberedMeta(memory, 's3', 'assistant:1:1')).toBeUndefined()
  })

  it('来自持久化的 roundtrip：toPlain → fromPlain 重建（三项保真）', () => {
    const memory = new Map()
    rememberMeta(memory, 's1', 'assistant:1:1', { tokS: 125, durationMs: 1391, firstTokenMs: 559 })
    rememberMeta(memory, 's1', 'assistant:1:2', { tokS: 30 })
    rememberMeta(memory, 's2', 'assistant:1:1', { tokS: 99, durationMs: 700 })
    const rebuilt = memoryFromPlain(memoryToPlain(memory))
    expect(rememberedMeta(rebuilt, 's1', 'assistant:1:1')).toEqual({ tokS: 125, durationMs: 1391, firstTokenMs: 559 })
    expect(rememberedMeta(rebuilt, 's1', 'assistant:1:2')).toEqual({ tokS: 30 })
    expect(rememberedMeta(rebuilt, 's2', 'assistant:1:1')).toEqual({ tokS: 99, durationMs: 700 })
  })

  it('旧格式兼容：数字= tokS（0.0.123 之前持久化的数据）', () => {
    const rebuilt = memoryFromPlain({ s1: { 'assistant:1:1': 125 } })
    expect(rememberedMeta(rebuilt, 's1', 'assistant:1:1')).toEqual({ tokS: 125 })
  })

  it('脏数据防护：非对象/非法数值忽略', () => {
    const rebuilt = memoryFromPlain({ s1: { bad: 'x', ok: 42, mixed: { tokS: 10, durationMs: 'no' } } })
    expect(rememberedMeta(rebuilt, 's1', 'bad')).toBeUndefined()
    expect(rememberedMeta(rebuilt, 's1', 'ok')).toEqual({ tokS: 42 })
    expect(rememberedMeta(rebuilt, 's1', 'mixed')).toEqual({ tokS: 10 })
    expect(memoryFromPlain(null)).toEqual(new Map())
    expect(memoryFromPlain('[1,2]')).toEqual(new Map())
  })

  it('merge：恢复 meta 缺项 → 记忆补回（三项都补）', () => {
    const meta: MessageMeta = {}
    expect(mergeRememberedMeta(meta, { tokS: 125, durationMs: 1391, firstTokenMs: 559 }))
      .toEqual({ tokS: 125, durationMs: 1391, firstTokenMs: 559 })
  })

  it('merge：实时值优先，记忆只补缺项', () => {
    const live: MessageMeta = { durationMs: 1391, firstTokenMs: 559, tokS: 88 }
    expect(mergeRememberedMeta(live, { tokS: 125, durationMs: 9999 }))
      .toEqual({ durationMs: 1391, firstTokenMs: 559, tokS: 88 })
    const partial: MessageMeta = { tokS: 88 }
    expect(mergeRememberedMeta(partial, { tokS: 125, durationMs: 1391 }))
      .toEqual({ tokS: 88, durationMs: 1391 })
  })

  it('merge：无记忆 → 原样返回；无 meta 仅记忆 → 产出胶囊', () => {
    const meta: MessageMeta = { durationMs: 1391 }
    expect(mergeRememberedMeta(meta, undefined)).toBe(meta)
    expect(mergeRememberedMeta(undefined, { tokS: 125 })).toEqual({ tokS: 125 })
    expect(mergeRememberedMeta(undefined, undefined)).toBeUndefined()
  })
})
