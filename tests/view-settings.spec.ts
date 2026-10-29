import { describe, expect, it } from 'vitest'
import {
  CONFIG_WRITE_VALIDATORS,
  normalizeContentMaxWidth,
  DEFAULT_ATTACH_SETTINGS,
  DEFAULT_SESSION_HISTORY_SETTINGS,
  normalizeSessionHistorySettings,
  DEFAULT_COPY_SETTINGS,
  DEFAULT_ENVIRONMENT_SETTINGS,
  DEFAULT_FOLD_SETTINGS,
  DEFAULT_IMAGE_STORE_SETTINGS,
  DEFAULT_SESSION_SETTINGS,
  DEFAULT_SESSION_VIEW_MEMORY,
  DEFAULT_UI_SETTINGS,
  normalizeAttachSettings,
  normalizeCopySettings,
  normalizeEnvironmentSettings,
  normalizeFoldSettings,
  normalizeImageCopyFormat,
  normalizeImageStoreSettings,
  normalizePreviewSettings,
  normalizeRetentionDays,
  normalizeSessionSettings,
  normalizeSessionViewMemory,
  normalizeTurnRailSettings,
  normalizeUiSettings,
  resolveFeedbackMs,
} from '../src/view-settings.js'

describe('normalizeCopySettings (G6 0.0.60)', () => {
  it('falls back to pre-0.0.60 defaults when the raw value is missing or malformed', () => {
    expect(normalizeCopySettings(undefined)).toEqual(DEFAULT_COPY_SETTINGS)
    expect(normalizeCopySettings('nope')).toEqual(DEFAULT_COPY_SETTINGS)
    expect(normalizeCopySettings({
      mathButtons: 'yes',
      mathFormat: 'html',
      plainMathFormat: 'x',
      codeCopyFormat: 'fenced',
      feedbackMs: 'fast',
    })).toEqual(DEFAULT_COPY_SETTINGS)
  })

  it('passes through valid values and clamps feedbackMs into range', () => {
    expect(normalizeCopySettings({
      mathButtons: false,
      blockButtons: false,
      mathFormat: 'tex',
      plainMathFormat: 'tex-delimited',
      codeCopyFormat: 'markdown',
      feedbackMs: 2500,
    })).toEqual({
      mathButtons: false,
      blockButtons: false,
      mathFormat: 'tex',
      plainMathFormat: 'tex-delimited',
      codeCopyFormat: 'markdown',
      feedbackMs: 2500,
      mathSvgColor: 'theme',
      svgPngEdge: '1024',
    })
    expect(normalizeCopySettings({ feedbackMs: 10 }).feedbackMs).toBe(200)
    expect(normalizeCopySettings({ feedbackMs: 90000 }).feedbackMs).toBe(6000)
    /* G45（0.0.103）：SVG 颜色——合法 #rrggbb 归一为小写；非法回退 theme。 */
    expect(normalizeCopySettings({ mathSvgColor: '#FF00AA' }).mathSvgColor).toBe('#ff00aa')
    expect(normalizeCopySettings({ mathSvgColor: 'red' }).mathSvgColor).toBe('theme')
    /* G45 v1.2（0.0.105）：位图档位——白名单四档；非法回退默认 1024。 */
    expect(normalizeCopySettings({ svgPngEdge: '512' }).svgPngEdge).toBe('512')
    expect(normalizeCopySettings({ svgPngEdge: 'screen' }).svgPngEdge).toBe('screen')
    expect(normalizeCopySettings({ svgPngEdge: '4096' }).svgPngEdge).toBe('1024')
  })
})

describe('normalizeFoldSettings (G6 0.0.60)', () => {
  it('falls back to pre-0.0.60 defaults when the raw value is missing or malformed', () => {
    expect(normalizeFoldSettings(undefined)).toEqual(DEFAULT_FOLD_SETTINGS)
    expect(normalizeFoldSettings({
      enabled: 'on',
      previewLines: '4',
      triggerRatio: 'half',
      minFoldExtraLines: null,
      minChars: {},
    })).toEqual(DEFAULT_FOLD_SETTINGS)
  })

  it('passes through valid values and clamps numbers into range', () => {
    expect(normalizeFoldSettings({
      enabled: false,
      previewLines: 8,
      triggerRatio: 0.75,
      minFoldExtraLines: 5,
      minChars: 500,
      blockMinLines: 6,
      changedFiles: false,
      changedFilesLines: 12,
      workSegments: false,
    })).toEqual({
      enabled: false,
      previewLines: 8,
      triggerRatio: 0.75,
      minFoldExtraLines: 5,
      minChars: 500,
      blockMinLines: 6,
      changedFiles: false,
      changedFilesLines: 12,
      workSegments: false,
    })
    expect(normalizeFoldSettings({ previewLines: 0 }).previewLines).toBe(1)
    expect(normalizeFoldSettings({ previewLines: 999 }).previewLines).toBe(20)
    expect(normalizeFoldSettings({ triggerRatio: -1 }).triggerRatio).toBe(0.1)
    expect(normalizeFoldSettings({ minChars: -5 }).minChars).toBe(0)
    /* 0.0.108（用户补充①）：变更文件块折叠阈值 clamp。 */
    expect(normalizeFoldSettings({ changedFilesLines: 0 }).changedFilesLines).toBe(1)
    expect(normalizeFoldSettings({ changedFilesLines: 999 }).changedFilesLines).toBe(50)
    expect(normalizeFoldSettings({ changedFilesLines: 6.4 }).changedFilesLines).toBe(6)
  })
})

