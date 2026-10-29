/**
 * G6 (0.0.60): 视图类设置（复制定制 copyCfg / 消息折叠 foldCfg / 图片复制档位）的读取与净化。
 *
 * 配置键在 package.json 声明（deepseekHarness.copy.* / deepseekHarness.fold.* / imageCopyFormat），
 * 默认值与 0.0.60 之前的硬编码值一致（不动行为）。本模块是纯函数（不 import vscode）：
 * extension 读 config → normalize → 进 ChatViewState → webview 应用；测试见 tests/view-settings.spec.ts。
 */

import { DEFAULT_NOTIFY_LEVEL, DEFAULT_NOTIFY_STYLE, normalizeNotifyLevel, normalizeNotifyStyle, type NotifyLevel, type NotifyStyle } from './notify.js'

export interface CopySettings {
  mathButtons: boolean
  blockButtons: boolean
  /* 0.0.162（公式四档）：markdown（$ / $$）/ tex（纯源）/ tex-delimited（TeX+定界符）/ mathml。 */
  mathFormat: 'markdown' | 'tex' | 'tex-delimited' | 'mathml'
  plainMathFormat: 'tex' | 'tex-delimited'
  codeCopyFormat: 'text' | 'markdown'
  feedbackMs: number
  /* G45（0.0.103）：「复制为 SVG」的输出颜色——'theme' = 跟随主题前景色；或 '#rrggbb'。 */
  mathSvgColor: string
  /* G45 v1.2（0.0.105）：位图兜底档位（PNG 最长边目标）——'screen'（固定 4×）| '512' | '1024' | '2048'。 */
  svgPngEdge: string
}

export interface FoldSettings {
  enabled: boolean
  previewLines: number
  triggerRatio: number
  minFoldExtraLines: number
  minChars: number
  /* G38 批次 2（0.0.96）：AI 输出「超高块」折叠门槛（代码/引用/表格超过这么多行才挂折叠按钮）。 */
  blockMinLines: number
  /* 0.0.108（用户补充①）：变更文件块过长自动折叠（独立设置项）。 */
  changedFiles: boolean
  changedFilesLines: number
  /* G49（0.0.119）：AI 工作段（过程）自动折叠（默认开）。 */
  workSegments: boolean
}

export type ImageCopyFormat = 'original' | 'png'

/* G6 v1（0.0.62）：设置台面板的会话区/运行环境区快照（会话区可编辑；运行环境区 v1 只读展示）。 */
export interface SessionSettings {
  sortMode: 'persisted' | 'activity'
  recycleRetentionDays: number
  fileCardRetentionDays: number
}

export interface EnvironmentCompatLineView {
  name: string
  version?: string
  verified: boolean
}

export interface EnvironmentCompatView {
  dsh: EnvironmentCompatLineView
  plugins: EnvironmentCompatLineView[]
  anyUnverified: boolean
}

/* 0.0.75（G11）：更新检查结果（探测结果，仅展示；来自扩展侧检查流程） */
export interface EnvironmentUpdateItemView {
  name: string
  installed?: string
  latest?: string
  /* 0.0.90：技能行使用——是否落后于上游 */
  stale?: boolean
}

export interface EnvironmentUpdatesView {
  checkedAt?: number
  stale: EnvironmentUpdateItemView[]
  /* 0.0.90：技能（上游仓库）检查行——清单存在时才出现 */
  skills?: EnvironmentUpdateItemView[]
  /* 0.0.91：刷新失败提示（此时 checkedAt/stale/skills 为上次成功快照） */
  refreshError?: string
  modelDrift?: string
}

export interface EnvironmentSettings {
  executable: string
  arguments: string[]
  autoStart: boolean
  reuseExistingRuntime: boolean
  startupTimeout: number
  autonomousDebugging: boolean
  /* 0.0.73：适配矩阵（探测结果，仅展示；来自扩展侧 buildCompatMatrix） */
  compat?: EnvironmentCompatView
  /* 0.0.75：更新检查结果（探测结果，仅展示） */
  updates?: EnvironmentUpdatesView
}

/* 0.0.80（用户反馈④）：图片预览行为设置（缩放界限 + GIF 默认播放）。 */
export interface PreviewSettings {
  minScale: number
  maxScale: number
  gifAutoplay: boolean
  /* G38 批次 2（0.0.96）：动图选帧器——一次最多抽帧数（超出按步长抽稀）与最多可选帧数。 */
  maxFrames: number
  maxFrameSelections: number
}

/* G38 批次 2（0.0.96）：附件单次上限（拖入/粘贴的接收限制）。
   0.0.145（G43）：大图自动压缩——超过阈值（MB；0 = 关闭，回到"超限跳过"）的图片先下采样 +
   白底 JPEG 重编码再入列；最长边 px 与 JPEG 质量可调。 */
export interface AttachSettings {
  maxFiles: number
  maxTotalMB: number
  /** 0.0.175（B5 文案群）：拖入/粘贴的**单文件**大小上限（MB）——此前写死 25MB。 */
  maxFileMB: number
  compressThresholdMB: number
  compressMaxEdge: number
  compressQuality: number
}

/* 0.0.88：时间上下文采样间隔（秒；0 = 每步都采样）。写入 dsh web profile 的 time-context 行。 */
export interface TimeContextSettings {
  refreshSeconds: number
}

/* G39（0.0.93）：切会话视图记忆开关（滚动位置 / 工具卡展开态 / 手动折叠态）。
   数据层与 VS Code 设置键先行就绪；设置台 UI 入口后续批次补。 */
export interface SessionViewMemorySettings {
  scroll: boolean
  expand: boolean
  fold: boolean
}

export const DEFAULT_TIME_CONTEXT_SETTINGS: TimeContextSettings = { refreshSeconds: 60 }

export const TIME_CONTEXT_SETTINGS_RANGES = {
  refreshSeconds: { min: 0, max: 86400 },
} as const

export function normalizeTimeContextSettings(raw: unknown): TimeContextSettings {
  const input = record(raw) ?? {}
  return {
    refreshSeconds: Math.round(numberIn(input.refreshSeconds, TIME_CONTEXT_SETTINGS_RANGES.refreshSeconds.min, TIME_CONTEXT_SETTINGS_RANGES.refreshSeconds.max, DEFAULT_TIME_CONTEXT_SETTINGS.refreshSeconds)),
  }
}

export const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = { minScale: 0.01, maxScale: 32, gifAutoplay: true, maxFrames: 60, maxFrameSelections: 12 }

export const PREVIEW_SETTINGS_RANGES = {
  minScale: { min: 0.005, max: 1 },
  maxScale: { min: 1, max: 64 },
  maxFrames: { min: 1, max: 240 },
  maxFrameSelections: { min: 1, max: 60 },
} as const

