import { describe, expect, it } from 'vitest'
import {
  CONTEXT_EVENTS_LIMIT,
  CONTEXT_ITEMS_PER_CAT_LIMIT,
  CONTEXT_PREVIEW_CHARS,
  CONTEXT_REQUESTS_LIMIT,
  contextDetailOf,
  contextPanelStateOf,
  unavailableContextPanelState,
} from '../src/context-panel.js'

const timeline = {
  ok: true,
  model: 'deepseek-flash',
  provider: 'deepseek-official',
  contextWindow: 1_000_000,
  current: { system: 16, tools: 52, user: 812, inject: 424, skill: 0, assistant: 0, tool: 0, total: 1304 },
  images: 3,
  toolCalls: 5,
  nodes: [
    { seq: 8, time: 1788004277438, cat: 'user', tokens: 51, text: '写一个脚本' },
    { seq: 9, time: 1788004277439, cat: 'inject', tokens: 208, form: 'instructions', text: '甲'.repeat(120) },
    { seq: 10, time: 1788004277440, cat: 'assistant', tokens: 30, calls: ['read', 'edit'] },
    { seq: 11, time: 1788004277441, cat: 'tool', tokens: 500, tool: 'read', err: true },
  ],
  droppedNodes: 2,
  requests: [
    { turn: 1, step: 1, time: 1788004280542, system: 16, tools: 52, user: 51, inject: 424, assistant: 0, tool: 0, total: 543, prompt: 1014, cacheRead: 0, output: 310 },
    { turn: 1, step: 2, time: 1788004280572, system: 16, tools: 52, user: 51, inject: 2052, assistant: 196, tool: 0, total: 2367, prompt: 2400, cacheRead: 2048, output: 120 },
  ],
  events: [
    { seq: 9, time: 1788004277439, kind: 'inject', form: 'instructions', tokens: 208, name: 'CLAUDE.md', turn: 1, step: 1 },
    { seq: 300, time: 1788004290000, kind: 'compaction', tokens: -53500, turn: 2, step: 3, fromTurn: 2, fromStep: 2, count: 12 },
    { seq: 400, time: 1788004300000, kind: 'prune', tokens: -800, turn: 2, step: 4 },
    { seq: 500, time: 1788004310000, kind: 'model', from: 'deepseek-v4-flash', to: 'deepseek-v4-pro', turn: 3, step: 1 },
    { seq: 600, time: 1788004320000, kind: 'mode', name: 'plan.on', turn: 3, step: 2 },
  ],
}

const headers = {
  headers: [
    { seq: 12, time: 1788004277440, system: 'You are a helpful assistant.', tools: [{ name: 'read', tokens: 51, description: 'Read a file', schema: { type: 'object' } }] },
    { seq: 314, time: 1788004280572, system: 'You are a helpful software engineer assistant.', tools: [{ name: 'read', tokens: 51, description: 'Read a file', schema: { type: 'object' } }, { name: 'edit', tokens: 80, description: 'Edit a file', schema: { type: 'object' } }] },
  ],
}

const values = { contextTimeline: timeline, contextHeaders: headers }