describe('normalizeImageCopyFormat (G6 0.0.60)', () => {
  it('accepts only "png"; everything else means "original"', () => {
    expect(normalizeImageCopyFormat('png')).toBe('png')
    expect(normalizeImageCopyFormat('original')).toBe('original')
    expect(normalizeImageCopyFormat(undefined)).toBe('original')
    expect(normalizeImageCopyFormat('PNG')).toBe('original')
  })
})

describe('normalizeTurnRailSettings (G41 0.0.128 扩展)', () => {
  it('0.0.128: scrollbar 只认 custom/native（缺省 custom）；minGap 夹在 12–96（缺省 20，四舍五入）；0.0.144 拖拽滚列两键', () => {
    expect(normalizeTurnRailSettings({})).toEqual({ jumpSeconds: 0.25, granularity: 'segment', scrollbar: 'custom', minGap: 20, dragEdgePx: 64, dragSpeed: 800, markStops: true, markNoteOnly: true, markColor: 'theme', stopColor: 'theme', nodeBadge: true, summaryLength: 40, numberStyle: 'compact', scrollAnimSeconds: 0.18, tipTwoLine: false })
    expect(normalizeTurnRailSettings({ scrollbar: 'native' }).scrollbar).toBe('native')
    expect(normalizeTurnRailSettings({ scrollbar: 'weird' }).scrollbar).toBe('custom')
    expect(normalizeTurnRailSettings({ minGap: 4 }).minGap).toBe(12)
    expect(normalizeTurnRailSettings({ minGap: 999 }).minGap).toBe(96)
    expect(normalizeTurnRailSettings({ minGap: 27.6 }).minGap).toBe(28)
    expect(normalizeTurnRailSettings({ minGap: 'x' }).minGap).toBe(20)
    /* 0.0.144：边缘拖拽自动滚列——带宽（px，缺省 64，夹 8–200）与最大速度（px/秒，缺省 800，夹 100–3000）。 */
    expect(normalizeTurnRailSettings({ dragEdgePx: 4 }).dragEdgePx).toBe(8)
    expect(normalizeTurnRailSettings({ dragEdgePx: 999 }).dragEdgePx).toBe(200)
    expect(normalizeTurnRailSettings({ dragSpeed: 10 }).dragSpeed).toBe(100)
    expect(normalizeTurnRailSettings({ dragSpeed: 99999 }).dragSpeed).toBe(3000)
    expect(normalizeTurnRailSettings({ dragEdgePx: 'x', dragSpeed: null }).dragEdgePx).toBe(64)
    /* 0.0.148（G53）：停点自动标注（默认开；显式 false 才关）。 */
    expect(normalizeTurnRailSettings({}).markStops).toBe(true)
    expect(normalizeTurnRailSettings({ markStops: false }).markStops).toBe(false)
    expect(normalizeTurnRailSettings({ markStops: 'x' }).markStops).toBe(true)
    /* 0.0.149：标注提示样式（默认只显示标注；显式 false = 标注+轮次摘要）。 */
    expect(normalizeTurnRailSettings({}).markNoteOnly).toBe(true)
    expect(normalizeTurnRailSettings({ markNoteOnly: false }).markNoteOnly).toBe(false)
    expect(normalizeTurnRailSettings({ markNoteOnly: 'x' }).markNoteOnly).toBe(true)
    /* 0.0.151：节点颜色（'theme' 或 #rrggbb；非法值回落 theme，大写归一为小写）。 */
    expect(normalizeTurnRailSettings({ markColor: '#E3B341' }).markColor).toBe('#e3b341')
    expect(normalizeTurnRailSettings({ stopColor: '#b180d7' }).stopColor).toBe('#b180d7')
    expect(normalizeTurnRailSettings({ markColor: 'red', stopColor: '#12345' }).markColor).toBe('theme')
    expect(normalizeTurnRailSettings({ stopColor: 42 }).stopColor).toBe('theme')
    /* 0.1.114（G55）：滚动静息徽标开关（默认开；显式 false 才关）。 */
    expect(normalizeTurnRailSettings({}).nodeBadge).toBe(true)
    expect(normalizeTurnRailSettings({ nodeBadge: false }).nodeBadge).toBe(false)
    expect(normalizeTurnRailSettings({ nodeBadge: 'x' }).nodeBadge).toBe(true)
    /* 0.1.122（G55 内容设置）：摘要长度（24–80，默认 40）/ 编号档位 / 滚动动画时长（0–0.6，默认 0.18）/ 两行提示。 */
    expect(normalizeTurnRailSettings({}).summaryLength).toBe(40)
    expect(normalizeTurnRailSettings({ summaryLength: 10 }).summaryLength).toBe(24)
    expect(normalizeTurnRailSettings({ summaryLength: 200 }).summaryLength).toBe(80)
    expect(normalizeTurnRailSettings({ summaryLength: 47.6 }).summaryLength).toBe(48)
    expect(normalizeTurnRailSettings({ summaryLength: 'x' }).summaryLength).toBe(40)
    expect(normalizeTurnRailSettings({ numberStyle: 'full' }).numberStyle).toBe('full')
    expect(normalizeTurnRailSettings({ numberStyle: 'legacy' }).numberStyle).toBe('legacy')
    expect(normalizeTurnRailSettings({ numberStyle: 'x' }).numberStyle).toBe('compact')
    expect(normalizeTurnRailSettings({}).scrollAnimSeconds).toBe(0.18)
    expect(normalizeTurnRailSettings({ scrollAnimSeconds: 2 }).scrollAnimSeconds).toBe(0.6)
    expect(normalizeTurnRailSettings({ scrollAnimSeconds: -1 }).scrollAnimSeconds).toBe(0)
    expect(normalizeTurnRailSettings({ scrollAnimSeconds: 'x' }).scrollAnimSeconds).toBe(0.18)
    expect(normalizeTurnRailSettings({}).tipTwoLine).toBe(false)
    expect(normalizeTurnRailSettings({ tipTwoLine: true }).tipTwoLine).toBe(true)
    expect(normalizeTurnRailSettings({ tipTwoLine: 'x' }).tipTwoLine).toBe(false)
  })
  it('0.0.128: 写通道校验器——非法值返回 undefined（不写），合法值按域收敛', () => {
    expect(CONFIG_WRITE_VALIDATORS['turnRail.scrollbar']('native')).toBe('native')
    expect(CONFIG_WRITE_VALIDATORS['turnRail.scrollbar']('custom')).toBe('custom')
    expect(CONFIG_WRITE_VALIDATORS['turnRail.scrollbar']('x')).toBeUndefined()
    expect(CONFIG_WRITE_VALIDATORS['turnRail.minGap'](20)).toBe(20)
    expect(CONFIG_WRITE_VALIDATORS['turnRail.minGap'](4)).toBe(12)
    /* 0.0.148（G53）：停点标注开关（布尔白名单）。 */
    expect(CONFIG_WRITE_VALIDATORS['turnRail.markStops'](true)).toBe(true)
    expect(CONFIG_WRITE_VALIDATORS['turnRail.markStops'](false)).toBe(false)
    expect(CONFIG_WRITE_VALIDATORS['turnRail.markStops']('on')).toBeUndefined()
    /* 0.0.149：标注提示样式开关。 */
    expect(CONFIG_WRITE_VALIDATORS['turnRail.markNoteOnly'](true)).toBe(true)
    expect(CONFIG_WRITE_VALIDATORS['turnRail.markNoteOnly'](false)).toBe(false)
    expect(CONFIG_WRITE_VALIDATORS['turnRail.markNoteOnly']('on')).toBeUndefined()
    /* 0.1.114（G55）：滚动静息徽标开关（布尔白名单）。 */
    expect(CONFIG_WRITE_VALIDATORS['turnRail.nodeBadge'](true)).toBe(true)
    expect(CONFIG_WRITE_VALIDATORS['turnRail.nodeBadge'](false)).toBe(false)
    expect(CONFIG_WRITE_VALIDATORS['turnRail.nodeBadge']('on')).toBeUndefined()
    /* 0.1.122（G55 内容设置）：四条新写入校验器。 */
    expect(CONFIG_WRITE_VALIDATORS['turnRail.summaryLength'](150)).toBe(80)
    expect(CONFIG_WRITE_VALIDATORS['turnRail.summaryLength'](10)).toBe(24)
    expect(CONFIG_WRITE_VALIDATORS['turnRail.summaryLength']('x')).toBeUndefined()
    expect(CONFIG_WRITE_VALIDATORS['turnRail.numberStyle']('legacy')).toBe('legacy')
    expect(CONFIG_WRITE_VALIDATORS['turnRail.numberStyle']('x')).toBeUndefined()
    expect(CONFIG_WRITE_VALIDATORS['turnRail.scrollAnimSeconds'](1)).toBe(0.6)
    expect(CONFIG_WRITE_VALIDATORS['turnRail.scrollAnimSeconds']('x')).toBeUndefined()
    expect(CONFIG_WRITE_VALIDATORS['turnRail.tipTwoLine'](true)).toBe(true)
    expect(CONFIG_WRITE_VALIDATORS['turnRail.tipTwoLine']('x')).toBeUndefined()
    expect(CONFIG_WRITE_VALIDATORS['search.nodeChip'](false)).toBe(false)
    expect(CONFIG_WRITE_VALIDATORS['search.nodeChip']('x')).toBeUndefined()
    /* 0.0.151：节点颜色写通道（'theme' 或 #rrggbb）。 */
    expect(CONFIG_WRITE_VALIDATORS['turnRail.markColor']('#E3B341')).toBe('#e3b341')
    expect(CONFIG_WRITE_VALIDATORS['turnRail.markColor']('theme')).toBe('theme')
    expect(CONFIG_WRITE_VALIDATORS['turnRail.markColor']('red')).toBeUndefined()
    expect(CONFIG_WRITE_VALIDATORS['turnRail.stopColor']('#b180d7')).toBe('#b180d7')
    expect(CONFIG_WRITE_VALIDATORS['turnRail.stopColor'](7)).toBeUndefined()
    expect(CONFIG_WRITE_VALIDATORS['turnRail.minGap'](999)).toBe(96)
    expect(CONFIG_WRITE_VALIDATORS['turnRail.minGap']('x')).toBeUndefined()
    expect(CONFIG_WRITE_VALIDATORS['turnRail.dragEdgePx'](64)).toBe(64)
    expect(CONFIG_WRITE_VALIDATORS['turnRail.dragEdgePx'](0)).toBe(8)
    expect(CONFIG_WRITE_VALIDATORS['turnRail.dragSpeed'](800)).toBe(800)
    expect(CONFIG_WRITE_VALIDATORS['turnRail.dragSpeed'](99999)).toBe(3000)
    expect(CONFIG_WRITE_VALIDATORS['turnRail.dragSpeed']('x')).toBeUndefined()
  })
})

