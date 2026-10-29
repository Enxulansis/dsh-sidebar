import { describe, expect, it } from 'vitest'
import {
  effectivePlanMode,
  permissionPresetsOf,
  planModeCommand,
  planModeStateOf,
  planModeWithCommandAvailability,
  requiresFullAccessConfirmation,
} from '../src/collaboration-state.js'

describe('collaboration state projections', () => {
  it('joins the RC4 current selection with the separate permission catalog', () => {
    expect(permissionPresetsOf({
      currentValue: 'workspace-write',
    }, {
      options: [
        { value: 'read-only', name: 'read-only', description: 'Read without modifying files.' },
        { value: 'workspace-write', name: 'workspace-write', description: 'Write in this workspace.' },
        { value: 'danger-full-access', name: 'danger-full-access', description: 'No sandbox.' },
        { value: 'custom', name: 'custom' },
      ],
    })).toEqual([
      { value: 'read-only', label: '仅可查看', description: 'Read without modifying files.', selected: false },
      { value: 'workspace-write', label: '工作区内修改', description: 'Write in this workspace.', selected: true },
      { value: 'danger-full-access', label: '完全权限', description: 'No sandbox.', selected: false },
    ])
  })

  it('does not invent options or select a default for an unknown effective permission', () => {
    expect(permissionPresetsOf({ currentValue: 'read-only' }, undefined)).toEqual([])
    expect(permissionPresetsOf({ currentValue: 'custom' }, { options: [{ value: 'read-only' }] })).toEqual([
      { value: 'read-only', label: '仅可查看', selected: false },
    ])
  })

  it('distinguishes an unavailable plan capability from normal mode', () => {
    expect(planModeStateOf(undefined)).toEqual({ available: false, active: false, pending: false })
    expect(planModeStateOf({ active: false, pending: false })).toEqual({ available: true, active: false, pending: false })
    expect(planModeStateOf({ active: true, pending: false })).toEqual({ available: true, active: true, pending: false })
  })

  it('shows the target mode while an official plan transition is pending', () => {
    expect(effectivePlanMode({ available: true, active: false, pending: true })).toBe(true)
    expect(effectivePlanMode({ available: true, active: true, pending: true })).toBe(false)
  })

  it('discovers plan availability from the official command list', () => {
    expect(planModeWithCommandAvailability(
      { available: false, active: false, pending: false },
      true,
    )).toEqual({ available: true, active: false, pending: false })
    expect(planModeWithCommandAvailability({ available: true, active: true, pending: false }, false))
      .toEqual({ available: false, active: true, pending: false })
  })

  it('uses an empty plan command instead of sending on as a message', () => {
    expect(planModeCommand('plan')).toBe('/plan')
    expect(planModeCommand('normal')).toBe('/plan off')
  })

  it('requires confirmation only for the official full-access preset', () => {
    expect(requiresFullAccessConfirmation('danger-full-access')).toBe(true)
    expect(requiresFullAccessConfirmation('workspace-write')).toBe(false)
  })
})