export function normalizePreviewSettings(raw: unknown): PreviewSettings {
  const input = record(raw) ?? {}
  const minScaleRaw = numberIn(input.minScale, PREVIEW_SETTINGS_RANGES.minScale.min, PREVIEW_SETTINGS_RANGES.minScale.max, DEFAULT_PREVIEW_SETTINGS.minScale)
  const maxScaleRaw = numberIn(input.maxScale, PREVIEW_SETTINGS_RANGES.maxScale.min, PREVIEW_SETTINGS_RANGES.maxScale.max, DEFAULT_PREVIEW_SETTINGS.maxScale)
  const maxFrames = Math.round(numberIn(input.maxFrames, PREVIEW_SETTINGS_RANGES.maxFrames.min, PREVIEW_SETTINGS_RANGES.maxFrames.max, DEFAULT_PREVIEW_SETTINGS.maxFrames))
  const maxFrameSelections = Math.round(numberIn(input.maxFrameSelections, PREVIEW_SETTINGS_RANGES.maxFrameSelections.min, PREVIEW_SETTINGS_RANGES.maxFrameSelections.max, DEFAULT_PREVIEW_SETTINGS.maxFrameSelections))
  return {
    minScale: Math.min(minScaleRaw, maxScaleRaw),
    maxScale: Math.max(minScaleRaw, maxScaleRaw),
    gifAutoplay: boolOf(input.gifAutoplay, DEFAULT_PREVIEW_SETTINGS.gifAutoplay),
    maxFrames,
    maxFrameSelections,
  }
}

export const DEFAULT_ATTACH_SETTINGS: AttachSettings = { maxFiles: 20, maxTotalMB: 100, maxFileMB: 25, compressThresholdMB: 20, compressMaxEdge: 4096, compressQuality: 82 }

export const ATTACH_SETTINGS_RANGES = {
  maxFiles: { min: 1, max: 200 },
  maxTotalMB: { min: 1, max: 2048 },
  maxFileMB: { min: 1, max: 500 },
  compressThresholdMB: { min: 0, max: 2048 },
  compressMaxEdge: { min: 512, max: 16384 },
  compressQuality: { min: 40, max: 95 },
} as const

export function normalizeAttachSettings(raw: unknown): AttachSettings {
  const input = record(raw) ?? {}
  return {
    maxFiles: Math.round(numberIn(input.maxFiles, ATTACH_SETTINGS_RANGES.maxFiles.min, ATTACH_SETTINGS_RANGES.maxFiles.max, DEFAULT_ATTACH_SETTINGS.maxFiles)),
    maxTotalMB: Math.round(numberIn(input.maxTotalMB, ATTACH_SETTINGS_RANGES.maxTotalMB.min, ATTACH_SETTINGS_RANGES.maxTotalMB.max, DEFAULT_ATTACH_SETTINGS.maxTotalMB)),
    maxFileMB: Math.round(numberIn(input.maxFileMB, ATTACH_SETTINGS_RANGES.maxFileMB.min, ATTACH_SETTINGS_RANGES.maxFileMB.max, DEFAULT_ATTACH_SETTINGS.maxFileMB)),
    compressThresholdMB: Math.round(numberIn(input.compressThresholdMB, ATTACH_SETTINGS_RANGES.compressThresholdMB.min, ATTACH_SETTINGS_RANGES.compressThresholdMB.max, DEFAULT_ATTACH_SETTINGS.compressThresholdMB)),
    compressMaxEdge: Math.round(numberIn(input.compressMaxEdge, ATTACH_SETTINGS_RANGES.compressMaxEdge.min, ATTACH_SETTINGS_RANGES.compressMaxEdge.max, DEFAULT_ATTACH_SETTINGS.compressMaxEdge)),
    compressQuality: Math.round(numberIn(input.compressQuality, ATTACH_SETTINGS_RANGES.compressQuality.min, ATTACH_SETTINGS_RANGES.compressQuality.max, DEFAULT_ATTACH_SETTINGS.compressQuality)),
  }
}

export type UpdateCheckFrequency = 'startup' | 'reload' | 'weekly' | 'never'

export const UPDATE_CHECK_FREQUENCIES: readonly UpdateCheckFrequency[] = ['startup', 'reload', 'weekly', 'never']
export const DEFAULT_UPDATE_CHECK_FREQUENCY: UpdateCheckFrequency = 'startup'

export function normalizeUpdateCheckFrequency(raw: unknown): UpdateCheckFrequency {
  return typeof raw === 'string' && (UPDATE_CHECK_FREQUENCIES as readonly string[]).includes(raw)
    ? raw as UpdateCheckFrequency
    : DEFAULT_UPDATE_CHECK_FREQUENCY
}

export const DEFAULT_COPY_SETTINGS: CopySettings = {
  mathButtons: true,
  blockButtons: true,
  mathFormat: 'markdown',
  plainMathFormat: 'tex',
  codeCopyFormat: 'text',
  feedbackMs: 1000,
  mathSvgColor: 'theme',
  svgPngEdge: '1024',
}

export const DEFAULT_FOLD_SETTINGS: FoldSettings = {
  enabled: true,
  previewLines: 4,
  triggerRatio: 0.5,
  minFoldExtraLines: 3,
  minChars: 100,
  blockMinLines: 3,
  changedFiles: true,
  changedFilesLines: 6,
  /* G49（0.0.119）：AI 工作段（过程）自动折叠。 */
  workSegments: true,
}

export const COPY_SETTINGS_RANGES = {
  feedbackMs: { min: 200, max: 6000 },
} as const

/* G42-A（0.0.97）：复制反馈时长单位拟人化——新键 `copy.feedbackSeconds`（秒），旧键 `copy.feedbackMs`
   仅作一次性迁移回退（旧值/1000 沿用，不写回）。状态里仍以毫秒（feedbackMs）流转，webview 零改动。 */
export const FEEDBACK_SECONDS_RANGE = { min: 0.2, max: 6 } as const

/* G41 v1.2（0.0.101）：轮次导航跳转动画时长（秒；0 = 瞬时跳转）。
   0.0.128：节点最小间距（px；轮数多时轨道自动变长并可滚动——密度控制）。
   0.0.144（用户需求）：边缘拖拽自动滚列的触发带宽（px）与最大速度（px/秒，秒制人类单位）；
   仅作用于"边缘拖拽自动滚列"，不影响滚轮滚列。 */
export const TURN_RAIL_RANGES = {
  jumpSeconds: { min: 0, max: 1.5 },
  minGap: { min: 12, max: 96 },
  dragEdgePx: { min: 8, max: 200 },
  dragSpeed: { min: 100, max: 3000 },
  /* 0.1.122（G55 内容设置）：节点摘要长度 / 节点列滚动动画时长（0=瞬时）。 */
  summaryLength: { min: 24, max: 80 },
  scrollAnimSeconds: { min: 0, max: 0.6 },
} as const