describe('normalizeSessionSettings (G6 v1 0.0.62)', () => {
  it('falls back to defaults when missing or malformed', () => {
    expect(normalizeSessionSettings(undefined)).toEqual(DEFAULT_SESSION_SETTINGS)
    expect(normalizeSessionSettings({ sortMode: 'x', recycleRetentionDays: '30' })).toEqual(DEFAULT_SESSION_SETTINGS)
  })

  it('passes valid values and clamps retention days', () => {
    expect(normalizeSessionSettings({ sortMode: 'activity', recycleRetentionDays: 7, fileCardRetentionDays: 90 }))
      .toEqual({ sortMode: 'activity', recycleRetentionDays: 7, fileCardRetentionDays: 90 })
    expect(normalizeSessionSettings({ recycleRetentionDays: 0 }).recycleRetentionDays).toBe(1)
    expect(normalizeSessionSettings({ fileCardRetentionDays: 9999 }).fileCardRetentionDays).toBe(365)
  })
})

describe('normalizeEnvironmentSettings (G6 v1 0.0.62，v1 只读展示)', () => {
  it('falls back to defaults when missing or malformed', () => {
    expect(normalizeEnvironmentSettings(undefined)).toEqual(DEFAULT_ENVIRONMENT_SETTINGS)
    expect(normalizeEnvironmentSettings({ autoStart: 'yes', arguments: 'web', startupTimeout: 'soon' })).toEqual(DEFAULT_ENVIRONMENT_SETTINGS)
  })

  it('passes valid values; filters non-string arguments and clamps startupTimeout', () => {
    expect(normalizeEnvironmentSettings({
      executable: 'C:/dsh/bin.js',
      arguments: ['web', 7, '--port', '0'],
      autoStart: false,
      reuseExistingRuntime: false,
      startupTimeout: 5000,
      autonomousDebugging: true,
    })).toEqual({
      executable: 'C:/dsh/bin.js',
      arguments: ['web', '--port', '0'],
      autoStart: false,
      reuseExistingRuntime: false,
      startupTimeout: 5000,
      autonomousDebugging: true,
    })
    expect(normalizeEnvironmentSettings({ startupTimeout: 10 }).startupTimeout).toBe(1000)
    expect(normalizeEnvironmentSettings({ startupTimeout: 999999 }).startupTimeout).toBe(300000)
  })
})

