import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
/* 0.0.163（全产品审查 P1-2）：存储区目录体积统计/临时清理（异步 fs）。 */
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { IS_WIN, imageClipScript, imageFileClipScript, fileDropScript, runOpenWith, runPowershell, runStartProcess, svgClipScript, mathmlClipScript, cfHtmlDocument } from './system-clipboard.js'
import { appendCappedJsonl } from './jsonl-log.js'
import { displayNameOf, linkOpensAsText } from './file-path.js'
import { stripPngMetadataBase64 } from './png-meta-strip.js'
/* 0.0.170（用户反馈②③）：本工作区内容索引（子串匹配，绕开运行时 FTS5 分词限制）。 */
import { SearchIndexStore } from './search-index-store.js'
/* 0.1.65（T3-7）：面板脚注要写清索引上限——常量从索引模块取，避免两处口径漂移。 */
import { SEARCH_ENTRIES_PER_SESSION_MAX, SEARCH_ENTRY_TEXT_MAX, SEARCH_HITS_MAX, SEARCH_HITS_PER_SESSION_MAX, type SearchIndexHit } from './session-search-index.js'
import { buildRailNodeTables, deriveOutlinePieces, type RailNodeTables } from './rail-nodes.js'
import { readHistoryRail } from './history-scan.js'
import { scanSessionHistory } from './history-search.js'
import { planSendFailure } from './send-recovery.js'
import { bindSentOrigins } from './image-origins.js'
import { ImageOriginStore } from './image-origin-store.js'
import {
  CONFIG_WRITE_VALIDATORS,
  normalizeAttachSettings,
  normalizeCopySettings,
  normalizeEnvironmentSettings,
  normalizeFoldSettings,
  normalizeImageCopyFormat,
  normalizeImageStoreSettings,
  normalizePreviewSettings,
  normalizeSessionSettings,
  normalizeSessionViewMemory,
  normalizeTimeContextSettings,
  normalizeUiSettings,
  normalizeUpdateCheckFrequency,
  resolveFeedbackMs,
  type AttachSettings,
  type CopySettings,
  type EnvironmentSettings,
  type EnvironmentUpdatesView,
  type FoldSettings,
  type ImageCopyFormat,
  type ImageStoreSettings,
  type PreviewSettings,
  type SessionSettings,
  type SessionViewMemorySettings,
  type TimeContextSettings,
  type TurnRailSettings,
  type UiSettings,
  type UpdateCheckFrequency,
  normalizeTurnRailSettings,
  normalizeSessionHistorySettings,
  type SessionHistorySettings,
  normalizeUpdatesView,
} from './view-settings.js'
/* 0.0.160（N1）：任务通知——纯决策在 notify.ts（可单测），OS 通知本体在本文件。 */
import {
  actionKeyOf,
  approvalNotifyText,
  completeNotifyText,
  COMPLETION_CONFIRM_MS,
  CompletionConfirmer,
  completionCandidate,
  DEFAULT_NOTIFY_LEVEL,
  DEFAULT_NOTIFY_STYLE,
  notifyChannel,
  questionNotifyText,
  shouldNotify,
  type NotifyLevel,
  type NotifyStyle,
} from './notify.js'
import { applyTimeContextRefresh } from './time-context-config.js'
import { isBrokenSessionTitle, resolveSessionTitle } from './session-titles.js'
import { dedupeModelOptions } from './model-options.js'
import { ConnectionError, ModelConnections } from './model-connections.js'
import { mergeProjectionBlocks, type ProjectionBlock } from './projection-merge.js'
import {
  applySkillFallback,
  localDateKey,
  modelCatalogDiff,
  parseSkillManifest,
  pickHighestVersion,
  shouldAutoCheck,
  skillUpdateItem,
  updatesFrom,
  type ModelCatalogEntry,
  type SkillProbeResult,
  type SkillSourceEntry,
} from './update-check.js'
import {
  REWIND_NO_CHANGES_TEXT,
  rewindBlockedText,
  rewindConfirmDetail,
  rewindErrorLabel,
  rewindPreviewOf,
  rewindStatusText,
} from './turn-rewind.js'
import { ConversationProjector, fullTextOfEvent, imagesOfEvent, type ConversationImage, type ConversationMessage, type DshEvent, type MessageMeta } from './conversation.js'
import { attachActiveFileIfNeeded } from './auto-attach.js'
import {
  agentPresetStateOf,
  lockAgentPresetState,
  selectAgentPresetState,
  unavailableAgentPresetState,
  type AgentPresetState,
} from './agent-presets.js'
import {
  permissionPresetsOf,
  planModeCommand,
  planModeStateOf,
  planModeWithCommandAvailability,
  requiresFullAccessConfirmation,
  type PermissionPresetItem,
  type PlanModeState,
} from './collaboration-state.js'
import { DEEPSEEK_API_KEY_SECRET } from './credentials.js'
import { DiffReviewManager, type ChangedFileGroup } from './diff-review.js'
import { DebugRuntimeContribution } from './debug-runtime-contribution.js'
import { DebugSessionManager } from './debug-session-manager.js'
import { DirtyFileGuard } from './dirty-file-guard.js'
import { type PinnedEntry, savePinnedSlot, stillInSessions } from './draft-pinned.js'
/* 0.0.161（用户需求）：未发送草稿的持久化（Reload/重启后按会话恢复 文本/图片/文件卡）。 */
import { DraftStore } from './draft-store.js'
import { insertSessionAfter, moveSessionBefore, orderSessions } from './session-order.js'
import { EditorContextBridge } from './editor-context-bridge.js'
import {
  DshClient,
  DshRpcError,
  isRetryableAnswerError,
  type CommandDescriptor,
  type DshFrame,
  type HistoryEntry,
  type ImageMediaType,
  type ModelSelection,
  type PromptMode,
  type PromptImage,
  type QueueAction,
  type SessionModels,
  type SessionSummary,
  type SkillDescriptor,
} from './dsh-client.js'
import { questionSetKey, matchesQuestionIds, planParkRetry, shortId } from './question-park.js'
import { isIdeContextEnvelope, replaceTextPreservingIdeContext, withIdeContext, type IdeContextReference, type IdeContextSnapshot } from './ide-context.js'
import {
  imageLimitsOf,
  imageSizeText,
  looksLikeImageBytes,
  rejectImageAttachments,
  type ImageAttachmentLimits,
  type ImageCandidate,
} from './image-limits.js'
import { jobsSnapshotOf, type JobItem } from './jobs.js'
import {
  DEFAULT_FILE_CARD_RETENTION_DAYS,
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
  type AttachedFile,
  type MessageFilesStore,
} from './message-files.js'
import { queueSnapshotOf, type QueueItemState } from './queue.js'
import { DshRuntime, type RuntimeOwnership, type RuntimeState } from './runtime.js'
import { toolWriteIntents } from './tool-write-guard.js'
import { pageConversationMessage } from './tool-output-page.js'
import { chatHtml, rasterizeTarget } from './webview.js'
import { DshPluginManager } from './plugin-manager.js'
import { classifyRecycle, findSessionWorkspace, normalizeSessionId, sameCwd, SessionRecycleBin, type RecycleItemView } from './recycle-bin.js'
import { hasSettingsOverrides, runtimeSettingFields, settingConstantOptions } from './runtime-settings.js'
import { resolveDshHome, type PluginInventorySnapshot } from './plugin-profile.js'
import type { SettingsDescription, SettingsMutation, SettingsNamespace } from './runtime-settings.js'
import { appendLiveEntry, catchUpCoversTail, earliestHistorySequence, historySequenceCounts, mergeHistoryEntries, mergedWindowHasMore, unseenHistoryEntries } from './history.js'
import { routeSlashInput, type SlashRoute } from './slash-routing.js'
import { unavailableUsageMeterState, usageMeterStateOf, type UsageMeterState } from './usage-meter.js'
import { UsageLedger, familyOfModel, hasDeepSeekPricing, isPeakAt, usageCostStateOf } from './usage-cost.js'
import {
  contextDetailOf,
  contextDetailRequestOf,
  contextPanelStateOf,
  unavailableContextPanelState,
  type ContextDetailRequest,
  type ContextDetailResult,
  type ContextPanelState,
} from './context-panel.js'
import { buildCompatMatrix, TRACKED_PLUGINS } from './compat-matrix.js'
import { draftFrameSelectionsOf, expandedDraftImages, type DraftImageEntry } from './draft-frames.js'
import { readInstalledPlugins, readInstalledVersions } from './plugin-profile.js'
import { TurnMetaTracker } from './turn-meta.js'
import {
  memoryFromPlain,
  memoryToPlain,
  mergeRememberedMeta,
  rememberMeta,
  rememberedMeta,
  type RememberedMeta,
  type TurnTokSMemory,
} from './turn-meta-memory.js'
import {
  diffConversationMessages,
  messageForWebview,
  messagesPatchForWebview,
  type ConversationMessagesPatch,
} from './chat-state-patch.js'

let activeRuntime: DshRuntime | undefined
// Capture once per window so file operations and the runtime cannot diverge
// after a settings edit. Changing the directory takes effect on window reload.
let activeDshHome: string | undefined
function dshHomeNow(): string { return activeDshHome ?? resolveDshHome() }

interface SessionItem {
  id: string
  title: string
  running: boolean
  blank: boolean
  /** G5 tab tooltip：最后活动/创建时间（协议二缺一：updatedAt 有、createdAt 本机跟踪）。 */
  updatedAt?: number
  createdAt?: number
}

interface ReasoningEffortItem {
  id: string
  label: string
  selected: boolean
}

interface ModelItem {
  provider: string
  providerLabel?: string
  model: string
  label: string
  selected: boolean
  reasoningEfforts: ReasoningEffortItem[]
  defaultReasoningEffort?: string
}

interface ApprovalItem {
  rpcId: string
  approvalId: string
  toolName: string
  reason?: string
}

interface QuestionOption {
  label: string
  description?: string
}

interface QuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options: QuestionOption[]
  multiSelect: boolean
}

interface QuestionRequest {
  rpcId: string
  questions: QuestionItem[]
}

interface QuestionAnswer {
  id: string
  selected: string[]
  custom?: string
}

interface WorkspacePick extends vscode.QuickPickItem {
  action?: 'switch' | 'open'
  uri?: vscode.Uri
}

interface ChatViewState {
  phase: 'loading' | 'ready' | 'error'
  statusText: string
  workspaceName: string
  cwd: string
  sessions: SessionItem[]
  recycle: RecycleItemView[]
  /* 0.0.147（用户反馈②）：其他项目的回收站条目数（菜单底部提示行用；列表本体只含本项目）。 */
  recycleOthers: number
  sessionId: string
  messages: ConversationMessage[]
  /* G49 v2（0.0.121）：工作段"已应答停点"（审批决定 / ask_user 结果）——分段边界用。 */
  segmentStops: number[]
  /* G49 v2（0.0.121）：官方 turnOutline 投影（全量轮次大纲；分页窗口外的轮也在）——轮次轨道用。 */
  turnOutline: TurnOutlineEntry[]
  running: boolean
  routable: boolean
  /* 0.1.10（用户反馈）：运行中按 Enter 的模式——跟随运行时设置 ui-conversation.busyEnter
     （设置台「对话交互 → 运行中发送消息」）；Ctrl/Cmd+Enter 反选。 */
  busyEnter: 'queue' | 'steer'
  models: ModelItem[]
  approval: ApprovalItem | null
  question: QuestionRequest | null
  commands: CommandDescriptor[]
  skills: SkillDescriptor[]
  agentPreset: AgentPresetState
  usage: UsageMeterState
  /* C3 (0.0.69): dsh-context 投影派生（外部插件缺席时 available:false，UI 回落） */
  context: ContextPanelState
  /* 0.0.146（用户）：侧栏扩展自身版本（设置台「运行环境」显示——reload/排障确认运行版本）。 */
  extensionVersion?: string
  imageLimits: ImageAttachmentLimits | undefined
  permissions: PermissionPresetItem[]
  plan: PlanModeState
  changedFiles: ChangedFileGroup[]
  queue: QueueItemState[]
  jobs: JobItem[]
  animationStyle: string
  markdownImages: boolean
  copySettings: CopySettings
  /* 2026-09-25（用户需求）：搜索命中高亮的模式与颜色（纯渲染项） */
  searchSettings: { highlightMode: string; highlightColor: string; highlightFg: string; blinkPeriod: number; resultOrder: string; snippetView: string; includeTools: boolean; groupOrder: string; returnPill: boolean; returnPillSeconds: number }
  /* G41 v1.2（0.0.101）：轮次导航跳转动画时长（秒；0=瞬时） */
  turnRailSettings: TurnRailSettings
  foldSettings: FoldSettings
  imageCopyFormat: ImageCopyFormat
  /* 0.0.80：图片预览行为（缩放界限 + GIF 默认播放；0.0.96 增选帧器上限） */
  previewSettings: PreviewSettings
  /* 0.0.96（G38 批次 2）：附件单次上限（拖入/粘贴的接收限制） */
  attachSettings: AttachSettings
  /* 0.0.154：会话加载设置（打开即全量 + 上限）。 */
  sessionHistorySettings: SessionHistorySettings
  /* 0.0.97（批次 3-E1）：原图存储总量上限（哨兵 -1 = 不剪枝） */
  imageStoreSettings: ImageStoreSettings
  sessionSettings: SessionSettings
  /* G39（0.0.93）：切会话视图记忆开关（滚动/展开/折叠；设置台 UI 后续补） */
  sessionViewMemory: SessionViewMemorySettings
  /* 0.0.88：时间上下文采样间隔（秒；写入 dsh profile 的 time-context 行） */
  timeContextSettings: TimeContextSettings
  environmentSettings: EnvironmentSettings
  /* 0.0.109（G50）：界面行为（hover 显示官方英文原文）。 */
  uiSettings: UiSettings
  /* 0.0.75（G11）：更新自动检查频率（startup=每天首次 / reload / weekly / never） */
  updateCheckFrequency: UpdateCheckFrequency
  /* 0.0.76：运行时是否装有 turn-rewind 插件（决定消息菜单是否出现"回退"项） */
  rewindAvailable: boolean
  includeContext: boolean
  hasMoreHistory: boolean
  loadingHistory: boolean
}

interface ChatViewStateUpdate {
  patch: Partial<Omit<ChatViewState, 'messages'>>
  messages?: ConversationMessagesPatch
}

/* 2026-10-06（S3，性能）：数组级"逐位同引用"判定——命中即整数组复用（免 O(N) 深比 diff）。 */
function sameMessageRefs(left: readonly ConversationMessage[], right: readonly ConversationMessage[]): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false
  return true
}

function stateUpdate(previous: ChatViewState, next: ChatViewState): ChatViewStateUpdate | undefined {
  const patch: Partial<Omit<ChatViewState, 'messages'>> = {}
  const previousRecord = previous as unknown as Record<string, unknown>
  const nextRecord = next as unknown as Record<string, unknown>
  const patchRecord = patch as Record<string, unknown>
  for (const key of Object.keys(nextRecord)) {
    if (key !== 'messages' && previousRecord[key] !== nextRecord[key]) patchRecord[key] = nextRecord[key]
  }
  /* 2026-10-06（S3，性能）：同引用 = 无变化 ⇒ 免去逐条深比（真机每拍 O(N≈3200) 的 sameMessage 链）。 */
  const messages = previous.messages === next.messages ? undefined : diffConversationMessages(previous.messages, next.messages)
  return Object.keys(patchRecord).length === 0 && messages === undefined
    ? undefined
    : { patch, ...(messages === undefined ? {} : { messages }) }
}

function stateForWebview(state: ChatViewState): ChatViewState {
  return { ...state, messages: state.messages.map(messageForWebview) }
}

function stateUpdateForWebview(update: ChatViewStateUpdate): ChatViewStateUpdate {
  return {
    patch: update.patch,
    ...(update.messages === undefined ? {} : { messages: messagesPatchForWebview(update.messages) }),
  }
}

function animationStyleNow(): string {
  return vscode.workspace.getConfiguration('deepseekHarness').get<string>('animationStyle', 'standard')
}

function markdownImagesNow(): boolean {
  return vscode.workspace.getConfiguration('deepseekHarness').get<boolean>('markdownImages', false)
}

/* G6 (0.0.60): 视图设置读取——键在 package.json 声明（默认值与旧硬编码一致）；
   净化/钳位在 view-settings.ts（纯函数，可测试）。 */
/* 2026-09-25（用户需求）：搜索命中高亮的模式与颜色（纯前端渲染项，不进视图缓存键 ⇒ 改动不触发整会话重建）。 */
function searchSettingsNow(): { highlightMode: string; highlightColor: string; highlightFg: string; blinkPeriod: number; resultOrder: string; snippetView: string; includeTools: boolean; groupOrder: string; returnPill: boolean; returnPillSeconds: number; nodeChip: boolean } {
  const cfg = vscode.workspace.getConfiguration('deepseekHarness')
  const mode = cfg.get<string>('search.highlightMode')
  const color = cfg.get<string>('search.highlightColor')
  const fg = cfg.get<string>('search.highlightFg')
  const blinkPeriod = cfg.get<number>('search.blinkPeriod')
  const resultOrder = cfg.get<string>('search.resultOrder')
  const snippetView = cfg.get<string>('search.snippetView')
  /* 0.1.84（用户拍板）：跨会话跳转后的「返回搜索起点」胶囊可整体关闭（默认开）。
     0.1.88（用户需求）：胶囊显示时长入设置（秒，3–120，默认 12）。 */
  /* 0.1.96（用户拍板）：工具卡内容默认不搜（噪声大）；开关可放大。 */
  const includeTools = cfg.get<boolean>('search.includeTools')
  /* 0.1.103（用户需求）：Enter 逐处跳的会话组序——最近命中优先（默认）/ 侧栏顺序。 */
  const groupOrder = cfg.get<string>('search.groupOrder')
  const returnPill = cfg.get<boolean>('search.returnPill')
  const returnPillSeconds = cfg.get<number>('search.returnPillSeconds')
  /* 0.1.122（G55）：搜索结果行内节点编号片开关（默认开）。 */
  const nodeChip = cfg.get<boolean>('search.nodeChip')
  return {
    highlightMode: mode === 'blink' || mode === 'blinkThenSteady' ? mode : 'steady',
    /* 0.1.111（审查低危·口径一致）：此前任何非空串都原样下发，而视图/校验器只认 6 位 hex ⇒
       手改 `#fff` 会被视图静默当主题色（"设置没生效"的错觉）。这里与 view-settings 同口径归一。 */
    highlightColor: typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : 'theme',
    /* 0.1.68（用户反馈）：分发场景下"翻色"要可关（fixed = 按最浓那端锁定一种字色）。 */
    highlightFg: fg === 'fixed' ? 'fixed' : 'auto',
    /* 0.1.69（用户反馈）：改「时长」为「**周期**」——一个呼吸来回的秒数；「呼吸后常亮」按整周期收尾。 */
    blinkPeriod: typeof blinkPeriod === 'number' && Number.isFinite(blinkPeriod) ? Math.min(3, Math.max(0.6, blinkPeriod)) : 1.2,
    /* 0.1.71（用户拍板）：结果排序（最近优先 / 时间正序）。 */
    resultOrder: resultOrder === 'oldest' ? 'oldest' : 'recent',
    /* 0.1.72（用户拍板）：长片段显示方式——peek=悬停覆盖层（默认，行高恒定）/ pane=面板底部固定详情区。 */
    snippetView: snippetView === 'pane' ? 'pane' : 'peek',
    includeTools: includeTools === true,
    /* 0.1.103（用户需求）：会话组序——'panel'=按侧栏顺序；其余回落'最近命中优先'。 */
    groupOrder: groupOrder === 'panel' ? 'panel' : 'recent',
    returnPill: returnPill !== false,
    returnPillSeconds: typeof returnPillSeconds === 'number' && Number.isFinite(returnPillSeconds) ? Math.min(120, Math.max(3, Math.round(returnPillSeconds))) : 12,
    nodeChip: nodeChip !== false,
  }
}

function copySettingsNow(): CopySettings {
  const cfg = vscode.workspace.getConfiguration('deepseekHarness')
  return normalizeCopySettings({
    mathButtons: cfg.get('copy.mathButtons'),
    blockButtons: cfg.get('copy.blockButtons'),
    mathFormat: cfg.get('copy.mathFormat'),
    plainMathFormat: cfg.get('copy.plainMathFormat'),
    codeCopyFormat: cfg.get('copy.codeCopyFormat'),
    /* G42-A（0.0.97）：新键秒优先；旧键 feedbackMs 仅作一次性换算回退（不写回）。 */
    feedbackMs: resolveFeedbackMs(cfg.get('copy.feedbackSeconds'), cfg.get('copy.feedbackMs')),
    /* 0.0.104（G45 修复①）：本键此前漏读——set-config 写盘成功但状态永远回读成 theme，
       表现为"取消跟随主题后再开面板又变回跟随主题"。 */
    mathSvgColor: cfg.get('copy.mathSvgColor'),
    /* 0.0.105（G45 v1.2）：位图档位（读回同样必须在场）。 */
    svgPngEdge: cfg.get('copy.svgPngEdge'),
  })
}

/* G41 v1.2（0.0.101）：轮次导航跳转动画时长（秒；0 = 瞬时）。0.0.128 增滚动条方式/节点最小间距。 */
function turnRailSettingsNow(): TurnRailSettings {
  const cfg = vscode.workspace.getConfiguration('deepseekHarness')
  return normalizeTurnRailSettings({
    jumpSeconds: cfg.get('turnRail.jumpSeconds'), granularity: cfg.get('turnRail.granularity'),
    scrollbar: cfg.get('turnRail.scrollbar'), minGap: cfg.get('turnRail.minGap'),
    /* 0.0.148：读侧此前漏读 dragEdgePx/dragSpeed（设置台写盘成功但状态永远回读成默认值——
       与 0.0.108 fold.blockMinLines 同款"读侧断点"，本轮一并修复）；markStops 为 G53 新键。 */
    dragEdgePx: cfg.get('turnRail.dragEdgePx'), dragSpeed: cfg.get('turnRail.dragSpeed'),
    markStops: cfg.get('turnRail.markStops'), markNoteOnly: cfg.get('turnRail.markNoteOnly'),
    markColor: cfg.get('turnRail.markColor'), stopColor: cfg.get('turnRail.stopColor'),
    /* 0.1.114（G55 轨道序号）：滚动静息徽标「N/M」开关（读侧同链，默认开）。 */
    nodeBadge: cfg.get('turnRail.nodeBadge'),
    /* 0.1.122（G55 内容设置）：摘要长度 / 编号文案档位 / 节点列滚动动画时长 / 提示两行。 */
    summaryLength: cfg.get('turnRail.summaryLength'), numberStyle: cfg.get('turnRail.numberStyle'),
    scrollAnimSeconds: cfg.get('turnRail.scrollAnimSeconds'), tipTwoLine: cfg.get('turnRail.tipTwoLine'),
  })
}

/* 0.0.154：会话加载设置（打开即全量 + 上限）。 */
function sessionHistorySettingsNow(): SessionHistorySettings {
  const cfg = vscode.workspace.getConfiguration('deepseekHarness')
  return normalizeSessionHistorySettings({
    loadAll: cfg.get('sessionHistory.loadAll'),
    maxMessages: cfg.get('sessionHistory.maxMessages'),
  })
}

/* 批次 3-E1（0.0.97）：原图存储总量上限（哨兵 -1 = 不剪枝）。 */
function imageStoreSettingsNow(): ImageStoreSettings {
  const cfg = vscode.workspace.getConfiguration('deepseekHarness')
  return normalizeImageStoreSettings({
    maxTotalMB: cfg.get('imageStore.maxTotalMB'),
  })
}

const imageStoreMaxBytesOf = (settings: ImageStoreSettings): number =>
  settings.maxTotalMB === -1 ? -1 : settings.maxTotalMB * 1024 * 1024

function foldSettingsNow(): FoldSettings {
  const cfg = vscode.workspace.getConfiguration('deepseekHarness')
  return normalizeFoldSettings({
    enabled: cfg.get('fold.enabled'),
    previewLines: cfg.get('fold.previewLines'),
    triggerRatio: cfg.get('fold.triggerRatio'),
    minFoldExtraLines: cfg.get('fold.minFoldExtraLines'),
    minChars: cfg.get('fold.minChars'),
    blockMinLines: cfg.get('fold.blockMinLines'),
    /* 0.0.108（用户补充①）：变更文件块自动折叠。 */
    changedFiles: cfg.get('fold.changedFiles'),
    changedFilesLines: cfg.get('fold.changedFilesLines'),
    /* G49（0.0.119）：AI 工作段（过程）自动折叠。 */
    workSegments: cfg.get('fold.workSegments'),
  })
}

/* G49 v2（0.0.121）：官方 turnOutline 投影 → 侧栏状态（轮次轨道用；分页窗口外的轮也在）。 */
export interface TurnOutlineEntry { turn: number; seq: number; prompt: string; response: string }
function turnOutlineOf(value: unknown): TurnOutlineEntry[] {
  if (!Array.isArray(value)) return []
  const out: TurnOutlineEntry[] = []
  for (const item of value) {
    const entry = typeof item === 'object' && item !== null ? item as Record<string, unknown> : undefined
    if (entry === undefined) continue
    const turn = entry.turn
    const seq = entry.seq
    if (typeof turn !== 'number' || !Number.isFinite(turn) || typeof seq !== 'number' || !Number.isFinite(seq)) continue
    out.push({
      turn,
      seq,
      prompt: typeof entry.prompt === 'string' ? entry.prompt : '',
      response: typeof entry.response === 'string' ? entry.response : '',
    })
  }
  return out
}

function imageCopyFormatNow(): ImageCopyFormat {
  return normalizeImageCopyFormat(vscode.workspace.getConfiguration('deepseekHarness').get('imageCopyFormat'))
}

/* 0.0.80（用户反馈④）：图片预览行为（缩放界限 + GIF 默认播放）。
   0.0.96（G38 批次 2）：+ 动图选帧器上限（maxFrames 抽帧 / maxFrameSelections 多选）。 */
function previewSettingsNow(): PreviewSettings {
  const cfg = vscode.workspace.getConfiguration('deepseekHarness')
  return normalizePreviewSettings({
    minScale: cfg.get('preview.minScale'),
    maxScale: cfg.get('preview.maxScale'),
    gifAutoplay: cfg.get('preview.gifAutoplay'),
    maxFrames: cfg.get('preview.maxFrames'),
    maxFrameSelections: cfg.get('preview.maxFrameSelections'),
  })
}

/* 0.0.96（G38 批次 2）：附件单次上限（拖入/粘贴的接收限制）。 */
function attachSettingsNow(): AttachSettings {
  const cfg = vscode.workspace.getConfiguration('deepseekHarness')
  /* 0.0.162（全产品审查 P0-2）：压缩三键此前**只写不读**（"只写不读"第四次复发）——设置台写了
     Global，这里只回读 maxFiles/maxTotalMB → 状态里压缩三键永远是默认值，webview 的 compressCfg
     读到的恒为 20/4096/82，改动静默无效。本次全量回读。 */
  return normalizeAttachSettings({
    maxFiles: cfg.get('attach.maxFiles'),
    maxTotalMB: cfg.get('attach.maxTotalMB'),
    maxFileMB: cfg.get('attach.maxFileMB'),
    compressThresholdMB: cfg.get('attach.compressThresholdMB'),
    compressMaxEdge: cfg.get('attach.compressMaxEdge'),
    compressQuality: cfg.get('attach.compressQuality'),
  })
}

/* G6 v1（0.0.62）：设置台面板——会话区（可编辑）与运行环境区（v1 只读展示）快照。 */
function sessionSettingsNow(): SessionSettings {
  const cfg = vscode.workspace.getConfiguration('deepseekHarness')
  return normalizeSessionSettings({
    sortMode: cfg.get('sessionSortMode'),
    recycleRetentionDays: cfg.get('recycleRetentionDays'),
    fileCardRetentionDays: cfg.get('fileCardRetentionDays'),
  })
}

/* 0.0.109（G50）：界面行为设置（hover 显示官方英文原文）。
   0.0.160（N1 顺修）：hintSeconds / sessionTabMinWidth 此前**只写不读**——设置台经 set-config
   写了 Global，本函数却只回读 showOriginalOnHover → 两项永远回默认值、改动静默不生效
   （与 0.0.144 dragEdgePx/dragSpeed 同款坑）。本次全量回读，并新增 notifyLevel。 */
function uiSettingsNow(): UiSettings {
  const cfg = vscode.workspace.getConfiguration('deepseekHarness')
  return normalizeUiSettings({
    showOriginalOnHover: cfg.get('ui.showOriginalOnHover'),
    hintSeconds: cfg.get('ui.hintSeconds'),
    sessionTabMinWidth: cfg.get('ui.sessionTabMinWidth'),
    notifyLevel: cfg.get('ui.notifyLevel'),
    notifyStyle: cfg.get('ui.notifyStyle'),
    keepDrafts: cfg.get('ui.keepDrafts'),
    diagnostics: cfg.get('ui.diagnostics'),
    contentMaxWidth: cfg.get('ui.contentMaxWidth'),
    /* 0.1.44（D3）：折叠内容按需构建（默认开，可关）。 */
    lazyFoldedBodies: cfg.get('ui.lazyFoldedBodies'),
    /* 0.1.45（D1）：动作行悬停显示（默认开，可关）。 */
    hoverActions: cfg.get('ui.hoverActions'),
    /* 0.1.51（CV）：离屏跳过排版（默认开，可关）。 */
    messageContainment: cfg.get('ui.messageContainment'),
  })
}

/* 0.1.7（用户需求）：Windows 原生 Toast（右下角）——PowerShell WinRT，零第三方依赖。
   文本经 XML 转义 + 单引号加倍 + 整段脚本 EncodedCommand（UTF-16LE base64）传递——防会话标题注入；
   TOAST_URI = 点击弹窗经协议路由回侧栏（activate 里注册的 UriHandler）；失败静默（通知不阻断主链路）。 */
const TOAST_URI = 'vscode://lixxx1.dsh-sidebar/notify'

function showWindowsToast(text: string): void {
  const flat = text.replace(/[\r\n\t]+/g, ' ')
  const xml = `<toast activationType="protocol" launch="${TOAST_URI}">`
    + `<visual><binding template="ToastGeneric"><text>DSH</text><text>${escapeXmlText(flat)}</text></binding></visual></toast>`
  const psXml = xml.replace(/'/g, "''")
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
    '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
    `$xml.LoadXml('${psXml}')`,
    '$toast = New-Object Windows.UI.Notifications.ToastNotification $xml',
    String.raw`[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe').Show($toast)`,
  ].join('; ')
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 15000 },
    () => { /* 通知失败静默 */ },
  )
}

function escapeXmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/* 2026-10-05（B 诊断留痕）：连接生命周期与提交判定——输出面板 + 持久文件双写。
   动因：本日真机事故（连接风暴期提交被网关丢弃）能破案，全靠 VS Code 持久化的输出日志
   （%APPDATA%/Code/logs/<会话>/window<N>/exthost/lixxx1.dsh-sidebar/DeepSeek Harness.log）；
   自持一份到 globalStorage（滚动 400 行），Reload/换窗口也不丢，下次复发可直接取证。 */
function connLog(output: vscode.OutputChannel, message: string): void {
  output.appendLine(`[conn] ${message}`)
  try {
    const dir = EXT_CONTEXT?.globalStorageUri?.fsPath
    if (dir === undefined || dir === '') return
    appendCappedJsonl(path.join(dir, 'conn-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), message }), 400)
  } catch { /* 取证写盘失败静默 */ }
}

/* 2026-10-06（W7）：诊断 JSONL 追加式落盘 helper 见 jsonl-log.ts（appendCappedJsonl，可单测）。 */

/* 0.1.0（B6 A8）：诊断日志开关（默认关）——关时 webview 的每帧 [trace] 不进输出面板。 */
function diagnosticsNow(): boolean {
  return vscode.workspace.getConfiguration('deepseekHarness').get<boolean>('ui.diagnostics', false) === true
}

/* 0.0.161（用户需求）：草稿持久化开关（默认开）——扩展侧落盘/恢复的闸门（与 uiSettings 同源）。 */
function keepDraftsNow(): boolean {
  return vscode.workspace.getConfiguration('deepseekHarness').get<boolean>('ui.keepDrafts', true) !== false
}

/* 0.0.161：草稿存储单例（视图与配置监听共用；storageUri 缺席 → 功能静默关闭）。 */
let sharedDraftStore: DraftStore | undefined
function draftStoreNow(): DraftStore {
  if (sharedDraftStore === undefined) {
    sharedDraftStore = new DraftStore(EXT_CONTEXT?.storageUri?.fsPath ?? EXT_CONTEXT?.globalStorageUri?.fsPath)
  }
  return sharedDraftStore
}

/* 0.0.170（用户反馈②③）：本工作区内容索引单例（store 在 globalStorage；缺席则功能静默关闭）。 */
let sharedSearchIndex: SearchIndexStore | undefined
/* 2026-10-06（W9 留痕）：store 的落盘失败需要外露——activate 里创建输出通道后回填此引用
   （EXT_CONTEXT 上没有 outputChannel 属性，早前写法是空操作）。 */
let sharedOutput: vscode.OutputChannel | undefined
function searchIndexNow(): SearchIndexStore {
  if (sharedSearchIndex === undefined) {
    sharedSearchIndex = new SearchIndexStore(EXT_CONTEXT?.globalStorageUri?.fsPath, message => {
      try { sharedOutput?.appendLine('[search-index] ' + message) } catch { /* 诊断静默 */ }
    })
  }
  return sharedSearchIndex
}

/* 0.0.163（全产品审查 P1-2/P1-3）：设置台「存储」区——落盘目录的位置/占用/清理。
   五个目录：会话回收站 / 粘贴副本 / 导出副本 / 草稿 / 原图留档。 */
export interface StorageEntryView {
  id: string
  label: string
  path: string
  bytes: number
  exists: boolean
}

async function directorySizeBytes(dir: string): Promise<{ bytes: number; exists: boolean }> {
  try {
    const stat = await fsp.stat(dir)
    if (!stat.isDirectory()) return { bytes: stat.size, exists: true }
  } catch {
    return { bytes: 0, exists: false }
  }
  let total = 0
  const walk = async (current: string): Promise<void> => {
    try {
      const entries = await fsp.readdir(current, { withFileTypes: true })
      for (const entry of entries) {
        const full = path.join(current, entry.name)
        if (entry.isDirectory()) { await walk(full); continue }
        try { total += (await fsp.stat(full)).size } catch { /* 单文件失败忽略 */ }
      }
    } catch { /* 子目录不可读忽略 */ }
  }
  await walk(dir)
  return { bytes: total, exists: true }
}

async function storageSnapshotView(cwd: string): Promise<StorageEntryView[]> {
  const drafts = draftStoreNow().directory
  const origins = ORIGIN_STORE === undefined ? undefined : ORIGIN_STORE.directory
  const raw: Array<{ id: string; label: string; path: string | undefined }> = [
    { id: 'recycle', label: '会话回收站', path: path.join(dshHomeNow(), 'recycle-bin') },
    { id: 'paste', label: '文件卡粘贴副本', path: cwd === '' ? undefined : path.join(cwd, '_temp', '.dsh-paste') },
    { id: 'export', label: '剪贴板导出副本', path: cwd === '' ? undefined : path.join(cwd, '_temp', '.dsh-export') },
    { id: 'drafts', label: '未发送草稿', path: drafts },
    { id: 'origins', label: '原图留档', path: origins === undefined || origins === '' ? undefined : origins },
  ]
  const out: StorageEntryView[] = []
  for (const entry of raw) {
    if (entry.path === undefined || entry.path === '') continue
    const size = await directorySizeBytes(entry.path)
    out.push({ id: entry.id, label: entry.label, path: entry.path, bytes: size.bytes, exists: size.exists })
  }
  return out
}

/* 0.0.163（审查 P1-3）：剪贴板临时件（%TEMP%/dsh-*-clip-*）——只作剪贴板载体，启动时与手动清理。 */
async function cleanupTempClipFiles(): Promise<number> {
  let removed = 0
  try {
    const entries = await fsp.readdir(os.tmpdir())
    for (const name of entries) {
      if (!/^dsh-(svg|mathml|image)-clip-/.test(name)) continue
      try { await fsp.rm(path.join(os.tmpdir(), name), { force: true }); removed += 1 } catch { /* 尽力而为 */ }
    }
  } catch { /* tmpdir 不可读忽略 */ }
  return removed
}

/* G39（0.0.93）：切会话视图记忆开关（滚动位置 / 工具卡展开态 / 手动折叠态）。 */
function sessionViewMemoryNow(): SessionViewMemorySettings {
  const cfg = vscode.workspace.getConfiguration('deepseekHarness')
  return normalizeSessionViewMemory({
    scroll: cfg.get('sessionViewMemory.scroll'),
    expand: cfg.get('sessionViewMemory.expand'),
    fold: cfg.get('sessionViewMemory.fold'),
  })
}

/* G39（0.0.93）：切会话视图记忆的持久化形态——webview 上报（未净化的原始值）→ 这里净化后写 workspaceState。
   `at` 用于容量淘汰（最多保留 32 个会话；每会话 expanded/folds 各封顶 200 条）。 */
interface SessionViewStateRecord {
  scrollTop: number
  atBottom: boolean
  /* G39 v2：滚动锚点（顶部可见消息 id + 其顶部在视口上方多远处）——位置恢复的精确依据。 */
  anchorId?: string
  anchorOffset?: number
  /* 0.1.124（数据层根治）：锚点消息的事件 seq——Reload 恢复时若锚点在已加载窗口之外，
     凭它穿透加载到锚点再回位（不再回退数值 clamp 静默漂移）。 */
  anchorSeq?: number
  railAnchorSeq?: number
  railAnchorOffset?: number
  railViewportManual?: boolean
  expanded: string[]
  folds: Record<string, 'folded' | 'expanded'>
  /* G39 v2：超高块（代码/引用/表格）折叠记忆，键 = 消息 id#源起始行。 */
  blocks: Record<string, 'folded'>
  /* 0.0.148（G53）：轨道节点标注，键 = 归一化 seq（'s<seq>'）或 'k:<turn id>'；值 = 标注文本。 */
  marks: Record<string, string>
  /* 0.0.156（G53）：收藏节点集合（独立于标注）；键规范同 marks。**字段缺失 = 旧数据**（webview 侧按
     "有标注键=已收藏"迁移）；空数组 = 明确零收藏。 */
  stars?: string[]
  /* 0.1.9（用户需求）：轨道节点增删覆盖层——键规范同 marks；值 = 'hidden'（隐藏）| 'merged'（与上一
     节点合并）。只作用于轨道导航层，不动消息与折叠。 */
  railDropped?: Record<string, 'hidden' | 'merged'>
  at: number
}
/* 0.0.154（O3）：每会话历史窗口缓存容量（LRU）。 */
const HISTORY_WINDOW_CACHE_CAP = 4
const SESSION_VIEW_STATE_KEY = 'dshSessionViewStates'
const SESSION_VIEW_STATE_CAP = 32
const SESSION_VIEW_STATE_ENTRY_CAP = 200
const SESSION_VIEW_STATE_ANCHOR_OFFSET_LIMIT = 1_000_000
let sharedSessionViewStates: Record<string, SessionViewStateRecord> | undefined
let sessionViewStateRevision = 0
let sessionViewStateWrites: Promise<void> = Promise.resolve()
const sessionViewStateRemoved = new vscode.EventEmitter<{ sessionId: string; revision: number }>()

function capSessionViewStates(states: Record<string, SessionViewStateRecord>): void {
  const entries = Object.entries(states).map(([id, record], index) => ({ id, at: record.at, index }))
    .sort((a, b) => b.at - a.at || b.index - a.index)
  for (const { id } of entries.slice(SESSION_VIEW_STATE_CAP)) delete states[id]
}

function writeSessionViewStates(): void {
  // Snapshot when this write starts, not when queued: a pending surface flush
  // must never reintroduce a record removed by a later permanent deletion.
  sessionViewStateWrites = sessionViewStateWrites.then(async () => {
    await EXT_CONTEXT?.workspaceState.update(SESSION_VIEW_STATE_KEY, { ...loadSessionViewStates() })
  }).catch(() => { console.error('Unable to persist session view state') })
}

function forgetSessionViewState(sessionId: string): void {
  delete loadSessionViewStates()[sessionId]
  sessionViewStateRevision += 1
  writeSessionViewStates()
  sessionViewStateRemoved.fire({ sessionId, revision: sessionViewStateRevision })
}

function sanitizeSessionViewState(raw: unknown): SessionViewStateRecord | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const input = raw as Record<string, unknown>
  const scrollTop = typeof input.scrollTop === 'number' && Number.isFinite(input.scrollTop) ? Math.max(0, Math.round(input.scrollTop)) : 0
  const anchorId = typeof input.anchorId === 'string' && input.anchorId !== '' ? input.anchorId.slice(0, 200) : undefined
  const anchorOffset = typeof input.anchorOffset === 'number' && Number.isFinite(input.anchorOffset)
    ? Math.max(-SESSION_VIEW_STATE_ANCHOR_OFFSET_LIMIT, Math.min(SESSION_VIEW_STATE_ANCHOR_OFFSET_LIMIT, Math.round(input.anchorOffset)))
    : undefined
  /* 0.1.31（P1）：锚点在消息列表里的下标（优先片定位用）。 */
  const anchorIndex = typeof input.anchorIndex === 'number' && Number.isFinite(input.anchorIndex)
    ? Math.max(0, Math.round(input.anchorIndex))
    : undefined
  /* 0.1.124（数据层根治）：锚点事件 seq（窗外恢复的穿透依据；非负整数）。 */
  const anchorSeq = typeof input.anchorSeq === 'number' && Number.isFinite(input.anchorSeq)
    ? Math.max(0, Math.round(input.anchorSeq))
    : undefined
  const railAnchorSeq = typeof input.railAnchorSeq === 'number' && Number.isFinite(input.railAnchorSeq)
    ? Math.max(0, Math.round(input.railAnchorSeq)) : undefined
  const railAnchorOffset = typeof input.railAnchorOffset === 'number' && Number.isFinite(input.railAnchorOffset)
    ? Math.max(-SESSION_VIEW_STATE_ANCHOR_OFFSET_LIMIT, Math.min(SESSION_VIEW_STATE_ANCHOR_OFFSET_LIMIT, Math.round(input.railAnchorOffset))) : undefined
  const expanded = Array.isArray(input.expanded)
    ? input.expanded.filter((id): id is string => typeof id === 'string' && id !== '').slice(0, SESSION_VIEW_STATE_ENTRY_CAP)
    : []
  const folds: Record<string, 'folded' | 'expanded'> = {}
  if (typeof input.folds === 'object' && input.folds !== null) {
    let count = 0
    for (const [id, state] of Object.entries(input.folds as Record<string, unknown>)) {
      if (count >= SESSION_VIEW_STATE_ENTRY_CAP) break
      if (id !== '' && (state === 'folded' || state === 'expanded')) { folds[id] = state; count += 1 }
    }
  }
  const blocks: Record<string, 'folded'> = {}
  if (typeof input.blocks === 'object' && input.blocks !== null) {
    let count = 0
    for (const [key, value] of Object.entries(input.blocks as Record<string, unknown>)) {
      if (count >= SESSION_VIEW_STATE_ENTRY_CAP) break
      if (key !== '' && key.length <= 300 && value === 'folded') { blocks[key] = 'folded'; count += 1 }
    }
  }
  /* 0.0.148（G53）：轨道节点标注（值=标注文本；与 folds 同规范截断）。 */
  const marks: Record<string, string> = {}
  if (typeof input.marks === 'object' && input.marks !== null) {
    let count = 0
    for (const [key, note] of Object.entries(input.marks as Record<string, unknown>)) {
      if (count >= SESSION_VIEW_STATE_ENTRY_CAP) break
      if (key !== '' && key.length <= 300 && typeof note === 'string') { marks[key] = note.slice(0, 120); count += 1 }
    }
  }
  /* 0.0.156（G53）：收藏集合（独立于标注）。**保留"缺失 vs 空数组"的区分**：非数组（旧负载）→ 不输出该
     字段（webview 按旧语义迁移）；空数组是合法新值（明确零收藏），必须原样保留。 */
  let stars: string[] | undefined
  if (Array.isArray(input.stars)) {
    stars = []
    for (const key of input.stars) {
      if (stars.length >= SESSION_VIEW_STATE_ENTRY_CAP) break
      if (typeof key === 'string' && key !== '' && key.length <= 300 && !stars.includes(key)) stars.push(key)
    }
  }
  /* 0.1.9：轨道节点增删覆盖层（键规范同 marks；值 = 隐藏/合并两态）。 */
  const railDropped: Record<string, 'hidden' | 'merged'> = {}
  if (typeof input.railDropped === 'object' && input.railDropped !== null) {
    let count = 0
    for (const [key, value] of Object.entries(input.railDropped as Record<string, unknown>)) {
      if (count >= SESSION_VIEW_STATE_ENTRY_CAP) break
      if (key !== '' && key.length <= 300 && (value === 'hidden' || value === 'merged')) { railDropped[key] = value; count += 1 }
    }
  }
  return {
    scrollTop,
    atBottom: input.atBottom !== false,
    ...(anchorId !== undefined ? { anchorId } : {}),
    ...(anchorOffset !== undefined ? { anchorOffset } : {}),
    ...(anchorIndex !== undefined ? { anchorIndex } : {}),
    ...(anchorSeq !== undefined ? { anchorSeq } : {}),
    ...(railAnchorSeq !== undefined && railAnchorOffset !== undefined ? { railAnchorSeq, railAnchorOffset } : {}),
    ...(typeof input.railViewportManual === 'boolean' ? { railViewportManual: input.railViewportManual } : {}),
    expanded,
    folds,
    blocks,
    marks,
    ...(stars !== undefined ? { stars } : {}),
    ...(Object.keys(railDropped).length > 0 ? { railDropped } : {}),
    at: Date.now(),
  }
}

/* 0.0.125：0.0.122 的"点轨道节点自动展开"曾把展开态写进持久记忆（0.0.123 已改为临时态）——
   升级后遗留的 ws:/ws~: 条目会让对应工作段"永不折起"（用户实测：reload 后也不折）。
   这里做一次性清理（清理后你手动展开的段仍会正常记录）。 */
const WORK_FOLD_MIGRATION_KEY = 'dshWorkFoldMigration'

/* 0.0.167（B4 P1-6）：附件对话框选中的工作区外文件复制上限（与粘贴链的 25MB 单文件上限取齐）。 */
const DOC_COPY_MAX_BYTES = 25_000_000

function migrateWorkFoldEntries(states: Record<string, SessionViewStateRecord>): boolean {
  if (EXT_CONTEXT?.workspaceState.get<number>(WORK_FOLD_MIGRATION_KEY, 0) === 1) return false
  let changed = false
  for (const record of Object.values(states)) {
    for (const key of Object.keys(record.folds)) {
      if (key.startsWith('ws:') || key.startsWith('ws~:')) {
        delete record.folds[key]
        changed = true
      }
    }
  }
  void EXT_CONTEXT?.workspaceState.update(WORK_FOLD_MIGRATION_KEY, 1)
  return changed
}

function loadSessionViewStates(): Record<string, SessionViewStateRecord> {
  if (sharedSessionViewStates !== undefined) return sharedSessionViewStates
  const stored = EXT_CONTEXT?.workspaceState.get<Record<string, unknown>>(SESSION_VIEW_STATE_KEY, {}) ?? {}
  const out: Record<string, SessionViewStateRecord> = {}
  for (const [sessionId, raw] of Object.entries(stored)) {
    if (sessionId === '') continue
    const value = sanitizeSessionViewState(raw)
    if (value !== undefined) {
      const at = (raw as Record<string, unknown>).at
      if (typeof at === 'number' && Number.isFinite(at)) value.at = at
      out[sessionId] = value
    }
  }
  sharedSessionViewStates = out
  const migrated = migrateWorkFoldEntries(out)
  capSessionViewStates(out)
  if (migrated || Object.keys(stored).length !== Object.keys(out).length) writeSessionViewStates()
  return out
}

/* 0.0.88：时间上下文采样间隔（秒）——读取 + 同步写进 dsh web profile 的 time-context 行。 */
function timeContextSettingsNow(): TimeContextSettings {
  return normalizeTimeContextSettings({
    refreshSeconds: vscode.workspace.getConfiguration('deepseekHarness').get('timeContext.refreshSeconds'),
  })
}

/** 把当前设置的秒数同步到 `<DSH_HOME>/profiles/web/cordis.patch.yml` 的 time-context 行
 * （applyTimeContextRefresh：只动那一行）。文件/行缺失或写入失败都静默跳过——下次变更/激活再试。 */
function syncTimeContextRefresh(seconds: number): void {
  try {
    const patchPath = path.join(dshHomeNow(), 'profiles', 'web', 'cordis.patch.yml')
    if (!fs.existsSync(patchPath)) return
    const text = fs.readFileSync(patchPath, 'utf8')
    const result = applyTimeContextRefresh(text, seconds)
    if (result === undefined || !result.changed) return
    fs.writeFileSync(patchPath, result.text, 'utf8')
  } catch {
    /* 同步失败不阻塞 */
  }
}

/* 0.0.73 适配矩阵：读 profile 里的 dsh / 跟踪插件已装版本 → 组装矩阵（读不到显示「—」）。 */
function compatNow(): ReturnType<typeof buildCompatMatrix> {
  const versions = readInstalledVersions(dshHomeNow(), TRACKED_PLUGINS)
  return buildCompatMatrix(versions.dsh, versions.plugins)
}

/* 0.0.75（G11）：自动检查频率（写入经 set-config 白名单；读取即用）。 */
function updateCheckFrequencyNow(): UpdateCheckFrequency {
  return normalizeUpdateCheckFrequency(vscode.workspace.getConfiguration('deepseekHarness').get('updateCheckFrequency'))
}

function environmentSettingsNow(): EnvironmentSettings {
  const cfg = vscode.workspace.getConfiguration('deepseekHarness')
  return normalizeEnvironmentSettings({
    executable: cfg.get('executable'),
    arguments: cfg.get('arguments'),
    autoStart: cfg.get('autoStart'),
    reuseExistingRuntime: cfg.get('reuseExistingRuntime'),
    startupTimeout: cfg.get('startupTimeout'),
    autonomousDebugging: cfg.get('autonomousDebugging'),
    compat: compatNow(),
  })
}

/* G6 v1（0.0.62）：设置台写通道白名单（0.0.95 起定义在 view-settings.ts，便于单测）。 */

function includeContextNow(): boolean {
  return EXT_CONTEXT?.globalState.get<boolean>('dshIncludeContext', true) !== false
}

/* 0.0.146（用户）：本扩展版本号（initialState 在 activate 早期调用，EXT_CONTEXT 可能尚未赋值 → 双回退）。 */
function extensionVersionNow(): string {
  return EXT_CONTEXT?.extension?.packageJSON?.version
    ?? vscode.extensions.getExtension('lixxx1.dsh-sidebar')?.packageJSON?.version
    ?? ''
}

function initialState(cwd: string): ChatViewState {
  return {
    phase: 'loading',
    statusText: '正在启动 DeepSeek Harness 运行时…',
    extensionVersion: extensionVersionNow(),
    workspaceName: path.basename(cwd),
    cwd,
    sessions: [],
    recycle: [],
    recycleOthers: 0,
    sessionId: '',
    messages: [],
    segmentStops: [],
    turnOutline: [],
    running: false,
    routable: true,
    busyEnter: 'queue',
    models: [],
    approval: null,
    question: null,
    commands: [],
    skills: [],
    agentPreset: unavailableAgentPresetState(),
    usage: unavailableUsageMeterState(),
    context: unavailableContextPanelState(),
    imageLimits: undefined,
    permissions: [],
    plan: planModeStateOf(undefined),
    changedFiles: [],
    queue: [],
    jobs: [],
    animationStyle: animationStyleNow(),
    markdownImages: markdownImagesNow(),
    copySettings: copySettingsNow(),
    searchSettings: searchSettingsNow(),
    turnRailSettings: turnRailSettingsNow(),
    foldSettings: foldSettingsNow(),
    imageCopyFormat: imageCopyFormatNow(),
    previewSettings: previewSettingsNow(),
    attachSettings: attachSettingsNow(),
    sessionHistorySettings: sessionHistorySettingsNow(),
    imageStoreSettings: imageStoreSettingsNow(),
    sessionSettings: sessionSettingsNow(),
    sessionViewMemory: sessionViewMemoryNow(),
    timeContextSettings: timeContextSettingsNow(),
    environmentSettings: environmentSettingsNow(),
    uiSettings: uiSettingsNow(),
    updateCheckFrequency: updateCheckFrequencyNow(),
    rewindAvailable: false,
    includeContext: includeContextNow(),
    hasMoreHistory: false,
    loadingHistory: false,
  }
}

function titleOf(summary: SessionSummary): string {
  /* 0.0.88：本地持久化标题（重命名权威 / 已学到过）优先于投影——冷会话（重启后）投影为空，
     旧逻辑在此回退成 'New conversation'，打开过才会刷新（用户实测）。 */
  return resolveSessionTitle(summary.projections?.values?.title, extSessionTitles()[summary.sessionId])
}

class DshChatController implements vscode.Disposable {
  private readonly changes = new vscode.EventEmitter<ChatViewState>()
  private readonly projector = new ConversationProjector()
  /** G5 消息级元信息打点草稿（assistant id → 用时/首 token/tok/s；活跃会话，切换即清）。 */
  /* G5 turn 打点（纯状态机，单测见 tests/turn-meta.spec.ts） */
  private readonly turnMeta = new TurnMetaTracker()
  /** G5 会话创建时间（协议不下发 createdAt；进程内 + globalState 持久化，tab tooltip 用）。 */
  private readonly sessionCreatedAt = new Map<string, number>()
  /** G5 v4 tok/s 记忆（sessionId → assistant id → tokS；实时差分产出，恢复路径补回，globalState 持久化）。 */
  private readonly sessionTokS: TurnTokSMemory = new Map()
  private client: DshClient | undefined
  private clientDisposables: Array<() => void> = []
  private summaries: SessionSummary[] = []
  /* 0.1.89（用户需求）：同工作区的**子代理会话**（origin=subagent，如委派审查/提问官）——
     不进侧栏标签（维持既有设计），但搜索要能覆盖：命中单独标注「子代理」且可跳转打开。 */
  private subagentSessions = new Map<string, SessionSummary>()
  /* 0.0.85 精准计费：逐事件账本（按事件时刻分段计价；历史重放幂等）。 */
  private usageLedger = new UsageLedger()
  /* 0.0.70：会话历史尾页下发的投影基线（sessionId → values）。冷会话在 session.list
     行里没有投影块 → 切到它时用量统计行/圆环/上下文面板会概率性整体缺失；基线在此缓存，
     并在会话加载与列表重建两处回填进摘要。 */
  private readonly projectionBaselines = new Map<string, ProjectionBlock>()
  /* 0.0.76：turn-rewind 可用性（客户端连接后探测一次；驱动消息菜单显隐）。 */
  private rewindAvailable = false
  private sessionOps: Promise<void> = Promise.resolve()
  private readonly recycleBin = new SessionRecycleBin(dshHomeNow())
  /* 0.0.147：本项目 workspace 目录集合缓存（回收站兜底分类；见 currentWorkspaceDirs）。 */
  private workspaceDirsCache: Set<string> | undefined
  private _state: ChatViewState
  private generation = 0
  private readonly guardedDirtyCalls = new Set<string>()
  private queueRawText = new Map<string, string>()
  private readonly attachmentResults = new Map<string, Pick<ConversationImage, 'data' | 'error'>>()
  private readonly attachmentLoads = new Map<string, { task: Promise<void>; abort: AbortController }>()
  private readonly jobsBySession = new Map<string, JobItem[]>()
  private historyEntries: HistoryEntry[] = []
  private historyLoad: { sessionId: string; generation: number; task: Promise<void> } | undefined
  private sessionHistoryLoad: { sessionId: string; task: Promise<void> } | undefined
  private historyWindowGeneration = 0
  private historyNavigationGeneration = 0
  /* 0.0.154（O3）：每会话历史窗口缓存（LRU 4）——切走再切回直接恢复原窗口 + catch-up 合并，
     不再重置为尾页（用户实测痛点：滚到顶切走切回卡中间、按钮重现）。 */
  private readonly historyBySession = new Map<string, { entries: HistoryEntry[]; hasMore: boolean }>()

  /** 0.0.154：单次历史拉取条数——loadAll 开＝设置上限（默认 3000，"打开即全量"）；关＝旧行为 100。 */
  private historyPullLimit(): number {
    const settings = sessionHistorySettingsNow()
    return settings.loadAll ? settings.maxMessages : 100
  }

  /** 0.0.154：把当前窗口记入会话缓存（loadSession/loadOlderHistory/acceptFrame 三处调用）。
      2026-10-06（滚顶案根治）：**hasMore 改为必传显式值**——旧实现读 `this._state.hasMoreHistory`，
      而 loadSession/loadOlderHistory 都在"发布新值**之前**"调用本方法 ⇒ 缓存被写入**陈旧值**
      （加载开头 publish 的 false / 加载前的旧值）⇒ 之后"切走切回"走缓存命中 catch-up 时
      `mergedWindowHasMore` 取缓存值误判 hasMore=false（按钮消失 + 滚轮预取 + 节点穿透三路死，
      直到 Reload 清缓存）；反向亦然（到底后缓存留 true → 空转加载）。必传值从签名层面根除该误读。 */
  private rememberHistoryWindow(sessionId: string, hasMore: boolean): void {
    if (sessionId === '') return
    this.historyBySession.delete(sessionId)
    this.historyBySession.set(sessionId, { entries: this.historyEntries, hasMore })
    while (this.historyBySession.size > HISTORY_WINDOW_CACHE_CAP) {
      const oldest = this.historyBySession.keys().next().value
      if (oldest === undefined) break
      this.historyBySession.delete(oldest)
    }
  }

  /** G22 bug⑥: 有未发送草稿（文本/图片/文件卡）的会话集——blank 会话筛选时不隐藏。 */
  private draftfulSessions: ReadonlySet<string> = new Set()
  /** G22 bug⑥a: 用户打开过的会话集（含没有任何草稿的空对话）——同样不因列表刷新而隐藏。 */
  private readonly visitedSessions = extVisitedSessions()
  /** G5 v9: 持久化会话顺序（workspaceState `dshSessionOrder`）——'persisted' 模式按此渲染，reload/重启不变。 */
  private sessionOrder: string[] = []

  readonly onDidChangeState = this.changes.event

  /** G22 bug⑥: webview 切会话上报草稿会话集时更新（含 DshSurface 侧文件卡快照已在上报端合并）。 */
  setDraftfulSessions(sessionIds: ReadonlySet<string>): void {
    this.draftfulSessions = sessionIds
  }

  /** G22 bug⑥a: 记录用户打开过的会话；超上限淘汰最旧的。 */
  private rememberVisited(sessionId: string): void {
    if (this.visitedSessions.has(sessionId)) return
    while (this.visitedSessions.size >= VISITED_SESSION_CAP) {
      const oldest = this.visitedSessions.keys().next()
      if (oldest.done) break
      this.visitedSessions.delete(oldest.value)
    }
    this.visitedSessions.add(sessionId)
    commitVisitedSessions(this.visitedSessions)
  }

  constructor(
    private readonly runtime: DshRuntime,
    private readonly output: vscode.OutputChannel,
    private readonly dirtyFiles: DirtyFileGuard,
    private readonly diffReviews: DiffReviewManager,
    private _cwd: string,
  ) {
    this._state = initialState(_cwd)
  }

  get cwd(): string {
    return this._cwd
  }

  get state(): ChatViewState {
    return this._state
  }

  get runtimeGeneration(): number { return this.generation }

  private readonly modelSelections = new Map<string, ModelSelection>()

  modelConnections(): ModelConnections {
    const client = this.requireClient(), generation = this.generation
    return new ModelConnections(client, () => this.client === client && this.generation === generation)
  }

  refreshModels(): Promise<void> {
    return this._state.sessionId === '' ? Promise.resolve() : this.loadModels(this._state.sessionId)
  }

  modelConnectionRemoved(provider: string): void {
    const models = this._state.models.filter(model => model.provider !== provider)
    this.publish({ models, routable: this._state.routable && models.some(model => model.selected) })
  }

  /* 0.0.162（全产品审查 P0-3）：消息**全文**——「复制该消息」用。发给 webview 的状态经瘦身
     （超长助手正文 text 置空 + deferredBody），复制必须回投影器取全文。 */
  fullMessageText(id: string): string | undefined {
    const found = this.projector.messages().find(message => message.id === id)
    return found === undefined ? undefined : found.text
  }

  get runtimeOwnership(): RuntimeOwnership | undefined {
    const state = this.runtime.state
    return state.kind === 'ready' ? state.ownership : undefined
  }

  /** G49 v2（0.0.121）：轨道跳转穿透完成 → 通知端侧按 seq 定位滚动（由提供方接 webview）。 */
  onTurnJumpReady: ((seq: number, loaded: boolean, reason: 'error' | undefined, status: { requestId: number; pages: number; maxPages: number; canContinue: boolean }) => void) | undefined
  onTurnJumpProgress: ((seq: number, requestId: number, pages: number, maxPages: number) => void) | undefined
  /* 0.1.124（数据层根治）：Reload 恢复的穿透加载完成 → 端侧重定位锚点（与轨道跳转分道，互不触发）。 */
  onRestoreThroughReady: ((seq: number, loaded: boolean, reason?: 'error') => void) | undefined
  onRestoreThroughProgress: ((seq: number, pages: number, maxPages: number) => void) | undefined
  /* 0.1.23：本地图片链接 → 侧栏预览（图片以 data URL 交给 webview 的既有预览通道）。 */
  onPreviewLocalImage: ((name: string, mediaType: string, dataUrl: string) => void) | undefined

  /* 0.0.160（N1）：任务通知——判据见 notify.ts。视图可见性由 provider 注入（resolveWebviewView 时）。 */
  isViewVisible: () => boolean = () => false
  /* 0.1.89（用户报①）：回合结束通知（视图层据此就地刷新本会话索引）。 */
  onTurnEnded: ((sessionId: string) => void) | undefined
  /* 2026-10-06（W9）：会话列表**首次加载完成**信号（视图层据此补触发搜索索引构建——
     'ready' 早于首载的竞态曾使冷启动工作区索引从未建成）。 */
  onInitialSessionsLoaded: (() => void) | undefined
  /* 0.1.124（数据层根治）：会话打开信号——表层据此下发当前会话的「轨道节点表」（缓存/落盘即发，
     缺表按需补算后补发）。全量表 ⇒ 轨道清单一集恒定，编号不随加载/Reload 漂移。 */
  onSessionOpened: ((sessionId: string) => void) | undefined
  private lastActionNotifyKey: string | undefined
  /* 0.1.16：完成通知的"持续停止"确认器（turn 边界的短暂翻假不误报）。 */
  private readonly completionConfirmer = new CompletionConfirmer()
  private readonly lastRunningBySession = new Map<string, boolean>()
  /* 2026-10-05（D：连接风暴期的"已完成"通知风暴——10:57–10:59 两分钟弹 8 次，window9 日志实证）：
     完成边只认**可信来源**（活体 session-status 帧 / turn/end / agent-error）；重连 resync 从
     session.list 读到的 running=false 只修 UI 显示，不进完成判定（风暴中它每轮换代、真假交替）。 */
  private readonly trustedRunningBySession = new Map<string, boolean>()
  /* 2026-10-05（A：真机事故"提交落进死窗口被网关丢弃"）：连接类失败时暂存提交意图，
     随"同一提问重放"自动重投（重放后的 rpcId 必对应新的活流）。null answers = 跳过意图。 */
  private parkedSubmission: {
    key: string
    answers: readonly QuestionAnswer[] | null
    atMs: number
    lastAttemptMs: number
    inFlight: boolean
  } | null = null
  private parkedAnnouncedKey: string | null = null
  /* 2026-10-05（A 同族修复）：本提问用过的全部 rpcId（重放每轮换代）——question/resolved
     按别名集匹配（旧实现只认当前 rpcId，换代后服务端撤销通知匹配不上、卡片赖着不清）。 */
  private questionRpcIds = new Set<string>()

  publish(patch: Partial<ChatViewState>): void {
    this._state = { ...this._state, ...patch }
    this.changes.fire(this._state)
    /* 0.0.160（N1）：等待/完成通知的统一判定点——所有状态路径都经 publish。
       2026-09-22 事故：通知是**旁路**，它抛异常曾直接杀死 WebSocket 事件流（同批帧全丢 +
       僵尸连接）。此调用点必须隔离：状态更新已经 fire 出去了，通知失败只记日志。 */
    try {
      this.syncTaskNotifications()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.output.appendLine(`[notify] 通知判定失败（已隔离，不影响会话链路）：${message}`)
    }
  }

  /* N1 判据②③④：等待去重（同一 approvalId/问题内容只提醒一次）+ 完成边（只有"曾观测运行中
     → 停下"才算——启动快照/首见即停不报，Reload 不补弹"完成"）+ 等级与可见性过滤。 */
  private syncTaskNotifications(): void {
    const level: NotifyLevel = this._state.uiSettings === undefined ? DEFAULT_NOTIFY_LEVEL : this._state.uiSettings.notifyLevel
    const style: NotifyStyle = this._state.uiSettings === undefined ? DEFAULT_NOTIFY_STYLE : this._state.uiSettings.notifyStyle
    /* 等待（审批优先于提问；同一等待不重复提醒）。 */
    const key = actionKeyOf(this._state.approval, this._state.question)
    if (key !== undefined && key !== this.lastActionNotifyKey) {
      this.lastActionNotifyKey = key
      const session = this._state.sessions.find(item => item.id === this._state.sessionId)
      const title = session === undefined || session.title === '' ? '当前会话' : session.title
      const approval = this._state.approval
      const question = this._state.question
      const text = approval !== null
        ? approvalNotifyText(title, approval.toolName)
        : question === null ? undefined : questionNotifyText(title, question.questions[0]?.question)
      if (text !== undefined && shouldNotify('action', level, this.notifyVisibility())) this.notifyUser(text, style)
    }
    /* 完成边（含后台会话；已不在列表的条目剔除，防 id 复用误报）。
       2026-10-05（D）：完成边只认**可信来源**——`trustedRunningBySession` 仅由活体帧写入
       （session-status / turn/end / agent-error）；重连 resync 从 session.list 读到的
       running=false 只修 UI 显示、不进本判定（真机实证：风暴期它每轮换代、真假交替，
       2 分钟弹 8 次「已完成」）。 */
    const present = new Set(this._state.sessions.map(item => item.id))
    for (const id of [...this.lastRunningBySession.keys()]) if (!present.has(id)) this.lastRunningBySession.delete(id)
    for (const id of [...this.trustedRunningBySession.keys()]) if (!present.has(id)) this.trustedRunningBySession.delete(id)
    for (const session of this._state.sessions) {
      const trusted = this.trustedRunningBySession.get(session.id)
      const previous = this.lastRunningBySession.get(session.id)
      this.lastRunningBySession.set(session.id, trusted === true)
      if (trusted === undefined || trusted === true) { if (trusted === true) this.completionConfirmer.cancel(session.id); continue }
      /* 0.1.16（用户实测"浏览别的软件时老是弹'已停止'，其实还在跑"）：翻假先登记，**持续停止 ≥ 4s**
         才在复核时刻通知；期间回到运行中即撤销（多轮连跑/排队续跑在 turn 边界的短暂翻假不再误报）。 */
      /* 0.1.113（真机实测"实际未停止却弹'已停止运行'"，近两日各复现多次）：runtime 在**等待用户
         回答提问/审批**期间会把 running 降为 false（日志实证：11:10 提问 → 11:12 running=false →
         11:16 用户作答 → running=true），而 agent 并未停止 ⇒ 逐次弹「已停止运行，可回来查看」是误报。
         判据抽成 completionCandidate（tests/notify.spec.ts 锁死）：等待期间不登记完成边。 */
      const waitingAction = session.id === this._state.sessionId && (this._state.question !== null || this._state.approval !== null)
      if (!completionCandidate(previous, trusted, waitingAction)) continue
      if (!shouldNotify('complete', level, this.notifyVisibility())) continue
      const sessionId = session.id
      if (this.completionConfirmer.observe(sessionId, false, Date.now()) !== 'started') continue
      /* 2026-09-22 事故：此处曾写 window.setTimeout——宿主是 Node，无 window →
         ReferenceError 从 publish 冒穿 WebSocket 'message' 处理器，同批帧全丢、连接僵尸化。
         宿主侧一律用裸 setTimeout。 */
      setTimeout(() => {
        const current = this._state.sessions.find(item => item.id === sessionId)
        if (current === undefined) { this.completionConfirmer.cancel(sessionId); return }
        /* 复核读的是**可信值**：窗口内有活体 true（session-status）即撤销（见 D 注释）。 */
        if (!this.completionConfirmer.confirm(sessionId, this.trustedRunningBySession.get(sessionId) === true, Date.now())) return
        const levelNow: NotifyLevel = this._state.uiSettings === undefined ? DEFAULT_NOTIFY_LEVEL : this._state.uiSettings.notifyLevel
        const styleNow: NotifyStyle = this._state.uiSettings === undefined ? DEFAULT_NOTIFY_STYLE : this._state.uiSettings.notifyStyle
        if (!shouldNotify('complete', levelNow, this.notifyVisibility())) return
        /* 0.1.113：通知触发留痕（时间 + 会话 + 当时是否在等待提问/审批）——用户再报"莫名已停止"时，
           把弹窗时间与这行日志对照即可判定真伪。 */
        this.output.appendLine(`[notify] complete 「${current.title}」 waiting=${String(this._state.question !== null || this._state.approval !== null)}`)
        this.notifyUser(completeNotifyText(current.title === '' ? '会话' : current.title), styleNow)
      }, COMPLETION_CONFIRM_MS + 100)
    }
  }

  private notifyVisibility(): { focused: boolean; viewVisible: boolean } {
    return { focused: vscode.window.state.focused, viewVisible: this.isViewVisible() }
  }

  /* 判据①：点击「查看」→ 聚焦侧栏容器（系统通知本体由 VS Code 呈现；点击 toast 前置窗口）。
     0.1.7：系统档且窗口在前台 → 改走 Windows Toast（点击弹窗经 vscode:// 路由回侧栏）。 */
  private notifyUser(text: string, style: NotifyStyle): void {
    if (notifyChannel(style, this.notifyVisibility()) === 'toast') {
      showWindowsToast(text)
      return
    }
    void vscode.window.showInformationMessage(text, '查看').then(choice => {
      if (choice === undefined) return
      void vscode.commands.executeCommand('workbench.view.extension.deepseekHarness')
    }, () => { /* 通知失败静默（不影响主链路） */ })
  }

  /** 0.0.58: 原图 manifest 异步加载完成后补一次重绘——让已显示的图从归一化副本切到原图。 */
  refreshImageOrigins(): void {
    if (this._state.sessionId === '') return
    this.bumpAttachmentGeneration()   /* S3：原图留档加载完成 → 含图消息视图缓存失效 */
    this.publish(this.messagesPatch())
  }

  observeRuntime(state: RuntimeState): void {
    if (state.kind === 'starting') this.publish({ phase: 'loading', statusText: state.detail })
    if (state.kind === 'failed') this.publish({ phase: 'error', statusText: state.message })
    if (state.kind === 'stopped' && this._state.phase === 'ready') {
      this.publish({ phase: 'error', statusText: 'DeepSeek Harness 已停止。' })
    }
  }

  /* 0.0.56c（复测 ③ 续）: 最近一次"已受理但尚未被运行时确认入历史"的发送。
     运行时事件实证：发送后立刻 stop，排在队列里的消息会被 spliced(removedCount) 直接丢弃 →
     从未产生 user/message → 侧栏什么都没有，而草稿已被乐观清空 = 静默丢失。cancel 时用它还原。 */
  private pendingSend: {
    sessionId: string
    text: string
    images: Array<PromptImage & { id: string; originData?: string; originName?: string }>
    /** 0.0.58: 发送时刻已投影的用户消息 id——绑定原图/结算只能认"新出现的"消息，防同名旧消息误吸附。 */
    knownMessageIds: ReadonlySet<string>
    /** 0.0.59: 本次 prompt 的 rpcId——stop 时对照运行时队列，仍在队列则**不**还原草稿。 */
    rpcId?: string
  } | undefined

  /** 0.0.58: 显示层原图加载中的去重闸（防同一张图触发多次异步读盘 → 多次重绘）。 */
  private readonly originLoads = new Map<string, object>()
  /* 原图存储的 24 项 LRU 是读盘缓存；已显示的当前/上一会话原图随会话附件释放，
     不应因全局 LRU 逐出而降级成归一化副本，或在每次重绘中循环读盘。 */
  private readonly originDisplays = new Map<string, { data: string; mediaType: ImageMediaType }>()

  rememberPendingSend(entry: { sessionId: string; text: string; images: Array<PromptImage & { id: string; originData?: string; originName?: string }>; rpcId?: string }): void {
    const knownMessageIds = new Set(
      this.projector.messages().filter(message => message.role === 'user').map(message => message.id),
    )
    this.pendingSend = { ...entry, knownMessageIds }
  }

  /** 0.0.59: stop 后该消息是否仍在运行时队列中（在 → 不还原：运行时尚未消费它，下一回合会发送；
     还原会造成"队列 + 草稿"双份。仅"已被消费却未入历史"（真正的丢失场景）才还回输入框）。 */
  pendingStillQueued(rpcId: string | undefined): boolean {
    if (rpcId === undefined || rpcId === '') return false
    return this._state.queue.some(item => item.rpcId === rpcId)
  }

  /** 消息一旦被投影出来（运行时已受理入历史）→ 清除待还原记录，并绑定原图留档（0.0.58）。 */
  private settlePendingSend(messages: readonly ConversationMessage[]): void {
    const pending = this.pendingSend
    if (pending === undefined || pending.sessionId !== this._state.sessionId) return
    const matching = messages.filter(message => message.role === 'user'
      && (pending.text !== '' ? (message.text || '') === pending.text : (message.images?.length ?? 0) > 0))
    const admitted = matching[matching.length - 1]
    if (admitted === undefined) return
    this.pendingSend = undefined
    /* 结算与绑定解耦：怀疑该消息在记录前就已投影（已知 id，异步竞态）→ 只结算、不绑定
       （防错绑；宁缺勿错），绑定失败时显示层/复制回退归一化副本（现状）。 */
    if (pending.knownMessageIds.has(admitted.id)) return
    const bound = bindSentOrigins(pending.images, admitted.images ?? [])
    if (bound === undefined || ORIGIN_STORE === undefined) return
    for (const item of bound) ORIGIN_STORE.remember(pending.sessionId, item.attachmentId, item.entry)
    this.bumpAttachmentGeneration()   /* S3：原图绑定落档 → 含图消息视图缓存失效 */
  }

  /** cancel 后取走待还原记录（仅当属于给定会话；总是清除，避免陈旧记录再被用）。 */
  takePendingSend(sessionId: string): { text: string; images: Array<PromptImage & { id: string }>; rpcId?: string } | undefined {
    const pending = this.pendingSend
    this.pendingSend = undefined
    if (pending === undefined || pending.sessionId !== sessionId) return undefined
    return {
      text: pending.text,
      images: pending.images,
      ...(pending.rpcId === undefined ? {} : { rpcId: pending.rpcId }),
    }
  }

  /** 0.0.56（审核 P1）: 按会话淘汰图片 base64 缓存（只保留传入的会话），防长会话无界增长。 */
  evictAttachmentResults(keep: ReadonlySet<string>): void {
    for (const cache of [this.originDisplays, this.originLoads]) {
      for (const key of cache.keys()) if (!keep.has(key.slice(0, key.indexOf('\u0000')))) cache.delete(key)
    }
    for (const key of [...this.attachmentResults.keys()]) {
      const separator = key.indexOf('\u0000')
      const sessionId = separator < 0 ? '' : key.slice(0, separator)
      if (!keep.has(sessionId)) this.attachmentResults.delete(key)
    }
    for (const [key, load] of this.attachmentLoads) {
      if (keep.has(key.slice(0, key.indexOf('\u0000')))) continue
      this.attachmentLoads.delete(key)
      load.abort.abort()
    }
  }

  private releaseSessionCaches(sessionId: string): void {
    if (this._state.sessionId === sessionId) {
      this.historyWindowGeneration += 1
      this.historyNavigationGeneration += 1
      this.historyEntries = []
      this.historyLoad = undefined
      this.sessionHistoryLoad = undefined
    }
    this.historyBySession.delete(sessionId)
    this.jobsBySession.delete(sessionId)
    this.runningStatusRevisions.delete(sessionId)
    this.projectionBaselines.delete(sessionId)
    this.modelSelections.delete(sessionId)
    for (const cache of [this.originDisplays, this.originLoads]) {
      for (const key of cache.keys()) if (key.startsWith(`${sessionId}\u0000`)) cache.delete(key)
    }
    for (const key of this.attachmentResults.keys()) if (key.startsWith(`${sessionId}\u0000`)) this.attachmentResults.delete(key)
    for (const [key, load] of this.attachmentLoads) if (key.startsWith(`${sessionId}\u0000`)) {
      this.attachmentLoads.delete(key)
      load.abort.abort()
    }
    this.diffReviews.releaseSession(sessionId)
    this.client?.forgetSession(sessionId)
  }

  private purgeSessionMetadata(sessionId: string): void {
    forgetSessionViewState(sessionId)
    this.releaseSessionCaches(sessionId)
    this.diffReviews.purgeSession(sessionId)
    draftStoreNow().remove(sessionId)
    ORIGIN_STORE?.purgeSession(sessionId)
    this.sessionCreatedAt.delete(sessionId)
    this.sessionTokS.delete(sessionId)
    // Activation can expire the bin before start() hydrates these maps. Remove
    // only this ID from durable state, preserving sessions not loaded in memory.
    for (const key of ['dshSessionCreatedAt', 'dshSessionTokS']) {
      const saved = EXT_CONTEXT?.globalState.get<Record<string, unknown>>(key)
      if (saved === undefined || saved === null || typeof saved !== 'object' || !Object.hasOwn(saved, sessionId)) continue
      const next = { ...saved }
      delete next[sessionId]
      void EXT_CONTEXT?.globalState.update(key, next)
    }
  }

  async start(): Promise<void> {
    const generation = ++this.generation
    this.disconnectClient()
    this.projector.reset([])
    this.usageLedger = new UsageLedger()
    this.resetTurnMeta()
    this.diffReviews.clear()
    this.guardedDirtyCalls.clear()
    this.queueRawText.clear()
    this.attachmentResults.clear()
    this.attachmentLoads.clear()
    this.jobsBySession.clear()
    this.historyEntries = []
    this.historyWindowGeneration += 1
    this.sessionHistoryLoad = undefined
    this.historyLoad = undefined
    /* 2026-10-05（A）：启动=全新上下文——提问别名集与暂存提交一并作废。 */
    this.questionRpcIds.clear()
    this.clearParkedSubmission()
    const savedCreatedAt = await EXT_CONTEXT?.globalState.get<Record<string, number>>('dshSessionCreatedAt')
    this.sessionCreatedAt.clear()
    if (savedCreatedAt !== undefined) {
      for (const [sessionId, ms] of Object.entries(savedCreatedAt)) {
        if (typeof ms === 'number' && Number.isFinite(ms)) this.sessionCreatedAt.set(sessionId, ms)
      }
    }
    // G5 v4: tokS 持久记忆加载（切会话/重启后恢复 tok/s；实时差分产出见 projectedMessages）
    this.sessionTokS.clear()
    for (const [sessionId, per] of memoryFromPlain(await EXT_CONTEXT?.globalState.get('dshSessionTokS'))) {
      this.sessionTokS.set(sessionId, per)
    }
    // G5 v9: 持久化会话顺序加载——reload/重启后拖拽自定义顺序保持不变
    const savedOrder = await EXT_CONTEXT?.workspaceState.get<string[]>('dshSessionOrder')
    this.sessionOrder = Array.isArray(savedOrder) ? savedOrder.filter(id => typeof id === 'string') : []
    this.publish({
      phase: 'loading',
      statusText: '正在启动 DeepSeek Harness 运行时…',
      messages: [],
      segmentStops: [],
      turnOutline: [],
      sessions: [],
      sessionId: '',
      running: false,
      models: [],
      approval: null,
      question: null,
      commands: [],
      skills: [],
      agentPreset: unavailableAgentPresetState(),
      usage: unavailableUsageMeterState(),
      context: unavailableContextPanelState(),
      permissions: [],
      plan: planModeStateOf(undefined),
      changedFiles: [],
      queue: [],
      jobs: [],
      hasMoreHistory: false,
      loadingHistory: false,
    })
    try {
      const uri = await this.runtime.start(this.cwd === '' ? undefined : vscode.Uri.file(this.cwd))
      if (generation !== this.generation) return
      const client = new DshClient(new URL(uri.toString(true)))
      this.client = client
      void this.probeRewindAvailability(client)
      this.clientDisposables.push(
        client.onFrame(frame => {
          const type = frame.payload.type
          if (typeof type === 'string' && (type.startsWith('approval/') || type.startsWith('question/'))) {
            this.output.appendLine(`[protocol] ${type} for ${String(frame.payload.sessionId ?? 'unknown session')}`)
          }
          this.acceptFrame(frame)
        }),
        client.onError(error => {
          this.output.appendLine(`[protocol] ${error.message}`)
          this.publish({ phase: 'error', statusText: `Lost the DSH event stream: ${error.message}` })
        }),
        /* 0.1.20：已被隔离的帧处理异常 / 看门狗判死——只记日志，不置 phase=error（链路仍在工作，
           置错误态会锁住发送）。2026-10-05（B）：socket closed 码/看门狗判死同时落 conn-log。 */
        client.onFrameError(message => {
          connLog(this.output, `[protocol] ${message}`)
        }),
        /* 2026-10-05（B）：连接生命周期取证（$events ready 的 clientId 换代等）。 */
        client.onDiag(message => {
          connLog(this.output, message)
        }),
      )
      /* 0.0.88：启动/重启/切项目后优先回到本项目上次的会话（仍存在时；否则回退旧选中逻辑）。 */
      await this.loadSessions(extActiveSession(this.cwd) || undefined)
      if (generation !== this.generation || this.client !== client) return
      client.startStreams()
      /* 2026-10-06（W9）：会话列表**首载完成**信号——'ready' 时的 ensureSearchIndex 会因"列表尚未
         首载"空转（冷启动竞态，曾使该工作区索引从未建过）；由 ViewProvider 接此信号错峰补触发。 */
      this.onInitialSessionsLoaded?.()
    } catch (error) {
      if (generation !== this.generation) return
      const message = error instanceof Error ? error.message : String(error)
      this.output.appendLine(`[chat] ${message}`)
      this.publish({ phase: 'error', statusText: message })
    }
  }

  async restart(): Promise<void> {
    ++this.generation
    this.disconnectClient()
    await this.runtime.stop()
    await this.start()
  }

  async switchWorkspace(cwd: string): Promise<void> {
    if (cwd === '' || cwd === this.cwd) return
    if (this._state.running) throw new Error('请等待当前 DeepSeek 任务结束再切换项目。')
    /* 0.1.110（审查中危3）：切换项目要**同步通知索引 store**——否则在途的索引构建会继续以旧 client
       拉旧工作区消息、写进（已切到新工作区的）store 并落盘到新工作区的文件（跨区污染，靠下次 prune 自愈）。
       useWorkspace 自带代际守卫（并发/过期加载丢弃），这里 fire-and-forget 即可。 */
    void searchIndexNow().useWorkspace(cwd).catch(() => { /* 尽力而为 */ })
    this._cwd = cwd
    this.summaries = []
    this.projector.reset([])
    this.usageLedger = new UsageLedger()
    this.resetTurnMeta()
    this.historyEntries = []
    this.guardedDirtyCalls.clear()
    this.publish({
      ...initialState(cwd),
      statusText: '正在将 DeepSeek Harness 切换到该项目…',
    })
    await this.restart()
  }

  newSession(): Promise<void> {
    // B-report P0 (0.0.33): 纳入串行队列——与 trash/restore/select 互斥，
    // 修"新建 RPC 在途时点 tab 意图被丢弃"的静默失效。
    return this.runSessionOp(async () => {
      const client = this.requireClient()
      const oldCurrent = this._state.sessionId
      const created = await client.createSession(this.cwd)
      this.rememberSessionCreatedAt(created.sessionId)
      await this.loadSessions(created.sessionId)
      this.settleSessionOrder(created.sessionId, oldCurrent)
    })
  }

  /** G27 round2 (0.0.48): 对话分叉（轻量分支）——复用 newSession 建会话，命名 `原名 vN`
   * （Copilot "Forked:" 前缀同义），返回新会话 id；DshSurface 侧回执 fork-created 供
   * webview 预填分支点消息文本。协议无 branch RPC（G5 调研），此为最近似"从该消息重来/
   * 模板复用"的形态，不碰文件系统。 */
  async forkSession(): Promise<string | undefined> {
    return this.runSessionOp(async () => {
      const client = this.requireClient()
      const oldCurrent = this._state.sessionId
      const created = await client.createSession(this.cwd)
      this.rememberSessionCreatedAt(created.sessionId)
      await this.loadSessions(created.sessionId)
      this.settleSessionOrder(created.sessionId, oldCurrent)
      const titles = extSessionTitles()
      const base = String(titles[oldCurrent] || '').trim()
      if (base !== '') {
        let n = 2
        while (Object.values(titles).includes(base + ' v' + n)) n += 1
        titles[created.sessionId] = base + ' v' + n
        void EXT_CONTEXT?.workspaceState.update('dshSessionTitles', titles)
      }
      return created.sessionId
    })
  }

  /** G24: 重排新增（新建/恢复）会话的 tab 到旧当前会话右侧；无变化时跳过 publish。
   *  G5 v9: 结果同步写入持久化顺序（reload/重启后保持）。 */
  private settleSessionOrder(addedId: string, oldCurrent: string): void {
    const reordered = insertSessionAfter(this._state.sessions, addedId, oldCurrent)
    if (reordered !== this._state.sessions) {
      this.publish({ sessions: reordered })
      this.mergeSessionOrder(reordered)
    }
  }

  /** G5 v9: 拖拽排序——`sessionId` 移到 `beforeId` 之前（缺省=末尾）；与 trash/restore/select
   *  同串行队列，防并发操作时序竞态。结果发布 + 写入持久化顺序。 */
  reorderSessions(sessionId: string, beforeId?: string): Promise<void> {
    return this.runSessionOp(async () => {
      const reordered = moveSessionBefore(this._state.sessions, sessionId, beforeId)
      if (reordered !== this._state.sessions) {
        this.publish({ sessions: reordered })
        this.mergeSessionOrder(reordered)
      }
    })
  }

  /** G5 v9: 排序开关（'persisted'=按本地持久化顺序 | 'activity'=回退服务端最后活动顺序；G6 设置台入口）。 */
  private sessionSortMode(): 'persisted' | 'activity' {
    return vscode.workspace.getConfiguration('deepseekHarness').get<'persisted' | 'activity'>('sessionSortMode', 'persisted')
  }

  private persistSessionOrder(): void {
    void EXT_CONTEXT?.workspaceState.update('dshSessionOrder', this.sessionOrder)
  }

  /** G5 v9: 把当前可见会话的新顺序合并进持久化顺序——本 cwd 的 id 按新顺序整体前置，
   *  其余 id（其他工作区会话）保持原相对顺序，避免跨 cwd 互相清掉。 */
  private mergeSessionOrder(ordered: readonly SessionItem[]): void {
    const present = new Set(ordered.map(item => item.id))
    this.sessionOrder = [
      ...ordered.map(item => item.id),
      ...this.sessionOrder.filter(id => !present.has(id)),
    ]
    this.persistSessionOrder()
  }

  /** G5 v9: 'persisted' 模式把可见列表 `list` 按持久化顺序重排；无记录时捕获当前顺序打底（无感知迁移）。
   *  SessionSummary 用 sessionId 命名——包一层 {id} 再交给 orderSessions。 */
  private applySessionOrder(list: SessionSummary[]): SessionSummary[] {
    if (this.sessionSortMode() !== 'persisted') return list
    if (this.sessionOrder.length === 0) {
      if (list.length === 0) return list
      this.sessionOrder = list.map(summary => summary.sessionId)
      this.persistSessionOrder()
      return list
    }
    const wrapped = list.map(summary => ({ id: summary.sessionId, summary }))
    return orderSessions(wrapped, this.sessionOrder).map(entry => entry.summary)
  }

  trashSession(sessionId: string): Promise<void> {
    return this.runSessionOp(async () => {
      this.throwIfUnknownSession(sessionId)
      const summary = this.summaries.find(candidate => candidate.sessionId === sessionId)
      if (summary !== undefined && summary.running) {
        throw new Error('请等待正在运行的 DeepSeek 任务结束再删除该会话。')
      }
      // A session the runtime still lists but that is no longer on disk (e.g. a
      // previous hard delete) is removed from the view only; there is nothing to
      // keep in the recycle bin.
      const workspace = await findSessionWorkspace(dshHomeNow(), sessionId)
      if (workspace === undefined) {
        this.projector.notice(
          `trash-nodisk:${sessionId}`,
          '该会话在磁盘上没有会话存储，之后无法恢复——仅从列表中移除。',
          true,
        )
        this.publish(this.messagesPatch())
      } else {
        const displayTitle = visibleSessionTitles()[sessionId] ?? (summary === undefined ? '新建会话' : titleOf(summary))
        /* 0.0.170（用户需求）：入回收站前把内容纳入索引——删除后仍能搜到（标「回收站」），
           恢复后回到活动态。已索引过（revision 一致）则只打标记；没建过就先拉一次消息
           （此时会话还在运行时列表里，移走后就拿不到了）。失败不阻断删除。 */
        try {
          const store = searchIndexNow()
          await store.useWorkspace(this.cwd)
          const revision = typeof summary?.updatedAt === 'number' ? summary.updatedAt : 0
          if (!store.indexed(sessionId, revision)) {
            const messages = await this.projectSessionMessages(sessionId)
            if (messages.length > 0) store.upsert(sessionId, revision, messages)
          }
        } catch (error) {
          this.output.appendLine('[search-index] trash: ' + (error instanceof Error ? error.message : String(error)))
        }
        /* 0.0.147: 记录会话原 cwd（回收站按项目隔离的主键；summary.cwd 是 dsh 记录的原始串）。 */
        const moved = await this.recycleBin.trash(sessionId, workspace, displayTitle, summary?.updatedAt, summary?.cwd ?? this.cwd)
        if (!moved) throw new Error('该会话无法移入回收站。')
        try {
          const store = searchIndexNow()
          await store.useWorkspace(this.cwd)
          store.markTrashed(sessionId, true)
        } catch (error) {
          this.output.appendLine('[search-index] trash mark: ' + (error instanceof Error ? error.message : String(error)))
        }
      }
      this.shadowSession(sessionId)
      this.releaseSessionCaches(sessionId)
      if (this.visitedSessions.delete(sessionId)) commitVisitedSessions(this.visitedSessions)
      this.summaries = this.summaries.filter(candidate => candidate.sessionId !== sessionId)
      // G5 v9: 从持久化顺序中移除被删会话（残留 id 在 orderSessions 中自动忽略，此处延迟清理）
      if (this.sessionOrder.includes(sessionId)) {
        this.sessionOrder = this.sessionOrder.filter(id => id !== sessionId)
        this.persistSessionOrder()
      }
      this.publishRecycle()
      await this.loadSessions()
    })
  }

  restoreSession(sessionId: string): Promise<void> {
    return this.runSessionOp(async () => {
      const restored = await this.recycleBin.restore(sessionId)
      if (!restored) throw new Error('该会话无法从回收站恢复。')
      /* 0.0.170：恢复后索引条目回到活动态（内容一直都在，只是标注）。
         0.1.110（审查中危4）：先对齐 store 到当前工作区——否则 store 未加载/还是别的工作区时，
         markTrashed 打在错的/空的数据上 ⇒ 恢复的会话一直标「回收站」（且 prune 永久豁免该记录，不会自愈）。 */
      {
        const store = searchIndexNow()
        await store.useWorkspace(this.cwd)
        store.markTrashed(sessionId, false)
      }
      const shadow = extDeletedSessions()
      if (shadow.delete(normalizeSessionId(sessionId))) void EXT_CONTEXT?.workspaceState.update('dshDeletedSessions', [...shadow])
      // G22 bug⑥a: 用户主动恢复的会话（即便是空 blank）视为已打开——随后的 loadSessions 刷新不隐藏它。
      this.rememberVisited(sessionId)
      this.publishRecycle()
      // G24: 记录恢复前的当前会话，恢复后：① preferredId 选中并跳转到恢复的会话
      //       ② 其 tab 重排到旧当前会话右侧（顺序=渲染顺序）。
      const oldCurrent = this._state.sessionId
      await this.loadSessions(normalizeSessionId(sessionId))
      this.settleSessionOrder(normalizeSessionId(sessionId), oldCurrent)
    })
  }

  purgeSession(sessionId: string): Promise<void> {
    return this.runSessionOp(async () => {
      const purged = await this.recycleBin.purge(sessionId)
      if (!purged) throw new Error('该会话无法永久删除。')
      /* 0.0.170：永久删除 → 索引条目一并清掉（回收站条目此前靠 trashed 标记保留）。
         0.1.110（审查中危4）：同恢复路径，先对齐 store——否则真删的会话内容长期仍可搜到。 */
      {
        const store = searchIndexNow()
        await store.useWorkspace(this.cwd)
        store.remove(sessionId)
      }
      /* 0.0.163（审查 P1-3）：联动清该会话的持久化草稿与原图留档（此前只清会话本体）。 */
      this.purgeSessionMetadata(sessionId)
      await this.pruneRecycleBin()
    })
  }

  private throwIfUnknownSession(sessionId: string): void {
    if (!this.summaries.some(summary => summary.sessionId === sessionId && sameCwd(summary.cwd, this.cwd))) {
      throw new Error('该会话不属于当前项目。')
    }
  }

  /** 0.1.0（用户实测）：改名清空后把列表里的显示标题刷回运行时投影名（缓存不会自己变）。 */
  refreshSessionTitle(sessionId: string): void {
    const summary = this.summaries.find(item => item.sessionId === sessionId)
    if (summary === undefined) return
    const effective = titleOf(summary)
    const current = this._state.sessions.find(item => item.id === sessionId)
    if (current !== undefined && current.title !== effective) {
      this.publish({ sessions: this._state.sessions.map(item => item.id === sessionId ? { ...item, title: effective } : item) })
    }
  }

  private shadowSession(sessionId: string): void {
    const shadow = extDeletedSessions()
    shadow.add(normalizeSessionId(sessionId))
    void EXT_CONTEXT?.workspaceState.update('dshDeletedSessions', [...shadow])
  }

  /** Serialize session-store mutations: parallel callers race on the bin manifest. */
  private runSessionOp<T>(task: () => Promise<T>): Promise<T> {
    const run = this.sessionOps.then(task, task)
    this.sessionOps = run.then(() => undefined, () => undefined)
    return run
  }

  /* 0.0.163（审查 P1-2）：「清空回收站」——逐条永久删除，返回删除条数。 */
  purgeAllRecycle(): Promise<number> {
    return this.runSessionOp(async () => {
      let count = 0
      const items = await this.recycleBin.list()
      for (const item of items) {
        if (await this.recycleBin.purge(item.id)) {
          this.purgeSessionMetadata(item.id)
          await this.removePurgedSearchEntry(item.id, item.cwd ?? this.cwd)
          count += 1
        }
      }
      return count
    })
  }

  private async removePurgedSearchEntry(sessionId: string, cwd: string): Promise<void> {
    const store = searchIndexNow()
    try {
      await store.useWorkspace(cwd)
      store.remove(sessionId)
    } catch (error) {
      this.output.appendLine(`[search-index] purge: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (cwd !== this.cwd) await store.useWorkspace(this.cwd)
    }
  }

  pruneRecycleBin(): Promise<void> {
    const days = vscode.workspace.getConfiguration('deepseekHarness').get<number>('recycleRetentionDays', 30)
    return this.recycleBin.prune(days * 24 * 60 * 60 * 1000)
      .then(async removed => {
        for (const item of removed) this.purgeSessionMetadata(item.id)
        for (const item of removed) {
          await this.removePurgedSearchEntry(item.id, item.cwd ?? this.cwd)
        }
        this.publishRecycle()
      })
  }

  /** G22：宽松策略 prune 文件卡元数据 + 删除过期 .dsh-paste 副本（双守卫防路径逃逸）。
      批 C P2-13（0.0.61）：补"目录差集"兜底——trimStore 超容淘汰条目的副本不再出现在
      staleCopyPaths，改为扫描目录：未被 store 引用且已过期的孤儿文件一并清理。 */
  async pruneMessageFileStore(): Promise<void> {
    const days = vscode.workspace.getConfiguration('deepseekHarness').get<number>(
      'fileCardRetentionDays',
      DEFAULT_FILE_CARD_RETENTION_DAYS,
    )
    const now = Date.now()
    const ttl = retentionMs(days)
    const store = currentMessageFiles()
    const result = pruneMessageFiles(store, now, ttl)
    if (result.store !== undefined) commitMessageFiles(result.store)
    const container = normalizeWithin(this.cwd, '_temp/.dsh-paste')
    for (const copyPath of result.staleCopyPaths) {
      if (container === undefined || !isPasteCopyPath(copyPath)) continue
      const absolute = normalizeWithin(this.cwd, copyPath)
      if (absolute === undefined || path.dirname(absolute) !== container) continue
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(absolute))
      } catch (error) {
        this.output.appendLine(`[message-files] prune delete failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (container === undefined) return
    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(container))
      const listing: Array<{ name: string; mtimeMs: number }> = []
      for (const [name, kind] of entries) {
        if (kind !== vscode.FileType.File) continue
        try {
          const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(vscode.Uri.file(container), name))
          listing.push({ name, mtimeMs: stat.mtime })
        } catch { /* 拿不到 mtime：按新文件处理，跳过 */ }
      }
      for (const copyPath of orphanPasteCopies(store, listing, now, ttl)) {
        const absolute = normalizeWithin(this.cwd, copyPath)
        if (absolute === undefined || path.dirname(absolute) !== container) continue
        try {
          await vscode.workspace.fs.delete(vscode.Uri.file(absolute))
        } catch (error) {
          this.output.appendLine(`[message-files] orphan delete failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } catch { /* 目录不存在：无孤儿 */ }
  }

  /** 批 C P2-16（0.0.61）：_temp/.dsh-export 是"复制文件/复制原格式"的剪贴板载体（CF_HDROP 需要
      真实文件路径）——每次复制留一份副本；启动时清理 7 天前的旧副本，防无限堆积。 */
  async pruneExportDir(): Promise<void> {
    const container = normalizeWithin(this.cwd, '_temp/.dsh-export')
    if (container === undefined) return
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(container))
      for (const [name, kind] of entries) {
        if (kind !== vscode.FileType.File) continue
        const file = vscode.Uri.joinPath(vscode.Uri.file(container), name)
        try {
          const stat = await vscode.workspace.fs.stat(file)
          if (stat.mtime < cutoff) await vscode.workspace.fs.delete(file)
        } catch (error) {
          this.output.appendLine(`[export-prune] delete failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } catch { /* 目录不存在等：无需清理 */ }
  }

  /** G6 v1（0.0.62）：设置台改 sessionSortMode 后按新顺序重排会话列表（复用加载路径）。 */
  resortSessions(): Promise<void> {
    return this.loadSessions()
  }

  /** G6 v1（0.0.62）：设置台"DSH 配置"只读浏览——转发 settings.describe（v2 再接写通道）。 */
  describeRuntimeSettings(): Promise<SettingsDescription> {
    return this.requireClient().settings()
  }

  openRuntimeSettingsDocument(): Promise<{ opened: true }> {
    return this.requireClient().openSettingsDocument()
  }

  /* 0.1.10（用户反馈）：运行中按 Enter 的模式（'queue' | 'steer'）缓存——
     跟随运行时设置 ui-conversation.busyEnter；Ctrl/Cmd+Enter 走另一模式。 */
  private busyEnterMode: 'queue' | 'steer' = 'queue'

  /** 读取 ui-conversation.busyEnter 并（变化时）广播；任何失败保持现值（默认 queue）。 */
  async refreshBusyEnterMode(): Promise<void> {
    try {
      const description = await this.describeRuntimeSettings()
      const namespace = description.namespaces.find(item => item.ns === 'ui-conversation')
      const value = typeof namespace?.value === 'object' && namespace.value !== null
        ? (namespace.value as Record<string, unknown>).busyEnter
        : undefined
      const mode: 'queue' | 'steer' = value === 'steer' ? 'steer' : 'queue'
      if (mode !== this.busyEnterMode) {
        this.busyEnterMode = mode
        this.publish({ busyEnter: mode })
      }
    } catch { /* 运行时不可用/设置不可读 → 保持默认 */ }
  }

  /** G6 v2（0.0.64）：设置台 dsh 配置编辑——转发 settings.mutate（revision 冲突由运行时抛 settings-conflict）。 */
  mutateRuntimeSettings(ns: string, ops: SettingsMutation[], expectedRevision: number): Promise<SettingsNamespace> {
    return this.requireClient().mutateSettings(ns, ops, expectedRevision)
  }

  publishRecycle(): void {
    void this.recycleView().then(view => { this.publish({ recycle: view.items, recycleOthers: view.others }) })
  }

  /** 0.0.147：回收站按项目隔离——条目按当前 cwd 分类（cwd 主键 + workspace 目录兜底），
      列表只发本项目条目，其他项目只发计数（菜单底部提示行）。 */
  private async recycleView(): Promise<{ items: RecycleItemView[]; others: number }> {
    const all = await this.recycleBin.list()
    const dirs = await this.currentWorkspaceDirs()
    const { mine, others } = classifyRecycle(all, this.cwd, dirs)
    /* 发往 webview 的保持视图形状（不含 workspace/cwd 等内部字段——与 0.0.146 前的线上形状一致）。 */
    const items: RecycleItemView[] = mine.map(item => ({
      id: item.id,
      title: item.title,
      deletedAt: item.deletedAt,
      ...(item.lastMessageAt === undefined ? {} : { lastMessageAt: item.lastMessageAt }),
    }))
    return { items, others: others.length }
  }

  /** 0.0.147：本项目活会话所属的 workspace 目录集合（回收站旧条目兜底分类用）——
      抽前 8 个会话探测目录名即可覆盖（一个 cwd 通常只落 1–2 个目录）；探测到即缓存，
      空结果不缓存（启动早期列表未就绪，之后刷新还要重试）。 */
  private async currentWorkspaceDirs(): Promise<Set<string>> {
    if (this.workspaceDirsCache !== undefined) return this.workspaceDirsCache
    const dirs = new Set<string>()
    const home = dshHomeNow()
    for (const summary of this.summaries.slice(0, 8)) {
      const dir = await findSessionWorkspace(home, summary.sessionId)
      if (dir !== undefined) dirs.add(dir)
    }
    if (dirs.size > 0) this.workspaceDirsCache = dirs
    return dirs
  }

  /** 0.0.147：启动时给回收站旧条目补 cwd（读 dsh projcache），随后重发回收站状态。 */
  migrateRecycleCwd(): Promise<void> {
    return this.recycleBin.backfillCwd().then(() => { this.publishRecycle() })
  }

  selectSession(sessionId: string): Promise<void> {
    // B-report P0 (0.0.33): 与删除/新建串行，防并发覆盖意图。
    return this.runSessionOp(async () => {
      /* 0.1.89（用户需求）：**子代理会话可打开**（搜索命中跳转用）——不在标签栏，但内容可见。 */
      const known = this.summaries.some(summary => summary.sessionId === sessionId && sameCwd(summary.cwd, this.cwd))
      if (!known && !this.subagentSessions.has(sessionId)) return
      await this.loadSession(sessionId)
    })
  }

  /* 0.0.76：turn-rewind 'both' 模式 fork 出的新会话——可能尚未进列表（host/session-added
     刷新是异步的），先刷一次列表再选，避免静默 no-op。 */
  selectFreshSession(sessionId: string): Promise<void> {
    return this.runSessionOp(async () => {
      if (!this.summaries.some(summary => summary.sessionId === sessionId && sameCwd(summary.cwd, this.cwd))) {
        try { await this.loadSessions() } catch { /* 列表刷新失败仍尝试选中 */ }
      }
      if (!this.summaries.some(summary => summary.sessionId === sessionId && sameCwd(summary.cwd, this.cwd))) return
      await this.loadSession(sessionId)
    })
  }

  async loadOlderHistory(): Promise<void> {
    const sessionId = this._state.sessionId
    const opening = this.sessionHistoryLoad
    if (opening?.sessionId === sessionId) {
      await opening.task
      if (this._state.sessionId !== sessionId || this._state.phase !== 'ready') return
    }
    const generation = this.historyWindowGeneration
    if (this.historyLoad?.sessionId === sessionId && this.historyLoad.generation === generation) return this.historyLoad.task
    const load = { sessionId, generation, task: this.fetchOlderHistory() }
    this.historyLoad = load
    try { await load.task } finally { if (this.historyLoad === load) this.historyLoad = undefined }
  }

  private async fetchOlderHistory(): Promise<void> {
    if (this._state.sessionId === '' || !this._state.hasMoreHistory || this._state.loadingHistory) return
    const sessionId = this._state.sessionId
    const client = this.requireClient()
    const generation = this.historyWindowGeneration
    const current = (): boolean => this.client === client && this._state.sessionId === sessionId && this.historyWindowGeneration === generation
    const beforeSeq = earliestHistorySequence(this.historyEntries)
    if (beforeSeq === undefined) {
      this.publish({ hasMoreHistory: false })
      return
    }
    this.publish({ loadingHistory: true })
    try {
      const page = await client.history(sessionId, beforeSeq, this.historyPullLimit())
      if (!current()) return
      const unseenEntries = unseenHistoryEntries(this.historyEntries, page.events)
      this.historyEntries = mergeHistoryEntries(this.historyEntries, unseenEntries)
      this.projector.reset(this.historyEntries)
      /* 2026-10-06（滚顶案）：显式传本次翻页的真值（不可读 state——发布在其后）。 */
      this.rememberHistoryWindow(sessionId, page.hasMore === true)
      this.replayUsageLedger(this.historyEntries)
      // G5: 分页前置插入打乱实时打点序列——整体重放重建 meta（与 projector.reset 同源，流式 draft 同上重建）
      this.resetTurnMeta()
      for (const entry of this.historyEntries) this.markTurnMeta(entry.event)
      this.publish({
        ...this.messagesPatch(),
        changedFiles: this.diffReviews.prependHistory(sessionId, this.cwd, unseenEntries),
        hasMoreHistory: page.hasMore,
        loadingHistory: false,
      })
      this.hydrateImages(client, sessionId)
    } catch (error) {
      if (current()) throw error
    } finally {
      if (current() && this._state.loadingHistory) {
        this.publish({ loadingHistory: false })
      }
    }
  }

  /** G49 v2（0.0.121）：轨道跳转到“未加载的轮”——按目标 seq 连续翻页（上限 12 页）直到该轮进入窗口，
      完成后回端侧一条 turn-jump-ready（端侧按 seq 定位节点并滚动）。
      0.1.124（数据层根治）：purpose='restore' 时回执走 onRestoreThroughReady——Reload 恢复的锚点
      窗口外穿透与轨道跳转语义分开（前者重定位锚点，后者段首对齐 + 粘滞）。 */
  async loadThroughSequence(targetSeq: number, purpose: 'jump' | 'restore' = 'jump', requestId = 0): Promise<void> {
    const sessionId = this._state.sessionId
    if (sessionId === '') return
    const generation = ++this.historyNavigationGeneration
    const client = this.client
    const current = (): boolean => generation === this.historyNavigationGeneration && this.client === client && this._state.sessionId === sessionId
    const maxPages = HISTORY_NAVIGATION_MAX_PAGES
    let pages = 0
    let stalled = false
    const progress = (): void => {
      if (purpose === 'restore') this.onRestoreThroughProgress?.(targetSeq, pages, maxPages)
      else this.onTurnJumpProgress?.(targetSeq, requestId, pages, maxPages)
    }
    const opening = this.sessionHistoryLoad
    try {
      if (opening?.sessionId === sessionId) await opening.task
      if (!current()) return
      progress()
      for (let i = 0; i < maxPages; i += 1) {
        if (!current()) return
        const earliest = earliestHistorySequence(this.historyEntries)
        if (earliest === undefined || earliest <= targetSeq || !this._state.hasMoreHistory) break
        await this.loadOlderHistory()
        if (!current()) return
        pages += 1
        progress()
        const next = earliestHistorySequence(this.historyEntries)
        if (next === undefined || next >= earliest) { stalled = true; break }
      }
    } catch (error) {
      if (!current()) return
      if (purpose === 'restore') this.onRestoreThroughReady?.(targetSeq, false, 'error')
      else this.onTurnJumpReady?.(targetSeq, false, 'error', { requestId, pages, maxPages, canContinue: this._state.hasMoreHistory })
      return
    }
    if (!current()) return
    const earliest = earliestHistorySequence(this.historyEntries)
    const loaded = earliest !== undefined && earliest <= targetSeq
    if (purpose === 'restore') this.onRestoreThroughReady?.(targetSeq, loaded)
    else this.onTurnJumpReady?.(targetSeq, loaded, undefined, { requestId, pages, maxPages, canContinue: !loaded && !stalled && this._state.hasMoreHistory && pages === maxPages })
  }

  cancelHistoryNavigation(): void { this.historyNavigationGeneration += 1 }

  async send(
    text: string,
    images: readonly PromptImage[] = [],
    ideContext?: IdeContextSnapshot,
    mode: PromptMode = 'queue',
  ): Promise<string | undefined> {
    const normalized = text.trim()
    // G22 bug③: 纯文件消息（空文本+无图片）也是有效发送——withIdeContext 会产出非空 envelope 文本
    if (normalized === '' && images.length === 0 && (ideContext?.pinned?.length ?? 0) === 0) return undefined
    /* 0.0.56（0.0.56 复测 ③ 根因）: 会话未就绪必须**抛错**而非静默 return——静默返回会跳过调用方的失败
       还原（webview 已清文本、扩展已乐观清空），用户会看到文本+图片"凭空消失"。 */
    if (this._state.sessionId === '') throw new Error('DeepSeek Harness is not ready yet; the message was not sent.')
    if (!this._state.routable) throw new Error('当前模型连接不可用，请先选择一个可用模型。')
    const slash = this.slashRoute(normalized)
    if (slash.kind === 'command') {
      const command = this._state.commands.find(item => item.name === slash.name)
      if (images.length > 0 && command?.input?.attachments !== true) {
        throw new Error(`${slash.token} does not accept image attachments; remove them first.`)
      }
      const execution = await this.requireClient().executeCommand(
        this._state.sessionId,
        normalized,
        images.length > 0 ? images : undefined,
      )
      if (execution === undefined) throw new Error(`DeepSeek did not recognize ${slash.token}.`)
      if (images.length > 0 && execution.result.kind === 'error') {
        throw new Error(execution.result.text ?? `${slash.token} could not use the attached images.`)
      }
      return undefined
    }
    const receipt = await this.requireClient().prompt(
      this._state.sessionId,
      slash.kind === 'skill' || ideContext === undefined ? normalized : withIdeContext(normalized, ideContext),
      images,
      mode,
    )
    const summary = this.summaries.find(item => item.sessionId === this._state.sessionId)
    if (summary !== undefined) summary.blank = false
    this.publish({ agentPreset: lockAgentPresetState(this._state.agentPreset) })
    /* 0.0.59: rpcId 交回调用方——stop 时凭它判断消息是否仍留在运行时队列（在 → 不还原草稿）。 */
    return receipt.rpcId
  }

  slashRoute(text: string): SlashRoute {
    return routeSlashInput(text, this._state.commands, this._state.skills)
  }

  async selectAgentPreset(id: string): Promise<void> {
    const current = this._state.agentPreset
    if (!current.available || current.locked || current.busy || id === current.current) return
    if (!current.options.some(option => option.id === id)) throw new Error(`Unknown DeepSeek agent preset: ${id}`)
    const client = this.requireClient()
    const sessionId = this._state.sessionId
    if (sessionId === '') return
    this.publish({ agentPreset: selectAgentPresetState(current, id, true) })
    try {
      const selected = await client.selectAgentPreset(sessionId, id)
      if (this.client !== client || this._state.sessionId !== sessionId) return
      const summary = this.summaries.find(item => item.sessionId === sessionId)
      if (summary !== undefined) summary.agentPreset = selected.agentPreset
      this.publish({
        agentPreset: selectAgentPresetState(this._state.agentPreset, selected.agentPreset, false),
        commands: [],
        skills: [],
      })
      await Promise.all([
        this.loadCommands(client, sessionId),
        this.loadSkills(client, sessionId),
        this.loadModels(sessionId),
      ])
    } catch (error) {
      if (this.client === client && this._state.sessionId === sessionId) {
        this.publish({ agentPreset: { ...current, busy: false } })
      }
      throw error
    }
  }

  async cancel(sessionId = this._state.sessionId): Promise<void> {
    if (sessionId === '') return
    await this.requireClient().cancel(sessionId)
  }

  async updateQueue(itemId: string, action: 'edit' | 'remove' | 'steer', text?: string): Promise<void> {
    if (this._state.sessionId === '') return
    let request: QueueAction
    if (action === 'edit') {
      const replacement = text?.trim()
      if (replacement === undefined || replacement === '') throw new Error('排队消息不能为空。')
      const original = this.queueRawText.get(itemId)
      request = {
        kind: 'edit',
        content: [{
          type: 'text',
          text: original === undefined ? replacement : replaceTextPreservingIdeContext(original, replacement),
        }],
      }
    } else {
      request = { kind: action }
    }
    await this.requireClient().updateQueue(this._state.sessionId, itemId, request)
  }

  async selectModel(selection: ModelSelection): Promise<void> {
    if (this._state.sessionId === '') return
    const client = this.requireClient(), sessionId = this._state.sessionId
    const result = await client.selectModel(sessionId, selection)
    if (this.client !== client) return
    this.modelSelections.set(sessionId, result.selected)
    if (this._state.sessionId === sessionId) await this.loadModels(sessionId)
  }

  pluginInventory(): Promise<PluginInventorySnapshot> {
    return this.requireClient().pluginInventory()
  }

  settings(): Promise<SettingsDescription> {
    return this.requireClient().settings()
  }

  mutateSettings(ns: string, ops: SettingsMutation[], expectedRevision: number): Promise<SettingsNamespace> {
    return this.requireClient().mutateSettings(ns, ops, expectedRevision)
  }

  async answerApproval(_rpcId: string, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void> {
    const pending = this._state.approval
    if (this._state.sessionId === '' || pending === null || pending.approvalId !== approvalId) throw new Error('该审批已不再等待回答。')
    const client = this.requireClient()
    if (!client.socketOpen) throw new Error('连接正在恢复，请恢复后重新确认本次审批。')
    const targetRpcId = pending.rpcId
    await client.respond(targetRpcId, {
      sessionId: this._state.sessionId,
      approvalId,
      outcome,
    })
    if (this.client === client && this._state.approval?.rpcId === targetRpcId) this.publish({ approval: null })
  }

  async executePolicyCommand(line: string, sessionId: string): Promise<void> {
    if (sessionId === '' || this._state.sessionId !== sessionId || this._state.phase !== 'ready') {
      throw new Error('会话已切换或尚未就绪，请重新选择模式或权限。')
    }
    if (this._state.running) throw new Error('请等待当前任务结束后再切换模式或权限。')
    const result = await this.requireClient().executeCommand(sessionId, line)
    if (result === undefined || result.result.kind === 'error') {
      throw new Error(result?.result.text ?? '当前会话不支持此模式或权限命令。')
    }
  }

  async answerQuestions(rpcId: string, answers: readonly QuestionAnswer[]): Promise<void> {
    if (this._state.sessionId === '') return
    const pending = this._state.question
    /* 0.1.112（真机事故：ws 空闲被服务端断开 ⇒ 重放提问时 rpcId 每轮换代，用户手里的卡还是旧 rpcId
       ⇒ 提交一律被「该提问已不再等待回答」拒掉）：**改按问题 id 结算**——答案 id 与当前待答提问完全一致
       就接受（哪怕带来的 rpcId 是旧的），并用**当前** rpcId 发应答；id 不一致（比如换成新提问）照旧拒绝。 */
    const matchesPending = pending !== undefined && pending !== null
      && answers.length === pending.questions.length
      && answers.every(answer => pending.questions.some(question => question.id === answer.id))
    if (!matchesPending) throw new Error('该提问已不再等待回答。')
    const targetRpcId = pending.rpcId
    const key = questionSetKey(pending.questions)
    /* 换代留痕（真机事故里 rpcId 每轮重放都变，值得在日志里看得见）。 */
    if (rpcId !== targetRpcId) this.output.appendLine(`[chat] 提问 rpcId 已换代（卡上 ${rpcId} → 当前 ${targetRpcId}），按问题 id 结算`)
    /* 2026-10-05（A）：socket 已断时不必打 HTTP——应答必被网关以"死流"丢弃；
       直接暂存，等重连重放后的活流（活窗口）。 */
    if (!this.requireClient().socketOpen) {
      this.parkSubmission(key, answers)
      return
    }
    try {
      await this.requireClient().respond(targetRpcId, {
        sessionId: this._state.sessionId,
        answer: { answers },
      })
    } catch (error) {
      /* 2026-10-05（A）：连接类失败 → 暂存等待重放重投（不再把英文网关原错弹给用户）；
         业务类失败照旧冒泡（重试无意义）。 */
      if (!isRetryableAnswerError(error)) throw error
      this.parkSubmission(key, answers, error)
      return
    }
    this.settleQuestion(key)
  }

  /** 0.0.106（W2）：「跳过」——以 cancelled 结算提问（宿主把等待中的工具调用判为已取消）。
      2026-10-05（A 同族修复）：改按 **id 集**结算（与提交同口径）——旧实现严比 rpcId，
      换代后（重放风暴）用户点「跳过」必被拒。 */
  async cancelQuestions(rpcId: string, questionIds: readonly string[]): Promise<void> {
    if (this._state.sessionId === '') return
    const pending = this._state.question
    const matchesPending = pending !== undefined && pending !== null && matchesQuestionIds(pending.questions, questionIds)
    if (!matchesPending) throw new Error('该提问已不再等待回答。')
    const targetRpcId = pending.rpcId
    const key = questionSetKey(pending.questions)
    if (rpcId !== targetRpcId) this.output.appendLine(`[chat] 「跳过」rpcId 已换代（卡上 ${rpcId} → 当前 ${targetRpcId}），按问题 id 结算`)
    if (!this.requireClient().socketOpen) {
      this.parkSubmission(key, null)
      return
    }
    try {
      await this.requireClient().respondCancelled(targetRpcId)
    } catch (error) {
      if (!isRetryableAnswerError(error)) throw error
      this.parkSubmission(key, null, error)
      return
    }
    this.settleQuestion(key)
  }

  /* 2026-10-05（A）：提问结算收口——卡片收起 + 清 rpcId 别名集 + 清暂存。
     带 key = 只清"还是那组提问"的卡片（提交期间若已换成新提问，不得误清）。 */
  private settleQuestion(key?: string): void {
    const pending = this._state.question
    if (pending !== null && (key === undefined || questionSetKey(pending.questions) === key)) this.publish({ question: null })
    this.questionRpcIds.clear()
    this.clearParkedSubmission()
  }

  /** 暂存一次失败的提交意图（连接类）。answers=null 表示「跳过」意图。 */
  private parkSubmission(key: string, answers: readonly QuestionAnswer[] | null, error?: unknown): void {
    const first = this.parkedSubmission === null || this.parkedSubmission.key !== key
    this.parkedSubmission = {
      key,
      answers,
      atMs: first ? Date.now() : (this.parkedSubmission?.atMs ?? Date.now()),
      lastAttemptMs: 0,
      inFlight: false,
    }
    const detail = error === undefined ? 'socket closed' : (error instanceof Error ? error.message : String(error))
    const socketOpen = this.client !== undefined && this.client.socketOpen
    connLog(this.output, `submit parked socket=${String(socketOpen)} reason=${detail.slice(0, 80)}`)
    if (this.parkedAnnouncedKey !== key) {
      this.parkedAnnouncedKey = key
      const text = answers === null ? '连接不稳：「跳过」已暂存，恢复后自动提交' : '连接不稳：答案已暂存，恢复后自动提交'
      /* 同一时刻只有一个待答提问——通知 id 用常量（键含控制字符，不能进消息 id）。 */
      this.projector.notice('parked-question', text, false)
      this.publish(this.messagesPatch())
    }
  }

  private clearParkedSubmission(): void {
    this.parkedSubmission = null
    this.parkedAnnouncedKey = null
  }

  /* 2026-10-05（A）：随"同一提问重放"重投暂存意图。重放刚注册的新 rpcId 必对应新活流——
     这正是活窗口（真机风暴实测：每 ~12s 一轮断连，重放后连接可用窗口 ≈10s）。
     决策抽成 planParkRetry（question-park.ts，单测锁死）。 */
  private retryParkedSubmission(): void {
    const park = this.parkedSubmission
    const pending = this._state.question
    const plan = planParkRetry(park, pending === null ? undefined : questionSetKey(pending.questions), Date.now())
    if (plan.kind === 'none' || plan.kind === 'wait' || park === null || pending === null) return
    if (plan.kind === 'expire') {
      this.clearParkedSubmission()
      this.projector.notice('parked-question', '连接长时间未恢复：暂存的答案已失效，请重新提交', true)
      this.publish(this.messagesPatch())
      return
    }
    park.lastAttemptMs = Date.now()
    park.inFlight = true
    const targetRpcId = pending.rpcId
    const request = park.answers === null
      ? this.requireClient().respondCancelled(targetRpcId)
      : this.requireClient().respond(targetRpcId, { sessionId: this._state.sessionId, answer: { answers: park.answers } })
    void request.then(() => {
      connLog(this.output, `submit retry ok q=${shortId(park.key)} rpc=${shortId(targetRpcId)}`)
      if (this.parkedSubmission === park) {
        this.projector.notice('parked-question', '连接已恢复：暂存的提交已自动送达', false)
        this.settleQuestion(park.key)
        this.publish(this.messagesPatch())
      }
    }, (error: unknown) => {
      connLog(this.output, `submit retry failed q=${shortId(park.key)} reason=${(error instanceof Error ? error.message : String(error)).slice(0, 80)}`)
      if (this.parkedSubmission === park) park.inFlight = false
      /* 非连接类失败：放弃兜底（重复重投无意义），留给用户手动处理。 */
      if (this.parkedSubmission === park && !isRetryableAnswerError(error)) {
        this.clearParkedSubmission()
        this.projector.notice('parked-question', `自动补发失败：${error instanceof Error ? error.message : String(error)}`, true)
        this.publish(this.messagesPatch())
      }
    })
  }

  report(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.output.appendLine(`[chat] ${message}`)
    this.projector.notice(`error:${String(Date.now())}`, message, true)
    this.publish(this.messagesPatch())
  }

  dispose(): void {
    ++this.generation
    this.disconnectClient()
    this.changes.dispose()
  }

  private requireClient(): DshClient {
    if (this.client === undefined) throw new Error('DeepSeek Harness 未连接。')
    return this.client
  }

  private disconnectClient(): void {
    this.evictAttachmentResults(new Set())
    if (this.hydratePublishTimer !== undefined) {
      clearTimeout(this.hydratePublishTimer)
      this.hydratePublishTimer = undefined
    }
    this.hydratePublishSessionId = undefined
    for (const dispose of this.clientDisposables.splice(0)) dispose()
    this.client?.dispose()
    this.client = undefined
  }

  /* 0.0.70：把历史尾页基线与摘要现存值合并（现存值更新，优先）；列表行缺失的键由基线补齐。 */
  private applyProjectionBaseline(sessionId: string, summary: SessionSummary | undefined): void {
    const baseline = this.projectionBaselines.get(sessionId)
    if (baseline === undefined || summary === undefined) return
    /* 0.0.89：按 asOfSeq 合并——陈旧的列表块（实测 asOfSeq=2、统计全 0）不得压住完整历史基线 */
    summary.projections = mergeProjectionBlocks(summary.projections, baseline)
  }

  /** 0.0.88/0.0.89：投影学到的标题落盘（手动重命名优先，不被覆盖）+ 列表标签就地同步。 */
  private syncLearnedTitle(sessionId: string, summary: SessionSummary | undefined): void {
    const raw = summary?.projections?.values?.title
    const learned = typeof raw === 'string' ? raw.trim() : ''
    /* 0.1.0 修复：信封式回退标题（首条消息带 IDE 上下文时运行时的预览标题）不学、不存。 */
    if (learned === '' || isBrokenSessionTitle(learned)) return
    const titles = extSessionTitles()
    const existing = titles[sessionId]
    const stored = typeof existing === 'string' ? existing.trim() : ''
    /* 0.1.0 自愈：本地存着坏标题（旧版本学进去的）→ 用现在的好投影覆盖。 */
    const remembered = stored !== '' && !isBrokenSessionTitle(stored) ? stored : undefined
    if (remembered === undefined) {
      titles[sessionId] = learned
      void EXT_CONTEXT?.workspaceState.update('dshSessionTitles', titles)
    }
    const effective = remembered ?? learned
    const current = this._state.sessions.find(item => item.id === sessionId)
    if (current !== undefined && current.title !== effective) {
      this.publish({ sessions: this._state.sessions.map(item => item.id === sessionId ? { ...item, title: effective } : item) })
    }
  }

  /* C3 v1.2（0.0.130）：dsh-context ≥ v0.9（插件 0.52.x）投影只发「轻头」——nodes/requests/
     events/archive/fileOps 恒为空数组（重集合挪到按需通道 POST /api/dsh-context/detail）。
     这里按轻头的 detailRev 失效 + 2.5s 节流拉取，拉到后并回投影值再算面板态——下游
     （contextPanelStateOf / contextDetailOf / webview 面板）零改动。 */
  private contextDetailCache: { sessionId: string; rev: number; value: Record<string, unknown> | undefined } = { sessionId: '', rev: -1, value: undefined }
  private contextDetailFetchedAt = 0
  private contextDetailInflight = false
  private contextPanelVisible = false
  /* 面板打开 → 立即强制拉一次（跳过节流，保留 rev 命中判定）；关闭 → 停止后台拉取。 */
  setContextPanelVisible(open: boolean): void {
    if (this.contextPanelVisible === open) return
    this.contextPanelVisible = open
    if (!open) return
    const summary = this.summaries.find(item => item.sessionId === this._state.sessionId)
    this.maybeFetchContextDetail(summary, true)
  }
  /* 明细与轻头并回；rev 不匹配/会话不符时原样返回（旧版插件无 detailRev → 恒不匹配 → 零副作用）。 */
  private contextValuesWithDetail(summary: { projections?: { values?: Record<string, unknown> } } | undefined): Record<string, unknown> | undefined {
    const values = summary?.projections?.values
    if (values === undefined) return undefined
    const head = values.contextTimeline
    if (typeof head !== 'object' || head === null || Array.isArray(head)) return values
    const record = head as Record<string, unknown>
    const rev = typeof record.detailRev === 'number' ? record.detailRev : -1
    const cached = this.contextDetailCache
    if (cached.value === undefined || cached.sessionId !== this._state.sessionId || cached.rev !== rev) return values
    return { ...values, contextTimeline: { ...record, ...cached.value } }
  }
  private maybeFetchContextDetail(summary: { projections?: { values?: Record<string, unknown> } } | undefined, force = false): void {
    /* 0.0.130：明细只在面板可见时拉——后台长会话不为此反复拉大载荷。 */
    if (!this.contextPanelVisible) return
    const values = summary?.projections?.values
    const head = values?.contextTimeline
    if (typeof head !== 'object' || head === null || Array.isArray(head)) return
    const record = head as Record<string, unknown>
    if (record.ok !== true) return
    const rev = typeof record.detailRev === 'number' ? record.detailRev : -1
    const sessionId = this._state.sessionId
    if (sessionId === '' || this.client === undefined) return
    const cached = this.contextDetailCache
    if (cached.sessionId === sessionId && cached.rev === rev && cached.value !== undefined) return
    const now = Date.now()
    if (this.contextDetailInflight || (!force && now - this.contextDetailFetchedAt < 2_500)) return
    this.contextDetailFetchedAt = now
    this.contextDetailInflight = true
    void this.fetchContextDetail(sessionId, rev)
  }
  private async fetchContextDetail(sessionId: string, rev: number): Promise<void> {
    const client = this.client
    try {
      if (client === undefined) return
      const body = await client.contextDetail(sessionId)
      const envelope = typeof body === 'object' && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : undefined
      const value = envelope !== undefined && envelope.ok === true ? envelope.value : undefined
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return
      if (sessionId !== this._state.sessionId) return
      this.contextDetailCache = { sessionId, rev, value: value as Record<string, unknown> }
      const summary = this.summaries.find(item => item.sessionId === sessionId)
      this.publish({ context: contextPanelStateOf(this.contextValuesWithDetail(summary)) })
    } catch { /* 拉取失败保持轻头渲染——面板其余部分仍可用 */ } finally {
      this.contextDetailInflight = false
    }
  }

  /* 0.0.71（C3 v1.1）：明细内容按需取——条目优先读会话日志全文（投影 node.text 被插件截到
     80 字符），未命中再回落投影摘要；system/tool 从投影 headers 读。
     上游 ≥0.40/0.44 载荷瘦身后，投影一路会失效（headers 内容转按需），届时改读法只动这里。 */
  contextDetail(sessionId: string, request: ContextDetailRequest): ContextDetailResult | undefined {
    if (sessionId !== this._state.sessionId) return undefined
    const summary = this.summaries.find(item => item.sessionId === sessionId)
    if (request.kind === 'node') {
      const entry = this.historyEntries.find(candidate => candidate.event.seq === request.seq)
      const fullText = entry === undefined ? undefined : fullTextOfEvent(entry.event)
      if (fullText !== undefined) return { ok: true, text: fullText }
      const fallback = contextDetailOf(this.contextValuesWithDetail(summary), request)
      // 投影兜底文本是（必然被截断的）IDE 上下文壳 → 无有效正文，留给图片通道
      if (fallback.ok === true && fallback.text !== undefined && isIdeContextEnvelope(fallback.text)) return { ok: false }
      return fallback.ok ? { ...fallback, capped: true } : fallback
    }
    return contextDetailOf(this.contextValuesWithDetail(summary), request)
  }

  /* 0.0.72（C11 修复）：图片消息的明细——按 seq 从会话日志取图片引用并加载数据
     （复用聊天侧 attachmentResults 缓存，避免同图重复拉取）。 */
  /* 0.0.76：turn-rewind 能力探测——GET /turn-rewind 带假会话：装了插件 → 409(JSON 报错)，
     没装 → 404/其它。结果进 state 驱动菜单显隐。 */
  private async probeRewindAvailability(client: DshClient): Promise<void> {
    let available = false
    try {
      const probe = await client.turnRewindPreview('__probe__', 0)
      available = probe.httpStatus === 409 || probe.httpStatus === 200
      this.output.appendLine(`[turn-rewind] probe: http=${String(probe.httpStatus)} available=${String(available)}`)
    } catch {
      available = false
    }
    if (this.client !== client) return
    if (this.rewindAvailable !== available) {
      this.rewindAvailable = available
      this.publish({ rewindAvailable: available })
    }
  }

  /* 0.0.76：turn-rewind 预览/应用（HTTP 直调；解析与文案在 turn-rewind.ts / DshSurface）。 */
  turnRewindPreview(sessionId: string, messageSeq: number): Promise<{ httpStatus: number; body: unknown }> {
    return this.requireClient().turnRewindPreview(sessionId, messageSeq)
  }

  turnRewindApply(payload: {
    mode: 'code' | 'both'
    sessionId: string
    messageSeq: number
    checkpointId: string
    planId: string
    confirmation: string
  }): Promise<{ httpStatus: number; body: unknown }> {
    return this.requireClient().turnRewindApply(payload)
  }

  async contextDetailImages(sessionId: string, seq: number): Promise<Array<{ mediaType: string; data: string }>> {
    if (sessionId !== this._state.sessionId) return []
    const client = this.client
    const entry = client === undefined ? undefined : this.historyEntries.find(candidate => candidate.event.seq === seq)
    if (client === undefined || entry === undefined) return []
    const generation = this.historyWindowGeneration
    const current = (): boolean => this.client === client && this._state.sessionId === sessionId && this.historyWindowGeneration === generation
    const out: Array<{ mediaType: string; data: string }> = []
    for (const ref of imagesOfEvent(entry.event)) {
      const key = `${sessionId}\u0000${ref.attachmentId}`
      await this.loadAttachment(client, sessionId, ref)
      if (!current()) return []
      const cached = this.attachmentResults.get(key)
      if (cached?.data !== undefined) out.push({ mediaType: ref.mediaType, data: cached.data })
    }
    return out
  }

  /** 0.0.85 精准计费：usage 状态附带分段账本结果（含 cost-meter costUsage 投影）。 */
  private usageWithCost(summary: SessionSummary | undefined): UsageMeterState {
    const usage = usageMeterStateOf(summary?.projections?.values)
    const selected = this.modelSelections.get(summary?.sessionId ?? this._state.sessionId) ?? this._state.models.find(model => model.selected === true)
    const atMs = Date.now()
    usage.cost = usageCostStateOf(this.usageLedger, usage.tokenUsage, summary?.projections?.values?.costUsage, {
      family: familyOfModel(selected?.model), peak: isPeakAt(atMs), atMs, priced: hasDeepSeekPricing(selected?.provider, selected?.model),
    })
    return usage
  }

  /** 历史重放重建账本（幂等：逐事件按 (turn,step) 替换语义累计）。 */
  private replayUsageLedger(entries: readonly { event: DshEvent }[]): void {
    const ledger = new UsageLedger()
    for (const entry of entries) ledger.applyEvent(entry.event)
    this.usageLedger = ledger
  }

  /* 0.1.3：重连后重同步运行态（session.list 带 running 字段）。列表暂不可用时静默——后续
     事件流重放的 turn/end 仍会兜底。 */
  private runningSyncRevision = 0
  private readonly runningStatusRevisions = new Map<string, number>()

  private async resyncRunningState(): Promise<void> {
    const client = this.client
    if (client === undefined) return
    const revision = ++this.runningSyncRevision
    const statusRevisions = new Map(this.runningStatusRevisions)
    try {
      const { items } = await client.listSessions()
      if (this.client !== client || revision !== this.runningSyncRevision) return
      for (const summary of this.summaries) {
        if (this.runningStatusRevisions.get(summary.sessionId) !== statusRevisions.get(summary.sessionId)) continue
        const live = items.find(item => item.sessionId === summary.sessionId)
        if (live !== undefined) summary.running = live.running === true
      }
      const current = this.summaries.find(item => item.sessionId === this._state.sessionId)
      this.publish({
        running: current === undefined ? this._state.running : current.running === true,
        sessions: this._state.sessions.map(item => {
          const summary = this.summaries.find(candidate => candidate.sessionId === item.id)
          return summary === undefined ? item : { ...item, running: summary.running === true }
        }),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.output.appendLine(`[reconnect] 状态重同步失败：${message}`)
    }
  }

  private async loadSessions(preferredId?: string): Promise<void> {
    const client = this.requireClient()
    const generation = this.generation
    const cwd = this.cwd
    const selectionGeneration = this.historyWindowGeneration
    const current = (): boolean => this.client === client && this.generation === generation && this.cwd === cwd
    const { items } = await client.listSessions()
    if (!current()) return
    const shadow = extDeletedSessions()
    this.summaries = items.filter(summary => (
      sameCwd(summary.cwd, this.cwd) && summary.origin !== 'subagent' && !shadow.has(summary.sessionId)
    ))
    /* 0.1.89（用户需求）：子代理会话单独记一份（不展示、但可搜索/可跳转打开）。 */
    this.subagentSessions = new Map(items
      .filter(summary => sameCwd(summary.cwd, this.cwd) && summary.origin === 'subagent' && !shadow.has(summary.sessionId))
      .map(summary => [summary.sessionId, summary]))
    /* 0.0.88：preferredId 只在确实存在时生效（持久化的"上次会话"可能已删除或不属于本项目）。 */
    if (preferredId !== undefined && !this.summaries.some(summary => summary.sessionId === preferredId)) preferredId = undefined
    /* 0.0.70: 列表重建（如新建会话触发）时从基线缓存回填——冷会话的投影值不因重建而丢失 */
    for (const summary of this.summaries) this.applyProjectionBaseline(summary.sessionId, summary)
    // Runtime resumes from disk after a restart: ids the RPC no longer
    // returns are gone for good, so retire them from the shadow set.
    const live = new Set(items.map(summary => summary.sessionId))
    let shadowDirty = false
    for (const id of shadow) {
      if (!live.has(id)) {
        shadow.delete(id)
        shadowDirty = true
      }
    }
    if (shadowDirty) void EXT_CONTEXT?.workspaceState.update('dshDeletedSessions', [...shadow])
    const currentStillExists = this.summaries.some(summary => summary.sessionId === this._state.sessionId)
    // G22 bug⑥: 有未发送草稿（文本/图片/文件卡）的 blank 会话不隐藏——删别的会话后名单刷新
    // 会把"输入过文字/上传过文件但未发送"的会话误过滤掉（用户 2026-09-01 实测）。
    // G22 bug⑥a: 用户打开过的空白会话（连草稿都没有）同样不隐藏——删/恢复别的会话后名单
    // 刷新会把"新开过但没输入"的会话也误过滤掉（用户 2026-09-01 实测）。
    const visible = this.summaries.filter(summary => !summary.blank
      || summary.sessionId === preferredId
      || this.draftfulSessions.has(summary.sessionId)
      || this.visitedSessions.has(summary.sessionId))
    // After every conversation is trashed the runtime may re-fill several blank
    // placeholders (or none at all). Publishing nothing leaves an empty panel,
    // publishing them all shows a dozen tabs; surface exactly one so a single
    // un-deletable "New conversation" appears automatically.
    const list = visible.length > 0 || this.summaries.length === 0 ? visible : this.summaries.slice(0, 1)
    // G5 v9: 'persisted' 模式按持久化顺序重排可见列表（拖拽/新建/恢复都会写入 dshSessionOrder）
    const orderedList = this.applySessionOrder(list)
    // G22 bug⑥a: 已访问的空 blank 也进入 list 后，启动/刷新时仍优先选中非 blank 会话（保持旧行为）。
    const selectedId = preferredId
      ?? (currentStillExists ? this._state.sessionId : undefined)
      ?? (list.find(summary => !summary.blank)?.sessionId ?? list[0]?.sessionId)

    const recycle = await this.recycleView()
    if (!current()) return
    this.publish({
      sessions: orderedList.map(summary => ({
        id: summary.sessionId,
        title: titleOf(summary),
        running: summary.running === true,
        blank: summary.blank === true,
        updatedAt: summary.updatedAt,
        ...(this.sessionCreatedAt.has(summary.sessionId)
          ? { createdAt: this.sessionCreatedAt.get(summary.sessionId)! }
          : {}),
      })),
      recycle: recycle.items,
      recycleOthers: recycle.others,
    })
    // A background list refresh must not reclaim a session selected while its RPC was pending.
    if (selectionGeneration !== this.historyWindowGeneration) return
    if (selectedId === undefined) {
      const created = await client.createSession(this.cwd)
      if (!current()) return
      this.rememberSessionCreatedAt(created.sessionId)
      if (selectionGeneration !== this.historyWindowGeneration) { await this.loadSessions(); return }
      await this.loadSessions(created.sessionId)
      return
    }
    // The current session is still live and unchanged (e.g. a non-current
    // session was deleted): refresh the list only, no history reload flicker.
    if (selectedId === this._state.sessionId && this._state.sessionId !== '') return
    await this.loadSession(selectedId)
  }

  private async loadSession(sessionId: string): Promise<void> {
    const generation = ++this.historyWindowGeneration
    this.historyNavigationGeneration += 1
    const load = { sessionId, task: this.fetchSessionHistory(sessionId, generation) }
    this.sessionHistoryLoad = load
    try { await load.task } finally { if (this.sessionHistoryLoad === load) this.sessionHistoryLoad = undefined }
  }

  private async fetchSessionHistory(sessionId: string, generation: number): Promise<void> {
    // G22 bug⑥a: 用户打开/切换到某会话即记为已访问——之后删别的会话时它不会因 blank 过滤而消失。
    this.rememberVisited(sessionId)
    /* 0.0.88：记住本项目当前会话——重启运行时/重载窗口后自动恢复。 */
    rememberActiveSession(this.cwd, sessionId)
    const client = this.requireClient()
    const current = (): boolean => this.client === client && this.historyWindowGeneration === generation && this._state.sessionId === sessionId
    const cachedWindow = this.historyBySession.get(sessionId)
    // This window also receives live events while history/model RPCs are pending.
    this.historyEntries = cachedWindow?.entries ?? []
    this.projector.reset(this.historyEntries)
    this.replayUsageLedger(this.historyEntries)
    this.resetTurnMeta()
    for (const entry of this.historyEntries) this.markTurnMeta(entry.event)
    this.publish({
      phase: 'loading',
      statusText: '正在加载项目会话…',
      sessionId,
      hasMoreHistory: cachedWindow?.hasMore ?? false,
      loadingHistory: false,
    })
    let events: Awaited<ReturnType<typeof client.history>>['events']
    let hasMore: boolean
    let models: Awaited<ReturnType<typeof client.models>>
    let projectionBaseline: ProjectionBlock | undefined
    /* 0.0.154（O3 会话加载机制）：窗口缓存命中 → 只拉一页 catch-up 与缓存合并（切回零重置——
       位置/菱形/跳转全保持）；未命中 → 大页全量拉取（loadAll 开时按上限一次拉满，超出自动降级分页）。 */
    try {
      /* 0.1.53（D6-0）：缓存命中时只拉**一小页** catch-up。此前统一传 undefined beforeSeq + 大上限，
         语义是"最新一页（最多 maxMessages 条**消息**）"——长会话（消息数 < 上限）下等于**整个会话**，
         真机日志实证：`catch-up +9034 → 9034 events`、该段 ≈984ms（缓存省了重建、没省下载+解析）。
         小页与缓存尾部接不上时（离开期间新增超过一页）回退为原来的大页拉取（最坏 = 旧行为）。 */
      const catchUpPageMessages = 100
      let page = cachedWindow === undefined
        ? await client.history(sessionId, undefined, this.historyPullLimit())
        : await client.history(sessionId, undefined, Math.min(this.historyPullLimit(), catchUpPageMessages))
      if (!current()) return
      if (cachedWindow !== undefined && !catchUpCoversTail(cachedWindow.entries, page.events, page.hasMore)) {
        this.output.appendLine(`[history] ${sessionId}: catch-up 小页与缓存不连续（离开期间新增 > ${String(catchUpPageMessages)} 条）→ 回退全量页`)
        page = await client.history(sessionId, undefined, this.historyPullLimit())
        if (!current()) return
      }
      models = await client.models(sessionId)
      if (!current()) return
      events = mergeHistoryEntries(this.historyEntries, page.events)
      if (cachedWindow !== undefined) {
        /* 2026-10-06（滚顶案）：四输入留痕——hasMore 误判类问题可据此逐行对账
           （pageEarliest/cachedEarliest/pageHasMore/cachedHasMore ⇒ deeperFromPage 取值来源一目了然）。 */
        const pageEarliest = earliestHistorySequence(page.events)
        const cachedEarliest = earliestHistorySequence(cachedWindow.entries)
        hasMore = mergedWindowHasMore(pageEarliest, cachedEarliest, page.hasMore, cachedWindow.hasMore)
        const counts = historySequenceCounts(events)
        this.output.appendLine(`[history] ${sessionId}: catch-up +${String(page.events.length)} → ${String(events.length)} events, hasMore=${String(hasMore)} [pageE=${String(pageEarliest)} cachedE=${String(cachedEarliest)} pageHM=${String(page.hasMore)} cachedHM=${String(cachedWindow.hasMore)} seq+=${String(counts.nonnegative)} seq-=${String(counts.negative)} invalidSeq=${String(counts.invalid)} duplicateSeq=${String(counts.duplicate)}]`)
      } else {
        hasMore = page.hasMore
        this.output.appendLine(`[history] ${sessionId}: full-load ${String(events.length)} events, hasMore=${String(hasMore)}`)
      }
      projectionBaseline = page.projections
    } catch (error) {
      // B-report P0 (0.0.33): a failing RPC used to leave phase 'loading' forever,
      // which silently disables new-session/tab switching. Surface the error instead.
      if (!current()) return
      this.publish({ phase: 'error', statusText: 'Failed to load conversation: ' + (error instanceof Error ? error.message : String(error)) })
      return
    }
    if (!current()) return
    this.projector.reset(events)
    this.replayUsageLedger(events)
    this.resetTurnMeta()
    // G5: 恢复路径重放 turn 打点——实时帧走 acceptFrame；历史帧在此重建 drafts，meta 才能注入（0.0.39 缺此步：旧会话无时钟药丸）
    for (const entry of events) this.markTurnMeta(entry.event)
    this.historyEntries = events
    /* 2026-10-06（滚顶案根治）：显式传本次加载算出的真值——旧实现在此处读 state，而 state 此刻
       仍是本次加载开头 loading publish 的 false ⇒ 缓存被毒化（切走切回即翻假三路死）。 */
    this.rememberHistoryWindow(sessionId, hasMore)
    this.guardedDirtyCalls.clear()
    this.queueRawText.clear()
    const summary = this.summaries.find(item => item.sessionId === sessionId)
    /* 0.0.70: 历史尾页的投影基线回填进摘要——冷会话（session.list 行无投影块）切换后
       用量行/圆环/上下文/权限/计划即时可用，不再依赖后续是否有实时帧。 */
    if (projectionBaseline !== undefined) this.projectionBaselines.set(sessionId, projectionBaseline)
    this.applyProjectionBaseline(sessionId, summary)
    const selectionView = summary?.projections?.values?.modelSelection ?? projectionBaseline?.values?.modelSelection
    const durableSelection = typeof selectionView === 'object' && selectionView !== null ? (selectionView as { next?: ModelSelection }).next : undefined
    if (typeof durableSelection?.provider === 'string' && typeof durableSelection.model === 'string') this.modelSelections.set(sessionId, durableSelection)
    this.maybeFetchContextDetail(summary)
    /* 0.0.89：历史基线带完整标题（陈旧列表块没有）→ 学到即落盘，标签就地纠正（重启后保持）。 */
    this.syncLearnedTitle(sessionId, summary)
    /* 2026-10-05（A）：会话加载是新上下文——提问别名集与暂存提交一并作废（提问若仍未决，
       会随重连重放重新到达）。 */
    this.questionRpcIds.clear()
    this.clearParkedSubmission()
    this.publish({
      phase: 'ready',
      statusText: '',
      sessionId,
      ...this.messagesPatch(),
      running: summary?.running ?? false,
      approval: client.pendingApproval(sessionId),
      question: null,
      commands: [],
      skills: [],
      agentPreset: unavailableAgentPresetState(),
      usage: this.usageWithCost(summary),
      context: contextPanelStateOf(this.contextValuesWithDetail(summary)),
      turnOutline: turnOutlineOf(summary?.projections?.values?.turnOutline),
      imageLimits: imageLimitsOf(summary?.projections?.values?.imageLimits),
      permissions: [],
      plan: planModeWithCommandAvailability(planModeStateOf(summary?.projections?.values?.plan), false),
      changedFiles: this.diffReviews.rebuild(sessionId, this.cwd, events),
      queue: [],
      jobs: this.jobsBySession.get(sessionId) ?? [],
      hasMoreHistory: hasMore,
      loadingHistory: false,
      ...this.modelPatch(models),
    })
    /* 0.1.124（数据层根治）：会话打开 → 表层下发轨道表（缓存/落盘即发；缺表按需补算后补发）。 */
    this.onSessionOpened?.(sessionId)
    this.hydrateImages(client, sessionId)
    /* 0.1.10：会话打开即刷新"运行中 Enter 模式"（运行时设置可能刚被设置台改动）。 */
    void this.refreshBusyEnterMode()
    void this.loadCommands(client, sessionId)
    void this.loadSkills(client, sessionId)
    void this.loadAgentPresets(client, sessionId)
    void this.loadPermissions(client, sessionId, summary?.projections?.values?.permissions ?? projectionBaseline?.values?.permissions)
  }

  private async loadCommands(client: DshClient, sessionId: string): Promise<void> {
    try {
      const commands = await client.listCommands(sessionId)
      if (this.client === client && this._state.sessionId === sessionId) {
        const visibleCommands = commands.filter(command => command.name !== 'export')
        this.publish({
          commands: visibleCommands,
          plan: planModeWithCommandAvailability(
            this._state.plan,
            visibleCommands.some(command => command.name === 'plan'),
          ),
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.output.appendLine(`[commands] Discovery unavailable: ${message}`)
    }
  }

  /* 0.0.168（B4 反馈）：跨会话内容检索——运行时 sessionQuery 全文索引（消息文本 / 工具调用
     参数里的文件路径 / 工具输出）。**该索引在 0.1.5 系默认 opt-in 关闭**（openAt: never）：
     关闭时宿主回 SESSION_QUERY_SEARCH_DISABLED 错误，这里原样把错误消息交回视图层降级展示。 */
  /* 0.0.170（用户反馈②③）：本工作区内容索引的构建原料——会话清单（updatedAt 作增量 revision）。 */
  searchIndexSessions(): Array<{ sessionId: string; revision: number; title: string; updatedAt: number }> {
    return this.summaries
      .filter(summary => sameCwd(summary.cwd, this.cwd))
      .map(summary => ({
        sessionId: summary.sessionId,
        revision: typeof summary.updatedAt === 'number' ? summary.updatedAt : 0,
        title: titleOf(summary),
        updatedAt: typeof summary.updatedAt === 'number' ? summary.updatedAt : 0,
      }))
  }

  /** 0.0.170：拉一个会话的投影消息（独立 projector，不干扰界面态与历史窗口缓存）。
      0.0.171：改走 historyQuiet——**不动 follow 流**（否则逐会话建索引会把当前会话的订阅
      抢走，视图跟着来回跳；用户实测"搜索时会话来回跳/像新建了对话"）。 */
  async projectSessionMessages(sessionId: string): Promise<ConversationMessage[]> {
    const client = this.requireClient()
    /* 0.1.97（真机反馈：中段内容搜不到）：索引构建**专用**更深拉取——历史窗口上限（默认 3000 事件）
       会把巨型会话的早期内容整段排除在索引之外（EUV 主会话 9035 事件 ⇒ 只索引到尾部）。
       0.1.110（审查低7）：`Math.max` 实为常量——`historyPullLimit()` 由 dsh 设置钳位到 20000，
       故这里恒为 20000；保留 max 只是防御（钳位若放宽仍取更大者），但别再当它是"跟随设置"。 */
    const page = await client.historyQuiet(sessionId, Math.max(this.historyPullLimit(), 20_000))
    if (this.client !== client) return []
    const projector = new ConversationProjector()
    projector.reset(page.events)
    /* 2026-10-06（W2，性能）：消费方 buildSessionEntries 只读平字段——用只读轻迭代替代全量拷贝
       （真机剖面：索引重建期本调用为装配链大头之一；字段逐位一致，见 conversation.ts 注释）。 */
    return projector.iterMessages()
  }

  /** 0.1.123（G55 Phase 3）：索引构建专用——同一拉取里额外交出「轨道节点表」复算输入。
      0.1.125（数据层根治·真机反例）：表窗口**多页补拉到全会话**——原实现按 `historyPullLimit()`
      （= 用户设置 ≈3000 事件）切片 ⇒ "全量表"实际只覆盖尾部（视频会话实测 48 节点 = 35 前缀轮 +
      13 真段；且窗口首元素 seq 8 > 首轮 turn/start seq 4 ⇒ 首节点成永久幽灵点不动）。
      条目仍取首页（搜索口径不变）；首页后最多补拉 RAIL_PULL_MAX_PAGES 次，
      RAIL_PULL_MAX_EVENTS 是发下一页前的门槛；超限头部从小页元数据恢复详细节点。
      分页未取完时，逐页扫描轻量消息身份/停点元数据；不保留早期正文，不打开 follow。
      事件已完整时直接派生，无需另开流。 */
  async projectSessionWithRail(sessionId: string, signal?: AbortSignal): Promise<{ messages: ConversationMessage[]; rail: RailNodeTables }> {
    const client = this.requireClient()
    signal?.throwIfAborted()
    const page = await client.historyQuiet(sessionId, Math.max(this.historyPullLimit(), 20_000), undefined, signal)
    signal?.throwIfAborted()
    if (this.client !== client) return { messages: [], rail: { segment: [], turn: [] } }
    let railEvents = page.events
    let railHasMore = page.hasMore === true
    for (let guard = 0; guard < RAIL_PULL_MAX_PAGES && railHasMore && railEvents.length < RAIL_PULL_MAX_EVENTS; guard += 1) {
      const cursor = earliestHistorySequence(railEvents)
      if (cursor === undefined) break
      const older = await client.historyQuiet(sessionId, 20_000, cursor, signal)
      signal?.throwIfAborted()
      if (this.client !== client) return { messages: [], rail: { segment: [], turn: [] } }
      if (older.events.length === 0) break
      const olderEarliest = earliestHistorySequence(older.events)
      /* 防呆（审查补）：页面未推进（服务端返回同页/更晚页）⇒ 立即停——绝不把同一页重复并入。 */
      if (olderEarliest === undefined || olderEarliest >= cursor) break
      railEvents = mergeHistoryEntries(railEvents, older.events)
      railHasMore = older.hasMore === true
    }
    const projector = new ConversationProjector()
    projector.reset(page.events)
    const fullMessages = projector.iterMessages()
    if (railHasMore) {
      const scanned = await readHistoryRail(client, sessionId, railEvents, signal)
      signal?.throwIfAborted()
      if (this.client !== client) return { messages: [], rail: { segment: [], turn: [] } }
      return { messages: fullMessages, rail: scanned.rail }
    }
    const railProjector = new ConversationProjector()
    railProjector.reset(railEvents)
    const railMessages = railProjector.iterMessages()
    const turnStarts: number[] = []
    for (const entry of railEvents) {
      const event = entry.event
      if (event !== undefined && event !== null && event.type === 'turn/start' && typeof event.seq === 'number' && Number.isFinite(event.seq)) turnStarts.push(event.seq)
    }
    /* 派生 prompt 必须用**全量**消息（A/B 逮到：只喂窗口 ⇒ 窗口前轮全被误判为空 prompt ⇒ 前缀恒空）。
       0.1.125：全量 = 多页合并后的 railMessages（同一次补拉，覆盖更大）。 */
    const derivedPieces = deriveOutlinePieces(turnStarts, railMessages)
    /* 完整事件是此次历史截面的真值；有界窗口外的大纲前缀是正常覆盖差异，不记作漂移。 */
    const outline = derivedPieces
    const rail = buildRailNodeTables({
      messages: railMessages,
      stops: railProjector.segmentStops(),
      outline,
    })
    return { messages: fullMessages, rail }
  }

  async searchHistory(sessionId: string, query: string, excludes: readonly string[], signal?: AbortSignal): Promise<SearchIndexHit[]> {
    const client = this.requireClient()
    const hits = await scanSessionHistory(client, sessionId, query, excludes, signal)
    signal?.throwIfAborted()
    return this.client === client ? hits : []
  }

  async searchSessions(query: string, signal?: AbortSignal): Promise<{ items: Array<{ sessionId: string; snippet: string; title: string; foreign: boolean; subagent: boolean }>; hasMore: boolean }> {
    const client = this.requireClient()
    const result = await client.searchSessions(query, signal)
    signal?.throwIfAborted()
    if (this.client !== client) return { items: [], hasMore: false }
    const items = Array.isArray(result.items)
      ? result.items
        .filter(item => item !== null && typeof item === 'object' && typeof item.sessionId === 'string' && typeof item.snippet === 'string')
        .map(item => ({ sessionId: item.sessionId, snippet: item.snippet }))
      : []
    if (items.length === 0) return { items: [], hasMore: result.hasMore === true }
    /* 0.0.169（用户反馈）：命中默认只带 {sessionId, snippet}——面板此前显示裸 id、且跨工作区
       会话本侧栏打不开（selectSession 的 cwd 守卫会静默 no-op）。这里用全量列表补标题 +
       工作区归属：`foreign` = 命中会话不属于当前工作区（视图层据此换"不可打开"反馈）。
       0.1.89（用户需求）：本工作区的**子代理会话**（origin=subagent）单独标 `subagent`——
       它们不在本地索引覆盖范围（侧栏不列出），但运行时全文索引覆盖 ⇒ 视图层放行并标「子代理」。 */
    const meta = new Map<string, { title: string; foreign: boolean }>()
    try {
      const { items: all } = await client.listSessions(signal)
      if (this.client !== client) return { items: [], hasMore: false }
      for (const summary of all) meta.set(summary.sessionId, { title: titleOf(summary), foreign: !sameCwd(summary.cwd, this.cwd) })
    } catch { /* 列表失败退化为"仅 id" */ }
    signal?.throwIfAborted()
    return {
      items: items.map(item => {
        const found = meta.get(item.sessionId)
        return {
          ...item,
          title: found?.title ?? '',
          foreign: found?.foreign ?? false,
          subagent: this.subagentSessions.has(item.sessionId),
        }
      }),
      hasMore: result.hasMore === true,
    }
  }

  private permissionLoadRevision = 0

  private async loadPermissions(client: DshClient, sessionId: string, selection: unknown): Promise<void> {
    const revision = ++this.permissionLoadRevision
    try {
      const catalog = await client.permissionCatalog()
      if (this.client !== client || this._state.sessionId !== sessionId || revision !== this.permissionLoadRevision) return
      this.publish({ permissions: permissionPresetsOf(selection, catalog) })
    } catch (error) {
      if (this.client !== client || this._state.sessionId !== sessionId || revision !== this.permissionLoadRevision) return
      this.publish({ permissions: [] })
      this.output.appendLine(`[permissions] Discovery unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async loadSkills(client: DshClient, sessionId: string): Promise<void> {
    try {
      const skills = await client.listSkills(sessionId)
      if (this.client === client && this._state.sessionId === sessionId) this.publish({ skills })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.output.appendLine(`[skills] Discovery unavailable: ${message}`)
    }
  }

  private async loadAgentPresets(client: DshClient, sessionId: string): Promise<void> {
    try {
      const roster = await client.listAgentPresets()
      if (this.client !== client || this._state.sessionId !== sessionId) return
      const summary = this.summaries.find(item => item.sessionId === sessionId)
      // RC4 persists the preset in projections; the top-level value is only our
      // live selection cache and is absent after session/list or a cold reopen.
      const projected = summary?.projections?.values?.agentPreset
      const selected = summary?.agentPreset ?? (typeof projected === 'string' ? projected : undefined)
      this.publish({ agentPreset: agentPresetStateOf(roster.presets, selected, summary?.blank ?? false) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.output.appendLine(`[agent-preset] Discovery unavailable: ${message}`)
    }
  }

  private async loadModels(sessionId: string): Promise<void> {
    const client = this.requireClient()
    const models = await client.models(sessionId)
    if (this.client === client && this._state.sessionId === sessionId) {
      this.publish(this.modelPatch(models))
      this.publish({ usage: this.usageWithCost(this.summaries.find(summary => summary.sessionId === sessionId)) })
    }
  }

  private modelPatch(models: SessionModels): Pick<ChatViewState, 'models' | 'routable'> {
    const projected = this.projectionBaselines.get(this._state.sessionId)?.values?.modelSelection
    const next = typeof projected === 'object' && projected !== null ? (projected as { next?: ModelSelection }).next : undefined
    const selected = this.modelSelections.get(this._state.sessionId) ?? next ?? models.current
    this.modelSelections.set(this._state.sessionId, selected)
    models = { ...models, current: selected }
    const options: ModelItem[] = []
    const sortedGroups = models.current.provider === ''
      ? models.groups
      : [...models.groups].sort((left, right) => Number(right.id === models.current.provider) - Number(left.id === models.current.provider))
    for (const group of sortedGroups) {
      for (const model of group.models) {
        const selected = group.id === models.current.provider && model.id === models.current.model
        options.push({
          provider: group.id,
          providerLabel: group.name,
          model: model.id,
          label: model.name,
          selected,
          reasoningEfforts: (model.reasoning?.efforts ?? []).map(effort => ({
            id: effort.id,
            label: effort.name,
            selected: selected && effort.id === models.current.reasoningEffort,
          })),
          ...(model.reasoning?.defaultEffort === undefined
            ? {}
            : { defaultReasoningEffort: model.reasoning.defaultEffort }),
        })
      }
    }
    return {
      models: dedupeModelOptions(options),
      routable: models.routable && options.some(option => option.selected),
    }
  }

  private acceptFrame(frame: DshFrame): void {
    const payload = frame.payload
    const type = typeof payload.type === 'string' ? payload.type : ''
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''

    if (frame.channel === 'mux' && type === 'session/event' && sessionId === this._state.sessionId) {
      const event = payload.event
      if (typeof event === 'object' && event !== null) {
        const dshEvent = event as DshEvent
        if (dshEvent.type === 'model/selection') {
          const selection = dshEvent.data as ModelSelection
          if (typeof selection?.provider === 'string' && typeof selection?.model === 'string') {
            this.modelSelections.set(sessionId, selection)
            void this.loadModels(sessionId).catch(() => {})
          }
        }
        if (dshEvent.type === 'user/message') {
          const summary = this.summaries.find(item => item.sessionId === sessionId)
          if (summary !== undefined) summary.blank = false
          this.publish({ agentPreset: lockAgentPresetState(this._state.agentPreset) })
        }
        if (dshEvent.type === 'agent-preset/selected') {
          const data = typeof dshEvent.data === 'object' && dshEvent.data !== null
            ? dshEvent.data as Record<string, unknown>
            : undefined
          const agentPreset = typeof data?.agentPreset === 'string' ? data.agentPreset : undefined
          if (agentPreset !== undefined) {
            const summary = this.summaries.find(item => item.sessionId === sessionId)
            if (summary !== undefined) summary.agentPreset = agentPreset
            this.publish({
              agentPreset: selectAgentPresetState(this._state.agentPreset, agentPreset, false),
              commands: [],
              skills: [],
            })
            const client = this.client
            if (client !== undefined) {
              void this.loadCommands(client, sessionId)
              void this.loadSkills(client, sessionId)
            }
          }
        }
        /* 0.1.3：运行态兜底——running 原本只由 api-session/status 瞬时帧驱动（帧一旦丢失
           即永久卡"运行中"）；turn/end 是可靠会话事件（断线重连会重放），作为第二真理源。
           若后续还有排队轮次，运行时随即可再发 running=true，短暂回落无碍。 */
        if (dshEvent.type === 'turn/end' && this._state.running === true) {
          const summary = this.summaries.find(item => item.sessionId === sessionId)
          if (summary !== undefined) summary.running = false
          this.publish({ running: false, sessions: this._state.sessions.map(item => item.id === sessionId ? { ...item, running: false } : item) })
        }
        /* 2026-10-05（D）：完成判定的可信运行态——turn/end 只在**实时到达**时计入；
           补差重放的历史 turn/end 不算（见 dsh-client 的 replayed 标记）。 */
        if (dshEvent.type === 'turn/end' && payload.replayed !== true) this.trustedRunningBySession.set(sessionId, false)
        /* 0.1.89（用户报①：搜 "test" 第三个会话无结果）：回合结束即刷新**本会话**的索引条目——
           运行时列表的 updatedAt 会滞后于实际内容（真机实证：索引条目 rev=createdAt 而内容已是
           回合后），只靠 revision 跳过会漏掉"刚回复完就搜"的新内容。视图层据此用投影器现成消息
           直写（零 RPC，内容即时新鲜）；有面板在展示时随即重推结果。 */
        if (dshEvent.type === 'turn/end') this.onTurnEnded?.(sessionId)
        /* 2026-10-06（S3/摊销，性能）：实时事件就地合入（不再整表 slice；慢路径自动回落）。 */
        this.historyEntries = appendLiveEntry(this.historyEntries, { event: dshEvent, view: payload.view })
        /* Opening RPCs have not established the head yet. Keep the existing cached boundary;
           never cache a cold live-only tail as an authoritative hasMore=false window. */
        if (this.sessionHistoryLoad?.sessionId !== sessionId) this.rememberHistoryWindow(sessionId, this._state.hasMoreHistory)
        // G5 打点：turn 开始 / 首帧 time / settled 结算（meta 注入见 projectedMessages）
        this.markTurnMeta(dshEvent)
        const conflict = this.dirtyConflict(dshEvent, payload.view)
        if (conflict !== undefined) void this.cancelForDirtyConflict(conflict)
        this.usageLedger.applyEvent(dshEvent)
        this.projector.apply(dshEvent, payload.view)
        if (dshEvent.type === 'user/message') this.attachUserEventSeq(sessionId, dshEvent.seq)
        /* 2026-10-06（W8b，性能）：重放事件透传 replay 旗标——跳过逐条磁盘读图
           （accept 早有该形参，仅此处调用未传；真机剖面重放期 readImage/realpath 链 ~1.4s/27min）。 */
        const changed = this.diffReviews.accept(sessionId, this.cwd, dshEvent, payload.view, payload.replayed === true)
        if (conflict !== undefined) {
          const label = conflict.paths.length === 1
            ? `\`${conflict.paths[0] ?? '文件'}\``
            : `${String(conflict.paths.length)} 个文件`
          this.projector.notice(
            `dirty-file:${conflict.callId}`,
            `DeepSeek 已停止：${label} 有未保存的 VS Code 更改。请保存或放弃后重试。`,
            true,
          )
        }
        this.publish({
          ...this.messagesPatch(),
          ...(changed ? { changedFiles: this.diffReviews.changedFiles(sessionId) } : {}),
        })
        this.hydrateImages(this.requireClient(), sessionId)
      }
      return
    }

    if (frame.channel === 'mux' && type === 'session/subscribed' && sessionId === this._state.sessionId) {
      this.queueRawText.clear()
      this.jobsBySession.delete(sessionId)
      this.publish({ queue: [], jobs: [] })
      return
    }

    if (frame.channel === 'mux' && type === 'session/subscribed') {
      this.jobsBySession.delete(sessionId)
      return
    }

    if (frame.channel === 'mux' && type === 'session/jobs') {
      const jobs = jobsSnapshotOf(payload.jobs)
      if (jobs.length > 0) this.jobsBySession.set(sessionId, jobs)
      else this.jobsBySession.delete(sessionId)
      if (sessionId === this._state.sessionId) this.publish({ jobs })
      return
    }

    if (frame.channel === 'mux' && type === 'session/queue' && sessionId === this._state.sessionId) {
      const snapshot = queueSnapshotOf(payload.items)
      this.queueRawText = snapshot.rawText
      this.publish({ queue: snapshot.items })
      return
    }

    if (frame.channel === 'mux' && type === 'approval/requested' && sessionId === this._state.sessionId) {
      if (typeof payload.approvalId !== 'string' || typeof payload.toolName !== 'string') return
      this.publish({
        approval: {
          rpcId: frame.rpcId,
          approvalId: payload.approvalId,
          toolName: payload.toolName,
          ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {}),
        },
      })
      return
    }

    if (frame.channel === 'mux' && type === 'approval/resolved' && sessionId === this._state.sessionId) {
      if (this._state.approval?.approvalId === payload.approvalId) this.publish({ approval: null })
      return
    }

    if (frame.channel === 'mux' && type === 'question/requested' && sessionId === this._state.sessionId) {
      if (!Array.isArray(payload.questions)) return
      const questions = payload.questions.flatMap((value): QuestionItem[] => {
        if (typeof value !== 'object' || value === null) return []
        const item = value as Record<string, unknown>
        if (typeof item.id !== 'string' || typeof item.question !== 'string') return []
        const options = Array.isArray(item.options)
          ? item.options.flatMap((option): QuestionOption[] => {
            if (typeof option !== 'object' || option === null) return []
            const candidate = option as Record<string, unknown>
            if (typeof candidate.label !== 'string') return []
            return [{
              label: candidate.label,
              ...(typeof candidate.description === 'string' ? { description: candidate.description } : {}),
            }]
          })
          : []
        return [{
          id: item.id,
          question: item.question,
          ...(typeof item.detail === 'string' ? { detail: item.detail } : {}),
          ...(typeof item.header === 'string' ? { header: item.header } : {}),
          options,
          multiSelect: item.multiSelect === true,
        }]
      })
      if (questions.length > 0) {
        /* 0.1.112（真机事故：ws 空闲被服务端断开 ⇒ 每次重连重放 question/requested）：**重放去重**——
           同一组提问（id 集合与文案一致）再次到达时**不换状态对象**（换对象 ⇒ webview 尾部重渲 ⇒
           提问卡重建：用户填的「其他」被清空、焦点丢失）。rpcId 就地更新（结算时按 id 取当前 rpcId，见
           answerQuestions），且**不 publish**（引用不变，视图侧守卫自然跳过）。 */
        const pendingQuestion = this._state.question
        const sameAsPending = pendingQuestion !== null
          && pendingQuestion.questions.length === questions.length
          && pendingQuestion.questions.every((old, index) => {
            const fresh = questions[index]
            return fresh !== undefined && old.id === fresh.id && old.question === fresh.question
          })
        if (sameAsPending && pendingQuestion !== null) {
          pendingQuestion.rpcId = frame.rpcId
        } else {
          this.publish({ question: { rpcId: frame.rpcId, questions } })
        }
        /* 2026-10-05（A）：rpcId 别名集（resolved 匹配用）+ 本次重放可能带来新一轮活流——
           若存在同提问的暂存提交，趁活窗口自动重投。 */
        this.questionRpcIds.add(frame.rpcId)
        this.retryParkedSubmission()
      }
      return
    }

    if (frame.channel === 'mux' && type === 'question/resolved' && sessionId === this._state.sessionId) {
      /* 2026-10-05（A 同族修复）：按**别名集**匹配——换代（rpcId 每轮重放都变）后服务端撤销
         提问时，旧实现只认当前 rpcId ⇒ 匹配不上、卡片赖着不清。撤销即结算（含清暂存）。 */
      if (typeof payload.questionRpcId === 'string' && this.questionRpcIds.has(payload.questionRpcId)) {
        connLog(this.output, `question resolved by server q=${shortId(String(payload.questionRpcId))}`)
        this.settleQuestion()
      }
      return
    }

    if (frame.channel === 'mux' && type === 'session/projection') {
      const summary = this.summaries.find(item => item.sessionId === sessionId)
      if (summary !== undefined && typeof payload.key === 'string') {
        summary.projections = {
          ...summary.projections,
          ...(typeof payload.seq === 'number' ? { asOfSeq: Math.max(summary.projections?.asOfSeq ?? -1, payload.seq) } : {}),
          values: { ...summary.projections?.values, [payload.key]: payload.value },
        }
      }
      if (typeof payload.value === 'string' && payload.key === 'title') {
        /* 0.0.88/0.0.89：标题持久化 + 列表标签同步（手动重命名优先，不被覆盖）。 */
        this.syncLearnedTitle(sessionId, this.summaries.find(item => item.sessionId === sessionId))
      }
      if (payload.key === 'imageLimits' && sessionId === this._state.sessionId) {
        this.publish({ imageLimits: imageLimitsOf(payload.value) })
      }
      if (payload.key === 'permissions' && sessionId === this._state.sessionId) {
        if (this.client) void this.loadPermissions(this.client, sessionId, payload.value)
      }
      /* G49 v2（0.0.121）：官方 turnOutline 投影——全量轮次大纲（含尚未分页加载的轮）。 */
      if (payload.key === 'turnOutline' && sessionId === this._state.sessionId) {
        this.publish({ turnOutline: turnOutlineOf(payload.value) })
      }
      if (payload.key === 'plan' && sessionId === this._state.sessionId) {
        this.publish({ plan: planModeWithCommandAvailability(planModeStateOf(payload.value), this._state.commands.some(command => command.name === 'plan')) })
      }
      if ((payload.key === 'tokenUsage'
        || payload.key === 'sessionStats'
        || payload.key === 'contextPressure'
        || payload.key === 'contextBreakdown'
        || payload.key === 'contextTimeline')
        && sessionId === this._state.sessionId) {
        this.publish({
          usage: this.usageWithCost(summary),
          // C3: 仅 timeline 帧带 context（其余帧该值不变，避免无谓 patch）
          ...(payload.key === 'contextTimeline' ? { context: contextPanelStateOf(this.contextValuesWithDetail(summary)) } : {}),
        })
        if (payload.key === 'contextTimeline') this.maybeFetchContextDetail(summary)
        // G5: sessionStats 快照差分 → assistant tok/s（近似，多 turn 时累计差）
        this.ingestSessionStatsValue(summary?.projections?.values?.sessionStats)
      }
      return
    }

    if (frame.channel === 'host' && type === 'host/permission-catalog-changed') {
      const current = this.summaries.find(item => item.sessionId === this._state.sessionId)
      if (this.client && current) void this.loadPermissions(this.client, current.sessionId, current.projections?.values?.permissions)
      return
    }

    if (frame.channel === 'host' && type === 'host/socket-open') {
      /* 0.1.3：断线重连补差——瞬时状态帧不重放，重连后主动拉一次会话列表重同步 running。 */
      connLog(this.output, '[reconnect] socket reopened — resync session status')
      void this.resyncRunningState()
      return
    }

    if (frame.channel === 'host' && type === 'host/session-status') {
      const running = payload.running === true
      /* 诊断（C report）："回合不结束"客户端链证据——session-status 是否真的到达 */
      this.output.appendLine(`[session-status] ${sessionId} running=${running} ${new Date().toISOString()}`)
      const summary = this.summaries.find(item => item.sessionId === sessionId)
      if (summary !== undefined) {
        this.runningStatusRevisions.set(sessionId, (this.runningStatusRevisions.get(sessionId) ?? 0) + 1)
        summary.running = running
      }
      /* 2026-10-05（D）：瞬时状态帧是活体信号（不随事件流重放）——喂完成判定的可信运行态。 */
      this.trustedRunningBySession.set(sessionId, running)
      if (sessionId === this._state.sessionId) this.publish({ running })
      this.publish({ sessions: this._state.sessions.map(item => item.id === sessionId ? { ...item, running } : item) })
      return
    }

    if (frame.channel === 'host' && type === 'host/agent-error' && sessionId === this._state.sessionId) {
      const message = typeof payload.message === 'string' ? payload.message : 'DeepSeek Harness 报告了一个代理错误。'
      this.projector.notice(`agent-error:${frame.rpcId}`, message, true)
      /* 2026-10-05（D）：agent 错误=活体终态信号，计入可信运行态（真停下的那种仍应提醒）。 */
      this.trustedRunningBySession.set(sessionId, false)
      this.publish({ ...this.messagesPatch(), running: false })
      return
    }

    if (frame.channel === 'host' && type === 'host/session-added' && sameCwd(typeof payload.cwd === 'string' ? payload.cwd : undefined, this.cwd)) {
      // Runtime discovery is a list update, not a request to leave the user's
      // conversation. Explicit new/fork/restore actions select their own ids.
      void this.loadSessions().catch(error => { this.report(error) })
    }
  }

  /** G49 v2（0.0.121）：消息与其配套的分段元数据一起发布（停点=已应答的审批/提问）。 */
  private messagesPatch(): { messages: ConversationMessage[]; segmentStops: number[] } {
    return { messages: this.projectedMessages(), segmentStops: this.projector.segmentStops() }
  }

  /* 2026-10-06（S3，性能）：L2 视图缓存与数组级复用（详见 projectedMessages 注释）。 */
  private readonly viewMemo = new WeakMap<ConversationMessage, {
    meta: MessageMeta | undefined
    remembered: RememberedMeta | undefined
    attachmentGeneration: number
    view: ConversationMessage
  }>()
  /* 图片解析状态（attachmentResults / origin 存储 / 异步加载完成）任一变化即自增——
     使"含图消息"的视图缓存失效（不含图的消息不受影响）。 */
  private attachmentGeneration = 0
  private projectedView: ConversationMessage[] | undefined

  private bumpAttachmentGeneration(): void { this.attachmentGeneration += 1 }

  private projectedMessages(): ConversationMessage[] {
    const sessionId = this._state.sessionId
    /* 0.1.89（用户报②"回复完了还一直呼吸"）：**终止态不变量**——运行态已落 false 时不允许
       任何流式残留。turn/end 丢帧、订阅窗口错过、历史重放残余等一切路径在此统一收口
       （与胶囊同课：别挂在单条事件路径上，收敛到"给 webview 装配消息"的唯一出口；幂等）。 */
    if (!this._state.running) this.projector.settleStreaming()
    const base = this.projector.messages()
    /* 0.0.56c: 投影出用户消息 = 本次发送已被运行时受理 → 撤销"待还原"标记。
       0.0.58: 移到 map 之前——绑定原图后本帧即可用原图渲染（否则首帧仍显示归一化副本）。 */
    this.settlePendingSend(base)
    const generation = this.attachmentGeneration
    const messages: ConversationMessage[] = new Array(base.length)
    for (let index = 0; index < base.length; index += 1) {
      const message = base[index]!
      const meta: MessageMeta | undefined = this.turnMeta.metaOf(message.id)
      /* 2026-10-06（S3，性能）：L2 视图缓存——按 L1 拷贝身份弱键命中（projector 未变 ⇒ 拷贝未变）；
         键含 meta/remembered 对象身份与图片解析代际。命中复用同一视图对象（结构共享）；
         rememberMeta 只在未命中分支跑（命中 = meta 未变 ⇒ 旧调用本就是返回 false 的空操作）。 */
      let remembered = message.role === 'assistant' ? rememberedMeta(this.sessionTokS, sessionId, message.id) : undefined
      const cached = this.viewMemo.get(message)
      if (cached !== undefined && cached.meta === meta && cached.remembered === remembered
        && (message.images === undefined || cached.attachmentGeneration === generation)) {
        messages[index] = cached.view
        continue
      }
      /* G5 v4（0.0.123 扩展）：实时差分产出的 tokS / 用时 / 首 token 记入持久记忆
         （恢复路径无 stats 差分源，靠记忆补回——此前只记 tokS，切回会话"用时"丢失）。 */
      if (message.role === 'assistant' && meta !== undefined
        && rememberMeta(this.sessionTokS, sessionId, message.id, {
          ...(meta.tokS === undefined ? {} : { tokS: meta.tokS }),
          ...(meta.durationMs === undefined ? {} : { durationMs: meta.durationMs }),
          ...(meta.firstTokenMs === undefined ? {} : { firstTokenMs: meta.firstTokenMs }),
        })) {
        this.persistTokS()
      }
      /* 写入后再读（现行序）：缓存键必须用本次装配实际采用的 remembered 身份。 */
      remembered = message.role === 'assistant' ? rememberedMeta(this.sessionTokS, sessionId, message.id) : undefined
      const metaForView: MessageMeta | undefined = mergeRememberedMeta(meta, remembered)
      const view: ConversationMessage = {
        ...(message.images === undefined
          ? message
          : {
          ...message,
          images: message.images.map(image => {
            /* 0.0.58: 显示层优先用发送留档的原图；无留档回退运行时归一化副本（现状）。 */
            const origin = this.originDisplayOf(sessionId, image)
            return {
              ...image,
              ...(origin !== undefined ? origin : this.attachmentResults.get(sessionId + '\u0000' + image.attachmentId)),
            }
          }),
        }),
        ...(metaForView === undefined ? {} : { meta: metaForView }),
      }
      this.viewMemo.set(message, { meta, remembered, attachmentGeneration: generation, view })
      messages[index] = view
    }
    const withFiles = this.injectMessageFiles(sessionId, messages)
    /* 数组级复用：逐位同引用 ⇒ 直接返回上次数组（stateUpdate 见同引用免 diff）。 */
    if (this.projectedView !== undefined && sameMessageRefs(this.projectedView, withFiles)) return this.projectedView
    this.projectedView = withFiles
    return withFiles
  }

  /** 0.0.58: 显示层原图取数——内存命中直接返回；有落盘记录但未加载则触发一次异步读盘并重绘。 */
  private originDisplayOf(sessionId: string, image: ConversationImage): { data: string; mediaType: ImageMediaType } | undefined {
    const store = ORIGIN_STORE
    if (store === undefined || sessionId === '') return undefined
    const key = sessionId + '\u0000' + image.attachmentId
    const display = this.originDisplays.get(key)
    if (display !== undefined) return display
    const hit = store.cached(sessionId, image.attachmentId)
    if (hit !== undefined) {
      const mediaType = hit.displayMediaType
      /* 0.0.77：放行 image/gif——回显后气泡用原始动图渲染（此前只 png/jpeg/webp，gif 回落运行时静态单帧）。 */
      if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp' && mediaType !== 'image/gif') return undefined
      const loaded: { data: string; mediaType: ImageMediaType } = { data: hit.rawBase64, mediaType }
      this.originDisplays.set(key, loaded)
      return loaded
    }
    if (!store.hasDisplay(sessionId, image.attachmentId)) return undefined
    if (this.originLoads.has(key)) return undefined
    const owner = {}, generation = this.generation
    this.originLoads.set(key, owner)
    void store.dataOf(sessionId, image.attachmentId).then(data => {
      if (this.generation !== generation || this.originLoads.get(key) !== owner) return
      this.originLoads.delete(key)
      const mediaType = data?.displayMediaType
      if (data !== undefined && (mediaType === 'image/png' || mediaType === 'image/jpeg' || mediaType === 'image/webp' || mediaType === 'image/gif')) {
        this.originDisplays.set(key, { data: data.rawBase64, mediaType })
      }
      if (this.originDisplays.has(key) && this._state.sessionId === sessionId) {
        this.bumpAttachmentGeneration()   /* S3：原图数据异步载入 → 含图消息视图缓存失效 */
        this.publish(this.messagesPatch())
      }
    })
    return undefined
  }

  /** G5 v4: tokS 记忆持久化（值变化才调用；数据极小：每会话每 assistant 一个整数）。 */
  private persistTokS(): void {
    void EXT_CONTEXT?.globalState.update('dshSessionTokS', memoryToPlain(this.sessionTokS))
  }

  /** G5 创建时间：协议不下发 createdAt（server identity 有但 list 不吐）→ 本机记录 + 持久化。 */
  private rememberSessionCreatedAt(sessionId: string): void {
    const now = Date.now()
    this.sessionCreatedAt.set(sessionId, now)
    void EXT_CONTEXT?.globalState.update('dshSessionCreatedAt', Object.fromEntries(this.sessionCreatedAt))
  }

  /** G5: 会话切换/状态重置时清空打点（含分页重放前置——同会话整体重放重建）。 */
  private resetTurnMeta(): void {
    this.turnMeta.clear()
  }

  /** G5 事件打点：委托纯状态机（tests/turn-meta.spec.ts）。 */
  private markTurnMeta(dshEvent: DshEvent): void {
    this.turnMeta.mark(dshEvent)
  }

  /** G5 tok/s 差分：sessionStats 快照增量挂给流式中的 assistant；无流式则留待下一条结算。 */
  private ingestSessionStatsValue(stats: unknown): void {
    this.turnMeta.ingestStats(stats)
  }

  private injectMessageFiles(sessionId: string, messages: ConversationMessage[]): ConversationMessage[] {
    const store = currentMessageFiles()
    let injected = false
    const next = messages.map(message => {
      // G22 bug⑤: 纯文件发送（text===''）的回显消息同样注入文件卡，否则 PDF/XLSX 徽标回显后消失（图片走 images 通道不受影响）。
      if (message.role !== 'user' || typeof message.text !== 'string') return message
      const entry = lookup(store, sessionId, { ...(message.seq === undefined ? {} : { seq: message.seq }), textTail: message.text })
      if (entry === undefined || entry.files.length === 0) return message
      injected = true
      return { ...message, files: entry.files.map(file => ({ ...file, status: attachmentStatus(this.cwd, file) })) }
    })
    return injected ? next : messages
  }

  private hydrateImages(client: DshClient, sessionId: string): void {
    /* 2026-10-06（W1，性能）：改只读轻迭代——本函数每 session/event 被调一次，旧实现
       projector.messages() 全量拷贝（真机剖面 9s/27min）；只消费 images，无需拷贝。 */
    const images = this.projector.iterMessages().flatMap(message => message.images ?? [])
    for (const image of images) void this.loadAttachment(client, sessionId, image)
  }

  /** Chat and context details share one request, owned by the client that started it. */
  private loadAttachment(client: DshClient, sessionId: string, image: Pick<ConversationImage, 'attachmentId' | 'mediaType'>): Promise<void> {
      if (this.client !== client) return Promise.resolve()
      const key = `${sessionId}\u0000${image.attachmentId}`
      if (this.attachmentResults.has(key)) return Promise.resolve()
      const existing = this.attachmentLoads.get(key)
      if (existing !== undefined) return existing.task
      const generation = this.generation
      const owner = { task: Promise.resolve(), abort: new AbortController() }
      const current = (): boolean => this.client === client && this.generation === generation && !owner.abort.signal.aborted && this.attachmentLoads.get(key) === owner
      let changed = false
      const load = client.attachment(sessionId, image.attachmentId, owner.abort.signal)
        .then((result) => {
          if (!current()) return
          if (result.attachment.attachmentId !== image.attachmentId || result.attachment.mediaType !== image.mediaType) {
            throw new Error('DeepSeek Harness 返回的图片元数据不匹配。')
          }
          this.attachmentResults.set(key, { data: result.data })
          changed = true
        })
        .catch((error: unknown) => {
          if (!current()) return
          const detail = error instanceof Error ? error.message : String(error)
          this.output.appendLine(`[attachment] ${image.attachmentId}: ${detail}`)
          this.attachmentResults.set(key, { error: '图片不可用。' })
          changed = true
        })
        .finally(() => {
          const publish = current() && changed
          if (this.attachmentLoads.get(key) === owner) this.attachmentLoads.delete(key)
          /* W1：逐图完成后不再各自全量重装配——100ms 合帧（首图到达至多晚 100ms 上屏，行为保真）。 */
          if (publish) {
            this.bumpAttachmentGeneration()
            this.scheduleHydratePublish(client, sessionId)
          }
        })
      owner.task = load
      this.attachmentLoads.set(key, owner)
      return load
  }

  private hydratePublishTimer: ReturnType<typeof setTimeout> | undefined
  private hydratePublishSessionId: string | undefined

  private scheduleHydratePublish(client: DshClient, sessionId: string): void {
    if (this.client !== client || this._state.sessionId !== sessionId) return
    if (this.hydratePublishTimer !== undefined) {
      if (this.hydratePublishSessionId === sessionId) return
      clearTimeout(this.hydratePublishTimer)
    }
    this.hydratePublishSessionId = sessionId
    const timer = setTimeout(() => {
      if (this.hydratePublishTimer !== timer) return
      this.hydratePublishTimer = undefined
      this.hydratePublishSessionId = undefined
      if (this.client === client && this._state.sessionId === sessionId) this.publish(this.messagesPatch())
    }, 100)
    this.hydratePublishTimer = timer
  }

  private dirtyConflict(event: DshEvent, view?: unknown): { callId: string; paths: string[] } | undefined {
    const callIds: string[] = []
    const documents = new Map<string, vscode.TextDocument>()
    for (const intent of toolWriteIntents(event, view)) {
      if (this.guardedDirtyCalls.has(intent.callId)) continue
      const conflicts = this.dirtyFiles.conflicts(this.cwd, intent.paths)
      if (conflicts.length === 0) continue
      this.guardedDirtyCalls.add(intent.callId)
      callIds.push(intent.callId)
      for (const document of conflicts) documents.set(document.uri.fsPath, document)
    }
    if (callIds.length === 0) return undefined
    const paths = [...documents.values()]
      .map(document => path.relative(this.cwd, document.uri.fsPath) || path.basename(document.uri.fsPath))
    return { callId: callIds[0] ?? String(event.seq), paths }
  }

  private async cancelForDirtyConflict(conflict: { paths: string[] }): Promise<void> {
    try {
      await this.cancel()
    } catch (error) {
      this.output.appendLine(`[dirty-files] Could not cancel cleanly: ${error instanceof Error ? error.message : String(error)}`)
    }
    const label = conflict.paths.length === 1
      ? conflict.paths[0] ?? '文件'
      : `${String(conflict.paths.length)} 个文件`
    await vscode.window.showWarningMessage(
      `DeepSeek 已停止：${label} 有未保存的更改。`,
      {
        modal: true,
        detail: `${conflict.paths.join('\n')}\n\n请在 VS Code 中保存或放弃更改，然后重试任务。`,
      },
    )
  }

  /** G22 二阶段：user/message 事件带回 seq 后，附着到发送快照条目（seq=权威主键）。 */
  private attachUserEventSeq(sessionId: string, seq: number): void {
    if (sessionId === '') return
    /* G22 bug⑤: 纯文件发送（text===''）的事件也参与 tail 选取——acceptFrame 在主循环刚 apply 完该事件，
       尾部第一条 user 消息即当前事件；跳过空文本会导致文件卡 seq 永远附着不上。
       2026-10-06（W6）：用投影器尾查替代全量 messages() 拷贝（真机剖面同族的每事件全量拷贝之一）。 */
    const tail = this.projector.lastUserMessage()
    if (tail === undefined) return
    const store = currentMessageFiles()
    if (attachSeq(store, sessionId, seq, tail.text)) commitMessageFiles(store)
  }

  /* 0.1.23（用户实测：agent 给的图片链接点开报"文件似乎是二进制文件，不能作为文本打开"）：
     按类型分流——图片 → **侧栏内预览**（复用既有缩放/GIF 预览）；pdf 与其它非文本 → 交 VS Code
     打开（其自带预览/外部程序），不再一律 openTextDocument；文本 → 编辑器（含行号定位）。 */
  async openFile(filePath: string, line?: number): Promise<void> {
    const resolved = await this.diffReviews.resolveOpenPath(this.cwd, filePath)
    if (resolved === undefined) return
    const mediaType = imageMediaType(resolved)
    if (mediaType !== undefined) {
      await this.previewLocalImage(resolved, mediaType)
      return
    }
    const extension = path.extname(resolved).slice(1).toLowerCase()
    if (!linkOpensAsText(extension, TEXT_EXTENSIONS)) {
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(resolved))
      return
    }
    await this.diffReviews.openResolved(resolved, line)
  }

  /** 本地图片 → 侧栏预览（webview 的 openImagePreview）。过大则交 VS Code，避免 base64 压爆消息通道。 */
  private async previewLocalImage(absolute: string, mediaType: ImageMediaType): Promise<void> {
    const uri = vscode.Uri.file(absolute)
    try {
      const stat = await vscode.workspace.fs.stat(uri)
      if (stat.size > DOC_COPY_MAX_BYTES) {
        await vscode.commands.executeCommand('vscode.open', uri)
        return
      }
      const bytes = await vscode.workspace.fs.readFile(uri)
      this.onPreviewLocalImage?.(path.basename(absolute), mediaType, `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.output.appendLine(`[preview] 读取本地图片失败：${message}`)
      await vscode.commands.executeCommand('vscode.open', uri)
    }
  }

  /** G22：文件卡智能打开——文本→编辑器（preview），其余→默认预览；越界/缺失→提示。 */
  async openAttachment(filePath: string): Promise<void> {
    const absolute = normalizeWithin(this.cwd, filePath)
    if (absolute === undefined) {
      void vscode.window.showWarningMessage('该文件卡指向工作区之外。')
      return
    }
    const uri = vscode.Uri.file(absolute)
    try {
      const stat = await vscode.workspace.fs.stat(uri)
      if (stat.type !== vscode.FileType.File) throw new Error('not a file')
    } catch {
      void vscode.window.showWarningMessage('该文件卡已不可用——文件被移动或删除了。')
      return
    }
    const extension = path.extname(absolute).slice(1).toLowerCase()
    if (TEXT_EXTENSIONS.has(extension)) {
      const document = await vscode.workspace.openTextDocument(uri)
      void vscode.window.showTextDocument(document, { preview: true })
      return
    }
    /* G10 0.0.25: pdf 固定 VSCode 内置预览（不跟随系统默认）；其余 → 系统默认应用。
       0.0.26: openExternal 对 file:// 在 Windows 报 0x2（用户实测"打开外部程序时出错"），
       改用 PowerShell Start-Process（同 OpenAs_RunDLL 已验证路径）；非 win 退回 openExternal。 */
    if (extension === 'pdf') {
      void vscode.commands.executeCommand('vscode.open', uri)
      return
    }
    if (IS_WIN) {
      void runStartProcess(absolute).catch(() => void vscode.env.openExternal(uri))
    } else {
      void vscode.env.openExternal(uri)
    }
  }

  async reviewFile(filePath: string, turn?: number): Promise<void> {
    if (this._state.sessionId === '') return
    await this.diffReviews.reviewFile(this._state.sessionId, this.cwd, filePath, turn)
  }

  async reviewAll(): Promise<void> {
    if (this._state.sessionId === '') return
    await this.diffReviews.reviewAll(this._state.sessionId)
  }

  keepFile(filePath: string, turn: number): void {
    if (this._state.sessionId === '') return
    this.publish({ changedFiles: this.diffReviews.keepFile(this._state.sessionId, this.cwd, filePath, turn) })
  }

  keepAll(): void {
    if (this._state.sessionId === '') return
    this.publish({ changedFiles: this.diffReviews.keepAll(this._state.sessionId) })
  }

  async revertFile(filePath: string, turn: number): Promise<void> {
    if (this._state.sessionId === '') return
    const confirmed = await vscode.window.showWarningMessage(
      `将 ${filePath} 的 DeepSeek 变更回退？`,
      { modal: true, detail: '这会把文件恢复到本轮修改之前的内容。若文件在此之后被改动过，则不会回退。' },
      '回退',
    )
    if (confirmed !== '回退') return
    try {
      this.publish({ changedFiles: this.diffReviews.revertFile(this._state.sessionId, this.cwd, filePath, turn) })
      await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer')
      await vscode.window.showInformationMessage(`已回退 ${filePath}。`)
    } catch (error) {
      await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async revertAll(): Promise<void> {
    if (this._state.sessionId === '') return
    const count = this._state.changedFiles.reduce((total, group) => total + group.files.length, 0)
    if (count === 0) return
    const confirmed = await vscode.window.showWarningMessage(
      `回退全部 ${String(count)} 个已审阅的文件变更？`,
      { modal: true, detail: '会先逐一检查每个文件；只要有任何文件在 DeepSeek 修改后又被改动过，则全部不回退。' },
      '全部回退',
    )
    if (confirmed !== '全部回退') return
    try {
      this.publish({ changedFiles: this.diffReviews.revertAll(this._state.sessionId) })
      await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer')
      await vscode.window.showInformationMessage(`已回退 ${String(count)} 个文件的变更。`)
    } catch (error) {
      await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }
}

/* 0.1.125（数据层根治）：轨道表"多页补拉到全会话"的上限——超限部分以轮粒度前缀呈现（文档化边界）。 */
const RAIL_PULL_MAX_PAGES = 5
const RAIL_PULL_MAX_EVENTS = 100_000
const HISTORY_SNAPSHOT_MAX_ATTEMPTS = 2
const HISTORY_NAVIGATION_MAX_PAGES = 12

class DshSurface implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[]
  private disposed = false
  private searchScope: { cwd: string; generation: number } | undefined
  private railAbort = new AbortController()

  private captureSearchScope(): { cwd: string; generation: number } {
    const cwd = this.controller.state.cwd
    const generation = this.controller.runtimeGeneration
    if (this.searchScope?.cwd !== cwd || this.searchScope.generation !== generation) {
      this.railAbort.abort()
      this.railAbort = new AbortController()
      if (this.stateTimer !== undefined) clearTimeout(this.stateTimer)
      this.stateTimer = undefined
      this.pendingState = undefined
      this.searchScope = { cwd, generation }
      this.searchIndexBuild = undefined
      this.railBuilds.clear()
      this.railNodeTables.clear()
      this.lastPushedRail = undefined
      this.dirtyIndexSessions.clear()
      this.indexChanges.clear()
      this.searchAbort?.abort()
      this.searchAbort = undefined
      this.lastLocalSearch = undefined
      this.searchGeneration += 1
    }
    return this.searchScope
  }

  private isSearchScopeCurrent(scope: { cwd: string; generation: number }): boolean {
    return !this.disposed && this.searchScope === scope
      && this.controller.state.cwd === scope.cwd && this.controller.runtimeGeneration === scope.generation
  }
  /* 0.1.90：回合结束后待重建索引的会话（搜索前由 buildSearchIndex 强制重取该会话的历史页）。 */
  private readonly dirtyIndexSessions = new Set<string>()
  private readonly indexChanges = new Map<string, number>()

  private sessionIndexStamp(sessionId: string): string {
    const session = this.controller.searchIndexSessions().find(item => item.sessionId === sessionId)
    return `${session?.revision ?? 'missing'}:${this.indexChanges.get(sessionId) ?? 0}`
  }
  private readonly draftImages: DraftImageEntry[] = []
  private readonly preparingUiSends = new Map<string, Set<AbortController>>()
  /** G10 原格式复制：rasterize 前的原始字节缓存（id → 源文件信息），转码完成后随 image 对象落地即删。 */
  private readonly rasterOrigin = new Map<string, { name: string; mime: string; data: string }>()
  /** 0.0.145（G43）：超限图压缩回路的原图缓存（id → 源信息）——结果回包时入列，原图字节随 image 落地即删。 */
  private readonly compressOrigin = new Map<string, { name: string; mime: string; data: string }>()
  /** 0.0.55（反馈③）：发送成功的转码图 origin 字节留档（name → 源信息），供气泡图"复制原格式"取回。
      会话级、内存态（重启即失，属设计内）；容量封顶淘汰最旧。 */
  private readonly sentImageOrigins = new Map<string, { name: string; data: string }>()
  /** 0.0.55（反馈①a）：发送清空后的一次性"跳过自动附带"标志（clearPinned 的同步 publish 内消费）。 */
  private skipAttachOnce = false
  private ready = false
  /** 0.0.168（B4 反馈）：会话内容检索的代际号（新请求作废旧轮，丢弃过期回包）。 */
  private searchGeneration = 0
  private searchAbort: AbortController | undefined
  /** 0.0.170（用户反馈②③）：本工作区内容索引的后台构建（并发请求合并到同一 Promise）。 */
  private searchIndexBuild: Promise<void> | undefined
  /** 0.1.123（G55 Phase 3）：逐会话「轨道节点表」缓存（随索引构建更新；搜索结果里他会话行的编号由此换算）。
      0.1.124（数据层根治）：表随索引落盘（store v5）——内存未命中时回读落盘表并回填；
      两层皆缺 = "缺表"，由构建批按需补算（pending 判据含"缺表"）。 */
  private readonly railNodeTables = new Map<string, { stamp: string; rail: RailNodeTables }>()

  /** 0.1.124（数据层根治）：轨道表取数（内存热缓存 → 落盘 store 回填）。 */
  private railFor(sessionId: string): RailNodeTables | undefined {
    if (this.disposed) return undefined
    this.captureSearchScope()
    if (this.dirtyIndexSessions.has(sessionId)) return undefined
    const stamp = this.sessionIndexStamp(sessionId)
    const cached = this.railNodeTables.get(sessionId)
    if (cached?.stamp === stamp) return cached.rail
    this.railNodeTables.delete(sessionId)
    const store = searchIndexNow()
    const session = this.controller.searchIndexSessions().find(item => item.sessionId === sessionId)
    const persisted = store.ownsWorkspace(this.controller.state.cwd) && session !== undefined && store.indexed(sessionId, session.revision) ? store.rail(sessionId) : undefined
    if (persisted !== undefined) this.railNodeTables.set(sessionId, { stamp, rail: persisted })
    return persisted
  }

  /* 0.1.124（数据层根治）：缺表会话的在途按需计算（同会话并发合并）。 */
  private readonly railBuilds = new Map<string, Promise<RailNodeTables | undefined>>()

  /** 0.1.124（数据层根治）：缺表按需计算——与索引构建同一拉取（projectSessionWithRail）；
      结果落内存热缓存 + 尽力落盘（store v5）。失败留痕不抛。 */
  private ensureRailTable(sessionId: string): Promise<RailNodeTables | undefined> {
    if (this.disposed) return Promise.resolve(undefined)
    const scope = this.captureSearchScope()
    const ready = this.railFor(sessionId)
    if (ready !== undefined) return Promise.resolve(ready)
    const inFlight = this.railBuilds.get(sessionId)
    if (inFlight !== undefined) return inFlight
    const build = (async (): Promise<RailNodeTables | undefined> => {
      try {
        for (let attempt = 0; attempt < HISTORY_SNAPSHOT_MAX_ATTEMPTS; attempt += 1) {
          const stamp = this.sessionIndexStamp(sessionId)
          const summary = this.controller.searchIndexSessions().find(item => item.sessionId === sessionId)
          const revision = summary === undefined ? 0 : summary.revision
          const dirty = this.dirtyIndexSessions.has(sessionId)
          const pulled = await this.controller.projectSessionWithRail(sessionId, this.railAbort.signal)
          if (!this.isSearchScopeCurrent(scope)) return undefined
          if (stamp !== this.sessionIndexStamp(sessionId)) continue
          if (pulled.messages.length === 0) return undefined
          const store = searchIndexNow()
          await store.useWorkspace(scope.cwd)
          if (!this.isSearchScopeCurrent(scope) || !store.ownsWorkspace(scope.cwd)) return undefined
          if (stamp !== this.sessionIndexStamp(sessionId)) continue
          if (store.active) {
            store.upsert(sessionId, revision, pulled.messages, dirty)
            store.setRail(sessionId, revision, pulled.rail)
            this.dirtyIndexSessions.delete(sessionId)
          }
          this.railNodeTables.set(sessionId, { stamp, rail: pulled.rail })
          return pulled.rail
        }
        return undefined
      } catch (error) {
        this.output.appendLine('[rail-nodes] ensure failed ' + sessionId + ': ' + (error instanceof Error ? error.message : String(error)))
        return undefined
      } finally {
        if (this.isSearchScopeCurrent(scope)) this.railBuilds.delete(sessionId)
      }
    })()
    this.railBuilds.set(sessionId, build)
    return build
  }

  /** 0.1.124（数据层根治）：下发现有轨道表（缓存/落盘即发；缺表按需补算后补发；会话已切走则丢弃）。
      同一表对象不重复推（重连风暴里 loadSession 会连发——避免端侧重复重建轨道）。 */
  private lastPushedRail: { sessionId: string; rail: RailNodeTables } | undefined
  async pushRailTable(sessionId: string): Promise<void> {
    if (this.disposed) return
    const scope = this.captureSearchScope()
    if (sessionId === '') return
    if (this.controller.state.sessionId !== sessionId) return
    const rail = this.railFor(sessionId) ?? await this.ensureRailTable(sessionId)
    const current = (): boolean => this.ready && this.isSearchScopeCurrent(scope)
      && this.controller.state.sessionId === sessionId && this.railFor(sessionId) === rail
    if (!current()) return
    // Flush the selecting state before a separate table; a cached table must never overtake it.
    if (this.pendingState !== undefined) await this.resyncState()
    else {
      await this.statePosts
      if (current() && this.postedState?.sessionId !== sessionId) await this.resyncState()
    }
    if (!current()) return
    if (rail === undefined) {
      // Failure belongs to the selected session too: it must not overtake the
      // state selecting that session, or the webview will correctly discard it.
      await this.webview.postMessage({ type: 'rail-unavailable', sessionId })
      return
    }
    if (this.lastPushedRail?.sessionId === sessionId && this.lastPushedRail.rail === rail) return
    const delivered = await this.webview.postMessage({ type: 'rail-nodes', sessionId, rail })
    if (delivered && current()) this.lastPushedRail = { sessionId, rail }
  }
  /** 0.1.76（T3-4）：搜索历史（落 workspaceState；上限 10，逐条 ≤120 字符）。 */
  private get searchHistory(): string[] {
    const raw = EXT_CONTEXT?.workspaceState.get<unknown>('deepseekHarness.searchHistory')
    if (!Array.isArray(raw)) return []
    return raw.filter(item => typeof item === 'string' && item !== '').slice(0, 10)
  }

  private saveSearchHistory(items: unknown): void {
    if (!Array.isArray(items)) return
    const clean = items.filter(item => typeof item === 'string' && item.trim() !== '').map(item => String(item).slice(0, 120)).slice(0, 10)
    void EXT_CONTEXT?.workspaceState.update('deepseekHarness.searchHistory', clean)
  }

  /** 0.1.65（T3-2）：最近一次本地索引检索（建完后自动重推同一轮用；清空查询即失效）。 */
  private lastLocalSearch: { query: string; requestId: number; excludes: readonly string[]; sessionId?: string; fulltext?: Map<string, { stamp: string; hits?: SearchIndexHit[] }>; scanning?: boolean } | undefined

  /* 0.0.170：确保本工作区内容索引已建/已增量刷新。失败只记日志（搜索端会降级为无本地段）。
     0.1.65（T3-2）：**建完且确有新增条目时，自动补推一次当前查询的本地结果**——此前索引在建时检索会得到空结果，
     用户要重打一次字才刷新（用户报"索引就绪后不自动刷新"）。 */
  private ensureSearchIndex(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const scope = this.captureSearchScope()
    if (this.searchIndexBuild !== undefined) return this.searchIndexBuild
    let changed = false
    const task = this.buildSearchIndex(scope)
      .then(result => { changed = result })
      .catch(error => { this.output.appendLine('[search-index] ' + (error instanceof Error ? error.message : String(error))) })
      .finally(() => {
        if (this.searchIndexBuild === task) this.searchIndexBuild = undefined
        if (changed && this.isSearchScopeCurrent(scope)) this.republishLocalSearch()
      })
    this.searchIndexBuild = task
    return task
  }

  /* 0.1.90（索引条目串会话：一个会话的记录里出现另一个会话的消息 id，行标[未加载]、
     Enter 跳过去找不到词）：**索引条目只允许来自该会话自己的历史页（RPC 权威源）**。
     0.1.89 曾让"回合结束用活动投影器直写索引"——活动投影器在会话切换等路径上存在跨会话混装的风险，
     撤掉该写入路径；改为**打脏标记**：回合结束时标记本会话，搜索前由 buildSearchIndex 强制走
     projectSessionMessages（该会话自己的页）重建 ⇒ 既保住"刚回复完就搜"的新鲜度，又保证条目来源单一。 */
  /** 2026-10-06（W9）：外部补触发入口（首载完成信号 / 排障）——与内部调用同源同闸。 */
  ensureSearchIndexNow(): void { void this.ensureSearchIndex() }

  markIndexDirty(sessionId: string): void {
    if (this.disposed) return
    this.captureSearchScope()
    if (sessionId !== '') {
      this.indexChanges.set(sessionId, (this.indexChanges.get(sessionId) ?? 0) + 1)
      this.dirtyIndexSessions.add(sessionId)
      this.railNodeTables.delete(sessionId)
      this.republishLocalSearch()
    }
  }

  /* 0.0.170：逐会话增量建索引——revision（=会话 updatedAt）未变则跳过（不重取 RPC）；
     其余串行拉取（单会话数十~数百 ms；工作区会话数通常十余条）。带 3 路并发。
     0.1.65：返回"是否有条目落库"（T3-2 的重推判据）。
     2026-10-06（W9 留痕）：真机出现"视频工作区索引文件从不落盘"且全程无任何 [search-index] 行——
     静默点共三处（store.active 假 / pending 空 / upsert 空短路 / flush 静默失败），此处加**通过即静默、
     异常必留痕**的探针行；下次真机 Reload 直接读输出即可定位是哪一环。 */
  private async buildSearchIndex(scope = this.captureSearchScope()): Promise<boolean> {
    if (!this.isSearchScopeCurrent(scope)) return false
    const workspace = scope.cwd
    if (workspace === '') { connLog(this.output, '[search-index] skip: cwd empty'); return false }
    const store = searchIndexNow()
    await store.useWorkspace(workspace)
    if (!this.isSearchScopeCurrent(scope) || !store.ownsWorkspace(workspace)) return false
    if (!store.active) { connLog(this.output, '[search-index] skip: store inactive'); return false }
    const sessions = this.controller.searchIndexSessions()
    const keep = new Set(sessions.map(session => session.sessionId))
    store.prune(keep)
    /* 0.1.123（G55 Phase 3）：轨道表缓存按当前会话表收窄（别的工作区/子代理的陈旧表不滞留）。 */
    for (const sessionId of [...this.railNodeTables.keys()]) if (!keep.has(sessionId)) this.railNodeTables.delete(sessionId)
    /* 0.1.90：revision 未变但回合刚结束（脏标记）的会话同样重建——运行时 updatedAt 滞后于内容，
       只靠 revision 会漏"刚回复完就搜"；脏标记由 turn/end 打上、重建成功后清除。
       0.1.123：**缺轨道表**的会话也纳入批（扩展冷启动后表为空；已索引会话只需补表——最坏 = 一次同量拉取，
       属设计稿"按需计算"的批量形态；表齐后回到零成本）。 */
    const pending = sessions.filter(session => this.dirtyIndexSessions.has(session.sessionId) || !store.indexed(session.sessionId, session.revision) || this.railFor(session.sessionId) === undefined)
    if (pending.length > 0) connLog(this.output, `[search-index] build start: ${String(pending.length)}/${String(sessions.length)} session(s) pending`)
    /* 0.1.110（审查高危1 + 低7）：脏标记集合按当前会话表收窄（别的工作区/子代理的陈旧标记永不清除会一直滞留）。 */
    for (const sessionId of [...this.dirtyIndexSessions]) if (!keep.has(sessionId)) this.dirtyIndexSessions.delete(sessionId)
    for (const sessionId of [...this.indexChanges.keys()]) if (!keep.has(sessionId)) this.indexChanges.delete(sessionId)
    if (pending.length === 0) {
      /* 2026-10-06（W9）：sessions 为空 = 'ready' 早于"会话列表首载"（冷启动竞态）——此态曾完全隐形
         （该窗口索引因此从未建过）；留痕一行，启动链补触发见 start() 后的 10s 错峰调用。 */
      if (sessions.length === 0) connLog(this.output, '[search-index] idle: session list not loaded yet')
      return false
    }
    let changed = false
    let emptyPulls = 0
    let upserted = 0
    const queue = [...pending]
    const worker = async (): Promise<void> => {
      for (;;) {
        if (!this.isSearchScopeCurrent(scope) || !store.ownsWorkspace(workspace)) return
        const session = queue.shift()
        if (session === undefined) return
        try {
          for (let attempt = 0; attempt < HISTORY_SNAPSHOT_MAX_ATTEMPTS; attempt += 1) {
            const latest = this.controller.searchIndexSessions().find(item => item.sessionId === session.sessionId)
            if (latest === undefined) break
            const stamp = this.sessionIndexStamp(session.sessionId)
            const dirty = this.dirtyIndexSessions.has(session.sessionId)
            const pulled = await this.controller.projectSessionWithRail(session.sessionId, this.railAbort.signal)
            if (!this.isSearchScopeCurrent(scope) || !store.ownsWorkspace(workspace)) return
            if (stamp !== this.sessionIndexStamp(session.sessionId)) continue
            const messages = pulled.messages
            if (messages.length === 0) emptyPulls += 1
            if (messages.length > 0) {
              const entriesChanged = store.upsert(session.sessionId, latest.revision, messages, dirty)
              const railChanged = store.setRail(session.sessionId, latest.revision, pulled.rail)
              this.railNodeTables.set(session.sessionId, { stamp, rail: pulled.rail })
              changed = entriesChanged || railChanged || changed
              if (entriesChanged) upserted += 1
              this.dirtyIndexSessions.delete(session.sessionId)
            }
            break
          }
        } catch (error) {
          this.output.appendLine(`[search-index] ${session.sessionId}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    await Promise.all([worker(), worker(), worker()])
    if (!this.isSearchScopeCurrent(scope) || !store.ownsWorkspace(workspace)) return false
    /* 2026-10-06（W9 留痕）：构建结束汇总 + 落库验证（flush 后回读文件；失败点见 store warn）。 */
    await store.flush()
    if (!this.isSearchScopeCurrent(scope) || !store.ownsWorkspace(workspace)) return false
    connLog(this.output, `[search-index] build done: pending=${String(pending.length)} upserted=${String(upserted)} empty=${String(emptyPulls)} changed=${String(changed)} store=${JSON.stringify(store.stats)} indexed0=${String(pending[0] === undefined ? '-' : store.indexed(pending[0].sessionId, pending[0].revision))}`)
    /* 0.1.124（数据层根治）：重建批含当前会话 → 补推最新轨道表（webview 尾合并之外的整表对账）。 */
    const currentSession = this.controller.state.sessionId
    if (currentSession !== '' && pending.some(session => session.sessionId === currentSession)) {
      const refreshed = this.railFor(currentSession)
      if (refreshed !== undefined) void this.webview?.postMessage({ type: 'rail-nodes', sessionId: currentSession, rail: refreshed })
    }
    return changed
  }

  /** 0.1.65（T3-2）：用最近一次检索的 query/requestId 重推本地索引结果（视图层按 requestId 判定过期）。 */
  private republishLocalSearch(): void {
    if (this.disposed) return
    const pending = this.lastLocalSearch
    if (pending === undefined) return
    if (pending.sessionId !== undefined && this.controller.state.sessionId !== pending.sessionId) return
    const sessions = this.controller.searchIndexSessions().filter(session => pending.sessionId === undefined || session.sessionId === pending.sessionId)
    if (pending.sessionId !== undefined && sessions.length === 0) return
    const store = searchIndexNow()
    const cached = pending.sessionId === undefined ? store.search(pending.query, pending.excludes)
      : store.ownsWorkspace(this.controller.state.cwd) ? store.searchSession(pending.sessionId, pending.query, pending.excludes) : []
    const bySession = new Map<string, SearchIndexHit[]>()
    for (const hit of cached) bySession.set(hit.sessionId, [...(bySession.get(hit.sessionId) ?? []), hit])
    let scanned = 0, failed = 0
    for (const session of sessions) {
      const full = pending.fulltext?.get(session.sessionId)
      if (full?.stamp !== this.sessionIndexStamp(session.sessionId)) continue
      scanned += 1
      if (full.hits === undefined) failed += 1
      else bySession.set(session.sessionId, full.hits)
    }
    const payload = this.localSearchPayload(pending.query, pending.excludes, [...bySession.values()].flat().slice(0, SEARCH_HITS_MAX))
    void this.webview.postMessage({
      type: 'search-results',
      requestId: pending.requestId,
      ...(pending.sessionId === undefined ? {} : { sessionId: pending.sessionId }),
      items: payload.items,
      hasMore: false,
      local: true,
      index: { ...payload.index, ...(pending.fulltext === undefined ? {} : { fulltextScanning: pending.scanning === true, fulltextScanned: scanned, fulltextSessions: sessions.length, fulltextFailed: failed, fulltextComplete: sessions.length > 0 && scanned === sessions.length && failed === 0 }) },
      /* 0.1.123（G55 Phase 3）：他会话行的节点编号表（缺表会话缺席——视图显示「—」）。 */
      nodes: payload.nodes,
    })
  }

  /** 0.1.65（T3-3/T3-7）：本地索引检索的展示载荷——首次检索与建完重推共用同一口径。 */
  private localSearchPayload(query: string, excludes: readonly string[] = [], fullHits?: SearchIndexHit[]): { items: Array<Record<string, unknown>>; index: Record<string, unknown>; nodes: Record<string, RailNodeTables> } {
    const hits = fullHits ?? searchIndexNow().search(query, excludes)   /* 0.1.76：排除词 */
    const titles = new Map(this.controller.searchIndexSessions().map(session => [session.sessionId, session.title]))
    const recycleTitles = new Map((this.controller.state.recycle ?? []).map(item => [item.id, item.title]))
    const items = hits.map(hit => ({
      sessionId: hit.sessionId,
      messageId: hit.messageId,
      snippet: (hit.role === 'user' ? '你' : hit.role === 'assistant' ? 'DeepSeek' : '记录') + ' · ' + hit.kind + '：' + hit.snippet,
      /* 0.1.71：长片段（悬停展开用；命中前后各 120/240 字）与消息时间戳（排序开关用）。 */
      snippetLong: (hit.role === 'user' ? '你' : hit.role === 'assistant' ? 'DeepSeek' : '记录') + ' · ' + hit.kind + '：' + hit.snippetLong,
      time: hit.time,
      title: titles.get(hit.sessionId) ?? recycleTitles.get(hit.sessionId) ?? '',
      trashed: hit.trashed,
      total: hit.total,
      /* 0.1.96：条目类型（文本/图片/文件/工具）随回包下发——视图层据此过滤「工具」条目。 */
      kind: hit.kind,
      /* 0.1.123（G55 Phase 3）：命中所属消息的 seq——视图层换算他会话行的节点编号（缺失不标）。 */
      ...(typeof hit.seq === 'number' && Number.isFinite(hit.seq) ? { seq: hit.seq } : {}),
    }))
    /* 0.1.123（G55 Phase 3）：他会话结果行的轨道节点表——只带**本轮有命中的会话**（体量可控）。 */
    const nodes: Record<string, RailNodeTables> = {}
    for (const hit of hits) {
      if (nodes[hit.sessionId] !== undefined) continue
      const tables = this.railFor(hit.sessionId)
      if (tables !== undefined) nodes[hit.sessionId] = tables
    }
    return { items, index: this.searchIndexInfo(), nodes }
  }

  /** 0.1.65（T3-7）：索引规模与新鲜度（面板脚注）。 */
  private searchIndexInfo(): Record<string, unknown> {
    const stats = searchIndexNow().stats
    return {
      sessions: stats.sessions,
      entries: stats.entries,
      building: this.searchIndexBuild !== undefined,
      textMax: SEARCH_ENTRY_TEXT_MAX,
      entriesMax: SEARCH_ENTRIES_PER_SESSION_MAX,
      /* 0.1.110（审查低6）：每会话命中上限（12）此前从未下发 ⇒ 面板脚注只写"命中上限 60 条"，
         用户看到单会话"没到 60 就没了"会困惑。 */
      sessionHitsMax: SEARCH_HITS_PER_SESSION_MAX,
      hitsMax: SEARCH_HITS_MAX,
    }
  }

  /** Cached hits appear first; each completed session replaces its cache results with query-time full bodies. */
  private async searchEarlyHistory(query: string, requestId: number, excludes: readonly string[], generation: number, signal: AbortSignal): Promise<void> {
    const scope = this.captureSearchScope()
    const pending = this.lastLocalSearch
    const current = (): boolean => !signal.aborted && generation === this.searchGeneration && this.isSearchScopeCurrent(scope)
      && (pending?.sessionId === undefined || this.controller.state.sessionId === pending.sessionId)
    const sessions = this.controller.searchIndexSessions().filter(session => pending?.sessionId === undefined || session.sessionId === pending.sessionId)
    if (!current() || pending?.requestId !== requestId) return
    const fulltext = new Map<string, { stamp: string; hits?: SearchIndexHit[] }>()
    pending.fulltext = fulltext
    pending.scanning = true
    const publish = (): void => {
      if (!current() || this.lastLocalSearch !== pending) return
      this.republishLocalSearch()
    }
    publish()
    for (const session of sessions) {
      if (!current()) return
      for (let attempt = 0; attempt < HISTORY_SNAPSHOT_MAX_ATTEMPTS; attempt += 1) {
        const stamp = this.sessionIndexStamp(session.sessionId)
        try {
          const hits = await this.controller.searchHistory(session.sessionId, query, excludes, signal)
          if (!current()) return
          if (stamp !== this.sessionIndexStamp(session.sessionId)) continue
          fulltext.set(session.sessionId, { stamp, hits })
        } catch (error) {
          if (!current()) return
          if (stamp !== this.sessionIndexStamp(session.sessionId)) continue
          fulltext.set(session.sessionId, { stamp })
          this.output.appendLine('[search-history] ' + session.sessionId + ': ' + (error instanceof Error ? error.message : String(error)))
        }
        break
      }
      publish()
    }
    pending.scanning = false
    publish()
  }

  /** Explicit current-session lookup; never builds or searches the rest of the workspace. */
  private async searchCurrentHistory(sessionId: string, query: string, excludes: readonly string[], requestId: number): Promise<void> {
    if (this.disposed || query === '' || sessionId === '' || this.controller.state.sessionId !== sessionId) return
    if (!this.controller.searchIndexSessions().some(session => session.sessionId === sessionId)) {
      void this.webview.postMessage({ type: 'search-results', requestId, sessionId, local: true, items: [], index: { fulltextScanning: false, fulltextComplete: false, fulltextFailed: 1 } })
      return
    }
    this.captureSearchScope()
    this.searchAbort?.abort()
    const generation = ++this.searchGeneration
    const abort = new AbortController()
    this.searchAbort = abort
    this.lastLocalSearch = { query, excludes, requestId, sessionId }
    try {
      await this.searchEarlyHistory(query, requestId, excludes, generation, abort.signal)
    } finally {
      if (this.searchAbort === abort) this.searchAbort = undefined
    }
  }
  private pendingPrompt: string | undefined
  private pendingState: ChatViewState | undefined
  private pendingConnectionsOpen = false
  private postedState: ChatViewState | undefined
  private stateTimer: NodeJS.Timeout | undefined
  private statePosts: Promise<void> = Promise.resolve()
  private readonly pinnedSlots = new Map<string, PinnedEntry[]>()
  /** G39（0.0.93）：切会话视图记忆（滚动/展开/折叠）的持久化副本，随 workspaceState 存续。 */
  private viewStates: Record<string, SessionViewStateRecord> = loadSessionViewStates()
  private viewStateWriteTimer: NodeJS.Timeout | undefined

  constructor(
    private readonly webview: vscode.Webview,
    private readonly controller: DshChatController,
    private readonly output: vscode.OutputChannel,
    private readonly editorContext: EditorContextBridge,
    extensionUri: vscode.Uri,
  ) {
    const mediaRoot = vscode.Uri.joinPath(extensionUri, 'media')
    this.captureSearchScope()
    webview.options = { enableScripts: true, localResourceRoots: [mediaRoot, vscode.Uri.joinPath(extensionUri, 'dist')] }
    webview.html = chatHtml(
      webview,
      webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'deepseek.svg')),
      /* G45（0.0.103）：MathJax 资源（「复制为 SVG」懒加载）；dist 因此须进 localResourceRoots。 */
      webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'mathjax-tex-svg.js')),
    )
    /* G49 v2（0.0.121）：轨道穿透加载完成 → 端侧定位滚动（一次性通知，不入状态）。 */
    controller.onTurnJumpReady = (seq, loaded, reason, status) => {
      if (this.disposed) return
      void this.webview?.postMessage({ type: 'turn-jump-ready', sessionId: controller.state.sessionId, seq, loaded, reason, ...status })
    }
    controller.onTurnJumpProgress = (seq, requestId, pages, maxPages) => {
      if (!this.disposed) void this.webview.postMessage({ type: 'turn-jump-progress', sessionId: controller.state.sessionId, seq, requestId, pages, maxPages })
    }
    /* 0.1.124（数据层根治）：恢复穿透完成 → 端侧重定位锚点（一次性通知）。 */
    controller.onRestoreThroughReady = (seq: number, loaded: boolean, reason?: 'error') => {
      if (this.disposed) return
      void this.webview?.postMessage({ type: 'restore-through-ready', sessionId: controller.state.sessionId, seq, loaded, reason })
    }
    controller.onRestoreThroughProgress = (seq: number, pages: number, maxPages: number) => {
      if (this.disposed) return
      void this.webview.postMessage({ type: 'restore-through-progress', sessionId: controller.state.sessionId, seq, pages, maxPages })
    }
    /* 0.1.23：本地图片链接 → 端侧既有预览覆盖层（缩放/GIF 全套）。 */
    controller.onPreviewLocalImage = (name: string, mediaType: string, dataUrl: string) => {
      if (this.disposed) return
      void this.webview?.postMessage({ type: 'preview-image', name, mediaType, dataUrl })
    }
    this.disposables = [
      sessionViewStateRemoved.event(({ sessionId, revision }) => {
        if (!this.disposed) void webview.postMessage({ type: 'view-state-removed', sessionId, revision })
      }),
      controller.onDidChangeState(state => { this.queueState(state) }),
      editorContext.onDidChange(state => {
        // auto-attach: clicking a file in the explorer replaces the single attached slot (no focus-timing dependency)
        // 0.0.55（反馈①a）: 发送清空（clearPinned）自身也会走到这里，此时跳过一次性自动附带——
        // 否则刚清掉的附带文件会被立刻加回（用户实测"发送后文件不会清空"）。
        if (this.skipAttachOnce) {
          this.skipAttachOnce = false
        } else if (includeContextNow() && state.activeFile !== undefined) {
          this.editorContext.attachActiveFile(state.activeFile.path)
        }
        void webview.postMessage({ type: 'ide-context', state })
      }),
      webview.onDidReceiveMessage(message => { this.acceptMessage(message) }),
    ]
  }

  focusPrompt(): void {
    void this.webview.postMessage({ type: 'focus-prompt' })
  }

  /* 0.1.17（用户实测"草稿栏 Ctrl+Z 失效"）：VS Code 工作台把 Ctrl+Z 当自己的撤销命令，
     键不落到 webview——经 keybinding（focusedView == deepseekHarness.chat）转发回来，
     在端侧对**当前聚焦的可编辑元素**执行原生撤销/重做。 */
  execEdit(command: 'undo' | 'redo'): void {
    void this.webview.postMessage({ type: 'exec-edit', command })
  }

  setPrompt(text: string): void {
    if (!this.ready) {
      this.pendingPrompt = text
      return
    }
    void this.webview.postMessage({ type: 'set-prompt', text })
  }

  openModelConnections(): void {
    if (this.disposed) return
    if (!this.ready) { this.pendingConnectionsOpen = true; return }
    this.pendingConnectionsOpen = false
    void this.webview.postMessage({ type: 'open-model-connections' })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.railAbort.abort()
    this.searchAbort?.abort()
    this.searchAbort = undefined
    this.searchGeneration += 1
    this.searchScope = undefined
    this.searchIndexBuild = undefined
    this.railBuilds.clear()
    this.pendingState = undefined
    this.lastLocalSearch = undefined
    if (this.stateTimer !== undefined) clearTimeout(this.stateTimer)
    /* G39：面板销毁时把未落盘的视图记忆立刻写掉（否则去抖窗口内的最后一次移动会丢）。 */
    if (this.viewStateWriteTimer !== undefined) {
      clearTimeout(this.viewStateWriteTimer)
      this.viewStateWriteTimer = undefined
      writeSessionViewStates()
    }
    for (const disposable of this.disposables) disposable.dispose()
  }

  private queueState(state: ChatViewState): void {
    if (this.disposed) return
    const scope = this.captureSearchScope()
    this.pendingState = state
    // Start missing-table preparation alongside the opening history RPC, without delaying the body.
    if (state.phase === 'loading' && state.sessionId !== '') void this.pushRailTable(state.sessionId)
    if (!this.ready || this.stateTimer !== undefined) return
    /* 0.1.25（性能）：流式期去抖放宽到 33ms——真机实测每拍约 25ms 主线程工作量 vs 16ms 节奏
       = 主线程饱和（帧 p95 33.5ms / 阻塞占比 10%）；降到 30fps 后阻塞率减半且文字仍连续
       （2026 实践：突发流推荐 33–50ms 固定冲刷间隔）。停下即回 16ms，交互不钝；
       最新者胜（pendingState）保证最后一拍必达，结算帧不丢。 */
    const delay = this.controller.state.running === true ? 33 : 16
    this.stateTimer = setTimeout(() => {
      this.stateTimer = undefined
      const pending = this.pendingState
      this.pendingState = undefined
      if (pending === undefined) return
      this.statePosts = this.statePosts
        .then(() => this.isSearchScopeCurrent(scope) ? this.postStateUpdate(pending) : undefined)
        .catch(error => {
          this.output.appendLine(`[webview] Could not publish state: ${error instanceof Error ? error.message : String(error)}`)
        })
    }, delay)
  }

  private async postFullState(state: ChatViewState): Promise<void> {
    if (this.disposed) return
    const rail = this.railFor(state.sessionId)
    const delivered = await this.webview.postMessage({ type: 'state', state: stateForWebview(state), rail })
    if (this.disposed) return
    this.postedState = delivered ? state : undefined
    if (delivered && rail !== undefined) this.lastPushedRail = { sessionId: state.sessionId, rail }
    this.postSessionTitles()
  }

  /* 0.0.161（用户需求）：草稿持久化——Reload/重启后按会话恢复 文本/图片/文件卡。
     存储根 = workspace storageUri（无则 globalStorageUri）；两者皆缺 → 功能静默关闭。 */
  private get draftStore(): DraftStore {
    return draftStoreNow()
  }
  private draftsHydrated = false
  /* 图片集合签名缓存：同签名不重复落盘（会话切换/回执路径都会经过图片同步）。 */
  private readonly persistedImageSig = new Map<string, string>()

  /* 0.0.161：把当前会话的图片集合落盘（图片权威副本在扩展侧 this.draftImages；
     文本由 webview 的 persist-draft 单独上报——避免每次按键搬运 dataURL）。 */
  private persistDraftImagesNow(): void {
    const sessionId = this.controller.state.sessionId
    if (sessionId === '' || !this.draftStore.enabled || !keepDraftsNow()) return
    const sig = this.draftImages.map(image => image.id).join('|')
    if (this.persistedImageSig.get(sessionId) === sig) return
    this.persistedImageSig.set(sessionId, sig)
    this.draftStore.upsert(sessionId, {
      images: this.draftImages.map(image => ({ id: image.id, name: image.name ?? 'image', mediaType: image.mediaType, base64: image.data })),
    })
  }

  /* 启动期水合：设置开 → 持久化的 pinned 灌回 per-session 槽位（文本/图片在 ready/切会话时按需推送）；
     设置关 → 清库一次（关掉之后旧草稿不得无声复活）。 */
  private hydrateDrafts(): void {
    if (this.draftsHydrated) return
    this.draftsHydrated = true
    if (!this.draftStore.enabled) return
    if (!keepDraftsNow()) { this.draftStore.purge(); return }
    const index = this.draftStore.load()
    for (const [sessionId, draft] of Object.entries(index.drafts)) {
      if (Array.isArray(draft.pinned) && draft.pinned.length > 0) this.pinnedSlots.set(sessionId, draft.pinned as PinnedEntry[])
    }
  }

  /* 把某会话的持久化草稿推给 webview；webview 只在本地槽位为空时采纳（不覆盖正在输入的内容）。 */
  private pushPersistedDraft(sessionId: string): void {
    if (sessionId === '' || !this.draftStore.enabled || !keepDraftsNow()) return
    const draft = this.draftStore.restore(sessionId)
    if (draft === undefined) return
    if (draft.text.trim() === '' && draft.images.length === 0) return
    void this.webview.postMessage({ type: 'draft-restore', sessionId, text: draft.text, images: draft.images })
  }

  private postSessionTitles(): void {
    if (this.disposed) return
    void this.webview.postMessage({ type: 'session-titles', titles: visibleSessionTitles() })
  }

  private applyPinnedSlots(outgoing: string | undefined, state: ChatViewState): void {
    if (outgoing !== undefined && outgoing !== state.sessionId && stillInSessions(state.sessions, outgoing)) {
      savePinnedSlot(this.pinnedSlots, outgoing, this.editorContext.snapshotPinned())
      /* 0.0.161：切走时把该会话的文件卡落盘（文本/图片由 webview 的 persist-draft 负责）。 */
      if (this.draftStore.enabled && keepDraftsNow()) this.draftStore.upsert(outgoing, { pinned: this.pinnedSlots.get(outgoing) ?? [] })
    }
    this.editorContext.restorePinned(this.pinnedSlots.get(state.sessionId) ?? [])
    /* 0.0.161：切到某会话时推持久化草稿（Reload 后内存槽位为空 → 采纳恢复）。 */
    this.pushPersistedDraft(state.sessionId)
    /* 0.0.56（审核 P1）: 图片 base64 缓存按"当前 + 上一个会话"保留——此前只在 runtime start 清，
       长开会话浏览多个含图会话时无界增长（每张图 MB 级）。 */
    this.controller.evictAttachmentResults(new Set([state.sessionId, outgoing ?? '']))
  }


  private async postStateUpdate(state: ChatViewState): Promise<void> {
    if (this.disposed) return
    const previous = this.postedState
    if (previous === undefined || previous.sessionId !== state.sessionId) {
      this.applyPinnedSlots(previous?.sessionId, state)
      await this.postFullState(state)
      return
    }
    const update = stateUpdate(previous, state)
    if (update !== undefined) {
      const availableRail = this.railFor(state.sessionId)
      const rail = this.lastPushedRail?.sessionId === state.sessionId && this.lastPushedRail.rail === availableRail ? undefined : availableRail
      const delivered = await this.webview.postMessage({ type: 'state-update', sessionId: state.sessionId, update: stateUpdateForWebview(update), rail })
      if (this.disposed) return
      if (!delivered) {
        // A dropped patch would desync every later diff; resend the full state next time.
        this.postedState = undefined
        return
      }
      if (rail !== undefined) this.lastPushedRail = { sessionId: state.sessionId, rail }
    }
    this.postedState = state
  }

  private async resyncState(): Promise<void> {
    const snapshot = this.controller.state
    this.pendingState = undefined
    if (this.stateTimer !== undefined) {
      clearTimeout(this.stateTimer)
      this.stateTimer = undefined
    }
    this.statePosts = this.statePosts.then(() => this.postFullState(snapshot))
    await this.statePosts
  }

  /* 0.0.167（B4 P1-6）：按钮选择器与拖入/粘贴对称——图片走原图像链；非图片文件走同一
     "工作区内 pin / 工作区外复制进 _temp/.dsh-paste" 链（此前非图片被静默丢弃）。 */
  private async chooseAttachments(): Promise<void> {
    const remembered = EXT_CONTEXT?.globalState.get<string>('dshImagePickerDir')
    const selected = await vscode.window.showOpenDialog({
      title: '为 DeepSeek 提示附加图片或文件',
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      filters: {
        图片: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico', 'avif', 'tif', 'tiff'],
        '文档/文本': ['md', 'markdown', 'txt', 'log', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'csv', 'tsv', 'xml', 'html', 'css', 'scss', 'less', 'py', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'svelte', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'ps1', 'bat', 'sql', 'pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'],
        所有文件: ['*'],
      },
      ...(remembered === undefined ? {} : { defaultUri: vscode.Uri.file(remembered) }),
    })
    if (selected === undefined) return
    const first = selected[0]
    if (first !== undefined) void EXT_CONTEXT?.globalState.update('dshImagePickerDir', path.dirname(first.fsPath))

    const incoming: Array<PromptImage & { id: string }> = []
    /* 批 C P2-14（0.0.61）: 先 stat 再读——超单图上限的文件直接跳过，不整读进内存；
       读取失败也逐文件隔离，不再中断整批。 */
    const maxBytes = this.controller.state.imageLimits?.maxImageBytes
    const skipped: string[] = []
    /* G40（0.0.93）：对话框路径的原生格式魔数校验（空/伪装/整体损坏文件拦下；粘贴/拖入路径由 webview 真解码校验）。 */
    const corrupted: string[] = []
    /* 0.0.167（B4 P1-6）：非图片文件的去向往这里归集（工作区内 pin / 工作区外复制进 _temp/.dsh-paste）。 */
    const docCopied: string[] = []
    const docTooBig: string[] = []
    const docNoCwd: string[] = []
    const docFailed: string[] = []
    for (const uri of selected) {
      const label = path.basename(uri.fsPath)
      let stat: vscode.FileStat
      try {
        stat = await vscode.workspace.fs.stat(uri)
      } catch (error) {
        skipped.push(label)
        this.output.appendLine(`[choose-images] stat failed for ${label}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      const mediaType = imageMediaType(uri.fsPath)
      /* 0.0.145（G43）：超过运行时单图上限的原生格式图片不再直接跳过——读入 → 转 webview 下采样 +
         白底 JPEG 重编码（结果回包后入列，原图字节留档供"复制原格式"）；失败/非原生格式才跳过。 */
      if (maxBytes !== undefined && stat.size > maxBytes && mediaType !== undefined) {
        let heavy: Uint8Array | undefined
        try {
          heavy = await vscode.workspace.fs.readFile(uri)
        } catch (error) {
          this.output.appendLine(`[choose-images] read failed for ${label}: ${error instanceof Error ? error.message : String(error)}`)
        }
        if (heavy !== undefined && this.startImageCompression(label, mediaType, heavy)) continue
        skipped.push(label)
        continue
      }
      if (maxBytes !== undefined && stat.size > maxBytes) { skipped.push(label); continue }
      let bytes: Uint8Array
      try {
        bytes = await vscode.workspace.fs.readFile(uri)
      } catch (error) {
        skipped.push(label)
        this.output.appendLine(`[choose-images] read failed for ${label}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      if (mediaType === undefined) {
        const rasterizeMime = rasterizeTarget(uri.fsPath, undefined)
        if (rasterizeMime === undefined) {
          /* 非图片 → 文件链（pin / 复制进 _temp/.dsh-paste），与拖入粘贴同址同语义。 */
          /* pinned 无需上报（上下文芯片即时可见）；复制/跳过的去向在末尾汇总。 */
          const outcome = await this.attachDocumentFile(uri.fsPath, stat.size)
          if (outcome === 'copied') docCopied.push(label)
          else if (outcome === 'too-big') docTooBig.push(label)
          else if (outcome === 'no-cwd') docNoCwd.push(label)
          else if (outcome === 'failed') docFailed.push(label)
          continue
        }
        // Format outside the dsh attachment protocol (G16/G17): rasterize in the webview, then continue through the image channel.
        // G10 0.0.27：保留原始字节（origin）供"复制原格式"——rasterize 后扩展侧只留 PNG，若当时不缓存则原格式永久丢失。
        const id = randomUUID()
        this.rasterOrigin.set(id, { name: label, mime: rasterizeMime, data: Buffer.from(bytes).toString('base64') })
        void this.webview.postMessage({ type: 'rasterize-image', id, name: label, mime: rasterizeMime, data: this.rasterOrigin.get(id)!.data })
        continue
      }
      if (!looksLikeImageBytes(bytes, mediaType)) {
        corrupted.push(label)
        continue
      }
      incoming.push({
        id: randomUUID(),
        type: 'image',
        mediaType,
        /* 0.0.55（反馈①）: 剥离 PNG 元数据块——否则运行时判为"不干净"重编码（有 alpha → 有损 WebP）。
           只改上传副本（内存），本地文件不动。 */
        data: stripPngMetadataBase64(Buffer.from(bytes).toString('base64')),
        name: label,
      })
    }
    if (skipped.length > 0) {
      const hint = maxBytes === undefined ? '' : `（单图上限 ${imageSizeText(maxBytes)}）`
      void vscode.window.showWarningMessage(`已跳过 ${String(skipped.length)} 个文件${hint}：${skipped.join('、')}`)
    }
    if (corrupted.length > 0) {
      void vscode.window.showWarningMessage(`已跳过 ${String(corrupted.length)} 个文件（文件可能为空或已损坏）：${corrupted.join('、')}`)
    }
    if (docCopied.length > 0) {
      void this.toast(`已附加 ${String(docCopied.length)} 个工作区外文件（副本存入 _temp/.dsh-paste）`)
    }
    if (docTooBig.length > 0) {
      void vscode.window.showWarningMessage(`已跳过 ${String(docTooBig.length)} 个工作区外文件（超过 ${imageSizeText(DOC_COPY_MAX_BYTES)}）：${docTooBig.join('、')}。提示：工作区内文件不复制、直接引用，无大小限制。`)
    }
    if (docNoCwd.length > 0) {
      void vscode.window.showWarningMessage('请先打开项目，再附加工作区外文件（需复制副本进 _temp/.dsh-paste）。')
    }
    if (docFailed.length > 0) {
      void vscode.window.showWarningMessage(`附加 ${String(docFailed.length)} 个文件失败（详见输出面板）：${docFailed.join('、')}`)
    }
    if (incoming.length === 0) return

    // Answer with the runtime's own bounds before a rejected prompt spends the upload.
    const rejection = rejectImageAttachments(
      this.draftImages.map(candidateOf),
      incoming.map(candidateOf),
      this.controller.state.imageLimits,
    )
    if (rejection !== undefined) {
      void vscode.window.showWarningMessage(rejection)
      return
    }

    this.draftImages.push(...incoming)
    await this.publishDraftImages()
  }

  /** 0.0.167（B4 P1-6）：对话框选中的非图片文件——工作区内 pin 工作区相对引用（无大小限制）；
      工作区外复制副本入 _temp/.dsh-paste（与粘贴/拖入字节落盘同址），再 pin。 */
  private async attachDocumentFile(fsPath: string, size: number): Promise<'pinned' | 'copied' | 'no-cwd' | 'too-big' | 'failed'> {
    const cwd = this.controller.state.cwd
    if (cwd === '') return 'no-cwd'
    if (this.editorContext.pinLocalPath(fsPath)) return 'pinned'
    if (size > DOC_COPY_MAX_BYTES) return 'too-big'
    try {
      const name = path.basename(fsPath).replace(/[\\/:*?"<>|]/g, '_')
      const storedName = `${String(Date.now())}-${name}`
      const folder = vscode.Uri.joinPath(vscode.Uri.file(cwd), '_temp', '.dsh-paste')
      await vscode.workspace.fs.createDirectory(folder)
      await vscode.workspace.fs.copy(vscode.Uri.file(fsPath), vscode.Uri.joinPath(folder, storedName), { overwrite: true })
      this.editorContext.pinFile(`_temp/.dsh-paste/${storedName}`)
      return 'copied'
    } catch (error) {
      this.output.appendLine('[attach-file] ' + (error instanceof Error ? error.message : String(error)))
      return 'failed'
    }
  }

  /** 0.0.145（G43）：把超限图转交 webview 压缩（下采样 + 白底 JPEG）——结果经 'compress-image-result' 回包；
      原图字节入 compressOrigin（结果回包时随 image 落地为 originData，供"复制原格式"）。 */
  private startImageCompression(label: string, mediaType: string, bytes: Uint8Array): boolean {
    const id = randomUUID()
    const data = Buffer.from(bytes).toString('base64')
    this.compressOrigin.set(id, { name: label, mime: mediaType, data })
    void this.webview.postMessage({ type: 'compress-image', id, name: label, mime: mediaType, data })
    return true
  }

  /** G22：send 快照 pinned 文件（权威源）→ 持久化消息文件卡元数据（跨会话渲染数据源）。 */
  private async recordMessageFiles(pinned: readonly IdeContextReference[], text: string, sessionId: string): Promise<void> {
    if (pinned.length === 0 || sessionId === '') return
    const cwd = this.controller.cwd
    if (cwd === '') return
    const files: AttachedFile[] = []
    const now = Date.now()
    for (const reference of pinned) {
      if (reference.kind !== 'file') continue
      const name = nameOf(reference.path)
      if (name === '') continue
      const absolute = normalizeWithin(cwd, reference.path)
      if (absolute === undefined) continue
      let size = 0
      try {
        const stat = await vscode.workspace.fs.stat(vscode.Uri.file(absolute))
        if (stat.type !== vscode.FileType.File) continue
        size = stat.size
      } catch {
        continue
      }
      files.push({
        name,
        path: reference.path,
        mime: mimeForFileName(name),
        size,
        origin: isPasteCopyPath(reference.path) ? 'paste-copy' : 'workspace',
        addedAt: now,
      })
    }
    if (files.length === 0) return
    commitMessageFiles(storeMessageFiles(currentMessageFiles(), sessionId, undefined, text, files, now))
  }

  private async chooseWorkspace(): Promise<void> {
    const current = this.controller.state.cwd
    const folders = vscode.workspace.workspaceFolders ?? []
    const items: WorkspacePick[] = [
      ...folders.map(folder => ({
        label: `$(folder) ${folder.name}`,
        ...(folder.uri.fsPath === current ? { description: '当前项目' } : {}),
        detail: folder.uri.fsPath,
        uri: folder.uri,
        action: 'switch' as const,
      })),
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      {
        label: '$(folder-opened) 打开其他项目…',
        detail: '在此 VS Code 窗口打开其他文件夹',
        action: 'open' as const,
      },
    ]
    const selected = await vscode.window.showQuickPick(items, {
      title: '选择 DeepSeek 项目',
      placeHolder: 'DeepSeek 将在此项目中读取、写入并运行命令',
    })
    if (selected === undefined) return
    if (selected.action === 'switch' && selected.uri !== undefined) {
      await this.controller.switchWorkspace(selected.uri.fsPath)
      return
    }
    if (selected.action === 'open') {
      const opened = await vscode.window.showOpenDialog({
        title: '为 DeepSeek Harness 打开项目',
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
      })
      if (opened?.[0] !== undefined) await vscode.commands.executeCommand('vscode.openFolder', opened[0], false)
    }
  }

  /** 0.0.55（反馈⑥）: 复制/保存类反馈走侧栏内轻提示（~1.8s），不再用会遮挡输入框的 VS Code 通知。 */
  private async toast(text: string, warn = false): Promise<void> {
    await this.webview.postMessage({ type: 'toast', text, warn })
  }

  /* 0.0.76：turn-rewind 回退流程（互斥 rewindBusy；文案映射与插件 client 半同词条）。 */
  private rewindBusy = false
  private async handleRewindPreview(sessionId: string, messageSeq: number): Promise<void> {
    if (this.rewindBusy) return
    this.rewindBusy = true
    try {
      if (sessionId !== this.controller.state.sessionId) return
      let previewResponse: { httpStatus: number; body: unknown }
      try {
        previewResponse = await this.controller.turnRewindPreview(sessionId, messageSeq)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        this.output.appendLine(`[turn-rewind] preview failed: ${detail}`)
        void this.toast('回退预览失败：运行时未连接。', true)
        return
      }
      const body = typeof previewResponse.body === 'object' && previewResponse.body !== null
        ? previewResponse.body as Record<string, unknown>
        : {}
      if (previewResponse.httpStatus === 404) {
        void this.toast('未安装或未启用 turn-rewind 插件，无法回退。', true)
        return
      }
      if (previewResponse.httpStatus !== 200) {
        const code = typeof body.code === 'string' ? body.code : undefined
        const message = typeof body.error === 'string' ? body.error : undefined
        void this.toast('回退不可用：' + rewindErrorLabel(code, message), true)
        return
      }
      const preview = rewindPreviewOf(body)
      if (preview.status !== 'ready') {
        const text = rewindStatusText(preview)
        if (text !== undefined) void this.toast(text, preview.status === 'failed')
        return
      }
      const blocked = rewindBlockedText(preview)
      if (blocked !== undefined) {
        void this.toast(blocked, true)
        return
      }
      if (preview.totalChanges === 0) {
        void this.toast(REWIND_NO_CHANGES_TEXT)
        return
      }
      if (preview.checkpointId === undefined || preview.planId === undefined || preview.confirmation === undefined) {
        void this.toast('回退信息不完整（缺少检查点或确认信息），请稍后重试。', true)
        return
      }
      const choice = await vscode.window.showWarningMessage(
        '恢复到发送这条消息之前',
        { modal: true, detail: rewindConfirmDetail(preview) },
        '恢复并从这里继续',
        '只恢复文件',
      )
      if (choice === undefined || sessionId !== this.controller.state.sessionId) return
      const mode: 'code' | 'both' = choice === '只恢复文件' ? 'code' : 'both'
      let applyResponse: { httpStatus: number; body: unknown }
      try {
        applyResponse = await this.controller.turnRewindApply({
          mode,
          sessionId,
          messageSeq,
          checkpointId: preview.checkpointId,
          planId: preview.planId,
          confirmation: preview.confirmation,
        })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        this.output.appendLine(`[turn-rewind] apply failed: ${detail}`)
        void this.toast('回退失败：' + detail, true)
        return
      }
      const applyBody = typeof applyResponse.body === 'object' && applyResponse.body !== null
        ? applyResponse.body as Record<string, unknown>
        : {}
      if (applyResponse.httpStatus !== 200) {
        const code = typeof applyBody.code === 'string' ? applyBody.code : undefined
        const message = typeof applyBody.error === 'string' ? applyBody.error : undefined
        this.output.appendLine(`[turn-rewind] apply rejected: http=${String(applyResponse.httpStatus)} code=${String(code ?? '')}`)
        void this.toast(rewindErrorLabel(code, message), true)
        return
      }
      const newSessionId = typeof applyBody.sessionId === 'string' ? applyBody.sessionId : undefined
      if (mode === 'both' && newSessionId !== undefined) {
        void this.toast('项目文件已恢复，并已创建新对话。')
        try {
          await this.controller.selectFreshSession(newSessionId)
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          this.output.appendLine(`[turn-rewind] select forked session failed: ${detail}`)
          void this.toast('文件已恢复且新对话已创建，但切换失败：' + detail, true)
        }
      } else {
        void this.toast('项目文件已恢复；当前对话保持不变。恢复前的文件已自动备份。')
      }
    } finally {
      this.rewindBusy = false
    }
  }

  /* ---- 0.0.75（G11）：更新检查（npm dist-tags；非 npm 源插件跳过；失败静默） ---- */
  /** 展示态：探测结果 → environmentSettings.updates；节流与"已提醒"持久化在 globalState。 */
  private updatesView: EnvironmentUpdatesView = { stale: [] }

  private updateCheckStore(): { at?: number; date?: string; notified?: string[]; driftNotified?: string } {
    const raw = EXT_CONTEXT?.globalState.get('deepseekHarness.updateCheck')
    const record = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
    return {
      ...(typeof record.at === 'number' ? { at: record.at } : {}),
      ...(typeof record.date === 'string' ? { date: record.date } : {}),
      ...(Array.isArray(record.notified) ? { notified: record.notified.filter((value): value is string => typeof value === 'string') } : {}),
      ...(typeof record.driftNotified === 'string' ? { driftNotified: record.driftNotified } : {}),
    }
  }

  private async saveUpdateCheckStore(patch: { at?: number; date?: string; notified?: string[]; driftNotified?: string }): Promise<void> {
    await EXT_CONTEXT?.globalState.update('deepseekHarness.updateCheck', { ...this.updateCheckStore(), ...patch })
  }

  /* 0.0.91：上次成功检查快照（持久化）——刷新失败/断网时回显，不让清单变空。 */
  private updateSnapshot(): EnvironmentUpdatesView | undefined {
    return normalizeUpdatesView(EXT_CONTEXT?.globalState.get('deepseekHarness.updateSnapshot'))
  }

  /** 激活时回填上次成功快照（checkedAt 保留原时间戳，用户可见"上次检查"）。 */
  restoreUpdateSnapshot(): void {
    const snapshot = this.updateSnapshot()
    if (snapshot !== undefined) this.updatesView = snapshot
  }

  /* 只查"纯版本范围"spec（^1.2.3 / ~1 / 1.2.3 / *）；URL、file:/workspace:/别名等一律跳过。 */
  private static isNpmSpec(spec: string): boolean {
    return spec !== '' && !spec.includes('://') && !spec.includes(':') && !spec.includes('/')
  }

  private async fetchLatestVersion(name: string): Promise<string | undefined> {
    try {
      const response = await fetch(`https://registry.npmjs.org/-/package/${name.replace('/', '%2F')}/dist-tags`, { signal: AbortSignal.timeout(6000) })
      if (!response.ok) return undefined
      const tags = await response.json() as Record<string, unknown>
      return pickHighestVersion(Object.values(tags).filter((value): value is string => typeof value === 'string'))
    } catch {
      return undefined
    }
  }

  /* ---- 0.0.90：技能上游检查（清单 ~/.dsh/skills/.sources.json；无清单 → 静默） ----
     后端降级链：gh api（登录态最准，sh+日期）→ raw.githubusercontent（抓 versionFile 的版本号）
     → git ls-remote（部分网络可用）→ 未知。实测：裸 api.github.com / git 端点在用户网络不稳，
     gh 与 raw 均可用，故顺序如此。 */
  private skillsManifest(): SkillSourceEntry[] {
    try {
      const manifestPath = path.join(dshHomeNow(), 'skills', '.sources.json')
      if (!fs.existsSync(manifestPath)) return []
      return parseSkillManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')))
    } catch {
      return []
    }
  }

  private runToolCommand(command: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; stdout: string }> {
    return new Promise((resolve) => {
      execFile(command, args, { timeout: timeoutMs, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 }, (error, stdout) => {
        resolve({ ok: error === null, stdout: String(stdout ?? '') })
      })
    })
  }

  private async probeSkillGh(repo: string): Promise<SkillProbeResult> {
    const result = await this.runToolCommand('gh', ['api', `repos/${repo}/commits?per_page=1`, '--jq', '.[0].sha + " " + .[0].commit.committer.date'], 12000)
    if (!result.ok) return { failed: true }
    const [sha, date] = result.stdout.trim().split(/\s+/)
    if (sha === undefined || !/^[0-9a-f]{7,40}$/i.test(sha)) return { failed: true }
    return { sha: sha.toLowerCase(), ...(date === undefined ? {} : { date }) }
  }

  private async probeSkillRaw(entry: SkillSourceEntry): Promise<SkillProbeResult> {
    if (entry.versionFile === undefined) return { failed: true }
    try {
      const branch = entry.branch ?? 'main'
      const url = `https://raw.githubusercontent.com/${entry.repo}/${branch}/${entry.versionFile}`
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!response.ok) return { failed: true }
      const text = await response.text()
      const match = /version["']?\s*[:=]\s*["']?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/i.exec(text)
      return match === null || match[1] === undefined ? { failed: true } : { version: match[1] }
    } catch {
      return { failed: true }
    }
  }

  private async probeSkillLsRemote(repo: string): Promise<SkillProbeResult> {
    const result = await this.runToolCommand('git', ['ls-remote', `https://github.com/${repo}`, 'HEAD'], 12000)
    if (!result.ok) return { failed: true }
    const sha = result.stdout.trim().split(/\s+/)[0]
    return sha === undefined || !/^[0-9a-f]{40}$/i.test(sha) ? { failed: true } : { sha: sha.toLowerCase() }
  }

  private async probeSkill(entry: SkillSourceEntry): Promise<SkillProbeResult> {
    const gh = await this.probeSkillGh(entry.repo)
    if (gh.failed !== true) {
      /* 带 versionFile 的补一个人类可读版本号（失败不影响 sha 判定） */
      if (entry.versionFile !== undefined) {
        const raw = await this.probeSkillRaw(entry)
        if (raw.version !== undefined) gh.version = raw.version
      }
      return gh
    }
    const raw = await this.probeSkillRaw(entry)
    if (raw.version !== undefined) return raw
    const ls = await this.probeSkillLsRemote(entry.repo)
    if (ls.sha !== undefined) return ls
    return { failed: true }
  }

  /** auto=受频率节流（失败静默）；manual=总是执行并回结果提示。 */
  async runUpdateCheck(trigger: 'auto' | 'manual'): Promise<void> {
    const now = new Date()
    const store = this.updateCheckStore()
    if (trigger === 'auto' && !shouldAutoCheck(updateCheckFrequencyNow(), store, now)) return
    const home = dshHomeNow()
    const npmPlugins = readInstalledPlugins(home).filter(plugin => DshSurface.isNpmSpec(plugin.spec))
    const names = ['@deepseek-ai/dsh', ...npmPlugins.map(plugin => plugin.name)]
    const versions = readInstalledVersions(home, npmPlugins.map(plugin => plugin.name))
    const installed: Record<string, string | undefined> = { '@deepseek-ai/dsh': versions.dsh }
    for (const plugin of npmPlugins) installed[plugin.name] = versions.plugins[plugin.name]
    const latest: Record<string, string | undefined> = {}
    await Promise.all(names.map(async (name) => { latest[name] = await this.fetchLatestVersion(name) }))
    /* 0.0.90：技能上游检查（与 npm 互不拖累——npm 全失败但技能成功时仍发布技能结果） */
    const manifest = this.skillsManifest()
    const skillItems = manifest.length === 0
      ? []
      : (await Promise.all(manifest.map((entry) => this.probeSkill(entry))))
        .map((probe, index) => skillUpdateItem(manifest[index] as SkillSourceEntry, probe))
    const npmAllFailed = names.length > 0 && Object.values(latest).every(value => value === undefined)
    const skillsAllFailed = skillItems.length > 0 && skillItems.every(item => item.latest.startsWith('未知'))
    const previous = this.updateSnapshot()
    if (npmAllFailed && (skillItems.length === 0 || skillsAllFailed)) {
      /* 0.0.91：刷新失败 → 回显上次成功快照（持久显示）+ 失败提示，不让清单变空 */
      if (previous !== undefined) {
        this.updatesView = { ...previous, refreshError: '刷新失败（网络/代理），显示上次成功结果' }
        this.publishEnvironmentSettings()
      }
      if (trigger === 'manual') this.output.appendLine('[update-check] 无法访问 npm registry 与上游仓库（网络/代理），检查未完成')
      if (trigger === 'manual') void this.toast(previous === undefined ? '检查失败：无法访问 npm registry 与技能上游（网络/代理？）' : '检查失败（网络/代理？）——显示上次成功结果', true)
      return
    }
    /* 0.0.91：单项失败（部分探测失败）→ 从上次成功快照回填该项（标注「上次结果」） */
    const skillRows = previous === undefined ? skillItems : applySkillFallback(skillItems, previous.skills ?? [])
    const stale = updatesFrom(installed, latest).filter(item => item.stale)
    const nextView: EnvironmentUpdatesView = {
      ...this.updatesView,
      checkedAt: now.getTime(),
      stale: stale.map(item => ({
        name: item.name,
        ...(item.installed === undefined ? {} : { installed: item.installed }),
        ...(item.latest === undefined ? {} : { latest: item.latest }),
      })),
      skills: skillRows.map(item => ({
        name: item.name,
        installed: item.installed,
        latest: item.latest,
        ...(item.stale ? { stale: true } : {}),
      })),
    }
    delete nextView.refreshError
    this.updatesView = nextView
    await EXT_CONTEXT?.globalState.update('deepseekHarness.updateSnapshot', {
      checkedAt: this.updatesView.checkedAt ?? now.getTime(),
      stale: this.updatesView.stale,
      ...(this.updatesView.skills === undefined ? {} : { skills: this.updatesView.skills }),
    })
    const notified = new Set(store.notified ?? [])
    const fresh = stale.filter(item => !notified.has(`${item.name}@${String(item.latest)}`))
    const freshSkills = skillRows.filter(item => item.stale && !notified.has(`skill:${item.name}@${item.latest}`))
    for (const item of fresh) notified.add(`${item.name}@${String(item.latest)}`)
    for (const item of freshSkills) notified.add(`skill:${item.name}@${item.latest}`)
    await this.saveUpdateCheckStore({ at: now.getTime(), date: localDateKey(now), notified: [...notified].slice(-100) })
    this.publishEnvironmentSettings()
    const staleTotal = stale.length + skillRows.filter(item => item.stale).length
    if (trigger === 'manual') {
      void this.toast(staleTotal === 0 ? '全部已是最新' : `发现 ${staleTotal} 项可更新`)
    } else if (fresh.length + freshSkills.length > 0) {
      const first = [...fresh.map(item => `${item.name} → ${String(item.latest)}`), ...freshSkills.map(item => `${item.name} → ${item.latest}`)].slice(0, 3)
      void this.toast('有 ' + String(fresh.length + freshSkills.length) + ' 项可更新：' + first.join('、') + '（详见 设置 → 更新检查）')
    }
  }

  /** 模型目录漂移（与上次快照对比；改名/新增/移除 → 行内摘要 + 提示一次）。 */
  maybeReportModelDrift(): void {
    const models = this.controller.state.models
    if (!Array.isArray(models) || models.length === 0) return
    const catalog: ModelCatalogEntry[] = models.map(model => ({ key: `${model.provider}/${model.model}`, label: typeof model.label === 'string' ? model.label : '' }))
    const stored = EXT_CONTEXT?.workspaceState.get('deepseekHarness.modelCatalog')
    const previous = Array.isArray(stored)
      ? stored.flatMap((entry): ModelCatalogEntry[] => {
        const record = typeof entry === 'object' && entry !== null ? entry as Record<string, unknown> : undefined
        return record === undefined || typeof record.key !== 'string' ? [] : [{ key: record.key, label: typeof record.label === 'string' ? record.label : '' }]
      })
      : undefined
    void EXT_CONTEXT?.workspaceState.update('deepseekHarness.modelCatalog', catalog)
    if (previous === undefined) return
    const drift = modelCatalogDiff(previous, catalog)
    if (drift === undefined) return
    this.updatesView = { ...this.updatesView, modelDrift: drift }
    this.publishEnvironmentSettings()
    if (this.updateCheckStore().driftNotified !== drift) {
      void this.saveUpdateCheckStore({ driftNotified: drift })
      void this.toast('模型目录有变化：' + drift)
    }
  }

  /** 环境区统一发布（compat + updates 一起进 environmentSettings）。 */
  publishEnvironmentSettings(): void {
    this.controller.publish({ environmentSettings: { ...environmentSettingsNow(), updates: this.updatesView } })
  }

  /** 0.0.55（反馈③）: 发送留档——带 originData 的转码图按显示名存入会话级缓存（封顶 50，淘汰最旧）。 */
  private rememberSentOrigins(images: ReadonlyArray<PromptImage & { originData?: string; originName?: string }>): void {
    for (const image of images) {
      const label = image.originName || image.name || ''
      if (typeof image.originData !== 'string' || image.originData === '' || label === '') continue
      const name = displayNameOf(label)
      if (name === '') continue
      this.sentImageOrigins.delete(name)
      this.sentImageOrigins.set(name, { name: label, data: image.originData })
    }
    while (this.sentImageOrigins.size > 50) {
      const oldest = this.sentImageOrigins.keys().next().value
      if (oldest === undefined) break
      this.sentImageOrigins.delete(oldest)
    }
  }

  /* G39（0.0.93）：接收 webview 上报的会话视图记忆 → 净化 → 内存表 + 去抖写盘（容量淘汰最旧）。 */
  private handleSessionViewState(value: Record<string, unknown>): void {
    const sessionId = typeof value.sessionId === 'string' ? value.sessionId : ''
    if (sessionId === '' || value.revision !== sessionViewStateRevision) return
    const record = sanitizeSessionViewState(value)
    if (record === undefined) return
    delete this.viewStates[sessionId]
    this.viewStates[sessionId] = record
    capSessionViewStates(this.viewStates)
    /* 0.1.128（用户需求①）：urgent（跳转落位即时上报）→ **立即写盘**——用户"跳转完立马 Reload"不再
       落在 1s 去抖窗口里丢位置；跳转低频、单次小写，代价可忽略（滚动路径仍走去抖）。 */
    if (value.urgent === true) { this.flushViewStatesNow(); return }
    this.persistViewStates()
  }

  /** 立即落盘（含容量淘汰）——persistViewStates 的去抖体与 urgent 路径共用。 */
  private flushViewStatesNow(): void {
    if (this.viewStateWriteTimer !== undefined) { clearTimeout(this.viewStateWriteTimer); this.viewStateWriteTimer = undefined }
    /* 容量淘汰：按 `at` 保留最近 SESSION_VIEW_STATE_CAP 个会话。 */
    capSessionViewStates(this.viewStates)
    writeSessionViewStates()
  }

  private persistViewStates(): void {
    if (this.viewStateWriteTimer !== undefined) return
    this.viewStateWriteTimer = setTimeout(() => {
      this.viewStateWriteTimer = undefined
      this.flushViewStatesNow()
    }, 1000)
  }

  private async publishDraftImages(): Promise<void> {
    await this.webview.postMessage({
      type: 'draft-images',
      images: this.draftImages.map(image => ({
        id: image.id,
        name: image.name,
        mediaType: image.mediaType,
        data: 'data:' + image.mediaType + ';base64,' + image.data,
        ...(image.frameSelections === undefined || image.frameSelections.length === 0
          ? {}
          : { frameSelections: image.frameSelections.map(frame => ({ index: frame.index, data: 'data:image/png;base64,' + frame.data })) }),
      })),
    })
    /* 0.0.161：图片集合变化 → 落盘（签名去重）。 */
    this.persistDraftImagesNow()
  }

  private acceptMessage(message: unknown): void {
    if (this.disposed) return
    this.captureSearchScope()
    if (typeof message !== 'object' || message === null || !('type' in message)) return
    const value = message as Record<string, unknown>
    const run = async (): Promise<void> => {
      switch (value.type) {
        case 'describe-model-connections':
        case 'save-model-connection':
        case 'remove-model-connection':
        case 'discover-connection-models': {
          const generation = this.controller.runtimeGeneration
          const requestId = typeof value.requestId === 'number' ? value.requestId : 0
          const current = (): boolean => !this.disposed && this.controller.runtimeGeneration === generation
          const reply = (payload: Record<string, unknown>): void => { if (current()) void this.webview.postMessage({ type: 'model-connections-result', requestId, operation: value.type, ...payload }) }
          let committed = false
          let provider: string | undefined
          try {
            const connections = this.controller.modelConnections()
            if (value.type === 'discover-connection-models') {
              reply({ ok: true, models: await connections.discover(value.draft) })
              return
            }
            if (value.type === 'save-model-connection') { provider = await connections.save(value.draft); committed = true }
            if (value.type === 'remove-model-connection') {
              if (typeof value.provider !== 'string' || typeof value.revision !== 'number') throw new Error('连接参数无效。')
              await connections.remove(value.provider, value.revision)
              committed = true
              if (current()) this.controller.modelConnectionRemoved(value.provider)
            }
            if (value.type !== 'describe-model-connections' && current()) {
              try { await this.controller.refreshModels() } catch { if (current()) void this.toast('连接已保存，模型目录刷新失败；请重新打开会话。', true) }
            }
            const view = await connections.describe()
            reply({ ok: true, view, provider })
          } catch (error) {
            // Upstream errors can contain URLs or provider-supplied secret text; never log them.
            reply({ ok: false, committed, provider, message: committed ? '配置操作已生效，但连接列表读取失败，请刷新列表。' : error instanceof ConnectionError ? error.message : '运行时操作未完成，请检查连接配置或稍后刷新重试。草稿已保留；结果不确定时凭据会保留。' })
          }
          return
        }
        case 'debug-trace':
          /* 0.1.0（B6 A8）：诊断日志默认关——流式期间每帧一条 [trace] 会把输出面板刷爆。 */
          if (diagnosticsNow()) this.output.appendLine('[trace] ' + String(value.d || ''))
          return
        case 'perf-log': {
          /* 0.1.12（用户实测"运行中跳转卡"）：诊断长帧汇总 → 追加 globalStorage/perf-log.jsonl
             （真机取数：headless 复现不出该卡顿，本文件是唯一的一手证据源；上限 400 行滚动）。 */
          const line = JSON.stringify({
            at: new Date().toISOString(),
            ...(typeof value.payload === 'object' && value.payload !== null ? value.payload as Record<string, unknown> : {}),
          })
          try {
            const dir = EXT_CONTEXT?.globalStorageUri?.fsPath
            if (dir !== undefined && dir !== '') {
              /* 0.1.111（审查低危）：搜索走路取证走**独立文件** search-log.jsonl——它与性能采样共用
                 perf-log.jsonl 的 400 行滚动窗口时，一轮走路就能把性能样本挤掉。
                 2026-10-06（W7）：改追加式（见 appendCappedJsonl）。 */
              const isSearchTrace = typeof value.payload === 'object' && value.payload !== null && (value.payload as Record<string, unknown>).kind === 'search'
              const file = path.join(dir, isSearchTrace ? 'search-log.jsonl' : 'perf-log.jsonl')
              appendCappedJsonl(file, line, isSearchTrace ? 800 : 400)
            }
          } catch { /* 诊断写盘失败静默 */ }
          if (diagnosticsNow()) this.output.appendLine('[perf] ' + line)
          return
        }
        case 'webview-error':
          this.output.appendLine(`[webview] ${typeof value.message === 'string' ? value.message : 'Unknown error'}`)
          return
        /* 0.1.76（T3-4）：搜索历史落盘（视图层每次非空检索后推一次）。 */
        case 'save-search-history':
          this.saveSearchHistory(value.items)
          return
        case 'session-view-state':
          /* G39：webview 上报当前会话的视图记忆 → 净化/淘汰后持久化（写盘去抖 1s）。 */
          this.handleSessionViewState(value)
          return
        case 'ready':
          this.ready = true
          /* 0.0.161：草稿水合（pinned 灌回槽位；设置关则清库）——先于状态同步，切会话路径即可恢复。 */
          this.hydrateDrafts()
          /* G39：先补发持久化的视图记忆（首帧渲染前到达 → Reload 后滚动/展开/折叠原位恢复），再同步状态。 */
          await this.webview.postMessage({ type: 'view-state', states: this.viewStates, revision: sessionViewStateRevision })
          /* 0.1.76（T3-4）：搜索历史（保持到下次搜索；Reload/重启仍在）。 */
          await this.webview.postMessage({ type: 'search-history', items: this.searchHistory })
          await this.resyncState()
          /* 0.1.124（数据层根治）：视图就绪 → 补发当前会话轨道表（打开信号早于视图创建时不重放；
             新 webview 无表 ⇒ 清去重标记强制重推）。 */
          this.lastPushedRail = undefined
          void this.pushRailTable(this.controller.state.sessionId)
          /* 0.0.170：本工作区内容索引后台预建（首次约 1-3s；用户输入时通常已就绪）。 */
          void this.ensureSearchIndex()
          await this.webview.postMessage({ type: 'ide-context', state: this.editorContext.viewState() })
          /* 0.0.161：再推当前会话的持久化草稿（状态已就位 → 直接填回输入框）。 */
          this.pushPersistedDraft(this.controller.state.sessionId)
          if (this.pendingPrompt !== undefined) {
            await this.webview.postMessage({ type: 'set-prompt', text: this.pendingPrompt })
            this.pendingPrompt = undefined
          }
          if (this.pendingConnectionsOpen) this.openModelConnections()
          return
        case 'restart': await this.controller.restart(); return
        case 'output': this.output.show(true); return
        case 'new-session': await this.controller.newSession(); return
        case 'fork-session': {
          const createdId = await this.controller.forkSession()
          if (createdId) {
            void this.webview.postMessage({ type: 'fork-created', sessionId: createdId })
            await this.postSessionTitles()
          }
          return
        }
        /* G6 v1（0.0.62）：设置台写通道——白名单+值域校验后写 Global；回流走 onDidChangeConfiguration。
           0.0.63：原 set-motion 通道已随草稿栏动效按钮移除（动效改由 set-config 的 animationStyle 走此通道）。 */
        case 'set-config': {
          if (typeof value.key !== 'string') return
          const validator = CONFIG_WRITE_VALIDATORS[value.key]
          const next = validator === undefined ? undefined : validator(value.value)
          if (next === undefined) return
          try {
            await vscode.workspace.getConfiguration('deepseekHarness').update(value.key, next, vscode.ConfigurationTarget.Global)
          } catch (error) {
            this.output.appendLine('[set-config] ' + (error instanceof Error ? error.message : String(error)))
          }
          return
        }
        /* G6 v1（0.0.62）：设置台"DSH 配置"只读浏览——转发 settings.describe（写通道即 v2）。 */
        case 'describe-dsh-settings': {
          try {
            const description = await this.controller.describeRuntimeSettings()
            void this.webview.postMessage({
              type: 'dsh-settings',
              ok: true,
              namespaces: description.namespaces.map(namespace => ({
                ns: namespace.ns,
                applies: namespace.applies,
                revision: namespace.revision,
                overridden: hasSettingsOverrides(namespace),
                fields: runtimeSettingFields(namespace).map(field => {
                  /* G6 v2（0.0.64）：编辑控件所需元数据（类型/界限/枚举选项/覆盖态）；
                     secret 值照旧绝不外发（value 置 null，仅带 secretSet 标记）。 */
                  const options = settingConstantOptions(field, namespace.schema)
                    ?.filter(option => typeof option === 'string' || typeof option === 'number' || typeof option === 'boolean')
                  const min = typeof field.node.meta?.min === 'number' ? field.node.meta.min : undefined
                  const max = typeof field.node.meta?.max === 'number' ? field.node.meta.max : undefined
                  return {
                    path: field.path.join('.'),
                    pathArray: field.path,
                    type: field.node.type,
                    overridden: field.overridden,
                    ...(min === undefined ? {} : { min }),
                    ...(max === undefined ? {} : { max }),
                    ...(options === undefined || options.length === 0 ? {} : { options }),
                    /* 0.0.65：继承值（base）随字段下发——面板 unset 后就地回填，无需整页重拉。 */
                    ...(field.secretSet === undefined && field.inherited !== undefined ? { inherited: field.inherited } : {}),
                    value: field.secretSet === undefined ? field.value : null,
                    ...(field.secretSet === undefined ? {} : { secretSet: field.secretSet }),
                  }
                }),
              })),
            })
          } catch (error) {
            void this.webview.postMessage({
              type: 'dsh-settings',
              ok: false,
              message: error instanceof Error ? error.message : String(error),
            })
          }
          return
        }
        /* G6 v2（0.0.64）：dsh 配置编辑——单 op 提交（set/unset），revision 冲突原样回流给面板。
           判据 D：不静默覆盖（运行时 settings-conflict → 面板提示 + 自动刷新）。 */
        case 'dsh-settings-mutate': {
          if (typeof value.ns !== 'string' || typeof value.expectedRevision !== 'number' || !Number.isFinite(value.expectedRevision)) return
          const ops: SettingsMutation[] = []
          for (const candidate of Array.isArray(value.ops) ? value.ops : []) {
            const entry = candidate as { op?: unknown; path?: unknown; value?: unknown }
            const path = Array.isArray(entry.path) && entry.path.length > 0 && entry.path.every(segment => typeof segment === 'string')
              ? entry.path as string[]
              : undefined
            if (path === undefined) continue
            if (entry.op === 'unset') { ops.push({ op: 'unset', path }); continue }
            if (entry.op === 'set' && Object.prototype.hasOwnProperty.call(entry, 'value')) {
              ops.push({ op: 'set', path, value: entry.value })
            }
          }
          if (ops.length === 0) return
          try {
            const namespace = await this.controller.mutateRuntimeSettings(value.ns, ops, value.expectedRevision)
            /* 0.1.10：设置台改过 ui-conversation.busyEnter → 侧栏 Enter 行为立即跟随。 */
            if (value.ns === 'ui-conversation') void this.controller.refreshBusyEnterMode()
            void this.webview.postMessage({ type: 'dsh-settings-mutated', ok: true, ns: namespace.ns, revision: namespace.revision })
          } catch (error) {
            void this.webview.postMessage({
              type: 'dsh-settings-mutated',
              ok: false,
              ns: value.ns,
              message: error instanceof Error ? error.message : String(error),
            })
          }
          return
        }
        case 'open-dsh-settings': {
          try {
            await this.controller.openRuntimeSettingsDocument()
          } catch (error) {
            void this.toast(error instanceof Error ? error.message : '无法打开运行时配置文件', true)
          }
          return
        }
        case 'open-vscode-settings': {
          void vscode.commands.executeCommand('workbench.action.openSettings', 'deepseekHarness')
          return
        }
        case 'open-web-ui': {
          /* 0.0.73：设置面板「运行环境」区按钮 → 与命令同一实现 */
          void EXT_OPEN_WEB_UI?.()
          return
        }
        case 'describe-compat': {
          /* 0.0.74：面板打开时重读适配矩阵（profile 版本文件改动/升级后无需 Reload）；
             0.0.75：顺带做一次模型目录漂移检查并把 updates 一并发布。 */
          this.maybeReportModelDrift()
          this.publishEnvironmentSettings()
          return
        }
        case 'check-updates': {
          /* 0.0.75（G11）：「立即检查」→ 总是执行 + 结果提示 */
          void this.runUpdateCheck('manual')
          return
        }
        case 'rewind-preview': {
          /* 0.0.76：消息菜单「回退到发送这条消息之前…」→ 预览 → 模态确认 → 应用 */
          if (typeof value.sessionId === 'string' && typeof value.messageSeq === 'number') {
            await this.handleRewindPreview(value.sessionId, value.messageSeq)
          }
          return
        }
        case 'context-panel-visibility': {
          /* 0.0.130：上下文面板开合（明细按需通道的拉取门）。 */
          this.controller.setContextPanelVisible(value.open === true)
          return
        }
        case 'context-detail': {
          /* C3 v1.1：明细内容按需取（本地查投影原文，零 RPC）；会话不符 → stale 回执 */
          const sessionId = typeof value.sessionId === 'string' ? value.sessionId : ''
          const requestId = typeof value.requestId === 'number' ? value.requestId : 0
          const key = typeof value.key === 'string' ? value.key.slice(0, 64) : ''
          const request = contextDetailRequestOf(value.request)
          const result = request === undefined ? { ok: false } : this.controller.contextDetail(sessionId, request)
          /* 图片独立于文本结果：纯图片消息回落里没有正文，但图片照取（C11 修复） */
          const images = request !== undefined && request.kind === 'node'
            ? await this.controller.contextDetailImages(sessionId, request.seq)
            : []
          await this.webview.postMessage({
            type: 'context-detail-result',
            sessionId,
            requestId,
            key,
            ...(result === undefined
              ? { stale: true }
              : {
                ...result,
                ...(images.length > 0 ? { ok: true, images } : {}),
              }),
          })
          return
        }
        case 'rename-session': {
          if (typeof value.sessionId === 'string' && typeof value.title === 'string') {
            const titles = extSessionTitles()
            /* 0.1.0 修复（用户实测）：**空串 = 恢复默认名**——删掉本地改名，让运行时投影名接管；
               并刷新列表里的显示标题（此前缓存的名字不会自己变回去）。 */
            if (value.title.trim() === '') delete titles[value.sessionId]
            else titles[value.sessionId] = value.title.slice(0, 80)
            void EXT_CONTEXT?.workspaceState.update('dshSessionTitles', titles)
            this.controller.refreshSessionTitle(value.sessionId)
            void this.webview.postMessage({ type: 'session-titles', titles: visibleSessionTitles() })
          }
          return
        }
        case 'select-session':
          if (typeof value.sessionId === 'string') await this.controller.selectSession(value.sessionId)
          return
        case 'trash-session':
          if (typeof value.sessionId === 'string') await this.controller.trashSession(value.sessionId)
          return
        case 'restore-session':
          if (typeof value.sessionId === 'string') await this.controller.restoreSession(value.sessionId)
          return
        case 'reorder-sessions':
          // G5 v9: webview 拖拽上报——`sessionId` 移到 `beforeId` 之前（缺省=末尾）
          if (typeof value.sessionId === 'string') {
            const beforeId = typeof value.beforeId === 'string' ? value.beforeId : undefined
            await this.controller.reorderSessions(value.sessionId, beforeId)
          }
          return
        case 'purge-session':
          if (typeof value.sessionId === 'string') await this.controller.purgeSession(value.sessionId)
          return
        case 'load-history': await this.controller.loadOlderHistory(); return
        case 'rail-retry':
          if (typeof value.sessionId === 'string' && value.sessionId === this.controller.state.sessionId) await this.pushRailTable(value.sessionId)
          return
        case 'cancel-history-navigation': this.controller.cancelHistoryNavigation(); return
        /* G49 v2（0.0.121）：轨道跳转到"未加载的轮"——按目标 seq 连续翻页直到该轮进入窗口，
           然后回一条 turn-jump-ready 让端侧滚动到位（官方 turnOutline 的 load-through 语义）。 */
        case 'load-turn': {
          const target = typeof value.seq === 'number' && Number.isFinite(value.seq) ? value.seq : undefined
          const requestId = typeof value.requestId === 'number' && Number.isSafeInteger(value.requestId) && value.requestId > 0 ? value.requestId : undefined
          if (target !== undefined && requestId !== undefined && value.sessionId === this.controller.state.sessionId) await this.controller.loadThroughSequence(target, 'jump', requestId)
          return
        }
        /* 0.1.124（数据层根治）：Reload 恢复的穿透加载——锚点在窗口外时按 seq 连续翻页（上限 12 页），
           到载后回 restore-through-ready 由端侧重定位（与轨道跳转的 load-turn 分道）。 */
        case 'restore-through': {
          const target = typeof value.seq === 'number' && Number.isFinite(value.seq) ? value.seq : undefined
          if (target !== undefined) await this.controller.loadThroughSequence(target, 'restore')
          return
        }
        case 'load-tool-output':
          if (typeof value.messageId === 'string' && typeof value.requestId === 'number') {
            const sessionId = this.controller.state.sessionId
            const requestedSessionId = typeof value.sessionId === 'string' ? value.sessionId : ''
            const message = requestedSessionId === sessionId
              ? this.controller.state.messages.find(candidate => candidate.id === value.messageId)
              : undefined
            await this.webview.postMessage({
              type: 'tool-output',
              // Address the reply to the requesting session so its webview does
              // not drop a session-mismatch error and hang on the 15s timeout.
              sessionId: requestedSessionId,
              messageId: value.messageId,
              requestId: value.requestId,
              ...(message === undefined
                ? { error: requestedSessionId === sessionId ? '该工具输出已不可用。' : '会话在输出加载完成前已切换。' }
                : { page: pageConversationMessage(message, typeof value.cursor === 'string' ? value.cursor : undefined) }),
            })
          }
          return
        case 'send':
          if (typeof value.text === 'string') {
            if (value.text.trim() === '/permission danger-full-access') {
              const confirmed = await vscode.window.showWarningMessage(
                '启用完全访问？',
                {
                  modal: true,
                  detail: '完全访问会减少确认步骤，让代理直接执行更多操作，包括敏感操作、文件修改或外部命令。请仅在信任当前任务时使用。',
                },
                '启用完全访问',
              )
              if (confirmed !== '启用完全访问') {
                this.setPrompt(value.text)
                void this.webview.postMessage({ type: 'send-failed', echoSeq: value.echoSeq })
                return
              }
            }
            /* 0.0.56（复测 ③ 根因）: 运行时未就绪（sessionId 空 / 非 ready）直接拦下——**不做任何清空**，
               只把 webview 已同步清掉的文本还回去并回收气泡。此前该场景在 controller.send 里静默 return，
               调用方的失败还原被跳过 → 文本+图片"凭空消失"（用户实测）。 */
            if (this.controller.state.sessionId === '' || this.controller.state.phase !== 'ready') {
              void this.toast('DeepSeek Harness 尚未就绪，消息未发送', true)
              this.setPrompt(value.text)
              void this.webview.postMessage({ type: 'send-failed', ...(typeof value.echoSeq === 'number' ? { echoSeq: value.echoSeq } : {}) })
              return
            }
            const preparationSessionId = this.controller.state.sessionId
            const earlyImages = [...this.draftImages]
            const preparation = new AbortController()
            let preparing = this.preparingUiSends.get(preparationSessionId)
            if (preparing === undefined) { preparing = new Set(); this.preparingUiSends.set(preparationSessionId, preparing) }
            preparing.add(preparation)
            let draftCleared = false
            try {
            const slash = this.controller.slashRoute(value.text)
            const carriesIdeContext = slash.kind === 'prompt'
            const ideContext = carriesIdeContext ? await this.editorContext.snapshotForPrompt(value.text, includeContextNow()) : undefined
            preparation.signal.throwIfAborted()
            if (this.controller.state.sessionId !== preparationSessionId) throw new Error('会话已切换，消息尚未发送。')
            if (ideContext !== undefined && !includeContextNow()) {
              delete ideContext.activeFile
              delete ideContext.selection
            }
            const mode: PromptMode = value.mode === 'steer' ? 'steer' : 'queue'
            // Limits can land after the picker ran, so the send is the last point
            // where the whole draft can be measured against what the runtime states.
            /* 0.0.79（GIF②④）：选帧草稿 → 一帧一张 PNG 展开后再做上限检查与发送 */
            const outgoingImages = expandedDraftImages(this.draftImages)
            const rejection = rejectImageAttachments(
              [],
              outgoingImages.map(candidateOf),
              this.controller.state.imageLimits,
            )
            if (rejection !== undefined) {
              void this.toast(rejection, true)
              this.setPrompt(value.text)
              void this.webview.postMessage({ type: 'send-failed', ...(typeof value.echoSeq === 'number' ? { echoSeq: value.echoSeq } : {}) })
              return
            }
            // 0.0.55（反馈③二次）: 清空必须抢在一切 await 之前——此前 recordMessageFiles（多文件 stat）
            // 挡在清空前，文件 chips 比文本晚几百毫秒才消失（用户实测"附带文件滞后"）。
            // 顺序依据：ideContext/snapshotPinned 已先行快照，清空不影响它们。
            const sentImages = [...this.draftImages]
            const pinnedSnapshot = carriesIdeContext ? this.editorContext.snapshotPinned() : undefined
            /* 0.0.56（审核 P1）: 记录发送时的会话——失败还原必须按"发送时的会话"分流，
               否则在途切换会话时会把 A 的草稿灌进 B（跨会话串台）。 */
            const sentSessionId = this.controller.state.sessionId
            const echoSeq = typeof value.echoSeq === 'number' ? value.echoSeq : undefined
            this.draftImages.length = 0
            draftCleared = true
            if (carriesIdeContext) {
              // 0.0.55（反馈①a）: 清空会让 onDidChange 处理器里的"点击即附带"立刻把 __attached__ 加回来；
              // publish 是同步的，用一次性标志让紧随其后的那一次自动附带跳过（下一次编辑器事件照常附带）。
              this.skipAttachOnce = true
              this.editorContext.clearPinned()
              this.skipAttachOnce = false
            }
            await this.publishDraftImages()
            let promptRpcId: string | undefined
            try {
              // G22 bug④: 文件卡元数据必须在 send 前落槽——否则 dsh 回显帧先到，injectMessageFiles 查无此槽，
              // 乐观卡整轮停留 "Attachment"，切回会话（历史重建）才命中（用户 2026-09-01 实测）。
              if (carriesIdeContext && ideContext !== undefined) {
                await this.recordMessageFiles(ideContext.pinned, value.text, this.controller.state.sessionId)
              }
              preparation.signal.throwIfAborted()
              promptRpcId = await this.controller.send(value.text, outgoingImages, ideContext, mode)
              void this.webview.postMessage({ type: 'send-accepted', echoSeq, sessionId: sentSessionId })
              /* 0.0.161：成功发出 → 清除该会话的持久化草稿（判据③：Reload 不复活）。 */
              this.draftStore.remove(sentSessionId)
              this.persistedImageSig.delete(sentSessionId)
            } catch (error) {
              // 0.0.55（反馈①b）: 发送失败成套还原——文本 + 图片 + 附带文件都回到输入框，可改配置重发。
              // 0.0.56（审核 P1）: 按"发送时的会话"分流——在途切走时不碰当前会话，草稿存回原会话槽位。
              const cancelled = error instanceof DshRpcError && error.code === 'gateway/cancelled'
              const plan = planSendFailure(this.controller.state.sessionId, sentSessionId)
              this.output.appendLine(`[send] failed on ${sentSessionId} (now ${this.controller.state.sessionId}): ${error instanceof Error ? error.message : String(error)}`)
              if (plan.kind === 'restore-current') {
                if (pinnedSnapshot !== undefined) {
                  this.skipAttachOnce = true
                  this.editorContext.restorePinned(pinnedSnapshot)
                  this.skipAttachOnce = false
                }
                this.draftImages.push(...sentImages)
                await this.publishDraftImages()
                this.setPrompt(value.text)
                void this.webview.postMessage({ type: 'send-failed', ...(echoSeq === undefined ? {} : { echoSeq }) })
              } else {
                /* 已切走：pinned 存回原会话槽（切回自动恢复）；文本/图片交 webview 存进原会话 draftSlot */
                if (pinnedSnapshot !== undefined) savePinnedSlot(this.pinnedSlots, plan.sessionId, pinnedSnapshot)
                void this.webview.postMessage({
                  type: 'send-failed',
                  ...(echoSeq === undefined ? {} : { echoSeq }),
                  restore: {
                    sessionId: plan.sessionId,
                    text: value.text,
                    images: sentImages.map(image => ({ id: image.id, name: image.name, mediaType: image.mediaType, data: 'data:' + image.mediaType + ';base64,' + image.data })),
                  },
                })
                if (!cancelled) void this.toast('发送失败：会话已切换，草稿已存回原会话', true)
              }
              if (cancelled) { void this.toast('已停止：尚未发送的内容已还回草稿'); return }
              throw error
            }
            // 0.0.55（反馈③）: 发送成功后 origin 字节不能随草稿丢弃——留档供气泡图"复制原格式"按 name 取回。
            this.rememberSentOrigins(sentImages)
            /* 0.0.56c: 记录"已受理但尚未入历史"的发送——stop 丢弃队列项时据此还原（见 takePendingSend）。
               0.0.59: 带上 rpcId——stop 时若消息仍在运行时队列则**不**还原（队列双份）。 */
            this.controller.rememberPendingSend({
              sessionId: sentSessionId,
              text: value.text,
              images: sentImages,
              ...(promptRpcId === undefined ? {} : { rpcId: promptRpcId }),
            })
            } catch (error) {
              if (!draftCleared) {
                if (this.controller.state.sessionId === preparationSessionId) this.setPrompt(value.text)
                void this.webview.postMessage({ type: 'send-failed', echoSeq: value.echoSeq,
                  ...(this.controller.state.sessionId === preparationSessionId ? {} : { restore: {
                    sessionId: preparationSessionId, text: value.text,
                    images: earlyImages.map(image => ({ id: image.id, name: image.name, mediaType: image.mediaType, data: 'data:' + image.mediaType + ';base64,' + image.data })),
                  } }),
                })
                if (preparation.signal.aborted) { void this.toast('已停止：尚未发送的内容已保留在草稿'); return }
              }
              throw error
            } finally {
              preparing.delete(preparation)
              if (preparing.size === 0 && this.preparingUiSends.get(preparationSessionId) === preparing) this.preparingUiSends.delete(preparationSessionId)
            }
          }
          return
        case 'draft-state': {
          // G22 bug⑥: webview 切会话时上报"有未发送草稿"的会话集（text/images 在 webview 内）；
          // 文件卡快照（pinnedSlots，此例中已由 applyPinnedSlots 先行保存）并入后再交 controller。
          const ids = Array.isArray(value.sessionIds) ? value.sessionIds : []
          const next = new Set(ids.filter((id): id is string => typeof id === 'string'))
          for (const [sessionId, entries] of this.pinnedSlots) {
            if ((entries?.length ?? 0) > 0) next.add(sessionId)
          }
          this.controller.setDraftfulSessions(next)
          return
        }
        case 'sync-draft-images': {
          // G19: webview 切会话恢复时重建权威源（禁回声，不再 publishDraftImages）
          const images = Array.isArray(value.images) ? value.images : []
          const next: DraftImageEntry[] = []
          for (const entry of images) {
            const image = entry as { id?: unknown; name?: unknown; mediaType?: unknown; data?: unknown; frameSelections?: unknown }
            if (typeof image.id !== 'string' || typeof image.name !== 'string' || typeof image.mediaType !== 'string' || typeof image.data !== 'string') continue
            const mediaType = image.mediaType === 'image/png' || image.mediaType === 'image/jpeg' || image.mediaType === 'image/webp' || image.mediaType === 'image/gif' ? image.mediaType : undefined
            if (mediaType === undefined) continue
            const comma = image.data.indexOf(',')
            if (comma < 0) continue
            /* 0.0.79：选帧集合随会话草稿槽往返（切会话恢复时不丢）；0.0.96：上限随设置 */
            const frameSelections = draftFrameSelectionsOf(image.frameSelections, this.controller.state.previewSettings.maxFrameSelections)
            next.push({
              id: image.id,
              type: 'image',
              mediaType,
              data: image.data.slice(comma + 1),
              name: image.name,
              ...(frameSelections.length === 0 ? {} : { frameSelections }),
            })
          }
          this.draftImages.length = 0
          this.draftImages.push(...next)
          /* 0.0.161：切会话恢复后把该会话图片集合落盘（签名去重：同集合不重复写）。 */
          this.persistDraftImagesNow()
          return
        }
        case 'set-draft-frames': {
          /* 0.0.79（GIF②④）：选帧集合（多选）——webview 逐帧解码为 PNG；
             空集合 = 清除选择（发送整张 GIF）。草稿本体的 data/mediaType 不动。 */
          const id = typeof value.id === 'string' ? value.id : ''
          const entry = this.draftImages.find(image => image.id === id)
          if (entry === undefined) return
          const frames = draftFrameSelectionsOf(value.frames, this.controller.state.previewSettings.maxFrameSelections)
          if (frames.length === 0) delete entry.frameSelections
          else entry.frameSelections = frames
          return
        }
        case 'persist-draft': {
          /* 0.0.161：webview 文本草稿上报（已去抖；图片由扩展在变更点单独落盘——见 publishDraftImages）。
             缺省字段沿用已存值。开关关 → 忽略并清一次库（防旧数据残留）。 */
          if (!this.draftStore.enabled) return
          if (!keepDraftsNow()) { this.draftStore.purge(); return }
          const draftSessionId = typeof value.sessionId === 'string' ? value.sessionId : ''
          if (draftSessionId === '' || typeof value.text !== 'string') return
          this.draftStore.upsert(draftSessionId, { text: value.text })
          return
        }
        case 'describe-storage': {
          /* 0.0.163（审查 P1-2）：设置台「存储」区——目录位置 + 占用（打开面板时拉取）。 */
          const entries = await storageSnapshotView(this.controller.cwd)
          void this.webview.postMessage({ type: 'storage-state', entries })
          return
        }
        case 'storage-open': {
          const target = typeof value.path === 'string' ? value.path : ''
          try {
            if (target === '' || !fs.existsSync(target)) {
              /* 0.0.164（用户实测）：目录尚未创建（懒创建：首次用到才建）——明示而非报错。 */
              void this.toast('该目录尚未创建（首次用到时自动创建）', true)
              return
            }
            /* 0.0.164（用户实测 0x2）：openExternal 对本地路径在 Windows 报"打开外部程序时出错"——
               与 0.0.26 同款坑，走已验证的 PowerShell Start-Process（目录 → 资源管理器）；非 win 退回。 */
            if (IS_WIN) void runStartProcess(target).catch(() => void vscode.env.openExternal(vscode.Uri.file(target)))
            else void vscode.env.openExternal(vscode.Uri.file(target))
          } catch { void this.toast('无法打开该目录', true) }
          return
        }
        case 'storage-purge': {
          const target = typeof value.target === 'string' ? value.target : ''
          if (target === 'recycle') {
            const count = await this.controller.purgeAllRecycle()
            void this.toast(count === 0 ? '回收站已是空的' : `已永久删除 ${String(count)} 个会话`)
          } else if (target === 'drafts') {
            draftStoreNow().purge()
            this.persistedImageSig.clear()
            void this.toast('已清空未发送草稿')
          } else if (target === 'temp') {
            const count = await cleanupTempClipFiles()
            void this.toast(count === 0 ? '没有可清理的临时文件' : `已清理 ${String(count)} 个临时文件`)
          }
          /* 清理后刷新占用。 */
          const entries = await storageSnapshotView(this.controller.cwd)
          void this.webview.postMessage({ type: 'storage-state', entries })
          return
        }
        case 'select-permission':
          if (typeof value.permission === 'string'
            && this.controller.state.permissions.some(permission => permission.value === value.permission)) {
            const policySessionId = this.controller.state.sessionId
            if (requiresFullAccessConfirmation(value.permission)) {
              const confirmed = await vscode.window.showWarningMessage(
                '启用完全访问？',
                {
                  modal: true,
                  detail: '完全访问会关闭工作区限制与审批提示。请仅在信任当前任务时使用。',
                },
                '启用完全访问',
              )
              if (confirmed !== '启用完全访问') {
                await this.resyncState()
                return
              }
            }
            await this.controller.executePolicyCommand(`/permission ${value.permission}`, policySessionId)
          }
          return
        case 'select-mode':
          if ((value.mode === 'normal' || value.mode === 'plan') && this.controller.state.plan.available) {
            await this.controller.executePolicyCommand(planModeCommand(value.mode), this.controller.state.sessionId)
          }
          return
        case 'select-agent-preset':
          if (typeof value.agentPreset === 'string') await this.controller.selectAgentPreset(value.agentPreset)
          return
        case 'attach': await this.chooseAttachments(); return
        case 'toggle-include-context': {
          const next = !includeContextNow()
          void EXT_CONTEXT?.globalState.update('dshIncludeContext', next)
          // bug⑧: 开开关即附带当前文件——顺带替换 stale 的旧 `__attached__`（开关关闭期间切换过文件时）
          if (next) attachActiveFileIfNeeded(this.editorContext, true)
          this.controller.publish({ includeContext: next })
          return
        }
        case 'paste-files': {
          const images = Array.isArray(value.images) ? value.images : []
          const documents = Array.isArray(value.documents) ? value.documents : []
          const incoming: Array<PromptImage & { id: string }> = []
          for (const entry of images) {
            const image = entry as { name?: unknown; dataUrl?: unknown }
            if (typeof image.name !== 'string' || typeof image.dataUrl !== 'string') continue
            const mime = /^data:([a-z0-9/+.-]+);/i.exec(image.dataUrl)?.[1]
            const mediaType = mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp' || mime === 'image/gif'
              ? mime
              : imageMediaType(image.name)
            if (mediaType === undefined) continue
            const comma = image.dataUrl.indexOf(',')
            if (comma < 0) continue
            incoming.push({ id: randomUUID(), type: 'image', mediaType, data: stripPngMetadataBase64(image.dataUrl.slice(comma + 1)), name: image.name })
          }
          const rejection = rejectImageAttachments(
            this.draftImages.map(candidateOf),
            incoming.map(candidateOf),
            this.controller.state.imageLimits,
          )
          if (rejection !== undefined) {
            void vscode.window.showWarningMessage(rejection)
            return
          }
          if (incoming.length > 0) {
            this.draftImages.push(...incoming)
            await this.publishDraftImages()
          }
          if (documents.length > 0) {
            const cwd = this.controller.state.cwd
            if (cwd === '') {
              void vscode.window.showWarningMessage('请先打开项目，再附加粘贴的文件。')
            } else {
              /* 批 C P2-12（0.0.61）: 逐文件隔离——单个落盘失败不再拖垮余下文件；末尾汇总提示。 */
              let storedCount = 0
              let failedCount = 0
              for (const entry of documents) {
                const document = entry as { name?: unknown; dataUrl?: unknown }
                if (typeof document.name !== 'string' || typeof document.dataUrl !== 'string') continue
                const comma = document.dataUrl.indexOf(',')
                if (comma < 0) { failedCount += 1; continue }
                try {
                  const name = document.name.replace(/[\\/:*?"<>|]/g, '_')
                  const storedName = `${String(Date.now())}-${name}`
                  const folder = vscode.Uri.joinPath(vscode.Uri.file(cwd), '_temp', '.dsh-paste')
                  const data = Buffer.from(document.dataUrl.slice(comma + 1), 'base64')
                  await vscode.workspace.fs.createDirectory(folder)
                  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, storedName), data)
                  this.editorContext.pinFile(`_temp/.dsh-paste/${storedName}`)
                  storedCount += 1
                } catch (error) {
                  failedCount += 1
                  this.output.appendLine('[paste-files] ' + (error instanceof Error ? error.message : String(error)))
                }
              }
              if (failedCount > 0) {
                void vscode.window.showWarningMessage(`已粘贴 ${String(storedCount)} 个文件，${String(failedCount)} 个失败（详见输出面板）`)
              }
            }
          }
          return
        }
        /* 0.0.145（G43）：超限图压缩回执——成功则入列（原图字节落地为 originData 供"复制原格式"），失败提示。 */
        case 'compress-image-result': {
          const origin = typeof value.id === 'string' ? this.compressOrigin.get(value.id) : undefined
          if (typeof value.id === 'string') this.compressOrigin.delete(value.id)
          const dataUrl = typeof value.dataUrl === 'string' ? value.dataUrl : undefined
          const comma = dataUrl === undefined ? -1 : dataUrl.indexOf(',')
          if (origin === undefined || dataUrl === undefined || comma < 0) {
            void this.toast('图片压缩失败：无法解码该文件（文件可能为空或已损坏）', true)
            return
          }
          const bytes = typeof value.bytes === 'number' && value.bytes > 0 ? value.bytes : 0
          const dims = typeof value.width === 'number' && typeof value.height === 'number' ? ` (${String(value.width)}×${String(value.height)})` : ''
          this.output.appendLine(`[compress-image] ${origin.name}: → ${imageSizeText(bytes)}${dims}`)
          const image = {
            id: randomUUID(),
            type: 'image',
            mediaType: 'image/jpeg',
            data: dataUrl.slice(comma + 1),
            name: origin.name,
            originData: origin.data,
            originName: origin.name,
          } as PromptImage & { id: string; originData?: string; originName?: string }
          const rejection = rejectImageAttachments(
            this.draftImages.map(candidateOf),
            [candidateOf(image)],
            this.controller.state.imageLimits,
          )
          if (rejection !== undefined) {
            void vscode.window.showWarningMessage(rejection)
            return
          }
          this.draftImages.push(image)
          await this.publishDraftImages()
          return
        }
        case 'rasterize-image-result': {
          if (typeof value.png !== 'string') {
            /* 0.0.56（审核 P1）: 失败/异常早退也要清 rasterOrigin——此前只在成功路径删，
               每次转码失败泄漏一份原图 base64（该 Map 无上限）。 */
            if (typeof value.id === 'string') this.rasterOrigin.delete(value.id)
            void this.toast('图片转码失败：无法渲染该文件（文件可能为空或已损坏）', true)
            return
          }
          const comma = value.png.indexOf(',')
          if (comma < 0) {
            if (typeof value.id === 'string') this.rasterOrigin.delete(value.id)
            return
          }
          const name = typeof value.name === 'string' ? value.name : 'image.png'
          const origin = typeof value.id === 'string' ? this.rasterOrigin.get(value.id) : undefined
          const image = {
            id: randomUUID(),
            type: 'image',
            mediaType: 'image/png',
            data: value.png.slice(comma + 1),
            name,
            ...(origin === undefined ? {} : { originData: origin.data, originName: origin.name }),
          } as PromptImage & { id: string; originData?: string; originName?: string }
          if (typeof value.id === 'string') this.rasterOrigin.delete(value.id)
          const rejection = rejectImageAttachments(
            this.draftImages.map(candidateOf),
            [candidateOf(image)],
            this.controller.state.imageLimits,
          )
          if (rejection !== undefined) {
            void vscode.window.showWarningMessage(rejection)
            return
          }
          this.draftImages.push(image)
          await this.publishDraftImages()
          return
        }
        case 'pin-file-uris': {
          if (!Array.isArray(value.uris)) return
          for (const raw of value.uris) {
            if (typeof raw !== 'string') continue
            if (raw.startsWith('file://') || raw.startsWith('vscode-file://')) {
              this.editorContext.pinFileFromUri(raw)
            } else if (raw.includes(':') || raw.startsWith('/')) {
              this.editorContext.pinFileFromUri('file:///' + raw.replace(/\\/g, '/'))
            }
          }
          return
        }
        case 'cancel-search': {
          this.searchGeneration += 1
          this.searchAbort?.abort()
          this.searchAbort = undefined
          this.lastLocalSearch = undefined
          return
        }
        /* 全文检索同时使用请求取消和代际守卫：旧 RPC 退出，迟到结果也不能覆盖新查询。 */
        case 'search-session-history': {
          const query = typeof value.query === 'string' ? value.query.trim() : ''
          const sessionId = typeof value.sessionId === 'string' ? value.sessionId : ''
          const excludes = Array.isArray(value.excludes) ? value.excludes.filter(word => typeof word === 'string' && word !== '').slice(0, 8) : []
          const requestId = typeof value.requestId === 'number' ? value.requestId : 0
          await this.searchCurrentHistory(sessionId, query, excludes, requestId)
          return
        }
        case 'search-sessions': {
          const query = typeof value.query === 'string' ? value.query.trim() : ''
          /* 0.1.76（T3-5）：`-词` 排除项由视图层解析后随请求带来（按条目全文过滤）。 */
          const excludes = Array.isArray(value.excludes) ? value.excludes.filter(word => typeof word === 'string' && word !== '').slice(0, 8) : []
          const requestId = typeof value.requestId === 'number' ? value.requestId : 0
          this.searchAbort?.abort()
          this.searchAbort = undefined
          const generation = ++this.searchGeneration
          if (query === '') {
            this.lastLocalSearch = undefined
            void this.webview.postMessage({ type: 'search-results', requestId, items: [], hasMore: false })
            return
          }
          /* 0.1.65（T3-2）：登记本轮查询——索引后台建完后据此自动补推（清空查询即失效）。 */
          this.lastLocalSearch = { query, requestId, excludes }
          const searchAbort = new AbortController()
          this.searchAbort = searchAbort
          /* ① 本工作区内容索引（0.0.170）：子串匹配——中文两字词/图片名/文件名都能中，
                且命中带 messageId（视图层可直接跳那条消息）。先建/刷新再查（首次可能 1-3s）。 */
          try {
            await this.ensureSearchIndex()
            if (generation !== this.searchGeneration) return
            const payload = this.localSearchPayload(query, excludes)
            await this.webview.postMessage({ type: 'search-results', requestId, items: payload.items, hasMore: false, local: true, index: payload.index, nodes: payload.nodes })
            await this.searchEarlyHistory(query, requestId, excludes, generation, searchAbort.signal)
          } catch (error) {
            if (generation !== this.searchGeneration) return
            this.output.appendLine('[search-index] query failed: ' + (error instanceof Error ? error.message : String(error)))
            await this.webview.postMessage({ type: 'search-results', requestId, items: [], hasMore: false, local: true, index: this.searchIndexInfo() })
          }
          /* ② 运行时全文索引（跨工作区发现）：本工作区**普通**会话命中已由本地索引覆盖，
             这里只保留他区条目 + 本工作区**子代理**条目（0.1.89：子代理不在本地索引覆盖范围）。 */
          if (generation !== this.searchGeneration) return
          try {
            const result = await this.controller.searchSessions(query, searchAbort.signal)
            if (generation !== this.searchGeneration) return
            const foreign = result.items.filter(item => item.foreign || item.subagent)
            void this.webview.postMessage({ type: 'search-results', requestId, items: foreign, hasMore: result.hasMore, local: false })
          } catch (error) {
            if (generation !== this.searchGeneration) return
            const message = error instanceof Error ? error.message : String(error)
            this.output.appendLine('[session-search] ' + message)
            const disabled = message.includes('SESSION_QUERY_SEARCH_DISABLED') || message.includes('session search is disabled')
            const timedOut = /aborted due to timeout|timed out/i.test(message)
            void this.webview.postMessage({
              type: 'search-results',
              requestId,
              items: [],
              hasMore: false,
              local: false,
              /* 本地索引可用时不再报"仅按标题过滤"——降级文案只在他区检索失败时提示一句。 */
              error: disabled
                ? '跨工作区检索未启用（本工作区仍可搜）'
                : timedOut
                  ? '跨工作区检索超时（本工作区仍可搜）'
                  : '跨工作区检索暂不可用',
            })
          } finally {
            if (this.searchAbort === searchAbort) this.searchAbort = undefined
          }
          return
        }
        case 'choose-workspace': await this.chooseWorkspace(); return
        case 'request-mentions':
          if (typeof value.requestId === 'number' && typeof value.query === 'string') {
            const candidates = await this.editorContext.search(value.query)
            await this.webview.postMessage({
              type: 'mention-suggestions',
              requestId: value.requestId,
              query: value.query,
              candidates,
            })
          }
          return
        case 'remove-context':
          if (typeof value.id === 'string') {
            if (value.id === '__active__') this.editorContext.dismissActiveFile()
            else this.editorContext.removePinned(value.id)
          }
          return
        case 'remove-attachment':
          if (typeof value.id === 'string') {
            const index = this.draftImages.findIndex(image => image.id === value.id)
            if (index >= 0) this.draftImages.splice(index, 1)
            await this.publishDraftImages()
          }
          return
        case 'clear-draft':
          this.draftImages.length = 0
          this.editorContext.clearPastePins()
          await this.publishDraftImages()
          return
        case 'copy-text':
          if (typeof value.text === 'string') void vscode.env.clipboard.writeText(value.text)
          return
        case 'copy-message': {
          /* 0.0.162（全产品审查 P0-3）：消息级「复制该消息」经扩展取**全文**——超长助手回复
             发给 webview 前被瘦身（text 置空 + deferredBody），webview 侧直接复制会得到空串。 */
          const messageId = typeof value.id === 'string' ? value.id : ''
          const fullText = messageId === '' ? undefined : this.controller.fullMessageText(messageId)
          if (fullText === undefined || fullText === '') {
            void this.toast('该消息暂无可复制的文本', true)
            return
          }
          void vscode.env.clipboard.writeText(fullText)
          return
        }
        case 'toast':
          /* G45（0.0.103）：webview 侧发起的一次性提示（如「正在准备 SVG 组件…」）。 */
          if (typeof value.text === 'string' && value.text !== '') void this.toast(value.text, value.failed === true)
          return
        case 'copy-svg-clip': {
          /* G45（0.0.103）：公式「复制为 SVG」——SVG（+PNG 兜底）入系统剪贴板；临时文件即用即清。
             SVG 字节由 webview 侧 MathJax 生成（tex2svg + 颜色替换 + 宽高），PNG 为 canvas 栅格化兜底。 */
          if (typeof value.svg !== 'string' || value.svg === '') return
          const svgFile = path.join(os.tmpdir(), 'dsh-svg-clip-' + randomUUID() + '.svg')
          const pngFile = path.join(os.tmpdir(), 'dsh-svg-clip-' + randomUUID() + '.png')
          const pngRaw = typeof value.png === 'string' && value.png.startsWith('data:') ? value.png.slice(value.png.indexOf(',') + 1) : ''
          try {
            await vscode.workspace.fs.writeFile(vscode.Uri.file(svgFile), Buffer.from(value.svg, 'utf8'))
            if (pngRaw !== '') await vscode.workspace.fs.writeFile(vscode.Uri.file(pngFile), Buffer.from(pngRaw, 'base64'))
            await runPowershell(svgClipScript(svgFile, pngRaw !== '' ? pngFile : ''))
            void this.toast('已复制 SVG')
          } catch (error) {
            this.output.appendLine('[copy-svg-clip] ' + (error instanceof Error ? error.message : String(error)))
            void this.toast('复制 SVG 失败', true)
          } finally {
            try { await vscode.workspace.fs.delete(vscode.Uri.file(svgFile)) } catch { /* 尽力清理 */ }
            try { await vscode.workspace.fs.delete(vscode.Uri.file(pngFile)) } catch { /* 尽力清理 */ }
          }
          return
        }
        case 'copy-mathml-clip': {
          /* G45（0.0.103）：公式「复制为 MathML」——CF_HTML（'HTML Format'）写入；Word 转为可编辑公式。 */
          if (typeof value.mathml !== 'string' || value.mathml === '') return
          const htmlFile = path.join(os.tmpdir(), 'dsh-mathml-clip-' + randomUUID() + '.html')
          try {
            await vscode.workspace.fs.writeFile(vscode.Uri.file(htmlFile), Buffer.from(cfHtmlDocument(value.mathml), 'utf8'))
            await runPowershell(mathmlClipScript(htmlFile))
            void this.toast('已复制 MathML')
          } catch (error) {
            this.output.appendLine('[copy-mathml-clip] ' + (error instanceof Error ? error.message : String(error)))
            void this.toast('复制 MathML 失败', true)
          } finally {
            try { await vscode.workspace.fs.delete(vscode.Uri.file(htmlFile)) } catch { /* 尽力清理 */ }
          }
          return
        }
        case 'copy-png-clip': {
          /* G45 v1.2（0.0.105）：公式「复制为 PNG」——纯位图（按档位栅格化），复用图片剪贴板管道。 */
          if (typeof value.png !== 'string' || !value.png.startsWith('data:')) return
          const formulaRaw = value.png.slice(value.png.indexOf(',') + 1)
          const formulaFile = path.join(os.tmpdir(), 'dsh-formula-png-' + randomUUID() + '.png')
          try {
            await vscode.workspace.fs.writeFile(vscode.Uri.file(formulaFile), Buffer.from(formulaRaw, 'base64'))
            await runPowershell(imageClipScript(formulaFile))
            void this.toast('已复制 PNG')
          } catch (error) {
            this.output.appendLine('[copy-png-clip] ' + (error instanceof Error ? error.message : String(error)))
            void this.toast('复制 PNG 失败', true)
          } finally {
            try { await vscode.workspace.fs.delete(vscode.Uri.file(formulaFile)) } catch { /* 尽力清理 */ }
          }
          return
        }
        case 'save-svg-file': {
          /* G45 v1.2（0.0.105）：公式「另存为 SVG 文件」——保存对话框 → .svg 落盘（分享场景）。 */
          if (typeof value.svg !== 'string' || value.svg === '') return
          const suggested = typeof value.name === 'string' && value.name !== '' ? value.name : 'formula.svg'
          const baseDir = this.controller.state.cwd !== '' ? this.controller.state.cwd : os.homedir()
          const target = await vscode.window.showSaveDialog({
            saveLabel: '保存 SVG',
            filters: { SVG: ['svg'] },
            defaultUri: vscode.Uri.file(path.join(baseDir, suggested)),
          })
          if (target === undefined) return
          try {
            await vscode.workspace.fs.writeFile(target, Buffer.from(value.svg, 'utf8'))
            void this.toast('已保存 SVG')
          } catch (error) {
            this.output.appendLine('[save-svg-file] ' + (error instanceof Error ? error.message : String(error)))
            void this.toast('保存 SVG 失败', true)
          }
          return
        }
        case 'copy-files': {
          /* "复制文件"：去前缀名副本写入系统剪贴板（CF_HDROP）——粘贴到资源管理器即得干净命名。 */
          if (typeof value.path !== 'string' || typeof value.name !== 'string') return
          const cwd0 = this.controller.state.cwd
          const absolute = normalizeWithin(cwd0, value.path)
          if (absolute === undefined || value.name.trim() === '') return
          const safeName = displayNameOf(value.name).replace(/[\\/:*?"<>|]/g, '_')
          if (safeName === '') return
          const exportDir = vscode.Uri.joinPath(vscode.Uri.file(cwd0), '_temp', '.dsh-export')
          try {
            await vscode.workspace.fs.createDirectory(exportDir)
            const target = vscode.Uri.joinPath(exportDir, safeName)
            await vscode.workspace.fs.copy(vscode.Uri.file(absolute), target, { overwrite: true })
            await runPowershell(fileDropScript([target.fsPath]))
            void this.toast(`已复制到剪贴板：${safeName}`)
          } catch (error) {
            this.output.appendLine('[copy-files] ' + (error instanceof Error ? error.message : String(error)))
            void this.toast('复制文件失败（源不存在或剪贴板不可用）', true)
          }
          return
        }
        case 'copy-file-as-image': {
          /* 0.0.55（反馈②）: 图片文件（文件卡形态）复制为 PNG 位图——先转 PNG 再入剪贴板，透明区域保持。
             批 C P2-8（0.0.61）: .NET 可解码 png/jpg/gif/bmp/tif/ico 走 PowerShell；webp/avif/svg
             发回 webview 用 canvas 转码（复用 copy-image-clip 管道），不再必然失败。 */
          if (typeof value.path !== 'string' || typeof value.name !== 'string') return
          const absolute = normalizeWithin(this.controller.state.cwd, value.path)
          if (absolute === undefined) { void this.toast('该文件在工作区之外，无法复制为图片', true); return }
          const rasterMime = COPY_AS_IMAGE_RASTER_EXTENSIONS[path.extname(absolute).toLowerCase()]
          if (rasterMime !== undefined) {
            try {
              const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absolute))
              void this.webview.postMessage({
                type: 'convert-image-clip',
                name: value.name,
                mediaType: rasterMime,
                data: Buffer.from(bytes).toString('base64'),
              })
            } catch (error) {
              this.output.appendLine('[copy-file-as-image] ' + (error instanceof Error ? error.message : String(error)))
              void this.toast('复制图片失败（无法读取该文件）', true)
            }
            return
          }
          try {
            await runPowershell(imageFileClipScript(absolute))
            void this.toast(`已复制图片(PNG)：${displayNameOf(value.name) || value.name}`)
          } catch (error) {
            this.output.appendLine('[copy-file-as-image] ' + (error instanceof Error ? error.message : String(error)))
            void this.toast('复制图片失败（该格式可能不受支持）', true)
          }
          return
        }
        case 'copy-image-clip':
          if (typeof value.data !== 'string' || !value.data) return
          {
            /* draft 图片 data 形如 'data:image/png;base64,' + base64——FromBase64String 不能带前缀，先剥离 */
            const rawImage = value.data.startsWith('data:') ? value.data.slice(value.data.indexOf(',') + 1) : value.data
            /* 0.0.55（反馈④）: 剪贴板里放的是 PNG——提示名同步换成 .png 后缀（此前照抄原格式名，
               如"已复制 PNG：xxx.svg"，用户实测反馈名实不符）。 */
            const sourceName = displayNameOf(typeof value.name === 'string' && value.name !== '' ? value.name : 'image') || 'image'
            const label = sourceName.replace(/\.[^./\\]+$/, '') + '.png'
            /* 0.0.55（反馈④）: 先落盘再交给 PowerShell 读文件——base64 内嵌脚本会超出 Windows
               命令行上限（>~9KB 图片必失败）。临时文件放系统临时目录，尽力删除。 */
            const scratch = path.join(os.tmpdir(), 'dsh-image-clip-' + randomUUID() + '.png')
            try {
              await vscode.workspace.fs.writeFile(vscode.Uri.file(scratch), Buffer.from(rawImage, 'base64'))
              await runPowershell(imageClipScript(scratch))
              void this.toast(`已复制 PNG：${label}`)
            } catch (error) {
              this.output.appendLine('[copy-image-clip] ' + (error instanceof Error ? error.message : String(error)))
              void this.toast('复制 PNG 失败', true)
            } finally {
              try { await vscode.workspace.fs.delete(vscode.Uri.file(scratch)) } catch { /* 尽力清理 */ }
            }
          }
          return
        case 'copy-image-original': {
          /* 原格式复制：①草稿图（id → origin 缓存/自身字节）②发送留档（attachmentId → 真原字节，
             0.0.58 落盘）③会话级 name 缓存（转码图兜底）④气泡图自身字节兜底。
             以 CF_HDROP 入剪贴板——粘贴到资源管理器得到原格式文件。 */
          const draft = typeof value.id === 'string' ? this.draftImages.find(item => item.id === value.id) : undefined
          let raw: string | undefined
          let originName: string | undefined
          if (draft !== undefined) {
            raw = draft.originData ?? (draft.data.startsWith('data:') ? draft.data.slice(draft.data.indexOf(',') + 1) : draft.data)
            originName = draft.originName || draft.name
          } else {
            const sessionId = this.controller.state.sessionId
            const stored = typeof value.attachmentId === 'string' && value.attachmentId !== '' && sessionId !== ''
              ? await ORIGIN_STORE?.dataOf(sessionId, value.attachmentId)
              : undefined
            const cached = typeof value.name === 'string' && value.name !== '' ? this.sentImageOrigins.get(value.name) : undefined
            if (stored !== undefined) { raw = stored.rawBase64; originName = stored.label }
            else if (cached !== undefined) { raw = cached.data; originName = cached.name }
            else if (typeof value.data === 'string' && value.data !== '') {
              raw = value.data.startsWith('data:') ? value.data.slice(value.data.indexOf(',') + 1) : value.data
              originName = typeof value.name === 'string' ? value.name : undefined
            }
          }
          if (raw === undefined) return
          const name = displayNameOf((originName || 'image.png'))
            .trimStart().replace(/[\\/:*?"<>|]/g, '_') || 'image.png'
          const cwd = this.controller.state.cwd
          if (cwd === '') { void this.toast('先打开项目再复制图片', true); return }
          try {
            const exportDir = vscode.Uri.joinPath(vscode.Uri.file(cwd), '_temp', '.dsh-export')
            await vscode.workspace.fs.createDirectory(exportDir)
            const target = vscode.Uri.joinPath(exportDir, name)
            await vscode.workspace.fs.writeFile(target, Buffer.from(raw, 'base64'))
            await runPowershell(fileDropScript([target.fsPath]))
            void this.toast(`已复制原格式图片：${name}`)
          } catch (error) {
            this.output.appendLine('[copy-image-original] ' + (error instanceof Error ? error.message : String(error)))
            void this.toast('复制原格式图片失败（可尝试“复制 PNG”）', true)
          }
          return
        }
        case 'save-as': {
          const kind = value.kind === 'image' ? 'image' : 'file'
          const suggestion = typeof value.name === 'string' && value.name !== '' ? value.name : 'untitled.' + (kind === 'image' ? 'png' : 'bin')
          const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(vscode.Uri.file(this.controller.state.cwd), suggestion) })
          if (target === undefined) return
          try {
            /* 0.0.56（审核 P2）: 数据/路径都为空时曾"两个分支都不走却报已保存"——改为显式失败。 */
            let wrote = false
            if (kind === 'image' && typeof value.data === 'string' && value.data !== '') {
              /* 0.0.55: 草稿图 data 是完整 data URL——Buffer.from(…,'base64') 会忽略前缀字符拼出坏字节，
                 先剥离再解码（气泡图为裸 base64，无前缀时原样使用）。 */
              const payload = value.data.startsWith('data:') ? value.data.slice(value.data.indexOf(',') + 1) : value.data
              await vscode.workspace.fs.writeFile(target, Buffer.from(payload, 'base64'))
              wrote = true
            } else if (typeof value.path === 'string') {
              const absolute = normalizeWithin(this.controller.state.cwd, value.path)
              if (absolute === undefined) throw new Error('outside workspace')
              await vscode.workspace.fs.copy(vscode.Uri.file(absolute), target, { overwrite: true })
              wrote = true
            }
            if (!wrote) { void this.toast('另存为失败：内容尚未就绪', true); return }
            void this.toast(`已保存：${path.basename(target.fsPath)}`)
          } catch (error) {
            this.output.appendLine(`[save-as] ${error instanceof Error ? error.message : String(error)}`)
            void this.toast('另存为失败', true)
          }
          return
        }
        case 'open-with':
          if (typeof value.path !== 'string') return
          if (!IS_WIN) { void this.toast('"用其他程序打开"仅支持 Windows', true); return }
          {
            const absolute = normalizeWithin(this.controller.state.cwd, value.path)
            if (absolute === undefined) return
            void runOpenWith(absolute).catch((error: unknown) => {
              this.output.appendLine(`[open-with] ${error instanceof Error ? error.message : String(error)}`)
              void this.toast('打开方式失败', true)
            })
          }
          return
        case 'cancel': {
          const cancelledSessionId = typeof value.sessionId === 'string' ? value.sessionId : this.controller.state.sessionId
          const preparing = this.preparingUiSends.get(cancelledSessionId)
          const hadPreparation = Boolean(preparing?.size)
          for (const operation of preparing ?? []) operation.abort(new DshRpcError({ code: 'gateway/cancelled', message: 'Message preparation was cancelled.' }, 'session/prompt'))
          try { await this.controller.cancel(cancelledSessionId) }
          catch (error) { if (!hadPreparation || !(error instanceof DshRpcError) || error.code !== 'session/not-found') throw error }
          if (this.controller.state.sessionId !== cancelledSessionId) return
          /* 0.0.56c（复测 ③ 续）: "已被运行时消费却未入历史"的消息会丢（事件实证：spliced 移除后
             turn 被 abort，全程无 user/message）——此时把内容还回输入框。
             0.0.59 修正: 消息**仍在队列**时说明运行时尚未消费它（下一回合会发送），不得还原——
             否则"队列 + 草稿"双份（用户 18:06 实测：stop 后消息既在队列又回到输入框）。 */
          const pending = this.controller.takePendingSend(this.controller.state.sessionId)
          if (pending !== undefined && (pending.text !== '' || pending.images.length > 0)) {
            if (this.controller.pendingStillQueued(pending.rpcId)) {
              void this.toast('已停止：该消息仍在发送队列中（不会丢失；可编辑或删除）', true)
            } else {
              if (pending.text !== '') this.setPrompt(pending.text)
              this.draftImages.push(...pending.images)
              await this.publishDraftImages()
              void this.toast('已停止：尚未发出的消息已还回输入框', true)
            }
          }
          return
        }
        case 'queue-action':
          if (
            typeof value.itemId === 'string'
            && (value.action === 'edit' || value.action === 'remove' || value.action === 'steer')
          ) {
            await this.controller.updateQueue(
              value.itemId,
              value.action,
              typeof value.text === 'string' ? value.text : undefined,
            )
          }
          return
        case 'approval':
          if (
            typeof value.rpcId === 'string'
            && typeof value.approvalId === 'string'
            && (value.outcome === 'allowed-once' || value.outcome === 'rejected')
          ) await this.controller.answerApproval(value.rpcId, value.approvalId, value.outcome)
          return
        case 'question-cancel':
          /* 0.0.106（W2）：提问「跳过」——以 cancelled 结算；失败仅记录（面板由状态驱动自动收起）。
             2026-10-05（A）：随件带问题 id 集（换代后按 id 集结算，与提交同口径）。 */
          if (typeof value.rpcId === 'string' && Array.isArray(value.questionIds)) {
            const ids = value.questionIds.flatMap((id): string[] => typeof id === 'string' ? [id] : [])
            void this.controller.cancelQuestions(value.rpcId, ids).catch(error => this.controller.report(error))
          }
          return
        case 'question':
          if (typeof value.rpcId === 'string' && Array.isArray(value.answers)) {
            const answers = value.answers.flatMap((answer): QuestionAnswer[] => {
              if (typeof answer !== 'object' || answer === null) return []
              const item = answer as Record<string, unknown>
              if (typeof item.id !== 'string' || !Array.isArray(item.selected) || !item.selected.every(label => typeof label === 'string')) return []
              return [{
                id: item.id,
                selected: item.selected as string[],
                ...(typeof item.custom === 'string' && item.custom.trim() !== '' ? { custom: item.custom.trim() } : {}),
              }]
            })
            await this.controller.answerQuestions(value.rpcId, answers)
          }
          return
        case 'open-link':
          if (typeof value.href === 'string') {
            const uri = vscode.Uri.parse(value.href)
            if (uri.scheme === 'http' || uri.scheme === 'https') await vscode.env.openExternal(uri)
          }
          return
        case 'open-file':
          if (typeof value.path === 'string') {
            await this.controller.openFile(
              value.path,
              typeof value.line === 'number' && Number.isInteger(value.line) ? value.line : undefined,
            )
          }
          return
        case 'open-attachment':
          if (typeof value.path === 'string') await this.controller.openAttachment(value.path)
          return
        case 'review-file':
          if (typeof value.path === 'string') {
            await this.controller.reviewFile(
              value.path,
              typeof value.turn === 'number' && Number.isSafeInteger(value.turn) ? value.turn : undefined,
            )
          }
          return
        case 'review-all': await this.controller.reviewAll(); return
        case 'keep-file':
          if (typeof value.path === 'string' && typeof value.turn === 'number' && Number.isSafeInteger(value.turn)) {
            this.controller.keepFile(value.path, value.turn)
          }
          return
        case 'keep-all': this.controller.keepAll(); return
        case 'revert-file':
          if (typeof value.path === 'string' && typeof value.turn === 'number' && Number.isSafeInteger(value.turn)) {
            await this.controller.revertFile(value.path, value.turn)
          }
          return
        case 'revert-all': await this.controller.revertAll(); return
        case 'select-model':
          if (typeof value.selection === 'object' && value.selection !== null) {
            const selection = value.selection as Record<string, unknown>
            if (typeof selection.provider === 'string' && typeof selection.model === 'string') {
              await this.controller.selectModel({
                provider: selection.provider,
                model: selection.model,
                ...(typeof selection.reasoningEffort === 'string' ? { reasoningEffort: selection.reasoningEffort } : {}),
              })
            }
          }
      }
    }
    void run().catch(error => { this.controller.report(error) })
  }
}

/** Decoded byte count of a base64 payload, without materializing the bytes again. */
function base64Bytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(data.length / 4) * 3 - padding)
}

/** Measure a draft attachment against the runtime's published upload bounds. */
function candidateOf(image: PromptImage): ImageCandidate {
  return {
    mediaType: image.mediaType,
    bytes: base64Bytes(image.data),
    ...(image.name === undefined ? {} : { name: image.name }),
  }
}

function imageMediaType(filePath: string): ImageMediaType | undefined {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    default: return undefined
  }
}

class DshViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private disposed = false
  private surface: DshSurface | undefined
  private indexWarmupTimer: ReturnType<typeof setTimeout> | undefined

  private clearIndexWarmup(): void {
    if (this.indexWarmupTimer !== undefined) clearTimeout(this.indexWarmupTimer)
    this.indexWarmupTimer = undefined
  }
  private pendingPrompt: string | undefined
  private pendingConnectionsOpen = false
  /* 0.0.160（N1）：侧栏是否可见——收起/切走 = false（配合窗口聚焦判定"你在不在看"）。 */
  private viewVisible = false

  constructor(
    private readonly controller: DshChatController,
    private readonly output: vscode.OutputChannel,
    private readonly editorContext: EditorContextBridge,
    private readonly extensionUri: vscode.Uri,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    if (this.disposed) return
    this.clearIndexWarmup()
    this.surface?.dispose()
    const surface = new DshSurface(view.webview, this.controller, this.output, this.editorContext, this.extensionUri)
    this.surface = surface
    if (this.pendingConnectionsOpen) { surface.openModelConnections(); this.pendingConnectionsOpen = false }
    /* 0.0.160（N1）：通知的可见性来源——视图可见 + 窗口聚焦 = 用户正看着（不打扰）。 */
    this.viewVisible = view.visible
    this.controller.isViewVisible = () => this.viewVisible
    /* 0.1.90（用户报①）：回合结束 → 给本会话打"索引脏"标记（搜索前强制重取该会话自己的历史页重建）。 */
    this.controller.onTurnEnded = sessionId => this.surface?.markIndexDirty(sessionId)
    /* 2026-10-06（W9）：会话列表首载完成 → 错峰 10s 补一次索引构建触发（'ready' 竞态兜底；
       ensureSearchIndex 自带在途去重与 indexed() 跳过，重复调用无害）。 */
    this.controller.onInitialSessionsLoaded = () => {
      if (this.disposed) return
      this.clearIndexWarmup()
      const generation = this.controller.runtimeGeneration
      const cwd = this.controller.state.cwd
      this.indexWarmupTimer = setTimeout(() => {
        this.indexWarmupTimer = undefined
        if (this.surface === surface && this.controller.runtimeGeneration === generation && this.controller.state.cwd === cwd) surface.ensureSearchIndexNow()
      }, 10_000)
    }
    /* 0.1.124（数据层根治）：会话打开 → 下发轨道表（缓存/落盘即发；缺表按需补算后补发）。 */
    this.controller.onSessionOpened = sessionId => { void this.surface?.pushRailTable(sessionId) }
    view.onDidChangeVisibility(() => { this.viewVisible = view.visible })
    /* 0.0.91：先回填上次成功快照（断网/失败时不清空清单），再按频率节流自动检查。 */
    surface.restoreUpdateSnapshot()
    /* 0.0.75（G11）：侧栏激活时按频率节流自动检查更新（startup=每天首次；失败静默）。 */
    void surface.runUpdateCheck('auto')
    surface.maybeReportModelDrift()
    // bug⑧: 侧栏打开无 activeFile change 事件 → 主动附带当前文件（无活动文件/开关关则静默）
    attachActiveFileIfNeeded(this.editorContext, includeContextNow())
    if (this.pendingPrompt !== undefined) {
      surface.setPrompt(this.pendingPrompt)
      this.pendingPrompt = undefined
    }
    view.onDidDispose(() => {
      surface.dispose()
      if (this.surface === surface) {
        this.clearIndexWarmup()
        this.surface = undefined
        this.viewVisible = false
      }
    })
    const autoStart = vscode.workspace.getConfiguration('deepseekHarness').get<boolean>('autoStart', true)
    if (autoStart) void this.controller.start()
  }

  dispose(): void {
    this.disposed = true
    this.clearIndexWarmup()
    this.surface?.dispose()
    this.surface = undefined
    this.viewVisible = false
  }

  focusPrompt(): void {
    this.surface?.focusPrompt()
  }

  openModelConnections(): void {
    if (this.surface) this.surface.openModelConnections()
    else this.pendingConnectionsOpen = true
  }

  execEdit(command: 'undo' | 'redo'): void {
    this.surface?.execEdit(command)
  }

  setPrompt(text: string): void {
    if (this.surface === undefined) {
      this.pendingPrompt = text
      return
    }
    this.surface.setPrompt(text)
  }
}

function problemPrompt(problem: IdeContextReference): string {
  return `Fix @{${problem.path}:${String(problem.startLine ?? 1)}:${String(problem.startCharacter ?? 1)}}`
}

function problemLocationFromArguments(args: readonly unknown[]): { filePath?: string; line?: number; message?: string } {
  let filePath: string | undefined
  let line: number | undefined
  let message: string | undefined
  const inspect = (value: unknown): void => {
    if (value instanceof vscode.Uri) {
      if (value.scheme === 'file') filePath ??= value.fsPath
      return
    }
    if (typeof value !== 'object' || value === null) return
    const item = value as Record<string, unknown>
    if (typeof item.message === 'string') message ??= item.message
    if (typeof item.startLineNumber === 'number') line ??= item.startLineNumber
    if (item.uri instanceof vscode.Uri) inspect(item.uri)
    if (item.resource instanceof vscode.Uri) inspect(item.resource)
    if (typeof item.range === 'object' && item.range !== null) {
      const range = item.range as Record<string, unknown>
      if (typeof range.start === 'object' && range.start !== null) {
        const start = range.start as Record<string, unknown>
        if (typeof start.line === 'number') line ??= start.line + 1
      }
    }
  }
  for (const arg of args) inspect(arg)
  return {
    ...(filePath === undefined ? {} : { filePath }),
    ...(line === undefined ? {} : { line }),
    ...(message === undefined ? {} : { message }),
  }
}

async function chooseProblem(editorContext: EditorContextBridge, args: readonly unknown[] = []): Promise<IdeContextReference | undefined> {
  const location = problemLocationFromArguments(args)
  const direct = location.filePath === undefined
    ? editorContext.problemAtActiveEditor()
    : editorContext.problemForLocation(location.filePath, location.line, location.message)
  if (direct !== undefined) return direct
  const problems = editorContext.problems()
  const items: Array<vscode.QuickPickItem & { problem: IdeContextReference }> = problems.map(problem => ({
    label: `$(error) ${problem.path}:${String(problem.startLine ?? 1)}`,
    description: problem.severity === 'warning' ? '警告' : '错误',
    detail: problem.message ?? '',
    problem,
  }))
  const picked = await vscode.window.showQuickPick(items, {
    title: '把问题发送给 DeepSeek',
    placeHolder: problems.length === 0 ? '工作区没有错误或警告' : '选择一个诊断项',
  })
  return picked?.problem
}

let EXT_CONTEXT: vscode.ExtensionContext | undefined
/* 0.0.73：逃生舱「打开完整 Web UI」——命令与设置面板按钮共用同一实现（activate 内赋值）。 */
let EXT_OPEN_WEB_UI: (() => Promise<void>) | undefined
/** 0.0.58: 发送原图留档（落盘 globalStorage/image-origins）——显示层原图覆盖 +「复制原格式」真原字节。 */
let ORIGIN_STORE: ImageOriginStore | undefined
function extSessionTitles(): Record<string, string> {
  return EXT_CONTEXT?.workspaceState.get<Record<string, string>>('dshSessionTitles', {}) ?? {}
}

/* 0.1.0 修复（用户复测①"没恢复"）：坏标题在**每一条出口**都要滤掉——显示解析（resolveSessionTitle）
   只覆盖了 titleOf 这条路，而发往 webview 的 session-titles 消息与回收站标题都直接用原始表。
   这里统一净化，并**顺手把存量坏值从 workspaceState 里删掉**（下次读到即自愈）。 */
function visibleSessionTitles(): Record<string, string> {
  const raw = extSessionTitles()
  let dirty = false
  const clean: Record<string, string> = {}
  for (const [id, title] of Object.entries(raw)) {
    if (isBrokenSessionTitle(title)) { dirty = true; continue }
    clean[id] = title
  }
  if (dirty) void EXT_CONTEXT?.workspaceState.update('dshSessionTitles', clean)
  return clean
}
/* 0.0.88：当前会话持久化——重启运行时/重载窗口后自动回到离开前的会话（按项目路径分槽）。 */
const ACTIVE_SESSION_KEY = 'dshActiveSessionByCwd'
const ACTIVE_SESSION_SLOTS = 32
function extActiveSessionMap(): Record<string, string> {
  const value = EXT_CONTEXT?.workspaceState.get<Record<string, string>>(ACTIVE_SESSION_KEY, {})
  return typeof value === 'object' && value !== null ? value : {}
}
function extActiveSession(cwd: string): string {
  const value = extActiveSessionMap()[cwd]
  return typeof value === 'string' ? value : ''
}
function rememberActiveSession(cwd: string, sessionId: string): void {
  if (cwd === '' || sessionId === '') return
  const map = { ...extActiveSessionMap(), [cwd]: sessionId }
  const keys = Object.keys(map)
  if (keys.length > ACTIVE_SESSION_SLOTS) {
    /* 只保留最近写入的 32 个项目槽（对象键序 = 插入序，旧的在前） */
    for (const key of keys.slice(0, keys.length - ACTIVE_SESSION_SLOTS)) delete map[key]
  }
  void EXT_CONTEXT?.workspaceState.update(ACTIVE_SESSION_KEY, map)
}
/* 0.0.147：sameCwd 迁入 recycle-bin.ts（回收站分类与 extension 共用，单一来源）。 */

function extDeletedSessions(): Set<string> {
  return new Set(EXT_CONTEXT?.workspaceState.get<string[]>('dshDeletedSessions', []) ?? [])
}
const VISITED_SESSION_CAP = 64
function extVisitedSessions(): Set<string> {
  return new Set(EXT_CONTEXT?.workspaceState.get<string[]>('dshVisitedSessions', []) ?? [])
}
function commitVisitedSessions(ids: ReadonlySet<string>): void {
  void EXT_CONTEXT?.workspaceState.update('dshVisitedSessions', [...ids])
}
function currentMessageFiles(): MessageFilesStore {
  return EXT_CONTEXT?.workspaceState.get<MessageFilesStore>('dshMessageFiles', {}) ?? {}
}
function commitMessageFiles(store: MessageFilesStore): void {
  void EXT_CONTEXT?.workspaceState.update('dshMessageFiles', store)
}
const TEXT_EXTENSIONS = new Set(['md', 'txt', 'csv', 'json', 'yml', 'yaml', 'css', 'html', 'xml', 'js', 'ts', 'py', 'log', 'ini'])
/* 批 C P2-8（0.0.61）：文件卡「复制图片(PNG)」中 .NET 解不了的格式 → 发回 webview canvas 转码
   （扩展名 → MIME）；其余图片格式（png/jpg/gif/bmp/tif/ico）继续走 PowerShell System.Drawing。 */
const COPY_AS_IMAGE_RASTER_EXTENSIONS: Record<string, string> = {
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
}
export function activate(context: vscode.ExtensionContext): void {
  EXT_CONTEXT = context
  const configuredHome = vscode.workspace.getConfiguration('deepseekHarness').get<string>('home', '').trim()
  activeDshHome = resolveDshHome(undefined, undefined, configuredHome)
  const originStore = new ImageOriginStore(
    context.globalStorageUri.fsPath === '' ? '' : path.join(context.globalStorageUri.fsPath, 'image-origins'),
    { maxTotalBytes: imageStoreMaxBytesOf(imageStoreSettingsNow()) },
  )
  ORIGIN_STORE = originStore
  const workspace = vscode.workspace.workspaceFolders?.[0]
  const output = vscode.window.createOutputChannel('DeepSeek Harness', { log: true })
  sharedOutput = output
  const debugSessions = workspace === undefined ? undefined : new DebugSessionManager()
  const debugRuntime = workspace === undefined || debugSessions === undefined
    ? undefined
    : new DebugRuntimeContribution(context, debugSessions, output)
  const runtime = new DshRuntime(context, output, debugRuntime, configuredHome || undefined)
  activeRuntime = runtime

  if (workspace === undefined) {
    output.appendLine('[chat] 请先打开文件夹或工作区，再使用 DeepSeek Harness。')
  }
  const cwd = workspace?.uri.fsPath ?? ''
  const diffReviews = new DiffReviewManager(context.workspaceState)
  const controller = new DshChatController(runtime, output, new DirtyFileGuard(), diffReviews, cwd)
  void controller.pruneRecycleBin()
  /* 0.0.147: 回收站旧条目补 cwd（按项目隔离的归属主键）——启动一次，补完重发回收站状态。 */
  void controller.migrateRecycleCwd()
  void controller.pruneMessageFileStore()
  void controller.pruneExportDir()
  /* 0.0.163（审查 P1-3）：剪贴板临时件启动清理 + 低频周期 prune（此前 prune 只在激活跑一次，
     长驻窗口永不清理）。30 分钟一跳，静默。 */
  void cleanupTempClipFiles()
  const pruneTimer = setInterval(() => {
    void controller.pruneRecycleBin()
    void controller.pruneExportDir()
    void controller.pruneMessageFileStore()
  }, 30 * 60 * 1000)
  context.subscriptions.push({ dispose: () => { clearInterval(pruneTimer) } })
  /* 0.0.58: manifest 异步加载；完成后补一次重绘（此前渲染的消息此时才能切到原图）。 */
  void originStore.load().then(() => { controller.refreshImageOrigins() })
  const pluginManager = new DshPluginManager(context, controller, output, dshHomeNow())
  const editorContext = new EditorContextBridge(() => controller.cwd)
  const provider = new DshViewProvider(controller, output, editorContext, context.extensionUri)
  const panels = new Set<{ panel: vscode.WebviewPanel; surface: DshSurface }>()

  context.subscriptions.push(
    output,
    runtime,
    controller,
    diffReviews,
    editorContext,
    provider,
    originStore,
    ...(debugSessions === undefined ? [] : [debugSessions]),
  )
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('dsh-diff', diffReviews))
  context.subscriptions.push(runtime.onDidChangeState(state => { controller.observeRuntime(state) }))
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(
    'deepseekHarness.chat',
    provider,
    { webviewOptions: { retainContextWhenHidden: true } },
  ))

  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.openChat', () =>
    vscode.commands.executeCommand('workbench.view.extension.deepseekHarness'),
  ))
  /* 0.1.17：侧栏聚焦时的撤销/重做转发（键位在 package.json contributes.keybindings）。 */
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.undoInView', () => provider.execEdit('undo')))
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.redoInView', () => provider.execEdit('redo')))
  /* 0.1.7（用户需求）：系统弹窗点击回跳——toast 的 launch 指向 vscode://lixxx1.dsh-sidebar/notify。 */
  context.subscriptions.push(vscode.window.registerUriHandler({
    handleUri: uri => {
      if (uri.path !== '/notify') return
      void vscode.commands.executeCommand('workbench.view.extension.deepseekHarness')
    },
  }))
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.openInEditor', async () => {
    const panel = vscode.window.createWebviewPanel(
      'deepseekHarness.editor',
      'DeepSeek Harness',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    )
    const entry = { panel, surface: new DshSurface(panel.webview, controller, output, editorContext, context.extensionUri) }
    panels.add(entry)
    panel.onDidDispose(() => {
      entry.surface.dispose()
      panels.delete(entry)
    })
    await controller.start()
  }))

  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.restart', async () => {
    await controller.restart().catch(error => { void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)) })
  }))
  /* 0.0.88：激活即把设置值同步进 dsh profile（幂等——设置与 patch 行任何一侧被外部改动都会拉齐）。 */
  syncTimeContextRefresh(timeContextSettingsNow().refreshSeconds)
  if (workspace !== undefined) {
    let debugRestartTimer: NodeJS.Timeout | undefined
    let debugRestartTask = Promise.resolve()
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        const currentWorkspace = controller.cwd === '' ? workspace.uri : vscode.Uri.file(controller.cwd)
        // animationStyle is a pure UI state; publish without restarting the runtime.
        // Must come before the autonomousDebugging early-return below (it returns on any non-matching change).
        if (event.affectsConfiguration('deepseekHarness.animationStyle')) {
          controller.publish({ animationStyle: animationStyleNow() })
        }
        if (event.affectsConfiguration('deepseekHarness.markdownImages')) {
          controller.publish({ markdownImages: markdownImagesNow() })
        }
        /* G6 (0.0.60): 视图设置热更——改动即时进 state；渲染期读取项由 webview 侧
           "快照变化→整会话重建"钩子回溯（勿在此重发 messages，避免无谓重建）。 */
        if (event.affectsConfiguration('deepseekHarness.copy')
          || event.affectsConfiguration('deepseekHarness.fold')
          || event.affectsConfiguration('deepseekHarness.imageCopyFormat')) {
          controller.publish({
            copySettings: copySettingsNow(),
    searchSettings: searchSettingsNow(),
            foldSettings: foldSettingsNow(),
            imageCopyFormat: imageCopyFormatNow(),
          })
        }
        /* 0.0.80：预览行为设置热更（0.0.96 起含选帧器上限） */
        if (event.affectsConfiguration('deepseekHarness.preview')) {
          controller.publish({ previewSettings: previewSettingsNow() })
        }
        /* 0.0.109（G50）：界面行为热更（hover 显示官方英文原文）。 */
        if (event.affectsConfiguration('deepseekHarness.ui')) {
          controller.publish({ uiSettings: uiSettingsNow() })
          /* 0.0.161：关掉「保留未发送的草稿」→ 清库（旧草稿不得关掉后无声复活）。 */
          if (!keepDraftsNow()) draftStoreNow().purge()
        }
        /* 0.0.96（G38 批次 2）：附件单次上限热更 */
        if (event.affectsConfiguration('deepseekHarness.attach')) {
          controller.publish({ attachSettings: attachSettingsNow() })
        }
        /* 0.0.154：会话加载设置热更（打开即全量/上限）。 */
        if (event.affectsConfiguration('deepseekHarness.sessionHistory')) {
          controller.publish({ sessionHistorySettings: sessionHistorySettingsNow() })
        }
        /* 0.0.97（批次 3-E1）：原图存储上限热更——改小立即剪枝；-1=不剪枝（哨兵） */
        if (event.affectsConfiguration('deepseekHarness.imageStore')) {
          const next = imageStoreSettingsNow()
          ORIGIN_STORE?.setMaxTotalBytes(imageStoreMaxBytesOf(next))
          controller.publish({ imageStoreSettings: next })
        }
        /* 0.0.101（G41 v1.2）：轮次导航跳转动画时长热更（0=瞬时） */
        if (event.affectsConfiguration('deepseekHarness.turnRail')) {
          controller.publish({ turnRailSettings: turnRailSettingsNow() })
        }
        /* 0.0.88：时间上下文采样间隔（秒）——快照热更 + 同步写 dsh profile。 */
        /* 2026-09-25（用户需求）：命中高亮的模式/颜色热更。 */
        if (event.affectsConfiguration('deepseekHarness.search')) {
          controller.publish({ searchSettings: searchSettingsNow() })
        }
        if (event.affectsConfiguration('deepseekHarness.timeContext')) {
          syncTimeContextRefresh(timeContextSettingsNow().refreshSeconds)
          controller.publish({ timeContextSettings: timeContextSettingsNow() })
        }
        /* 0.0.75（G11）：更新检查频率热更（startup/reload/weekly/never）。 */
        if (event.affectsConfiguration('deepseekHarness.updateCheckFrequency')) {
          controller.publish({ updateCheckFrequency: updateCheckFrequencyNow() })
        }
        /* G6 v1（0.0.62）：设置台面板快照热更；sessionSortMode 变化额外触发会话列表按新顺序重排。 */
        if (event.affectsConfiguration('deepseekHarness.sessionSortMode')) {
          void controller.resortSessions().catch(error => {
            output.appendLine('[set-config] resort failed: ' + (error instanceof Error ? error.message : String(error)))
          })
        }
        if (event.affectsConfiguration('deepseekHarness.sessionSortMode')
          || event.affectsConfiguration('deepseekHarness.recycleRetentionDays')
          || event.affectsConfiguration('deepseekHarness.fileCardRetentionDays')
          || event.affectsConfiguration('deepseekHarness.sessionViewMemory.scroll')
          || event.affectsConfiguration('deepseekHarness.sessionViewMemory.expand')
          || event.affectsConfiguration('deepseekHarness.sessionViewMemory.fold')
          || event.affectsConfiguration('deepseekHarness.executable')
          || event.affectsConfiguration('deepseekHarness.arguments')
          || event.affectsConfiguration('deepseekHarness.autoStart')
          || event.affectsConfiguration('deepseekHarness.reuseExistingRuntime')
          || event.affectsConfiguration('deepseekHarness.startupTimeout')
          || event.affectsConfiguration('deepseekHarness.autonomousDebugging')) {
          controller.publish({
            sessionSettings: sessionSettingsNow(),
            sessionViewMemory: sessionViewMemoryNow(),
            environmentSettings: environmentSettingsNow(),
          })
        }
        if (!event.affectsConfiguration('deepseekHarness.autonomousDebugging', currentWorkspace)) return
        const enabled = vscode.workspace
          .getConfiguration('deepseekHarness', currentWorkspace)
          .get<boolean>('autonomousDebugging', false)

        if (debugRestartTimer !== undefined) clearTimeout(debugRestartTimer)
        debugRestartTimer = setTimeout(() => {
          debugRestartTimer = undefined
          if (runtime.state.kind === 'stopped') {
            output.appendLine(`[debug] Autonomous debugging ${enabled ? 'enabled' : 'disabled'}; it will apply the next time DSH starts.`)
            return
          }
          debugRestartTask = debugRestartTask
            .catch(() => undefined)
            .then(async () => {
              output.appendLine(`[debug] Autonomous debugging ${enabled ? 'enabled' : 'disabled'}; restarting DSH to apply the change.`)
              await controller.restart()
              void vscode.window.showInformationMessage(`VS Code 调试已${enabled ? '启用' : '停用'}，DeepSeek Harness 已重启。`)
            })
            .catch(error => {
              const message = error instanceof Error ? error.message : String(error)
              output.appendLine(`[debug] Failed to restart DSH after the setting changed: ${message}`)
              void vscode.window.showErrorMessage(`无法应用 VS Code 调试设置：${message}`)
            })
        }, 200)
      }),
      { dispose: () => { if (debugRestartTimer !== undefined) clearTimeout(debugRestartTimer) } },
    )
  }
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.managePlugins', async () => {
    await pluginManager.show().catch(error => {
      const message = error instanceof Error ? error.message : String(error)
      output.appendLine(`[plugins] ${message}`)
      void vscode.window.showErrorMessage(message, '显示输出').then(choice => {
        if (choice === '显示输出') output.show(true)
      })
    })
  }))
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.addSelection', async () => {
    if (!editorContext.pinSelection()) {
      void vscode.window.showInformationMessage('请先在当前 DeepSeek 项目中选中代码。')
      return
    }
    await vscode.commands.executeCommand('workbench.view.extension.deepseekHarness')
    provider.focusPrompt()
  }))
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.fixWithDeepSeek', async () => {
    const problem = editorContext.problemAtActiveEditor()
    let prompt: string
    if (problem !== undefined) {
      prompt = problemPrompt(problem)
    } else if (editorContext.pinSelection()) {
      prompt = 'Fix the selected code.'
    } else {
      const activeFile = editorContext.viewState().activeFile
      if (activeFile === undefined) {
        void vscode.window.showInformationMessage('请先在当前 DeepSeek 项目中打开文件。')
        return
      }
      const mention = activeFile.path.includes(' ') ? `@{${activeFile.path}}` : `@${activeFile.path}`
      prompt = `Fix the issue in ${mention}.`
    }
    await vscode.commands.executeCommand('workbench.view.extension.deepseekHarness')
    provider.setPrompt(prompt)
  }))
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.sendProblem', async (...args: unknown[]) => {
    const problem = await chooseProblem(editorContext, args)
    if (problem === undefined) return
    await vscode.commands.executeCommand('workbench.view.extension.deepseekHarness')
    provider.setPrompt(problemPrompt(problem))
  }))
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.showOutput', () => { output.show(true) }))
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.openInBrowser', async () => {
    try {
      const uri = await runtime.start(controller.cwd === '' ? undefined : vscode.Uri.file(controller.cwd))
      await vscode.env.openExternal(await vscode.env.asExternalUri(uri))
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }))
  /* 0.0.73（策略调研建议②）: 逃生舱——在 VS Code 编辑器内打开**完整**官方 Web UI
     （内置 Simple Browser；任意插件功能即刻可用，零复刻）。运行时未起则先拉起。 */
  const openWebUi = async (): Promise<void> => {
    try {
      const uri = await runtime.start(controller.cwd === '' ? undefined : vscode.Uri.file(controller.cwd))
      await vscode.commands.executeCommand('simpleBrowser.show', uri.toString(true))
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      void vscode.window.showErrorMessage(`无法在编辑器中打开 DeepSeek Harness Web UI。${detail}`)
    }
  }
  EXT_OPEN_WEB_UI = openWebUi
  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.openWebUi', () => openWebUi()))

  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.configureApiKey', async () => {
    provider.openModelConnections()
    await vscode.commands.executeCommand('workbench.view.extension.deepseekHarness')
    if (controller.runtimeOwnership === undefined) await controller.start()
  }))

  context.subscriptions.push(vscode.commands.registerCommand('deepseekHarness.clearApiKey', async () => {
    const choice = await vscode.window.showWarningMessage(
      '移除本扩展保存的 DeepSeek API 密钥？',
      { modal: true },
      '移除',
    )
    if (choice !== '移除') return

    await context.secrets.delete(DEEPSEEK_API_KEY_SECRET)
    output.appendLine('[credentials] DeepSeek API key removed from VS Code SecretStorage.')
    if (controller.runtimeOwnership === 'external') {
      void vscode.window.showInformationMessage(
        '已移除保存的 DeepSeek API 密钥。复用的外部 DSH 仍使用其自身凭据。',
      )
      return
    }
    await controller.restart()
    void vscode.window.showInformationMessage('已移除保存的 DeepSeek API 密钥，DeepSeek Harness 已重启。')
  }))
}

export async function deactivate(): Promise<void> {
  const runtime = activeRuntime
  activeRuntime = undefined
  const store = sharedSearchIndex
  sharedSearchIndex = undefined
  await Promise.all([runtime?.stop(), store?.dispose()])
}
