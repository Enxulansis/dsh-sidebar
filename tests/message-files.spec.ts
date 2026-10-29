import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MESSAGE_FILES_CAP,
  attachSeq,
  attachmentStatus,
  isPasteCopyPath,
  lookup,
  mimeForFileName,
  nameOf,
  normalizeWithin,
  orphanPasteCopies,
  pruneMessageFiles,
  retentionMs,
  storeMessageFiles,
  textTailOf,
  type AttachedFile,
  type MessageFilesStore,
} from '../src/message-files.js'

let root: string
let cwd: string

const DAY = 24 * 3600 * 1000
const SID = 'session-11111111-2222-3333-4444-555555555555'

function file(overrides: Partial<AttachedFile> = {}): AttachedFile {
  return {
    name: 'design.pdf',
    path: '_temp/.dsh-paste/1700000000000-design.pdf',
    mime: 'application/pdf',
    size: 1234,
    origin: 'paste-copy',
    addedAt: 1_700_000_000_000,
    ...overrides,
  }
}

function item(overrides: Partial<{ seq?: number; textTail: string; files: AttachedFile[]; addedAt: number }> = {}, addedAt = 1_700_000_000_000) {
  return {
    sessionId: SID,
    ...(overrides.seq !== undefined ? { seq: overrides.seq } : {}),
    textTail: overrides.textTail ?? '看看这个文件',
    files: overrides.files ?? [file()],
    addedAt: overrides.addedAt ?? addedAt,
  }
}