describe('normalizeSessionViewMemory (G39 0.0.93)', () => {
  it('defaults all three gates to on', () => {
    expect(normalizeSessionViewMemory(undefined)).toEqual(DEFAULT_SESSION_VIEW_MEMORY)
    expect(normalizeSessionViewMemory({ scroll: 'yes', expand: 1, fold: null })).toEqual(DEFAULT_SESSION_VIEW_MEMORY)
  })

  it('respects explicit false and mixed values', () => {
    expect(normalizeSessionViewMemory({ scroll: false })).toEqual({ scroll: false, expand: true, fold: true })
    expect(normalizeSessionViewMemory({ scroll: false, expand: true, fold: false })).toEqual({ scroll: false, expand: true, fold: false })
  })
})

describe('G38 批次 2 (0.0.96): 硬编码入设置——预览选帧上限 + 附件上限', () => {
  it('normalizes the new preview frame caps with defaults and clamps', () => {
    expect(normalizePreviewSettings({ maxFrames: 120, maxFrameSelections: 30 })).toMatchObject({ maxFrames: 120, maxFrameSelections: 30 })
    expect(normalizePreviewSettings(undefined)).toMatchObject({ maxFrames: 60, maxFrameSelections: 12 })
    expect(normalizePreviewSettings({ maxFrames: 9999 }).maxFrames).toBe(240)
    expect(normalizePreviewSettings({ maxFrameSelections: 0 }).maxFrameSelections).toBe(1)
    expect(normalizePreviewSettings({ maxFrameSelections: 12.6 }).maxFrameSelections).toBe(13)
  })

  it('normalizes attach caps with defaults and clamps', () => {
    expect(normalizeAttachSettings(undefined)).toEqual(DEFAULT_ATTACH_SETTINGS)
    expect(normalizeAttachSettings({ maxFiles: 50, maxTotalMB: 200 })).toEqual({ ...DEFAULT_ATTACH_SETTINGS, maxFiles: 50, maxTotalMB: 200 })
    expect(normalizeAttachSettings({ maxFiles: 0 }).maxFiles).toBe(1)
    expect(normalizeAttachSettings({ maxFiles: 999 }).maxFiles).toBe(200)
    expect(normalizeAttachSettings({ maxTotalMB: 99999 }).maxTotalMB).toBe(2048)
    /* 0.0.145（G43）：大图压缩三键——阈值允许 0（关闭）、最长边/质量按域夹取。 */
    expect(DEFAULT_ATTACH_SETTINGS.compressThresholdMB).toBe(20)
    expect(DEFAULT_ATTACH_SETTINGS.compressMaxEdge).toBe(4096)
    expect(DEFAULT_ATTACH_SETTINGS.compressQuality).toBe(82)
    expect(normalizeAttachSettings({ compressThresholdMB: 0 }).compressThresholdMB).toBe(0)
    expect(normalizeAttachSettings({ compressThresholdMB: 99999 }).compressThresholdMB).toBe(2048)
    expect(normalizeAttachSettings({ compressMaxEdge: 10 }).compressMaxEdge).toBe(512)
    expect(normalizeAttachSettings({ compressMaxEdge: 99999 }).compressMaxEdge).toBe(16384)
    expect(normalizeAttachSettings({ compressQuality: 1 }).compressQuality).toBe(40)
    expect(normalizeAttachSettings({ compressQuality: 100 }).compressQuality).toBe(95)
    expect(CONFIG_WRITE_VALIDATORS['attach.compressThresholdMB'](0)).toBe(0)
    expect(CONFIG_WRITE_VALIDATORS['attach.compressMaxEdge'](10)).toBe(512)
    expect(CONFIG_WRITE_VALIDATORS['attach.compressQuality'](100)).toBe(95)
    expect(CONFIG_WRITE_VALIDATORS['attach.compressQuality']('x')).toBeUndefined()
  })

  it('validators clamp the five new config keys', () => {
    expect(CONFIG_WRITE_VALIDATORS['fold.blockMinLines'](6)).toBe(6)
    expect(CONFIG_WRITE_VALIDATORS['fold.blockMinLines'](0)).toBe(1)
    expect(CONFIG_WRITE_VALIDATORS['fold.blockMinLines'](99)).toBe(50)
    /* 0.0.108（用户补充①）：变更文件块折叠（开关 + 行数）。 */
    expect(CONFIG_WRITE_VALIDATORS['fold.changedFiles'](false)).toBe(false)
    expect(CONFIG_WRITE_VALIDATORS['fold.changedFiles']('on')).toBeUndefined()
    expect(CONFIG_WRITE_VALIDATORS['fold.changedFilesLines'](12)).toBe(12)
    expect(CONFIG_WRITE_VALIDATORS['fold.changedFilesLines'](0)).toBe(1)
    expect(CONFIG_WRITE_VALIDATORS['fold.changedFilesLines'](99)).toBe(50)
    expect(CONFIG_WRITE_VALIDATORS['preview.maxFrames'](240.6)).toBe(240)
    expect(CONFIG_WRITE_VALIDATORS['preview.maxFrames'](1000)).toBe(240)
    expect(CONFIG_WRITE_VALIDATORS['preview.maxFrameSelections'](3)).toBe(3)
    expect(CONFIG_WRITE_VALIDATORS['preview.maxFrameSelections'](61)).toBe(60)
    expect(CONFIG_WRITE_VALIDATORS['attach.maxFiles'](201)).toBe(200)
    expect(CONFIG_WRITE_VALIDATORS['attach.maxTotalMB'](5000)).toBe(2048)
    expect(CONFIG_WRITE_VALIDATORS['attach.maxFiles']('many')).toBeUndefined()
  })
})