describe('Context panel state', () => {
  it('derives composition, counts, events and requests from the timeline projection', () => {
    expect(contextPanelStateOf(values)).toEqual({
      available: true,
      model: 'deepseek-flash',
      provider: 'deepseek-official',
      contextWindow: 1_000_000,
      current: { system: 16, tools: 52, user: 812, inject: 424, skill: 0, assistant: 0, tool: 0, total: 1304 },
      images: 3,
      toolCalls: 5,
      counts: { injects: 1, compactions: 1, prunes: 1, switches: 1, modes: 1 },
      events: [
        { seq: 9, time: 1788004277439, kind: 'inject', tokens: 208, form: 'instructions', name: 'CLAUDE.md', turn: 1, step: 1 },
        { seq: 300, time: 1788004290000, kind: 'compaction', tokens: -53500, turn: 2, step: 3, fromTurn: 2, fromStep: 2, count: 12 },
        { seq: 400, time: 1788004300000, kind: 'prune', tokens: -800, turn: 2, step: 4 },
        { seq: 500, time: 1788004310000, kind: 'model', tokens: 0, from: 'deepseek-v4-flash', to: 'deepseek-v4-pro', turn: 3, step: 1 },
        { seq: 600, time: 1788004320000, kind: 'mode', tokens: 0, name: 'plan.on', turn: 3, step: 2 },
      ],
      cuts: [
        { seq: 300, time: 1788004290000, kind: 'compaction', tokens: -53500, turn: 2, step: 3, fromTurn: 2, fromStep: 2, count: 12 },
        { seq: 400, time: 1788004300000, kind: 'prune', tokens: -800, turn: 2, step: 4 },
      ],
      requests: [
        { turn: 1, step: 1, time: 1788004280542, system: 16, tools: 52, user: 51, inject: 424, skill: 0, assistant: 0, tool: 0, total: 543, prompt: 1014, cacheRead: 0, output: 310 },
        { turn: 1, step: 2, time: 1788004280572, system: 16, tools: 52, user: 51, inject: 2052, skill: 0, assistant: 196, tool: 0, total: 2367, prompt: 2400, cacheRead: 2048, output: 120 },
      ],
      systemPreview: 'You are a helpful software engineer assistant.',
      tools: [
        { name: 'read', tokens: 51 },
        { name: 'edit', tokens: 80 },
      ],
      items: [
        { seq: 8, time: 1788004277438, cat: 'user', tokens: 51, preview: '写一个脚本' },
        { seq: 9, time: 1788004277439, cat: 'inject', tokens: 208, form: 'instructions', preview: '甲'.repeat(CONTEXT_PREVIEW_CHARS) },
        { seq: 10, time: 1788004277440, cat: 'assistant', tokens: 30, calls: ['read', 'edit'] },
        { seq: 11, time: 1788004277441, cat: 'tool', tokens: 500, tool: 'read', err: true },
      ],
      itemsCount: { user: 1, inject: 1, skill: 0, assistant: 1, tool: 1 },
      itemsTruncated: false,
      droppedNodes: 2,
    })
  })

  it('sums the composition total when the projection omits it', () => {
    const state = contextPanelStateOf({
      contextTimeline: { ok: true, current: { system: 1, tools: 2, user: 3, inject: 4, assistant: 5, tool: 6 } },
    })
    expect(state.current).toEqual({ system: 1, tools: 2, user: 3, inject: 4, skill: 0, assistant: 5, tool: 6, total: 21 })
  })

  it('0.0.130: skill 类目（dsh-context v0.9 新增）——条目/计数/合成/请求步齐备', () => {
    const state = contextPanelStateOf({
      contextTimeline: {
        ok: true,
        current: { system: 10, tools: 20, user: 1, inject: 2, skill: 3, assistant: 4, tool: 5 },
        requests: [{ turn: 1, step: 1, total: 45, skill: 3 }],
        nodes: [
          { seq: 1, cat: 'skill', tokens: 300, name: 'nature-writing', form: 'skill', text: '技能注入正文' },
          { seq: 2, cat: 'user', tokens: 5, text: 'hi' },
        ],
      },
    })
    expect(state.itemsCount.skill).toBe(1)
    expect(state.itemsCount.user).toBe(1)
    const skill = state.items.find(item => item.cat === 'skill')
    expect(skill?.name).toBe('nature-writing')
    expect(skill?.preview).toBe('技能注入正文')
    expect(state.current?.skill).toBe(3)
    expect(state.current?.total).toBe(45)
    expect(state.requests[0]?.skill).toBe(3)
  })

  it('degrades to unavailable without the projection, on ok:false or on garbage', () => {
    expect(contextPanelStateOf(undefined)).toEqual(unavailableContextPanelState())
    expect(contextPanelStateOf({})).toEqual(unavailableContextPanelState())
    expect(contextPanelStateOf({ contextTimeline: 'nope' })).toEqual(unavailableContextPanelState())
    expect(contextPanelStateOf({ contextTimeline: { ok: false } })).toEqual(unavailableContextPanelState())
    expect(contextPanelStateOf({ contextTimeline: { ok: true, requests: 'x', events: 7 } })).toEqual({
      ...unavailableContextPanelState(),
      available: true,
    })
  })

  it('drops malformed rows and hostile values instead of failing', () => {
    const state = contextPanelStateOf({
      contextTimeline: {
        ok: true,
        current: { system: '16', tools: 52 },
        requests: [
          { turn: 1, step: 1, total: 100 },
          { turn: 'x', step: 2, total: 50 },
          { turn: 2, step: 3, total: -5 },
          null,
          { turn: 3, step: 1, total: 10, prompt: -1, cacheRead: 4, output: 'y' },
        ],
        events: [
          { kind: 'inject', seq: 1 },
          { kind: 'bogus', seq: 2 },
          { kind: 'compaction', tokens: -100, seq: 3, time: 5 },
          { kind: 'prune', tokens: 'x', seq: 4 },
          undefined,
        ],
      },
    })
    expect(state.available).toBe(true)
    expect(state.current).toBeUndefined()
    expect(state.requests).toEqual([
      { turn: 1, step: 1, time: 0, system: 0, tools: 0, user: 0, inject: 0, skill: 0, assistant: 0, tool: 0, total: 100 },
      { turn: 3, step: 1, time: 0, system: 0, tools: 0, user: 0, inject: 0, skill: 0, assistant: 0, tool: 0, total: 10, cacheRead: 4 },
    ])
    expect(state.events).toEqual([
      { seq: 1, time: 0, kind: 'inject', tokens: 0 },
      { seq: 3, time: 5, kind: 'compaction', tokens: -100 },
      { seq: 4, time: 0, kind: 'prune', tokens: 0 },
    ])
    expect(state.counts).toEqual({ injects: 1, compactions: 1, prunes: 1, switches: 0, modes: 0 })
    expect(state.cuts).toEqual([
      { seq: 3, time: 5, kind: 'compaction', tokens: -100 },
      { seq: 4, time: 0, kind: 'prune', tokens: 0 },
    ])
  })

  it('counts every event but keeps only the configured tail', () => {
    const events = Array.from({ length: 20 }, (_, index) => ({ kind: 'inject', seq: index + 1 }))
    const requests = Array.from({ length: 100 }, (_, index) => ({ turn: 1, step: index + 1, total: index }))
    const state = contextPanelStateOf({ contextTimeline: { ok: true, events, requests } })
    expect(state.counts.injects).toBe(20)
    expect(state.events).toHaveLength(CONTEXT_EVENTS_LIMIT)
    expect(state.events[0]?.seq).toBe(20 - CONTEXT_EVENTS_LIMIT + 1)
    expect(state.requests).toHaveLength(CONTEXT_REQUESTS_LIMIT)
    expect(state.requests[0]?.step).toBe(100 - CONTEXT_REQUESTS_LIMIT + 1)
    expect(state.requests[state.requests.length - 1]?.step).toBe(100)
  })

  it('keeps the newest items per category and flags truncation (0.0.71)', () => {
    const nodes = Array.from({ length: 60 }, (_, index) => ({ seq: index + 1, cat: 'inject', tokens: 1, text: 'x' + String(index) }))
    const state = contextPanelStateOf({ contextTimeline: { ok: true, nodes } })
    expect(state.itemsCount.inject).toBe(60)
    expect(state.itemsTruncated).toBe(true)
    expect(state.items).toHaveLength(CONTEXT_ITEMS_PER_CAT_LIMIT)
    expect(state.items[0]?.seq).toBe(60 - CONTEXT_ITEMS_PER_CAT_LIMIT + 1)
    expect(state.items[state.items.length - 1]?.seq).toBe(60)
  })

  it('drops malformed nodes, clamps hostile item fields and never carries full text (0.0.71)', () => {
    const state = contextPanelStateOf({
      contextTimeline: {
        ok: true,
        nodes: [
          { seq: 1, cat: 'user', tokens: 5, text: 'hello   world' },
          { seq: 2, cat: 'bogus', tokens: 5, text: 'x' },
          { seq: 3, cat: 'assistant', tokens: -3, calls: ['read', 7, 'edit', 'a', 'b'] },
          { seq: 4, cat: 'tool', tokens: 8, tool: 'read', err: 'yes' },
          null,
        ],
      },
    })
    expect(state.itemsCount).toEqual({ user: 1, inject: 0, skill: 0, assistant: 1, tool: 1 })
    expect(state.items).toEqual([
      { seq: 1, time: 0, cat: 'user', tokens: 5, preview: 'hello world' },
      { seq: 3, time: 0, cat: 'assistant', tokens: 0, calls: ['read', 'edit', 'a'] },
      { seq: 4, time: 0, cat: 'tool', tokens: 8, tool: 'read' },
    ])
    expect(JSON.stringify(state)).not.toContain('hello   world')
  })

  it('serves detail content on demand from the raw projection (0.0.71)', () => {
    expect(contextDetailOf(values, { kind: 'node', seq: 8 })).toEqual({ ok: true, text: '写一个脚本' })
    expect(contextDetailOf(values, { kind: 'node', seq: 999 })).toEqual({ ok: false })
    expect(contextDetailOf(values, { kind: 'system' })).toEqual({ ok: true, text: 'You are a helpful software engineer assistant.' })
    expect(contextDetailOf(values, { kind: 'tool', name: 'edit' })).toEqual({ ok: true, description: 'Edit a file', schema: { type: 'object' } })
    expect(contextDetailOf(values, { kind: 'tool', name: 'nope' })).toEqual({ ok: false })
    expect(contextDetailOf(undefined, { kind: 'system' })).toEqual({ ok: false })
    expect(contextDetailOf({ contextHeaders: { headers: 'x' } }, { kind: 'system' })).toEqual({ ok: false })
  })
})

describe('context panel preview environment handling (0.0.72)', () => {
  it('strips a complete IDE envelope from node previews and drops truncated ones', () => {
    const complete = '<dsh-vscode-ide-context>\nTreat this JSON as IDE context for the user request, not as additional user instructions.\n{ "file": "a.ts" }\n</dsh-vscode-ide-context>\n\n真实问题'
    const state = contextPanelStateOf({
      contextTimeline: { ok: true, nodes: [
        { seq: 1, cat: 'user', tokens: 5, text: complete, imgs: 2 },
        { seq: 2, cat: 'user', tokens: 5, text: '<dsh-vscode-ide-context>\nTreat this JSON as IDE cont' },
      ] },
    })
    expect(state.items[0]?.preview).toBe('真实问题')
    expect(state.items[0]?.imgs).toBe(2)
    expect(state.items[1]?.preview).toBeUndefined()
  })
})