/* 0.0.122（G49 v3）：轨道的"轮"粒度；0.0.125 起第二档改为 **segment**（与工作段折叠同源：
   你的每次输入 + 已应答的审批/提问；跳转必落在段首）。旧值 'prompt' 兼容读作 'segment'。 */
export type TurnRailGranularity = 'turn' | 'segment'

/* 0.0.128：滚动条方式——custom=自绘（节点轨道 + 可拖滑块，隐藏原生滚动条）；
   native=原生（只保留系统滚动条，整套轨道隐藏）。两者互斥显示。 */
export type TurnRailScrollbar = 'custom' | 'native'

export interface TurnRailSettings { jumpSeconds: number; granularity: TurnRailGranularity; scrollbar: TurnRailScrollbar; minGap: number; dragEdgePx: number; dragSpeed: number; markStops: boolean; markNoteOnly: boolean; markColor: string; stopColor: string; nodeBadge: boolean; summaryLength: number; numberStyle: TurnRailNumberStyle; scrollAnimSeconds: number; tipTwoLine: boolean }

/* 0.1.122（G55 内容设置）：编号文案档位——compact「N/M」（默认）/ full「第 N/M 个节点」/ legacy「第 N 轮」。
   联动面：节点提示前缀、搜索行编号片、浮出徽标（aria 保持完整措辞「第 N/M 个节点」）。 */
export type TurnRailNumberStyle = 'compact' | 'full' | 'legacy'

/* 0.0.151（用户建议③）：节点颜色——'theme' 或 '#rrggbb'（同 copy.mathSvgColor 语义）。 */
const railColorOf = (value: unknown): string => {
  if (typeof value !== 'string') return 'theme'
  const lower = value.toLowerCase()
  return /^#[0-9a-f]{6}$/.test(lower) ? lower : 'theme'
}

export function normalizeTurnRailSettings(raw: { jumpSeconds?: unknown; granularity?: unknown; scrollbar?: unknown; minGap?: unknown; dragEdgePx?: unknown; dragSpeed?: unknown; markStops?: unknown; markNoteOnly?: unknown; markColor?: unknown; stopColor?: unknown; nodeBadge?: unknown; summaryLength?: unknown; numberStyle?: unknown; scrollAnimSeconds?: unknown; tipTwoLine?: unknown }): TurnRailSettings {
  const value = typeof raw.jumpSeconds === 'number' && Number.isFinite(raw.jumpSeconds) ? raw.jumpSeconds : 0.25
  const gap = typeof raw.minGap === 'number' && Number.isFinite(raw.minGap) ? raw.minGap : 20
  const edge = typeof raw.dragEdgePx === 'number' && Number.isFinite(raw.dragEdgePx) ? raw.dragEdgePx : 64
  const speed = typeof raw.dragSpeed === 'number' && Number.isFinite(raw.dragSpeed) ? raw.dragSpeed : 800
  return {
    jumpSeconds: Math.round(Math.min(TURN_RAIL_RANGES.jumpSeconds.max, Math.max(TURN_RAIL_RANGES.jumpSeconds.min, value)) * 100) / 100,
    granularity: raw.granularity === 'turn' ? 'turn' : 'segment',
    scrollbar: raw.scrollbar === 'native' ? 'native' : 'custom',
    minGap: Math.round(Math.min(TURN_RAIL_RANGES.minGap.max, Math.max(TURN_RAIL_RANGES.minGap.min, gap))),
    dragEdgePx: Math.round(Math.min(TURN_RAIL_RANGES.dragEdgePx.max, Math.max(TURN_RAIL_RANGES.dragEdgePx.min, edge))),
    dragSpeed: Math.round(Math.min(TURN_RAIL_RANGES.dragSpeed.max, Math.max(TURN_RAIL_RANGES.dragSpeed.min, speed))),
    /* 0.0.148（G53）：含提问/审批停点的节点自动标注（默认开）。 */
    markStops: raw.markStops !== false,
    /* 0.0.149：标注提示样式——true=只显示标注内容（默认）；false=标注 + 第 N 轮 · 摘要。 */
    markNoteOnly: raw.markNoteOnly !== false,
    /* 0.0.151：节点颜色（'theme' 或 #rrggbb）。 */
    markColor: railColorOf(raw.markColor),
    stopColor: railColorOf(raw.stopColor),
    /* 0.1.114（G55 轨道序号）：滚动静息徽标「N/M」开关（默认开）。 */
    nodeBadge: raw.nodeBadge !== false,
    /* 0.1.122（G55 内容设置）：节点摘要长度（24–80，默认 40）；编号文案档位；节点列滚动动画时长（0–0.6s，0=瞬时）；提示两行。 */
    summaryLength: typeof raw.summaryLength === 'number' && Number.isFinite(raw.summaryLength) ? Math.round(Math.min(TURN_RAIL_RANGES.summaryLength.max, Math.max(TURN_RAIL_RANGES.summaryLength.min, raw.summaryLength))) : 40,
    numberStyle: raw.numberStyle === 'full' || raw.numberStyle === 'legacy' ? raw.numberStyle : 'compact',
    scrollAnimSeconds: typeof raw.scrollAnimSeconds === 'number' && Number.isFinite(raw.scrollAnimSeconds) ? Math.round(Math.min(TURN_RAIL_RANGES.scrollAnimSeconds.max, Math.max(TURN_RAIL_RANGES.scrollAnimSeconds.min, raw.scrollAnimSeconds)) * 100) / 100 : 0.18,
    tipTwoLine: raw.tipTwoLine === true,
  }
}

export function resolveFeedbackMs(secondsRaw: unknown, legacyMsRaw: unknown): number {
  if (typeof secondsRaw === 'number' && Number.isFinite(secondsRaw)) {
    const seconds = Math.min(FEEDBACK_SECONDS_RANGE.max, Math.max(FEEDBACK_SECONDS_RANGE.min, secondsRaw))
    return Math.round(seconds * 1000)
  }
  if (typeof legacyMsRaw === 'number' && Number.isFinite(legacyMsRaw)) {
    return Math.min(COPY_SETTINGS_RANGES.feedbackMs.max, Math.max(COPY_SETTINGS_RANGES.feedbackMs.min, Math.round(legacyMsRaw)))
  }
  return 1000
}

/* G42-B（0.0.97）：哨兵值约定——保留天数类 `-1 = 永不删除`（唯一合法负值；0/其他负值按 1 处理）。 */
export const RETENTION_DAYS_RANGE = { min: 1, max: 365 } as const

export function normalizeRetentionDays(raw: unknown, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw === -1) return -1
    return Math.min(RETENTION_DAYS_RANGE.max, Math.max(RETENTION_DAYS_RANGE.min, Math.round(raw)))
  }
  return fallback
}