describe('G42 / 批次 3 (0.0.97): 单位迁移 + 哨兵值 + 原图存储上限', () => {
  it('resolveFeedbackMs：秒键优先；旧毫秒键换算沿用；双缺省 1s', () => {
    expect(resolveFeedbackMs(1.5, undefined)).toBe(1500)
    expect(resolveFeedbackMs(undefined, 2000)).toBe(2000)
    expect(resolveFeedbackMs(undefined, undefined)).toBe(1000)
    expect(resolveFeedbackMs(0.99, 5000)).toBe(990)
    expect(resolveFeedbackMs(10, undefined)).toBe(6000)
    expect(resolveFeedbackMs(undefined, 100)).toBe(200)
  })

  it('normalizeRetentionDays / normalizeSessionSettings：-1 哨兵通过；0/-2 按 1', () => {
    expect(normalizeRetentionDays(-1, 30)).toBe(-1)
    expect(normalizeRetentionDays(0, 30)).toBe(1)
    expect(normalizeRetentionDays(-2, 30)).toBe(1)
    expect(normalizeRetentionDays(999, 30)).toBe(365)
    expect(normalizeSessionSettings({ recycleRetentionDays: -1, fileCardRetentionDays: -1 }))
      .toEqual({ sortMode: 'persisted', recycleRetentionDays: -1, fileCardRetentionDays: -1 })
  })

  it('normalizeImageStoreSettings：默认 512；-1 哨兵；16–4096 夹紧', () => {
    expect(normalizeImageStoreSettings(undefined)).toEqual(DEFAULT_IMAGE_STORE_SETTINGS)
    expect(normalizeImageStoreSettings({ maxTotalMB: -1 })).toEqual({ maxTotalMB: -1 })
    expect(normalizeImageStoreSettings({ maxTotalMB: 8 }).maxTotalMB).toBe(16)
    expect(normalizeImageStoreSettings({ maxTotalMB: 9999 }).maxTotalMB).toBe(4096)
  })

  it('validators：新键（秒/哨兵/原图上限）', () => {
    expect(CONFIG_WRITE_VALIDATORS['copy.feedbackSeconds'](0.3)).toBe(0.3)
    expect(CONFIG_WRITE_VALIDATORS['copy.feedbackSeconds'](7)).toBe(6)
    expect(CONFIG_WRITE_VALIDATORS['copy.feedbackSeconds']('1s')).toBeUndefined()
    expect(CONFIG_WRITE_VALIDATORS.recycleRetentionDays(-1)).toBe(-1)
    expect(CONFIG_WRITE_VALIDATORS.fileCardRetentionDays(-1)).toBe(-1)
    expect(CONFIG_WRITE_VALIDATORS.recycleRetentionDays(0)).toBe(1)
    expect(CONFIG_WRITE_VALIDATORS['imageStore.maxTotalMB'](-1)).toBe(-1)
    expect(CONFIG_WRITE_VALIDATORS['imageStore.maxTotalMB'](100)).toBe(100)
    expect(CONFIG_WRITE_VALIDATORS['imageStore.maxTotalMB'](0)).toBe(16)
  })
})