describe('message-files 工具函数', () => {
  it('textTailOf 折叠空白并截取 40 字符', () => {
    expect(textTailOf('  看看\n  这个 文件  ')).toBe('看看 这个 文件')
    expect(textTailOf('a'.repeat(60))).toBe('a'.repeat(40))
    expect(textTailOf('')).toBe('')
  })

  it('nameOf 取 posix/win 路径尾段', () => {
    expect(nameOf('_temp/.dsh-paste/1700000000000-design.pdf')).toBe('1700000000000-design.pdf')
    expect(nameOf('_temp\\.dsh-paste\\design.docx')).toBe('design.docx')
    expect(nameOf('design.pdf')).toBe('design.pdf')
  })

  it('mimeForFileName 按扩展名推断 MIME', () => {
    expect(mimeForFileName('设计稿.PDF')).toBe('application/pdf')
    expect(mimeForFileName('a.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(mimeForFileName('no-extension')).toBe('')
  })

  it('G42-B (0.0.97): retentionMs(-1) = Infinity（哨兵：永不删除）', () => {
    expect(retentionMs(-1)).toBe(Number.POSITIVE_INFINITY)
    expect(retentionMs(2)).toBe(2 * 24 * 3600 * 1000)
    expect(retentionMs(0)).toBe(24 * 3600 * 1000)
  })

  it('isPasteCopyPath 识别 .dsh-paste 前缀（副本存相对路径，绝对路径不算）', () => {
    expect(isPasteCopyPath('_temp/.dsh-paste/1700000000000-a.pdf')).toBe(true)
    expect(isPasteCopyPath('_temp/.dsh-paste')).toBe(true)
    expect(isPasteCopyPath('_temp/.dsh-paste/')).toBe(true)
    expect(isPasteCopyPath('_temp/.dsh-paste-backup/a.pdf')).toBe(false)
    expect(isPasteCopyPath('_temp/other/a.pdf')).toBe(false)
    expect(isPasteCopyPath('C:/ws/_temp/.dsh-paste/a.pdf')).toBe(false)
  })

  it('normalizeWithin 解析工作区内路径并拒绝越界', () => {
    const resolved = normalizeWithin(cwd, '_temp/.dsh-paste/a.pdf')
    expect(resolved).toBe(join(cwd, '_temp', '.dsh-paste', 'a.pdf'))
    expect(normalizeWithin(cwd, 'src/../outside.txt')).toBe(join(cwd, 'outside.txt'))
    expect(normalizeWithin(cwd, '../outside.txt')).toBeUndefined()
    expect(normalizeWithin(cwd, '..')).toBeUndefined()
    expect(normalizeWithin(cwd, 'C:/elsewhere/a.txt')).toBeUndefined()
    expect(normalizeWithin('', 'a.txt')).toBeUndefined()
  })

  it('attachmentStatus 以文件真实存在性判定', async () => {
    const real = join(cwd, 'present.txt')
    await writeFile(real, 'x', 'utf8')
    const active = file({ path: 'present.txt', origin: 'workspace' })
    expect(attachmentStatus(cwd, active)).toBe('active')
    expect(attachmentStatus(cwd, file({ path: 'gone.txt' }))).toBe('expired')
    expect(attachmentStatus(cwd, file({ path: '../outside.txt' }))).toBe('expired')
  })
})

describe('storeMessageFiles / lookup / attachSeq', () => {
  let store: MessageFilesStore

  beforeEach(() => {
    store = {}
  })

  it('按 sessionId 分桶并 push 条目（seq 可缺省）', () => {
    const first = storeMessageFiles(store, SID, undefined, '看看这个文件', [file()], 1000)
    const next = storeMessageFiles(first, SID, undefined, '第二条', [file({ name: 'b.xlsx' })], 2000)
    expect(next[SID]).toHaveLength(2)
    expect(next[SID]![0].textTail).toBe('看看这个文件')
    expect(next[SID]![1].files[0].name).toBe('b.xlsx')
    // 不就地修改入参
    expect(store[SID]).toBeUndefined()
  })

  it('cap 淘汰最旧条目（全局跨桶）', () => {
    let big: MessageFilesStore = {}
    for (let i = 0; i < MESSAGE_FILES_CAP + 5; i += 1) {
      big = storeMessageFiles(big, `s${i % 3}`, undefined, `m-${i}`.padEnd(20, '-'), [file()], i)
    }
    let total = 0
    for (const bucket of Object.values(big)) total += bucket.length
    expect(total).toBe(MESSAGE_FILES_CAP)
    const keysByBucket = Object.values(big).flatMap(bucket => bucket.map(entry => entry.textTail))
    expect(keysByBucket).not.toContain('m-0'.padEnd(20, '-'))
  })

  it('attachSeq 为最近未附着且 textTail 匹配的条目标 seq', () => {
    const storeWith = storeMessageFiles(store, SID, undefined, '第一条', [file()], 1000)
    const two = storeMessageFiles(storeWith, SID, undefined, '第二条', [file()], 2000)
    expect(attachSeq(two, SID, 7, '第二条')).toBe(true)
    expect(two[SID]![1].seq).toBe(7)
    // 已附着 → 不再改
    expect(attachSeq(two, SID, 8, '第二条')).toBe(false)
    expect(two[SID]![1].seq).toBe(7)
    // tail 不匹配 → 不动第一条
    expect(attachSeq(two, SID, 9, '完全无关文本')).toBe(false)
    expect(two[SID]![0].seq).toBeUndefined()
    // 未知会话
    expect(attachSeq(two, 'session-none', 1, 'x')).toBe(false)
  })

  it('lookup 优先 seq，兜底 textTail', () => {
    const storeWith = storeMessageFiles(store, SID, undefined, '第一条', [file()], 1000)
    const two = storeMessageFiles(storeWith, SID, undefined, '第二条', [file()], 2000)
    expect(lookup(two, SID, { seq: undefined, textTail: '第二条' })?.textTail).toBe('第二条')
    expect(lookup(two, SID, {})).toBeUndefined()
    expect(lookup(two, 'session-none', { textTail: '第二条' })).toBeUndefined()
    const seqged = { ...two } as MessageFilesStore
    seqged[SID] = seqged[SID]!.map((entry, i) => (i === 1 ? { ...entry, seq: 11 } : entry))
    expect(lookup(seqged, SID, { seq: 11, textTail: 'xxx' })?.textTail).toBe('第二条')
    expect(lookup(seqged, SID, { seq: 999 })).toBeUndefined()
  })

  it('lookup seq 未命中时回退 textTail（历史恢复/seq 被裁剪场景）', () => {
    const storeWith = storeMessageFiles(store, SID, undefined, '历史消息', [file()], 1000)
    expect(lookup(storeWith, SID, { seq: 999, textTail: '历史消息' })?.textTail).toBe('历史消息')
    expect(lookup(storeWith, SID, { seq: 999, textTail: '无关文本' })).toBeUndefined()
  })
})

describe('pruneMessageFiles（宽松策略）', () => {
  it('过期 paste-copy → 列入 stale 并移除；未过期 → 保留', () => {
    const now = 1_700_000_000_000
    const entry = item({
      addedAt: now - 31 * DAY,
      files: [
        file({ name: 'old.pdf', path: '_temp/.dsh-paste/old.pdf', addedAt: now - 31 * DAY }),
        file({ name: 'new.pdf', path: '_temp/.dsh-paste/new.pdf', addedAt: now - 1 * DAY }),
      ],
    })
    const store: MessageFilesStore = { [SID]: [entry] }
    const result = pruneMessageFiles(store, now, retentionMs(30))
    expect(result.staleCopyPaths).toEqual(['_temp/.dsh-paste/old.pdf'])
    expect(result.store).toBeDefined()
    expect(result.store![SID]![0].files).toHaveLength(1)
    expect(result.store![SID]![0].files[0].name).toBe('new.pdf')
  })

  it('过期 workspace 引用 → 保留（文件在即可用）', () => {
    const now = 1_700_000_000_000
    const store: MessageFilesStore = {
      [SID]: [item({ addedAt: now - 90 * DAY, files: [file({ path: 'src/a.ts', origin: 'workspace', addedAt: now - 90 * DAY })] })],
    }
    const result = pruneMessageFiles(store, now, retentionMs(30))
    expect(result.staleCopyPaths).toEqual([])
    expect(result.store).toBeUndefined()
  })

  it('条目内全部过期 → 桶/条目整体清除', () => {
    const now = 1_700_000_000_000
    const store: MessageFilesStore = {
      [SID]: [
        item({ addedAt: now - 40 * DAY, files: [file({ addedAt: now - 40 * DAY })] }),
        item({ addedAt: now - 1, files: [file({ name: 'keep.txt', path: 'keep.txt', origin: 'workspace' })] }),
      ],
    }
    const result = pruneMessageFiles(store, now, retentionMs(30))
    expect(result.store![SID]).toHaveLength(1)
    expect(result.store![SID]![0].files[0].name).toBe('keep.txt')
    expect(result.staleCopyPaths).toEqual(['_temp/.dsh-paste/1700000000000-design.pdf'])
  })

  it('无变化 → 返回 undefined（调用方跳过 commit）', () => {
    const now = 1_700_000_000_000
    const store: MessageFilesStore = { [SID]: [item({ addedAt: now })] }
    const result = pruneMessageFiles(store, now, retentionMs(30))
    expect(result.store).toBeUndefined()
    expect(result.staleCopyPaths).toEqual([])
  })
})

describe('orphanPasteCopies（P2-13 目录差集）', () => {
  const now = 1_700_000_000_000

  it('未被引用且过期 → 列入；被引用（无论新旧）或未过期 → 豁免', () => {
    const store: MessageFilesStore = {
      [SID]: [item({
        addedAt: now - 1 * DAY,
        files: [file({ name: 'kept.pdf', path: '_temp/.dsh-paste/kept.pdf', addedAt: now - 1 * DAY })],
      })],
    }
    const listing = [
      { name: 'kept.pdf', mtimeMs: now - 40 * DAY },   // store 引用（虽然 mtime 老，另有过期流程处理）→ 豁免
      { name: 'fresh.pdf', mtimeMs: now - 1 * DAY },   // 新贴入未发送 → 豁免
      { name: 'orphan.pdf', mtimeMs: now - 40 * DAY }, // 未被引用且过期 → 列入
    ]
    expect(orphanPasteCopies(store, listing, now, retentionMs(30))).toEqual(['_temp/.dsh-paste/orphan.pdf'])
  })

  it('只有 paste-copy 路径构成引用——workspace 引用不豁免同名文件', () => {
    const store: MessageFilesStore = {
      [SID]: [item({ addedAt: now, files: [file({ name: 'a.ts', path: 'src/a.ts', origin: 'workspace' })] })],
    }
    const listing = [{ name: 'a.ts', mtimeMs: now - 40 * DAY }]
    expect(orphanPasteCopies(store, listing, now, retentionMs(30))).toEqual(['_temp/.dsh-paste/a.ts'])
  })

  it('空 store（trim 淘汰后的孤儿场景）→ 全部过期文件列入', () => {
    const listing = [
      { name: 'gone1.pdf', mtimeMs: now - 60 * DAY },
      { name: 'gone2.pdf', mtimeMs: now - 45 * DAY },
    ]
    expect(orphanPasteCopies({}, listing, now, retentionMs(30)))
      .toEqual(['_temp/.dsh-paste/gone1.pdf', '_temp/.dsh-paste/gone2.pdf'])
  })
})

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'message-files-'))
  cwd = root
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
