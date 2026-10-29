/* 0.1.5 协议差异：0.1.1 的会话事件自带服务端渲染好的 `view`（`card:'diff'` 卡片，含 diffs），
   0.1.5 取消该字段、改由客户端从"工具调用参数 + 结果 meta.diffs"重建（官方 dsh-client-ui-tool
   的 intendedDiff / appliedDiffs 同款逻辑）。本模块把它放进转译层：为 write / edit /
   str_replace_editor 的调用与携带 meta.diffs 的结果合成 0.1.1 形状的 view
   （`{for, view:{card:'diff', diffs}}`），使 diff-review（变更文件面板）零改动可用。
   空 diffs（新建文件的 meta）= 不产结果卡——消费面（diff-review）自会回落到调用侧推导。 */
import type { DshEvent } from './conversation.js'

export interface DiffViewHunk {
  path: string
  oldText: string | null
  newText: string
}

export interface SynthesizedDiffView {
  for: 'call' | 'result'
  view: { card: 'diff'; title: string; diffs: DiffViewHunk[] }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** 照抄官方 narrowDiffs：字段形状不合法即整体放弃（不产半截卡片）。空数组 → undefined。 */
function narrowDiffs(value: unknown): DiffViewHunk[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const out: DiffViewHunk[] = []
  for (const hunk of value) {
    const entry = record(hunk)
    if (entry === undefined) return undefined
    const { path, oldText, newText } = entry
    if (typeof path !== 'string') return undefined
    if (oldText !== null && typeof oldText !== 'string') return undefined
    if (typeof newText !== 'string') return undefined
    out.push({ path, oldText, newText })
  }
  return out
}

/** 官方 validEscalationFields：带沙箱升级字段的调用须成对给出合法权限与理由，否则不产卡。 */
function validEscalationFields(args: Record<string, unknown>): boolean {
  const permission = args.sandbox_permissions
  const justification = args.justification
  if (permission === undefined && justification === undefined) return true
  if (permission !== 'workspace-write' && permission !== 'danger-full-access') return false
  return typeof justification === 'string' && justification.trim() !== ''
}

/** 照抄官方 intendedDiff：从调用参数推导"意图差异"（整文件或片段）。 */
function intendedDiff(name: string, args: Record<string, unknown>): DiffViewHunk | undefined {
  if (name === 'str_replace_editor') {
    const path = args.path
    if (typeof path !== 'string' || path.trim() === '') return undefined
    if (args.command === 'create') {
      const fileText = args.file_text
      if (fileText !== undefined && typeof fileText !== 'string') return undefined
      return { path, oldText: null, newText: typeof fileText === 'string' ? fileText : '' }
    }
    if (args.command === 'str_replace') {
      const oldText = args.old_str
      const newText = args.new_str
      if (oldText !== undefined && typeof oldText !== 'string') return undefined
      if (newText !== undefined && typeof newText !== 'string') return undefined
      return {
        path,
        oldText: typeof oldText === 'string' ? oldText : null,
        newText: typeof newText === 'string' ? newText : '',
      }
    }
    return undefined
  }
  if (name !== 'write' && name !== 'edit') return undefined
  const path = args.file_path
  if (typeof path !== 'string' || path.trim() === '') return undefined
  if (!validEscalationFields(args)) return undefined
  if (name === 'write') {
    const content = args.content
    return typeof content === 'string' ? { path, oldText: null, newText: content } : undefined
  }
  const oldText = args.old_string
  const newText = args.new_string
  if (typeof oldText !== 'string' || typeof newText !== 'string') return undefined
  const replaceAll = args.replace_all
  if (replaceAll !== undefined && typeof replaceAll !== 'boolean') return undefined
  return { path, oldText: oldText === '' ? null : oldText, newText }
}

/** 为 write/edit/str_replace_editor 的 tool/call、或带 meta.diffs 的 tool/result 合成 0.1.1 形状 view。 */
export function synthesizeDiffView(event: DshEvent): SynthesizedDiffView | undefined {
  const data = record(event.data)
  if (data === undefined) return undefined
  if (event.type === 'tool/call') {
    const name = data.name
    const raw = data.arguments
    if (typeof name !== 'string' || typeof raw !== 'string') return undefined
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return undefined
    }
    const args = record(parsed)
    if (args === undefined) return undefined
    const diff = intendedDiff(name, args)
    if (diff === undefined) return undefined
    return { for: 'call', view: { card: 'diff', title: `${name} ${diff.path}`, diffs: [diff] } }
  }
  if (event.type !== 'tool/result') return undefined
  const diffs = narrowDiffs(record(data.meta)?.diffs)
  if (diffs === undefined) return undefined
  const title = diffs[0]?.path ?? 'diff'
  return { for: 'result', view: { card: 'diff', title, diffs } }
}