describe('CONFIG_WRITE_VALIDATORS (G6 0.0.62；0.0.95/G38 批次 1 移入本模块)', () => {
  it('rejects unknown keys and validates the sessionViewMemory gates from the settings panel', () => {
    expect(CONFIG_WRITE_VALIDATORS['nope.key']).toBeUndefined()
    for (const key of ['sessionViewMemory.scroll', 'sessionViewMemory.expand', 'sessionViewMemory.fold']) {
      expect(CONFIG_WRITE_VALIDATORS[key](true)).toBe(true)
      expect(CONFIG_WRITE_VALIDATORS[key](false)).toBe(false)
      expect(CONFIG_WRITE_VALIDATORS[key]('true')).toBeUndefined()
      expect(CONFIG_WRITE_VALIDATORS[key](1)).toBeUndefined()
    }
  })

  it('clamps fold.triggerRatio without rounding away decimals (settings panel step 0.1)', () => {
    expect(CONFIG_WRITE_VALIDATORS['fold.triggerRatio'](0.5)).toBe(0.5)
    expect(CONFIG_WRITE_VALIDATORS['fold.triggerRatio'](2.3)).toBe(2.3)
    expect(CONFIG_WRITE_VALIDATORS['fold.triggerRatio'](0.05)).toBe(0.1)
    expect(CONFIG_WRITE_VALIDATORS['fold.triggerRatio'](9)).toBe(3)
    expect(CONFIG_WRITE_VALIDATORS['fold.triggerRatio']('half')).toBeUndefined()
    expect(CONFIG_WRITE_VALIDATORS['fold.triggerRatio'](Number.NaN)).toBeUndefined()
  })

  it('keeps integer rounding and clamping for the existing numeric keys', () => {
    expect(CONFIG_WRITE_VALIDATORS['fold.previewLines'](7.6)).toBe(8)
    expect(CONFIG_WRITE_VALIDATORS['fold.previewLines'](0)).toBe(1)
    expect(CONFIG_WRITE_VALIDATORS['copy.feedbackMs'](100.4)).toBe(200)
    expect(CONFIG_WRITE_VALIDATORS['preview.minScale'](0.33333)).toBe(0.333)
    expect(CONFIG_WRITE_VALIDATORS['preview.minScale'](0)).toBe(0.005)
    expect(CONFIG_WRITE_VALIDATORS['animationStyle']('pulse')).toBeUndefined()
    expect(CONFIG_WRITE_VALIDATORS.animationStyle('dots')).toBe('dots')
  })

  /* 0.1.88（用户需求）：返回胶囊时长（秒，3–120）——越界夹紧、取整、非数值丢弃；开关仍是布尔。 */
  it('0.1.88: 返回胶囊开关与显示时长', () => {
    expect(CONFIG_WRITE_VALIDATORS['search.returnPill'](true)).toBe(true)
    expect(CONFIG_WRITE_VALIDATORS['search.returnPill']('on')).toBeUndefined()
    expect(CONFIG_WRITE_VALIDATORS['search.returnPillSeconds'](12)).toBe(12)
    expect(CONFIG_WRITE_VALIDATORS['search.returnPillSeconds'](2)).toBe(3)
    expect(CONFIG_WRITE_VALIDATORS['search.returnPillSeconds'](999)).toBe(120)
    expect(CONFIG_WRITE_VALIDATORS['search.returnPillSeconds'](12.4)).toBe(12)
    expect(CONFIG_WRITE_VALIDATORS['search.returnPillSeconds']('12s')).toBeUndefined()
  })
})