export const FOLD_SETTINGS_RANGES = {
  previewLines: { min: 1, max: 20 },
  triggerRatio: { min: 0.1, max: 3 },
  minFoldExtraLines: { min: 0, max: 50 },
  minChars: { min: 0, max: 20000 },
  blockMinLines: { min: 1, max: 50 },
  changedFilesLines: { min: 1, max: 50 },
} as const

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  sortMode: 'persisted',
  recycleRetentionDays: 30,
  fileCardRetentionDays: 30,
}

export const DEFAULT_SESSION_VIEW_MEMORY: SessionViewMemorySettings = {
  scroll: true,
  expand: true,
  fold: true,
}

export const SESSION_SETTINGS_RANGES = {
  recycleRetentionDays: { min: 1, max: 365 },
  fileCardRetentionDays: { min: 1, max: 365 },
} as const

export const DEFAULT_ENVIRONMENT_SETTINGS: EnvironmentSettings = {
  executable: '',
  arguments: ['web', '--host', '127.0.0.1', '--port', '0'],
  autoStart: true,
  reuseExistingRuntime: true,
  startupTimeout: 60000,
  autonomousDebugging: false,
}

export const ENVIRONMENT_SETTINGS_RANGES = {
  startupTimeout: { min: 1000, max: 300000 },
} as const

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined

const boolOf = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

const numberIn = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

const enumOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback

export function normalizeCopySettings(raw: unknown): CopySettings {
  const input = record(raw) ?? {}
  return {
    mathButtons: boolOf(input.mathButtons, DEFAULT_COPY_SETTINGS.mathButtons),
    blockButtons: boolOf(input.blockButtons, DEFAULT_COPY_SETTINGS.blockButtons),
    mathFormat: enumOf(input.mathFormat, ['markdown', 'tex', 'tex-delimited', 'mathml'] as const, DEFAULT_COPY_SETTINGS.mathFormat),
    plainMathFormat: enumOf(input.plainMathFormat, ['tex', 'tex-delimited'] as const, DEFAULT_COPY_SETTINGS.plainMathFormat),
    codeCopyFormat: enumOf(input.codeCopyFormat, ['text', 'markdown'] as const, DEFAULT_COPY_SETTINGS.codeCopyFormat),
    feedbackMs: numberIn(input.feedbackMs, COPY_SETTINGS_RANGES.feedbackMs.min, COPY_SETTINGS_RANGES.feedbackMs.max, DEFAULT_COPY_SETTINGS.feedbackMs),
    mathSvgColor: typeof input.mathSvgColor === 'string' && /^(#[0-9a-f]{6}|theme)$/.test(input.mathSvgColor.toLowerCase())
      ? input.mathSvgColor.toLowerCase()
      : DEFAULT_COPY_SETTINGS.mathSvgColor,
    svgPngEdge: typeof input.svgPngEdge === 'string' && ['screen', '512', '1024', '2048'].includes(input.svgPngEdge)
      ? input.svgPngEdge
      : DEFAULT_COPY_SETTINGS.svgPngEdge,
  }
}

export function normalizeFoldSettings(raw: unknown): FoldSettings {
  const input = record(raw) ?? {}
  return {
    enabled: boolOf(input.enabled, DEFAULT_FOLD_SETTINGS.enabled),
    previewLines: numberIn(input.previewLines, FOLD_SETTINGS_RANGES.previewLines.min, FOLD_SETTINGS_RANGES.previewLines.max, DEFAULT_FOLD_SETTINGS.previewLines),
    triggerRatio: numberIn(input.triggerRatio, FOLD_SETTINGS_RANGES.triggerRatio.min, FOLD_SETTINGS_RANGES.triggerRatio.max, DEFAULT_FOLD_SETTINGS.triggerRatio),
    minFoldExtraLines: numberIn(input.minFoldExtraLines, FOLD_SETTINGS_RANGES.minFoldExtraLines.min, FOLD_SETTINGS_RANGES.minFoldExtraLines.max, DEFAULT_FOLD_SETTINGS.minFoldExtraLines),
    minChars: numberIn(input.minChars, FOLD_SETTINGS_RANGES.minChars.min, FOLD_SETTINGS_RANGES.minChars.max, DEFAULT_FOLD_SETTINGS.minChars),
    blockMinLines: Math.round(numberIn(input.blockMinLines, FOLD_SETTINGS_RANGES.blockMinLines.min, FOLD_SETTINGS_RANGES.blockMinLines.max, DEFAULT_FOLD_SETTINGS.blockMinLines)),
    changedFiles: boolOf(input.changedFiles, DEFAULT_FOLD_SETTINGS.changedFiles),
    changedFilesLines: Math.round(numberIn(input.changedFilesLines, FOLD_SETTINGS_RANGES.changedFilesLines.min, FOLD_SETTINGS_RANGES.changedFilesLines.max, DEFAULT_FOLD_SETTINGS.changedFilesLines)),
    workSegments: boolOf(input.workSegments, DEFAULT_FOLD_SETTINGS.workSegments),
  }
}

export function normalizeImageCopyFormat(raw: unknown): ImageCopyFormat {
  return raw === 'png' ? 'png' : 'original'
}

export function normalizeSessionSettings(raw: unknown): SessionSettings {
  const input = record(raw) ?? {}
  return {
    sortMode: enumOf(input.sortMode, ['persisted', 'activity'] as const, DEFAULT_SESSION_SETTINGS.sortMode),
    /* G42-B（0.0.97）：-1 = 永不删除（哨兵；由 normalizeRetentionDays 统一处理） */
    recycleRetentionDays: normalizeRetentionDays(input.recycleRetentionDays, DEFAULT_SESSION_SETTINGS.recycleRetentionDays),
    fileCardRetentionDays: normalizeRetentionDays(input.fileCardRetentionDays, DEFAULT_SESSION_SETTINGS.fileCardRetentionDays),
  }
}

/* G42-C/批次 3-E1（0.0.97）：原图存储总量上限（哨兵 -1 = 不剪枝）。 */
export interface ImageStoreSettings {
  maxTotalMB: number
}

export const DEFAULT_IMAGE_STORE_SETTINGS: ImageStoreSettings = { maxTotalMB: 512 }

export const IMAGE_STORE_RANGES = {
  maxTotalMB: { min: 16, max: 4096 },
} as const

export function normalizeImageStoreSettings(raw: unknown): ImageStoreSettings {
  const input = record(raw) ?? {}
  const value = input.maxTotalMB
  const normalized = typeof value === 'number' && Number.isFinite(value)
    ? (value === -1 ? -1 : Math.min(IMAGE_STORE_RANGES.maxTotalMB.max, Math.max(IMAGE_STORE_RANGES.maxTotalMB.min, Math.round(value))))
    : DEFAULT_IMAGE_STORE_SETTINGS.maxTotalMB
  return { maxTotalMB: normalized }
}

/* 0.0.154（O3 会话加载机制）：打开会话时一次性拉取整段历史（服务端实测无 100 硬上限，
   2000+ 事件 <0.5s）；超过上限的会话自动退回分页（「加载更早消息」/上滚预取仍可用）。 */
export interface SessionHistorySettings {
  loadAll: boolean
  maxMessages: number
}

export const DEFAULT_SESSION_HISTORY_SETTINGS: SessionHistorySettings = { loadAll: true, maxMessages: 3000 }

export const SESSION_HISTORY_RANGES = {
  maxMessages: { min: 500, max: 20_000 },
} as const

export function normalizeSessionHistorySettings(raw: unknown): SessionHistorySettings {
  const input = record(raw) ?? {}
  return {
    loadAll: boolOf(input.loadAll, DEFAULT_SESSION_HISTORY_SETTINGS.loadAll),
    maxMessages: Math.round(numberIn(input.maxMessages, SESSION_HISTORY_RANGES.maxMessages.min, SESSION_HISTORY_RANGES.maxMessages.max, DEFAULT_SESSION_HISTORY_SETTINGS.maxMessages)),
  }
}

/* 0.0.109（G50）：界面行为设置——hover 显示官方英文原文（映射=官方双语字典生成）。 */
export interface UiSettings {
  showOriginalOnHover: boolean
  /* 0.0.145（用户需求）：临时提示条（黄色：拖入跳过/压缩结果/溢出等）的显示时长（秒）。 */
  hintSeconds: number
  /* 0.0.147（用户反馈①）：会话栏标签最小宽度（px）——68px 时悬停 ✎/✕（共 46px）
     几乎占满标签、切换会话易误点；默认加宽到 112。 */
  sessionTabMinWidth: number
  /* 0.0.160（N1）：任务通知等级——需要操作+跑完 / 仅需要操作 / 关闭。 */
  notifyLevel: NotifyLevel
  /* 0.1.7（用户需求）：通知形式——跟随 VS Code（默认）/ 总是系统弹窗（右下角 Toast）。 */
  notifyStyle: NotifyStyle
  /* 0.0.161（用户需求）：保留未发送的草稿——Reload/重启后按会话恢复 文本/图片/文件卡（默认开）。 */
  keepDrafts: boolean
  /* 0.1.0（B6 A8）：诊断日志——把 webview 每帧的 [trace] 与调试明细写进输出面板（默认关，排障时开）。 */
  diagnostics: boolean
  /* 0.1.27（用户需求）：内容列（正文 + 草稿栏 + 排队区）最大宽度 px；**-1 = 无上限**（宽侧栏铺满）。
     默认 760 是为可读性——超过 ~90 字符/行阅读体验下降。 */
  contentMaxWidth: number
  /* 0.1.44（D3）：折叠内容按需构建——默认折叠的"过程"正文不随装载构建（台架：首屏构建 −75%、
     DOM 节点 −19%），展开/搜索跳转时即时补建；**默认开**，关掉即整会话重建为一次性全量构建。 */
  lazyFoldedBodies: boolean
  /* 0.1.45（D1）：动作行悬停显示——消息尾部的复制/时钟/更多按钮改为悬停浮出（时间仍常显）。
     台架（EUV 2261 消息）：装载期构建节点 −29%、reconcile 50→25ms、稳定节点 −11.1%、浮出 0.7ms。
     **默认开**；关掉即整会话重建为"常显整行"。 */
  hoverActions: boolean
  /* 0.1.51（CV）：离屏内容跳过排版——视口外的消息不参与整篇排版（实测冷缓存首轮 layout −67~78%、
     打开墙钟 −33%、最长长任务 134→0~69ms；scrollHeight 与轨道点位摘要逐值不变）。
     **默认关（试验）**：静止场景收益显著（冷缓存首轮 layout −65%、长任务 123→0ms），但**开启后隐藏→恢复的位置保持与拖动期轨道几何会失真**（对照实测 FAIL，待修交互后再转默认开）。 */
  messageContainment: boolean
}

export const DEFAULT_UI_SETTINGS: UiSettings = { showOriginalOnHover: false, hintSeconds: 4, sessionTabMinWidth: 112, notifyLevel: DEFAULT_NOTIFY_LEVEL, notifyStyle: DEFAULT_NOTIFY_STYLE, keepDrafts: true, diagnostics: false, contentMaxWidth: 760, lazyFoldedBodies: true, hoverActions: true, messageContainment: true }

/* 0.1.27：内容列最大宽度——允许哨兵 -1（无上限）或 [320, 4000] 的整数。 */
export function normalizeContentMaxWidth(input: unknown, fallback: number = DEFAULT_UI_SETTINGS.contentMaxWidth): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return fallback
  const rounded = Math.round(input)
  if (rounded === -1) return -1
  return Math.min(4000, Math.max(320, rounded))
}


