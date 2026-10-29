/* 0.0.76：turn-rewind（@anionex/dsh-turn-rewind）接入——解析 /turn-rewind HTTP 响应 +
   中文文案映射（与插件 client 半同词条，见 lib/client.js）。 */

export type RewindPreviewStatus = 'ready' | 'pending' | 'missing' | 'skipped' | 'failed' | 'unknown'

export interface RewindChange {
  path: string
  kind: string
}

export interface RewindPreview {
  status: RewindPreviewStatus
  reason?: string
  error?: string
  turn?: number
  checkpointId?: string
  totalChanges: number
  changes: RewindChange[]
  truncated: boolean
  planId?: string
  confirmation?: string
  activeSessionIds: string[]
  headChanged: boolean
  operationChanged: boolean
  branchChanged: boolean
}

const STATUSES: readonly RewindPreviewStatus[] = ['ready', 'pending', 'missing', 'skipped', 'failed']

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function rewindPreviewOf(value: unknown): RewindPreview {
  const record = recordOf(value) ?? {}
  const statusText = typeof record.status === 'string' ? record.status : ''
  const status = (STATUSES as readonly string[]).includes(statusText) ? statusText as RewindPreviewStatus : 'unknown'
  const changes = Array.isArray(record.changes)
    ? record.changes.flatMap((entry): RewindChange[] => {
      const change = recordOf(entry)
      return change === undefined || typeof change.path !== 'string'
        ? []
        : [{ path: change.path, kind: typeof change.kind === 'string' ? change.kind : '' }]
    })
    : []
  const activeSessionIds = Array.isArray(record.activeSessionIds)
    ? record.activeSessionIds.filter((entry): entry is string => typeof entry === 'string')
    : []
  const totalChanges = typeof record.totalChanges === 'number' && Number.isFinite(record.totalChanges) && record.totalChanges >= 0
    ? record.totalChanges
    : changes.length
  const checkpointBranch = typeof record.checkpointBranch === 'string' ? record.checkpointBranch : undefined
  const currentBranch = typeof record.currentBranch === 'string' ? record.currentBranch : undefined
  return {
    status,
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
    ...(typeof record.turn === 'number' ? { turn: record.turn } : {}),
    ...(typeof record.checkpointId === 'string' ? { checkpointId: record.checkpointId } : {}),
    totalChanges,
    changes,
    truncated: record.truncated === true,
    ...(typeof record.planId === 'string' ? { planId: record.planId } : {}),
    ...(typeof record.confirmation === 'string' ? { confirmation: record.confirmation } : {}),
    activeSessionIds,
    headChanged: record.headChanged === true,
    operationChanged: record.operationChanged === true,
    branchChanged: checkpointBranch !== undefined && currentBranch !== undefined && checkpointBranch !== currentBranch,
  }
}

const REWIND_CHANGE_LABELS: Record<string, string> = {
  added: '移除后来新增的文件',
  deleted: '找回文件',
  modified: '恢复之前的版本',
  'mode-changed': '恢复文件权限',
  'type-changed': '恢复之前的文件类型',
}

export function rewindChangeLabel(kind: string): string {
  return REWIND_CHANGE_LABELS[kind] ?? kind
}

export const REWIND_NO_CHANGES_TEXT = '项目文件已经是这条消息发送前的状态，无需恢复。想重新开始时，可以使用“分支新对话”。'

/** 非 ready 状态的说明文案（与插件 client 半同词条）。 */
export function rewindStatusText(preview: RewindPreview): string | undefined {
  if (preview.status === 'pending') return '这条消息发送前的文件还在保存，请稍后再试。'
  if (preview.status === 'missing') return '没有保存这条消息发送前的文件。可能是当时还没启用回退功能，或记录已超过保留期限。'
  if (preview.status === 'skipped') return '为避免阻塞消息发送，本轮没有自动保存文件：' + (preview.reason ?? '（原因缺失）')
  if (preview.status === 'failed') return '没能保存这条消息发送前的文件：' + (preview.error ?? '（错误缺失）')
  if (preview.status === 'unknown') return '回退预览失败（无法识别的响应）。'
  return undefined
}

/** 阻止性条件（占用/Git 操作进行中）的说明文案。 */
export function rewindBlockedText(preview: RewindPreview): string | undefined {
  if (preview.activeSessionIds.length > 0) {
    return '这个项目目录还有别的对话正在运行。恢复文件会影响到它们，因此本次操作已被阻止。请等那些对话结束或停止后，再重新检查。'
  }
  if (preview.operationChanged) {
    return 'Git 正在进行合并、变基或类似操作。请先完成或取消这次 Git 操作，再重新检查。'
  }
  return undefined
}

/** 409/404 错误码 → 中文（与插件 client 半同词条）；未知码回退到服务器 message。 */
export function rewindErrorLabel(code: string | undefined, message: string | undefined): string {
  switch (code) {
    case 'PLAN_STALE': return '项目文件在检查后又发生了变化。为避免覆盖新修改，请重新检查后再恢复。'
    case 'PLAN_STALE_REPOSITORY': return 'Git 状态在检查后又发生了变化，恢复已失效。请重新检查后再试。'
    case 'WORKSPACE_IN_USE': return '这个项目目录还有别的对话正在运行。请等那些对话结束或停止后，再重新检查。'
    case 'WORKSPACE_LOCKED': return '另一个恢复操作正在处理这个项目目录。请等待它完成后重新检查。'
    case 'HEAD_CHANGED': return '项目的提交或分支已发生变化。为避免覆盖新改动，请重新检查后再恢复。'
    case 'REPOSITORY_CHANGED': return '这个项目目录已不属于原来的 Git 工作区，无法恢复。'
    case 'GIT_OPERATION_CHANGED': return 'Git 正在执行其他操作。请先完成或取消该操作，再重新检查。'
    case 'RESTORE_POINT_NOT_FOUND': return '没有找到对应的文件状态，可能已被清理。'
    case 'NO_CHANGES': return REWIND_NO_CHANGES_TEXT
    case 'RESTORE_FAILED_ROLLED_BACK': return '恢复未能完成，项目文件已自动还原到操作前的状态。'
    case 'CONVERSATION_REWIND_FAILED': return '文件已恢复，但无法创建新对话；项目文件已自动还原。'
    default: return message !== undefined && message !== '' ? message : '回退失败。'
  }
}

/** 确认模态正文：文件清单（截前 8 项）+ 警示 + 备份说明。 */
export function rewindConfirmDetail(preview: RewindPreview): string {
  const lines: string[] = []
  lines.push('将恢复 ' + String(preview.totalChanges) + ' 个文件：')
  const shown = preview.changes.slice(0, 8)
  for (const change of shown) lines.push('· ' + change.path + '（' + rewindChangeLabel(change.kind) + '）')
  if (preview.totalChanges > shown.length) lines.push('…其余 ' + String(preview.totalChanges - shown.length) + ' 个文件')
  if (preview.headChanged) {
    lines.push(preview.branchChanged
      ? '⚠ 当前所在 Git 分支与发送消息时不同：恢复不会切换分支，只会把当时的文件内容恢复到当前分支。'
      : '⚠ 这条消息之后有新的 Git 提交：恢复只改文件、不撤销提交；完成后这些文件会显示为未提交修改。')
  }
  lines.push('“恢复并从这里继续”＝恢复文件并新建一个从这里开始的对话（当前对话保留）；“只恢复文件”＝当前对话不变。')
  lines.push('恢复前会自动备份当前文件；若恢复失败会自动还原，项目不会停留在半恢复状态。')
  return lines.join('\n')
}