describe('normalizeUiSettings (0.0.109 G50)', () => {
  it('defaults to off and only accepts booleans', () => {
    expect(normalizeUiSettings(undefined)).toEqual(DEFAULT_UI_SETTINGS)
    expect(normalizeUiSettings({ showOriginalOnHover: true })).toEqual({ ...DEFAULT_UI_SETTINGS, showOriginalOnHover: true })
    expect(normalizeUiSettings({ showOriginalOnHover: 'yes' })).toEqual({ ...DEFAULT_UI_SETTINGS, showOriginalOnHover: false })
    /* 0.0.145（用户需求①）：提示条显示时长（秒；夹 1–60，缺省 4）。 */
    expect(DEFAULT_UI_SETTINGS.hintSeconds).toBe(4)
    expect(normalizeUiSettings({ hintSeconds: 12 }).hintSeconds).toBe(12)
    expect(normalizeUiSettings({ hintSeconds: 0 }).hintSeconds).toBe(1)
    expect(normalizeUiSettings({ hintSeconds: 999 }).hintSeconds).toBe(60)
    expect(CONFIG_WRITE_VALIDATORS['ui.hintSeconds'](8)).toBe(8)
    expect(CONFIG_WRITE_VALIDATORS['ui.hintSeconds'](0)).toBe(1)
    expect(CONFIG_WRITE_VALIDATORS['ui.hintSeconds']('x')).toBeUndefined()
  })

  it('validates the ui.showOriginalOnHover write channel', () => {
    expect(CONFIG_WRITE_VALIDATORS['ui.showOriginalOnHover'](true)).toBe(true)
    expect(CONFIG_WRITE_VALIDATORS['ui.showOriginalOnHover'](false)).toBe(false)
    expect(CONFIG_WRITE_VALIDATORS['ui.showOriginalOnHover']('on')).toBeUndefined()
  })

  /* 0.0.161（用户需求）：保留未发送草稿（默认开；只收 boolean）。 */
  it('normalizes and validates keepDrafts (0.0.161)', () => {
    expect(DEFAULT_UI_SETTINGS.keepDrafts).toBe(true)
    expect(normalizeUiSettings(undefined).keepDrafts).toBe(true)
    expect(normalizeUiSettings({ keepDrafts: false }).keepDrafts).toBe(false)
    expect(normalizeUiSettings({ keepDrafts: 'no' }).keepDrafts).toBe(true)
    expect(CONFIG_WRITE_VALIDATORS['ui.keepDrafts'](false)).toBe(false)
    expect(CONFIG_WRITE_VALIDATORS['ui.keepDrafts'](true)).toBe(true)
    expect(CONFIG_WRITE_VALIDATORS['ui.keepDrafts']('x')).toBeUndefined()
  })

  /* 0.0.160（N1）：任务通知等级（三态；非法回落 all）。 */
  it('normalizes and validates the notify level (0.0.160)', () => {
    expect(DEFAULT_UI_SETTINGS.notifyLevel).toBe('all')
    expect(normalizeUiSettings({ notifyLevel: 'action' }).notifyLevel).toBe('action')
    expect(normalizeUiSettings({ notifyLevel: 'off' }).notifyLevel).toBe('off')
    expect(normalizeUiSettings({ notifyLevel: 'nope' }).notifyLevel).toBe('all')
    expect(CONFIG_WRITE_VALIDATORS['ui.notifyLevel']('all')).toBe('all')
    expect(CONFIG_WRITE_VALIDATORS['ui.notifyLevel']('action')).toBe('action')
    expect(CONFIG_WRITE_VALIDATORS['ui.notifyLevel']('off')).toBe('off')
    expect(CONFIG_WRITE_VALIDATORS['ui.notifyLevel']('silent')).toBeUndefined()
  })

  /* 0.1.7（用户需求）：通知形式（两态；非法回落 vscode）。 */
  it('normalizes and validates the notify style (0.1.7)', () => {
    expect(DEFAULT_UI_SETTINGS.notifyStyle).toBe('vscode')
    expect(normalizeUiSettings(undefined).notifyStyle).toBe('vscode')
    expect(normalizeUiSettings({ notifyStyle: 'system' }).notifyStyle).toBe('system')
    expect(normalizeUiSettings({ notifyStyle: 'toast' }).notifyStyle).toBe('vscode')
    expect(CONFIG_WRITE_VALIDATORS['ui.notifyStyle']('vscode')).toBe('vscode')
    expect(CONFIG_WRITE_VALIDATORS['ui.notifyStyle']('system')).toBe('system')
    expect(CONFIG_WRITE_VALIDATORS['ui.notifyStyle']('always')).toBeUndefined()
  })

  /* 0.0.147（用户反馈①）：会话栏标签最小宽度（px；夹 68–200，缺省 112——旧值 68 时
     悬停 ✎/✕ 几乎占满标签、切换会话易误点）。 */
  it('clamps and validates the session-tab min width (0.0.147)', () => {
    expect(DEFAULT_UI_SETTINGS.sessionTabMinWidth).toBe(112)
    expect(normalizeUiSettings(undefined).sessionTabMinWidth).toBe(112)
    expect(normalizeUiSettings({ sessionTabMinWidth: 150 }).sessionTabMinWidth).toBe(150)
    expect(normalizeUiSettings({ sessionTabMinWidth: 10 }).sessionTabMinWidth).toBe(68)
    expect(normalizeUiSettings({ sessionTabMinWidth: 999 }).sessionTabMinWidth).toBe(200)
    expect(normalizeUiSettings({ sessionTabMinWidth: 'wide' }).sessionTabMinWidth).toBe(112)
    expect(CONFIG_WRITE_VALIDATORS['ui.sessionTabMinWidth'](120)).toBe(120)
    expect(CONFIG_WRITE_VALIDATORS['ui.sessionTabMinWidth'](0)).toBe(68)
    expect(CONFIG_WRITE_VALIDATORS['ui.sessionTabMinWidth'](9999)).toBe(200)
    expect(CONFIG_WRITE_VALIDATORS['ui.sessionTabMinWidth']('x')).toBeUndefined()
  })
})