export const UI_SETTINGS_RANGES = {
  hintSeconds: { min: 1, max: 60 },
  sessionTabMinWidth: { min: 68, max: 200 },
} as const

export function normalizeUiSettings(raw: unknown): UiSettings {
  const input = record(raw) ?? {}
  return {
    showOriginalOnHover: boolOf(input.showOriginalOnHover, DEFAULT_UI_SETTINGS.showOriginalOnHover),
    hintSeconds: Math.round(numberIn(input.hintSeconds, UI_SETTINGS_RANGES.hintSeconds.min, UI_SETTINGS_RANGES.hintSeconds.max, DEFAULT_UI_SETTINGS.hintSeconds)),
    sessionTabMinWidth: Math.round(numberIn(input.sessionTabMinWidth, UI_SETTINGS_RANGES.sessionTabMinWidth.min, UI_SETTINGS_RANGES.sessionTabMinWidth.max, DEFAULT_UI_SETTINGS.sessionTabMinWidth)),
    notifyLevel: normalizeNotifyLevel(input.notifyLevel),
    notifyStyle: normalizeNotifyStyle(input.notifyStyle),
    keepDrafts: boolOf(input.keepDrafts, DEFAULT_UI_SETTINGS.keepDrafts),
    diagnostics: boolOf(input.diagnostics, DEFAULT_UI_SETTINGS.diagnostics),
    contentMaxWidth: normalizeContentMaxWidth(input.contentMaxWidth),
    lazyFoldedBodies: boolOf(input.lazyFoldedBodies, DEFAULT_UI_SETTINGS.lazyFoldedBodies),
    hoverActions: boolOf(input.hoverActions, DEFAULT_UI_SETTINGS.hoverActions),
    messageContainment: boolOf(input.messageContainment, DEFAULT_UI_SETTINGS.messageContainment),
  }
}

