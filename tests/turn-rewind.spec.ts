import { describe, expect, it } from 'vitest'
import {
  REWIND_NO_CHANGES_TEXT,
  rewindBlockedText,
  rewindChangeLabel,
  rewindConfirmDetail,
  rewindErrorLabel,
  rewindPreviewOf,
  rewindStatusText,
} from '../src/turn-rewind.js'

const readyBody = {
  status: 'ready',
  sessionId: 'session-1',
  messageSeq: 42,
  turn: 3,
  checkpointId: 'ck-1',
  totalChanges: 12,
  changes: [
    { path: 'src/a.ts', kind: 'modified' },
    { path: 'src/new.ts', kind: 'added' },
    { path: 'gone.ts', kind: 'deleted' },
    { path: 'bin/tool', kind: 'mode-changed' },
    { path: 'link', kind: 'type-changed' },
    { path: 'f6.ts', kind: 'modified' },
    { path: 'f7.ts', kind: 'modified' },
    { path: 'f8.ts', kind: 'modified' },
    { path: 'f9.ts', kind: 'modified' },
  ],
  truncated: true,
  planId: 'plan-1',
  confirmation: 'confirm-token',
  activeSessionIds: [],
  headChanged: false,
  operationChanged: false,
  checkpointHead: 'abc',
  checkpointBranch: 'main',
  currentHead: 'def',
  currentBranch: 'main',
}

describe('Turn rewind preview (0.0.76)', () => {
  it('parses a ready preview and detects branch drift', () => {
    const preview = rewindPreviewOf(readyBody)
    expect(preview.status).toBe('ready')
    expect(preview.totalChanges).toBe(12)
    expect(preview.changes).toHaveLength(9)
    expect(preview.truncated).toBe(true)
    expect(preview.planId).toBe('plan-1')
    expect(preview.confirmation).toBe('confirm-token')
    expect(preview.branchChanged).toBe(false)
    expect(rewindPreviewOf({ ...readyBody, currentBranch: 'feature' }).branchChanged).toBe(true)
  })

  it('parses non-ready statuses and hostile payloads', () => {
    expect(rewindPreviewOf({ status: 'skipped', reason: 'workspace is huge' }).status).toBe('skipped')
    expect(rewindPreviewOf({ status: 'missing' }).status).toBe('missing')
    expect(rewindPreviewOf({ status: 'whatever' }).status).toBe('unknown')
    expect(rewindPreviewOf(null).status).toBe('unknown')
    expect(rewindPreviewOf({ status: 'ready', changes: 'x', totalChanges: -5 }).totalChanges).toBe(0)
  })

  it('maps change kinds, statuses, blocked reasons and error codes to Chinese labels', () => {
    expect(rewindChangeLabel('added')).toBe('移除后来新增的文件')
    expect(rewindChangeLabel('deleted')).toBe('找回文件')
    expect(rewindChangeLabel('modified')).toBe('恢复之前的版本')
    expect(rewindChangeLabel('mode-changed')).toBe('恢复文件权限')
    expect(rewindChangeLabel('type-changed')).toBe('恢复之前的文件类型')
    expect(rewindChangeLabel('unknown-kind')).toBe('unknown-kind')
    expect(rewindStatusText(rewindPreviewOf({ status: 'pending' }))).toContain('还在保存')
    expect(rewindStatusText(rewindPreviewOf({ status: 'skipped', reason: 'r1' }))).toContain('r1')
    expect(rewindBlockedText(rewindPreviewOf({ status: 'ready', activeSessionIds: ['s2'] }))).toContain('别的对话正在运行')
    expect(rewindBlockedText(rewindPreviewOf({ status: 'ready', operationChanged: true }))).toContain('合并、变基')
    expect(rewindBlockedText(rewindPreviewOf({ status: 'ready' }))).toBeUndefined()
    expect(rewindErrorLabel('PLAN_STALE', 'raw')).toContain('重新检查')
    expect(rewindErrorLabel('NO_CHANGES', 'raw')).toBe(REWIND_NO_CHANGES_TEXT)
    expect(rewindErrorLabel('RESTORE_FAILED_ROLLED_BACK', 'raw')).toContain('自动还原')
    expect(rewindErrorLabel(undefined, 'server message')).toBe('server message')
    expect(rewindErrorLabel(undefined, undefined)).toBe('回退失败。')
  })

  it('builds the confirmation detail with truncated file list and warnings', () => {
    const detail = rewindConfirmDetail(rewindPreviewOf(readyBody))
    expect(detail).toContain('将恢复 12 个文件')
    expect(detail).toContain('· src/a.ts（恢复之前的版本）')
    expect(detail).toContain('…其余 4 个文件')
    expect(detail).toContain('恢复前会自动备份')
    const withCommits = rewindConfirmDetail(rewindPreviewOf({ ...readyBody, headChanged: true }))
    expect(withCommits).toContain('新的 Git 提交')
    const withBranch = rewindConfirmDetail(rewindPreviewOf({ ...readyBody, headChanged: true, currentBranch: 'other' }))
    expect(withBranch).toContain('分支与发送消息时不同')
  })
})