describe('normalizeSessionHistorySettings (0.0.154 O3 会话加载)', () => {
  it('默认打开即全量 + 上限 3000；越界夹取，非法回落', () => {
    expect(DEFAULT_SESSION_HISTORY_SETTINGS).toEqual({ loadAll: true, maxMessages: 3000 })
    expect(normalizeSessionHistorySettings(undefined)).toEqual(DEFAULT_SESSION_HISTORY_SETTINGS)
    expect(normalizeSessionHistorySettings({ loadAll: false }).loadAll).toBe(false)
    expect(normalizeSessionHistorySettings({ loadAll: 'x' }).loadAll).toBe(true)
    expect(normalizeSessionHistorySettings({ maxMessages: 100 }).maxMessages).toBe(500)
    expect(normalizeSessionHistorySettings({ maxMessages: 999999 }).maxMessages).toBe(20000)
    expect(normalizeSessionHistorySettings({ maxMessages: 3000.4 }).maxMessages).toBe(3000)
    expect(normalizeSessionHistorySettings({ maxMessages: 'x' }).maxMessages).toBe(3000)
  })

  it('写通道校验器：开关布尔白名单 + 上限 500–20000', () => {
    expect(CONFIG_WRITE_VALIDATORS['sessionHistory.loadAll'](true)).toBe(true)
    expect(CONFIG_WRITE_VALIDATORS['sessionHistory.loadAll']('on')).toBeUndefined()
    expect(CONFIG_WRITE_VALIDATORS['sessionHistory.maxMessages'](3000)).toBe(3000)
    expect(CONFIG_WRITE_VALIDATORS['sessionHistory.maxMessages'](100)).toBe(500)
    expect(CONFIG_WRITE_VALIDATORS['sessionHistory.maxMessages'](999999)).toBe(20000)
    expect(CONFIG_WRITE_VALIDATORS['sessionHistory.maxMessages']('x')).toBeUndefined()
  })
})

/* 0.1.27（用户需求）：内容列最大宽度可配——-1 = 无上限（哨兵），其余夹到 320–4000。 */
describe('normalizeContentMaxWidth (0.1.27 内容列宽度)', () => {
  it('-1 原样保留（无上限哨兵）；越界夹紧；非法回落默认', () => {
    expect(normalizeContentMaxWidth(-1)).toBe(-1)
    expect(normalizeContentMaxWidth(760)).toBe(760)
    expect(normalizeContentMaxWidth(100)).toBe(320)
    expect(normalizeContentMaxWidth(99999)).toBe(4000)
    expect(normalizeContentMaxWidth('x')).toBe(760)
    expect(normalizeContentMaxWidth(undefined)).toBe(760)
  })
  it('单键校验器：-1 通过，其余夹紧', () => {
    const validate = CONFIG_WRITE_VALIDATORS['ui.contentMaxWidth']
    expect(validate(-1)).toBe(-1)
    expect(validate(500)).toBe(500)
    expect(validate(10)).toBe(320)
    expect(validate('nope')).toBeNaN()
  })
  it('归一化整包：contentMaxWidth 进 UiSettings 并带默认', () => {
    expect(normalizeUiSettings({}).contentMaxWidth).toBe(760)
    expect(normalizeUiSettings({ contentMaxWidth: -1 }).contentMaxWidth).toBe(-1)
  })
})

describe('ui.hoverActions (0.1.45 D1 动作行悬停显示)', () => {
  it('默认开；显式 false 才关（归一化与写通道一致）', () => {
    expect(normalizeUiSettings({}).hoverActions).toBe(true)
    expect(normalizeUiSettings({ hoverActions: false }).hoverActions).toBe(false)
    expect(normalizeUiSettings({ hoverActions: 'nope' as unknown }).hoverActions).toBe(true)
    const validate = CONFIG_WRITE_VALIDATORS['ui.hoverActions']
    expect(validate(true)).toBe(true)
    expect(validate(false)).toBe(false)
    expect(validate('nope')).toBeUndefined()
  })
})

describe('ui.messageContainment (0.1.52 消息块布局包含)', () => {
  it('默认开；显式 false 才关（归一化与写通道一致）', () => {
    expect(normalizeUiSettings({}).messageContainment).toBe(true)
    expect(normalizeUiSettings({ messageContainment: false }).messageContainment).toBe(false)
    expect(normalizeUiSettings({ messageContainment: 'nope' as unknown }).messageContainment).toBe(true)
    const validate = CONFIG_WRITE_VALIDATORS['ui.messageContainment']
    expect(validate(true)).toBe(true)
    expect(validate(false)).toBe(false)
    expect(validate('nope')).toBeUndefined()
  })
})
