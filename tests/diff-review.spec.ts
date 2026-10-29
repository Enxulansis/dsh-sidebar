import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ executeCommand: vi.fn(), closeListeners: [] as Array<(document: { uri: unknown }) => void>, textDocuments: [] as Array<{ isDirty: boolean; uri: { fsPath: string } }> }))

vi.mock('vscode', () => {
  class EventEmitter {
    event = (): { dispose(): void } => ({ dispose() {} })
    dispose(): void {}
  }
  return {
    EventEmitter,
    Uri: {
      from(value: { scheme: string; authority: string; path: string }) {
        return { ...value, toString: () => `${value.scheme}://${value.authority}${value.path}` }
      },
    },
    commands: { executeCommand: mocks.executeCommand },
    workspace: { textDocuments: mocks.textDocuments, onDidCloseTextDocument: (listener: (document: { uri: unknown }) => void) => { mocks.closeListeners.push(listener); return { dispose() { const i = mocks.closeListeners.indexOf(listener); if (i >= 0) mocks.closeListeners.splice(i, 1) } } } },
    window: { showInformationMessage: vi.fn() },
  }
})

import type { DshEvent } from '../src/conversation.js'
import { DiffReviewManager } from '../src/diff-review.js'

function event(type: string, seq: number, data: unknown): DshEvent {
  return { type, seq, time: seq, data }
}