export function normalizeSessionViewMemory(raw: unknown): SessionViewMemorySettings {
  const input = record(raw) ?? {}
  return {
    scroll: boolOf(input.scroll, DEFAULT_SESSION_VIEW_MEMORY.scroll),
    expand: boolOf(input.expand, DEFAULT_SESSION_VIEW_MEMORY.expand),
    fold: boolOf(input.fold, DEFAULT_SESSION_VIEW_MEMORY.fold),
  }
}

const compatLineOf = (value: unknown): EnvironmentCompatLineView | undefined => {
  const input = record(value)
  if (input === undefined || typeof input.name !== 'string' || input.name === '') return undefined
  return {
    name: input.name,
    ...(typeof input.version === 'string' && input.version !== '' ? { version: input.version } : {}),
    verified: input.verified === true,
  }
}

const compatOf = (value: unknown): EnvironmentCompatView | undefined => {
  const input = record(value)
  if (input === undefined) return undefined
  const dsh = compatLineOf(input.dsh)
  if (dsh === undefined) return undefined
  const plugins = Array.isArray(input.plugins)
    ? input.plugins.flatMap((entry) => {
      const line = compatLineOf(entry)
      return line === undefined ? [] : [line]
    })
    : []
  return { dsh, plugins, anyUnverified: input.anyUnverified === true }
}

/* 0.0.91：快照回填用（globalState 里读出的上次成功结果做净化）。 */
export function normalizeUpdatesView(raw: unknown): EnvironmentUpdatesView | undefined {
  return updatesOf(raw)
}

const updatesOf = (value: unknown): EnvironmentUpdatesView | undefined => {
  const input = record(value)
  if (input === undefined) return undefined
  const itemOf = (entry: unknown): EnvironmentUpdateItemView | undefined => {
    const line = record(entry)
    if (line === undefined || typeof line.name !== 'string' || line.name === '') return undefined
    return {
      name: line.name,
      ...(typeof line.installed === 'string' && line.installed !== '' ? { installed: line.installed } : {}),
      ...(typeof line.latest === 'string' && line.latest !== '' ? { latest: line.latest } : {}),
      ...(line.stale === true ? { stale: true } : {}),
    }
  }
  const stale = Array.isArray(input.stale)
    ? input.stale.flatMap((entry): EnvironmentUpdateItemView[] => {
      const item = itemOf(entry)
      return item === undefined ? [] : [item]
    })
    : []
  const skills = Array.isArray(input.skills)
    ? input.skills.flatMap((entry): EnvironmentUpdateItemView[] => {
      const item = itemOf(entry)
      return item === undefined ? [] : [item]
    })
    : undefined
  const checkedAt = typeof input.checkedAt === 'number' && Number.isFinite(input.checkedAt) ? input.checkedAt : undefined
  const modelDrift = typeof input.modelDrift === 'string' && input.modelDrift !== '' ? input.modelDrift : undefined
  const refreshError = typeof input.refreshError === 'string' && input.refreshError !== '' ? input.refreshError : undefined
  return {
    ...(checkedAt === undefined ? {} : { checkedAt }),
    stale,
    ...(skills === undefined ? {} : { skills }),
    ...(refreshError === undefined ? {} : { refreshError }),
    ...(modelDrift === undefined ? {} : { modelDrift }),
  }
}

export function normalizeEnvironmentSettings(raw: unknown): EnvironmentSettings {
  const input = record(raw) ?? {}
  const args = Array.isArray(input.arguments)
    ? input.arguments.filter((entry): entry is string => typeof entry === 'string')
    : DEFAULT_ENVIRONMENT_SETTINGS.arguments
  const compat = compatOf(input.compat)
  const updates = updatesOf(input.updates)
  return {
    executable: typeof input.executable === 'string' ? input.executable : DEFAULT_ENVIRONMENT_SETTINGS.executable,
    arguments: args,
    autoStart: boolOf(input.autoStart, DEFAULT_ENVIRONMENT_SETTINGS.autoStart),
    reuseExistingRuntime: boolOf(input.reuseExistingRuntime, DEFAULT_ENVIRONMENT_SETTINGS.reuseExistingRuntime),
    startupTimeout: numberIn(input.startupTimeout, ENVIRONMENT_SETTINGS_RANGES.startupTimeout.min, ENVIRONMENT_SETTINGS_RANGES.startupTimeout.max, DEFAULT_ENVIRONMENT_SETTINGS.startupTimeout),
    autonomousDebugging: boolOf(input.autonomousDebugging, DEFAULT_ENVIRONMENT_SETTINGS.autonomousDebugging),
    ...(compat === undefined ? {} : { compat }),
    ...(updates === undefined ? {} : { updates }),
  }
}

/* G6 v1（0.0.62；0.0.95/G38 批次 1 移入本模块以便单测）：设置台写通道白名单——
   键（deepseekHarness 段内相对键）→ 校验器（非法值返回 undefined 直接丢弃）。
   写 Global 配置后由 onDidChangeConfiguration 统一回流（热更/重建钩子 0.0.60 已就绪）。 */