describe('DiffReviewManager', () => {
  const temporaryDirectories: string[] = []

  beforeEach(() => { mocks.executeCommand.mockReset(); mocks.textDocuments.splice(0); mocks.closeListeners.splice(0) })
  afterEach(() => { for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }) })

  function temporaryWorkspace(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-vscode-diff-'))
    temporaryDirectories.push(directory)
    return directory
  }

  it('rebuilds changed files from official DSH diff views and opens a native diff', async () => {
    const manager = new DiffReviewManager()
    const displayPath = path.join('src', 'app.ts')
    const changed = manager.rebuild('session-1', '/workspace', [
      {
        event: event('tool/call', 1, { turn: 1, step: 1, callId: 'call-1', name: 'edit', arguments: '{}' }),
        view: {
          for: 'call',
          view: { card: 'diff', diffs: [{ path: 'src/app.ts', oldText: 'old', newText: 'new' }] },
        },
      },
      {
        event: event('tool/result', 2, {
          turn: 1,
          step: 1,
          message: {
            source: { kind: 'tool', callId: 'call-1' },
            content: [{ type: 'tool-result', toolCallId: 'call-1', isError: false }],
          },
        }),
        view: {
          for: 'result',
          view: { card: 'diff', diffs: [{ path: 'src/app.ts', oldText: 'old', newText: 'new' }] },
        },
      },
    ])

    expect(changed).toEqual([{ turn: 1, files: [{ path: displayPath, additions: 1, deletions: 1, canRevert: false }] }])
    await manager.reviewFile('session-1', '/workspace', 'src/app.ts')
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      'vscode.diff',
      expect.objectContaining({ scheme: 'dsh-diff', authority: 'before' }),
      expect.objectContaining({ scheme: 'dsh-diff', authority: 'after' }),
      `${displayPath} — DeepSeek 变更（第 1 轮）`,
      { preview: true },
    )
  })

  it('does not list a failed file edit as an applied change', () => {
    const manager = new DiffReviewManager()
    const changed = manager.rebuild('session-2', '/workspace', [
      {
        event: event('tool/call', 1, { callId: 'call-2', name: 'write', arguments: '{}' }),
        view: {
          for: 'call',
          view: { card: 'diff', diffs: [{ path: 'src/app.ts', oldText: null, newText: 'new' }] },
        },
      },
      {
        event: event('tool/result', 2, {
          error: { code: 'FAILED' },
          message: {
            source: { kind: 'tool', callId: 'call-2' },
            content: [{ type: 'tool-result', toolCallId: 'call-2', isError: true }],
          },
        }),
      },
    ])

    expect(changed).toEqual([])
  })

  it('groups live changes by turn and safely reverts an unchanged file', () => {
    const cwd = temporaryWorkspace()
    const filePath = path.join(cwd, 'src', 'app.ts')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, 'const value = 1\n')
    const manager = new DiffReviewManager()
    const call = event('tool/call', 1, { turn: 2, step: 1, callId: 'call-live', name: 'edit', arguments: '{}' })
    const result = event('tool/result', 2, {
      turn: 2,
      step: 1,
      message: { source: { kind: 'tool', callId: 'call-live' }, content: [{ type: 'tool-result', toolCallId: 'call-live', isError: false }] },
    })
    const callView = { for: 'call', view: { card: 'diff', diffs: [{ path: 'src/app.ts', oldText: 'const value = 1', newText: 'const value = 2' }] } }
    const resultView = { for: 'result', view: { card: 'diff', diffs: [{ path: 'src/app.ts', oldText: 'const value = 1', newText: 'const value = 2' }] } }

    manager.accept('session-live', cwd, call, callView)
    fs.writeFileSync(filePath, 'const value = 2\n')
    expect(manager.accept('session-live', cwd, result, resultView)).toBe(true)
    expect(manager.changedFiles('session-live')).toEqual([{
      turn: 2,
      files: [{ path: path.join('src', 'app.ts'), additions: 1, deletions: 1, canRevert: true }],
    }])

    expect(manager.revertFile('session-live', cwd, 'src/app.ts', 2)).toEqual([])
    expect(fs.readFileSync(filePath, 'utf8')).toBe('const value = 1\n')
  })

  it('treats differently cased aliases as the same file on a case-insensitive filesystem', () => {
    const cwd = temporaryWorkspace()
    const filePath = path.join(cwd, 'CaseFile.ts')
    fs.writeFileSync(filePath, 'before\n')
    if (!fs.existsSync(path.join(cwd, 'casefile.ts'))) return
    const manager = new DiffReviewManager()
    const callId = 'case-insensitive-path'
    const call = event('tool/call', 1, { turn: 1, callId, name: 'edit' })
    const result = event('tool/result', 2, {
      turn: 1,
      message: { source: { kind: 'tool', callId }, content: [] },
    })
    const view = (forValue: 'call' | 'result', fileName: string) => ({
      for: forValue,
      view: { card: 'diff', diffs: [{ path: fileName, oldText: 'before', newText: 'after' }] },
    })

    manager.accept('session-case', cwd, call, view('call', 'CaseFile.ts'))
    fs.writeFileSync(filePath, 'after\n')
    expect(manager.accept('session-case', cwd, result, view('result', 'casefile.ts'))).toBe(true)
    expect(manager.changedFiles('session-case')).toEqual([{
      turn: 1,
      files: [{ path: 'CaseFile.ts', additions: 1, deletions: 1, canRevert: true }],
    }])
    expect(manager.revertFile('session-case', cwd, 'casefile.ts', 1)).toEqual([])
    expect(fs.readFileSync(filePath, 'utf8')).toBe('before\n')
  })

  it('keeps differently cased files separate on a case-sensitive filesystem', () => {
    const cwd = temporaryWorkspace()
    const upperPath = path.join(cwd, 'App.ts')
    const lowerPath = path.join(cwd, 'app.ts')
    fs.writeFileSync(upperPath, 'upper-before\n')
    fs.writeFileSync(lowerPath, 'lower-before\n')
    if (fs.readFileSync(upperPath, 'utf8') !== 'upper-before\n') return

    const manager = new DiffReviewManager()
    const callId = 'case-sensitive-paths'
    const diffs = [
      { path: 'App.ts', oldText: 'upper-before', newText: 'upper-after' },
      { path: 'app.ts', oldText: 'lower-before', newText: 'lower-after' },
    ]
    manager.accept(
      'session-sensitive',
      cwd,
      event('tool/call', 1, { turn: 1, callId, name: 'edit' }),
      { for: 'call', view: { card: 'diff', diffs } },
    )
    fs.writeFileSync(upperPath, 'upper-after\n')
    fs.writeFileSync(lowerPath, 'lower-after\n')
    expect(manager.accept(
      'session-sensitive',
      cwd,
      event('tool/result', 2, { turn: 1, message: { source: { kind: 'tool', callId }, content: [] } }),
      { for: 'result', view: { card: 'diff', diffs } },
    )).toBe(true)

    expect(manager.changedFiles('session-sensitive')).toEqual([{
      turn: 1,
      files: [
        { path: 'App.ts', additions: 1, deletions: 1, canRevert: true },
        { path: 'app.ts', additions: 1, deletions: 1, canRevert: true },
      ],
    }])
    expect(manager.revertAll('session-sensitive')).toEqual([])
    expect(fs.readFileSync(upperPath, 'utf8')).toBe('upper-before\n')
    expect(fs.readFileSync(lowerPath, 'utf8')).toBe('lower-before\n')
  })

  it('prepends older review history without losing reversible live snapshots', () => {
    const cwd = temporaryWorkspace()
    const filePath = path.join(cwd, 'current.ts')
    fs.writeFileSync(filePath, 'before\n')
    const manager = new DiffReviewManager()
    const liveCall = event('tool/call', 20, { turn: 2, callId: 'live', name: 'edit' })
    const liveResult = event('tool/result', 21, {
      turn: 2,
      message: { source: { kind: 'tool', callId: 'live' }, content: [{ type: 'tool-result', toolCallId: 'live' }] },
    })
    const liveCallView = { for: 'call', view: { card: 'diff', diffs: [{ path: 'current.ts', oldText: 'before', newText: 'after' }] } }
    const liveResultView = { for: 'result', view: { card: 'diff', diffs: [{ path: 'current.ts', oldText: 'before', newText: 'after' }] } }
    manager.accept('session-pages', cwd, liveCall, liveCallView)
    fs.writeFileSync(filePath, 'after\n')
    manager.accept('session-pages', cwd, liveResult, liveResultView)

    const changed = manager.prependHistory('session-pages', cwd, [
      {
        event: event('tool/call', 1, { turn: 1, callId: 'older', name: 'write' }),
        view: { for: 'call', view: { card: 'diff', diffs: [{ path: 'old.ts', oldText: null, newText: 'old' }] } },
      },
      {
        event: event('tool/result', 2, {
          turn: 1,
          message: { source: { kind: 'tool', callId: 'older' }, content: [{ type: 'tool-result', toolCallId: 'older' }] },
        }),
        view: { for: 'result', view: { card: 'diff', diffs: [{ path: 'old.ts', oldText: null, newText: 'old' }] } },
      },
    ])

    expect(changed.find(group => group.turn === 2)?.files[0]?.canRevert).toBe(true)
    expect(changed.find(group => group.turn === 1)?.files[0]?.canRevert).toBe(false)
  })

  it('refuses to overwrite a file changed after DeepSeek edited it', () => {
    const cwd = temporaryWorkspace()
    const filePath = path.join(cwd, 'app.ts')
    fs.writeFileSync(filePath, 'before\n')
    const manager = new DiffReviewManager()
    const call = event('tool/call', 1, { turn: 3, step: 1, callId: 'call-conflict', name: 'edit', arguments: '{}' })
    const result = event('tool/result', 2, {
      turn: 3,
      step: 1,
      message: { source: { kind: 'tool', callId: 'call-conflict' }, content: [{ type: 'tool-result', toolCallId: 'call-conflict', isError: false }] },
    })
    const view = (forValue: 'call' | 'result') => ({ for: forValue, view: { card: 'diff', diffs: [{ path: 'app.ts', oldText: 'before', newText: 'after' }] } })
    manager.accept('session-conflict', cwd, call, view('call'))
    fs.writeFileSync(filePath, 'after\n')
    manager.accept('session-conflict', cwd, result, view('result'))
    mocks.textDocuments.push({ isDirty: true, uri: { fsPath: filePath } })
    expect(() => manager.revertFile('session-conflict', cwd, 'app.ts', 3)).toThrow('unsaved VS Code changes')
    mocks.textDocuments.splice(0)
    fs.writeFileSync(filePath, 'user edit\n')

    expect(() => manager.revertFile('session-conflict', cwd, 'app.ts', 3)).toThrow('the file changed after DeepSeek edited it')
    expect(fs.readFileSync(filePath, 'utf8')).toBe('user edit\n')
    expect(manager.changedFiles('session-conflict')).toHaveLength(1)
  })

  it('reverts a continuous chain of changes across turns', () => {
    const cwd = temporaryWorkspace()
    const filePath = path.join(cwd, 'app.ts')
    fs.writeFileSync(filePath, 'one')
    const manager = new DiffReviewManager()
    const apply = (turn: number, before: string, after: string) => {
      const callId = `call-${String(turn)}`
      const call = event('tool/call', turn * 2, { turn, step: 1, callId, name: 'edit', arguments: '{}' })
      const result = event('tool/result', turn * 2 + 1, { turn, step: 1, message: { source: { kind: 'tool', callId }, content: [] } })
      const view = (forValue: 'call' | 'result') => ({ for: forValue, view: { card: 'diff', diffs: [{ path: 'app.ts', oldText: before, newText: after }] } })
      manager.accept('session-chain', cwd, call, view('call'))
      fs.writeFileSync(filePath, after)
      manager.accept('session-chain', cwd, result, view('result'))
    }
    apply(1, 'one', 'two')
    apply(2, 'two', 'three')

    expect(manager.changedFiles('session-chain').map(group => group.turn)).toEqual([2, 1])
    expect(manager.revertAll('session-chain')).toEqual([])
    expect(fs.readFileSync(filePath, 'utf8')).toBe('one')
  })

  it('validates every file before reverting all changes', () => {
    const cwd = temporaryWorkspace()
    const firstPath = path.join(cwd, 'first.ts')
    const secondPath = path.join(cwd, 'second.ts')
    fs.writeFileSync(firstPath, 'first-before')
    fs.writeFileSync(secondPath, 'second-before')
    const manager = new DiffReviewManager()
    const diffs = [
      { path: 'first.ts', oldText: 'first-before', newText: 'first-after' },
      { path: 'second.ts', oldText: 'second-before', newText: 'second-after' },
    ]
    manager.accept('session-atomic', cwd, event('tool/call', 1, { turn: 1, step: 1, callId: 'call-atomic', name: 'edit', arguments: '{}' }), { for: 'call', view: { card: 'diff', diffs } })
    fs.writeFileSync(firstPath, 'first-after')
    fs.writeFileSync(secondPath, 'second-after')
    manager.accept('session-atomic', cwd, event('tool/result', 2, { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'call-atomic' }, content: [] } }), { for: 'result', view: { card: 'diff', diffs } })
    fs.writeFileSync(secondPath, 'user-edit')

    expect(() => manager.revertAll('session-atomic')).toThrow('the file changed after DeepSeek edited it')
    expect(fs.readFileSync(firstPath, 'utf8')).toBe('first-after')
    expect(fs.readFileSync(secondPath, 'utf8')).toBe('user-edit')
  })

  it('keeps a reviewed change without touching the file', () => {
    const cwd = temporaryWorkspace()
    const filePath = path.join(cwd, 'app.ts')
    fs.writeFileSync(filePath, 'before')
    const manager = new DiffReviewManager()
    const call = event('tool/call', 1, { turn: 4, step: 1, callId: 'call-keep', name: 'edit', arguments: '{}' })
    const result = event('tool/result', 2, { turn: 4, step: 1, message: { source: { kind: 'tool', callId: 'call-keep' }, content: [] } })
    const view = (forValue: 'call' | 'result') => ({ for: forValue, view: { card: 'diff', diffs: [{ path: 'app.ts', oldText: 'before', newText: 'after' }] } })
    manager.accept('session-keep', cwd, call, view('call'))
    fs.writeFileSync(filePath, 'after')
    manager.accept('session-keep', cwd, result, view('result'))

    expect(manager.keepFile('session-keep', cwd, 'app.ts', 4)).toEqual([])
    expect(fs.readFileSync(filePath, 'utf8')).toBe('after')
  })

  it('compacts continuous large full-file snapshots while preserving exact revert and totals', async () => {
    const cwd = temporaryWorkspace(), filePath = path.join(cwd, 'large.txt')
    const initial = 'a'.repeat(1024 * 1024) + '\n'
    fs.writeFileSync(filePath, initial)
    const manager = new DiffReviewManager()
    for (let i = 0; i < 20; i++) {
      const before = fs.readFileSync(filePath, 'utf8'), after = before + `line ${i}\n`
      const diff = { card: 'diff', diffs: [{ path: 'large.txt', oldText: '', newText: `line ${i}\n` }] }
      manager.accept('large', cwd, event('tool/call', i * 2, { turn: 1, callId: `c${i}` }), { for: 'call', view: diff })
      fs.writeFileSync(filePath, after)
      manager.accept('large', cwd, event('tool/result', i * 2 + 1, { turn: 1, message: { source: { callId: `c${i}` }, content: [] } }), { for: 'result', view: diff })
    }
    const reviews = Reflect.get(manager, 'reviews') as Map<string, Map<number, Map<string, { snapshots: unknown[] }>>>
    expect([...reviews.get('large')!.get(1)!.values()][0]!.snapshots).toHaveLength(1)
    expect(manager.changedFiles('large')[0]?.files[0]).toMatchObject({ additions: 20, deletions: 0, canRevert: true })
    await manager.reviewAll('large')
    const uri = mocks.executeCommand.mock.calls.at(-1)![1]
    expect(manager.provideTextDocumentContent(uri)).toBe(initial)
    manager.revertAll('large')
    expect(fs.readFileSync(filePath, 'utf8')).toBe(initial)
  })

  it('releases only deleted-session snapshots/content, preserves dismissed decisions for restore, and purges them permanently', async () => {
    const storage = new Map<string, unknown>()
    const manager = new DiffReviewManager({ get: (key: string) => storage.get(key), update: (key: string, value: unknown) => { storage.set(key, value); return Promise.resolve() } } as never)
    const cwd = temporaryWorkspace()
    const entries = [{ event: event('tool/result', 1, { turn: 1, message: { source: { callId: 'c' }, content: [] } }), view: { for: 'result', view: { card: 'diff', diffs: [{ path: 'large.txt', oldText: 'a'.repeat(1024 * 1024), newText: 'b'.repeat(1024 * 1024) }] } } }]
    for (const sid of ['a', 'b']) { manager.rebuild(sid, cwd, entries); await manager.reviewAll(sid) }
    const aUri = mocks.executeCommand.mock.calls[0]![1], bUri = mocks.executeCommand.mock.calls[1]![1]
    manager.keepAll('a')
    manager.accept('a', cwd, event('tool/call', 2, { turn: 2, callId: 'pending' }), { for: 'call', view: entries[0]!.view.view })
    manager.releaseSession('a')
    expect(manager.provideTextDocumentContent(aUri)).toBe('')
    expect(manager.provideTextDocumentContent(bUri)).toBe(entries[0]!.view.view.diffs[0]!.oldText)
    expect((Reflect.get(manager, 'pending') as Map<string, unknown>).size).toBe(0)
    expect(manager.changedFiles('b')).not.toEqual([])
    expect(manager.rebuild('a', cwd, entries)).toEqual([])
    manager.purgeSession('a')
    expect(Reflect.get(manager, 'dismissed').has('a')).toBe(false)
    expect(storage.get('dsh.diffDismissed')).toEqual({})
    expect(manager.rebuild('a', cwd, entries)).not.toEqual([])
    mocks.closeListeners.forEach(listener => listener({ uri: bUri }))
    expect(manager.provideTextDocumentContent(bUri)).toBe('')
    manager.dispose()
    expect(mocks.closeListeners).toEqual([])
  })

  it('drops unfinished large before-images at turn/end while retaining other sessions/turns', () => {
    const cwd = temporaryWorkspace(), file = path.join(cwd, 'large.txt')
    fs.writeFileSync(file, 'a'.repeat(2 * 1024 * 1024))
    const manager = new DiffReviewManager(), view = { for: 'call', view: { card: 'diff', diffs: [{ path: 'large.txt', oldText: 'a', newText: 'b' }] } }
    for (const [sid, turn] of [['a', 1], ['a', 2], ['b', 1]] as const) manager.accept(sid, cwd, event('tool/call', 1, { turn, callId: String(turn) }), view)
    manager.accept('a', cwd, event('turn/end', 2, { turn: 1, status: 'cancelled' }))
    expect([...Reflect.get(manager, 'pending').keys()]).toEqual(['a:2', 'b:1'])
    manager.releaseSession('a')
    expect([...Reflect.get(manager, 'pending').keys()]).toEqual(['b:1'])
    manager.dispose()
  })

  it('retains discontinuities within a turn and refuses an unsafe large-file revert', () => {
    const cwd = temporaryWorkspace(), file = path.join(cwd, 'large.txt'), manager = new DiffReviewManager()
    for (let i = 0; i < 2; i++) {
      fs.writeFileSync(file, `external-${i}`)
      const view = { card: 'diff', diffs: [{ path: 'large.txt', oldText: `external-${i}`, newText: `after-${i}` }] }
      manager.accept('a', cwd, event('tool/call', i * 2, { turn: 1, callId: String(i) }), { for: 'call', view })
      fs.writeFileSync(file, `after-${i}`)
      manager.accept('a', cwd, event('tool/result', i * 2 + 1, { turn: 1, message: { source: { callId: String(i) }, content: [] } }), { for: 'result', view })
    }
    expect(manager.changedFiles('a')[0]?.files[0]?.canRevert).toBe(false)
    expect(() => manager.revertAll('a')).toThrow('full snapshot')
    expect(fs.readFileSync(file, 'utf8')).toBe('after-1')
    manager.dispose()
  })

  it('0.0.141: 保留标记持久化——reload 重建（新实例 + 历史重放）不再复现已保留的变更块', () => {
    const cwd = temporaryWorkspace()
    const filePath = path.join(cwd, 'app.ts')
    fs.writeFileSync(filePath, 'before')
    const storage = new Map<string, unknown>()
    const memento = {
      get: (key: string) => storage.get(key),
      update: (key: string, value: unknown) => { storage.set(key, value); return Promise.resolve() },
    }
    const entries = [
      {
        event: event('tool/call', 1, { turn: 3, step: 1, callId: 'call-persist', name: 'edit', arguments: '{}' }),
        view: { for: 'call', view: { card: 'diff', diffs: [{ path: 'app.ts', oldText: 'before', newText: 'after' }] } },
      },
      {
        event: event('tool/result', 2, {
          turn: 3,
          step: 1,
          message: { source: { kind: 'tool', callId: 'call-persist' }, content: [{ type: 'tool-result', toolCallId: 'call-persist', isError: false }] },
        }),
        view: { for: 'result', view: { card: 'diff', diffs: [{ path: 'app.ts', oldText: 'before', newText: 'after' }] } },
      },
    ]
    const first = new DiffReviewManager(memento as never)
    expect(first.rebuild('session-persist', cwd, entries)).not.toEqual([])
    expect(first.keepAll('session-persist')).toEqual([])
    expect(storage.size).toBe(1)

    /* 模拟窗口 Reload：扩展宿主重启 = 新实例 + 会话历史重放（rebuild）。 */
    const second = new DiffReviewManager(memento as never)
    expect(second.rebuild('session-persist', cwd, entries)).toEqual([])

    /* 同一文件在**后续轮次**再改 → 新键（turn 不同），应重新出现。 */
    const next = new DiffReviewManager(memento as never)
    const later = entries.map(entry => ({ ...entry, event: { ...entry.event, data: { ...(entry.event.data as object), turn: 4 } } }))
    expect(next.rebuild('session-persist', cwd, later)).not.toEqual([])
  })
})