export const CONFIG_WRITE_VALIDATORS: Record<string, (input: unknown) => unknown> = {
  animationStyle: input => input === 'standard' || input === 'dots' || input === 'off' ? input : undefined,
  markdownImages: input => typeof input === 'boolean' ? input : undefined,
  imageCopyFormat: input => input === 'original' || input === 'png' ? input : undefined,
  'preview.minScale': input => typeof input === 'number' && Number.isFinite(input) ? Math.min(1, Math.max(0.005, Math.round(input * 1000) / 1000)) : undefined,
  'preview.maxScale': input => typeof input === 'number' && Number.isFinite(input) ? Math.min(64, Math.max(1, Math.round(input))) : undefined,
  'preview.gifAutoplay': input => typeof input === 'boolean' ? input : undefined,
  updateCheckFrequency: input => typeof input === 'string' && ['startup', 'reload', 'weekly', 'never'].includes(input) ? input : undefined,
  sessionSortMode: input => input === 'persisted' || input === 'activity' ? input : undefined,
  'timeContext.refreshSeconds': input => typeof input === 'number' && Number.isFinite(input) ? Math.min(86400, Math.max(0, Math.round(input))) : undefined,
  /* G42-B（0.0.97）：保留天数允许哨兵 -1（永不删除）——旧行为 1–365 不变；0/其他负值按 1 处理 */
  recycleRetentionDays: input => typeof input === 'number' && Number.isFinite(input) ? normalizeRetentionDays(input, 30) : undefined,
  fileCardRetentionDays: input => typeof input === 'number' && Number.isFinite(input) ? normalizeRetentionDays(input, 30) : undefined,
  'copy.mathButtons': input => typeof input === 'boolean' ? input : undefined,
  'copy.blockButtons': input => typeof input === 'boolean' ? input : undefined,
  'copy.mathFormat': input => input === 'markdown' || input === 'tex' || input === 'tex-delimited' || input === 'mathml' ? input : undefined,
  'copy.plainMathFormat': input => input === 'tex' || input === 'tex-delimited' ? input : undefined,
  'copy.codeCopyFormat': input => input === 'text' || input === 'markdown' ? input : undefined,
  'copy.feedbackMs': input => typeof input === 'number' && Number.isFinite(input) ? Math.min(6000, Math.max(200, Math.round(input))) : undefined,
  'fold.enabled': input => typeof input === 'boolean' ? input : undefined,
  'fold.previewLines': input => typeof input === 'number' && Number.isFinite(input) ? Math.min(20, Math.max(1, Math.round(input))) : undefined,
  'fold.triggerRatio': input => typeof input === 'number' && Number.isFinite(input) ? Math.min(3, Math.max(0.1, input)) : undefined,
  'fold.minFoldExtraLines': input => typeof input === 'number' && Number.isFinite(input) ? Math.min(50, Math.max(0, Math.round(input))) : undefined,
  'fold.minChars': input => typeof input === 'number' && Number.isFinite(input) ? Math.min(20000, Math.max(0, Math.round(input))) : undefined,
  /* 0.0.95（G38 批次 1）：切会话视图记忆三开关（G39 v2 数据层先行，本次补设置台入口）。 */
  'sessionViewMemory.scroll': input => typeof input === 'boolean' ? input : undefined,
  'sessionViewMemory.expand': input => typeof input === 'boolean' ? input : undefined,
  'sessionViewMemory.fold': input => typeof input === 'boolean' ? input : undefined,
  /* 0.0.96（G38 批次 2）：硬编码入设置——超高块折叠门槛 / 选帧与抽帧上限 / 附件单次上限。 */
  'fold.blockMinLines': input => typeof input === 'number' && Number.isFinite(input) ? Math.min(50, Math.max(1, Math.round(input))) : undefined,
  /* 0.0.108（用户补充①）：变更文件块自动折叠（独立开关 + 行数阈值）。 */
  'fold.changedFiles': input => typeof input === 'boolean' ? input : undefined,
  'fold.changedFilesLines': input => typeof input === 'number' && Number.isFinite(input) ? Math.min(50, Math.max(1, Math.round(input))) : undefined,
  /* G49（0.0.119）：AI 工作段（过程）自动折叠开关。 */
  'fold.workSegments': input => typeof input === 'boolean' ? input : undefined,
  'preview.maxFrames': input => typeof input === 'number' && Number.isFinite(input) ? Math.min(240, Math.max(1, Math.round(input))) : undefined,
  'preview.maxFrameSelections': input => typeof input === 'number' && Number.isFinite(input) ? Math.min(60, Math.max(1, Math.round(input))) : undefined,
  'attach.maxFiles': input => typeof input === 'number' && Number.isFinite(input) ? Math.min(200, Math.max(1, Math.round(input))) : undefined,
  'attach.maxTotalMB': input => typeof input === 'number' && Number.isFinite(input) ? Math.min(2048, Math.max(1, Math.round(input))) : undefined,
  'attach.maxFileMB': input => typeof input === 'number' && Number.isFinite(input) ? Math.min(500, Math.max(1, Math.round(input))) : undefined,
  'attach.compressThresholdMB': input => typeof input === 'number' && Number.isFinite(input) ? Math.min(ATTACH_SETTINGS_RANGES.compressThresholdMB.max, Math.max(0, Math.round(input))) : undefined,
  'attach.compressMaxEdge': input => typeof input === 'number' && Number.isFinite(input) ? Math.min(ATTACH_SETTINGS_RANGES.compressMaxEdge.max, Math.max(ATTACH_SETTINGS_RANGES.compressMaxEdge.min, Math.round(input))) : undefined,
  'attach.compressQuality': input => typeof input === 'number' && Number.isFinite(input) ? Math.min(ATTACH_SETTINGS_RANGES.compressQuality.max, Math.max(ATTACH_SETTINGS_RANGES.compressQuality.min, Math.round(input))) : undefined,
  /* 0.0.97（G42-A / 批次 3-E1）：反馈时长秒键（0.2–6，1 位小数）；原图总量上限（-1=不剪枝 或 16–4096）。 */
  'copy.feedbackSeconds': input => typeof input === 'number' && Number.isFinite(input) ? Math.round(Math.min(FEEDBACK_SECONDS_RANGE.max, Math.max(FEEDBACK_SECONDS_RANGE.min, input)) * 10) / 10 : undefined,
  /* 0.0.101（G41 v1.2）：轮次导航跳转动画时长（0–1.5 秒；0=瞬时）。 */
  'turnRail.granularity': input => input === 'turn' || input === 'segment' || input === 'prompt' ? (input === 'prompt' ? 'segment' : input) : undefined,
  'turnRail.jumpSeconds': input => typeof input === 'number' && Number.isFinite(input) ? Math.round(Math.min(TURN_RAIL_RANGES.jumpSeconds.max, Math.max(TURN_RAIL_RANGES.jumpSeconds.min, input)) * 100) / 100 : undefined,
  'turnRail.scrollbar': input => input === 'custom' || input === 'native' ? input : undefined,
  'turnRail.minGap': input => typeof input === 'number' && Number.isFinite(input) ? Math.round(Math.min(TURN_RAIL_RANGES.minGap.max, Math.max(TURN_RAIL_RANGES.minGap.min, input))) : undefined,
  'turnRail.dragEdgePx': input => typeof input === 'number' && Number.isFinite(input) ? Math.round(Math.min(TURN_RAIL_RANGES.dragEdgePx.max, Math.max(TURN_RAIL_RANGES.dragEdgePx.min, input))) : undefined,
  'turnRail.dragSpeed': input => typeof input === 'number' && Number.isFinite(input) ? Math.round(Math.min(TURN_RAIL_RANGES.dragSpeed.max, Math.max(TURN_RAIL_RANGES.dragSpeed.min, input))) : undefined,
  /* 0.0.148（G53）：停点自动标注开关。 */
  'turnRail.markStops': input => typeof input === 'boolean' ? input : undefined,
  /* 0.1.114（G55）：滚动静息徽标「N/M」开关。 */
  'turnRail.nodeBadge': input => typeof input === 'boolean' ? input : undefined,
  /* 0.1.122（G55 内容设置）：节点摘要长度 / 编号文案档位 / 节点列滚动动画时长 / 提示两行。 */
  'turnRail.summaryLength': input => typeof input === 'number' && Number.isFinite(input) ? Math.round(Math.min(TURN_RAIL_RANGES.summaryLength.max, Math.max(TURN_RAIL_RANGES.summaryLength.min, input))) : undefined,
  'turnRail.numberStyle': input => input === 'compact' || input === 'full' || input === 'legacy' ? input : undefined,
  'turnRail.scrollAnimSeconds': input => typeof input === 'number' && Number.isFinite(input) ? Math.round(Math.min(TURN_RAIL_RANGES.scrollAnimSeconds.max, Math.max(TURN_RAIL_RANGES.scrollAnimSeconds.min, input)) * 100) / 100 : undefined,
  'turnRail.tipTwoLine': input => typeof input === 'boolean' ? input : undefined,
  /* 0.0.149：标注提示样式（true=只显示标注内容 / false=标注+轮次摘要）。 */
  'turnRail.markNoteOnly': input => typeof input === 'boolean' ? input : undefined,
  /* 0.0.151：节点颜色（'theme' 或 #rrggbb——与 copy.mathSvgColor 同语义）。 */
  'turnRail.markColor': input => typeof input === 'string' && /^(#[0-9a-f]{6}|theme)$/.test(input.toLowerCase()) ? input.toLowerCase() : undefined,
  'turnRail.stopColor': input => typeof input === 'string' && /^(#[0-9a-f]{6}|theme)$/.test(input.toLowerCase()) ? input.toLowerCase() : undefined,
  /* 0.0.103（G45）：公式复制为 SVG 的颜色——'theme' 或 #rrggbb。 */
  'copy.mathSvgColor': input => typeof input === 'string' && /^(#[0-9a-f]{6}|theme)$/.test(input.toLowerCase()) ? input.toLowerCase() : undefined,
  /* 0.0.105（G45 v1.2）：位图兜底档位。 */
  'copy.svgPngEdge': input => typeof input === 'string' && ['screen', '512', '1024', '2048'].includes(input) ? input : undefined,
  'imageStore.maxTotalMB': input => typeof input === 'number' && Number.isFinite(input) ? (input === -1 ? -1 : Math.min(IMAGE_STORE_RANGES.maxTotalMB.max, Math.max(IMAGE_STORE_RANGES.maxTotalMB.min, Math.round(input)))) : undefined,
  /* 0.0.154：会话加载——全量开关 + 上限条数。 */
  'sessionHistory.loadAll': input => typeof input === 'boolean' ? input : undefined,
  'sessionHistory.maxMessages': input => typeof input === 'number' && Number.isFinite(input) ? Math.round(Math.min(SESSION_HISTORY_RANGES.maxMessages.max, Math.max(SESSION_HISTORY_RANGES.maxMessages.min, input))) : undefined,
  /* 0.0.109（G50）：hover 显示官方英文原文。 */
  'ui.showOriginalOnHover': input => typeof input === 'boolean' ? input : undefined,
  'ui.hintSeconds': input => typeof input === 'number' && Number.isFinite(input) ? Math.min(UI_SETTINGS_RANGES.hintSeconds.max, Math.max(UI_SETTINGS_RANGES.hintSeconds.min, Math.round(input))) : undefined,
  /* 2026-09-25（用户需求）：搜索命中高亮的模式与颜色。 */
  'search.highlightMode': input => input === 'steady' || input === 'blink' || input === 'blinkThenSteady' ? input : undefined,
  'search.highlightColor': input => input === 'theme' || (typeof input === 'string' && /^#[0-9a-f]{6}$/i.test(input)) ? input : undefined,
  /* 0.1.68（用户反馈）：命中字色取法（两态枚举）与「呼吸后常亮」时长（秒，1–10）。 */
  'search.highlightFg': input => input === 'auto' || input === 'fixed' ? input : undefined,
  'search.blinkPeriod': input => typeof input === 'number' && Number.isFinite(input) ? Math.min(3, Math.max(0.6, input)) : undefined,
  'search.resultOrder': input => input === 'recent' || input === 'oldest' ? input : undefined,
  'search.snippetView': input => input === 'peek' || input === 'pane' ? input : undefined,
  /* 0.1.96（用户拍板）：搜索结果是否包含工具卡内容（工具调用参数/输出；默认不搜，开关可放大）。 */
  'search.includeTools': input => typeof input === 'boolean' ? input : undefined,
  /* 0.1.122（G55）：搜索结果行内节点编号片开关（默认开）。 */
  'search.nodeChip': input => typeof input === 'boolean' ? input : undefined,
  /* 0.1.103（用户需求）：Enter 逐处跳的**会话组序**——最近命中优先（默认）/ 侧栏顺序。 */
  'search.groupOrder': input => input === 'recent' || input === 'panel' ? input : undefined,
  /* 0.1.84（用户拍板）：跨会话跳转后的「返回搜索起点」胶囊开关（默认开）。0.1.88：时长入设置（秒，3–120）。 */
  'search.returnPill': input => typeof input === 'boolean' ? input : undefined,
  'search.returnPillSeconds': input => typeof input === 'number' && Number.isFinite(input) ? Math.min(120, Math.max(3, Math.round(input))) : undefined,
  /* 0.0.147：会话栏标签最小宽度（68–200）。 */
  'ui.sessionTabMinWidth': input => typeof input === 'number' && Number.isFinite(input) ? Math.min(UI_SETTINGS_RANGES.sessionTabMinWidth.max, Math.max(UI_SETTINGS_RANGES.sessionTabMinWidth.min, Math.round(input))) : undefined,
  /* 0.0.160（N1）：任务通知等级（三态枚举）。 */
  'ui.notifyLevel': input => input === 'all' || input === 'action' || input === 'off' ? input : undefined,
  /* 0.1.7（用户需求）：通知形式（两态枚举）。 */
  'ui.notifyStyle': input => input === 'vscode' || input === 'system' ? input : undefined,
  /* 0.0.161（用户需求）：保留未发送草稿开关。 */
  'ui.keepDrafts': input => typeof input === 'boolean' ? input : undefined,
  /* 0.1.27（用户需求）：内容列最大宽度（-1 = 无上限；其余夹到 320–4000）。 */
  'ui.contentMaxWidth': input => normalizeContentMaxWidth(input, Number.NaN),
  /* 0.1.0（B6 A8）：诊断日志开关。 */
  'ui.diagnostics': input => typeof input === 'boolean' ? input : undefined,
  /* 0.1.44（D3）：折叠内容按需构建开关（必须显式 true/false，便于设置台双向切换）。 */
  'ui.lazyFoldedBodies': input => typeof input === 'boolean' ? input : undefined,
  /* 0.1.45（D1）：动作行悬停显示开关（必须显式 true/false，便于设置台双向切换）。 */
  'ui.hoverActions': input => typeof input === 'boolean' ? input : undefined,
  /* 0.1.51（CV）：离屏跳过排版开关。 */
  'ui.messageContainment': input => typeof input === 'boolean' ? input : undefined,
}
