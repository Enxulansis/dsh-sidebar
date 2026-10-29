import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type * as vscode from 'vscode'
import { FILE_TYPE_ICON_EXT, FILE_TYPE_ICON_DATA, FILE_TYPE_ICON_DEFAULT } from './file-type-icons.js'
import { parseAskRecord } from './ask-record.js'

function nonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let value = ''
  for (let index = 0; index < 32; index += 1) value += alphabet.charAt(Math.floor(Math.random() * alphabet.length))
  return value
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/* Image rasterization targets (G17): formats outside the dsh attachment protocol (png/jpeg/webp/gif)
   are converted to PNG in the webview. The rest decode natively in Chromium; tiff needs UTIF (vendored). */
export const RASTERIZABLE_TARGETS = [
  'image/svg+xml', 'image/bmp', 'image/vnd.microsoft.icon', 'image/x-icon', 'image/avif', 'image/tiff',
] as const
export type RasterizableMime = (typeof RASTERIZABLE_TARGETS)[number]

const EXT_TO_RASTER_MIME: Record<string, RasterizableMime> = {
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/vnd.microsoft.icon',
  avif: 'image/avif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
}

export function rasterizeTarget(name: string, mime: string | undefined): RasterizableMime | undefined {
  if (mime !== undefined && (RASTERIZABLE_TARGETS as readonly string[]).includes(mime)) return mime as RasterizableMime
  const dot = name.lastIndexOf('.')
  const ext = (dot >= 0 ? name.slice(dot + 1) : name).toLowerCase()
  return EXT_TO_RASTER_MIME[ext]
}

function vendoredImageCodecs(): string {
  return vendoredRead('pako.js') + vendoredRead('utif.js')
}
function vendoredRead(file: string): string {
  try {
    if (typeof __dirname === 'string') return readFileSync(join(__dirname, file), 'utf8')
  } catch { return '' }
  return ''
}
/* G15 (0.0.30): markdown pipeline (markdown-it + KaTeX + shiki/JS-engine).
 * ⚠️ HTML-script sanitize（0.0.32 根因修复）：vendor 内嵌含字面 `<!--`（markdown/html
 * grammar 字符串）——HTML parser 对 <script> 内 `<!--` 进入 escaped/double-escaped 状态，
 * 打乱后续 script 解析 → 主脚本 SyntaxError → UI 全死。消毒后值不变（URL/字符串/正则内
 * `\!`/`\/` 均为 identity escape）。 */
function vendoredMarkdown(): string {
  return vendoredRead('markdown-vendor.js')
    .replace(/<!--/g, '<\\!--')
    .replace(/<\/script/gi, '<\\/script')
}
/* KaTeX styles (0.0.34: fonts base64-embedded in the css) — nonce'd style channel. */
function vendoredMarkdownStyles(): string {
  return vendoredRead('katex-embedded.css')
}
/* G5 (0.0.39): 消息元信息格式函数（官方 message-chrome.ts 移植，浏览器语法=注入 + vitest 单一来源） */
function vendoredChrome(): string {
  return vendoredRead('webview-chrome.js')
}

/* G45（0.0.103）：颜色工具（设置台色板）——与 webview-chrome 同源同通道（注入 + vitest 直测）。 */
function vendoredColorUtils(): string {
  return vendoredRead('color-utils.js')
}

/* G50（0.0.109）：官方双语字典生成的「中文 → 英文原文」映射（hover 显示原文用；
   scripts/gen-original-text-map.mjs 生成，官方更新后可重跑）。 */
function vendoredOriginalTextMap(): string {
  return vendoredRead('original-text-map.js')
}

export function chatHtml(webview: vscode.Webview, deepseekMarkUri: vscode.Uri, mathjaxUri?: vscode.Uri): string {
  const token = nonce()
  const mark = escapeHtml(deepseekMarkUri.toString(true))
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!-- 0.0.36 修补 (字体): font-src 缺失时 CSP 回退 default-src 'none' → 全部 KaTeX data:
       字体被拦截 → 公式回退系统字体（数字=Times New Roman、字母=无衬线斜体）。必须显式放行。 -->
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: https:; style-src ${webview.cspSource} 'nonce-${token}'; script-src 'nonce-${token}'; font-src ${webview.cspSource} data:;">
  <style nonce="${token}">${vendoredMarkdownStyles()}
    /* 0.1.1 中文单字形脸：uv 只覆盖 CJK 码位——代码类元素里的中文回落到系统无衬线中文
       （与 UI 面正文一致），英文/数字仍走 --vscode-editor-font-family（用户编辑器字体）。
       修复"编辑器字体面中文=新宋体（monospace 泛型兜底）与正文中文观感冲突"（实测记 _reports/fonts-*.json）。 */
    @font-face {
      font-family: 'DSH CJK';
      src: local('Noto Sans SC'), local('Microsoft YaHei'), local('PingFang SC'), local('Microsoft JhengHei');
      unicode-range: U+2E80-9FFF, U+3000-303F, U+FF00-FFEF, U+20000-2FA1F;
    }
    :root { color-scheme: light dark; --editor-font: 'DSH CJK', var(--vscode-editor-font-family); }
    * { box-sizing: border-box; }
    /* Own the full webview viewport; VS Code otherwise adds 20px body gutters outside #scroll. */
    html, body { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: 13px/1.5 var(--vscode-font-family); }
    button, select, textarea, input { font: inherit; color: inherit; }
    button { cursor: pointer; }
    #app { width: 100%; height: 100%; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto; overflow: hidden; }
    .toolbar { min-width: 0; min-height: 38px; padding: 4px 8px 4px 12px; display: flex; align-items: center; gap: 6px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, transparent); }
    .session-select { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; font-weight: 600; text-overflow: ellipsis; }
    /* E1: horizontal conversation tab strip (replaces the session dropdown) */
    .session-tabs { min-width: 0; flex: 1; display: flex; gap: 4px; align-items: center; overflow-x: auto; padding-bottom: 1px; scrollbar-width: thin; scrollbar-color: rgba(199, 199, 199, .35) transparent; }
    .session-tabs::-webkit-scrollbar { height: 4px; }
    .session-tabs::-webkit-scrollbar-track { background: transparent; }
    .session-tabs::-webkit-scrollbar-thumb { background: rgba(199, 199, 199, .35); border-radius: 2px; }
    .session-tabs::-webkit-scrollbar-thumb:hover { background: rgba(199, 199, 199, .55); }
    .session-tabs::-webkit-scrollbar-button { display: none; }
    .session-tab { min-width: 0; max-width: 150px; flex: 0 0 auto; display: flex; align-items: center; gap: 2px; height: 26px; box-sizing: border-box; padding: 2px 2px 2px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--vscode-descriptionForeground); font-size: 12px; white-space: nowrap; overflow: hidden; }
    .session-tab:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
    .session-tab:disabled { cursor: default; opacity: .55; }
    .session-tab.active { background: color-mix(in srgb, var(--vscode-charts-blue) 16%, transparent); color: var(--vscode-foreground); font-weight: 600; }
    .session-tab .tab-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .tab-actions { display: flex; gap: 2px; flex: 0 0 0; width: 0; margin-left: auto; opacity: 0; pointer-events: none; transition: opacity .12s ease; }
    .session-tab:hover .tab-actions, .tab-actions:focus-within { opacity: 1; pointer-events: auto; flex: 0 0 auto; width: auto; }
    .tab-action { width: 22px; height: 22px; padding: 0; border: 0; border-radius: 4px; display: grid; place-items: center; background: transparent; color: var(--vscode-descriptionForeground); font-size: 13px; line-height: 1; }
    .tab-action:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
    .tab-action.danger:hover { background: rgba(255, 80, 80, .16); color: #f27777; }
    /* 0.0.167（B4 P1-5）: 标签栏就地搜索——搜索行独占工具栏一行（flex-basis 100%），
       原标签条留在下一行继续可见可点（过滤实时生效）。
       0.0.168（用户反馈）：边框对齐侧栏其它输入框（input-border → widget-border 回退，
       与设置面板/重命名弹窗同款；此前回退 transparent 在部分主题下与侧栏观感不一致）。 */
    .toolbar { flex-wrap: wrap; position: relative; }
    .tab-search { flex: 1 0 100%; order: -1; display: flex; align-items: center; gap: 6px; min-width: 0; }
    .tab-search-input { flex: 1; min-width: 0; height: 24px; padding: 0 8px; border: 1px solid var(--vscode-widget-border); border-radius: 6px; background: var(--vscode-editor-background); color: var(--vscode-foreground); outline: 0; }
    /* 0.0.173（用户原意）：搜索框观感对齐「附带文件」芯片（widget-border + editor-background + 6px 圆角）；
       聚焦环沿用 outline（改 border-color 会被圆角抗锯齿混色，采样偏暗）。 */
    .tab-search-input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    .tab-search-input::placeholder { color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground)); }
    .tab-search-count { flex: 0 0 auto; font-size: 11px; color: var(--vscode-descriptionForeground); }
    .tab-search-close { width: 22px; height: 22px; min-width: 22px; }
    .session-tab.tab-filtered { display: none; }
    /* 0.0.168（B4 反馈）: 内容命中结果面板（跨会话全文检索）——浮在工具栏下方。 */
    /* 0.1.73：面板本身**不裁剪**（覆盖层要能突破下边界）；滚动交给内层 .tab-search-hits。 */
    .tab-search-results { position: absolute; z-index: 30; top: calc(100% - 2px); left: 8px; right: 8px; padding: 4px; overflow: visible; border: 1px solid var(--vscode-widget-border, transparent); border-radius: 8px; background: var(--vscode-menu-background, var(--vscode-editor-background)); box-shadow: 0 6px 18px var(--vscode-widget-shadow, rgba(0, 0, 0, .35)); }
    .tab-search-hits { max-height: 280px; overflow-y: auto; }
    .tab-search-peek-layer { position: absolute; inset: 0; z-index: 8; pointer-events: none; overflow: visible; }
    .tab-search-hit { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 5px 8px; border: 0; border-radius: 6px; background: transparent; text-align: left; }
    .tab-search-hit:hover { background: var(--vscode-list-hoverBackground, var(--vscode-toolbar-hoverBackground)); }
    .tab-search-hit-title { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; font-weight: 600; }
    .tab-search-hit-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tab-search-hit-snippet { font-size: 11px; line-height: 1.45; min-height: calc(1.45em * 2); color: var(--vscode-descriptionForeground); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; }
    /* 0.1.72（用户拍板 + 调研结论）：悬停揭示的长片段**不参与文档流**——
       行高恒定 ⇒ 邻行永不被推挤（旧版行内展开会让指针从 A 往下走时"跳过 B"）。
       覆盖层不吃指针事件（pointer-events: none）⇒ 悬停判定只看行盒，上下移动都不会跳行；
       时序按 NN/g：进场/离场各留 ~160ms 宽限，扫过时不闪。 */
    .tab-search-hit { position: relative; }
    /* 0.1.96（用户拍板）：结果行等高——元信息行固定 16px（空着也占位）+ 摘要区保底两行。 */
    .tab-search-hit-title { min-height: 16px; }
    .tab-search-hit-time { margin-left: auto; flex: 0 0 auto; font-size: 10px; font-weight: 400; color: var(--vscode-descriptionForeground); }
    .tab-search-hit-active .tab-search-hit-snippet { color: var(--vscode-foreground); }
    /* 0.1.73（用户反馈①）：配色改用 VS Code 的 **hover widget** 令牌（比 menu 背景更亮/更暗，能一眼区分），
       加粗边框 + 更强阴影 + 左侧强调条；位置由 JS 给 top（一律向下浮出，不再回翻）。 */
    .tab-search-hit-peek { position: absolute; left: 0; right: 0; z-index: 8; padding: 6px 8px 6px 10px; border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-widget-border, rgba(128, 128, 128, .45))); border-left: 3px solid var(--vscode-focusBorder, var(--vscode-charts-blue, #4d6bfe)); border-radius: 6px; background: var(--vscode-editorHoverWidget-background, color-mix(in srgb, var(--vscode-foreground, #e0e0e0) 10%, var(--vscode-menu-background, #1f1f1f))); color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground)); box-shadow: 0 10px 28px rgba(0, 0, 0, .5); overflow: hidden; pointer-events: none; opacity: 0; transition: opacity .1s ease; }
    .tab-search-peek-layer.visible .tab-search-hit-peek { opacity: 1; }


    .tab-search-hit-peek .tab-search-hit-snippet { -webkit-line-clamp: 8; color: var(--vscode-foreground); }
    /* 0.1.76（T3-6）：跨会话返回胶囊（浮在会话顶部；12s 自动消失） */
    .search-return-pill { position: fixed; z-index: 40; left: 50%; transform: translateX(-50%); top: 10px; max-width: 88%; display: flex; align-items: center; gap: 2px; padding: 4px 4px 4px 10px; border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-widget-border, rgba(128, 128, 128, .45))); border-radius: 999px; background: var(--vscode-editorHoverWidget-background, var(--vscode-menu-background, #252526)); color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground)); box-shadow: 0 6px 18px rgba(0, 0, 0, .4); font-size: 12px; }
    /* 0.1.82：胶囊内两枚按钮——"返回"占满余宽（点击回会话），"✕"独立关闭。 */
    .search-return-pill-go { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 4px; border: 0; border-radius: 999px; background: transparent; color: inherit; font-size: 12px; text-align: left; cursor: pointer; }
    .search-return-pill-go:hover { background: var(--vscode-toolbar-hoverBackground); }
    .search-return-pill-close { flex: 0 0 auto; width: 18px; height: 18px; padding: 0; border: 0; border-radius: 999px; background: transparent; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 18px; cursor: pointer; }
    .search-return-pill-close:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
    .search-return-pill.hidden { display: none; }
    /* 0.1.76（T3-4/T3-5）：范围开关与历史条目 */
    .tab-search-scope { display: inline-flex; flex: 0 0 auto; gap: 2px; margin-right: 6px; }
    .tab-search-scope-btn { padding: 1px 6px; border: 1px solid color-mix(in srgb, var(--vscode-foreground) 25%, transparent); border-radius: 999px; background: transparent; color: var(--vscode-descriptionForeground); font-size: 10px; cursor: pointer; }
    .tab-search-scope-btn.active { background: var(--vscode-charts-blue, #4d6bfe); border-color: transparent; color: #ffffff; }
    .tab-search-history { display: flex; width: 100%; padding: 5px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--vscode-foreground); font-size: 12px; text-align: left; cursor: pointer; }
    .tab-search-history:hover { background: var(--vscode-list-hoverBackground, var(--vscode-toolbar-hoverBackground)); }
    /* 0.1.80（用户需求）：历史条目单条删除——行=外层胶囊（悬停底色统一），右侧 ✕ 默认隐形、行悬停/键盘聚焦才显形。 */
    .tab-search-history-row { display: flex; align-items: center; gap: 2px; border-radius: 6px; }
    .tab-search-history-row:hover { background: var(--vscode-list-hoverBackground, var(--vscode-toolbar-hoverBackground)); }
    .tab-search-history-row .tab-search-history { flex: 1 1 auto; min-width: 0; }
    .tab-search-history-row:hover .tab-search-history { background: transparent; }
    .tab-search-history-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tab-search-history-del { flex: 0 0 auto; width: 20px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 18px; cursor: pointer; visibility: hidden; }
    .tab-search-history-row:hover .tab-search-history-del, .tab-search-history-del:focus-visible { visibility: visible; }
    .tab-search-history-del:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
    .tab-search-history-clear { display: block; width: 100%; margin-top: 2px; padding: 4px 8px; border: 0; border-top: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent); background: transparent; color: var(--vscode-descriptionForeground); font-size: 11px; cursor: pointer; }
    /* 0.1.72：底部固定详情区（sticky 底）——列表完全不动，常驻 3 行高度显示当前悬停/选中项的长片段 */
    .tab-search-peek-pane { position: sticky; bottom: 0; margin-top: 4px; padding: 6px 8px; border-top: 1px solid color-mix(in srgb, var(--vscode-foreground) 15%, transparent); background: var(--vscode-menu-background, var(--vscode-editor-background)); }
    .tab-search-peek-pane.hidden { display: none; }
    .tab-search-peek-pane .tab-search-hit-snippet { -webkit-line-clamp: 3; color: var(--vscode-foreground); }
    /* 0.0.169：命中来源标注（当前会话 / 其他工作区）。
       0.0.170（用户反馈①）：分色 + 白字——此前灰字灰底对比度太差。 */
    .tab-search-tag { flex: 0 0 auto; display: inline-flex; align-items: center; height: 15px; padding: 0 5px; border-radius: 4px; font-size: 10px; font-weight: 600; line-height: 1; color: #ffffff; background: var(--vscode-charts-blue, #4d6bfe); }
    .tab-search-tag.tag-current { background: var(--vscode-charts-green, #3fa96b); }
    .tab-search-tag.tag-foreign { background: var(--vscode-charts-orange, #d18616); }
    .tab-search-tag.tag-subagent { background: var(--vscode-charts-purple, #b180d7); }
    .tab-search-tag.tag-trash { background: var(--vscode-charts-red, #e06c75); }
    /* S-1：索引命中的"其他会话"标签（低调灰，不与"当前会话"抢眼） */
    .tab-search-tag.tag-other { background: color-mix(in srgb, var(--vscode-foreground) 18%, transparent); color: var(--vscode-foreground); }
    /* S-2：折叠态小标（折叠中 / 未加载 / 未渲染） */
    .tab-search-fold { flex: 0 0 auto; height: 15px; display: inline-flex; align-items: center; padding: 0 4px; border-radius: 4px; font-size: 10px; line-height: 1; color: var(--vscode-descriptionForeground); border: 1px solid color-mix(in srgb, var(--vscode-foreground) 25%, transparent); }
    /* S-4：命中词高亮 */
    .tab-search-mark { background: color-mix(in srgb, var(--vscode-charts-yellow, #e2b93d) 45%, transparent); color: inherit; border-radius: 2px; padding: 0 1px; }
    /* 0.1.65（T3-1）：结果面板选中行（↑/↓ 键盘导航）——左侧强调条 + 底色，与 hover 区分开 */
    .tab-search-hit-active { background: var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground)); box-shadow: inset 2px 0 0 0 var(--vscode-focusBorder, var(--vscode-charts-blue, #4d6bfe)); }
    /* 0.1.65（T3-3）：同一来源里出现多次时的小标（0.1.66 起当前所处那条显示"第 k/N 处"） */
    .tab-search-hit-count { flex: 0 0 auto; font-size: 10px; font-weight: 600; color: var(--vscode-descriptionForeground); }
    /* 0.1.114（G55 轨道序号）：行内节点编号片「N/M」——恒在（行高不变），数据不可用时「—」灰虚线。 */
    .tab-search-node-chip { flex: 0 0 auto; height: 15px; display: inline-flex; align-items: center; padding: 0 6px; border-radius: 8px; font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1; color: var(--vscode-badge-foreground, #ffffff); background: var(--vscode-badge-background, #4d4d4d); border: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent); cursor: pointer; }
    .tab-search-node-chip:hover { background: color-mix(in srgb, var(--vscode-badge-background, #4d4d4d) 82%, var(--vscode-foreground, #cccccc)); }
    .tab-search-node-chip.empty { background: transparent; color: var(--vscode-descriptionForeground); border-style: dashed; font-weight: 400; cursor: default; }
    .tab-search-node-chip.empty:hover { background: transparent; }
    /* 0.1.66：滚动联动——当前落在视口里的那条（滚到哪、面板指到哪） */
    .tab-search-inview { flex: 0 0 auto; height: 15px; display: inline-flex; align-items: center; padding: 0 5px; border-radius: 4px; font-size: 10px; font-weight: 600; line-height: 1; color: #ffffff; background: var(--vscode-charts-purple, #b180d7); }
    /* 0.1.94（用户拍板「先区域、再时间」）：结果面板按会话分组——组头 = 会话标题 + 标签 + 条数 */
    .tab-search-group { display: flex; align-items: center; gap: 6px; min-width: 0; margin: 4px 2px 1px; padding: 2px 6px; border-radius: 4px; background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent); }
    .tab-search-group-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tab-search-group-count { flex: 0 0 auto; font-size: 10px; font-weight: 400; color: var(--vscode-descriptionForeground); }
    /* 0.1.65（T3-7）：上限与新鲜度脚注（常驻末行，弱化） */
    .tab-search-foot { border-top: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent); margin-top: 2px; font-size: 10px; opacity: .85; }
    /* 2026-09-25（用户报②）：会话内"命中词"高亮——CSS Custom Highlight API 的伪元素（不改 DOM）。 */
    /* 2026-09-25（用户需求）：高亮底色/前景都由 JS 按设置写入 CSS 变量；
       前景未设置时继承正文色（跟随主题档用半透明底，不扰正文色）；
       前景设置了（自选底色的对比度档）则覆盖高亮内的字色——WCAG 相对亮度阈值见 JS。 */
    ::highlight(dsh-search-match) { background-color: var(--search-hit-bg, color-mix(in srgb, var(--vscode-charts-yellow, #e2b93d) 55%, transparent)); color: var(--search-hit-fg, inherit); }
    /* S-4：段头计数 */
    .tab-search-count { color: var(--vscode-foreground); font-weight: 600; border-bottom: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent); }
    .tab-search-note { padding: 6px 8px; font-size: 11px; color: var(--vscode-descriptionForeground); }
    /* 0.0.168: 命中跳转高亮（2.6s 后自动移除 class）。 */
    .message.search-hit-flash { animation: dsh-search-hit 2.6s ease-out 1; }
    @keyframes dsh-search-hit { 0% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 60%, transparent); } 70% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 25%, transparent); } 100% { box-shadow: 0 0 0 3px transparent; } }
    /* G5 v9: 拖拽排序指示——落点 tab 左缘蓝色指示条（插入其前），源 tab 半透明 */
    .session-tab.drag-over { background: var(--vscode-toolbar-hoverBackground); box-shadow: inset 2px 0 0 0 var(--vscode-focusBorder); }
    .session-tab.drag-source { opacity: .45; }
    .session-tab .tab-run { display: none; flex: 0 0 auto; width: 12px; height: 12px; margin-right: 1px; }
    .session-tab.running .tab-run { display: block; }
    .icon-button { width: 28px; height: 28px; min-width: 28px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--vscode-icon-foreground); }
    .icon-button:hover { background: var(--vscode-toolbar-hoverBackground); }
    .include-context.active { color: var(--vscode-charts-blue, #4d6bfe); }
    .github-star:hover { color: var(--vscode-charts-yellow, #e3b341); }
    .jobs-control { position: relative; flex: 0 0 auto; }
    .jobs-trigger { width: auto; min-width: 28px; padding: 0 7px; display: flex; gap: 5px; font-size: 11px; }
    .jobs-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-descriptionForeground); }
    .jobs-trigger.live .jobs-dot { background: var(--vscode-charts-blue, #4d6bfe); box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 20%, transparent); }
    .jobs-menu { position: absolute; z-index: 20; top: calc(100% + 5px); right: 0; width: min(340px, calc(100vw - 20px)); max-height: min(420px, 70vh); padding: 6px; overflow: auto; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: var(--vscode-menu-background, var(--vscode-editor-background)); box-shadow: 0 5px 18px var(--vscode-widget-shadow); }
    .jobs-title { padding: 5px 7px 7px; font-size: 11px; font-weight: 600; }
    .job-row { min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 2px 7px; padding: 7px; border-radius: 6px; }
    .job-row + .job-row { border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border) 50%, transparent); }
    .job-kind { grid-row: 1 / 3; align-self: start; padding: 1px 5px; border-radius: 999px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-size: 9px; text-transform: uppercase; }
    .job-label { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 11px; font-weight: 600; }
    .job-status { color: var(--vscode-descriptionForeground); font-size: 10px; }
    .job-detail { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--vscode-descriptionForeground); font-size: 10px; }
    .job-duration { grid-column: 3; grid-row: 1 / 3; align-self: center; color: var(--vscode-descriptionForeground); font: 10px var(--editor-font); }
    .icon-button:focus-visible, select:focus-visible, input:focus-visible, button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    /* 0.0.163（用户反馈·颜色/边缘审查首条）：焦点环只在 **Tab 导航**时出现。
       Chromium 在"鼠标点击按钮 → 随后按键盘（如 Esc 关设置面板）"时会把仍持焦的按钮重判为
       :focus-visible → 指针操作后残留一圈蓝边（用户实测：关设置面板时齿轮带蓝环）。
       body[data-input] 由输入设备追踪写入（pointerdown→pointer / Tab→keyboard）——
       本选择器 (0,2,1) 压过上方 (0,2,0) 规则；键盘用户 Tab 到元素时行为不变。 */
    body[data-input="pointer"] :focus-visible:not(input):not(textarea):not(select) { outline: none; }
    .composer:focus-within { border-color: var(--vscode-charts-blue, #4d6bfe); box-shadow: 0 0 0 1px var(--vscode-charts-blue, #4d6bfe), 0 2px 10px color-mix(in srgb, var(--vscode-widget-shadow) 75%, transparent); transition: border-color .12s ease, box-shadow .12s ease; }
    .composer textarea:focus, .composer textarea:focus-visible, .composer-row select:focus, .composer-row select:focus-visible { outline: none; }
    svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
    /* G41 修复（0.0.99）: 导轨显式落位 row2 后，自动排布会把 main/footer 挤到 row3/row4、
       row2（1fr）塌成 0 → 导轨 20px 高、节点被 flex 压成 0 高（DOM 在、像素不可见）。
       main/footer 必须显式落位，不得依赖自动排布与显式落位项共存。 */
    .scroll { grid-column: 1; grid-row: 2; min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto; overflow-anchor: none; scrollbar-color: var(--vscode-scrollbarSlider-background) transparent; }
    .restore-status { grid-column: 1; grid-row: 2; align-self: start; justify-self: center; z-index: 8; margin: 8px 24px; max-width: calc(100% - 48px); display: flex; align-items: center; gap: 10px; padding: 7px 10px; border: 1px solid color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, var(--vscode-widget-border)); border-radius: 8px; background: var(--vscode-editor-background); font-size: 12px; pointer-events: none; }
    .restore-status-text { min-width: 0; }
    .restore-status button { flex: 0 0 auto; pointer-events: auto; }
    .history-jump-status { flex-wrap: wrap; }
    .history-jump-status .restore-status-text { flex: 1 1 160px; }
    /* G29 (0.0.54): overflow:hidden 会成为内部 sticky 的"最近滚动容器"（自身不滚 → 钉不住）；
       clip 视觉裁剪相同但不建立滚动容器 → .msg-fold-toggle 相对 #scroll 钉住（CDP A/B 实证）。 */
    .conversation { width: 100%; min-width: 0; max-width: var(--content-max, 760px); margin: 0 auto; padding: 12px 14px 30px; overflow: clip; }
    /* G41（0.0.98）: 轮次导航条——与 #scroll 同占一格（grid 重叠，免绝对定位）；节点=轮，点击跳转
       节点区留出右侧 14px（不压滚动条）；容器不吃指针事件，仅节点可点。 */
    /* G41 v1.1（0.0.100）: 节点带与右侧滚动条融合（14px 带内、绝对定位等分 k/(n+1)）；
       节=12px 透明命中带（内容区绘出 4/5px 视觉条，background-clip:content-box）；top% 由 buildTurnRail 写入。 */
    /* 0.0.124（G52 方案 B）：轨道＝固定间距的可滚动清单（仿 AI Studio）——节点不按序号/内容拉伸，
       轨道自身可滚（滚动条隐藏）；内容滚动时把当前轮带入视口（手动滚动暂停跟随）。 */
    /* 0.0.131：轨道带 26 → 18px、节点右移、滑块贴右缘（用户实测：元素离右缘太远、正文被无谓缩窄）。
       滑块置于节点之下（z-index）——药丸可压在滑块上画，拖拽在节点间隙/底垫区仍可抓。 */
    .turn-rail { grid-column: 1; grid-row: 2; justify-self: end; align-self: stretch; z-index: 9; width: 18px; position: relative; pointer-events: none; }
    .turn-rail.hidden { display: none; }
    .turn-rail-prepare { display: none; position: absolute; top: 10px; right: 0; width: 18px; padding: 0; border: 0; background: none; color: var(--vscode-descriptionForeground); pointer-events: auto; }
    .turn-rail.preparing .turn-rail-prepare { display: block; }
    .turn-rail.preparing .turn-rail-clip, .turn-rail.preparing .turn-rail-wheel { visibility: hidden; pointer-events: none; }
    /* G41 v1.3（0.0.102）: 纵向药丸——节=10×12（当前段 12×14 蓝）、悬浮光晕=14×16，三者严格同心。
       0.0.128：轨道改为「绝对定位 + 映射布局」（比例间距/铺满或自滚，见 layoutTurnRail）——
       节点居中列，自绘滑块贴最右列（原生滚动条原位），水平分离不抢点击；原生滚条互斥隐藏。 */
    .turn-rail-clip { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; scrollbar-width: none; pointer-events: none; z-index: 1; }
    .turn-rail-clip::-webkit-scrollbar { width: 0; height: 0; display: none; }
    .turn-rail-size { width: 1px; }
    /* 0.0.133：药丸再右移（右缘 5→2px）、命中盒收到药丸级（12px）；滑块加宽到 8px 并置于节点**之下**
       （z-index 1 < 2）——药丸浮在滑块"轨道"上呈 aistudio 观感；拖拽不再依赖层级（见下方整列拖拽）。 */
    /* 0.1.129（用户实测"加载瞬间滑块/轨道跳动"）：节点 top 仅随**布局重排**变（滚动走 scrollTop，
       不写 top）——加短过渡让重排整体"滑过去"，不闪跳。 */
    .turn-rail-node { pointer-events: auto; position: absolute; left: 5px; width: 12px; height: 16px; margin-top: -8px; cursor: pointer; z-index: 2; transition: top .26s linear; }
    .turn-rail.restoring .turn-rail-node { transition: none; }
    .turn-rail-node::before { content: ''; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 14px; height: 16px; border-radius: 8px; background: var(--vscode-descriptionForeground, #9d9d9d); opacity: 0; }
    .turn-rail-node::after { content: ''; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 10px; height: 12px; border-radius: 6px; background: var(--vscode-descriptionForeground, #9d9d9d); opacity: .55; transition: opacity .1s ease, width .1s ease, height .1s ease; }
    .turn-rail-node:hover::before { opacity: .12; }
    .turn-rail-node:hover::after { opacity: .9; }
    .turn-rail-node.active::after { background: var(--vscode-charts-blue, #4d6bfe); opacity: 1; width: 12px; height: 14px; }
    /* 0.0.151（用户反馈）：③ 停点节点=**紫色圆角菱形**；0.0.151b（用户复测两条）：
       ① 用**正方形**旋转（此前 10×12 矩形转 45°=长短边不等）；② 缩到 9×9（矩形版旋转外接
       15.6px 偏宽）且**激活态单独限尺寸**（.active 的 12×14 旋转外接 18.4px 会压到轨道边界）；
       形状=停点身份；颜色=状态（--rail-mark-color / --rail-stop-color，updateTurnRail 写入）。
       0.0.155（用户反馈）：**未激活的金/紫节点与常规节点同款半透明**（.55）——此前它们恒全亮、
       只靠大小差区分，观感不够；激活态（.active 或 .stop.active）恢复全亮（opacity 1）。 */
    .turn-rail-node.stop::after { background: var(--rail-stop-color, var(--vscode-charts-purple, #b180d7)); border-radius: 2px; width: 9px; height: 9px; transform: translate(-50%, -50%) rotate(45deg); }
    .turn-rail-node.stop.active::after { width: 10px; height: 10px; opacity: 1; }
    .turn-rail-node.marked:not(.active)::after { background: var(--rail-mark-color, var(--vscode-charts-yellow, #e3b341)); }
    .turn-rail-node.marked.active::after { background: var(--rail-mark-color, var(--vscode-charts-yellow, #e3b341)); }
    /* 0.1.114（G55 Phase 2）：编号片跳转落点脉冲——光晕 ::before 扩散一圈后消失（不改节点本体状态）。 */
    .turn-rail-node.pulse::before { animation: rail-node-pulse 1s ease-out; }
    @keyframes rail-node-pulse { 0% { opacity: .5; box-shadow: 0 0 0 0 color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 85%, transparent); } 100% { opacity: 0; box-shadow: 0 0 0 16px transparent; } }
    /* 0.0.128：自绘滑块（最右列=原生滚条原位）。顶端=当前阅读位置在节点空间里的映射（必落在当前段两端节点之间），
       拖动=逆映射连续滚动；滚轮在其上方时上下浏览节点列（见 wheel 监听）。 */
    /* 0.0.133：滑块 8px（用户：可稍微宽一点）+ 边缘触发空间（整列按下即拖，见 mousedown 逻辑）。 */
    /* 0.0.134：right 2→3px——滑块中心与药丸中心**重合**（同为距边 7px，用户观感要求）。 */
    .turn-rail-thumb { position: absolute; right: 3px; width: 8px; z-index: 1; border-radius: 4px; background: rgba(125, 145, 255, .32); border: 1px solid rgba(150, 170, 255, .55); pointer-events: auto; cursor: grab; }
    .turn-rail-thumb.dragging { cursor: grabbing; background: rgba(125, 145, 255, .55); }
    /* 整列连续接收滚轮；位于 clip 之下，保留节点/滑块的点击及拖拽命中优先级。 */
    .turn-rail-wheel { position: absolute; inset: 0; pointer-events: auto; z-index: 0; }
    /* 0.1.114（G55 轨道序号）：滚动静息徽标「N/M」——贴轨道左缘（右侧 100%+6px 落在对话右缘），
       固定 20px 高免测量（禁每帧强制布局）；top 由 JS 写入（滑块中心或指针），translateY(-50%) 对齐。 */
    .rail-badge { position: absolute; right: calc(100% + 6px); top: 0; height: 20px; line-height: 20px; padding: 0 8px; border-radius: 999px; background: var(--vscode-editorWidget-background, #1f1f1f); color: var(--vscode-editorWidget-foreground, #e8e8e8); border: 1px solid var(--vscode-widget-border, #4a4a52); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; opacity: 0; transform: translateY(-50%); transition: opacity .15s ease; pointer-events: none; z-index: 3; }
    .rail-badge.show { opacity: 1; }
    /* 0.1.120（G55 复测反馈②）：节点悬停提示**自绘**——替代原生 title（浏览器延迟约 1s，用户实测"浮出不够快"）。
       固定单行（免测量）；贴轨道左缘；与徽标互斥（悬停节点=本提示 / 悬停空隙=徽标，不叠同一位置）。 */
    .rail-tip { position: absolute; right: calc(100% + 6px); height: 22px; line-height: 22px; padding: 0 8px; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-radius: 6px; background: var(--vscode-menu-background, var(--vscode-editor-background)); color: var(--vscode-menu-foreground, var(--vscode-foreground)); border: 1px solid var(--vscode-widget-border, #4a4a52); box-shadow: 0 5px 16px var(--vscode-widget-shadow, rgba(0, 0, 0, .4)); font-size: 11px; pointer-events: none; z-index: 4; }
    /* 0.1.122（G55 内容设置）：提示两行档——高度不定（显示时量一次定位），其余档仍固定单行。 */
    .rail-tip.two-line { height: auto; max-height: 40px; line-height: 16px; padding: 4px 8px; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .rail-tip.hidden { display: none; }
    /* 0.0.128：自定义滚动条模式 → 隐藏 #scroll 原生滚动条（与轨道互斥）；0.0.129：内容右侧留出轨道宽度
       ——否则窄面板下节点药丸会压在消息气泡右缘上（用户实测反馈；宽面板因 max-width 居中不受影响）。 */
    .scroll.scrollbar-hidden { scrollbar-width: none; }
    .scroll.scrollbar-hidden::-webkit-scrollbar { width: 0; height: 0; display: none; }
    /* 0.0.133：正文右缩 19 → 15px——药丸/滑块再右移后回收的留白还给文字（脚本量测保证净空 ≥3px）。 */
    .scroll.scrollbar-hidden .conversation { padding-right: 15px; }
    .conversation-slot, .messages { display: contents; }
    .history-loader { display: flex; justify-content: center; padding: 1px 0 9px; }
    .history-button { padding: 3px 9px; border: 0; border-radius: 6px; color: var(--vscode-textLink-foreground); background: transparent; font-size: 11px; }
    .history-button:hover { background: var(--vscode-toolbar-hoverBackground); }
    .empty { min-height: 55vh; display: grid; place-content: center; justify-items: center; text-align: center; padding: 28px 10px; }
    .boot-placeholder { min-height: 55vh; display: grid; place-content: center; justify-items: center; gap: 12px; }
    .boot-placeholder.hidden { display: none; }
    .boot-logo { width: 38px; height: 38px; animation: a7-boot-pulse 1.6s ease-in-out infinite; }
    .boot-dots { display: inline-flex; gap: 3px; margin-left: 4px; }
    .boot-dots i { width: 4px; height: 4px; border-radius: 50%; background: currentColor; opacity: .5; }
    /* 连接很快时不闪动（动画 0.4s 后才起，避免"看着更慢"的观感）；慢连接才出现呼吸点。 */
    @media (prefers-reduced-motion: no-preference) { .boot-dots i { animation: a7-dot-bounce 1.2s ease-in-out infinite; animation-delay: .4s; } .boot-dots i:nth-child(2) { animation-delay: .55s; } .boot-dots i:nth-child(3) { animation-delay: .7s; } }
    .boot-text { color: var(--vscode-descriptionForeground); font-size: 12px; }
    @keyframes a7-boot-pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
    .deepseek-mark { background-color: #4d6bfe; -webkit-mask: url("${mark}") center / contain no-repeat; mask: url("${mark}") center / contain no-repeat; }
    .empty-logo { width: 38px; height: 38px; margin-bottom: 13px; }
    .empty h2 { margin: 0 0 7px; font-size: 15px; font-weight: 600; }
    .empty p { max-width: 280px; margin: 0; color: var(--vscode-descriptionForeground); }
    .empty-hints { margin-top: 12px; font-size: 11px; color: var(--vscode-descriptionForeground); opacity: .8; }
    /* G5 0.0.39 fix: 时钟药丸 hover 面板向上溢出消息框——overflow:hidden 会被整体裁剪（面板不可见）；
       visible 后内容本身不横向溢出（table-wrap 自带 overflow-x:auto），改为 visible 无回归 */
    .message { width: 100%; min-width: 0; padding: 8px 0 16px; overflow: visible; }
    /* 0.1.51（CV 离屏不排版）：默认开，设置台「性能」区可关。
       实测（2261 消息夹具，两轮）：冷缓存首轮 layout −67~78%、打开墙钟 −33%、最长长任务 134→0~69ms；
       **scrollHeight 与轨道点位摘要逐值不变** ⇒ 收益主要来自布局包含（containment）而非占位跳过。
       只看 #messages 直接子级（=消息块），不动内部结构（折叠/懒建逻辑不受影响）。 */
    .cv-offscreen #messages > .message { contain: content; }
    .message + .message { margin-top: 8px; }
    .message-head { min-width: 0; display: flex; align-items: center; gap: 8px; margin-bottom: 7px; font-size: 12px; font-weight: 600; }
    .avatar { width: 21px; height: 21px; flex: 0 0 21px; display: grid; place-items: center; border-radius: 50%; background: color-mix(in srgb, #4d6bfe 78%, var(--vscode-editor-background)); color: white; font-size: 10px; }
    .assistant .avatar { border-radius: 0; background-color: #4d6bfe; }
    .message-body { width: 100%; min-width: 0; max-width: 100%; overflow-wrap: anywhere; word-break: break-word; font-size: 13px; line-height: 1.65; }
    .assistant .message-body { padding-left: 29px; }
    .message.user { display: flex; flex-direction: column; align-items: flex-end; padding-top: 6px; }
    .user .message-head { display: none; }
    /* G5 (0.0.39): 消息尾部 IconActions 行（时间 / 复制 / 时钟药丸），仿官方 web 尾部形态 */
    .message-actions { min-width: 0; margin-top: 5px; display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--vscode-descriptionForeground); }
    /* D1（0.1.46 修订）：悬停浮出的按钮组**行内接在时间右侧**（原绝对定位版会压住时间——用户实测反馈）。
       行内排布 ⇒ 不遮挡、不改变行高（正文高度不动）；关掉 ui.hoverActions 时整段失效，回到常显整行。 */
    body[data-hover-actions="on"] .hover-actions { display: inline-flex; align-items: center; gap: 3px; margin-left: 2px; }
    /* 静止行按"含按钮"的行高预留——否则悬停时按钮（20px）会把行撑高 4px ⇒ 下方内容抖一下。 */
    body[data-hover-actions="on"] .message-actions-stamp { min-height: 20px; }
    .user .message-actions { justify-content: flex-end; }
    .assistant .message-actions { padding-left: 29px; }
    .msg-action { width: 20px; height: 20px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 4px; background: transparent; color: var(--vscode-descriptionForeground); }
    .msg-action:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
    .msg-action svg { width: 13px; height: 13px; }
    .msg-clock { position: relative; padding: 1px 6px 1px 4px; display: inline-flex; align-items: center; gap: 3px; border: 1px solid var(--vscode-widget-border); border-radius: 6px; color: var(--vscode-descriptionForeground); cursor: default; }
    .msg-clock svg { width: 11px; height: 11px; }
    .msg-clock:hover, .msg-clock:focus-within { border-color: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, var(--vscode-widget-border)); }
    .msg-clock-panel { position: absolute; z-index: 30; left: 0; bottom: calc(100% + 8px); width: max-content; max-width: 240px; padding: 7px 9px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; color: var(--vscode-foreground); background: var(--vscode-menu-background); box-shadow: 0 7px 22px var(--vscode-widget-shadow); font-size: 11px; line-height: 17px; white-space: nowrap; display: none; }
    .msg-clock:hover .msg-clock-panel, .msg-clock:focus-within .msg-clock-panel { display: block; }
    .user .message-body { width: fit-content; max-width: 82%; margin-left: auto; padding: 8px 12px; white-space: pre-wrap; border-radius: 12px; background: color-mix(in srgb, var(--vscode-foreground) 8%, var(--vscode-editor-background)); }
    /* C7: thumbnail cards mounted under the message text (user schematic) */
    /* G22: .message-files 独立容器，免受 syncImageCards 清扫 */
    .message-images, .message-files { width: 100%; display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .user .message-images, .user .message-files { justify-content: flex-end; }
    /* G29 (0.0.54): 用户消息自动折叠——.msg-row 是 [折叠按钮 | 气泡] 的 flex 行（按钮居左侧空白栏，
       不占气泡内高度）；.msg-text 为裁切宿主（附件不受裁切）；按钮 sticky 钉住（依赖 .conversation overflow:clip）。
       渐隐用 mask-image（不依赖气泡动态底色）。G6 设置台：--msg-fold-lines 由 foldCfg().previewLines 驱动。 */
    .user .msg-row { display: flex; align-items: flex-start; width: 100%; min-width: 0; }
    .message.user .msg-text { min-width: 0; }
    .message.user.msg-folded .msg-text {
      max-height: calc(var(--msg-fold-lines, 4) * 1.65em);
      overflow: hidden;
      -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent);
      mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent);
    }
    /* G29 round2 (0.0.55): 按钮改顶挂——自然位=气泡左上（展开不改变气泡顶部 → 点击零位移）；
       向下滚动时气泡顶划过视口顶 → 自动钉在视口顶部常驻（替代此前的 bottom 钉底跳跃）。 */
    .msg-fold-toggle { position: sticky; z-index: 3; top: 8px; flex: 0 0 auto; display: inline-flex; align-items: center; gap: 3px; margin-right: 6px; padding: 2px 9px 2px 8px; border: 1px solid var(--vscode-widget-border); border-radius: 999px; background: var(--vscode-sideBar-background); color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 16px; cursor: pointer; box-shadow: 0 1px 5px rgba(0, 0, 0, .35); }
    .msg-fold-toggle:hover { color: var(--vscode-foreground); border-color: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, var(--vscode-widget-border)); }
    .msg-fold-toggle svg { width: 10px; height: 10px; }
    .msg-fold-toggle .fold-label { min-width: 0; overflow: hidden; white-space: nowrap; }
    /* G49（0.0.119）：AI 工作段折叠——过程节点隐藏须压过 message/tool/command 各自 display 作者样式。 */
    .work-folded[hidden] { display: none; }
    /* 0.0.131：过程卡头（用户拍板 C）——原样式 11px 灰字透明底，默认主题下"要盯才看得见"。
       弱底 + 下边线 + 整行 hover + 前景色 + 步数/用时摘要。 */
    .work-fold-bar { display: block; width: 100%; margin: 6px 0 4px; padding: 4px 9px; border: 0; border-bottom: 1px solid color-mix(in srgb, var(--vscode-foreground) 20%, transparent); border-radius: 4px 4px 0 0; background: color-mix(in srgb, var(--vscode-foreground) 7%, transparent); color: var(--vscode-foreground); font-size: 12px; line-height: 18px; text-align: left; cursor: pointer; }
    .work-fold-bar:hover { background: color-mix(in srgb, var(--vscode-foreground) 13%, transparent); }
    /* 0.0.131（用户反馈⑤）：留痕卡（提问记录 / 审批决定）——左色条区分类型，答案用胶囊。 */
    .ask-record, .decision-card { margin: 6px 0; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--vscode-foreground) 16%, transparent); border-left: 3px solid var(--vscode-charts-blue, #4d6bfe); border-radius: 6px; background: color-mix(in srgb, var(--vscode-foreground) 4%, transparent); font-size: 12px; line-height: 18px; }
    .decision-card { border-left-color: var(--vscode-charts-green, #3fb950); }
    .decision-card.rejected { border-left-color: var(--vscode-errorForeground, #f85149); }
    .record-head { display: flex; align-items: center; gap: 8px; }
    .record-title { font-weight: 600; color: var(--vscode-foreground); }
    .record-summary, .record-time { color: var(--vscode-descriptionForeground); }
    .record-time { margin-left: auto; }
    .ask-record-item { margin-top: 6px; }
    .ask-record-question { color: var(--vscode-descriptionForeground); }
    .ask-record-answers { margin-top: 2px; display: flex; flex-wrap: wrap; gap: 4px; }
    .ask-record-answer { padding: 1px 8px; border-radius: 999px; background: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 18%, transparent); color: var(--vscode-foreground); }
    .ask-record-skipped { color: var(--vscode-descriptionForeground); }
    .decision-reason { margin-top: 4px; color: var(--vscode-descriptionForeground); white-space: pre-wrap; word-break: break-word; }
    /* G29 F2：折叠态附件紧凑化（96px 卡 → 40px 图标卡；名称/体积隐藏，展开还原） */
    .message.user.msg-folded .image-card,
    .message.user.msg-folded .image-card-status,
    .message.user.msg-folded .file-card { width: 40px; height: 40px; flex: 0 0 40px; border-radius: 6px; }
    .message.user.msg-folded .image-card-status,
    .message.user.msg-folded .file-card { padding: 3px; gap: 0; }
    .message.user.msg-folded .card-name,
    .message.user.msg-folded .card-caption { display: none; }
    .message.user.msg-folded .card-badge-img { width: 26px; height: 26px; }
    .image-card { width: 96px; height: 96px; flex: 0 0 96px; padding: 0; display: block; border: 0; border-radius: 8px; overflow: hidden; background: var(--vscode-editor-background); }
    .image-card img { width: 100%; height: 100%; display: block; object-fit: cover; }
    .image-card-status, .file-card { width: 96px; height: 96px; flex: 0 0 96px; padding: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; border: 1px dashed var(--vscode-widget-border); border-radius: 8px; color: var(--vscode-descriptionForeground); text-align: center; overflow: hidden; }
    .image-card-status.failed { color: var(--vscode-errorForeground); }
    .file-card { border-style: solid; background: color-mix(in srgb, var(--vscode-editor-background) 72%, transparent); cursor: pointer; }
    /* 0.0.55（反馈⑤四次）: hover 色**统一取草稿栏文件 chip 的 hover 色**（.chip-file:hover 的
       charts-blue 45% 混色）——此前用 --vscode-focusBorder，与文件 chip 存在色差（用户实测）。
       图片卡无边框 → 用 outline（画在内容之上并跟随圆角）；上一版 inset box-shadow 会被 <img>
       完全盖住 → 用户实测"jpg 没有 hover"。气泡内文件卡同色。
       0.0.63（反馈③）: 全仓 hover 蓝线统一到本混色——补上历史漏网两处（.msg-clock / .msg-fold-toggle，
       参见各自规则）；settings-step 同色。 */
    .file-card:hover { border-color: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, var(--vscode-widget-border)); }
    .image-card:hover { outline: 1px solid color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, var(--vscode-widget-border)); outline-offset: -1px; }
    /* 草稿图片 chip 本身有 1px 边框 → 与文件 chip 同款：hover 只换边框颜色（范围=整个 chip）。 */
    .attachment-chip:hover { border-color: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, var(--vscode-widget-border)); }
    /* G22 降级态（文件已删除/越界）：灰化 + 斜体，不可点（div + pointer-events 关闭） */
    .file-card.expired { pointer-events: none; opacity: .5; filter: grayscale(1); }
    .file-card.expired .card-name, .file-card.expired .card-caption { font-style: italic; }
    .card-badge { padding: 0 2px; color: inherit; display: inline-flex; align-items: center; }
    .card-badge-img { display: block; width: 32px; height: 32px; }
    .card-name { min-width: 0; max-width: 100%; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: normal; word-break: break-word; font-size: 10px; line-height: 1.3; color: var(--vscode-foreground); }
    .card-caption { font-size: 9px; }
    .pending-steering { opacity: .82; }
    /* 0.1.10：全中文（G46 走查口径）+ 说明"何时被看到"。 */
    .pending-steering .message-body::after { content: '已插话 · 将在下一步被 AI 看到'; display: block; margin-top: 3px; color: var(--vscode-descriptionForeground); font-size: 10px; }
    .markdown > :first-child { margin-top: 0; }
    .markdown > :last-child { margin-bottom: 0; }
    .streaming-plain { white-space: pre-wrap; overflow-wrap: anywhere; }
    /* 0.0.37 (批次 2): 单条消息渲染失败的可见提示 */
    .render-failed-note { color: var(--vscode-errorForeground, #f48771); font-size: 12px; margin-bottom: 4px; }
    .markdown p { margin: 0 0 9px; }
    .markdown h1, .markdown h2, .markdown h3 { margin: 14px 0 7px; line-height: 1.3; }
    .markdown h1 { font-size: 17px; } .markdown h2 { font-size: 15px; } .markdown h3 { font-size: 13px; }
    .markdown ul, .markdown ol { margin: 5px 0 10px; padding-left: 22px; }
    .markdown blockquote { margin: 8px 0; padding: 2px 10px; border-left: 2px solid var(--vscode-textBlockQuote-border); color: var(--vscode-descriptionForeground); background: var(--vscode-textBlockQuote-background); }
    .markdown .table-wrap { margin: 8px 0 12px; overflow-x: auto; }
    .markdown table { border-collapse: collapse; border-spacing: 0; width: 100%; font-size: 12px; }
    .markdown th, .markdown td { border: 1px solid var(--vscode-panel-border); padding: 4px 8px; text-align: left; vertical-align: top; }
    /* 0.1.19（用户实测）：表头不再 nowrap——长表头（如"MET 数值影响"）在窄侧栏里压不进列会
       溢出到邻格；改可换行。单元格加 overflow-wrap:anywhere 让长 URL/长串在列内断开。 */
    .markdown th { background: var(--vscode-textBlockQuote-background, transparent); font-weight: 600; }
    .markdown th, .markdown td { overflow-wrap: anywhere; }
    /* G15 (0.0.30): GFM/math/code additions — h4-h6, strikethrough, task lists,
       math spans and shiki token lines (colors are inline per token). */
    .markdown h4, .markdown h5, .markdown h6 { margin: 12px 0 6px; line-height: 1.3; }
    .markdown h4 { font-size: 12.5px; } .markdown h5 { font-size: 12px; } .markdown h6 { font-size: 11.5px; color: var(--vscode-descriptionForeground); }
    .markdown s { color: var(--vscode-descriptionForeground); text-decoration: line-through; }
    .markdown li.task-list-item { list-style: none; margin-left: -4px; }
    /* G27 (0.0.40) 空行修复: markdown-it 渲染列表项为 li>p，全局 p margin-bottom 9px
       + margin collapse 使每项底部多出 9px（用户实测"列表项多余空行"，根因已确证） */
    .markdown li > p { margin-bottom: 0; }
    /* 0.0.37 修补 (用户反馈): 原生 checkbox 勾选/未勾选对比不足——改自绘:
       未勾选=2px 边框圆角方形；勾选=蓝底 + 白色对勾（background data SVG，img-src data: 已放行）。 */
    .markdown li.task-list-item input[type=checkbox] { appearance: none; -webkit-appearance: none; width: 15px; height: 15px; margin-right: 7px; vertical-align: -5px; border: 2px solid var(--vscode-checkbox-border, #8c8c8c); border-radius: 4px; background-color: transparent; background-repeat: no-repeat; background-position: center; background-size: 11px; cursor: default; }
    .markdown li.task-list-item input[type=checkbox]:checked { border-color: var(--vscode-charts-blue, #4d6bfe); background-color: var(--vscode-charts-blue, #4d6bfe); background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.5l3 3 6-7' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); }
    .markdown .math { white-space: nowrap; }
    /* G27 (0.0.40): 复制按钮——absolute 不参与文档流（无布局跳动），hover 浮现；流式期间隐藏（分片取源可能截断）。
       G27 round2 (0.0.41): ① 行内公式改点击即复制（不再按钮）；②③④ li/blockquote 按钮移右下角防叠。 */
    .markdown p, .markdown li, .markdown ul, .markdown ol, .markdown blockquote,
    .markdown h1, .markdown h2, .markdown h3, .markdown h4, .markdown h5, .markdown h6,
    .markdown pre, .markdown .table-wrap, .markdown span.math { position: relative; }
    /* G27 (0.0.47): 块级按钮容器——复制按钮 +（超高块）折叠按钮统一进 .block-actions
       （absolute 右上 flex 行，默认隐藏、宿主 hover 统一浮现），替代 0.0.40 起逐类宿主
       挂 .copy-block 的选择器清单（G6 新增"复制纯文本"等按钮零选择器改动）；流式期间隐藏。
       G27 round2 (0.0.48): 胶囊背景（widget 色不透明 + 细边框）——块内第一行过长/横向滚动
       的文字穿过按钮区时被胶囊遮住，按钮永远可念可点（用户反馈①补充场景）。 */
    .block-actions { display: none; position: absolute; top: 2px; right: 2px; z-index: 2; align-items: center; flex-direction: row; gap: 2px; padding: 2px; border: 1px solid var(--vscode-widget-border, transparent); border-radius: 4px; background: var(--vscode-widget-background, var(--vscode-sideBar-background, #252526)); box-shadow: 0 1px 3px rgba(0, 0, 0, .25); }
    .block-actions > .copy-block, .block-actions > .fold-block { position: static; display: inline-flex; width: 16px; height: 16px; padding: 0; margin: 0; border: none; border-radius: 4px; color: inherit; background: transparent; opacity: .55; cursor: pointer; align-items: center; justify-content: center; }
    .block-actions > .copy-block:hover, .block-actions > .fold-block:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.18)); }
    /* 定位沿袭 0.0.40/0.0.45/0.0.46：普通 li 按钮在底部（.block-actions 容器底部）；
       嵌套子列表 li/引用块/代码块/表格统一贴块首行右上。
       G27 round2 (0.0.49): 段落/标题按钮贴块底——窄窗口下文本换行为多行时按钮落在
       最后一行（用户反馈②），与 li 直觉一致；引用块宿主按钮保持首行右上
       （0.0.46 起定位，0.0.49 曾误改贴底 → 0.0.49 修正恢复）。代码块/表格仍贴首行右上。 */
    .markdown li > .block-actions { top: auto; bottom: 2px; }
    .markdown p > .block-actions,
    .markdown h1 > .block-actions, .markdown h2 > .block-actions, .markdown h3 > .block-actions,
    .markdown h4 > .block-actions, .markdown h5 > .block-actions, .markdown h6 > .block-actions {
      top: auto; bottom: 2px;
    }
    .markdown blockquote > .block-actions { top: 2px; }
    .markdown li:has(> ul, > ol) > .block-actions { top: 2px; bottom: auto; }
    /* G27 round3 (0.0.51): code-wrap 补圆角——pre 内部 6px 圆角，闪光 box-shadow
       画在 code-wrap（此前无 radius）上呈直角；补 6px 后与 pre 一致。table-wrap/
       blockquote 直角块保持直角。 */
    .markdown .code-wrap { position: relative; border-radius: 6px; }
    .markdown .code-wrap > .block-actions, .markdown .table-wrap > .block-actions { top: 2px; }
    .markdown p:hover > .block-actions, .markdown ul:hover > .block-actions,
    .markdown ol:hover > .block-actions,
    .markdown h1:hover > .block-actions, .markdown h2:hover > .block-actions, .markdown h3:hover > .block-actions,
    .markdown h4:hover > .block-actions, .markdown h5:hover > .block-actions, .markdown h6:hover > .block-actions,
    .markdown .code-wrap:hover > .block-actions, .markdown .table-wrap:hover > .block-actions,
    /* G27 round2 (0.0.43): 嵌套列表/引用——内嵌 ul/ol/blockquote 悬停时宿主自身的按钮不显示
       （:hover 沿祖先链冒泡会让外层 li/blockquote 误显按钮，用户实测嵌套 li 两行同时出按钮）。
       最内层 li 自身无子列表，不受 :has 影响，按钮正常可用。 */
    .markdown li:hover:not(:has(> ul:hover, > ol:hover)) > .block-actions,
    .markdown blockquote:hover:not(:has(> ul:hover, > ol:hover, > blockquote:hover)) > .block-actions {
      display: inline-flex;
    }
    .streaming .block-actions { display: none !important; }
    /* G27 (0.0.47): 超高块折叠——hover 折叠/展开按钮（内容 >FOLD_MIN_LINES 行才挂）；
       折叠 = max-height 截断到约两行 + 底部渐变（clip+fade；fade 锚在宿主 absolute 定位盒，
       不随 pre 内容横滚；表格横滚时 fade 移出可视区，V1 接受）；折叠态 class 仅存 DOM
       （canSoftUpdate 软更新保留、全量重建/流式重置）。 */
    .markdown .code-wrap > pre { transition: max-height .15s ease; }
    .markdown .code-wrap.folded > pre { max-height: 56px; overflow: hidden; }
    .markdown .table-wrap.folded { max-height: 70px; overflow: hidden; }
    .markdown blockquote.folded { max-height: 3.4em; overflow: hidden; }
    .markdown .folded::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 16px; pointer-events: none; background: linear-gradient(to bottom, transparent, var(--vscode-sideBar-background, var(--vscode-editor-background, #252526))); }
    /* G27 round2 (0.0.41): 点击公式即复制——hover 灰底提示可点，复制成功边缘蓝光 1s（animationend 为准）；
       流式期间 pointer-events 关闭防误触，灰底同步屏蔽。
       G27 round2 (0.0.42): ① 背景/蓝光覆盖内容——inline 盒背景高度=line-height(19px) 盖不住
       矩阵(38px)；行内公式改 inline-block（高度随内容），块级公式（math-display 类）改 block 居中。 */
    .markdown span.math.math-copy { display: inline-block; cursor: copy; border-radius: 4px; }
    .markdown span.math.math-copy.math-display { display: block; width: fit-content; margin: 0 auto; }
    .markdown span.math.math-copy:hover { background: rgba(128,128,128,.16); }
    .markdown span.math.math-copy.copied { animation: dsh-copied-flash 1s ease-out; }
    @keyframes dsh-copied-flash {
      0% { box-shadow: 0 0 0 0 rgba(56,132,255,.5); }
      70% { box-shadow: 0 0 0 3px rgba(56,132,255,.3); }
      100% { box-shadow: 0 0 0 6px rgba(56,132,255,0); }
    }
    /* G27 round2 (0.0.50): 复制按钮/右键复制成功 → 被复制的块（p/li/blockquote/h/code-wrap/
       table-wrap/message）整体闪一次同款蓝光——box-shadow 画在元素边框盒外，折叠态
       overflow:hidden 与内部横向滚动均不裁剪光环；超大块同样一圈细蓝光框。 */
    .copied-flash { animation: dsh-copied-flash 1s ease-out; }
    /* G27 round3 (0.0.51): 列表项宿主发光左扩到 marker 区——li 的 marker 画在
       ul/ol padding-left 22px 区内（outside 定位），光晕由 ::before 承担：覆盖 li 盒
       并左扩 22px，左缘囊括序号码；li 本体动画禁用避免双框。22px 与上方
       .markdown ul/ol padding-left 常量耦合，padding 改动需同步。 */
    .markdown li.copied-flash { animation: none; }
    .markdown li.copied-flash::before {
      content: ''; position: absolute; left: -22px; right: 0; top: 0; bottom: 0;
      animation: dsh-copied-flash 1s ease-out; pointer-events: none;
    }
    .streaming span.math.math-copy { pointer-events: none; }
    .streaming span.math.math-copy:hover { background: transparent; }
    /* G27 round2（0.0.41–0.0.48）"文字让位"已退役（0.1.18 用户实测）：hover 时给最右列表头格
       加内边距 + 放开 nowrap → 长表头换行 → 表格在悬停进出时反复增高/变矮，观感不佳。
       现改为**文字不动、按钮遮挡**——.block-actions 本就是绝对定位 + 不透明胶囊底（见上），
       悬停零布局影响（与 0.1.6"悬停控件不得引起重排"纪律一致）。 */
    .markdown pre.shiki { padding: 9px 10px; }
    .markdown .shiki-line { display: block; min-height: 1.55em; white-space: pre; }
    .markdown .md-table-wide { min-width: max-content; }
    code { padding: 1px 4px; border-radius: 4px; font-family: var(--editor-font); background: var(--vscode-textCodeBlock-background); }
    pre { max-width: 100%; margin: 7px 0; padding: 9px 10px; overflow: auto; white-space: pre; border-radius: 6px; color: var(--vscode-editor-foreground); background: var(--vscode-textCodeBlock-background); font: 12px/1.55 var(--editor-font); }
    pre code { padding: 0; background: transparent; }
    a { color: var(--vscode-textLink-foreground); text-decoration: none; cursor: pointer; }
    a:hover { text-decoration: underline; }
    .file-link { min-width: 0; padding: 0; border: 0; color: var(--vscode-textLink-foreground); background: transparent; text-align: left; font-family: var(--editor-font); cursor: pointer; overflow-wrap: anywhere; }
    .file-link:hover { text-decoration: underline; }
    .code-link { padding: 1px 4px; border-radius: 4px; color: var(--vscode-textPreformat-foreground); background: var(--vscode-textCodeBlock-background); }
    .tool { margin: 7px 0 10px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; overflow: hidden; background: color-mix(in srgb, var(--vscode-editor-background) 72%, transparent); }
    .tool.failed { border-color: var(--vscode-errorForeground); }
    .tool summary { min-height: 35px; padding: 7px 9px; display: flex; align-items: center; gap: 7px; cursor: pointer; list-style: none; }
    .tool summary::-webkit-details-marker { display: none; }
    .tool-icon { width: 18px; color: var(--vscode-descriptionForeground); text-align: center; font-family: var(--editor-font); }
    .tool-title { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 600; }
    .tool-detail { color: var(--vscode-descriptionForeground); font-size: 11px; }
    /* 0.0.166（用户反馈）：正文左缩进 34→12（内容靠左对齐）；右留 26 给复制按钮，避免首行内容压按钮。 */
    .tool-body { padding: 2px 26px 9px 12px; min-width: 0; overflow: hidden; color: var(--vscode-descriptionForeground); }
    /* 0.0.164（B3 审查 P1-4）：工具/命令卡输出的**复制入口**——body 右上角小按钮（复制当前显示内容）。 */
    .tool-body { position: relative; }
    .command-result { position: relative; }
    /* 0.0.166（用户反馈）：z-index 抬到内容之上（防被相邻气泡/轨道压在下面导致只有边缘可 hover）。 */
    .tool-copy { position: absolute; top: 2px; right: 4px; opacity: .45; z-index: 3; }
    .tool-copy:hover { opacity: 1; }
    .tool-body pre { color: var(--vscode-foreground); }
    .tool-output-more { margin: 5px 0 0; padding: 2px 7px; border: 1px solid var(--vscode-widget-border); border-radius: 6px; color: var(--vscode-textLink-foreground); background: transparent; font-size: 11px; }
    .tool-output-more:hover { background: var(--vscode-toolbar-hoverBackground); }
    .command-card { margin: 7px 0 10px; padding: 8px 10px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: color-mix(in srgb, var(--vscode-editor-background) 72%, transparent); }
    .command-card.failed { border-color: var(--vscode-errorForeground); }
    .command-head { min-width: 0; display: flex; align-items: center; gap: 7px; }
    .command-name { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-family: var(--editor-font); font-weight: 600; }
    .command-result { margin: 5px 0 0 25px; color: var(--vscode-descriptionForeground); white-space: pre-wrap; overflow-wrap: anywhere; }
    .diff-path, .result-title { margin: 7px 0 4px; font-weight: 600; color: var(--vscode-foreground); }
    .diff-old { border-left: 2px solid var(--vscode-gitDecoration-deletedResourceForeground); }
    .diff-new { border-left: 2px solid var(--vscode-gitDecoration-addedResourceForeground); }
    .source { display: block; margin: 4px 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .source-line { white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--editor-font); font-size: 11px; }
    .tool-actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 2px; }
    .tool-action { min-height: 24px; padding: 2px 7px; border: 1px solid var(--vscode-widget-border); border-radius: 6px; color: var(--vscode-foreground); background: transparent; font-size: 11px; }
    .tool-action:hover { background: var(--vscode-toolbar-hoverBackground); }
    .changed-files { margin: 14px 0 4px; padding: 10px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: color-mix(in srgb, var(--vscode-editor-background) 72%, transparent); }
    .changed-files-head { min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 7px; font-weight: 600; }
    .changed-files-title { min-width: 0; flex: 1; }
    .changed-files-actions, .changed-file-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; }
    .changed-turn + .changed-turn { margin-top: 9px; }
    .changed-turn-title { padding: 4px 0; color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .changed-file { min-width: 0; padding: 6px 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 5px 8px; border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border) 55%, transparent); }
    .changed-file .file-link { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .changed-file-stats { display: flex; gap: 5px; font-family: var(--editor-font); font-size: 10px; }
    .change-additions { color: var(--vscode-gitDecoration-addedResourceForeground); }
    .change-deletions { color: var(--vscode-gitDecoration-deletedResourceForeground); }
    .changed-file-actions { grid-column: 1 / -1; }
    .changed-action { min-height: 21px; padding: 1px 5px; border: 0; border-radius: 4px; color: var(--vscode-descriptionForeground); background: transparent; font-size: 10px; }
    .changed-action:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .changed-action.danger { color: var(--vscode-errorForeground); }
    /* 0.0.118：禁用态（重载后无完整快照）转灰——此前靠全局 opacity .55 压暗红，被读成"红色很暗"（用户 2026-09-15 反馈） */
    .changed-action:disabled { color: var(--vscode-descriptionForeground); }
    /* 0.0.108（用户补充①）：变更文件块折叠——hidden 行/空组必须压过 display:grid 的作者样式 */
    .changed-file[hidden], .changed-turn[hidden] { display: none; }
    .changed-files-more { display: block; width: 100%; margin-top: 6px; padding: 3px 4px 1px; border: 0; border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border) 55%, transparent); border-radius: 0 0 4px 4px; color: var(--vscode-textLink-foreground, #4d6bfe); background: transparent; font-size: 11px; text-align: left; cursor: pointer; }
    .changed-files-more:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .failed, .error-text { color: var(--vscode-errorForeground); }
    .streaming::after { content: ''; display: inline-block; width: 6px; height: 13px; margin-left: 2px; vertical-align: -2px; background: var(--vscode-foreground); animation: blink 1s steps(2) infinite; }
    @keyframes blink { 50% { opacity: 0; } }
    .status, .interaction { margin: 10px 0; padding: 11px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; overflow-wrap: anywhere; background: var(--vscode-editor-background); }
    .status { color: var(--vscode-descriptionForeground); border: 0; background: var(--vscode-textBlockQuote-background); }
    /* 0.0.106（W4）：通知行样式化（图标 + info/error 两态；warn 档待有数据源再补）。 */
    .status.notice { display: flex; align-items: baseline; gap: 6px; }
    .status .notice-icon { color: var(--vscode-charts-blue, #4d6bfe); opacity: .9; }
    .status.error .notice-icon { color: var(--vscode-errorForeground); }
    /* 0.0.106（W6）：错误态卡片化。 */
    .status.status-card { border: 1px solid color-mix(in srgb, var(--vscode-errorForeground) 55%, transparent); background: color-mix(in srgb, var(--vscode-errorForeground) 8%, transparent); color: var(--vscode-foreground); }
    .status-card-title { margin-bottom: 4px; font-weight: 600; color: var(--vscode-errorForeground); }
    .status-card-detail { margin-bottom: 8px; color: var(--vscode-descriptionForeground); font-size: 12px; }
    /* 0.0.106（W3）：危险审批分级。 */
    .interaction.danger { border-color: color-mix(in srgb, var(--vscode-errorForeground) 60%, var(--vscode-widget-border)); }
    .interaction.danger .interaction-title { color: var(--vscode-errorForeground); }
    .interaction .interaction-warn { margin-right: 6px; }
    .status.error { color: var(--vscode-errorForeground); }
    .interaction-title { margin-bottom: 4px; font-weight: 600; }
    .interaction-detail, .question-detail { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
    .primary, .secondary { min-height: 28px; padding: 4px 10px; border-radius: 6px; }
    .primary { border: 1px solid var(--vscode-button-border, transparent); color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    .primary:hover { background: var(--vscode-button-hoverBackground); }
    .secondary { border: 1px solid var(--vscode-button-border, var(--vscode-widget-border)); color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    .question-item + .question-item { margin-top: 13px; padding-top: 12px; border-top: 1px solid var(--vscode-widget-border); }
    .question-label { margin-bottom: 7px; font-weight: 600; }
    .option { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 7px; margin: 6px 0; align-items: start; cursor: pointer; }
    /* 0.1.8（用户复测）：选项控件改为**自绘**（div + role=radio/checkbox，无原生 input）——原生 radio 的
       label 转发/预激活/异步取消回滚时序不可靠（实测微任务回写的 checked 会被一个异步任务打回，
       致"再点已选项取消 / 点 other 框清选"在真实鼠标下失灵）；自绘后选中态=纯 JS 模型，无浏览器激活参与。
       外观与旧原生控件逐位同款（与 markdown 任务列表 checkbox 同范式）。 */
    .option-control { width: 15px; height: 15px; margin: 2px 0 0; border: 2px solid var(--vscode-checkbox-border, #8c8c8c); border-radius: 4px; background-color: transparent; background-repeat: no-repeat; background-position: center; background-size: 11px; }
    .option.single .option-control { border-radius: 50%; }
    /* 0.1.2（用户反馈）：选中配色对齐"主流"（VS Code 焦点环/按钮蓝 = --vscode-focusBorder）。 */
    .option.selected .option-control { border-color: var(--vscode-focusBorder, #0078D4); }
    .option.selected.multi .option-control { background-color: var(--vscode-focusBorder, #0078D4); background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.5l3 3 6-7' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); }
    .option.selected.single .option-control { background-image: radial-gradient(circle, var(--vscode-focusBorder, #0078D4) 0 3.5px, transparent 4px); }
    .option:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; border-radius: 4px; }
    .option-description { display: block; color: var(--vscode-descriptionForeground); font-size: 11px; }
    /* 2026-10-05（用户需求）：改多行——自增高（1→6 行，超出内部滚动），长文本不再横向挤在单行里。
       min-height/font-size 显式复位：抵消全局 textarea 规则（composer 用，min-height:72px）对本元素的命中。 */
    .custom-answer { width: 100%; box-sizing: border-box; display: block; resize: none; margin-top: 7px; padding: 6px 8px; border: 1px solid var(--vscode-input-border, var(--vscode-widget-border)); outline: 0; border-radius: 4px; background: var(--vscode-input-background); min-height: 0; font-size: inherit; font-family: inherit; line-height: 1.5; overflow-y: auto; max-height: 138px; }
    /* 0.1.2（反馈①）：填写"其他"时的活跃高亮（对齐官方 customRowActive 语义）。
       0.1.8（用户反馈）：聚焦/激活配色改用 charts-blue —— 与主输入框聚焦同款（边框 + 1px 光圈）；
       此前用 focusBorder(#0078D4)，真机观感与"主流"（主输入框的蓝）不一致。 */
    .custom-answer:focus, .custom-answer:focus-visible, .custom-answer.active { outline: 0; border-color: var(--vscode-charts-blue, #4d6bfe); box-shadow: 0 0 0 1px var(--vscode-charts-blue, #4d6bfe); }
    /* G41 修复（0.0.99）: 与 .scroll 同理——显式落位，防被导轨挤走（见 .scroll 注释）。 */
    .composer-wrap { grid-column: 1; grid-row: 3; width: 100%; min-width: 0; padding: 0 10px 10px; position: relative; background: linear-gradient(transparent, var(--vscode-sideBar-background) 18px); }
    .queue-dock { width: 100%; min-width: 0; max-width: var(--content-max, 760px); margin: 0 auto 6px; padding: 7px 8px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: var(--vscode-editor-background); }
    .queue-head { min-width: 0; display: flex; align-items: center; gap: 6px; margin-bottom: 4px; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .queue-title { min-width: 0; flex: 1; font-weight: 600; }
    .queue-row { min-width: 0; min-height: 30px; display: flex; align-items: center; gap: 6px; }
    .queue-row + .queue-row { border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border) 55%, transparent); }
    .queue-preview { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .queue-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 3px; }
    .queue-action { min-height: 23px; padding: 1px 5px; border: 0; border-radius: 4px; color: var(--vscode-descriptionForeground); background: transparent; font-size: 10px; }
    .queue-action:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .queue-editor { width: 100%; min-width: 0; min-height: 30px; height: 30px; padding: 4px 6px; resize: none; border: 1px solid var(--vscode-input-border, var(--vscode-widget-border)); border-radius: 4px; background: var(--vscode-input-background); }
    .composer { position: relative; width: 100%; min-width: 0; max-width: var(--content-max, 760px); margin: 0 auto; border: 1px solid var(--vscode-input-border, var(--vscode-widget-border)); border-radius: 12px; background: var(--vscode-input-background); box-shadow: 0 2px 10px color-mix(in srgb, var(--vscode-widget-shadow) 75%, transparent); }
    .command-menu { max-height: 210px; padding: 5px; overflow-y: auto; border-bottom: 1px solid var(--vscode-widget-border); }
    .command-option { width: 100%; min-width: 0; padding: 7px 8px; display: block; border: 0; border-radius: 6px; text-align: left; background: transparent; }
    .command-option:hover, .command-option.selected { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); }
    .command-option-line { min-width: 0; display: flex; align-items: baseline; gap: 7px; }
    .command-option-name { flex: 0 0 auto; font-family: var(--editor-font); font-weight: 600; }
    .command-option-hint { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; opacity: .72; }
    .command-option-current { margin-left: auto; padding: 1px 5px; border-radius: 999px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-family: var(--vscode-font-family); font-size: 10px; font-weight: 500; }
    .command-option-description { margin-top: 2px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .command-option:hover .command-option-description, .command-option.selected .command-option-description { color: inherit; opacity: .82; }
    .command-section-label { padding: 6px 8px 3px; color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .policy-menu { max-height: 260px; }
    .policy-option-name { font-family: var(--vscode-font-family); }
    .policy-section-label { padding: 7px 8px 3px; color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .context-chips, .attachments { display: flex; flex-wrap: wrap; gap: 5px; padding: 8px 10px 0; }
    .draft-zone { max-height: min(45vh, 340px); overflow-y: auto; scrollbar-width: thin; scrollbar-color: rgba(199, 199, 199, .35) transparent; }
    .draft-zone::-webkit-scrollbar { width: 6px; }
    .draft-zone::-webkit-scrollbar-thumb { background: rgba(199, 199, 199, .35); border-radius: 4px; }
    .context-chip, .attachment-chip { min-width: 0; max-width: 100%; display: flex; align-items: center; gap: 5px; padding: 3px 5px 3px 8px; border: 1px solid var(--vscode-widget-border); border-radius: 6px; color: var(--vscode-descriptionForeground); background: var(--vscode-editor-background); }
    .context-chip.selection { color: var(--vscode-foreground); border-color: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 55%, var(--vscode-widget-border)); }
    .chip-file { cursor: pointer; }
    .chip-file:hover { border-color: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, var(--vscode-widget-border)); }
    .context-icon { flex: 0 0 auto; }
    .context-icon img { width: 16px; height: 16px; display: block; margin: 0 auto; }
    .context-name, .attachment-name { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .context-remove, .attachment-remove { width: 18px; height: 18px; padding: 2px 0 2px; border: 0; border-radius: 4px; background: transparent; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; line-height: 1; }
    /* G5 v12: 只移 glyph 不移框——padding 上下差控制 ✕ 在 18px 框内的垂直位置：
       2px/2px = glyph 居中（文件/上下文 v11 偏上 1px → v12 再下移 1px，与图片 chip 同值合并） */
    .clear-trash { color: var(--vscode-descriptionForeground); }
    .clear-trash:hover { color: var(--vscode-errorForeground, #f48771); background: var(--vscode-toolbar-hoverBackground); }
    .clear-trash:disabled { opacity: .35; cursor: default; }
    .clear-trash:disabled:hover { background: transparent; color: var(--vscode-descriptionForeground); }
    .context-remove:hover, .attachment-remove:hover { background: var(--vscode-toolbar-hoverBackground); }
    .context-chip.attached { border-color: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 65%, var(--vscode-widget-border)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 18%, transparent); }
    .attach-thumb { width: 32px; height: 32px; flex: 0 0 32px; border-radius: 6px; object-fit: cover; background: var(--vscode-editor-background); }
    .attachment-chip { cursor: pointer; }
    .image-preview { position: fixed; inset: 0; z-index: 50; overflow: hidden; background: rgba(0, 0, 0, .72); cursor: move; touch-action: none; user-select: none; }
    /* 0.1.22（用户实测②：预览初始位置随侧栏宽度下移、滚轮缩放中心偏）：画布改**绝对铺满**。
       此前 grid + place-items:center + height:100% 让画布参与网格行定高（行 auto 高度取自画布的
       内在尺寸 = 它的 backing store），而绘制每帧又把 backing store 设成 clientHeight → 自反馈把
       画布撑到超过视口（实测 420 宽时 grid-template-rows=1181px、视口只有 900px）。于是"按画布
       中心居中绘制"与"按覆盖层 rect 取缩放中心"差了半个溢出量：越宽图越靠下、缩放锚点纵向漂移。 */
    .image-preview-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    /* 0.0.79（GIF①）: GIF 预览控制条（播放/翻帧/选择发送）——位于提示行上方。
       0.0.80: 后代选择器提升优先级——「preview-action」规则在本表更靠后，会覆盖同级的旧
       「preview-action-text」，导致按钮仍是 20×20、文字竖着折行。 */
    /* 0.0.83（用户反馈①）: 底部两条 UI 改不透明胶囊（editorWidget 底色）——此前无背景，直接压在半透明
       遮罩上会和侧栏草稿栏的元素重叠。
       0.0.84（用户反馈）: ① 绝对定位 + left:50% 时 shrink-to-fit 只给"半宽"→ 内容被挤成竖排/折行、
       胶囊被撑高 → 补 width: max-content（+ max-width 防溢出）；② hover 蓝边框改到**按钮级**
       （用户原意：播/翻帧/复位按钮 hover），胶囊本体不 hover；③ 胶囊内光标改 default（否则显示拖拽十字）。 */
    /* 0.0.86（G36）: 圆角矩形外框把控制条与提示行合并为一张卡片（静止图只有提示行 → 单行卡片）。 */
    .preview-bar { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%); width: max-content; max-width: calc(100% - 16px); display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 6px 10px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: var(--vscode-editorWidget-background, #252526); cursor: default; }
    .preview-controls { display: flex; align-items: center; justify-content: center; gap: 6px; }
    .preview-controls .preview-action { width: auto; height: 22px; padding: 0 9px; margin-left: 0; font-size: 11px; white-space: nowrap; }
    .preview-frame-label { color: var(--vscode-descriptionForeground); font-size: 11px; }
    .preview-select { display: inline-flex; align-items: center; gap: 4px; color: var(--vscode-descriptionForeground); font-size: 11px; cursor: pointer; }
    /* 0.0.78（GIF③）: 选帧器 + 草稿卡帧徽标 */
    .frame-picker { position: fixed; inset: 0; z-index: 52; display: grid; place-items: center; background: rgba(0, 0, 0, .55); }
    .frame-picker-box { width: min(420px, calc(100vw - 24px)); max-height: min(70vh, 560px); display: flex; flex-direction: column; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: var(--vscode-menu-background, var(--vscode-editor-background)); box-shadow: 0 8px 24px var(--vscode-widget-shadow); }
    .frame-picker-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid var(--vscode-widget-border, transparent); font-size: 12px; font-weight: 600; }
    .frame-picker-grid { flex: 1; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(56px, 1fr)); gap: 6px; padding: 10px; }
    .frame-picker-cell { padding: 2px; border: 1px solid var(--vscode-widget-border, transparent); border-radius: 6px; background: transparent; cursor: pointer; }
    .frame-picker-cell:hover { border-color: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, var(--vscode-widget-border)); }
    .frame-picker-cell.selected { border-color: var(--vscode-charts-blue, #4d6bfe); }
    .frame-picker-cell img { display: block; width: 100%; height: 44px; object-fit: contain; }
    .frame-picker-cell span { display: block; text-align: center; font-size: 9px; color: var(--vscode-descriptionForeground); }
    .frame-picker-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-top: 1px solid var(--vscode-widget-border, transparent); }
    .frame-picker-info { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10.5px; color: var(--vscode-descriptionForeground); }
    /* 0.0.141（用户需求②）：徽标不收缩、不折行——窄侧栏改由"放得下几个 + '+m'"接管（fitFrameBadges）。 */
    .frame-badge { flex: 0 0 auto; white-space: nowrap; margin-left: 4px; padding: 0 5px; border: 1px solid var(--vscode-charts-blue, #4d6bfe); border-radius: 999px; color: var(--vscode-charts-blue, #4d6bfe); font-size: 9px; line-height: 15px; }
    /* 0.0.83（用户反馈①）: 提示行同样改不透明胶囊（含缩放读数与复位按钮）。
       0.0.84: 同控制条——max-content 防半宽挤压、胶囊不 hover、光标 default。 */
    .image-preview-hint { display: inline-flex; align-items: center; gap: 6px; color: var(--vscode-descriptionForeground); font-size: 11px; white-space: nowrap; cursor: default; }
    .preview-action { display: inline-grid; place-items: center; width: 20px; height: 20px; margin-left: 6px; padding: 0; vertical-align: middle; border: 1px solid var(--vscode-widget-border); border-radius: 4px; background: var(--vscode-textButton-background, transparent); color: var(--vscode-descriptionForeground); font-size: 13px; line-height: 1; cursor: pointer; }
    /* 0.0.84: hover 蓝边框落在按钮本身（45% 混色，与 file-card/attachment-chip 同款） */
    .preview-action:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); border-color: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, var(--vscode-widget-border)); }
    body.file-drag .composer { border-color: var(--vscode-charts-blue, #4d6bfe); box-shadow: 0 0 0 1px var(--vscode-charts-blue, #4d6bfe); }
    /* 0.0.145（用户需求②）：提示条改浮层——绝对定位悬于输入区上方，显示/隐藏不再改变布局
       （此前占位把底栏抬高 → 右侧轨道节点与自绘滑块随之位移）。指针穿透，不挡下方交互；
       显示时长由设置 ui.hintSeconds 控制（默认 4 秒）。 */
    .drop-hint { position: absolute; left: 2px; right: 2px; bottom: calc(100% + 4px); z-index: 6; box-sizing: border-box; max-height: 30vh; overflow: auto; padding: 6px 10px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: var(--vscode-editorWidget-background, #252526); color: var(--vscode-editorWarning-foreground, #cca700); font-size: 11px; box-shadow: 0 2px 10px var(--vscode-widget-shadow, rgba(0, 0, 0, .35)); pointer-events: none; }
    .mode-chips { display: flex; flex-wrap: wrap; gap: 5px; padding: 8px 10px 0; }
    .preset-chip { min-width: 0; max-width: 100%; min-height: 25px; padding: 2px 6px; display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--vscode-widget-border); border-radius: 6px; color: var(--vscode-descriptionForeground); background: var(--vscode-editor-background); }
    .preset-chip.locked { opacity: .72; }
    .preset-icon, .preset-lock { flex: 0 0 auto; font-size: 10px; }
    .preset-select { min-width: 0; max-width: 210px; border: 0; outline: 0; color: var(--vscode-foreground); background: transparent; font-weight: 600; text-overflow: ellipsis; }
    .preset-select:disabled { color: var(--vscode-descriptionForeground); opacity: 1; }
    .ds-drop { position: relative; display: inline-flex; min-width: 0; }
    .ds-trigger { display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 210px; border: 0; border-radius: 6px; background: transparent; color: var(--vscode-foreground); font-weight: 600; padding: 3px 7px; text-overflow: ellipsis; }
    .ds-trigger > .ds-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ds-trigger:hover { background: var(--vscode-toolbar-hoverBackground); }
    .ds-trigger:disabled { color: var(--vscode-descriptionForeground); opacity: 1; }
    .ds-trigger:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; border-radius: 8px; }
    .ds-caret { display: inline-flex; align-items: center; color: var(--vscode-descriptionForeground); font-size: 10px; }
    .ds-caret svg { width: 11px; height: 11px; display: block; }
    /* 0.0.109（G51 用户反馈）：宽度改内容自适应（短选项菜单不再被 200px 固定底线撑宽）+ 视口上限；
       打开时由 installDrop 按实际位置钳制——触右缘加 .align-right 改右对齐（左对齐仍为默认）。 */
    .ds-menu { position: absolute; z-index: 30; bottom: calc(100% + 5px); left: 0; width: max-content; min-width: 160px; max-width: min(360px, calc(100vw - 16px)); max-height: min(420px, 70vh); padding: 5px; overflow: auto; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: var(--vscode-menu-background, var(--vscode-editor-background)); box-shadow: 0 5px 18px var(--vscode-widget-shadow); }
    .ds-menu.align-right { left: auto; right: 0; }
    .ds-menu.down { bottom: auto; top: calc(100% + 5px); }
    .ctx-menu { position: fixed; z-index: 60; bottom: auto; top: 0; left: 0; }
    /* G29 round2 (0.0.55): 侧栏内轻提示——复制/保存类反馈不再走 VS Code 右下角通知（会遮挡输入框），
       改在输入框上方浮出 ~1.8s 自动淡出（位置在 showToast 内按 composer 实际高度计算）。 */
    .toast { position: fixed; left: 50%; transform: translateX(-50%); z-index: 70; bottom: 120px; max-width: min(420px, calc(100% - 24px)); padding: 6px 12px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: var(--vscode-menu-background, var(--vscode-editor-background)); color: var(--vscode-foreground); font-size: 12px; line-height: 17px; box-shadow: 0 4px 14px var(--vscode-widget-shadow); pointer-events: none; opacity: 0; transition: opacity .15s ease; overflow-wrap: anywhere; }
    .toast.show { opacity: 1; }
    .toast.warn { border-color: var(--vscode-editorWarning-foreground, #cca700); color: var(--vscode-editorWarning-foreground, #cca700); }
    .ctx-option { display: flex; align-items: center; width: 100%; text-align: left; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--vscode-foreground); font-size: 12px; }
    .ctx-option:hover { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .ctx-option-title { flex: 1 1 auto; min-width: 0; padding: 6px 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ds-group { padding: 6px 10px 2px; color: var(--vscode-descriptionForeground); font-size: 10px; letter-spacing: .04em; text-transform: none; }
    /* 0.0.147：回收站菜单底部「其他项目」提示行——分隔线与列表本体区分。 */
    .recycle-others { margin-top: 4px; padding-top: 6px; border-top: 1px solid var(--vscode-menu-separatorBackground, rgba(128, 128, 128, .3)); }
    .ds-option { display: flex; align-items: center; width: 100%; text-align: left; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--vscode-foreground); font-size: 12px; }
    .ds-option:hover, .ds-option.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .ds-option.selected { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, transparent); }
    .ds-option-title { flex: 1 1 auto; min-width: 0; padding: 6px 2px 6px 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ds-option-del { flex: 0 0 auto; width: 22px; height: 22px; min-width: 22px; margin: 2px 5px 2px 2px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--vscode-foreground); opacity: 0; }
    .ds-option:hover .ds-option-del, .ds-option-del:focus-visible { opacity: 1; }
    .ds-option-del:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-errorForeground, #e5534b); }
    .ds-option-del svg { width: 12px; height: 12px; }
    .ds-option-time { flex: 0 0 auto; margin: 0 6px 0 4px; color: var(--vscode-descriptionForeground); font-size: 10px; white-space: nowrap; }
    .ds-option-act { flex: 0 0 auto; width: 22px; height: 22px; min-width: 22px; margin: 2px 2px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--vscode-descriptionForeground); opacity: 0; }
    .ds-option:hover .ds-option-act, .ds-option-act:focus-visible { opacity: 1; }
    .ds-option-act:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
    .ds-option-act svg { width: 12px; height: 12px; }
    .recycle-wrap { position: relative; display: inline-flex; flex: 0 0 auto; }
    .recycle-count { position: absolute; top: -3px; right: -4px; min-width: 14px; height: 14px; padding: 0 3px; border-radius: 999px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-size: 9px; line-height: 14px; text-align: center; }
    .recycle-menu { bottom: auto; top: calc(100% + 5px); right: 0; left: auto; }
    .rename-popup { position: fixed; z-index: 40; top: 44px; left: 50%; transform: translateX(-50%); width: min(320px, calc(100vw - 24px)); padding: 10px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: var(--vscode-menu-background, var(--vscode-editor-background)); box-shadow: 0 7px 22px var(--vscode-widget-shadow); }
    /* G6 v1（0.0.62）: 设置台面板 */
    .settings-panel { position: fixed; inset: 0; z-index: 45; display: flex; flex-direction: column; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); }
    .settings-panel.hidden { display: none; }
    .settings-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid var(--vscode-widget-border, transparent); }
    .settings-title { font-size: 12px; font-weight: 600; }
    .settings-close { border: none; background: transparent; color: var(--vscode-foreground); cursor: pointer; font-size: 12px; padding: 3px 7px; border-radius: 4px; }
    .settings-close:hover { background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, .31)); }
    .settings-body { flex: 1; overflow: auto; padding: 4px 10px 24px; }
    .settings-section { margin-top: 10px; }
    .settings-section-title { margin: 6px 0; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--vscode-descriptionForeground); }
    .connections-layout { display: grid; grid-template-columns: minmax(110px, 170px) minmax(0, 1fr); gap: 12px; margin-top: 10px; }
    .connections-list, .connections-form { min-width: 0; display: flex; flex-direction: column; align-items: stretch; gap: 8px; }
    #modelConnectionsSection .settings-action { color: var(--vscode-foreground); background: var(--vscode-editorWidget-background, transparent); border-color: var(--vscode-widget-border, transparent); }
    #modelConnectionsSection .settings-action:hover { background: var(--vscode-toolbar-hoverBackground); border-color: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, var(--vscode-widget-border, transparent)); }
    #modelConnectionsSection :focus-visible { outline: 1px solid var(--vscode-charts-blue, #4d6bfe); outline-offset: 1px; }
    .connections-list .settings-action { text-align: left; white-space: normal; overflow-wrap: anywhere; }
    #modelConnectionsSection .connections-list .selected, #modelConnectionsSection .connection-save { border-color: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, var(--vscode-widget-border, transparent)); background: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 12%, var(--vscode-editorWidget-background, var(--vscode-editor-background))); }
    .connection-field.settings-row { flex-direction: column; align-items: stretch; gap: 5px; min-width: 0; margin-bottom: 0; }
    .connection-field input, .connection-field textarea, .connection-capacity input { width: 100%; min-width: 0; box-sizing: border-box; padding: 7px; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-widget-border, transparent); border-radius: 4px; }
    .connection-field input:focus, .connection-field textarea:focus, .connection-capacity input:focus { outline: none; border-color: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 65%, var(--vscode-widget-border, transparent)); }
    .connection-capacities { padding: 7px 9px; border: 1px solid var(--vscode-widget-border, transparent); border-radius: 6px; background: var(--vscode-editorWidget-background, transparent); }
    .connection-capacities summary { cursor: pointer; font-size: 12px; }
    .connections-summary .settings-action { flex: 0 0 auto; }
    .connection-candidates { max-height: 180px; overflow: auto; }
    .connection-candidate { display: flex; gap: 6px; align-items: center; overflow-wrap: anywhere; }
    .connection-capacity { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 6px; margin-top: 8px; }
    .connection-capacity > span { grid-column: 1 / -1; overflow-wrap: anywhere; }
    .connections-status { margin-top: 10px; }
    @media (max-width: 540px) { .connections-layout { grid-template-columns: minmax(0, 1fr); } .connections-list { flex-direction: row; flex-wrap: wrap; } .connections-form .settings-row { flex-wrap: wrap; } }
    .settings-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; padding: 7px 9px; border: 1px solid var(--vscode-widget-border, transparent); border-radius: 6px; background: var(--vscode-editorWidget-background, transparent); }
    .settings-row-text { flex: 1; min-width: 0; }
    .settings-row-label { font-size: 12px; }
    .settings-row-hint { margin: 2px 0; font-size: 10.5px; line-height: 15px; color: var(--vscode-descriptionForeground); }
    /* 0.0.97（G42）：哨兵值 -1（刻意设置的特殊值）→ 行说明红字警示 */
    .settings-row-warn { color: var(--vscode-errorForeground, #f48771); }
    /* 0.0.92：DSH 配置字段说明行（缩进对齐字段名） */
    .settings-ns-hint { padding-left: 10px; margin-top: 0; }
    .settings-switch { position: relative; flex: 0 0 auto; width: 32px; height: 18px; padding: 0; border: 1px solid var(--vscode-widget-border); border-radius: 999px; background: var(--vscode-input-background); cursor: pointer; }
    .settings-switch-knob { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--vscode-descriptionForeground); transition: left .12s ease; }
    .settings-switch.on { border-color: var(--vscode-charts-blue, #4d6bfe); background: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 55%, transparent); }
    .settings-switch.on .settings-switch-knob { left: 16px; background: #fff; }
    body[data-motion="off"] .settings-switch-knob { transition: none; }
    /* G45（0.0.103）：公式复制颜色控件（跟随主题开关 + 色板 + RGB/HSL/Hex 三段联动 + 预览）。 */
    .settings-color { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
    .settings-color-head { display: flex; align-items: center; gap: 8px; }
    /* 0.0.163（审查 P1-2）：存储区——路径可换行、右侧「大小 + 打开」窄列。 */
    .settings-row-hint.storage-path { word-break: break-all; }
    .storage-cell { display: flex; align-items: center; gap: 8px; }
    .storage-size { min-width: 56px; text-align: right; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .settings-color-label { color: var(--vscode-descriptionForeground); font-size: 11px; }
    .settings-color-body { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
    .settings-color-body.hidden { display: none; }
    .settings-color-swatches { display: flex; gap: 4px; }
    .settings-swatch { width: 16px; height: 16px; padding: 0; border: 1px solid var(--vscode-widget-border); border-radius: 4px; cursor: pointer; }
    .settings-swatch:hover { border-color: var(--vscode-charts-blue, #4d6bfe); }
    .settings-color-fields { display: flex; align-items: center; gap: 4px; }
    .settings-color-tag { width: 28px; text-align: right; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .settings-color-input { width: 46px; padding: 2px 4px; border: 1px solid var(--vscode-input-border, var(--vscode-widget-border)); border-radius: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-size: 11px; }
    .settings-color-hex { width: 74px; }
    .settings-color-preview { width: 16px; height: 16px; border: 1px solid var(--vscode-widget-border); border-radius: 4px; }
    /* G45 v1.1（0.0.104）：颜色输入改自绘步进（隐藏原生 spinner）+ 系统调色盘入口。 */
    .settings-color-input::-webkit-inner-spin-button, .settings-color-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
    .settings-color-native { width: 16px; height: 16px; padding: 0; border: 1px solid var(--vscode-widget-border); border-radius: 4px; background: none; cursor: pointer; }
    .settings-color-native-label { margin-left: 10px; }
    .settings-color-native:hover { border-color: var(--vscode-charts-blue, #4d6bfe); }
    .settings-color-native::-webkit-color-swatch-wrapper { padding: 0; }
    .settings-color-native::-webkit-color-swatch { border: none; border-radius: 2px; }
    .settings-number { width: 68px; padding: 3px 6px; border: 1px solid var(--vscode-input-border, var(--vscode-widget-border)); border-radius: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-size: 11px; }
    /* 0.0.63（用户反馈④）: 数字输入的步进按钮自绘——原生 spinner 在深色主题下是刺眼的白色小方块。 */
    .settings-stepper { display: inline-flex; align-items: center; gap: 3px; }
    .settings-number::-webkit-inner-spin-button, .settings-number::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
    .settings-stepper-buttons { display: inline-flex; flex-direction: column; gap: 1px; }
    .settings-step { display: grid; place-items: center; width: 16px; height: 11px; padding: 0; border: 1px solid var(--vscode-input-border, var(--vscode-widget-border)); border-radius: 4px; background: var(--vscode-input-background); color: var(--vscode-descriptionForeground); cursor: pointer; }
    .settings-step:hover { color: var(--vscode-foreground); border-color: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, var(--vscode-widget-border)); }
    .settings-step svg { width: 10px; height: 10px; }
    .settings-enum select { display: none; }
    /* 0.0.63（用户反馈②）: 设置行里的下拉在行右端——菜单改右对齐，防外框越出屏幕。 */
    .settings-enum .ds-menu { z-index: 46; left: auto; right: 0; max-width: calc(100vw - 20px); }
    .settings-actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 4px; }
    .settings-action { padding: 4px 10px; border: 1px solid var(--vscode-widget-border, transparent); border-radius: 6px; background: var(--vscode-button-secondaryBackground, var(--vscode-button-background)); color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground)); font-size: 11px; cursor: pointer; }
    .settings-action:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground)); }
    .settings-ns { margin-bottom: 6px; padding: 5px 8px; border: 1px solid var(--vscode-widget-border, transparent); border-radius: 6px; }
    .settings-ns summary { cursor: pointer; font-size: 12px; }
    .settings-ns-field { display: flex; gap: 8px; padding: 2px 0 2px 10px; font-size: 11px; line-height: 16px; }
    .settings-ns-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); }
    .settings-ns-value { max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--editor-font, monospace); }
    /* G6 v2（0.0.64）: DSH 字段编辑控件 */
    .settings-ns-control { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; max-width: 62%; }
    .settings-ns-control .settings-action { padding: 2px 8px; }
    .settings-ns-secret { font-size: 10.5px; color: var(--vscode-descriptionForeground); }
    .settings-input { width: 120px; padding: 3px 6px; border: 1px solid var(--vscode-input-border, var(--vscode-widget-border)); border-radius: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-size: 11px; }
    .settings-secret-input { width: 92px; }
    .settings-badge { padding: 0 5px; border: 1px solid color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, transparent); border-radius: 4px; color: var(--vscode-charts-blue, #4d6bfe); font-size: 10px; line-height: 15px; }
    .settings-restore { padding: 1px 7px; border: 1px solid var(--vscode-widget-border, transparent); border-radius: 4px; background: transparent; color: var(--vscode-descriptionForeground); font-size: 10.5px; cursor: pointer; }
    .settings-restore:hover { color: var(--vscode-foreground); border-color: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, var(--vscode-widget-border)); }
    .rename-popup input { width: 100%; box-sizing: border-box; padding: 6px 9px; border: 1px solid var(--vscode-input-border, var(--vscode-widget-border)); border-radius: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); outline: none; }
    .rename-actions { margin-top: 8px; display: flex; justify-content: flex-end; gap: 8px; }
    .delete-text { margin: 4px 2px 2px; font-size: 12.5px; line-height: 1.5; color: var(--vscode-foreground); }
    .rename-actions button { padding: 4px 12px; border: 0; border-radius: 6px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }    .plan-chip { min-height: 25px; padding: 2px 5px 2px 8px; display: inline-flex; align-items: center; gap: 5px; border: 1px solid color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 58%, var(--vscode-widget-border)); border-radius: 6px; color: var(--vscode-foreground); background: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 12%, var(--vscode-editor-background)); font-weight: 600; }
    .plan-chip-close { width: 18px; height: 18px; padding: 0; border: 0; border-radius: 4px; background: transparent; line-height: 1; }
    .plan-chip-close:hover { background: var(--vscode-toolbar-hoverBackground); }
    textarea { width: 100%; min-height: 72px; max-height: 220px; resize: none; display: block; padding: 11px 12px 4px; border: 0; outline: 0; background: transparent; color: var(--vscode-input-foreground); }
    textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
    .composer-row { width: 100%; min-width: 0; min-height: 39px; padding: 4px 6px 6px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 5px; }
    .left-actions { display: flex; align-items: center; gap: 2px; min-width: 0; }
    .model-picks { display: flex; align-items: center; gap: 4px; min-width: 0; justify-content: flex-end; }
    .run-actions { display: flex; align-items: center; justify-content: flex-end; gap: 4px; flex: 0 0 auto; }
    .usage-control { flex: 0 0 auto; }
    .usage-trigger { color: var(--vscode-descriptionForeground); }
    .usage-trigger:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .usage-track, .usage-fill { fill: none; stroke-width: 2; }
    .usage-track { stroke: var(--vscode-widget-border); }
    .usage-fill { stroke: var(--vscode-descriptionForeground); stroke-linecap: round; }
    .usage-trigger.warning .usage-fill { stroke: var(--vscode-editorWarning-foreground); }
    .usage-trigger.danger .usage-fill { stroke: var(--vscode-errorForeground); }
    /* 0.0.106（W5）：面板改锚定 .composer（右缘对齐、弹在输入框上方）——不再压住输入区文字；
       输入框长高时随 composer 顶缘上移（原锚 usage-control 会压 textarea）。 */
    .usage-panel { position: absolute; z-index: 30; right: 0; bottom: calc(100% + 10px); width: min(264px, calc(100vw - 34px)); padding: 12px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; color: var(--vscode-descriptionForeground); background: var(--vscode-menu-background); box-shadow: 0 7px 22px var(--vscode-widget-shadow); font-size: 11px; line-height: 18px; }
    .usage-header { display: flex; align-items: baseline; gap: 5px; }
    .usage-percent, .usage-figures { color: var(--vscode-foreground); font-weight: 600; }
    .usage-figures { margin-left: auto; font-variant-numeric: tabular-nums; }
    .usage-bar { height: 4px; margin: 10px 0 8px; display: flex; gap: 1px; overflow: hidden; border-radius: 999px; background: var(--vscode-toolbar-hoverBackground); }
    .usage-segment { min-width: 2px; height: 100%; border-radius: 2px; }
    .usage-system { background: var(--vscode-descriptionForeground); }
    .usage-tools { background: #a78bfa; }
    .usage-messages { background: #4d6bfe; }
    .usage-rows { margin: 0; }
    .usage-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 2px 0; }
    .usage-row dt, .usage-row dd { margin: 0; }
    .usage-row dd { color: var(--vscode-foreground); font-variant-numeric: tabular-nums; }
    .usage-swatch { width: 7px; height: 7px; margin-right: 6px; display: inline-block; border-radius: 2px; }
    .usage-stats { min-width: 0; padding: 0 12px 8px; overflow: hidden; color: var(--vscode-descriptionForeground); font-size: 10px; line-height: 14px; text-overflow: ellipsis; white-space: nowrap; }
    /* ---- C1: 峰谷红绿灯（常驻行最前端） ---- */
    .usage-light { width: 8px; height: 8px; display: inline-block; margin-right: 5px; border-radius: 50%; vertical-align: -1px; flex: 0 0 auto; }
    .usage-light.peak { background: #ff6259; box-shadow: 0 0 4px rgba(255, 98, 89, .55); }
    .usage-light.off { background: #73c991; box-shadow: 0 0 4px rgba(115, 201, 145, .45); }
    .usage-stats-text { display: inline-block; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; max-width: calc(100% - 14px); }
    /* ---- C1: 圆环面板「费用估算」小节 ---- */
    .usage-cost { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--vscode-widget-border); }
    .usage-cost-head { display: flex; align-items: center; gap: 6px; }
    .usage-cost-head b { color: var(--vscode-foreground); font-weight: 600; }
    .usage-cost-tag { padding: 0 6px; border-radius: 999px; font-size: 10px; line-height: 16px; }
    .usage-cost-tag.peak { color: #ff6259; border: 1px solid #ff6259; }
    .usage-cost-tag.off { color: #73c991; border: 1px solid #73c991; }
    .usage-cost .usage-row dd.amt { color: var(--vscode-foreground); font-weight: 600; }
    .usage-cost-prices { margin: 6px 0 0; font-size: 10px; overflow-x: auto; }
    .usage-cost-prices table { min-width: max-content; width: 100%; margin-top: 4px; border-collapse: collapse; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
    .usage-cost-prices summary { cursor: pointer; color: var(--vscode-descriptionForeground); }
    .usage-cost-prices th, .usage-cost-prices td { text-align: left; padding: 1px 4px; white-space: nowrap; }
    .usage-cost-prices th { color: var(--vscode-foreground); font-weight: 600; }
    .usage-cost-note { margin-top: 6px; font-size: 9.5px; line-height: 14px; color: var(--vscode-descriptionForeground); }
    /* ---- C3 (0.0.69): 上下文面板（数据源 dsh-context 投影；六色与官方 CATS 一致） ---- */
    .ctx-cat-system { background: #6366f1; }
    .ctx-cat-tools { background: #f59e0b; }
    .ctx-cat-user { background: #22c55e; }
    .ctx-cat-inject { background: #a855f7; }
    .ctx-cat-assistant { background: #3b82f6; }
    .ctx-cat-tool { background: #14b8a6; }
    .ctx-cat-skill { background: #ec4899; }
    .usage-detail { display: block; width: 100%; margin-top: 8px; padding: 4px 0; border: 1px solid var(--vscode-widget-border, transparent); border-radius: 6px; background: transparent; color: var(--vscode-descriptionForeground); font-size: 11px; cursor: pointer; }
    .usage-detail:hover { color: var(--vscode-foreground); border-color: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, var(--vscode-widget-border)); }
    .context-panel { position: fixed; inset: 0; z-index: 45; display: flex; flex-direction: column; color: var(--vscode-foreground); background: var(--vscode-sideBar-background, var(--vscode-editor-background)); }
    .context-panel.hidden { display: none; }
    .context-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid var(--vscode-widget-border, transparent); }
    .context-title { font-size: 12px; font-weight: 600; }
    .context-body { flex: 1; overflow: auto; padding: 8px 10px 24px; font-size: 11px; line-height: 16px; }
    .context-card { margin-bottom: 10px; padding: 8px 10px; border: 1px solid var(--vscode-widget-border, transparent); border-radius: 8px; background: var(--vscode-editorWidget-background, transparent); }
    .context-card-title { margin: 0 0 6px; color: var(--vscode-descriptionForeground); font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; }
    .ctx-headline { display: flex; align-items: baseline; gap: 6px; }
    .ctx-percent { font-size: 17px; font-weight: 700; }
    .ctx-model { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); font-size: 10px; }
    .ctx-figures { margin-left: auto; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .ctx-bar { height: 10px; margin: 8px 0 6px; display: flex; gap: 1px; overflow: hidden; border-radius: 4px; background: var(--vscode-toolbar-hoverBackground); }
    .ctx-seg { min-width: 2px; height: 100%; }
    .ctx-legend .usage-row { padding: 1px 0; }
    .ctx-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px 4px; }
    .ctx-stat { text-align: center; }
    .ctx-stat b { display: block; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .ctx-stat span { color: var(--vscode-descriptionForeground); font-size: 10px; }
    .ctx-trend { position: relative; display: flex; align-items: flex-end; gap: 1px; height: 92px; padding-top: 10px; }
    .ctx-barcol { position: relative; align-self: stretch; flex: 1 1 0; min-width: 2px; display: flex; flex-direction: column; justify-content: flex-end; }
    .ctx-barcol:hover { background: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 16%, transparent); }
    .ctx-stack { width: 100%; display: flex; flex-direction: column-reverse; }
    .ctx-stack .ctx-seg { width: 100%; min-width: 0; }
    .ctx-cut { position: absolute; top: -10px; left: 50%; transform: translateX(-50%); font-size: 9px; line-height: 9px; color: #ef4444; }
    .ctx-tooltip { position: fixed; z-index: 60; max-width: 250px; padding: 6px 8px; border: 1px solid var(--vscode-widget-border); border-radius: 6px; background: var(--vscode-menu-background, var(--vscode-editor-background)); box-shadow: 0 5px 16px var(--vscode-widget-shadow); font-size: 10.5px; line-height: 15px; pointer-events: none; }
    .ctx-tooltip.hidden { display: none; }
    .ctx-tip-row { display: flex; justify-content: space-between; gap: 10px; }
    .ctx-tip-h { font-weight: 600; margin-bottom: 2px; }
    .ctx-tip-actual { margin-top: 2px; padding-top: 2px; border-top: 1px solid var(--vscode-widget-border, transparent); color: var(--vscode-descriptionForeground); }
    .ctx-events { display: flex; flex-direction: column; gap: 5px; }
    .ctx-event { display: flex; align-items: baseline; gap: 6px; }
    .ctx-event-badge { flex: 0 0 auto; min-width: 32px; padding: 0 4px; border-radius: 4px; font-size: 10px; line-height: 15px; text-align: center; }
    .ctx-event-badge.inject { color: #a855f7; background: color-mix(in srgb, #a855f7 14%, transparent); }
    .ctx-event-badge.compaction, .ctx-event-badge.prune { color: #ef4444; background: color-mix(in srgb, #ef4444 14%, transparent); }
    .ctx-event-badge.model, .ctx-event-badge.mode { color: #3b82f6; background: color-mix(in srgb, #3b82f6 14%, transparent); }
    .ctx-event-main { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ctx-event-tokens { flex: 0 0 auto; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
    .ctx-event-pos { flex: 0 0 auto; color: var(--vscode-descriptionForeground); font-size: 10px; }
    .ctx-empty { padding: 2px 0; color: var(--vscode-descriptionForeground); }
    /* ---- C3 v1.1 (0.0.71): 组成明细（分组/条目/按需内容） ---- */
    .ctx-detail-note { margin: 0 0 6px; color: var(--vscode-descriptionForeground); font-size: 10px; }
    .ctx-groups { display: flex; flex-direction: column; gap: 3px; }
    .ctx-group { border: 1px solid var(--vscode-widget-border, transparent); border-radius: 6px; }
    .ctx-group-head { display: flex; align-items: center; gap: 6px; padding: 4px 6px; cursor: pointer; border-radius: 6px; }
    .ctx-group-head:hover { background: var(--vscode-toolbar-hoverBackground); }
    .ctx-group-caret { flex: 0 0 auto; display: inline-flex; color: var(--vscode-descriptionForeground); transform: rotate(-90deg); transition: transform .12s ease; }
    .ctx-group-caret svg { width: 11px; height: 11px; display: block; }
    .ctx-group.open .ctx-group-caret { transform: rotate(0); }
    .ctx-group-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ctx-group-meta { flex: 0 0 auto; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
    .ctx-group-body { padding: 1px 6px 6px 22px; display: flex; flex-direction: column; gap: 2px; }
    .ctx-item-head { display: flex; align-items: baseline; gap: 6px; padding: 2px 4px; cursor: pointer; border-radius: 4px; }
    .ctx-item-head:hover { background: var(--vscode-toolbar-hoverBackground); }
    .ctx-item-preview { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ctx-item-dim { color: var(--vscode-descriptionForeground); font-size: 10px; }
    .ctx-item-tokens { flex: 0 0 auto; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
    .ctx-item-err { flex: 0 0 auto; color: var(--vscode-errorForeground); }
    .ctx-detail-text { margin: 2px 0 4px; padding: 6px 8px; max-height: 220px; overflow: auto; border-radius: 4px; background: var(--vscode-textCodeBlock-background, var(--vscode-editorWidget-background)); font-family: var(--editor-font, monospace); font-size: 10.5px; line-height: 15px; white-space: pre-wrap; word-break: break-word; }
    .ctx-detail-hint { margin: 2px 0 4px; color: var(--vscode-descriptionForeground); }
    .ctx-detail-img { display: block; max-width: 100%; max-height: 180px; margin: 4px 0; border: 1px solid var(--vscode-widget-border, transparent); border-radius: 4px; cursor: zoom-in; }
    /* 0.0.73: 适配矩阵徽标（运行环境区） */
    .compat-badge { flex: 0 0 auto; padding: 0 6px; border-radius: 999px; font-size: 10px; line-height: 15px; }
    .compat-badge.ok { color: #73c991; border: 1px solid #73c991; }
    .compat-badge.warn { color: var(--vscode-editorWarning-foreground); border: 1px solid var(--vscode-editorWarning-foreground); }
    /* 0.0.91：非落后技能行的隐形徽标占位（保持值列右缘与插件行对齐） */
    .compat-badge.badge-spacer { visibility: hidden; }
    /* G3 (2026-09-01): 命中率颜色由四档跳变改为连续渐变（cacheHitColor 内联 style.color，无类） */
    .project { width: 100%; min-width: 0; height: 28px; padding: 0 4px; overflow: hidden; display: flex; align-items: center; gap: 5px; border: 0; border-radius: 6px; color: var(--vscode-descriptionForeground); background: transparent; }
    .project:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .project span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .project svg { width: 15px; height: 15px; flex: 0 0 auto; }
    .model-select, .effort-select { width: 100%; min-width: 0; max-width: 100%; border: 0; outline: 0; color: var(--vscode-descriptionForeground); background: transparent; text-overflow: ellipsis; }
    .policy-trigger.active { color: var(--vscode-charts-blue, #4d6bfe); background: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 12%, transparent); }
    .policy-trigger.full-access { color: var(--vscode-editorWarning-foreground); }
    .send { border-radius: 8px; color: white; background: #4d6bfe; }
    .send:hover { background: #405de6; }
    .cancel { color: var(--vscode-errorForeground); }
    .cancel:hover { background: var(--vscode-toolbar-hoverBackground); }
    .send:disabled, textarea:disabled, button:disabled { opacity: .55; cursor: default; }
    .hidden { display: none !important; }
    @media (max-width: 330px) { .conversation { padding-inline: 10px; } .composer-row { grid-template-columns: auto minmax(0, 1fr) auto; } .project span { display: none; } }
    /* ---- A7 runtime motion (pure CSS; design/plan/mutation guide: _temp/dsh_迁移计划/A7动效调研/) ---- */
    /* style switch: body[data-motion] (set from ChatViewState.animationStyle); off = all static */
    body[data-motion="off"] *, body[data-motion="off"] *::before, body[data-motion="off"] *::after { animation: none !important; transition: none !important; }
    /* 1 avatar breathing pulse while assistant text is streaming */
    body[data-motion="standard"] .message.assistant:has(.message-body.streaming) .avatar.deepseek-mark { animation: a7-pulse 1.4s ease-in-out infinite; }
    /* 2 tool/command spinner: same-size stand-in for the ● glyph (no layout shift) */
    .tool-icon.live { font-size: 0; display: grid; place-items: center; }
    .tool-icon.live::before { content: ''; width: 12px; height: 12px; border: 2px solid color-mix(in srgb, currentColor 25%, transparent); border-top-color: currentColor; border-radius: 50%; animation: a7-spin .8s linear infinite; }
    /* 3 thinking row: standard = shimmer sweep, dots = bouncing dots */
    .a7-thinking { display: flex; align-items: center; gap: 6px; margin: 8px 0 2px; padding: 6px 10px; border-radius: 6px; color: var(--vscode-descriptionForeground); font-size: 12px; animation: a7-fade-in .15s ease-out; }
    .a7-dots { display: none; gap: 3px; }
    .a7-dots i { width: 4px; height: 4px; border-radius: 50%; background: currentColor; }
    body[data-motion="standard"] .a7-label { background-image: linear-gradient(90deg, var(--vscode-descriptionForeground) 40%, var(--vscode-foreground) 50%, var(--vscode-descriptionForeground) 60%); background-size: 200% 100%; background-clip: text; -webkit-background-clip: text; color: transparent; animation: a7-shimmer 2.25s linear infinite; }
    body[data-motion="dots"] .a7-label { color: var(--vscode-descriptionForeground); }
    body[data-motion="dots"] .a7-dots { display: inline-flex; }
    body[data-motion="dots"] .a7-dots i { animation: a7-dot-bounce 1.2s ease-in-out infinite; }
    body[data-motion="dots"] .a7-dots i:nth-child(2) { animation-delay: .15s; }
    body[data-motion="dots"] .a7-dots i:nth-child(3) { animation-delay: .3s; }
    /* shimmer fallback: restore solid text once motion is dots/off/reduced.
       ⚠️ must NOT include body[data-motion="standard"] — it would kill the sweep unconditionally. */
    body[data-motion="dots"] .a7-label, body[data-motion="off"] .a7-label, body.vscode-reduce-motion .a7-label { color: var(--vscode-descriptionForeground) !important; background-image: none !important; }
    /* 4 indeterminate progress line: sticky inside #scroll, aligned with .conversation width */
    .a7-progress { position: sticky; top: 0; z-index: 6; height: 2px; margin: 0 auto; max-width: min(var(--content-max, 760px), 100% - 28px); overflow: hidden; background: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 22%, transparent); border-radius: 0 0 2px 2px; }
    .a7-progress::after { content: ''; display: block; width: 35%; height: 100%; background: var(--vscode-charts-blue, #4d6bfe); animation: a7-line 1.2s ease-in-out infinite; }
    @keyframes a7-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
    @keyframes a7-spin { to { transform: rotate(360deg); } }
    @keyframes a7-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    @keyframes a7-dot-bounce { 0%, 80%, 100% { transform: translateY(0); opacity: .5; } 40% { transform: translateY(-3px); opacity: 1; } }
    @keyframes a7-line { from { transform: translateX(-100%); } to { transform: translateX(285%); } }
    @keyframes a7-fade-in { from { opacity: 0; } to { opacity: 1; } }
    /* 5 accessibility: both media query (OS setting) and host vscode-reduce-motion class */
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } body .a7-label { color: var(--vscode-descriptionForeground) !important; background-image: none !important; } }
    body.vscode-reduce-motion *, body.vscode-reduce-motion *::before, body.vscode-reduce-motion *::after { animation: none !important; transition: none !important; }
  </style>
</head>
<body>
  <div id="renamePopup" class="rename-popup hidden"><input id="renameInput" maxlength="80" autocomplete="off" placeholder="留空=恢复默认名"><div class="rename-actions"><button id="renameOk">确定</button><button id="renameCancel">取消</button></div></div>
  <div id="deletePopup" class="rename-popup hidden"><div class="delete-text">删除此会话？此操作无法撤销。</div><div class="rename-actions"><button id="deleteOk">删除</button><button id="deleteCancel">取消</button></div></div>
  <div id="markPopup" class="rename-popup hidden"><input id="markInput" maxlength="60" autocomplete="off" placeholder="标注（留空=删除）"><div class="rename-actions"><button id="markOk">确定</button><button id="markCancel">取消</button></div></div>
  <div id="app">
    <header class="toolbar">
      <div id="sessionTabs" class="session-tabs" role="tablist" aria-label="会话"></div>
      <!-- 0.0.167（B4 P1-5）：标签栏就地搜索——搜索行占满一行（工具栏换行），标签实时过滤。 -->
      <div id="tabSearch" class="tab-search hidden">
        <input id="tabSearchInput" class="tab-search-input" type="text" placeholder="搜索会话（标题）…" autocomplete="off" aria-label="搜索会话">
        <span id="tabSearchCount" class="tab-search-count"></span>
        <button id="tabSearchClose" class="icon-button tab-search-close" title="关闭搜索" aria-label="关闭搜索"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </div>
      <button id="tabSearchToggle" class="icon-button" title="搜索会话（标题与内容）" aria-label="搜索会话"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.3-4.3"/></svg></button>
      <!-- 0.0.168（B4 反馈）：跨会话内容命中（运行时全文索引）——点击跳会话并定位首个命中 -->
      <div id="tabSearchResults" class="tab-search-results hidden" role="listbox" aria-label="内容命中"></div>
      <select id="sessions" class="session-select" aria-label="项目会话"></select>
      <div id="jobsControl" class="jobs-control hidden">
        <button id="jobsTrigger" class="icon-button jobs-trigger" title="后台任务" aria-label="后台任务" aria-haspopup="menu" aria-expanded="false"><span class="jobs-dot"></span><span id="jobsCount">0</span></button>
        <div id="jobsMenu" class="jobs-menu hidden" role="menu" aria-label="后台任务"></div>
      </div>
      <button id="newSession" class="icon-button" title="新建会话" aria-label="新建会话"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
      <div class="ds-drop recycle-wrap">
        <button id="recycleSession" class="icon-button" title="回收站" aria-label="回收站" aria-haspopup="menu" aria-expanded="false"><svg viewBox="0 0 24 24"><path d="M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14M10 10v6M14 10v6"/></svg></button>
        <span id="recycleCount" class="recycle-count hidden"></span>
        <div id="recycleMenu" class="ds-menu down recycle-menu" role="menu" hidden></div>
      </div>
    </header>
    <main id="scroll" class="scroll"><div id="a7-progress" class="a7-progress hidden"></div><div id="conversation" class="conversation"><!-- 0.0.175（A10 启动占位）：首个 state 到达前显示，避免启动白屏闪烁（纯静态，无需 JS 即可见）。 --><div id="bootPlaceholder" class="boot-placeholder"><div class="boot-logo deepseek-mark"></div><div class="boot-text">正在连接 DeepSeek<span class="boot-dots"><i></i><i></i><i></i></span></div></div><div id="conversationStatus" class="conversation-slot"></div><div id="conversationHistory" class="conversation-slot"></div><div id="messages" class="messages"></div><div id="a7-thinking" class="a7-thinking hidden"><span class="a7-label">思考中</span><span class="a7-dots"><i></i><i></i><i></i></span></div><div id="conversationTail" class="conversation-slot"></div></div></main>
    <div id="restoreStatus" class="restore-status hidden"><span id="restoreStatusText" class="restore-status-text" role="status" aria-live="polite"></span><button id="restoreStop" class="ds-button" type="button">停在此处</button></div>
    <div id="historyJumpStatus" class="restore-status history-jump-status hidden"><span id="historyJumpStatusText" class="restore-status-text" role="status" aria-live="polite"></span><button id="historyJumpContinue" class="ds-button hidden" type="button">继续加载</button><button id="historyJumpStop" class="ds-button" type="button">停在此处</button></div>
    <!-- G41（0.0.98）: 轮次导航条（与 #scroll 重叠同一网格行；内容由 updateTurnRail 构建）。
         0.0.128：clip=滚动视图（节点/滑块位于轨道内容坐标，随轨道滚动）；wheel 带=最右列滚轮拦截（滚节点列）。 -->
    <div id="turnRail" class="turn-rail hidden" role="navigation" aria-label="轮次导航">
      <button id="turnRailPrepare" class="turn-rail-prepare" type="button" disabled title="正在准备完整导航" aria-label="正在准备完整导航">…</button>
      <div id="railBadge" class="rail-badge" aria-hidden="true"></div>
      <div id="railTip" class="rail-tip hidden" aria-hidden="true"></div>
      <div id="turnRailClip" class="turn-rail-clip"><div id="turnRailSize" class="turn-rail-size"></div><div id="turnRailThumb" class="turn-rail-thumb" role="slider" aria-label="轨道位置"></div></div>
      <div id="turnRailWheel" class="turn-rail-wheel" aria-hidden="true"></div>
    </div>
    <footer class="composer-wrap">
      <div id="dropHint" class="drop-hint hidden">松开以附带文件</div>
      <div id="queueDock" class="queue-dock hidden" aria-label="排队消息"></div>
      <div class="composer">
        <div id="modeChips" class="mode-chips hidden" aria-label="当前协作模式"></div>
        <div id="draftZone" class="draft-zone hidden">
          <div id="contextChips" class="context-chips hidden" aria-label="编辑器上下文"></div>
          <div id="attachments" class="attachments hidden"></div>
        </div>
        <div id="mentionMenu" class="command-menu hidden" role="listbox" aria-label="文件与文件夹"></div>
        <div id="commandMenu" class="command-menu hidden" role="listbox" aria-label="DeepSeek 命令"></div>
        <div id="policyMenu" class="command-menu policy-menu hidden" role="menu" aria-label="模式与权限"></div>
        <textarea id="prompt" rows="3" placeholder="向 DeepSeek 提问…" aria-label="向 DeepSeek 发送消息"></textarea>
        <div class="composer-row">
          <div class="left-actions">
            <button id="includeContext" class="icon-button include-context" title="随提示附上当前文件与选区" aria-label="随提示附上当前文件与选区"><svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="m9.5 14.5 2.2 2.2 4.3-4.3"/></svg></button>
            <button id="attach" class="icon-button" title="附加图片或文件（也可直接拖入 / 粘贴）" aria-label="附加图片或文件"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
            <button id="policyTrigger" class="icon-button policy-trigger hidden" title="模式与权限" aria-label="模式与权限" aria-haspopup="menu" aria-expanded="false"><svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.7 2.8 8 7 10 4.2-2 7-5.3 7-10V6z"/><path d="m9.5 12 1.6 1.6 3.5-3.6"/></svg></button>
            <!-- G6 v1（0.0.62）: 设置台入口（0.0.63: 动效按钮从草稿栏移入设置面板） -->
            <button id="settingsOpen" class="icon-button" title="设置" aria-label="设置"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
          </div>
          <div class="model-picks">
            <select id="models" class="model-select" aria-label="模型"></select>
            <select id="efforts" class="effort-select" aria-label="推理强度"></select>
          </div>
          <div class="run-actions">
            <div id="usageControl" class="usage-control hidden">
              <button id="usageTrigger" class="icon-button usage-trigger" title="上下文已用" aria-label="上下文已用" aria-haspopup="dialog" aria-expanded="false"><svg viewBox="0 0 14 14"><circle class="usage-track" cx="7" cy="7" r="5.5"/><circle id="usageFill" class="usage-fill" cx="7" cy="7" r="5.5" transform="rotate(-90 7 7)"/></svg></button>
              <div id="usagePanel" class="usage-panel hidden" role="dialog" aria-label="上下文已用详情"></div>
            </div>
            <button id="cancel" class="icon-button cancel hidden" title="停止" aria-label="停止"><svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1"/></svg></button>
            <button id="send" class="icon-button send" title="发送（Enter）" aria-label="发送"><svg viewBox="0 0 24 24"><path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/></svg></button>
          </div>
        </div>
        <div id="usageStats" class="usage-stats hidden"></div>
      </div>
    </footer>
  </div>
  <div id="imagePreview" class="image-preview hidden"><canvas id="imagePreviewCanvas" draggable="false" class="image-preview-canvas"></canvas><div id="previewBar" class="preview-bar"><div id="previewControls" class="preview-controls hidden"><button id="previewPlay" class="preview-action preview-action-text" type="button">停止</button><button id="previewPrev" class="preview-action preview-action-text" type="button">上一帧</button><button id="previewNext" class="preview-action preview-action-text" type="button">下一帧</button><span id="previewFrameLabel" class="preview-frame-label"></span><label id="previewSelectWrap" class="preview-select hidden"><input type="checkbox" id="previewSelect"> 选择发送</label></div><div id="previewHint" class="image-preview-hint"><span id="previewHintText">左键拖动 · 滚轮缩放 · 右键/ESC 退出</span><span id="zoomValue"></span><button id="previewReset" class="preview-action" title="复位（居中并适应窗口）" aria-label="复位">⟲</button></div></div></div>
  <div id="ctxMenu" class="ds-menu ctx-menu hidden" role="menu" aria-label="上下文操作"></div>
  <!-- 0.0.78（GIF③）: 发送指定帧——草稿 GIF 的选帧器（webview 解码帧 → 转 PNG 发送） -->
  <div id="framePicker" class="frame-picker hidden" role="dialog" aria-label="选择发送帧">
    <div class="frame-picker-box">
      <div class="frame-picker-head"><span id="framePickerTitle">选择发送帧</span><button id="framePickerClose" class="settings-close" title="关闭" aria-label="关闭">✕</button></div>
      <div id="framePickerGrid" class="frame-picker-grid"></div>
      <div class="frame-picker-foot"><span id="framePickerInfo" class="frame-picker-info"></span><button id="framePickerDefault" class="settings-action">清除选择（发送整张动图）</button></div>
    </div>
  </div>
  <!-- G6 v1（0.0.62）: 设置台面板（侧栏内全屏覆盖层；内容由 renderSettingsPanel 构建） -->
  <div id="settingsPanel" class="settings-panel hidden" role="dialog" aria-label="设置">
    <div class="settings-head">
      <span class="settings-title">设置</span>
      <button id="settingsClose" class="settings-close" title="关闭" aria-label="关闭">✕</button>
    </div>
    <div id="settingsBody" class="settings-body"></div>
  </div>
  <!-- C3 (0.0.69): 上下文面板（数据源=dsh-context 插件投影；缺席时入口隐藏，面板显示提示） -->
  <div id="contextPanel" class="context-panel hidden" role="dialog" aria-label="上下文">
    <div class="context-head">
      <span class="context-title">上下文</span>
      <button id="contextClose" class="settings-close" title="关闭" aria-label="关闭">✕</button>
    </div>
    <div id="contextBody" class="context-body"></div>
  </div>
  <div id="ctxTip" class="ctx-tooltip hidden"></div>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <!-- 0.1.76（T3-6）：跨会话搜索跳转后的「返回搜索起点」胶囊（0.1.88 语义重建：目标锚搜索起点、跳转不改写）
       0.1.82（用户需求）：右侧加独立关闭按钮（button 不可嵌套 ⇒ 外层改 div，内层两枚 button）。 -->
  <div id="searchReturnPill" class="search-return-pill hidden">
    <button id="searchReturnPillGo" class="search-return-pill-go" type="button"></button>
    <button id="searchReturnPillClose" class="search-return-pill-close" type="button" title="关闭" aria-label="关闭返回提示">✕</button>
  </div>
  <!-- G15 (0.0.30): vendor scripts MUST come before the main script — the main
       IIFE reads window.__g15md once at load, so the markdown bundle must be
       defined first (load-order regression fixed 2026-09-03 00:0x). -->
  <script nonce="${token}">${vendoredImageCodecs()}</script>
  <script nonce="${token}">${vendoredMarkdown()}</script>
  <script nonce="${token}">${vendoredColorUtils()}</script>
  <script nonce="${token}">${vendoredOriginalTextMap()}</script>
  <script nonce="${token}">
    ${vendoredChrome()}
    /* G45（0.0.103）：MathJax 资源 URI（「复制为 SVG」懒加载用；扩展侧 asWebviewUri 注入，探针/单测缺省空串）。 */
    window.__mathjaxUri = ${JSON.stringify(mathjaxUri === undefined ? '' : String(mathjaxUri))};
    const vscode = acquireVsCodeApi();
    /* 0.0.56（审核 P2）: 上报带位置与栈首行——此前只有一段 message，输出通道无法定位。 */
    window.addEventListener('error', event => {
      const where = String(event.filename || '') + ':' + String(event.lineno || 0);
      const stack = event.error && event.error.stack ? String(event.error.stack).replace(/\\n/g, ' | ').slice(0, 200) : '';
      vscode.postMessage({ type: 'webview-error', message: (event.message || 'Unknown webview error') + ' @' + where + (stack === '' ? '' : ' ::' + stack) });
    });
    window.addEventListener('unhandledrejection', event => {
      const error = event.reason;
      const reason = error instanceof Error ? error.message + (error.stack ? ' ::' + String(error.stack).replace(/\\n/g, ' | ').slice(0, 200) : '') : String(error || 'Unknown promise rejection');
      vscode.postMessage({ type: 'webview-error', message: reason });
    });
    const elements = {
      conversation: document.getElementById('conversation'), scroll: document.getElementById('scroll'),
      conversationStatus: document.getElementById('conversationStatus'), conversationHistory: document.getElementById('conversationHistory'), messages: document.getElementById('messages'), conversationTail: document.getElementById('conversationTail'),
      a7Progress: document.getElementById('a7-progress'), a7Thinking: document.getElementById('a7-thinking'),
      restoreStatus: document.getElementById('restoreStatus'), restoreStatusText: document.getElementById('restoreStatusText'), restoreStop: document.getElementById('restoreStop'),
      historyJumpStatus: document.getElementById('historyJumpStatus'), historyJumpStatusText: document.getElementById('historyJumpStatusText'), historyJumpContinue: document.getElementById('historyJumpContinue'), historyJumpStop: document.getElementById('historyJumpStop'),
      bootPlaceholder: document.getElementById('bootPlaceholder'),
      sessions: document.getElementById('sessions'), sessionTabs: document.getElementById('sessionTabs'), newSession: document.getElementById('newSession'), jobsControl: document.getElementById('jobsControl'), jobsTrigger: document.getElementById('jobsTrigger'), jobsCount: document.getElementById('jobsCount'), jobsMenu: document.getElementById('jobsMenu'),
      tabSearch: document.getElementById('tabSearch'), tabSearchInput: document.getElementById('tabSearchInput'), tabSearchCount: document.getElementById('tabSearchCount'), tabSearchClose: document.getElementById('tabSearchClose'), tabSearchToggle: document.getElementById('tabSearchToggle'), tabSearchResults: document.getElementById('tabSearchResults'),
      prompt: document.getElementById('prompt'),
      models: document.getElementById('models'), efforts: document.getElementById('efforts'),
      policyTrigger: document.getElementById('policyTrigger'), policyMenu: document.getElementById('policyMenu'),
      send: document.getElementById('send'), cancel: document.getElementById('cancel'),
      usageControl: document.getElementById('usageControl'), usageTrigger: document.getElementById('usageTrigger'), usageFill: document.getElementById('usageFill'), usagePanel: document.getElementById('usagePanel'), usageStats: document.getElementById('usageStats'),
      attach: document.getElementById('attach'), attachments: document.getElementById('attachments'), draftZone: document.getElementById('draftZone'), ctxMenu: document.getElementById('ctxMenu'), includeContext: document.getElementById('includeContext'), toast: document.getElementById('toast'), searchReturnPill: document.getElementById('searchReturnPill'), searchReturnPillGo: document.getElementById('searchReturnPillGo'), searchReturnPillClose: document.getElementById('searchReturnPillClose'),
      turnRail: document.getElementById('turnRail'), turnRailPrepare: document.getElementById('turnRailPrepare'), turnRailClip: document.getElementById('turnRailClip'), turnRailThumb: document.getElementById('turnRailThumb'), turnRailWheel: document.getElementById('turnRailWheel'), turnRailSize: document.getElementById('turnRailSize'), railBadge: document.getElementById('railBadge'), railTip: document.getElementById('railTip'),
      settingsOpen: document.getElementById('settingsOpen'), settingsPanel: document.getElementById('settingsPanel'), settingsBody: document.getElementById('settingsBody'), settingsClose: document.getElementById('settingsClose'),
      contextPanel: document.getElementById('contextPanel'), contextBody: document.getElementById('contextBody'), contextClose: document.getElementById('contextClose'), ctxTip: document.getElementById('ctxTip'),
      imagePreview: document.getElementById('imagePreview'), imagePreviewCanvas: document.getElementById('imagePreviewCanvas'), zoomValue: document.getElementById('zoomValue'), previewReset: document.getElementById('previewReset'), previewHint: document.getElementById('previewHint'), previewHintText: document.getElementById('previewHintText'), previewBar: document.getElementById('previewBar'),
      previewControls: document.getElementById('previewControls'), previewPlay: document.getElementById('previewPlay'), previewPrev: document.getElementById('previewPrev'), previewNext: document.getElementById('previewNext'), previewFrameLabel: document.getElementById('previewFrameLabel'), previewSelectWrap: document.getElementById('previewSelectWrap'), previewSelect: document.getElementById('previewSelect'), framePickerTitle: document.getElementById('framePickerTitle'),
      framePicker: document.getElementById('framePicker'), framePickerGrid: document.getElementById('framePickerGrid'), framePickerClose: document.getElementById('framePickerClose'), framePickerDefault: document.getElementById('framePickerDefault'), framePickerInfo: document.getElementById('framePickerInfo'),
      queueDock: document.getElementById('queueDock'),
      modeChips: document.getElementById('modeChips'), contextChips: document.getElementById('contextChips'), mentionMenu: document.getElementById('mentionMenu'), commandMenu: document.getElementById('commandMenu'),
    };
    let state;
    let includeContextOn = true;
    let draftImages = [];
    let ideContext = { pinned: [] };
    let commandIndex = 0;
    /* G19: per-session draft slots — save-out the outgoing composer on switch, restore the incoming one */
    const draftSlots = new Map();
    let lastDraftSessionId = undefined;
    /* G22 bug⑥: report which sessions hold an unsent draft (text/images) so the extension keeps them visible in the blank filter */
    function publishDraftState() {
      const sessionIds = [];
      for (const [sessionId, slot] of draftSlots) {
        if (((slot && slot.text) || '').trim() !== '' || (slot.images || []).length > 0) sessionIds.push(sessionId);
      }
      vscode.postMessage({ type: 'draft-state', sessionIds });
    }
    /* 0.0.161（用户需求）：文本草稿持久化上报（去抖 400ms；图片由扩展在变更点单独落盘——
       这里只带 text，避免每次按键搬运 dataURL）。会话切换时对**上一会话**立即冲刷。 */
    let persistDraftTimer;
    function persistDraftNow(sessionIdOverride) {
      if (persistDraftTimer !== undefined) { clearTimeout(persistDraftTimer); persistDraftTimer = undefined; }
      const sessionId = typeof sessionIdOverride === 'string' && sessionIdOverride !== '' ? sessionIdOverride : lastDraftSessionId;
      if (typeof sessionId !== 'string' || sessionId === '') return;
      const slot = draftSlots.get(sessionId);
      const text = sessionId === lastDraftSessionId ? elements.prompt.value : ((slot && slot.text) || '');
      vscode.postMessage({ type: 'persist-draft', sessionId, text });
    }
    function schedulePersistDraft() {
      if (persistDraftTimer !== undefined) clearTimeout(persistDraftTimer);
      persistDraftTimer = setTimeout(() => { persistDraftTimer = undefined; persistDraftNow(); }, 400);
    }
    let mentionIndex = 0;
    let mentionRequestId = 0;
    let mentionCandidates = [];
    let queueEditing = null;
    let queueRenderSignature = '';
    let policyMenuOpen = false;
    let sessionTitles = {};
    let usageOpen = false;
    /* 0.0.163（审查 P1-2）：存储区快照（打开设置面板时 describe-storage 拉取；undefined=未拉取）。 */
    let storageEntries;
    let jobsOpen = false;
    let jobsTimer;
    let historyAnchor;
    let renderFrame;
    let pendingRenderState;
    let followConversationTail = true;
    let tailScrollFrame;
    let renderedSessionId;
    let renderedStatusKey = '';
    let renderedHistoryKey = '';
    let renderedTail = {};
    let renderedChrome = {};
    const renderedMessages = new Map();
    /* G6 (0.0.60): 视图设置快照——变化 → 整会话重建（渲染期读取项不回溯，见 renderConversation）。 */
    let renderedViewCfgKey = '';
    const viewCfgKeyOf = current => JSON.stringify([
      current.copySettings || null,
      current.foldSettings || null,
      current.markdownImages === true,
      current.imageCopyFormat || '',
      /* 0.1.44（D3 懒建）：开关进键——开→关时必须整会话重建。否则 DOM 缓存命中会挂回
         "带未补建外壳"的旧树，而关掉后补建逻辑不再运行 ⇒ 内容永久缺失。 */
      current.uiSettings === undefined || current.uiSettings === null ? null : current.uiSettings.lazyFoldedBodies === true,
      /* 0.1.45（D1 悬停动作行）：开关进键——开→关必须整会话重建（静止行 / 常显整行两套 DOM 不互通）。 */
      current.uiSettings === undefined || current.uiSettings === null ? null : current.uiSettings.hoverActions !== false,
    ]);
    /* G39（0.0.93）：切会话视图记忆——expandedToolIds 现在指向"当前会话"的分桶 Set
       （切会话只换指针、不清空）；fold 记忆按消息 id 存手动展开/收起态。 */
    let expandedToolIds = new Set();
    const loadingToolRequests = new Map();
    const toolOutputErrors = new Map();
    const toolOutputPages = new Map();
    const deferredOutputViews = new Map();
    const pendingMessageAppends = new Map();
    const claimedEchoIds = new Set();
    let lastEchoAnchorId;
    let toolOutputRequestId = 0;
    const toolOutputChunkSize = 20000;

    /* ---- G39（0.0.93/v2）: 每会话视图记忆（滚动位置 / 工具卡展开态 / 手动折叠态 / 超高块折叠）----
       内存表为权威；经扩展持久化（workspaceState），Reload 后由 'view-state' 消息在首帧前回填。
       三开关（deepseekHarness.sessionViewMemory.*）分别门控；关闭 = 回到旧行为（切回在底部/收起）。
       v2 修正（用户复测）：① 超高块折叠（代码/引用/表格）此前"仅存 DOM"→ 纳入 blocks 记忆（键=消息 id#源行）；
       ② 位置恢复从"单帧一次性"改为**锚点 + 校正窗口**——切回/Reload 后内容可能分多段到达
       （历史加载/折叠结算/图片解码都会改上方高度），窗口内以"顶部可见消息+偏移"为准反复校正，
       用户一旦自己滚动即停止（不打扰）。 */
    const viewMemoryCfg = () => (state && state.sessionViewMemory) || { scroll: true, expand: true, fold: true };
    const viewMemo = new Map(); /* sessionId -> { scrollTop, atBottom, anchorId, anchorOffset, anchorSeq, expanded:Set, folds:Map, blocks:Map, marks:Map, stars:Set } */
    const VIEW_MEMO_CAP = 32;
    const VIEW_MEMO_ENTRY_CAP = 200;
    let viewStateRevision = 0;
    function trimViewMemoEntries(memo) {
      for (const field of ['expanded', 'folds', 'blocks', 'marks', 'stars', 'railDropped']) {
        const entries = memo[field];
        while (entries.size > VIEW_MEMO_ENTRY_CAP) entries.delete(entries.keys().next().value);
      }
    }
    function trimViewMemo() {
      for (const sessionId of viewMemo.keys()) {
        if (viewMemo.size <= VIEW_MEMO_CAP) break;
        if (sessionId === renderedSessionId || (state && sessionId === state.sessionId)) continue;
        if (viewStateSendTimers.has(sessionId)) scheduleViewStatePersist(sessionId, 'capacity', true);
        viewMemo.delete(sessionId);
      }
    }
    /* 0.0.156（用户反馈）：收藏（stars，金色）与标注（marks，文本）独立——编辑标注不再自动收藏。 */
    function viewMemoOf(sessionId) {
      let memo = viewMemo.get(sessionId);
      if (!memo) { memo = { scrollTop: 0, atBottom: true, anchorId: undefined, anchorOffset: 0, anchorSeq: undefined, anchorIndex: undefined, expanded: new Set(), folds: new Map(), blocks: new Map(), marks: new Map(), stars: new Set(), railDropped: new Map() }; viewMemo.set(sessionId, memo); }
      else { viewMemo.delete(sessionId); viewMemo.set(sessionId, memo); }
      trimViewMemoEntries(memo);
      trimViewMemo();
      return memo;
    }
    let restoreCtx; /* { sessionId, top, anchorId, anchorOffset, anchorSeq, deadline, userTouched, kind, throughTried } | undefined */
    /* 0.1.124（数据层根治）：恢复穿透的独立目标存档——校正窗口可能中途收窗（超时/用户接管），
       restore-through-ready 到达时凭它重定位（不依赖 restoreCtx 存活）。 */
    let restoreThroughTarget; /* { sessionId, anchorId, anchorOffset, anchorSeq } | undefined */
    let restoreApplyFrame;
    let programmaticScroll = false;
    /* 0.1.29：上一次见到的 scrollTop（事件与**自写**都更新）——用于识别"同一位置的回声 scroll
       事件"（见下面 scroll 监听里的 echo 判据）。初始 -1 让首个事件天然算"变化"。 */
    let lastScrollSeen = -1;
    let lastScrollExtent = -1;
    function markScrollSeen() {
      lastScrollSeen = Math.round(elements.scroll.scrollTop);
      lastScrollExtent = Math.max(0, elements.scroll.scrollHeight - elements.scroll.clientHeight);
    }
    /* 0.0.141：自写滚动时间戳——预取的"滚动路径"不得被程序性写入（尾巴跟随/视图校正/合并补偿）
       误触：阈值提前到 1.5 视口后，折叠后的小页落在底部时首帧就命中边际，会无意图地偷拉历史。
       滚轮路径（明确用户意图）不受此门限制。 */
    let selfScrollStamp = 0;
    /* G41 v1.2（0.0.101）：轮次导航跳转动画帧句柄（滚动监听/尾巴跟随据此让路） */
    let railAnimFrame;
    /* 0.0.141（用户需求：点节点时自绘滑块也应有滚动动画）：跳转动画期间滑块同曲线滑行——
       起点=点击瞬间的实际滑块顶端，终点=目标节点 y，进度复用滚动动画同一条缓动；
       动画结束/被打断即清空，随后沿用粘滞/映射逻辑。 */
    let railThumbGlideFrom;
    let railThumbGlideTo;
    let railThumbGlideY;
    /* 0.1.9（用户需求 B）：动画结束后再挂"跟随尾巴"的待办——运行中点末节点=跳真底；
       动画期间挂上会让流式增长的钉底写入与动画抢 scrollTop（表现为瞬间跳底、动画消失）。 */
    let railFollowAfterAnim = false;
    const VIEW_RESTORE_WINDOW_MS = 2500;
    /* 0.1.26：尺寸变化（拖动侧栏边界）的锚点校正窗口——比会话恢复窗口短，但每次 resize 事件都会续期。 */
    const RESIZE_ANCHOR_WINDOW_MS = 900;
    /* 0.0.141：历史合并后的"落定校正"窗口——合并帧之后布局还会异步变（折叠重测等），
       窗口内按参考元素持续回正；比 reload 校正窗口短（预览/正常合并都在亚秒内稳）。 */
    const MERGE_SETTLE_WINDOW_MS = 1200;
    const viewStateSendTimers = new Map(); /* sessionId -> timer（每会话独立去抖，互不顶掉） */
    function removeViewMemo(sessionId, revision) {
      if (!Number.isSafeInteger(revision) || revision <= viewStateRevision) return;
      const pending = [...viewStateSendTimers.keys()].filter(id => id !== sessionId);
      for (const timer of viewStateSendTimers.values()) clearTimeout(timer);
      viewStateSendTimers.clear();
      viewStateRevision = revision;
      viewMemo.delete(sessionId);
      if (restoreCtx && restoreCtx.sessionId === sessionId) clearRestoreCtx();
      if (restoreThroughTarget && restoreThroughTarget.sessionId === sessionId) clearRestoreThroughTarget();
      if (jumpPersistTimer !== undefined) {
        clearTimeout(jumpPersistTimer); jumpPersistTimer = undefined;
        if (renderedSessionId !== sessionId) armJumpPersist();
      }
      // All old callbacks carry the previous revision. Preserve valid pending
      // reports for other sessions under the new revision.
      for (const id of pending) scheduleViewStatePersist(id, 'delete-other-session');
    }
    function seedViewMemo(states) {
      if (!states || typeof states !== 'object') return;
      diagLoad('view-seed', { records: Object.keys(states).length, keys: Object.keys(states).slice(0, 6).map(k => String(k).slice(0, 12)) });
      for (const [sessionId, raw] of Object.entries(states)) {
        if (!sessionId || viewMemo.has(sessionId) || !raw || typeof raw !== 'object') continue;
        const memo = viewMemoOf(sessionId);
        if (typeof raw.scrollTop === 'number' && Number.isFinite(raw.scrollTop)) memo.scrollTop = Math.max(0, raw.scrollTop);
        memo.atBottom = raw.atBottom !== false;
        if (typeof raw.anchorId === 'string' && raw.anchorId !== '') memo.anchorId = raw.anchorId;
        if (typeof raw.anchorOffset === 'number' && Number.isFinite(raw.anchorOffset)) memo.anchorOffset = Math.round(raw.anchorOffset);
        if (typeof raw.anchorSeq === 'number' && Number.isFinite(raw.anchorSeq)) memo.anchorSeq = Math.round(raw.anchorSeq);
        if (typeof raw.railAnchorSeq === 'number' && Number.isFinite(raw.railAnchorSeq)
          && typeof raw.railAnchorOffset === 'number' && Number.isFinite(raw.railAnchorOffset)) {
          memo.railAnchorSeq = raw.railAnchorSeq; memo.railAnchorOffset = raw.railAnchorOffset;
          memo.railViewportManual = raw.railViewportManual === true;
        }
        if (typeof raw.anchorIndex === 'number' && Number.isFinite(raw.anchorIndex)) memo.anchorIndex = Math.max(0, Math.round(raw.anchorIndex));
        if (Array.isArray(raw.expanded)) memo.expanded = new Set(raw.expanded.filter(id => typeof id === 'string' && id !== ''));
        if (raw.folds && typeof raw.folds === 'object') {
          for (const [id, value] of Object.entries(raw.folds)) if (id && (value === 'folded' || value === 'expanded')) memo.folds.set(id, value);
        }
        if (raw.blocks && typeof raw.blocks === 'object') {
          for (const [key, value] of Object.entries(raw.blocks)) if (key && value === 'folded') memo.blocks.set(key, 'folded');
        }
        /* 0.0.148（G53）：轨道节点标注（值=标注文本）。0.0.156 起收藏独立存放 stars。 */
        if (raw.marks && typeof raw.marks === 'object') {
          for (const [key, value] of Object.entries(raw.marks)) if (key && typeof value === 'string') memo.marks.set(key, value);
        }
        /* 0.0.156：收藏集合。新数据带 stars（数组，空数组=真"零收藏"）；**旧数据无 stars 字段 →
           按旧语义"有标注键=已收藏"迁移**（升级后已收藏节点观感零变化）。 */
        if (Array.isArray(raw.stars)) {
          for (const key of raw.stars) if (typeof key === 'string' && key !== '') memo.stars.add(key);
        } else if (raw.marks && typeof raw.marks === 'object') {
          for (const key of Object.keys(raw.marks)) if (key !== '') memo.stars.add(key);
        }
        /* 0.1.9（用户需求）：轨道节点增删覆盖层（隐藏/合并两态；键规范同 marks）。 */
        if (raw.railDropped && typeof raw.railDropped === 'object') {
          for (const [key, value] of Object.entries(raw.railDropped)) if (key && (value === 'hidden' || value === 'merged')) memo.railDropped.set(key, value);
        }
      }
    }
    /* 顶部可见消息锚点：第一个"下缘越过视口顶"的节点（其 dataset.mid 必须存在，否则放弃锚点退回原始 top 恢复）。 */
    function captureViewAnchor() {
      if (conversationNearBottom()) return undefined;
      const scrollRect = elements.scroll.getBoundingClientRect();
      for (const child of elements.messages.children) {
        const rect = child.getBoundingClientRect();
        if (rect.bottom - scrollRect.top <= 0) continue;
        const id = child.dataset ? child.dataset.mid : undefined;
        /* 0.1.26：无 mid 的节点（工作段折叠条）跳过继续找——旧写法直接放弃，
           折叠条恰好是视口顶那条时锚点就丢了。 */
        if (typeof id !== 'string' || id === '') continue;
        /* 0.1.124（数据层根治）：锚点消息的事件 seq 一并带回（Reload 窗外恢复的穿透依据）。 */
        const anchorSeqValue = child.dataset !== undefined && child.dataset.seq !== undefined ? Number(child.dataset.seq) : NaN;
        return { id, offset: Math.round(scrollRect.top - rect.top), seq: Number.isFinite(anchorSeqValue) ? anchorSeqValue : undefined };
      }
      return undefined;
    }
    /* 0.1.26（用户实测：横向拖动侧栏边界 → 对话内容"飞"到别处）：宽度变化让所有行重排
       （实测 520→760 宽时内容总高 73k→60k px），scrollTop 数值没变而内容整体位移。
       关键点：**ResizeObserver 是"布局之后"通知**——那时再抓锚点已经是漂移后的位置，
       校正会变成"把漂移后的位置当成目标"（实测零效果）。所以改为**滚动时滚动维护**
       "视口顶那条消息 + 视口内偏移"缓存（rAF 合并、便宜），resize 到来时用缓存校正，
       并在之后每次布局落定重校正（复用 G39 的 restoreCtx / scheduleViewRestore）。
       贴底场景不校正：跟底逻辑会在重排后钉回底部（否则会与它抢）。 */
    let viewFocusAnchor;
    /* 0.1.28（用户实测"压缩到最小仍会飞"）：校正窗口必须有**结束判定**。旧实现只在 3 处赋
       undefined，窗口过期后 restoreCtx 一直悬挂 → refreshViewFocusAnchor 永久 early-return →
       锚缓存停更。后果：拖过一次之后，用户滚动改变了浏览位置，锚缓存仍是旧位置，**下一次拖动
       会把内容拽回旧锚点**（真机指纹：滚到 30% 再拖，内容跳回拖动前的 55% 处）。
       窗口结束必须"清理 + 补播缓存"，两件事一起做。 */
    /* 收窗自检：锚点是否真在它该在的位置（校正判据 delta=0）。0.1.28 实测：慢拖时"安静期"
       仍可能在两步之间到点，而那时布局刚漂过（内容变高、无人校正）——此时补播会把漂移后的
       位置固化成新锚点，漂移从此累积。不在位就不收窗，续期继续按锚回正（extendBudget 兜底）。 */
    /* 0.1.29：视口几何退化——侧栏被压到最小会**折叠/隐藏**（webview 宽度归零或 display:none）。
       此时页面不渲染、rect 全乱：贴底判定会误判、捕获锚点会抓到
       重排后的错误节点。实测（iframe 忠实复现"压到最小仍会飞"）：归零期间缓存被清空/收窗，
       恢复后无锚可校正 → 内容整段飞走（锚点 +1115 → +4250，35/36 帧偏离）。
       退化期间一律"保持现状"：不更新缓存、不收窗、不写滚动，等几何恢复后照常回正。 */
    function viewportDegenerate() {
      return elements.scroll.clientWidth === 0 || elements.scroll.clientHeight === 0;
    }
    function restoreAnchorInPlace(ctx) {
      if (viewportDegenerate()) return false;                    /* 量不准 → 不算"在位"，不收窗 */
      if (typeof ctx.anchorId !== 'string' || ctx.anchorId === '') return true;
      let node;
      for (const child of elements.messages.children) {
        if (child.dataset && child.dataset.mid === ctx.anchorId) { node = child; break; }
      }
      if (node === undefined) {
        const floor = firstLoadedSeq();
        // A slow cold load may outlive the restore window. A saved target before
        // this page still needs restore-through; absence is not completion.
        if (ctx.throughTried !== true && typeof ctx.anchorSeq === 'number' && floor !== undefined && ctx.anchorSeq < floor) return false;
        return true;
      }
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return true;    /* 已被折叠隐藏 → 无法维持，允许收窗 */
      const scrollRect = elements.scroll.getBoundingClientRect();
      return Math.abs((rect.top - scrollRect.top) + ctx.anchorOffset) <= 2;
    }
    function restoreWindowOver(ctx) {
      if (ctx === undefined) return true;
      if (ctx.userTouched === true) return true;
      if (Date.now() <= ctx.deadline) return false;
      /* 0.1.32（真机日志定案）：**内容未就绪前不收窗**——恢复窗口开在 loading 阶段（messages 只有
         尾页、消息区还是空的），那时"锚点在位"的自检会因为空DOM而通过（真机实测 restore-close
         applies=2 落在全量 2261 条渲染之前 46ms）→ 收窗后视图停在顶部。未就绪就续期等它。 */
      const notReady = state === undefined || state === null || state.phase !== 'ready'
        || state.loadingHistory === true
        || (Array.isArray(state.messages) && state.messages.length > 0 && elements.messages.childElementCount * 2 < state.messages.length);
      if (notReady) { extendRestoreWindow(); return false; }
      if (restoreAnchorInPlace(ctx)) return true;
      extendRestoreWindow();
      return false;
    }
    let restoreCtxTimer;
    /* 窗口结束的**兜底**：没有后续滚动/resize 事件时（用户只是看着会话，或切回会话后不动），
       也必须在截止时刻清理并补播锚缓存——否则"恢复后未滚动过就拖边界"整段无锚可校正。 */
    function armRestoreWindowWatch() {
      if (restoreCtxTimer !== undefined) { clearTimeout(restoreCtxTimer); restoreCtxTimer = undefined; }
      const ctx = restoreCtx;
      if (ctx === undefined) return;
      restoreCtxTimer = setTimeout(() => {
        restoreCtxTimer = undefined;
        if (restoreCtx !== ctx) return;   /* 已被替换/清除 */
        /* 到点也要过自检：锚点不在位 → 续期并按锚回正（见 restoreWindowOver）。同步回正：
           定时器不受 rAF 饿死影响（快拖时主线程被重排占满，rAF 可能几百 ms 才轮到一帧）。 */
        if (!restoreWindowOver(ctx)) { applyViewRestoreNow(); return; }
        clearRestoreCtx();
        refreshViewFocusAnchor();
        if (!ctx.userTouched && ctx.sessionId === renderedSessionId && ['switch', 'restore-through', 'view-cfg-rebuild'].includes(ctx.kind)) {
          scheduleViewStatePersist(ctx.sessionId, 'restore-settle', true);
        }
      }, Math.max(16, ctx.deadline - Date.now() + 16));
    }
    function openRestoreWindow(ctx) {
      /* 0.1.30：拖动冻结的收尾——上一个窗口是"拖动类"而新窗口不是（会话切换等）时，
         冻结必须解除并补一次重测（否则轨道停在被冻结的旧布局上）。 */
      if (restoreCtx !== undefined && restoreCtx.resize === true && ctx.resize !== true) scheduleRailMeasure();
      ctx.extendBudget = RESTORE_WINDOW_MAX_MS;
      restoreCtx = ctx;
      armRestoreWindowWatch();
    }
    /* 0.1.28：校正窗口从"固定时长"改为**安静期**——布局每变化一次续期 RESTORE_WINDOW_EXTEND_MS，
       连续安静这么久才算结束。真机：大文档（20 万 px）一次重排就要 ~1s，固定 900ms 会在两步
       拖动之间过期；过期后折叠重测/图片解码继续改上方高度而无人校正，过期补播把"已漂移的
       位置"固化成新锚点 → 漂移从此累积（"压缩到最小仍会飞"的真相）。
       extendBudget 是安全阀：极端情况下布局永不安静时，窗口也不会无限延长。 */
    const RESTORE_WINDOW_EXTEND_MS = 900;
    const RESTORE_WINDOW_MAX_MS = 60_000;
    function extendRestoreWindow() {
      if (restoreCtx === undefined || restoreCtx.userTouched === true) return;
      const budget = restoreCtx.extendBudget === undefined ? RESTORE_WINDOW_MAX_MS : restoreCtx.extendBudget;
      if (budget <= 0) return;
      const step = Math.min(RESTORE_WINDOW_EXTEND_MS, budget);
      restoreCtx.extendBudget = budget - step;
      restoreCtx.deadline = Date.now() + step;
      armRestoreWindowWatch();
    }
    function clearRestoreCtx() {
      if (restoreCtxTimer !== undefined) { clearTimeout(restoreCtxTimer); restoreCtxTimer = undefined; }
      const wasResizeDrag = restoreCtx !== undefined && restoreCtx.resize === true;
      const wasHistoryMerge = restoreCtx !== undefined && restoreCtx.kind === 'history-merge';
      const wasSessionRestore = restoreCtx !== undefined && restoreCtx.userTouched !== true
        && (restoreCtx.kind === 'switch' || restoreCtx.kind === 'restore-through');
      if (restoreCtx !== undefined && restoreCtx.resize !== true) {
        diagLoad('restore-close', {
          sessionId: restoreCtx.sessionId, applies: restoreCtx.applies === undefined ? 0 : restoreCtx.applies,
          lastDelta: restoreCtx.lastDelta === undefined ? 0 : restoreCtx.lastDelta,
          scrollTop: Math.round(elements.scroll.scrollTop),
        });
      }
      restoreCtx = undefined;
      if (wasSessionRestore && Date.now() >= railManualUntil) railRevealPending = true;
      /* 0.1.30：拖动结束 → 轨道解冻并**一次性重测重排**（拖动期间被冻结，期间没有别的时机补上）。 */
      if (wasResizeDrag || wasHistoryMerge || wasSessionRestore) scheduleRailMeasure();
    }
    function refreshViewFocusAnchor() {
      if (state === undefined || state === null) { viewFocusAnchor = undefined; return; }
      /* 几何退化（折叠/隐藏中）→ 缓存保持原值，绝不用退化几何重捕获（见 viewportDegenerate）。 */
      if (viewportDegenerate()) return;
      /* 校正窗口**开着**时不更新缓存：拖动过程中浏览器会把变矮的内容钳到新 max，
         那一刻 conversationNearBottom() 短暂为真——若照单全收，缓存会被置空，
         下一次拖动就没锚可用（实测"从下限展宽仍会飞"就是这个二跳）。
         窗口**已结束**（过期/用户接管）则必须清掉再照常更新（见上）。 */
      if (restoreCtx !== undefined) {
        if (!restoreWindowOver(restoreCtx)) return;
        clearRestoreCtx();
      }
      if (followConversationTail || conversationNearBottom()) { viewFocusAnchor = undefined; return; }
      viewFocusAnchor = captureViewAnchor();
    }
    let viewFocusAnchorFrame;
    function scheduleViewFocusAnchor() {
      if (viewFocusAnchorFrame !== undefined) return;
      viewFocusAnchorFrame = window.requestAnimationFrame(() => { viewFocusAnchorFrame = undefined; refreshViewFocusAnchor(); });
    }
    function beginResizeAnchor() {
      if (state === undefined || state === null || typeof state.sessionId !== 'string' || state.sessionId === '') return;
      if (viewportDegenerate()) return;
      // A reveal resize must keep the explicit saved target, rather than replace
      // it with the nearest tail-page anchor captured before background loading.
      if (restoreCtx && !restoreCtx.userTouched && ['switch', 'restore-through', 'view-cfg-rebuild'].includes(restoreCtx.kind)) return;
      /* 判据必须全部取自**预存锚**：ResizeObserver 是布局后通知，此刻浏览器已经做完
         "内容变矮 → scrollTop 被钳到新 max"（实测 217,955→74,690 时 scrollTop 被钳到 max），
         再去问 conversationNearBottom() 会读到"已经在底部"而误判为跟底态、整段不校正——
         这正是"从下限展宽仍会飞"的原因。预存锚在滚动/渲染时就已把"贴底=undefined"判完。 */
      if (followConversationTail) { clearRestoreCtx(); return; }
      const anchor = viewFocusAnchor;
      if (anchor === undefined) return;
      openRestoreWindow({
        sessionId: state.sessionId,
        top: elements.scroll.scrollTop,
        anchorId: anchor.id,
        anchorOffset: anchor.offset,
        deadline: Date.now() + RESIZE_ANCHOR_WINDOW_MS,
        userTouched: false,
        resize: true,
      });
      scheduleViewRestore();
    }

    /* 0.1.31（P1）：把"视口顶那条"的 mid 反查成消息列表下标（合成 mid 如 assistant:12:3 需遍历
       renderedMessages 的节点）。找不到返回 undefined（优先片退回尾部策略）。 */
    function messageIndexOfAnchorMid(mid) {
      if (typeof mid !== 'string' || mid === '' || state === undefined || state === null) return undefined;
      const list = array(state.messages);
      for (const [id, rendered] of renderedMessages) {
        if (rendered === undefined || rendered.node === undefined) continue;
        if (rendered.node.dataset !== undefined && rendered.node.dataset.mid === mid) {
          const index = list.findIndex(message => message !== undefined && message !== null && message.id === id);
          if (index >= 0) return index;
        }
      }
      for (let i = 0; i < list.length; i += 1) if (list[i] !== undefined && list[i] !== null && list[i].id === mid) return i;
      return undefined;
    }
    /* 0.0.141：历史合并的参考元素——与 captureViewAnchor 同思路，但**跳过无 mid 的节点**
       （折叠条等）而不是放弃；偏移不取整（合并补偿判据 <1px）。 */
    function captureHistoryAnchorRef() {
      if (conversationNearBottom()) return undefined;
      const scrollRect = elements.scroll.getBoundingClientRect();
      for (const child of elements.messages.children) {
        const rect = child.getBoundingClientRect();
        if (rect.bottom - scrollRect.top <= 0) continue;
        const id = child.dataset ? child.dataset.mid : undefined;
        if (typeof id !== 'string' || id === '') continue;
        /* 0.1.128：seq 一并带回——合并窗期间的"锚点身份"活动推导（见 updateRailActive）用它。 */
        const seqValue = child.dataset !== undefined && child.dataset.seq !== undefined ? Number(child.dataset.seq) : NaN;
        return { id, offset: scrollRect.top - rect.top, seq: Number.isFinite(seqValue) ? seqValue : undefined };
      }
      return undefined;
    }
    /* 0.1.32（真机日志定案）：**内容未就绪时不得记账**——切走/重载瞬间若会话正处于 loading
       （messages 只有尾页）、或消息区被清空，scrollTop 会读到 0、锚点读到会话第一条消息，
       如实写下去就"用坏数据覆盖好数据"（真机实测 view-report: scrollTop=0/atBottom=false/
       anchorId=第一条 user/-12 → 之后每次切回与 Reload 都恢复到顶部）。就绪判据三条全过才写。 */
    function viewMemoWritableNow() {
      if (state === undefined || state === null) return false;
      if (state.phase !== 'ready') return false;
      const el = elements.scroll;
      if (el === undefined || el === null || el.scrollHeight <= 0) return false;
      const total = Array.isArray(state.messages) ? state.messages.length : 0;
      const rendered = elements.messages === undefined || elements.messages === null ? 0 : elements.messages.childElementCount;
      return total === 0 || rendered * 2 >= total;
    }
    function captureScrollMemo(sessionId, withAnchor) {
      if (typeof sessionId !== 'string' || sessionId === '' || sessionId !== renderedSessionId) return;
      if (!viewMemo.has(sessionId)) return; // A delayed switch-away frame must not recreate a purged record.
      if (viewportDegenerate()) return;
      if (restoreThroughTarget && restoreThroughTarget.sessionId === sessionId) return;
      if (restoreCtx && restoreCtx.sessionId === sessionId && !restoreCtx.userTouched
        && ['switch', 'restore-through', 'view-cfg-rebuild'].includes(restoreCtx.kind)) return;
      if (!viewMemoWritableNow()) return;
      const memo = viewMemoOf(sessionId);
      memo.scrollTop = Math.max(0, Math.round(elements.scroll.scrollTop));
      memo.atBottom = conversationNearBottom();
      if (withAnchor === true && sessionId === renderedSessionId) {
        const anchor = captureViewAnchor();
        if (anchor) {
          memo.anchorId = anchor.id; memo.anchorOffset = anchor.offset;
          /* 0.1.124（数据层根治）：锚点 seq（Reload 窗外恢复的穿透依据）。 */
          memo.anchorSeq = anchor.seq;
          /* 0.1.31（P1）：同时记下该锚点在消息列表里的下标（优先片定位用；合成 mid 需反查节点）。 */
          memo.anchorIndex = messageIndexOfAnchorMid(anchor.id);
        } else if (memo.atBottom) { memo.anchorId = undefined; memo.anchorSeq = undefined; memo.anchorIndex = undefined; }
      }
    }
    function applyViewRestoreNow() {
      const ctx = restoreCtx;
      if (!ctx) return;
      /* 0.1.28：窗口结束（过期/用户接管）→ 清理并补播锚缓存；只 return 会让窗口永久悬挂。 */
      if (restoreWindowOver(ctx)) { clearRestoreCtx(); scheduleViewFocusAnchor(); return; }
      /* 几何退化期间不写滚动：此刻的 rect 不代表可用位置（写进去只会把滚动扔到别处）。 */
      if (viewportDegenerate()) return;
      if (!state || state.phase !== 'ready' || state.loadingHistory === true) return;
      if (!state || state.sessionId !== ctx.sessionId) return;
      selfScrollStamp = performance.now();
      let anchorNode;
      if (typeof ctx.anchorId === 'string') {
        for (const child of elements.messages.children) {
          if (child.dataset && child.dataset.mid === ctx.anchorId) { anchorNode = child; break; }
        }
      }
      if (anchorNode === undefined && ctx.kind === 'history-merge') { clearRestoreCtx(); return; }
      /* 0.1.124（数据层根治）：锚点在已加载窗口之外（长会话 Reload）→ 请求端侧穿透加载到锚点 seq；
         到载后回 restore-through-ready 重定位；失败走明确提示，绝不静默停在数值 clamp 位。 */
      if (anchorNode === undefined && ctx.throughTried !== true && typeof ctx.anchorSeq === 'number' && Number.isFinite(ctx.anchorSeq)) {
        const loadedFloor = firstLoadedSeq();
        if (loadedFloor !== undefined && ctx.anchorSeq < loadedFloor) {
          ctx.throughTried = true;
          restoreThroughTarget = { sessionId: ctx.sessionId, anchorId: ctx.anchorId, anchorOffset: ctx.anchorOffset || 0, anchorSeq: ctx.anchorSeq };
          diagLoad('restore-through', { sessionId: ctx.sessionId, seq: ctx.anchorSeq });
          syncRestoreThroughStatus();
          vscode.postMessage({ type: 'restore-through', seq: ctx.anchorSeq });
          /* 窗外锚点之前的最近可达位置是当前窗口首条。先显示它，后续页由分页锚定保持阅读位置。 */
          const before = elements.scroll.scrollTop;
          programmaticScroll = true;
          elements.scroll.scrollTop = 0;
          const firstMessage = [...elements.messages.children].find(child => child.dataset && child.dataset.mid);
          if (firstMessage) elements.scroll.scrollTop += firstMessage.getBoundingClientRect().top - elements.scroll.getBoundingClientRect().top;
          markScrollSeen();
          if (elements.scroll.scrollTop === before) programmaticScroll = false;
          historyAnchor = { sessionId: ctx.sessionId, height: elements.scroll.scrollHeight };
          clearRestoreCtx();
          return;
        }
      }
      const beforeTop = elements.scroll.scrollTop;
      programmaticScroll = true;
      /* 0.1.28：锚节点可能已被"工作段折叠"隐藏（work-folded → display:none）：零矩形的
         getBoundingClientRect 不代表内容位置，照算会把视图扔到别处（实测：恢复锚恰是被折叠
         的消息 → 校正把 scrollTop 钳到 0；拖动中折叠判定随宽度变化 → 锚点被折叠 → 失手）。
         零矩形锚视为不可用，退回记忆里的数值位置（保持不动，不跳）。 */
      const scrollRect = anchorNode === undefined ? undefined : elements.scroll.getBoundingClientRect();
      const anchorRect = anchorNode === undefined ? undefined : anchorNode.getBoundingClientRect();
      const anchorUsable = anchorRect !== undefined && (anchorRect.width > 0 || anchorRect.height > 0);
      if (anchorUsable) {
        elements.scroll.scrollTop += (anchorRect.top - scrollRect.top) + ctx.anchorOffset;
      } else {
        const max = Math.max(0, elements.scroll.scrollHeight - elements.scroll.clientHeight);
        elements.scroll.scrollTop = Math.min(ctx.top, max);
      }
      ctx.applies = (ctx.applies === undefined ? 0 : ctx.applies) + 1;
      ctx.lastDelta = Math.round(elements.scroll.scrollTop - beforeTop);
      /* 零位移不产生 scroll 事件 → 程序性标志不得悬挂（否则用户下一次真滚动会被当成程序性的，
         userTouched 不置位、校正窗口继续与用户抢滚动）。 */
      if (elements.scroll.scrollTop === beforeTop) programmaticScroll = false;
      markScrollSeen();
      if (railNavigationLocked && ctx.kind === 'history-merge') railStickyTarget = elements.scroll.scrollTop;
      /* 0.1.102：搜索走路期间若仍有校正窗口在回拉，留证（正常路径起跳前已终止窗口——
         这里再出现即说明还有别的窗口来源，探针/真机日志可据此继续收窄）。 */
      if (searchCursor !== undefined && tabQuery.trim() !== '') {
        searchTrace('restore-pull', { session: String(ctx.sessionId || '').slice(0, 20), kind: String(ctx.kind || ''), anchor: String(ctx.anchorId || ''), delta: ctx.lastDelta, searchMid: String(searchCursor.mid || '') });
      }
    }
    function syncRestoreThroughStatus() {
      const target = restoreThroughTarget;
      const active = Boolean(target && state && target.sessionId === state.sessionId);
      elements.restoreStatus.classList.toggle('hidden', !active);
      if (!active) return;
      elements.restoreStatusText.textContent = target.ready ? '正在定位上次阅读位置…'
        : '正在后台恢复上次阅读位置' + (target.pages > 0 ? ' · 已加载 ' + String(target.pages) + ' 批' : '…');
    }
    let historyJumpTarget;
    let historyJumpRequestId = 0;
    function syncHistoryJumpStatus() {
      const target = historyJumpTarget;
      const active = target && state && target.sessionId === state.sessionId;
      elements.historyJumpStatus.classList.toggle('hidden', !active);
      if (!active) return;
      elements.historyJumpStatusText.textContent = target.mode === 'loading'
        ? '正在加载目标历史 · 本次 ' + String(target.pages) + '/' + String(target.maxPages) + ' 批 · 累计 ' + String(target.totalPages + target.pages) + ' 批'
        : target.mode === 'ready' ? '正在定位目标…'
        : target.reason === 'error' ? '历史加载失败 · 已加载 ' + String(target.totalPages) + ' 批' + (target.canContinue ? '，可重试' : '，已停在最近位置')
        : target.canContinue ? '目标仍在更早历史中 · 已加载 ' + String(target.totalPages) + ' 批'
        : '仍无法定位目标 · 已停在最近位置';
      elements.historyJumpContinue.classList.toggle('hidden', target.mode !== 'paused' || !target.canContinue);
      elements.historyJumpContinue.textContent = target.reason === 'error' ? '重试加载' : '继续加载 ' + String(target.maxPages) + ' 批';
    }
    function clearHistoryJump() {
      historyJumpTarget = undefined;
      syncHistoryJumpStatus();
    }
    function startHistoryJump(kind, seq, search) {
      const target = { kind, seq, sessionId: state.sessionId, search, mode: 'loading', pages: 0, totalPages: 0, maxPages: 12, requestId: ++historyJumpRequestId };
      historyJumpTarget = target;
      if (historyAnchor === undefined) historyAnchor = { sessionId: target.sessionId, height: elements.scroll.scrollHeight };
      syncHistoryJumpStatus();
      vscode.postMessage({ type: 'load-turn', sessionId: target.sessionId, seq, requestId: target.requestId });
    }
    function continueHistoryJump() {
      const target = historyJumpTarget;
      if (!target || target.mode !== 'paused' || !target.canContinue || target.sessionId !== state?.sessionId) return;
      if (target.kind === 'search') {
        if (tabQuery.trim() !== target.search.query) { clearHistoryJump(); return; }
        pendingSearchJump = { ...target.search, loadRequested: true, historyReady: false, deadline: Date.now() + 30_000 };
        armSearchJumpPoll();
      } else {
        const node = railTurnList.find(candidate => candidate.seq === target.seq);
        if (!node) { clearHistoryJump(); showToast('目标节点已变化，请重新选择', true); return; }
        pendingRailJumpSeq = target.seq; pendingRailJumpSession = target.sessionId;
        railNavigationLocked = true; railNavigationSeq = target.seq; railNavigationId = node.id;
      }
      target.mode = 'loading'; target.pages = 0; target.requestId = ++historyJumpRequestId;
      if (historyAnchor === undefined) historyAnchor = { sessionId: target.sessionId, height: elements.scroll.scrollHeight };
      syncHistoryJumpStatus();
      vscode.postMessage({ type: 'load-turn', sessionId: target.sessionId, seq: target.seq, requestId: target.requestId });
    }
    elements.historyJumpContinue.addEventListener('click', continueHistoryJump);
    elements.historyJumpStop.addEventListener('click', () => {
      claimConversationScrollInput(); clearRestoreCtx();
      captureScrollMemo(renderedSessionId, true); scheduleViewStatePersist(renderedSessionId, 'history-jump-stop');
    });
    for (const control of [elements.historyJumpContinue, elements.historyJumpStop]) control.addEventListener('wheel', event => {
      claimConversationScrollInput(); elements.scroll.scrollTop += event.deltaY; event.preventDefault();
    }, { passive: false });
    function clearRestoreThroughTarget() {
      /* 停止连续恢复不撤销共享的在途页。loading 帧可能尚未绘制，先保留合并锚定入口。 */
      if (restoreThroughTarget && state && state.loadingHistory === true
        && restoreThroughTarget.sessionId === state.sessionId && renderedSessionId === state.sessionId
        && historyAnchor === undefined) historyAnchor = { sessionId: state.sessionId, height: elements.scroll.scrollHeight };
      restoreThroughTarget = undefined;
      syncRestoreThroughStatus();
    }
    function tryRestoreThroughReady() {
      const target = restoreThroughTarget;
      if (!target || !target.ready || !state || target.sessionId !== state.sessionId) return;
      if (viewportDegenerate() || renderedSessionId !== target.sessionId) return;
      const found = [...elements.messages.children].some(child => child.dataset && child.dataset.mid === target.anchorId);
      if (!found) return; // 回执可能先于去抖的正文状态到达，等待目标 DOM 后再恢复。
      clearRestoreThroughTarget();
      railRevealPending = true;
      openRestoreWindow({ sessionId: target.sessionId, top: elements.scroll.scrollTop,
        anchorId: target.anchorId, anchorOffset: target.anchorOffset || 0, anchorSeq: target.anchorSeq,
        deadline: Date.now() + 1500, userTouched: false, kind: 'restore-through', throughTried: true });
      scheduleViewRestore();
    }
    function scheduleViewRestore() {
      if (restoreApplyFrame !== undefined) return;
      restoreApplyFrame = requestAnimationFrame(() => { restoreApplyFrame = undefined; applyViewRestoreNow(); });
    }
    function startViewRestore(sessionId, memo, enabled, kind) {
      if (enabled !== true || memo.atBottom) { clearRestoreCtx(); return; }
      openRestoreWindow({
        sessionId, top: memo.scrollTop,
        anchorId: memo.anchorId, anchorOffset: memo.anchorOffset || 0, anchorSeq: memo.anchorSeq,
        deadline: Date.now() + VIEW_RESTORE_WINDOW_MS, userTouched: false,
        /* 窗口来源（'switch' / 'view-cfg-rebuild'）——轨道跟随等"内容位置的从动件"据此区分
           瞬态（视图配置重建）与正常切换。 */
        kind: typeof kind === 'string' ? kind : 'switch',
      });
      diagLoad('restore-open', {
        sessionId, kind: typeof kind === 'string' ? kind : 'switch', scrollTop: Math.round(memo.scrollTop), atBottom: memo.atBottom === true,
        anchorId: String(memo.anchorId || '').slice(0, 40), anchorOffset: Math.round(memo.anchorOffset || 0),
        anchorSeq: typeof memo.anchorSeq === 'number' ? memo.anchorSeq : undefined,
      });
    }
    /* 0.1.128（用户需求①）：跳转落位**即时**落盘——跳转后 600ms（动画落定）抓锚并经 urgent 链立即上报，
       不等 400ms/1s 两道去抖（跳转是低频显式动作，代价可忽略；滚动路径不受影响）。 */
    let jumpPersistTimer;
    function armJumpPersist() {
      const sessionId = renderedSessionId;
      const revision = viewStateRevision;
      if (typeof sessionId !== 'string' || sessionId === '') return;
      if (jumpPersistTimer !== undefined) clearTimeout(jumpPersistTimer);
      jumpPersistTimer = setTimeout(() => {
        jumpPersistTimer = undefined;
        if (revision !== viewStateRevision || sessionId !== renderedSessionId) return;
        captureScrollMemo(sessionId, true);
        scheduleViewStatePersist(sessionId, 'jump-settle', true);
      }, 600);
    }
    function scheduleViewStatePersist(sessionId, reason, urgent) {
      if (typeof sessionId !== 'string' || sessionId === '') return;
      const revision = viewStateRevision;
      const existing = viewStateSendTimers.get(sessionId);
      if (existing !== undefined) clearTimeout(existing);
      const send = () => {
        if (revision !== viewStateRevision) return;
        viewStateSendTimers.delete(sessionId);
        const memo = viewMemo.get(sessionId);
        if (!memo) return;
        trimViewMemoEntries(memo);
        /* 发送前刷新锚点（仅当 DOM 正显示该会话时可得）。 */
        if (sessionId === renderedSessionId && viewMemoryCfg().scroll) { captureScrollMemo(sessionId, true); rememberRailViewport(); }
        diagLoad('view-report', {
          sessionId, reason: typeof reason === 'string' ? reason : '', scrollTop: Math.round(memo.scrollTop),
          atBottom: memo.atBottom === true, anchorId: String(memo.anchorId || '').slice(0, 40), anchorOffset: Math.round(memo.anchorOffset || 0),
        });
        vscode.postMessage({
          type: 'session-view-state', sessionId, revision,
          scrollTop: memo.scrollTop, atBottom: memo.atBottom,
          anchorId: memo.anchorId, anchorOffset: memo.anchorOffset, anchorIndex: memo.anchorIndex,
          anchorSeq: memo.anchorSeq,
          railAnchorSeq: memo.railAnchorSeq, railAnchorOffset: memo.railAnchorOffset,
          railViewportManual: memo.railViewportManual === true,
          /* 0.1.128（用户需求①）：urgent=跳转落位即时链——扩展侧收此标记**立即写盘**（不等 1s 去抖）。 */
          ...(urgent === true ? { urgent: true } : {}),
          expanded: [...memo.expanded], folds: Object.fromEntries(memo.folds), blocks: Object.fromEntries(memo.blocks),
          /* 0.0.148（G53）：轨道节点标注；0.0.156：收藏独立上报（stars 数组，空数组=零收藏）。 */
          marks: Object.fromEntries(memo.marks),
          stars: [...memo.stars],
          /* 0.1.9：轨道节点增删覆盖层（隐藏/合并）。 */
          railDropped: Object.fromEntries(memo.railDropped),
        });
      };
      if (urgent === true) { send(); return; }
      viewStateSendTimers.set(sessionId, setTimeout(send, 400));
    }

    function conversationNearBottom() {
      return elements.scroll.scrollHeight - elements.scroll.scrollTop - elements.scroll.clientHeight < 80;
    }
    /* 0.0.108（用户补充②）：脱离阈值与恢复阈值分离（滞回）——恢复仍"近底 80px"，
       脱离需离底 ≥ TAIL_DETACH_PX（约两格滚轮/半屏拖拽），小幅上滚（查看后自然回底）
       不会误杀跟随。 */
    const TAIL_DETACH_PX = 240;
    function conversationDetached() {
      return elements.scroll.scrollHeight - elements.scroll.scrollTop - elements.scroll.clientHeight >= TAIL_DETACH_PX;
    }
    function scheduleTailScroll(force) {
      if (force) followConversationTail = true;
      if ((!followConversationTail && !force) || historyAnchor || tailScrollFrame !== undefined) return;
      tailScrollFrame = requestAnimationFrame(() => {
        tailScrollFrame = undefined;
        if (!historyAnchor && followConversationTail) {
          selfScrollStamp = performance.now();
          elements.scroll.scrollTop = elements.scroll.scrollHeight;
          markScrollSeen();
        }
      });
    }
    function detachConversationTail() {
      followConversationTail = false;
      if (tailScrollFrame !== undefined) {
        cancelAnimationFrame(tailScrollFrame);
        tailScrollFrame = undefined;
      }
    }
    function synchronizeConversationTail() {
      if (historyAnchor) return;
      if (railAnimFrame !== undefined || railNativeAnim === true) return;
      /* 0.1.29：校正窗口开着时位置由窗口负责（不是用户选的）→ 不据"此刻是否贴底"重开跟随。
         侧栏从折叠恢复时内容猛缩会把 scrollTop 钳到底部，据此重开跟随会把用户一路拽到最底
         （"压到最小再展开 → 飞到底部"的路径）。 */
      if (restoreCtx !== undefined && restoreCtx.userTouched !== true) return;
      if (conversationNearBottom()) followConversationTail = true;
      /* 滞回区（80–240px）内保持现状：跟随态继续跟随（下次内容增长拉回底），脱离态保持脱离。 */
      else if (followConversationTail && conversationDetached()) {
        /* 懒建/重建使正文长高时，旧贴底位置会瞬间远离新底部。这个几何事件不是用户
           上翻；scroll 的后续监听才更新 lastScrollExtent，故此处可与上次行程对账。
           真滚轮上翻由独立输入监听立即解除跟随，原生拖动在行程稳定时照常判定。 */
        const extent = Math.max(0, elements.scroll.scrollHeight - elements.scroll.clientHeight);
        if (lastScrollExtent >= 0 && extent !== lastScrollExtent) return;
        /* 0.1.15（用户实测"很高的失败卡把会话顶出底部吸附"）：自写钉底引发的 scroll 事件若恰逢内容
           又长高（一张失败卡一步 770px——探针实证的瞬态），此刻测得的"离底距离"不代表用户意图，
           不得据此脱离跟随。只有自写（钉底/校正/合并补偿）之外的滚动才判脱离；用户滚轮另有
           0.1.2 的"上滚即脱离"专用监听，不受本判据影响。 */
        if (performance.now() - selfScrollStamp < 150) return;
        detachConversationTail();
      }
    }
    elements.scroll.addEventListener('scroll', synchronizeConversationTail, { passive: true });
    /* 0.1.2（朋友反馈③）：滚轮向上 = 明确的上翻意图 → 立即脱离跟随（近底 80px 自动恢复不变）。
       此前需离底 ≥240px 才脱离，流式内容增长会把小幅上滚反复拉回底 → "滚上去力度太大"。 */
    function claimConversationScrollInput() {
      if (historyJumpTarget || restoreThroughTarget || pendingRailJumpSeq !== undefined || pendingSearchJump?.loadRequested === true) vscode.postMessage({ type: 'cancel-history-navigation' });
      clearHistoryJump();
      if (pendingSearchJump?.loadRequested === true) pendingSearchJump = undefined;
      clearRestoreThroughTarget();
      pendingRailJumpSeq = undefined;
      railNavigationLocked = false;
      railNavigationSeq = undefined;
      if (renderedSessionId) viewMemoOf(renderedSessionId).railViewportManual = false;
      stampRailBadgeIntent();
      if (restoreCtx && restoreCtx.kind !== 'history-merge') restoreCtx.userTouched = true;
    }
    elements.scroll.addEventListener('wheel', (event) => {
      if (event.deltaY < 0 && followConversationTail) detachConversationTail();
      /* 0.1.120（G55 复测）：滚轮 = 明确的用户滚动意图 → 允许徽标浮出（意图门控见 railBadgeScrollIntent）。 */
      claimConversationScrollInput();
    }, { passive: true });
    elements.restoreStop.addEventListener('click', () => {
      claimConversationScrollInput();
      clearRestoreCtx();
      captureScrollMemo(renderedSessionId, true);
      scheduleViewStatePersist(renderedSessionId, 'restore-stop');
      scheduleRailMeasure();
    });
    elements.restoreStop.addEventListener('wheel', (event) => {
      claimConversationScrollInput();
      elements.scroll.scrollTop += event.deltaY;
      event.preventDefault();
    }, { passive: false });
    /* Home/PageUp 与原生滚动条也能直接到顶，不能依赖随后出现一个非边界 scroll
       才解除初始恢复。输入框的光标移动不属于会话滚动。 */
    document.addEventListener('keydown', (event) => {
      if (event.defaultPrevented || !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
      const target = event.target;
      if (target !== document.body && !elements.scroll.contains(target)) return;
      if (target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      claimConversationScrollInput();
      requestAnimationFrame(() => maybeAutoLoadHistory(true));
    });
    elements.scroll.addEventListener('mousedown', (event) => {
      if (event.button === 0 && event.target === elements.scroll) claimConversationScrollInput();
    }, { passive: true });
    /* G39（0.0.93/v2）：滚动位置实时记入记忆表（廉价赋值）→ 去抖持久化；
       若在校正窗口内且是用户自己滚动（非程序性）→ 立即停止校正（不打扰）。 */
    elements.scroll.addEventListener('scroll', () => {
      if (viewportDegenerate()) return;
      // Reveal can emit a scroll event before ResizeObserver. Restore the ready
      // target first, so this layout event cannot masquerade as user takeover.
      if (restoreThroughTarget && restoreThroughTarget.ready) {
        tryRestoreThroughReady();
        if (restoreCtx && restoreCtx.kind === 'restore-through') applyViewRestoreNow();
      }
      /* 0.1.29（iframe 忠实复现"慢拖被误判为用户接管"）：同一位置的**回声**事件不算用户滚动。
         浏览器在内容变高/重排后会补发一个位置并未改变的 scroll 事件（实测 129838→129838），
         旧判据只看"是否在边界" → 被当成用户滚动 → 校正窗口当场作废、锚缓存被漂移位置覆盖
         → 内容飞走并停在那儿（轨迹：S/非程序性 → over-touch → R-seed 漂移锚点）。 */
      const topNow = Math.round(elements.scroll.scrollTop);
      const echo = topNow === lastScrollSeen;
      const extentNow = Math.max(0, elements.scroll.scrollHeight - elements.scroll.clientHeight);
      const stableExtent = lastScrollExtent >= 0 && extentNow === lastScrollExtent;
      lastScrollSeen = topNow;
      lastScrollExtent = extentNow;
      /* 0.1.26：滚动焦点锚随滚动更新（rAF 合并）——resize 时靠它校正（见 beginResizeAnchor）。 */
      scheduleViewFocusAnchor();
      if (railAnimFrame !== undefined || railNativeAnim === true) return;
      /* 分页补偿已同步 markScrollSeen；非回声的位置变化就是新阅读位置，不能被
         上一笔补偿尚未消费的 programmaticScroll 标志吞掉。 */
      const ownScroll = programmaticScroll && !(restoreCtx && restoreCtx.kind === 'history-merge');
      programmaticScroll = false;
      /* 原生滚动条的指针事件由浏览器接管，未必进入 DOM。行程未变却改变了位置，
         且不属于自写/拖宽/设置重建，就是用户滚动；尺寸钳制则仍保留原有豁免。 */
      const nativeInputMode = state && state.turnRailSettings && state.turnRailSettings.scrollbar === 'native';
      const hiddenRailReady = state && state.phase === 'ready' && elements.turnRail.classList.contains('hidden')
        && !(restoreCtx && ['switch', 'restore-through'].includes(restoreCtx.kind));
      const nativeScroll = !ownScroll && !echo && stableExtent && !viewportDegenerate()
        && (nativeInputMode || hiddenRailReady || railBadgeScrollIntent())
        && (!restoreCtx || ['switch', 'restore-through', 'history-merge'].includes(restoreCtx.kind));
      if (railNavigationLocked && !ownScroll && !echo && stableExtent && performance.now() - selfScrollStamp >= 50) {
        railNavigationLocked = false; railNavigationSeq = undefined;
        stampRailBadgeIntent();
        if (restoreCtx && restoreCtx.navigation === true) restoreCtx.navigation = false;
      }
      /* 自绘轨道模式没有原生滚动条，不能把普通脚本 scrollTop 赋值当成原生输入。 */
      if (nativeScroll && !elements.scroll.classList.contains('scrollbar-hidden')) {
        if (historyJumpTarget || restoreThroughTarget || pendingRailJumpSeq !== undefined) vscode.postMessage({ type: 'cancel-history-navigation' });
        clearHistoryJump();
        if (pendingSearchJump?.loadRequested === true) pendingSearchJump = undefined;
        clearRestoreThroughTarget(); pendingRailJumpSeq = undefined;
        railNavigationLocked = false; railNavigationSeq = undefined;
        stampRailBadgeIntent();
      }
      if (!echo && !ownScroll && railBadgeScrollIntent()) railFollowMovementAt = performance.now();
      if (!ownScroll && !echo && restoreCtx && !restoreCtx.userTouched) {
        /* 0.1.26：浏览器"内容变矮 → scrollTop 被钳到新 max/0"也会派一个 scroll 事件——
           它不是用户滚动，却会把校正窗口标记成"用户已接管"从而中止校正（实测：从下限
           展宽时内容 217,955→74,690 触发钳制 → 校正被吞 → 内容飞到别处）。钳到边界的
           事件在窗口期内一律当钳制豁免；真用户滚动（位置确实变了）才置 userTouched。 */
        const el = elements.scroll;
        const atEdge = el.scrollTop <= 0.5 || el.scrollTop >= Math.max(0, el.scrollHeight - el.clientHeight) - 0.5;
        if (!atEdge || restoreCtx.kind === 'history-merge' || nativeScroll) {
          /* 0.1.128（用户需求②·真机复现锤定）：**历史合并校正窗**遇到用户滚动不再关窗——改"**重锚到
             用户当前位置**"：合并/懒建使内容在头顶继续长高时照常补针（内容不再下坠），而锚随人走、
             与用户滚动不打架。关窗会把 +2144px 的头顶增长变成无补偿 → 视口内容下坠 ≈7 节点
             （active 20→13 的"飞走"现场；探针 p1（不滚）自动补上、p2（继续滚）丢补偿对照实证）。 */
          if (restoreCtx.kind === 'history-merge') {
            const na = captureViewAnchor();
            if (na !== undefined) {
              restoreCtx.anchorId = na.id; restoreCtx.anchorOffset = na.offset;
              restoreCtx.top = elements.scroll.scrollTop;
              /* 0.1.130（"22→6"现场）：锚元素可能是**懒建壳**（无 data-seq）——不得用 undefined 覆写
                 anchorSeq，否则"身份钉住"中途失效、徽标随几何抖动乱走。 */
              if (typeof na.seq === 'number') restoreCtx.anchorSeq = na.seq;
            } else restoreCtx.userTouched = true;
          } else if (!['switch', 'restore-through', 'view-cfg-rebuild'].includes(restoreCtx.kind) || nativeScroll || railBadgeScrollIntent()) {
            restoreCtx.userTouched = true;
          }
        }
      }
      /* 0.1.29：布局变化常伴随 scroll 事件、且它可能**早于** ResizeObserver 那一批到达——
         窗口还开着就顺手同步回正一次（已在位 = 无操作）。这是"拖动不跳动"的关键一发：
         实测慢拖最大偏离 5463px/37 帧超 400px → 85px/0 帧（均值 0.5px）。 */
      if (restoreCtx !== undefined && restoreCtx.userTouched !== true && !viewportDegenerate()) applyViewRestoreNow();
      if (!viewMemoryCfg().scroll || !state || typeof state.sessionId !== 'string') return;
      captureScrollMemo(state.sessionId);
      scheduleViewStatePersist(state.sessionId, 'scroll');
    }, { passive: true });
    /* 0.0.131：滚到顶自动加载更早消息（用户实测：滚到顶后滚轮失效，只能点方框）。
       与按钮同路径（historyAnchor 位置锚定 + load-history）；一次一页，加载中/到头/校正窗口内不触发。
       注意：滚轮在顶部时不会再产生 scroll 事件，必须同时挂在 wheel 上。
       0.0.141（用户需求"上滚像没有尽头"）：触发点从"距顶 24px"提前到约 1.5 个视口高——
       预取下一页（本地 dsh 一页 ~200ms），滚到顶时内容已就位，不再有空窗。 */
    const HISTORY_PREFETCH_VIEWPORTS = 1.5;
    function maybeAutoLoadHistory(userIntent) {
      if (railAnimFrame !== undefined || railNativeAnim === true) return;
      if (userIntent !== true && performance.now() - selfScrollStamp < 50) return;
      /* 分页补偿随阅读锚点移动；只有新的用户上滚允许在补偿期间再取一页。
         补偿自身的 scroll 回声仍不得触发连页拉取。 */
      if (restoreCtx && !restoreCtx.userTouched
        && (restoreCtx.kind !== 'history-merge' || (userIntent !== true && !railBadgeScrollIntent()))) return;
      if (!state || typeof state.sessionId !== 'string' || state.sessionId === '') return;
      if (state.hasMoreHistory !== true || state.loadingHistory === true) return;
      if (historyAnchor !== undefined) return;
      const margin = Math.max(24, elements.scroll.clientHeight * HISTORY_PREFETCH_VIEWPORTS);
      if (elements.scroll.scrollTop > margin) return;
      detachConversationTail();
      historyAnchor = { sessionId: state.sessionId, height: elements.scroll.scrollHeight };
      vscode.postMessage({ type: 'load-history' });
    }
    elements.scroll.addEventListener('scroll', () => { maybeAutoLoadHistory(); }, { passive: true });
    elements.scroll.addEventListener('wheel', (event) => {
      if (event.deltaY >= 0) return;
      /* 0.0.136（用户实测"滚轮往上不加载，先下后上才加载"）：上滚轮是明确的用户意图、不可能
         是程序性滚动——把它记入 userTouched。否则视图校正窗口内（reload 后）且内容刚好放得下
         （滚不动 → 永远没有 scroll 事件）时，第一次上滚会被 userTouched 守卫整段吞掉。 */
      if (restoreCtx && restoreCtx.kind !== 'history-merge') restoreCtx.userTouched = true;
      maybeAutoLoadHistory(true);
    }, { passive: true });

    /* ---- G41（0.0.98）: 轮次导航条 ---- */
    /* 轮 = 一条 user 消息（起点）；节点过高密度时抽稀（≤ 视口高/5px，末轮必显）；点击顶对齐跳转
       （属程序化滚动，且停止 G39 校正窗口——用户主动导航不该被拉回）；滚动时高亮当前轮（唯一）。 */
    let railKey = '';
    /* 0.1.124（数据层根治）：当前会话「轨道节点表」（全量表）——扩展在会话打开/视图就绪时下发。
       表在手 = 轨道清单全集恒定（编号不随加载/Reload 漂移）；railTableStamp 计入 railKey ⇒ 表到达即重建。 */
    let railTable;
    let railTableSessionId = '';
    let railTableStamp = 0;
    let railPreparationFailedFor = '';
    function acceptRailTable(sessionId, rail) {
      if (!rail || typeof rail !== 'object' || !Array.isArray(rail.segment) || !Array.isArray(rail.turn)) return false;
      railTable = rail; railTableSessionId = sessionId; railTableStamp += 1; railKey = '';
      if (railPreparationFailedFor === sessionId) railPreparationFailedFor = '';
      return true;
    }
    /* 0.1.124：全量表缺席的兜底留痕（每会话一次——DOM 混合清单会随加载重排，属临时态）。 */
    let railFallbackLoggedFor = '';
    /* 0.1.124：表/DOM 对账留痕（每会话一次——非零即保真缺陷信号）。 */
    let railMismatchLoggedFor = '';
    /* 0.1.123（Phase 3）：轨道清单（railTurnList）所属会话戳——脉冲补试的精确守卫（渲染期 renderedSessionId
       会先于轨道重建翻转，只看它会把脉冲打到旧清单同 seq 节点上）。 */
    let railListSessionId = '';
    let railTurnList = [];
    let railNodesBuilt = [];
    let railEls = new Map();
    /* G49 v2（0.0.121）：轮 id → 元素（turnOutline 模式用）。 */
    let railTurnEls = new Map();
    /* G49 v2：待跳转的穿透目标 seq（点击未加载轮 → 先加载，加载完成再由 turn-jump-ready 触发滚动）。 */
    let pendingRailJumpSeq;
    let pendingRailJumpSession;
    let railNavigationLocked = false;
    let railNavigationSeq;
    let railNavigationId;
    let railTops = [];
    let railActiveNode = -1;
    /* 0.0.127：跳转目标粘滞——跳转目标够不到视口顶（页面已触底）时，"高亮 = 最后一段"的兜底会把高亮
       判给最后一段而非点击的节点（用户反馈：倒数几个节点"点不动"）。粘滞把高亮钉在点击的节点上，
       直到用户自己滚动离开落点（Δ>4px）或动画被用户输入打断。 */
    let railStickyIndex;
    let railStickyTarget = 0;
    let railMeasureTimer;
    /* 0.1.21（流式卡顿治理）：轨道几何缓存——scroll.clientHeight 与节点 rect 的运行中降频
       （见 updateTurnRail；0 表示未测过，首帧必测）。
       0.1.50（B，重引 0.1.34 思路）：几何只在**尺寸真变过**（resize 置脏）或从无到有时才量；
       此前"空闲态每次 render 必量"会在刚重建 DOM 的帧里强制整篇布局（实测 174ms 长任务）。 */
    let railClientHeight = 0;
    let railGeomAt = 0;
    let railGeomDirty = true;
    let railResizeTimer;
    /* 0.1.50（B 的配套守卫，来自 0.1.43 定案）：滚动条隐藏类**唯一写入入口**——缓存与类必须一起变。
       此前轨道隐藏分支直接 remove 而缓存不更新 ⇒ "轨道隐藏→恢复"后缓存与实际不一致
       ⇒ 原生滚动条 + 自绘滑块同时出现（真机实测的"两个滑块"）。 */
    let scrollbarHiddenNow;
    function setScrollbarHidden(hidden) {
      if (hidden === scrollbarHiddenNow) return;
      scrollbarHiddenNow = hidden;
      elements.scroll.classList.toggle('scrollbar-hidden', hidden);
    }
    /* 0.0.128：轨道布局（绝对定位 + 映射）与自绘滑块——预览件 v2 的落地版。
       节点 y = 比例间距累计（gap ∝ 段高，夹在 [minGap 设置, 112]）；放得下铺满、放不下自滚。
       滑块顶端 = map(scrollTop+48)——由构造保证「在看第 k 段时必落在节点 k 与 k+1 之间」；
       拖动 = 逆映射连续滚动。流式期间冻结重排（结算/集合变化/设置变化才重算），防节点漂移。 */
    const RAIL_PAD = 12;
    /* 0.0.131：末节点下方底垫 76px——滑块（长度上限 72）触底时恰好"顶端贴末节点、身体落入底垫"，
       用身体长度直接回答"这一屏还能看到多少"（用户需求）。铺满换算里预留底垫，消掉此前
       铺满模式恒可滚 14px 的假滚动。 */
    const RAIL_TAIL = 76;
    const RAIL_PITCH = 28;
    const RAIL_MAX_GAP = 112;
    /* 0.0.131：长度语义收窄（用户拍板 A）——保留"视口覆盖的节点跨度"，夹取 [32,72]。
       此前 [20,88] 在长会话（巨段为主）里大半程钉死 20、到短段又暴涨 88，观感"会呼吸"。 */
    const RAIL_MIN_THUMB = 32;
    const RAIL_MAX_THUMB = 72;
    const RAIL_EH_FLOOR = 200;
    const RAIL_FALLBACK_STEP = 400;
    /* 0.1.126（用户需求"提前量"）：滑块跟随的**提前量带**（px）——滑块进入轨道上/下缘该带内即
       连续平滑跟滚（把滑块"托"在带内）。旧跟随只看"活动节点贴边"（节点级、事后）⇒ 滑块（连续
       像素级）会先行滑出视线、到节点切换才补滚一下。节点级跟随 followRailActive 保留为第二判据。 */
    const RAIL_FOLLOW_LEAD = 48;
    /* 0.1.127（用户复测：提前量"不稳定/偶发大跳/有时露半截"）：跟随专用补间时长（秒）——
       **自适应**：偏差小（常态追踪）取快端（不露头）；偏差大（边缘位起滚/大步跳）取慢端（不弹）。
       跟随与滚轮共用同一补间机构（railTweenTau 覆盖），同刻只有一方在跑
       （手动滚列暂停期挡跟随、内容滚动解除暂停）。 */
    const RAIL_FOLLOW_TAU_MIN = 0.12;
    const RAIL_FOLLOW_TAU_MAX = 0.3;
    /* 0.1.129（用户实测"加载瞬间滑块跳动"·探针单步 183px）：滑块**大幅位移**（来自轨道重排而非滚动）
       用线性短滑行过渡；滚动产生的连续小位移（≤ 阈值）保持即时——不引入跟随延迟。与节点 CSS 过渡同拍。 */
    const RAIL_THUMB_GLIDE_MS = 260;
    const RAIL_THUMB_GLIDE_THRESHOLD = 60;
    const RAIL_THUMB_GLIDE_MAX_SPEED = 1.2; // px/ms；大幅重排按距离延长，避免固定时长产生速度尖峰。
    let railLayout = { y: [], offsets: [], heights: [], tail: RAIL_TAIL, contentH: 0 };
    let railLayoutSign = '';
    /* 0.1.126：布局期缓存——列高与"是否可滚"（不可滚时滑块恒可见，跟随免谈）。 */
    let railClipH = 0;
    let railScrollable = false;
    let railLayoutFrozen = false;
    /* 会话打开/Reload 的轨道恢复独立于滚轮意图；保留到全量表到达，防迟到表再次把滑块移出视野。 */
    let railRevealPending = false;
    let railViewportRestored = false;
    function rememberRailViewport() {
      if (!renderedSessionId || railRevealPending || railTurnList.length === 0) return;
      const clip = elements.turnRailClip;
      if (!clip || railLayout.y.length !== railTurnList.length) return;
      if (clip.clientWidth === 0 || clip.clientHeight === 0) return;
      let index = 0;
      for (let i = 0; i < railLayout.y.length; i += 1) {
        if (railLayout.y[i] <= clip.scrollTop) index = i; else break;
      }
      const seq = railTurnList[index].seq;
      if (typeof seq !== 'number') return;
      const memo = viewMemoOf(renderedSessionId);
      memo.railAnchorSeq = seq; memo.railAnchorOffset = railLayout.y[index] - clip.scrollTop;
    }
    /* 0.1.30：拖动侧栏宽度期间**冻结轨道**。轨道布局签名含 clientWidth/clientHeight，每次宽度
       变化都会整条重排（点位重算 + 滑块按 scrollTop 重映射）；而重排期间各段偏移正随内容重排
       剧烈变化 → 用户看到"跳转点与自绘滑块在跳"（忠实台面实测：慢拖中滑块单帧跳 617px、
       点位摘要单帧变 29121、高亮换 2 次）。拖动中保持轨道不动（内容在屏幕上本来也没动），
       拖动结束（校正窗口收摊）再一次性重测重排。 */
    function railDragFrozenNow() {
      return restoreCtx !== undefined && restoreCtx.resize === true && restoreCtx.userTouched !== true;
    }
    let railThumbDrag = null;
    function railMinGap() {
      const cfg = (state && state.turnRailSettings) || {};
      const raw = cfg.minGap;
      return typeof raw === 'number' && Number.isFinite(raw) ? Math.min(96, Math.max(12, raw)) : 20;
    }
    /* 0.0.144（用户需求②）：边缘拖拽自动滚列的两个设置——触发带宽（px）与最大速度（px/秒）。
       仅作用于"边缘拖拽自动滚列"，与"滚轮滚列"互不影响。 */
    function railDragEdgePx() {
      const cfg = (state && state.turnRailSettings) || {};
      const raw = cfg.dragEdgePx;
      return typeof raw === 'number' && Number.isFinite(raw) ? Math.min(200, Math.max(8, raw)) : 64;
    }
    function railDragSpeed() {
      const cfg = (state && state.turnRailSettings) || {};
      const raw = cfg.dragSpeed;
      return typeof raw === 'number' && Number.isFinite(raw) ? Math.min(3000, Math.max(100, raw)) : 800;
    }
    /* 0.0.144（用户需求①）：滑块长度恒定——暂停的对话内滚动时不再忽长忽短（节点间距已在表达
       内容长短；"接近底部变短"是末段行程挤压所致）。每布局按 视口高/内容高 比例算一次，
       夹取 [RAIL_MIN_THUMB, RAIL_MAX_THUMB]；内容增长/视口变化（重新布局）时才变。 */
    function railThumbLen() {
      return typeof railLayout.thumbLen === 'number' && railLayout.thumbLen > 0 ? railLayout.thumbLen : RAIL_MIN_THUMB;
    }
    function railLayoutSignature() {
      return railTurnList.map(turn => turn.id).join('|') + '@' + String(railMinGap()) + '#' + String(elements.scroll.clientHeight) + 'x' + String(elements.scroll.clientWidth);
    }
    function applyRailPositions() {
      for (const entry of railNodesBuilt) {
        const y = railLayout.y[entry.turnIndex];
        if (typeof y === 'number') entry.el.style.top = y + 'px';
      }
    }
    function layoutTurnRail() {
      const clip = elements.turnRailClip;
      const size = elements.turnRailSize;
      const n = railTurnList.length;
      if (clip === null || clip === undefined || size === null || size === undefined || n === 0) {
        railLayout = { y: [], offsets: [], heights: [], tail: RAIL_TAIL, contentH: 0 };
        railScrollable = false;
        return;
      }
      /* 0.0.141 v2（用户实测 v1：底垫 2.7×间距、滑块离底太远、比例不对）：底垫 = **末段自身的
         比例间距**（与节点间距同一条公式，读作"最后一格"），见下文 tailBase；此处 avail 为
         铺满可用总高（含底垫）。 */
      const avail = Math.max(80, clip.clientHeight - RAIL_PAD * 2);
      /* 段偏移（清洗 railTops：缺失/倒退 → 上一定位 + 名义步长，保证单调）。
         0.0.136（前缀节点污染映射的根因）：**未加载节点（railTops 缺失）不得推进坐标系**——
         它们的内容不在 DOM 里，没有可达的滚动位置。旧实现按 +400 名义步长推进，前缀一多就把
         已加载段的真实偏移顶掉（单调守卫把真实偏移改写成 last+400）→ 锚点整段错位：滚动前
         3600px 滑块只在头两个节点间爬、最后几百像素扫过其余全部节点（用户"滑块与内容对不上"）。
         现在前缀锚点全部停在 0（钳制后），已加载段的真实偏移原样保留。 */
      const offsets = [];
      let last = 0;
      for (let i = 0; i < n; i += 1) {
        const top = railTops[i];
        const measured = typeof top === 'number' && Number.isFinite(top) && top >= last;
        const value = measured ? top : (turnIsPending(railTurnList[i]) ? last : last + RAIL_FALLBACK_STEP);
        offsets.push(value);
        last = value;
      }
      const totalH = Math.max(1, elements.scroll.scrollHeight);
      const heights = [];
      for (let i = 0; i < n; i += 1) {
        const end = i + 1 < n ? offsets[i + 1] : totalH;
        heights.push(Math.max(40, end - offsets[i]));
      }
      /* 分页材料化的中间高度不能作为节点比例间距的真值。保持当前节点的显示间距，
         但必须更新正文映射 offsets/heights：冻结整份布局会把补偿后的 scrollTop
         映射到旧消息，正是此前冻结方案失败的原因。校正窗关闭后统一结算一次间距。 */
      if (restoreCtx !== undefined && restoreCtx.kind === 'history-merge' && restoreCtx.userTouched !== true
        && railLayout.y.length === n && railClipH === clip.clientHeight) {
        railLayout = { ...railLayout, offsets, heights };
        syncRailIndicator();
        return;
      }
      /* 比例间距：gap ∝ 段高（eh 保底）——放得下铺满、放不下自滚（预览 v2 模式 3）。
         0.1.129（用户实测"加载瞬间滑块跳动"·探针现场 thumbView 48→232）：**未加载节点**拿不到真实
         段高（offset 不推进 ⇒ height≈40），旧实现用保底 200 ⇒ 与"加载后的真实高度"落差大 ⇒ 每加载
         一页整条轨道重新比例、全列位移（滑块跟着跳）。改为以**已测节点的平均段高**作未加载节点的
         名义高度——加载前后比例近似不变，布局稳定（锚点坐标系不受影响，仍停在原地）。 */
      const measuredHeights = [];
      for (let i = 0; i < n; i += 1) if (!turnIsPending(railTurnList[i])) measuredHeights.push(heights[i]);
      const nominalEh = measuredHeights.length > 0
        ? Math.max(RAIL_EH_FLOOR, measuredHeights.reduce((sum, value) => sum + value, 0) / measuredHeights.length)
        : RAIL_EH_FLOOR;
      const eh = heights.map((value, i) => turnIsPending(railTurnList[i]) ? nominalEh : Math.max(value, RAIL_EH_FLOOR));
      const avg = Math.max(1, eh.reduce((sum, value) => sum + value, 0) / n);
      const minGap = railMinGap();
      const gaps = [];
      for (let i = 0; i < n - 1; i += 1) gaps.push(Math.min(RAIL_MAX_GAP, Math.max(minGap, RAIL_PITCH * eh[i] / avg)));
      const sumG = gaps.reduce((sum, value) => sum + value, 0);
      /* 0.0.141 v2：底垫 = **末段自身的比例间距**（与节点间距同一条公式，读作"最后一格"），
         与节点间距一起参与同一 scale 缩放；保底 RAIL_TAIL（滑块身长上限 72 的表达区，触底时
         身体完整落入）。保底触发时改用"固定底垫反解 scale"——铺满仍精确（contentH=clipH、
         无假滚动），且底垫不小于 RAIL_TAIL。自滚态（放不下）scale=1，底垫=间距值（≥76）。 */
      const tailBase = Math.min(RAIL_MAX_GAP, Math.max(minGap, RAIL_PITCH * eh[n - 1] / avg));
      let scale = 1;
      if (sumG + tailBase <= avail) {
        scale = avail / Math.max(1, sumG + tailBase);
        if (sumG > 0 && tailBase * scale < RAIL_TAIL) scale = Math.max(1, (avail - RAIL_TAIL) / Math.max(1, sumG));
      }
      const y = [];
      let acc = RAIL_PAD;
      for (let i = 0; i < n; i += 1) {
        y.push(acc);
        if (i < n - 1) acc += gaps[i] * scale;
      }
      const tail = Math.max(tailBase * scale, RAIL_TAIL);
      /* 0.1.126：缓存列高与"是否可滚"（滑块跟随提前量用）。 */
      railClipH = clip.clientHeight;
      railScrollable = acc + tail + RAIL_PAD > railClipH + 1;
      const contentH = Math.max(railClipH, acc + tail + RAIL_PAD);
      /* 0.0.144①：滑块长度 = 比例恒定值（视口高/内容高 × 行程跨度），夹 [32,72]；滚动中不变。 */
      const travel = Math.max(1, (y[n - 1] + tail) - y[0]);
      const viewportH = Math.max(0, elements.scroll.clientHeight);
      const thumbLen = Math.max(RAIL_MIN_THUMB, Math.min(RAIL_MAX_THUMB, Math.round(travel * viewportH / totalH)));
      railLayout = { y, offsets, heights, tail, contentH, thumbLen };
      size.style.height = contentH + 'px';
      railSelfScrollTop = clip.scrollTop;
      railSelfScrollExtent = Math.max(0, clip.scrollHeight - clip.clientHeight);
      applyRailPositions();
      syncRailIndicator();
    }
    /* 冻结门：流式期间不重排（只更新指示器）——集合变化/结算/视口或设置变化才重算。 */
    function maybeLayoutTurnRail() {
      if (railDragFrozenNow() && railLayout.y.length > 0) return;
      const running = state !== undefined && state !== null && state.running === true;
      const signature = railLayoutSignature();
      const need = signature !== railLayoutSign || (railLayoutFrozen && !running);
      railLayoutFrozen = running;
      if (!need) return;
      railLayoutSign = signature;
      layoutTurnRail();
    }
    /* 0.0.131：映射重标定——域从"内容坐标（+48 阅读线）"改为**滚动坐标**。
       锚点 a_k = clamp(段首偏移, 0, 最大滚动) → 节点 y_k；重复钳制取最大 k。
       跳转 k 后 scrollTop = a_k ⇒ 滑块顶端正好落在节点 k 上（修用户实测的 +5px 常态偏移与
       触底 −7/−43px 错位）。0.0.143（用户实测"滑块无法滚到底部"）：触底语义由"贴末节点"
       改为**贴轨道底**——末段行程区内顶端从 y[n−1] 比例滑到 railEndY()（见该函数）。 */
    function railAxisNow() {
      const n = railTurnList.length;
      const totalH = Math.max(1, elements.scroll.scrollHeight);
      const maxScroll = Math.max(0, totalH - elements.scroll.clientHeight);
      const anchors = [];
      for (let i = 0; i < n; i += 1) {
        const offset = railLayout.offsets[i];
        anchors.push(Math.max(0, Math.min(maxScroll, typeof offset === 'number' && Number.isFinite(offset) ? offset : 0)));
      }
      return { totalH, maxScroll, anchors };
    }
    /* 0.0.134（用户实测"末段附近微滚一下滑块从末节点蹿到倒数第三个"）：尾部重标定。
       末几个节点的段首滚不到视口顶 → 锚点被钳到 maxScroll（重复）→ 旧实现"取最大 k"在
       **最后一像素处不连续**：p=maxScroll 时滑块顶=末节点，p=maxScroll−1 时落回倒数第三个。
       改为：把 [a_{f−1}, maxScroll] 线性铺到 [y_{f−1}, 终点]（f=首个被钳制锚点）——
       连续、单调；中间被钳制节点由该段快速掠过（物理上本就不可达）。
       0.0.143：终点由 y[n−1] 改为 railEndY()（触底贴轨道底，见下），两条路径端点保持同源。 */
    function railTailAxis(axis) {
      if (axis.maxScroll <= 0) return undefined;
      let f = -1;
      for (let i = 0; i < axis.anchors.length; i += 1) {
        if (axis.anchors[i] >= axis.maxScroll) { f = i; break; }
      }
      if (f <= 0) return undefined;
      return { from: f, pStart: axis.anchors[f - 1], span: axis.maxScroll - axis.anchors[f - 1] };
    }
    /* 0.0.143（用户实测：触底时滑块停在末节点、离轨道底还差大半格——"滑块无法滚到底部"）：
       底垫（末节点→轨道底的那一格）从"身体容身区"升级为**末段行程区**——滑块顶端在末段内
       从 y[n−1] 比例滑到 railEndY()；到 railEndY 时身体恰好贴住轨道底。
       0.0.144①：身体长度改为恒定值 railThumbLen()（滚动中不再变化）。 */
    function railEndY() {
      const n = railTurnList.length;
      if (n === 0 || railLayout.y.length < n) return 0;
      return railLayout.y[n - 1] + Math.max(0, railLayout.tail - railThumbLen());
    }
    function railMapC2R(scrollPos) {
      const n = railTurnList.length;
      if (n === 0 || railLayout.y.length < n) return 0;
      const axis = railAxisNow();
      const p = Math.max(0, Math.min(axis.maxScroll, scrollPos));
      const tail = railTailAxis(axis);
      if (tail !== undefined && p >= tail.pStart) {
        const fr = tail.span > 0 ? (p - tail.pStart) / tail.span : 1;
        const base = railLayout.y[tail.from - 1];
        return base + fr * (railEndY() - base);
      }
      /* 0.0.136：与 updateRailActive 完全同源——"最后一个锚点 ≤ p"。旧实现对 p ≤ anchors[0] 走
         0→y[0] 的比例插值：前缀节点锚点全部钳到 0 后，滑块会被从轨道顶端一路拉下来，而高亮
         （同一条扫描规则）说的是"最后一个锚点 ≤ p 的节点"——两者在老实现里不一致（对不齐观感）。
         新规则下 p=0 时取最后一个 0 锚点（末前缀节点）= 已加载内容的边界，滑块与高亮天然一致。 */
      let k = 0;
      for (let i = 0; i < n; i += 1) {
        if (axis.anchors[i] <= p) k = i;
        else break;
      }
      if (k < n - 1) {
        const span = axis.anchors[k + 1] - axis.anchors[k];
        const f = span > 0 ? Math.max(0, Math.min(1, (p - axis.anchors[k]) / span)) : 0;
        return railLayout.y[k] + f * (railLayout.y[k + 1] - railLayout.y[k]);
      }
      /* 0.0.143：末段行程区（p ≥ 末锚点）——顶端从末节点比例滑到 railEndY()（触底贴轨道底）。
         必须与尾部重标定路径（railTailAxis）同一终点，否则两条路径在触底时相差一个底垫。 */
      const spanLast = axis.maxScroll - axis.anchors[n - 1];
      const fLast = spanLast > 0 ? Math.max(0, Math.min(1, (p - axis.anchors[n - 1]) / spanLast)) : 1;
      return railLayout.y[n - 1] + fLast * (railEndY() - railLayout.y[n - 1]);
    }
    function railMapR2C(railPos) {
      const n = railTurnList.length;
      if (n === 0 || railLayout.y.length < n) return 0;
      const axis = railAxisNow();
      const value = Math.max(0, Math.min(railLayout.y[n - 1] + railLayout.tail, railPos));
      const tail = railTailAxis(axis);
      if (tail !== undefined) {
        const base = railLayout.y[tail.from - 1];
        const spanR = railEndY() - base;
        if (spanR > 0 && value >= base) {
          const fr = Math.max(0, Math.min(1, (value - base) / spanR));
          return tail.pStart + fr * tail.span;
        }
      }
      const y0 = railLayout.y[0];
      /* 0.0.136：与正向映射（p ≤ anchors[0] 一律钉在 y[0]）互逆——首节点以上区域拖动恒为 0，
         否则会出现"往下拖 → 松手回弹"的不一致。 */
      if (value <= y0) return 0;
      let k = 0;
      for (let i = 0; i < n; i += 1) {
        if (railLayout.y[i] <= value) k = i;
        else break;
      }
      if (k < n - 1 && railLayout.y[k + 1] > railLayout.y[k]) {
        const f = (value - railLayout.y[k]) / (railLayout.y[k + 1] - railLayout.y[k]);
        return axis.anchors[k] + f * (axis.anchors[k + 1] - axis.anchors[k]);
      }
      /* 0.0.143：末段行程区（与正向映射互逆）——[y_{n−1}, railEndY()] ↔ [a_{n−1}, maxScroll]；
         越过 railEndY 一律钳到 maxScroll（拖到底不会"多滚"）。 */
      const spanLast = Math.max(1, axis.maxScroll - axis.anchors[n - 1]);
      const f = Math.max(0, Math.min(1, (value - railLayout.y[n - 1]) / Math.max(1, railEndY() - railLayout.y[n - 1])));
      return axis.anchors[n - 1] + f * spanLast;
    }
    /* 0.1.129（用户实测"加载瞬间滑块跳动"）：滑块顶定位——小步即时、**大步（轨道重排引起，>阈值）
       线性滑行**（与节点 CSS 过渡同拍；滚动连续更新的小步不受影响，不引入跟随延迟）。
       跳转自带滑行（railThumbGlideY）期间直写，与其保持互斥。 */
    let railThumbSmoothShown;
    let railThumbSmoothFrame;
    let railThumbSmoothFrom = 0;
    let railThumbSmoothTarget;
    let railThumbSmoothAt = 0;
    let railThumbSmoothUserDriven = false;
    function railThumbSetTop(top) {
      const thumb = elements.turnRailThumb;
      if (thumb === null || thumb === undefined) return;
      if (railThumbGlideY !== undefined) {
        if (railThumbSmoothFrame !== undefined) { cancelAnimationFrame(railThumbSmoothFrame); railThumbSmoothFrame = undefined; }
        railThumbSmoothTarget = undefined;
        railThumbSmoothUserDriven = false;
        railThumbSmoothShown = top;
        thumb.style.top = top + 'px';
        return;
      }
      if (railThumbSmoothFrame !== undefined) {
        if (Math.abs(top - railThumbSmoothTarget) < 1) return;
        if (!railFollowScrollIntent()) railThumbSmoothUserDriven = false;
        /* 滑行中改目标（材料化多段落定）：**以当前位置为新起点重新计时**——否则 from/k 固定，
           新目标差额会被瞬间叠加上去（探针尖峰 2.79px/ms 的成因）。 */
        railThumbSmoothFrom = railThumbSmoothShown;
        railThumbSmoothTarget = top;
        railThumbSmoothAt = performance.now();
        return;
      }
      if (railThumbSmoothShown === undefined || Math.abs(top - railThumbSmoothShown) <= RAIL_THUMB_GLIDE_THRESHOLD) {
        railThumbSmoothUserDriven = false;
        railThumbSmoothShown = top;
        thumb.style.top = top + 'px';
        return;
      }
      railThumbSmoothFrom = railThumbSmoothShown;
      railThumbSmoothTarget = top;
      railThumbSmoothAt = performance.now();
      railThumbSmoothUserDriven = railFollowScrollIntent();
      railThumbSmoothFrame = requestAnimationFrame(railThumbGlideStep);
    }
    function railThumbGlideStep(now) {
      railThumbSmoothFrame = undefined;
      const thumb = elements.turnRailThumb;
      if (thumb === null || thumb === undefined || railThumbSmoothTarget === undefined) { railThumbTargetSettle(); return; }
      const duration = Math.max(RAIL_THUMB_GLIDE_MS, Math.abs(railThumbSmoothTarget - railThumbSmoothFrom) / RAIL_THUMB_GLIDE_MAX_SPEED);
      const k = Math.min(1, (now - railThumbSmoothAt) / duration);
      const value = railThumbSmoothFrom + (railThumbSmoothTarget - railThumbSmoothFrom) * k;
      railThumbSmoothShown = value;
      thumb.style.top = value + 'px';
      if (k < 1) railThumbSmoothFrame = requestAnimationFrame(railThumbGlideStep);
      else { railThumbSmoothTarget = undefined; railThumbSmoothUserDriven = false; }
      /* 补间本身不会产生内容 scroll 事件；每帧同步轨道跟随，确保停止滚动后仍跟到实际落点。 */
      syncRailIndicator();
    }
    function railThumbTargetSettle() {
      railThumbSmoothUserDriven = false;
      if (railThumbSmoothTarget === undefined) return;
      railThumbSmoothShown = railThumbSmoothTarget;
      railThumbSmoothTarget = undefined;
    }
    function syncRailIndicator() {
      if (railDragFrozenNow()) return;   /* 0.1.30：拖动中滑块不动（内容也未动） */
      const sessionRestoring = restoreCtx && !restoreCtx.userTouched && ['switch', 'restore-through'].includes(restoreCtx.kind);
      elements.turnRail.classList.toggle('restoring', railRevealPending || Boolean(sessionRestoring));
      elements.turnRail.style.visibility = railRevealPending && !railViewportRestored ? 'hidden' : '';
      const thumb = elements.turnRailThumb;
      const n = railTurnList.length;
      if (thumb === null || thumb === undefined) return;
      if (n === 0 || railLayout.y.length < n) {
        thumb.style.opacity = '0';
        thumb.style.height = '0px';   /* 0.0.130：清掉残留高度——否则隐形滑块仍可点击/拖拽 */
        return;
      }
      thumb.style.opacity = '1';
      /* 0.1.9（A 削帧）：跳转动画期间滑块顶端只取滑行值——**不读** scrollTop/scrollHeight/
         clientHeight，否则与流式渲染叠加成"每帧一次强制同步布局"（运行中卡顿的机制根源）。 */
      let topY;
      if (railThumbGlideY !== undefined) {
        topY = railThumbGlideY;
      } else {
        const scrollEl = elements.scroll;
        const viewport = scrollEl.clientHeight;
        const maxScroll = Math.max(0, scrollEl.scrollHeight - viewport);
        const st = Math.max(0, Math.min(maxScroll, scrollEl.scrollTop));
        /* 0.0.131：与跳转落点同源——顶端 = map(scrollTop)（不再有 +48 阅读线偏差）。
           0.0.144①（用户：暂停的对话里滑块长度不应随滚动变化；接近底部变短=末段挤压）：
           长度改为恒定值 railThumbLen()（每布局按 视口/内容 比例一算）——滚动中完全不变。 */
        topY = railMapC2R(st);
        /* 0.0.138（用户实测：点第一个节点跳转+高亮都对，滑块却没跟上去）：跳转落点粘滞与高亮
           同源——目标节点的锚点可能到不了落点（前缀节点锚点停在窗口顶）或落点被钳制，按映射
           算出的位置会与节点差一截。粘滞期内顶端直接钉在点击的节点上，滚离落点即释放。 */
        const sticky = railNativeAnim !== true && railStickyIndex !== undefined && railStickyTarget !== undefined
          && (programmaticScroll || Math.abs(scrollEl.scrollTop - railStickyTarget) <= 4)
          && typeof railLayout.y[railStickyIndex] === 'number';
        if (sticky) topY = railLayout.y[railStickyIndex];
      }
      const h = railThumbLen();
      const capBot = railLayout.y[n - 1] + railLayout.tail;
      let top = Math.max(0, Math.min(topY, Math.max(0, capBot - h)));
      /* 0.1.130（用户①②③）：合并窗内+**无用户意图**时，滑块目标**钳在可视带内**——材料化的几何
         抖动最多把它短暂顶出视线 ~28px（探针 M1/M2/M5 exited 现场）；只钳显示位置，不平移轨道、
         不改几何（与轨道列的"意图门控"配套）。窗口结束后映射自然接管。 */
      if (restoreCtx !== undefined && restoreCtx.kind === 'history-merge' && restoreCtx.userTouched !== true
        && railBadgeScrollIntent() !== true && railClipH > 0) {
        /* 注意：本函数后部才有跟随块的 clip 声明——此处必须另取局部名（TDZ 教训：同名会报
           "Cannot access clip before initialization" 打断 render，且只在合并窗+无意图时爆）。 */
        const clipBand = elements.turnRailClip;
        if (clipBand !== null && clipBand !== undefined) {
          const lo = clipBand.scrollTop + 2;
          const hi = clipBand.scrollTop + Math.max(0, railClipH - h - 2);
          if (top < lo || top > hi) top = Math.max(lo, Math.min(top, Math.max(lo, hi)));
        }
      }
      const restoringSession = restoreCtx !== undefined && restoreCtx.userTouched !== true
        && (restoreCtx.kind === 'switch' || restoreCtx.kind === 'restore-through');
      const revealSession = railRevealPending && state !== undefined && state.phase === 'ready'
        && !railDragging && railThumbDrag === null && railAnimFrame === undefined && railNativeAnim !== true
        && Date.now() >= railManualUntil
        && !(restoreCtx !== undefined && (restoreCtx.kind === 'history-merge' || restoreCtx.kind === 'view-cfg-rebuild' || restoreCtx.resize === true));
      if (revealSession && railClipH > 0) {
        /* 恢复定位不继承上个会话的滑块补间；正文已经落位，滑块与轨道必须一起落到相同坐标。 */
        if (railThumbSmoothFrame !== undefined) { cancelAnimationFrame(railThumbSmoothFrame); railThumbSmoothFrame = undefined; }
        railThumbSmoothTarget = undefined;
        railThumbSmoothUserDriven = false;
        railThumbSmoothShown = top;
        thumb.style.top = top + 'px';
        const restoreClip = elements.turnRailClip;
        if (restoreClip !== null && restoreClip !== undefined) {
          const memo = viewMemoOf(renderedSessionId);
          const savedIndex = typeof memo.railAnchorSeq === 'number'
            ? railTurnList.findIndex(turn => turn.seq === memo.railAnchorSeq) : -1;
          const savedViewport = savedIndex >= 0 && typeof memo.railAnchorOffset === 'number';
          if (savedViewport) {
            railTweenCancel();
            writeRailScroll(Math.max(0, railLayout.y[savedIndex] - memo.railAnchorOffset));
          }
          const viewTop = top - restoreClip.scrollTop;
          const viewBottom = viewTop + h;
          if ((!savedViewport || (memo.railViewportManual !== true && !restoringSession)) && (viewTop < 0 || viewBottom > railClipH)) {
            const delta = savedViewport ? (viewTop < 0 ? viewTop : viewBottom - railClipH)
              : (viewTop < 0 ? viewTop - RAIL_FOLLOW_LEAD : viewBottom - (railClipH - RAIL_FOLLOW_LEAD));
            railTweenCancel();
            writeRailScroll(Math.max(0, Math.min(restoreClip.scrollHeight - restoreClip.clientHeight, restoreClip.scrollTop + delta)));
          }
          if (currentRailTable() !== undefined && !restoringSession) railRevealPending = false;
          if (savedViewport || typeof memo.railAnchorSeq !== 'number' || currentRailTable() !== undefined) {
            railViewportRestored = true; elements.turnRail.style.visibility = '';
          }
        }
      } else railThumbSetTop(top);
      thumb.style.height = h + 'px';
      /* 点击可见节点只移动正文与滑块，不按提前量拉动整列。必要时仅补足滑块的越界量。 */
      if (railNavigationLocked) {
        const navigationClip = elements.turnRailClip;
        if (navigationClip && railThumbSmoothShown !== undefined) {
          const deltaTop = railThumbSmoothShown - navigationClip.scrollTop;
          const deltaBottom = deltaTop + h - navigationClip.clientHeight;
          if (deltaTop < 0 || deltaBottom > 0) {
            railTweenCancel();
            writeRailScroll(navigationClip.scrollTop + (deltaTop < 0 ? deltaTop : deltaBottom));
          }
        }
        return;
      }
      /* 0.1.126（用户需求）：跟随滑块 + 提前量带——滑块进入上/下 RAIL_FOLLOW_LEAD 带即连续平滑
         跟滚（走既有 0.18s 补间；自写位置记账防自暂停）。跳过：不可滚 / 拖动（滑块或列）/
         内容跳转动画中 / 手动滚列暂停期 / 视图配置重建窗口。 */
      if (!railScrollable || railDragging === true || railThumbDrag !== null
        || railAnimFrame !== undefined || railNativeAnim === true
        || Date.now() < railManualUntil
        /* 0.1.130（用户①②根治）：跟随只由**用户意图滚动**驱动（滚轮/拖拽/跳转盖戳，1200ms 鲜期，
           与徽标同一门控）——加载/材料化等程序性几何变化**不得**拉动轨道列。 */
        || (railFollowScrollIntent() !== true && railThumbSmoothUserDriven !== true)
        || (restoreCtx !== undefined && restoreCtx.userTouched !== true && restoreCtx.kind === 'view-cfg-rebuild')) return;
      const clip = elements.turnRailClip;
      if (clip === null || clip === undefined) return;
      /* 滑块补间中按实际显示位置跟随；按尚未到达的目标判越界会先瞬移整列，反而把滑块甩开。 */
      const viewTop = railThumbSmoothShown - clip.scrollTop;
      const viewBottom = viewTop + h;
      /* 0.1.127（快速滚动实测：瞬移式大步下任何补间都会短暂露头）：**防露头硬保证**——滑块一旦
         已出可视区（内容瞬间大跳时才会发生）→ 立即对齐到带口（跳随内容，不做慢滑）；
         常规滚动永远落在下段平滑分支（滞后 ≤ 带深），不会触发本分支。 */
      if (viewTop < 0 || viewBottom > railClipH) {
        const maxRail = Math.max(0, clip.scrollHeight - clip.clientHeight);
        const snap = viewTop < 0 ? viewTop - RAIL_FOLLOW_LEAD : viewBottom - (railClipH - RAIL_FOLLOW_LEAD);
        railTweenCancel();
        writeRailScroll(Math.max(0, Math.min(maxRail, clip.scrollTop + snap)));
        return;
      }
      let followDelta = 0;
      if (viewTop < RAIL_FOLLOW_LEAD) followDelta = viewTop - RAIL_FOLLOW_LEAD;
      else if (viewBottom > railClipH - RAIL_FOLLOW_LEAD) followDelta = viewBottom - (railClipH - RAIL_FOLLOW_LEAD);
      if (Math.abs(followDelta) < 1) return;
      /* 0.1.127：走**跟随专用自适应补间**（小偏差快追不露头 / 大偏差慢滑不弹）。 */
      /* delta 已相对当前列位置计算，不能再叠到旧目标上，否则多帧累加会越过滑块。 */
      railTweenTo(clip.scrollTop + followDelta, 'follow');
    }
    /* 0.1.114（G55 轨道序号）：滚动静息徽标「N/M」——触发：
       ① 滚内容/拖滑块/跳转（0.1.120 起经 railBadgeScrollIntent **意图门控**——草稿栏长高等程序性滚动不浮出）→ 贴滑块中心；
       ② 悬停轨道（0.1.120 用户复测①）/ 滚节点列（轨道 wheel）→ 贴指针（就近节点）。
       rAF 合并；只读 style 字符串与缓存高度（railClientHeight），不在热路径测布局。空闲 1s 淡出（悬停期间常显）。 */
    let railBadgeMode = '';
    let railBadgePointerY = 0;
    let railBadgeFrame;
    let railBadgeTimer;
    let railBadgeHovering = false;
    /* 空滚与补偿回声不驱动整列跟随；只有用户输入后的真实阅读位置变化才盖此戳。 */
    let railFollowMovementAt = -Infinity;
    function railFollowScrollIntent() {
      /* 节点跳转本身就是导航意图；其粘滞/动画期间的跟随不能依赖滚轮的位移戳。 */
      return railBadgeScrollIntent() && (performance.now() - railFollowMovementAt < 1200
        || railStickyIndex !== undefined || railDragging || railAnimFrame !== undefined || railNativeAnim === true);
    }
    /* 0.1.120（用户复测①副作用修复）：用户意图时间戳——聊天区滚轮、拖滑块、跳转（粘滞/动画）盖戳；
       只有盖戳新鲜期内的 scroll 才浮徽标 ⇒ 草稿栏长高/工具栏插入等**程序性滚动不再触发**。 */
    let railBadgeIntentUntil = 0;
    function stampRailBadgeIntent() { railRevealPending = false; railBadgeIntentUntil = Date.now() + 1200; }
    function railBadgeScrollIntent() {
      if (Date.now() < railBadgeIntentUntil) return true;
      if (railDragging) return true;
      if (railStickyIndex !== undefined && railStickyTarget !== undefined) return true;
      return railAnimFrame !== undefined || railNativeAnim === true;
    }
    function railBadgeEnabled() {
      return !(state !== undefined && state !== null && state.turnRailSettings !== undefined && state.turnRailSettings !== null && state.turnRailSettings.nodeBadge === false);
    }
    function hideRailBadge() {
      if (railBadgeTimer !== undefined) { clearTimeout(railBadgeTimer); railBadgeTimer = undefined; }
      const badge = elements.railBadge;
      if (badge !== undefined && badge !== null) badge.classList.remove('show');
    }
    function showRailBadge(mode, pointerY) {
      if (!railBadgeEnabled() || railTurnList.length === 0) return;
      railBadgeMode = mode;
      if (typeof pointerY === 'number') railBadgePointerY = pointerY;
      if (railBadgeFrame !== undefined) return;
      railBadgeFrame = requestAnimationFrame(() => {
        railBadgeFrame = undefined;
        const badge = elements.railBadge;
        if (badge === undefined || badge === null || railTurnList.length === 0) return;
        /* 编号 = 当前高位节点（跳转粘滞期取粘滞目标——滑块被钉住时读数与高亮一致）。 */
        const idx = railStickyIndex !== undefined && railNodesBuilt[railStickyIndex] !== undefined ? railStickyIndex : railActiveNode;
        let entry = railNodesBuilt[idx];
        let top = NaN;
        if (railBadgeMode === 'pointer') {
          const clip = elements.turnRailClip;
          if (clip !== undefined && clip !== null) {
            const clipRect = clip.getBoundingClientRect();
            top = railBadgePointerY - clipRect.top;
            /* 滚节点列/悬停时读数跟**指针所在区间**的节点（0.1.121 复测②：两节点之间归**上面**那个节点——
               与内容归属/高亮/滑块同一规则「最后一个 y ≤ 位置」；旧实现取"最近中点"，分界错位在节点中部）。 */
            const yInRail = (railBadgePointerY - clipRect.top) + clip.scrollTop;
            let hit = -1;
            for (let i = 0; i < railTurnList.length; i += 1) {
              const ny = railLayout.y[i];
              if (typeof ny !== 'number' || !Number.isFinite(ny)) continue;
              if (ny <= yInRail) hit = i;
              else break;
            }
            if (hit < 0) hit = 0;
            if (railNodesBuilt[hit] !== undefined) entry = railNodesBuilt[hit];
          }
        } else {
          const thumb = elements.turnRailThumb;
          const clip = elements.turnRailClip;
          /* 0.1.121 复测①：滑块 top 是**内容坐标**（滑块在滚动容器内）——换到轨道视口坐标须减 clip.scrollTop，
             否则深会话（轨道已滚）徽标被钳在轨道底部。 */
          if (thumb !== undefined && thumb !== null && clip !== undefined && clip !== null) {
            const thumbTop = parseFloat(thumb.style.top);
            const thumbH = parseFloat(thumb.style.height);
            if (Number.isFinite(thumbTop) && Number.isFinite(thumbH)) top = thumbTop - clip.scrollTop + thumbH / 2;
          }
        }
        if (entry === undefined || !Number.isFinite(top)) return;
        /* 0.1.122：徽标文案随「编号文案档位」。 */
        badge.textContent = railOrdinalText(entry.turnIndex + 1, railTurnList.length);
        const railH = railClientHeight > 0 ? railClientHeight : 40;
        badge.style.top = Math.round(Math.max(12, Math.min(railH - 12, top))) + 'px';
        badge.classList.add('show');
        /* 0.1.120：悬停期间常显（不排淡出）；离开指针由 mouseleave 排 0.9s 淡出。 */
        if (railBadgeTimer !== undefined) { clearTimeout(railBadgeTimer); railBadgeTimer = undefined; }
        if (!railBadgeHovering) {
          railBadgeTimer = setTimeout(() => { railBadgeTimer = undefined; badge.classList.remove('show'); }, 1000);
        }
      });
    }
    /* 0.1.120（用户复测②）：节点悬停提示**自绘**（约 120ms 浮出；原生 title 已改挂 data-tip——其延迟约 1s）。
       滚动/滚列后 600ms 内不弹（防"节点滑到指针下"的伪悬停）；与徽标互斥（悬停节点=本提示 / 悬停空隙=徽标）。 */
    let railTipTimer;
    let railTipMutedUntil = 0;
    let railTipNode;
    function hideRailTip() {
      if (railTipTimer !== undefined) { clearTimeout(railTipTimer); railTipTimer = undefined; }
      railTipNode = undefined;
      const tip = elements.railTip;
      if (tip !== undefined && tip !== null) tip.classList.add('hidden');
    }
    function muteRailTip(until) { railTipMutedUntil = Math.max(railTipMutedUntil, until); }
    function scheduleRailTip(node) {
      if (node === railTipNode) { const tip = elements.railTip; if (tip !== undefined && tip !== null && !tip.classList.contains('hidden')) return; }
      hideRailTip();
      railTipNode = node;
      if (Date.now() < railTipMutedUntil) return;
      railTipTimer = setTimeout(() => {
        railTipTimer = undefined;
        const tip = elements.railTip;
        if (tip === undefined || tip === null || railTipNode !== node || node.isConnected !== true) return;
        const text = node.dataset === undefined ? '' : String(node.dataset.tip || '');
        if (text === '') return;
        tip.textContent = text;
        tip.classList.remove('hidden');
        /* 0.1.121 复测①：节点 top 是**内容坐标**（节点在滚动容器内）——换到轨道视口坐标须减 clip.scrollTop，
           否则深会话（轨道已滚）提示被钳在轨道底部（用户实测"12 个以后全部钉底"）。
           0.1.122：两行档高度不定——显示后量一次（悬停一次性的读，不在滚动热路径）。 */
        tip.style.top = railTipTopFor(node, tip.offsetHeight > 0 ? tip.offsetHeight : 24) + 'px';
      }, 120);
    }
    /* 0.1.122：提示视口定位（内容坐标 − clip.scrollTop，钳在轨道内；两行档按实测高度居中）。 */
    function railTipTopFor(node, tipH) {
      const center = parseFloat(node.style.top);
      const c = Number.isFinite(center) ? center : 20;
      const clip = elements.turnRailClip;
      const scrollTopNow = clip !== undefined && clip !== null ? clip.scrollTop : 0;
      const railH = railClientHeight > 0 ? railClientHeight : 40;
      return Math.round(Math.max(2, Math.min(Math.max(2, railH - tipH - 2), c - scrollTopNow - tipH / 2)));
    }
    /* 0.1.122（G55 内容设置）：节点列滚动动画——指数平滑收敛（时长 = turnRail.scrollAnimSeconds，0=瞬时）。
       作用于：① 滚轮滚节点列（连续事件累加目标）；② 高亮自动跟随（followActive）。
       拖拽滑块/边缘自动滚列是逐帧连续动作——直接取消补间走原路径。 */
    let railTweenTarget = null;
    let railTweenFrame;
    let railTweenLast = 0;
    let railTweenActive = false;
    let railTweenSteps = 0;
    /* 0.1.127：本次补间的时长覆盖（跟随用更缓的 RAIL_FOLLOW_TAU；滚轮为 null=读设置）。 */
    let railTweenTau = null;
    function railTweenCancel() {
      railTweenTarget = null;
      railTweenTau = null;
      railTweenActive = false;
      if (railTweenFrame !== undefined) { cancelAnimationFrame(railTweenFrame); railTweenFrame = undefined; }
    }
    function railTweenTo(target, tauOverride) {
      const clip = elements.turnRailClip;
      if (clip === undefined || clip === null) return;
      const clamped = Math.max(0, Math.min(Math.max(0, clip.scrollHeight - clip.clientHeight), target));
      railTweenTau = tauOverride === 'follow' ? 'follow' : (typeof tauOverride === 'number' && tauOverride > 0 ? tauOverride : null);
      const tau = railTweenTau === null ? railScrollTau() : (railTweenTau === 'follow' ? RAIL_FOLLOW_TAU_MIN : railTweenTau);
      if (tau <= 0) { railTweenCancel(); writeRailScroll(clamped); return; }
      railTweenTarget = clamped;
      railTweenActive = true;
      if (railTweenFrame !== undefined) return;
      railTweenLast = performance.now();
      railTweenFrame = requestAnimationFrame(railTweenStep);
    }
    function railTweenStep(now) {
      railTweenFrame = undefined;
      railTweenSteps += 1;
      const clip = elements.turnRailClip;
      if (clip === undefined || clip === null || railTweenTarget === null) { railTweenActive = false; return; }
      /* dt 上限 500ms：headless/后台卡顿帧只损失"部分"积分（64ms 上限会把长停顿当无事发生 ⇒ 补间久不收敛）。 */
      const dt = Math.min(500, Math.max(8, now - railTweenLast)) / 1000;
      railTweenLast = now;
      const cur = clip.scrollTop;
      const diff = railTweenTarget - cur;
      /* 0.1.127：跟随自适应时长——|偏差| 越大越缓（大修正滑过去）、越小越快（常态追踪不露头）。 */
      const tauNow = railTweenTau === 'follow'
        ? Math.min(RAIL_FOLLOW_TAU_MAX, Math.max(RAIL_FOLLOW_TAU_MIN, RAIL_FOLLOW_TAU_MIN + Math.abs(diff) / 1600))
        : (railTweenTau !== null ? railTweenTau : railScrollTau());
      const k = 1 - Math.exp(-dt / Math.max(0.02, tauNow));
      let next = cur + diff * k;
      /* 亚像素死锁守卫（真机/夹具同测逮到：冻结在距目标 ~5px）：滚动位置按整数取整——
         每帧步进 < 1px 时会被 round 回原位，永远走不完最后几像素。步进保底 1px；读回后达 ≤1px 直接对齐。 */
      if (Math.abs(next - cur) < 1) next = cur + (diff > 0 ? 1 : -1);
      writeRailScroll(next);
      if (Math.abs(railTweenTarget - clip.scrollTop) <= 1) {
        writeRailScroll(railTweenTarget);
        railTweenTarget = null;
        railTweenTau = null;
        railTweenActive = false;
        rememberRailViewport();
        if (renderedSessionId) scheduleViewStatePersist(renderedSessionId, 'rail-settle', true);
      } else {
        railTweenFrame = requestAnimationFrame(railTweenStep);
      }
      /* 0.1.122：列在滑动 ⇒ 已显示的悬停提示/贴滑块徽标逐帧跟随（否则被列滚动甩开、陈旧到淡出）。 */
      const tipEl = elements.railTip;
      if (railTipNode !== undefined && tipEl !== undefined && tipEl !== null && tipEl.classList !== undefined && !tipEl.classList.contains('hidden') && railTipNode.isConnected === true) {
        tipEl.style.top = railTipTopFor(railTipNode, tipEl.offsetHeight > 0 ? tipEl.offsetHeight : 24) + 'px';
      }
      if (railBadgeMode !== 'pointer') {
        const badgeEl = elements.railBadge;
        if (badgeEl !== undefined && badgeEl !== null && badgeEl.classList !== undefined && badgeEl.classList.contains('show')) showRailBadge('thumb');
      }
    }
    /* 0.1.9（用户需求）：节点增删覆盖层（隐藏/合并）——身份键与收藏/标注同规范（'s<seq>' / 'k:<id>'）；
       只作用于轨道导航层（本函数输出），**不动消息与折叠**（折叠与轨道同源但不读该表）。 */
    function railDroppedSet() {
      if (typeof renderedSessionId !== 'string' || renderedSessionId === '') return new Set();
      return new Set(viewMemoOf(renderedSessionId).railDropped.keys());
    }
    function railEntryDropped(entry, dropped) {
      if (entry === undefined || dropped.size === 0) return false;
      const key = typeof entry.seq === 'number' && Number.isFinite(entry.seq)
        ? 's' + String(entry.seq)
        : (typeof entry.id === 'string' && entry.id !== '' ? 'k:' + entry.id : undefined);
      return key !== undefined && dropped.has(key);
    }
    /* 0.1.124（数据层根治）：当前会话全量表——会话戳一致才可用（切走后到达/旧会话的表一律不认）。 */
    function currentRailTable() {
      if (railTable === undefined || railTable === null) return undefined;
      const sessionNow = state !== undefined && state !== null && typeof state.sessionId === 'string' ? state.sessionId : '';
      return sessionNow !== '' && sessionNow === railTableSessionId ? railTable : undefined;
    }
    function railTurnsOf(current) {
      /* G49 v2（0.0.121）：优先用官方 turnOutline 投影——含**分页窗口之外的轮**（长会话首屏也能显示全部节；
         官方原话：the whole-log turn outline the chat rail renders for turns outside a client's paged event window，
         并以 turn/start 的 seq 作为跳转的"加载穿透目标"）。回落：已加载的 user 消息（0.1.1 或投影缺席时）。 */
      const cfg = (current && current.turnRailSettings) || {};
      /* 0.0.125：粒度 = turn（智能体回合，官方 turnOutline）或 segment（**与工作段折叠同源**，默认）。
         旧值 'prompt' 兼容读作 segment。 */
      const rawGranularity = cfg.granularity === 'turn' ? 'turn' : 'segment';
      if (rawGranularity === 'segment') {
        /* 0.1.124（数据层根治）：全量节点表在手 → 轨道**一律取表**（全集恒定：清单一集不随加载/Reload
           增删，编号零漂移）。已加载段的元素/摘要与折叠同源（按 seq 粘合 lastWorkSegments）；
           未加载节点无元素（turnIsPending ⇒ 几何停在上一测点、点击走穿透加载），摘要取所属轮的 prompt。 */
        const table = currentRailTable();
        if (table !== undefined) {
          const dropped = railDroppedSet();
          const liveBySeq = new Map();
          for (const segment of lastWorkSegments) {
            if (segment.element !== undefined && segment.seq !== undefined) liveBySeq.set(segment.seq, segment);
          }
          const outlinePieces = [];
          for (const item of array(current && current.turnOutline)) {
            const rec = record(item);
            if (rec === undefined) continue;
            const seq = typeof rec.seq === 'number' && Number.isFinite(rec.seq) ? rec.seq : undefined;
            if (seq === undefined) continue;
            outlinePieces.push({ seq, prompt: string(rec.prompt, '') });
          }
          const tableEntries = [];
          const tableSeqs = new Set();
          let lastTableSeq = -Infinity;
          let noElementLoaded = 0;
          const floor = firstLoadedSeq();
          for (const item of array(table.segment)) {
            const rec = record(item);
            if (rec === undefined) continue;
            const seq = typeof rec.seq === 'number' && Number.isFinite(rec.seq) ? rec.seq : undefined;
            if (seq === undefined) continue;
            if (seq > lastTableSeq) lastTableSeq = seq;
            tableSeqs.add(seq);
            const key = typeof rec.key === 'string' && rec.key !== '' ? rec.key : 's' + String(seq);
            if (dropped.has(key)) continue;
            const live = liveBySeq.get(seq);
            if (live !== undefined) {
              tableEntries.push({ id: key, seq, element: live.element, text: live.text, stop: rec.stop === true });
              continue;
            }
            /* 对账：表说该段在已加载区、DOM 却没有元素 —— 保真缺陷信号（留痕一次/会话）。 */
            if (floor !== undefined && seq >= floor) noElementLoaded += 1;
            let text = '';
            for (const piece of outlinePieces) {
              if (piece.seq <= seq && piece.prompt !== '') text = piece.prompt;
            }
            /* 0.1.125：前缀条目带 endSeq——按整轮区间判"已加载"（缺它 ⇒ 首节点永远点不动，0.0.137 同款）。 */
            tableEntries.push({ id: key, mid: rec.mid, seq, text, pending: true, stop: rec.stop === true, ...(typeof rec.endSeq === 'number' && Number.isFinite(rec.endSeq) ? { endSeq: rec.endSeq } : {}) });
          }
          /* 0.1.124（数据层根治）：尾合并——比表更新鲜的实时段（新回合/停点切段）纯追加在末尾，
             不动已有编号；同 seq 以表为准。 */
          for (const segment of lastWorkSegments) {
            if (segment.element === undefined || segment.seq === undefined || segment.seq <= lastTableSeq) continue;
            if (tableSeqs.has(segment.seq)) continue;
            tableSeqs.add(segment.seq);
            const key = 's' + String(segment.seq);
            if (dropped.has(key)) continue;
            tableEntries.push({ id: key, seq: segment.seq, element: segment.element, text: segment.text, liveTail: true });
          }
          if (noElementLoaded > 0 && current !== undefined && current !== null && typeof current.sessionId === 'string'
            && railMismatchLoggedFor !== current.sessionId) {
            railMismatchLoggedFor = current.sessionId;
            diagLoad('rail-mismatch', { sessionId: current.sessionId, missing: noElementLoaded });
          }
          return tableEntries;
        }
        // A paged window cannot determine the detailed prefix. Its first visible
        // list must come from the complete table, never mixed turn/segment nodes.
        if (current && current.hasMoreHistory === true) return [];
        if (current !== undefined && current !== null && typeof current.sessionId === 'string' && current.sessionId !== ''
          && railFallbackLoggedFor !== current.sessionId) {
          railFallbackLoggedFor = current.sessionId;
          diagLoad('rail-fallback', { sessionId: current.sessionId });
        }
        /* 段模式：直接用折叠划段的结果——节点=段首，跳转必落在段首（不会跳进折起的过程里）。 */
        const dropped = railDroppedSet();
        const entries = [];
        for (const segment of lastWorkSegments) {
          if (segment.element === undefined) continue;
          /* 0.0.148：段锚点 seq 随条目下传（收藏键/停点判定的稳定身份）。 */
          entries.push({
            id: segment.key !== undefined ? segment.key : 'el', element: segment.element, text: segment.text,
            ...(segment.seq === undefined ? {} : { seq: segment.seq }),
          });
        }
        /* 0.1.9：过滤前计数——全部节点被隐藏时也不许回落到其它分支（轨道应为空→自动隐藏）。 */
        const segmentCount = entries.length;
        const visibleEntries = entries.filter(entry => !railEntryDropped(entry, dropped));
        if (segmentCount > 0) return visibleEntries;
      }
      const dropped = railDroppedSet();
      const outline = rawGranularity === 'segment' ? [] : array(current && current.turnOutline);
      const entries = [];
      for (const item of outline) {
        const entry = record(item);
        if (entry === undefined) continue;
        const seq = typeof entry.seq === 'number' && Number.isFinite(entry.seq) ? entry.seq : undefined;
        const turn = typeof entry.turn === 'number' ? entry.turn : undefined;
        if (seq === undefined || turn === undefined) continue;
        const outlineEntry = { id: 'seq:' + String(seq), seq, text: string(entry.prompt, '') };
        if (!railEntryDropped(outlineEntry, dropped)) entries.push(outlineEntry);
      }
      if (entries.length > 0) return entries;
      const turns = [];
      for (const item of array(current && current.messages)) {
        const message = record(item);
        if (message && message.role === 'user' && typeof message.id === 'string') {
          const turnEntry = { id: message.id, text: string(message.text, '') };
          if (!railEntryDropped(turnEntry, dropped)) turns.push(turnEntry);
        }
      }
      return turns;
    }
    /* 0.1.122（G55 内容设置）：摘要长度（24–80，默认 40）。 */
    function railSummaryLen() {
      const v = state !== undefined && state !== null && state.turnRailSettings !== undefined && state.turnRailSettings !== null ? state.turnRailSettings.summaryLength : undefined;
      return typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(80, Math.max(24, v))) : 40;
    }
    /* 0.1.122：编号文案档位——compact「N/M」/ full「第 N/M 个节点」/ legacy「第 N 轮」。
       联动：提示前缀、搜索行编号片、浮出徽标；aria 恒用完整措辞「第 N/M 个节点」。 */
    function railNumberStyle() {
      const v = state !== undefined && state !== null && state.turnRailSettings !== undefined && state.turnRailSettings !== null ? state.turnRailSettings.numberStyle : undefined;
      return v === 'full' || v === 'legacy' ? v : 'compact';
    }
    function railOrdinalText(num, total) {
      const style = railNumberStyle();
      if (style === 'legacy') return '第 ' + String(num) + ' 轮';
      if (style === 'full') return '第 ' + String(num) + '/' + String(total) + ' 个节点';
      return String(num) + '/' + String(total);
    }
    /* 0.1.122：节点列滚动动画时长（秒，0=瞬时）。 */
    function railScrollTau() {
      const v = state !== undefined && state !== null && state.turnRailSettings !== undefined && state.turnRailSettings !== null ? state.turnRailSettings.scrollAnimSeconds : undefined;
      return typeof v === 'number' && Number.isFinite(v) ? Math.min(0.6, Math.max(0, v)) : 0.18;
    }
    function railSnippetOf(text) {
      const flat = String(text || '').replace(/\\s+/g, ' ').trim();
      if (flat === '') return '（附件/空消息）';
      const max = railSummaryLen();
      return flat.length > max ? flat.slice(0, max) + '…' : flat;
    }
    /* ---- 0.0.148（G53）：节点收藏 / 标注 / 停点自动标注 ----
       收藏数据入会话记忆通道（viewMemo.<sessionId>.marks，经 session-view-state 持久化）。
       节点键=**归一化 seq 优先**（'s<seq>'）——"未加载前缀节点（seq:60）"加载完变成"段节点
       （ws:msgid）"后收藏不丢，段↔回合粒度切换也能对上；推不出 seq 时回落 'k:<turn id>'。 */
    function railTurnSeqOf(turn) {
      if (turn === undefined) return undefined;
      if (typeof turn.seq === 'number' && Number.isFinite(turn.seq)) return turn.seq;
      const el = turn.element !== undefined ? turn.element : (typeof turn.id === 'string' ? railTurnEls.get(turn.id) : undefined);
      if (el !== undefined && el !== null && typeof el.closest === 'function') {
        const host = el.closest('[data-seq]');
        if (host !== null) {
          const value = Number(host.getAttribute('data-seq'));
          if (Number.isFinite(value)) return value;
        }
      }
      return undefined;
    }
    function railMarkKeyOf(turnIndex) {
      const turn = railTurnList[turnIndex];
      if (turn === undefined) return undefined;
      const seq = railTurnSeqOf(turn);
      if (seq !== undefined) return 's' + String(seq);
      return typeof turn.id === 'string' && turn.id !== '' ? 'k:' + turn.id : undefined;
    }
    /* 0.0.151：区间扫描的**上界**——优先条目自带 endSeq（段模式前缀），否则取"下一个有 seq 的
       节点"（turn 模式条目没有 endSeq；不加界会把后续轮的收藏全部吞进本节点——截图自查实测
       "收藏第 2 个节点时第 1 个节点也被标金"）。末节点无上界（跑到会话尾，语义正确）。 */
    function railMarkUpperBound(turnIndex) {
      const turn = railTurnList[turnIndex];
      if (turn !== undefined && typeof turn.endSeq === 'number') return turn.endSeq;
      for (let i = turnIndex + 1; i < railTurnList.length; i += 1) {
        const seq = railTurnSeqOf(railTurnList[i]);
        if (seq !== undefined) return seq;
      }
      return undefined;
    }
    /* 0.0.148（G53 反馈④）：轮起点表——把任意 seq 归一到"所属轮的起点 seq"。
       段节点锚点 seq（消息/停点后首条）与前缀节点 seq（turnOutline 起点）由此对上：
       前缀时代存的键 's<轮起点>' 在加载后仍能命中。 */
    function outlineTurnStarts() {
      const starts = [];
      for (const item of array(state && state.turnOutline)) {
        const entry = record(item);
        const seq = entry === undefined ? undefined : entry.seq;
        if (typeof seq === 'number' && Number.isFinite(seq)) starts.push(seq);
      }
      starts.sort((a, b) => a - b);
      return starts;
    }
    function turnStartOf(seq, starts) {
      let lo = 0, hi = starts.length;
      while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (starts[mid] <= seq) lo = mid + 1; else hi = mid; }
      return lo === 0 ? undefined : starts[lo - 1];
    }
    /* 一次标记刷新共享轮归属与首节点；不为每个节点反复扫描整个轨道。 */
    function railMarkLookup() {
      const starts = outlineTurnStarts(), firstByStart = new Map();
      for (let i = 0; i < railTurnList.length; i += 1) {
        const seq = railTurnSeqOf(railTurnList[i]);
        if (seq === undefined) continue;
        const start = turnStartOf(seq, starts);
        if (start !== undefined && !firstByStart.has(start)) firstByStart.set(start, i);
      }
      return { starts, firstByStart };
    }
    /* 键解析内核（双向对账，收藏/标注共用）：
       ① 精确键；② 未加载前缀节点：扫 's<X>' 且 X ∈ [seq, endSeq)（加载后存的锚点键）；
       ③ 已加载节点：回查 's<轮起点>'（前缀时代存的键）。
       0.0.156：存在性判定 hasKey 与区间扫描源 scanKeys 由调用方传入——收藏（stars）与标注（marks）各查各的表。 */
    function railHitKey(turnIndex, hasKey, scanKeys, lookup) {
      if (typeof renderedSessionId !== 'string' || renderedSessionId === '') return undefined;
      const exact = railMarkKeyOf(turnIndex);
      const turn = railTurnList[turnIndex];
      const elementLoaded = turn !== undefined && turn.element !== undefined;
      const seq = railTurnSeqOf(turn);
      if (exact !== undefined && hasKey(exact)) return exact;
      if (!elementLoaded && typeof turn !== 'undefined' && typeof turn.seq === 'number') {
        const endSeq = railMarkUpperBound(turnIndex);
        for (const key of scanKeys) {
          const match = /^s(\\d+)$/.exec(key);
          if (match === null) continue;
          const value = Number(match[1]);
          if (value >= turn.seq && (endSeq === undefined || value < endSeq)) return key;
        }
      }
      if (elementLoaded && seq !== undefined) {
        const starts = lookup === undefined ? outlineTurnStarts() : lookup.starts;
        const start = turnStartOf(seq, starts);
        /* 只认该轮的**第一个**节点（前缀时代的键=轮起点，加载后应落在轮首段）——否则同轮多个段
           都会命中（实测：轮 1 的 3 个段 node0/2/3 同时变金）。 */
        let firstOfTurn = lookup === undefined ? true : lookup.firstByStart.get(start) === turnIndex;
        if (lookup === undefined && start !== undefined) {
          for (let i = 0; i < turnIndex && firstOfTurn; i += 1) {
            const otherSeq = railTurnSeqOf(railTurnList[i]);
            if (otherSeq !== undefined && turnStartOf(otherSeq, starts) === start) firstOfTurn = false;
          }
        }
        if (start !== undefined && firstOfTurn) {
          const key = 's' + String(start);
          if (hasKey(key)) return key;
        }
      }
      return undefined;
    }
    /* 标注命中（返回命中键 + 文本）。 */
    function railMarkQuery(turnIndex, lookup) {
      if (typeof renderedSessionId !== 'string' || renderedSessionId === '') return undefined;
      const memo = viewMemoOf(renderedSessionId);
      if (memo.marks.size === 0) return undefined;
      const key = railHitKey(turnIndex, (candidate) => memo.marks.has(candidate), memo.marks.keys(), lookup);
      return key === undefined ? undefined : { key, note: memo.marks.get(key) };
    }
    /* 0.0.156：收藏命中（独立于标注）。 */
    function railStarQuery(turnIndex, lookup) {
      if (typeof renderedSessionId !== 'string' || renderedSessionId === '') return undefined;
      const memo = viewMemoOf(renderedSessionId);
      if (memo.stars.size === 0) return undefined;
      return railHitKey(turnIndex, (candidate) => memo.stars.has(candidate), memo.stars, lookup);
    }
    /* 取消收藏要清掉该逻辑节点的全部可能键（精确 + 轮起点 + 前缀区间内）。
       0.0.156：改为对指定容器生成键集合（scanKeys=stars 时只清收藏，标注不动）。 */
    function railKeysToClear(turnIndex, scanKeys) {
      const keys = new Set();
      const exact = railMarkKeyOf(turnIndex);
      if (exact !== undefined) keys.add(exact);
      const turn = railTurnList[turnIndex];
      if (turn === undefined) return keys;
      const elementLoaded = turn.element !== undefined;
      const seq = railTurnSeqOf(turn);
      if (!elementLoaded && typeof turn.seq === 'number') {
        const endSeq = railMarkUpperBound(turnIndex);
        for (const key of scanKeys) {
          const match = /^s(\\d+)$/.exec(key);
          if (match === null) continue;
          const value = Number(match[1]);
          if (value >= turn.seq && (endSeq === undefined || value < endSeq)) keys.add(key);
        }
      }
      if (elementLoaded && seq !== undefined) {
        const start = turnStartOf(seq, outlineTurnStarts());
        if (start !== undefined) keys.add('s' + String(start));
      }
      return keys;
    }
    /* 停点判定（0.0.153 用户口径定案）：菱形**只属于"应答段"节点**——段首元素就是/含提问留痕卡·
       审批决定卡（0.0.139 几何代位的准确语义：点它跳到的就是"你的选择"）。
       未加载的轮在轨道上压成**一个合并节点**（段首=用户消息），**不显示菱形**——用户实测核对：
       "第一个节点确实不应该是菱形"（显示会顶掉收藏形态、也不代表应答段）。
       历史：0.0.149 曾对已加载节点放开区间兜底 → 留痕卡无 data-seq 致成片误标；
       0.0.152 又把区间只给未加载前缀 → 合并节点被顶成菱形（本条回退）。 */
    function railNodeIsStop(index) {
      const entry = railNodesBuilt[index];
      const turn = entry === undefined ? undefined : railTurnList[entry.turnIndex];
      if (turn === undefined) return false;
      if (turn.stop === true) return true;
      const el = turn.element !== undefined ? turn.element : (typeof turn.id === 'string' ? railTurnEls.get(turn.id) : undefined);
      if (el === undefined || el === null || typeof el.matches !== 'function') return false;
      if (el.matches('.ask-record, .decision-card')) return true;
      return typeof el.querySelector === 'function' && el.querySelector('.ask-record, .decision-card') !== null;
    }
    function applyRailMarks() {
      const memo = typeof renderedSessionId === 'string' && renderedSessionId !== '' ? viewMemoOf(renderedSessionId) : undefined;
      const lookup = memo !== undefined && (memo.stars.size > 0 || memo.marks.size > 0) ? railMarkLookup() : undefined;
      const markStops = !(state && state.turnRailSettings && state.turnRailSettings.markStops === false);
      /* 0.0.148 反馈② / 0.0.149 设置化：有标注时提示默认**只显示标注内容**（turnRail.markNoteOnly
         关 = 恢复"标注 + N/M · 摘要"叠加式；0.1.114 起编号口径 = 可见节点序）。 */
      const noteOnly = !(state && state.turnRailSettings && state.turnRailSettings.markNoteOnly === false);
      for (let i = 0; i < railNodesBuilt.length; i += 1) {
        const entry = railNodesBuilt[i];
        /* 0.0.156：金色=收藏（stars）；标注（marks）独立——未收藏的标注不改变节点外观，只进悬停提示（✎ 前缀）。 */
        const starred = railStarQuery(entry.turnIndex, lookup) !== undefined;
        const hit = railMarkQuery(entry.turnIndex, lookup);
        const note = hit === undefined ? '' : (hit.note || '');
        entry.el.classList.toggle('marked', starred);
        const stop = markStops && railNodeIsStop(i);
        entry.el.classList.toggle('stop', stop);
        const turn = railTurnList[entry.turnIndex];
        /* 0.1.114（G55 轨道序号）：编号口径 = 可见节点序（与 buildTurnRail 同源同措辞；0.1.122 随「编号文案档位」）。 */
        const base = railOrdinalText(entry.turnIndex + 1, railTurnList.length) + ' · ' + railSnippetOf(turn === undefined ? '' : turn.text);
        let title;
        if (note !== '') title = noteOnly ? (starred ? '★ ' : '✎ ') + note : (starred ? '★ ' : '✎ ') + note + ' · ' + base;
        else title = (starred ? '★ ' : '') + base;
        if (stop) title += '（含提问/审批）';
        /* 0.1.5（用户+朋友反馈）：不再对悬停提示追加入口说明后缀（每节点都挂无意义且占宽，
           此前 B4 P2 加的）。右键菜单本身不变。
           0.1.120：提示文案改挂 data-tip（自绘快提示读取；不再用原生 title——其延迟约 1s）。 */
        entry.el.dataset.tip = title;
        entry.el.setAttribute('aria-label', (starred ? '已收藏 · ' : '') + (note !== '' ? '有标注 · ' : '') + '第 ' + String(entry.turnIndex + 1) + '/' + String(railTurnList.length) + ' 个节点');
      }
    }
    /* 右键菜单：收藏/取消收藏（独立）+ 编辑标注（独立，不再自动收藏）。（点击仍是跳转，零误触） */
    function openRailNodeMenu(turnIndex, x, y) {
      if (typeof renderedSessionId !== 'string' || renderedSessionId === '') return;
      const key = railMarkKeyOf(turnIndex);
      if (key === undefined) return;
      hideRailTip();   /* 0.1.122（审查）：右键菜单打开时收起悬停提示（指针不动时提示会滞留在菜单旁）。 */
      showCtxMenu(x, y, () => {
        const memo = viewMemoOf(renderedSessionId);
        const starred = railStarQuery(turnIndex) !== undefined;
        const options = [];
        if (starred) {
          options.push(ctxMenuOption('☆ 取消收藏', () => {
            for (const candidate of railKeysToClear(turnIndex, memo.stars)) memo.stars.delete(candidate);
            applyRailMarks();
            scheduleViewStatePersist(renderedSessionId);
          }));
        } else {
          options.push(ctxMenuOption('★ 收藏此节点', () => { memo.stars.add(key); applyRailMarks(); scheduleViewStatePersist(renderedSessionId); }));
        }
        options.push(ctxMenuOption('编辑标注…', () => { openMarkNote(turnIndex); }));
        /* 0.1.9（用户需求）：节点增删（导航层覆盖）——只影响轨道节点；"请继续"这类碎段可合并。
           已隐藏/合并的节点不再渲染（除非键漂移仍可见），恢复入口 = 任一节点菜单的"恢复全部"。 */
        const dropped = memo.railDropped.get(key);
        const applyDropChange = () => { updateTurnRail(state); scheduleViewStatePersist(renderedSessionId); };
        if (dropped === undefined) {
          if (turnIndex > 0) options.push(ctxMenuOption('与上一节点合并', () => {
            memo.railDropped.set(key, 'merged'); applyDropChange();
            showToast('已并入上一节点（右键任一节点可恢复全部）');
          }));
          options.push(ctxMenuOption('从导航中隐藏此节点', () => {
            memo.railDropped.set(key, 'hidden'); applyDropChange();
            showToast('已从导航中隐藏（右键任一节点可恢复全部）');
          }));
        } else {
          options.push(ctxMenuOption('恢复此节点', () => {
            memo.railDropped.delete(key); applyDropChange();
            showToast('已恢复此节点');
          }));
        }
        if (memo.railDropped.size > 0) {
          options.push(ctxMenuOption('恢复全部隐藏/合并的节点（' + String(memo.railDropped.size) + '）', () => {
            memo.railDropped.clear(); applyDropChange();
            showToast('已恢复全部节点');
          }));
        }
        return options;
      });
    }
    /* G41 v1.2（0.0.101）：跳转动画——时长取设置 turnRail.jumpSeconds（秒；0=瞬时）；
       用户输入（滚轮/触摸/按下）即刻取消动画接管；系统"减少动态效果"= 瞬时。 */
    function railReducedMotion() {
      if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
      return document.body.classList.contains('vscode-reduce-motion');
    }
    function railJumpSeconds() {
      const s = state && state.turnRailSettings ? state.turnRailSettings.jumpSeconds : undefined;
      if (typeof s !== 'number' || !Number.isFinite(s) || s < 0) return 0.25;
      return Math.min(1.5, s);
    }
    function cancelRailAnim() {
      if (railAnimFrame !== undefined) { cancelAnimationFrame(railAnimFrame); railAnimFrame = undefined; }
      if (railNativeThumbFrame !== undefined) { cancelAnimationFrame(railNativeThumbFrame); railNativeThumbFrame = undefined; }
      railThumbGlideFrom = undefined; railThumbGlideTo = undefined; railThumbGlideY = undefined;
      railFollowAfterAnim = false;
    }
    /* 0.1.12（用户实测"运行中跳转卡、静止时流畅"）：**运行中改走原生平滑滚动**——合成器线程驱动，
       主线程被流式渲染占满时滚动依然顺滑（headless 重夹具复现不出该卡顿，故以机制+真机诊断取数）。
       静止时保留 rAF 精确时长路径（turnRail.jumpSeconds 语义不变）。 */
    const railUseNative = () => state !== undefined && state.running === true && !railReducedMotion() && railJumpSeconds() > 0;
    let railNativeAnim = false;
    let railNativeThumbFrame;
    /* 2026-09-24（遗留 bug③）：轨道跳转的"收尾记账"——动画期 scroll 监听一律早退
       （railAnimFrame/railNativeAnim），而末帧位移 <1px（位置取整后无变化）⇒ 动画结束后
       往往没有可捕获的 scroll 事件 ⇒ 位置记忆停在跳转前（Reload 后回错位置）。
       两条跳转路径（rAF / 原生平滑）的收尾都必须显式写一次记忆。 */
    function railMemoAfterJump() {
      if (state === undefined || state === null || typeof state.sessionId !== 'string' || state.sessionId === '') return;
      if (!viewMemoryCfg().scroll) return;
      /* 动画中上方高度可能变化；收尾按所选 seq 对齐，再沿阅读锚点补偿懒建。 */
      if (railNavigationLocked && railAnimFrame === undefined && railNativeAnim !== true) {
        const target = railTurnList.find(turn => turn.id === railNavigationId);
        const el = target && effectiveRailElement(railElementFor(target));
        if (el && !(state.running === true && target === railTurnList.at(-1))) {
          const scrollEl = elements.scroll;
          selfScrollStamp = performance.now();
          scrollEl.scrollTop += el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top;
          railStickyTarget = scrollEl.scrollTop; markScrollSeen();
          const ref = el.dataset && el.dataset.mid
            ? { id: el.dataset.mid, offset: scrollEl.getBoundingClientRect().top - el.getBoundingClientRect().top, seq: railNavigationSeq }
            : captureHistoryAnchorRef();
          if (ref) openRestoreWindow({ sessionId: state.sessionId, top: scrollEl.scrollTop,
            anchorId: ref.id, anchorOffset: ref.offset, anchorSeq: ref.seq,
            deadline: Date.now() + MERGE_SETTLE_WINDOW_MS, userTouched: false, kind: 'history-merge', navigation: true });
          updateRailActive();
        }
      }
      rememberRailViewport();
      captureScrollMemo(state.sessionId, true);
      scheduleViewStatePersist(state.sessionId, 'rail-jump');
    }
    function railScrollToNative(target, thumbTo, followAfter) {
      const scrollEl = elements.scroll;
      cancelRailAnim();
      detachConversationTail();
      const from = scrollEl.scrollTop;
      const to = Math.max(0, Math.min(scrollEl.scrollHeight - scrollEl.clientHeight, target));
      railFollowAfterAnim = followAfter === true;
      if (Math.abs(to - from) < 1) {
        scrollEl.scrollTop = to;
        programmaticScroll = false;
        if (railFollowAfterAnim) { railFollowAfterAnim = false; followConversationTail = true; }
        return to;
      }
      railNativeAnim = true;
      programmaticScroll = true;
      /* 滑块不逐帧滑行（那要每帧读布局）——粘滞高亮/滑块在起点即钉到目标节点（与 0.0.138 粘滞同语言）。 */
      railThumbGlideFrom = undefined; railThumbGlideTo = undefined; railThumbGlideY = undefined;
      /* 0.1.13（用户实测"滑块先跳过去→再回来→再动画过去"）：原生动画期间滑块**只跟随真实滚动**
         （像真滚动条）——不做粘滞钉目标（否则点击瞬间滑块先跳到终点，随后粘滞被流式渲染清掉又弹回，
         再跟着动画走一遍 = 三段式）。高亮仍由 updateRailActive 的粘滞钉在点击节点上。
         跟随用小 rAF 环（只刷滑块，不跑几何判定）；内容滚动本身在合成器线程，不受主线程影响。 */
      const stepThumb = () => {
        if (railNativeAnim !== true) return;
        syncRailIndicator();
        railNativeThumbFrame = requestAnimationFrame(stepThumb);
      };
      railNativeThumbFrame = requestAnimationFrame(stepThumb);
      const finish = () => {
        if (!railNativeAnim) return;
        railNativeAnim = false;
        if (railNativeThumbFrame !== undefined) { cancelAnimationFrame(railNativeThumbFrame); railNativeThumbFrame = undefined; }
        programmaticScroll = false;
        if (railFollowAfterAnim) { railFollowAfterAnim = false; followConversationTail = true; }
        updateRailActive();
        railMemoAfterJump();
      };
      let timer = 0;
      const onEnd = () => { scrollEl.removeEventListener('scrollend', onEnd); window.clearTimeout(timer); finish(); };
      scrollEl.addEventListener('scrollend', onEnd);
      timer = window.setTimeout(onEnd, 1200); /* 兜底：scrollend 缺席（旧内核）或被打断未触发 */
      scrollEl.scrollTo({ top: to, behavior: 'smooth' });
      updateRailActive(); /* 高亮起点即钉点击节点（滑块不钉——见上） */
      return to;
    }
    function railScrollTo(target, thumbTo, followAfter) {
      /* 0.1.128（用户需求①）：任何跳转落位后即时落盘视图记忆（600ms 待动画落定再抓锚）。 */
      armJumpPersist();
      if (railUseNative()) return railScrollToNative(target, thumbTo, followAfter);
      const scrollEl = elements.scroll;
      cancelRailAnim();
      detachConversationTail();
      const from = scrollEl.scrollTop;
      const to = Math.max(0, Math.min(scrollEl.scrollHeight - scrollEl.clientHeight, target));
      const ms = railReducedMotion() ? 0 : railJumpSeconds() * 1000;
      railFollowAfterAnim = followAfter === true;
      if (ms <= 0 || Math.abs(to - from) < 1) {
        scrollEl.scrollTop = to;
        programmaticScroll = false;
        if (railFollowAfterAnim) { railFollowAfterAnim = false; followConversationTail = true; }
        requestAnimationFrame(railMemoAfterJump);
        return to;
      }
      /* 0.0.141：滑块滑行——起点取当前实际渲染的顶端（可能正被上一段粘滞/滑行钉着），
         终点 = 目标节点 y。同步设置起点值：动画首帧之前若有 scroll 事件触发渲染，
         滑块也不会先"瞬移"一帧。 */
      if (typeof thumbTo === 'number' && Number.isFinite(thumbTo)) {
        const thumb = elements.turnRailThumb;
        const currentTop = thumb === null || thumb === undefined ? NaN : parseFloat(thumb.style.top);
        railThumbGlideFrom = Number.isFinite(currentTop) ? currentTop : railMapC2R(from);
        railThumbGlideTo = thumbTo;
        railThumbGlideY = railThumbGlideFrom;
      }
      const started = performance.now();
      const step = (now) => {
        railAnimFrame = undefined;
        const t = Math.min(1, (now - started) / ms);
        const eased = 1 - Math.pow(1 - t, 3);
        scrollEl.scrollTop = from + (to - from) * eased;
        if (railThumbGlideFrom !== undefined && railThumbGlideTo !== undefined) {
          railThumbGlideY = railThumbGlideFrom + (railThumbGlideTo - railThumbGlideFrom) * eased;
          syncRailIndicator();
        }
        if (t < 1) railAnimFrame = requestAnimationFrame(step);
        else {
          railThumbGlideFrom = undefined; railThumbGlideTo = undefined; railThumbGlideY = undefined;
          programmaticScroll = false;
          /* 0.1.9（B）：动画结束才挂跟随（运行中点末节点=跳真底；见 railFollowAfterAnim 注释）。 */
          if (railFollowAfterAnim) { railFollowAfterAnim = false; followConversationTail = true; }
          /* 0.1.9（A 削帧）：动画期跳过的几何判定/滑块刷新在此收尾一次（内部会再调 syncRailIndicator）。 */
          updateRailActive();
          /* 2026-09-24（遗留 bug③）：末帧位移 <1px（取整后无变化）⇒ 之后无 scroll 事件可记账，显式补一次。 */
          railMemoAfterJump();
        }
      };
      railAnimFrame = requestAnimationFrame(step);
      return to;
    }
    /* G49 v2（0.0.121）：待跳转目标若已在 DOM（穿透加载完成/页面更新后），滚动到位并清待办。 */
    function tryPendingRailJump() {
      if (pendingRailJumpSeq === undefined) return;
      if (!state || state.sessionId !== pendingRailJumpSession || state.loadingHistory === true || progressiveFill !== undefined) return;
      /* 0.0.137：必须取**节点清单里的真实轮**（带 endSeq 区间界）——裸 {seq} 会退回旧守卫，
         把"turn/start seq 低于窗口首元素"的已加载轮永远当成未加载（穿透加载回包后跳转仍不落位）。
         0.0.139：清单里找不到时（该轮的前缀节点已因去重被移除 = 其 user 消息已进窗口）按"已加载"
         处理直接按 seq 定位，否则回包后的跳转又会静默失败。 */
      const target = railNavigationLocked
        ? railTurnList.find(candidate => candidate.id === railNavigationId)
        : railTurnList.find(candidate => candidate.seq === pendingRailJumpSeq);
      const el = effectiveRailElement(railElementFor(target !== undefined ? target : { seq: pendingRailJumpSeq, assumeLoaded: true }));
      if (el === undefined) return;
      const turnIndex = target === undefined ? -1 : railTurnList.indexOf(target);
      if (turnIndex < 0) return;
      const targetSeq = target.seq;
      clearHistoryJump();
      pendingRailJumpSeq = undefined;
      pendingRailJumpSession = undefined;
      cancelRailAnim(); clearRestoreCtx();
      programmaticScroll = true;
      const scrollEl = elements.scroll;
      const delta = el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top;
      detachConversationTail();
      railStickyIndex = turnIndex;
      railStickyTarget = Math.max(0, Math.min(scrollEl.scrollHeight - scrollEl.clientHeight, scrollEl.scrollTop + delta));
      scrollEl.scrollTop = railStickyTarget; markScrollSeen();
      const ref = captureHistoryAnchorRef();
      if (ref) openRestoreWindow({ sessionId: state.sessionId, top: scrollEl.scrollTop,
        anchorId: ref.id, anchorOffset: ref.offset, anchorSeq: targetSeq,
        deadline: Date.now() + MERGE_SETTLE_WINDOW_MS, userTouched: false, kind: 'history-merge', navigation: true });
      railGeomDirty = true; updateTurnRail(state);
      updateRailActive();
      followRailActive(true);
      railMemoAfterJump();
    }
    /* 0.0.137（用户实测④"点第三个跳转点会把过程自动展开"）：跳转**永不展开任何过程**。
       历史包袱说明：0.0.121 起跳转会对"段首在折叠体内"的段（ws~: 前导/停点段）做临时展开，
       否则目标在 display:none 中、跳转落空；0.0.134 又把该展开改成直写内存临时态。
       现在改为**几何代位**（见 effectiveRailElement）：折起的段用它的折叠条（就插在段首元素
       之前、与段首同位置）作为跳转/测距目标——目标永远可见，展开与否交还用户自己点。 */
    function effectiveRailElement(el) {
      if (el === undefined || el === null || el.hidden !== true) return el;
      let node = el.previousElementSibling;
      while (node !== null && node !== undefined) {
        if (node.classList !== undefined && node.classList.contains('work-fold-bar')) return node;
        if (node.hidden !== true) return node;
        node = node.previousElementSibling;
      }
      return el;
    }
    /* 临时轮起点/页首段变为完整表时保留点击语义，不把旧编号套到新清单。
       同 seq 优先；临时目标只能在所属轮内找到包含它的详细段，正式节点移除不改指向邻居。 */
    function resolveRailTurn(target, turns) {
      if (!target) return undefined;
      const exact = turns.find(turn => turn.id === target.id || (typeof target.seq === 'number' && turn.seq === target.seq));
      if (exact) return exact;
      if (typeof target.seq !== 'number' || /^s[0-9]+$/.test(target.id || '')) return undefined;
      let start, end = typeof target.endSeq === 'number' ? target.endSeq : Infinity;
      for (const item of array(state && state.turnOutline)) {
        if (typeof item.seq !== 'number') continue;
        if (item.seq <= target.seq && (start === undefined || item.seq > start)) start = item.seq;
        if (item.seq > target.seq && item.seq < end) end = item.seq;
      }
      if (start === undefined) return undefined;
      const candidates = turns.filter(turn => typeof turn.seq === 'number' && turn.seq >= start && turn.seq < end);
      return candidates.filter(turn => turn.seq <= target.seq).at(-1) || candidates[0];
    }
    function railJump(clickedTurn, sessionId) {
      if (!state || sessionId !== state.sessionId || sessionId !== renderedSessionId || sessionId !== railListSessionId) return;
      /* state 帧已接表而 RAF 尚未重建时，先同步重绑，再解析旧按钮捕获的身份。 */
      if (railKey === '') updateTurnRail(state);
      const turn = resolveRailTurn(clickedTurn, railTurnList);
      if (!turn) return;
      const turnIndex = railTurnList.indexOf(turn);
      clearHistoryJump();
      pendingSearchJump = undefined;
      clearRestoreThroughTarget();
      clearRestoreCtx();
      if (restoreApplyFrame !== undefined) { cancelAnimationFrame(restoreApplyFrame); restoreApplyFrame = undefined; }
      pendingRailJumpSeq = undefined; pendingRailJumpSession = undefined;
      railRevealPending = false; railNavigationLocked = true;
      railNavigationSeq = turn.seq;
      railNavigationId = turn.id;
      if (renderedSessionId) viewMemoOf(renderedSessionId).railViewportManual = false;
      railTweenCancel(); stampRailBadgeIntent();
      /* 手动滚列后旧滑块可能在屏外。点击时从当前视窗边缘起步，不能为旧起点滚回整列。 */
      const clip = elements.turnRailClip, thumb = elements.turnRailThumb;
      if (clip && thumb) {
        const shown = parseFloat(thumb.style.top);
        const start = Math.max(clip.scrollTop, Math.min(Number.isFinite(shown) ? shown : clip.scrollTop,
          clip.scrollTop + Math.max(0, clip.clientHeight - railThumbLen())));
        if (railThumbSmoothFrame !== undefined) { cancelAnimationFrame(railThumbSmoothFrame); railThumbSmoothFrame = undefined; }
        railThumbSmoothTarget = undefined; railThumbSmoothUserDriven = false;
        railThumbSmoothShown = start; thumb.style.top = start + 'px';
      }
      vscode.postMessage({ type: 'cancel-history-navigation' });
      const el = effectiveRailElement(railElementFor(turn));
      if (el === undefined) {
        /* G49 v2（0.0.121）：该轮尚未加载 → 请求端侧按 seq 穿透加载，加载完成回 turn-jump-ready。 */
        if (turn !== undefined && typeof turn.seq === 'number') {
          pendingRailJumpSeq = turn.seq;
          pendingRailJumpSession = state.sessionId;
          startHistoryJump('rail', turn.seq);
        }
        return;
      }
      programmaticScroll = true;
      if (restoreCtx) restoreCtx.userTouched = true;
      const scrollEl = elements.scroll;
      /* 0.1.9（用户需求 B）：运行中点**最后一个节点** = 回到"正在发生的地方"——直接跳真底并恢复
         跟随（末段还在生长时，段首离实时内容太远）；静止时仍落段首（看得到自己说了什么）。
         railScrollTo 内部会先脱离跟随，故在其后重新挂上。 */
      if (turnIndex === railTurnList.length - 1 && state !== undefined && state.running === true) {
        railStickyIndex = turnIndex;
        railStickyTarget = railScrollTo(scrollEl.scrollHeight, railLayout.y[turnIndex], true);
        updateRailActive();
        followRailActive(true);
        return;
      }
      const delta = el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top;
      /* 0.0.127：粘滞目标 = 钳制后的实际落点（触底时 ≠ 段顶，高亮仍钉在点击节点上）。 */
      railStickyIndex = turnIndex;
      railStickyTarget = railScrollTo(scrollEl.scrollTop + delta, railLayout.y[turnIndex]);
      updateRailActive();
      /* 0.0.124（G52）：跳转后把目标节点带进轨道视口（强制，忽略手动暂停）。 */
      followRailActive(true);
    }
    /* G41 v1.2：动画中用户输入（滚轮/触摸/按下）→ 立即取消动画、交还控制。 */
    for (const railCancelType of ['wheel', 'touchstart', 'mousedown']) {
      elements.scroll.addEventListener(railCancelType, () => {
        /* 0.1.12：原生平滑滚动由浏览器自身响应输入而停；这里只收尾状态（清旗标 + 收尾刷新）。 */
        if (railNativeAnim === true) { railNativeAnim = false; if (railNativeThumbFrame !== undefined) { cancelAnimationFrame(railNativeThumbFrame); railNativeThumbFrame = undefined; } programmaticScroll = false; railFollowAfterAnim = false; syncRailIndicator(); return; }
        if (railAnimFrame === undefined) return;
        cancelRailAnim();
        programmaticScroll = false;
        /* 0.0.141：打断滑行后立即按实际滚动位置重排滑块（否则停在半途的滑行值会残留）。 */
        syncRailIndicator();
      }, { passive: true });
    }
    function buildTurnRail(turns, nodeTurns) {
      const clip = elements.turnRailClip;
      if (clip === null || clip === undefined) return;
      for (const stale of [...clip.querySelectorAll('.turn-rail-node')]) stale.remove();
      /* 0.1.120：节点重建 = 悬停对象已移除，收起悬停提示（防悬停文案指向旧节点）。
         0.1.122：重建同时取消列滚动补间（内容高度可能已变，旧目标失效）。 */
      hideRailTip();
      railTweenCancel();
      const sessionId = railListSessionId;
      railNodesBuilt = nodeTurns.map(turnIndex => {
        const el = node('div', 'turn-rail-node');
        el.setAttribute('role', 'button');
        /* 0.1.114（G55 轨道序号）：编号 = 可见节点序「N/M」（现状 turnIndex+1 的显式化；"轮"字废弃——
           段模式下节点与官方轮不是一套口径）。0.1.122：前缀文案随「编号文案档位」；aria 恒用完整措辞。
           0.1.120：提示文案挂 data-tip（自绘快提示读取；原生 title 弃用——延迟约 1s）。 */
        el.setAttribute('aria-label', '第 ' + String(turnIndex + 1) + '/' + String(turns.length) + ' 个节点');
        const turn = turns[turnIndex];
        el.dataset.tip = railOrdinalText(turnIndex + 1, turns.length) + ' · ' + railSnippetOf(turn === undefined ? '' : turn.text);
        el.addEventListener('click', () => {
          /* 0.0.133：整列拖拽后的尾随 click 不得触发跳转（消费一次）。 */
          if (railDragSuppressClick) { railDragSuppressClick = false; return; }
          railJump(turn, sessionId);
        });
        /* 0.0.148（G53）：右键=收藏/标注菜单（点击仍是跳转）；0.0.151 停点改由节点本体
           换形换色（紫色圆角菱形，无附加元素）。 */
        el.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          event.stopPropagation();
          openRailNodeMenu(turnIndex, event.clientX, event.clientY);
        });
        /* 0.0.128：节点在轨道内容坐标里绝对定位（top 由 layoutTurnRail 按比例间距写入）。 */
        clip.append(el);
        return { el, turnIndex };
      });
      railActiveNode = -1;
      const navigationIndex = railNavigationLocked ? turns.findIndex(turn => turn.id === railNavigationId) : -1;
      railStickyIndex = navigationIndex >= 0 ? navigationIndex : undefined;
      applyRailPositions();
    }
    /* G49 v2（0.0.121）：轮 → DOM 元素。turnOutline 模式按 seq（取首个 seq ≥ 该轮起点 seq 的节点）；
       回落模式按 user 消息 id。未加载的轮返回 undefined（跳转前先穿透加载）。 */
    /* 0.0.135：已加载窗口的第一个 seq——DOM 里首个带 [data-seq] 的元素（DOM 有序）。
       用于：① 段模式补前缀（seq < 它的轮未加载）；② railElementFor 的"落在未加载窗口"判定。 */
    function firstLoadedSeq() {
      const el = elements.messages.querySelector('[data-seq]');
      if (el === null || el === undefined) return undefined;
      const seq = Number(el.getAttribute('data-seq'));
      return Number.isFinite(seq) ? seq : undefined;
    }
    /* 0.0.136：该轮是否"未加载"（前缀节点）——有 seq 但在已加载窗口之前，按定义拿不到元素。
       这类节点不得推进滚动坐标映射（见 layoutTurnRail 的前缀锚点处理）。 */
    function turnIsPending(turn) {
      if (turn === undefined || turn.element !== undefined) return false;
      if (turn.pending === true) return true;
      if (typeof turn.seq !== 'number') return false;
      const floor = firstLoadedSeq();
      return floor === undefined || turn.seq < floor;
    }
    /* 0.0.139：轨道只读调试快照（探针/诊断用；只挂函数，不累积数据——0.1.20 清掉了每帧
       push 的 __g15dbg 数组，那种写法会随渲染无界增长）。
       只看不改——"节点 = 哪个元素、偏移/间距/锚点各是多少"一次看全，专治错位类疑难。 */
    window.__raildbg = () => {
      const elementOf = (turn) => {
        const el = railTurnEls.get(turn.id);
        if (el === undefined) return null;
        const data = el.dataset === undefined ? {} : el.dataset;
        const prev = el.previousElementSibling;
        return {
          mid: data.mid, seq: data.seq, cls: String(el.className).slice(0, 30),
          /* 诊断用：前一个兄弟的形态（停点节点锚定失败时据此定位真机 DOM 差异）。 */
          prevCls: prev === null || prev === undefined ? null : String(prev.className).slice(0, 30),
          prevHasRecord: prev !== null && prev !== undefined && prev.querySelector !== undefined ? prev.querySelector('.ask-record, .decision-card') !== null : false,
        };
      };
      return {
        turns: railTurnList.map((turn, index) => ({
          index, id: turn.id, seq: turn.seq, endSeq: turn.endSeq,
          text: String(turn.text || '').replace(/\\s+/g, ' ').slice(0, 22),
          el: elementOf(turn),
        })),
        /* 0.0.148：G53 收藏/停点诊断——每节点的归一化键、推导 seq、停点判定与收藏态。 */
        marks: railNodesBuilt.map((entry, i) => {
          const turn = railTurnList[entry.turnIndex];
          const hit = railMarkQuery(entry.turnIndex);
          return {
            i, key: railMarkKeyOf(entry.turnIndex), seq: railTurnSeqOf(turn),
            hadElement: turn !== undefined && turn.element !== undefined,
            stop: entry.el.classList.contains('stop'),
            marked: hit !== undefined, markedKey: hit === undefined ? null : hit.key, note: hit === undefined ? null : hit.note,
          };
        }),
        stops: array(state && state.segmentStops).filter(v => typeof v === 'number'),
        marksRaw: typeof renderedSessionId === 'string' && renderedSessionId !== '' ? Object.fromEntries(viewMemoOf(renderedSessionId).marks) : {},
        tops: railTops.slice(),
        offsets: railLayout.offsets.slice(),
        heights: railLayout.heights.slice(),
        y: railLayout.y.slice(),
        anchors: railAxisNow().anchors,
        active: railActiveNode,
        navigation: { locked: railNavigationLocked, id: railNavigationId, seq: railNavigationSeq },
        viewport: { reveal: railRevealPending, manual: renderedSessionId ? viewMemoOf(renderedSessionId).railViewportManual : undefined, ownTop: railSelfScrollTop, clipTop: elements.turnRailClip.scrollTop, manualUntil: railManualUntil - Date.now() },
        restore: restoreCtx ? { kind: restoreCtx.kind, seq: restoreCtx.anchorSeq } : null,
        sticky: railStickyIndex,
        firstLoadedSeq: firstLoadedSeq(),
        /* 0.1.122：节点列滚动补间状态（诊断：目标/在途/帧数/最后帧时刻；探针 N15 读数用）。 */
        tween: { target: railTweenTarget, active: railTweenActive, running: railTweenFrame !== undefined, steps: railTweenSteps, at: Math.round(railTweenLast) },
        /* 0.1.123：脉冲挂起态 + 尝试日志（诊断：非空=等待轨道为该会话重建后补发）。 */
        pulse: { mid: railPulsePendingMid, session: railPulsePendingSession, log: railPulseLog.slice() },
      };
    };
    function railElementFor(turn) {
      if (turn === undefined) return undefined;
      /* 0.0.125：段模式节点自带元素引用（同源，无需按 seq/mid 反查）。 */
      if (turn.element !== undefined) return turn.element;
      if (typeof turn.seq === 'number') {
        /* 0.0.135：若该轮起点早于已加载窗口（尾部加载场景），不得用"首个 seq≥目标"误配到窗口首元素
           ——返回 undefined 走穿透加载（此前只有"窗口在前、目标在后"的会话才正确）。
           0.0.137（用户实测③：回包后点首节点仍无反应）：turn/start 的 seq 本身不渲染元素，
           窗口首元素（通常 = 该轮 user 消息之后的下一个 seq）会把**已加载**的轮误判成未加载 →
           跳转永远静默失败。有 endSeq（上一轮结束界/下一轮起点）时按整轮区间判定。 */
        const loaded = firstLoadedSeq();
        if (turn.assumeLoaded !== true && loaded !== undefined) {
          const unloaded = typeof turn.endSeq === 'number' ? loaded >= turn.endSeq : turn.seq < loaded;
          if (unloaded) return undefined;
        }
        for (const el of elements.messages.querySelectorAll('[data-seq]')) {
          const seq = Number(el.getAttribute('data-seq'));
          if (Number.isFinite(seq) && seq >= turn.seq) return el;
        }
        return undefined;
      }
      return railEls.get(turn.id);
    }
    function refreshRailOffsets() {
      railEls = new Map();
      railTurnEls = new Map();
      for (const el of elements.messages.querySelectorAll('.message.user[data-mid]')) {
        const mid = el.getAttribute('data-mid');
        if (typeof mid !== 'string' || mid === '') continue;
        railEls.set(mid, el);
      }
      const scrollRect = elements.scroll.getBoundingClientRect();
      const scrollTop = elements.scroll.scrollTop;
      railTops = railTurnList.map(turn => {
        /* 0.0.136/137：段首元素被工作段折叠（hidden）→ 几何恒为 0、锚点被算成"视口顶"附近的
           垃圾值（实测：reload 后首个前导段的锚点被钳到 maxScroll，滑块/高亮整段失真）。用折叠条代位。 */
        const el = effectiveRailElement(railElementFor(turn));
        if (el === undefined) return undefined;
        railTurnEls.set(turn.id, el);
        return (el.getBoundingClientRect().top - scrollRect.top) + scrollTop;
      });
    }
    function scheduleRailMeasure() {
      if (railDragFrozenNow()) return;
      /* 0.1.30：轨道处于"隐藏"态（单轮 / 视口过矮 / 曾量到零宽——侧栏折叠会让几何缓存变 0）
         也要能**自愈**：几何或轮数变回来时重建。否则折叠侧栏再展开后轨道一直不回，
         要等下一次状态更新才复活（真机实测：展开后轨道空着）。 */
      if (railNodesBuilt.length === 0) {
        if (state !== undefined && state !== null) {
          clearTimeout(railMeasureTimer);
          railMeasureTimer = setTimeout(() => { try { updateTurnRail(state) } catch { /* 自愈失败不抛 */ } }, 250);
        }
        return;
      }
      clearTimeout(railMeasureTimer);
      railMeasureTimer = setTimeout(() => {
        refreshRailOffsets();
        /* 0.0.128：流式期间冻结重排（节点不随生成漂移）；空闲时的内容变化（历史/折叠/结算）照常重排。 */
        const running = state !== undefined && state !== null && state.running === true;
        if (running) railLayoutFrozen = true;
        else layoutTurnRail();
        updateRailActive();
      }, 250);
    }
    function updateRailActive() {
      if (railNodesBuilt.length === 0 || railDragFrozenNow()) return;   /* 0.1.30：拖动中高亮不动 */
      const scrollEl = elements.scroll;
      /* 0.0.131：与滑块同源——游标改为滚动坐标（段首钳制到最大滚动）。
         0.0.134：尾部同样做重标定——否则触底后微滚 1px，高亮从末节点瞬跳回倒数第三个
         （实测：scrollTop=max−1 时 active 11→9）。改为在尾段内按比例推进。 */
      const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
      const cursor = Math.max(0, Math.min(maxScroll, scrollEl.scrollTop));
      const axis = railAxisNow();
      const tail = railTailAxis(axis);
      let active = 0;
      if (tail !== undefined && cursor >= tail.pStart) {
        const fr = tail.span > 0 ? (cursor - tail.pStart) / tail.span : 1;
        const base = tail.from - 1;
        active = Math.min(railTurnList.length - 1, base + Math.floor(fr * (railTurnList.length - base)));
      } else {
        for (let i = 0; i < axis.anchors.length; i += 1) {
          if (axis.anchors[i] <= cursor) active = i;
          else break;
        }
      }
      /* 0.0.127：粘滞期内高亮钉在点击的节点上（程序化滚动期间 + 落点未动时）；用户滚离即释放回几何判定。 */
      const sticky = railStickyIndex !== undefined && (programmaticScroll || Math.abs(scrollEl.scrollTop - railStickyTarget) <= 4);
      /* 0.0.128：触底「高亮最后一段」兜底退役——高亮与自绘滑块同源（都取 scrollTop+48 处的段），
         否则滚到最底时滑块顶端（视口起点所在段）与高亮（末段）会不一致；点末段的锁定由粘滞负责。 */
      if (sticky) active = railStickyIndex;
      else railStickyIndex = undefined;
      /* 0.1.128（探针现场：合并材料化期几何锚点簇拥 ⇒ active 25→24→17 的"扫地"）：**历史合并窗口期间**
         活动节点改由**锚点身份**推导——按重锚持续更新的 anchorSeq 做区间查询（锚点元素 = 视口顶那条，
         与用户滚动同步重锚）；材料化落定、窗口关闭后无缝交回几何推导。 */
      if (restoreCtx !== undefined && restoreCtx.kind === 'history-merge' && restoreCtx.userTouched !== true
        && typeof restoreCtx.anchorSeq === 'number') {
        let pinned = 0;
        for (let i = 0; i < railTurnList.length; i += 1) {
          const entry = railTurnList[i];
          const seq = entry === undefined ? undefined : entry.seq;
          if (typeof seq !== 'number') continue;
          if (seq <= restoreCtx.anchorSeq) pinned = i;
          else break;
        }
        active = pinned;
      }
      let nodeIndex = 0;
      for (let i = 0; i < railNodesBuilt.length; i += 1) {
        if (railNodesBuilt[i].turnIndex <= active) nodeIndex = i;
        else break;
      }
      /* 0.0.128：滑块位置每次都刷（不随高亮去重返回——滚动中高亮常不变）。 */
      syncRailIndicator();
      if (nodeIndex === railActiveNode) return;
      railActiveNode = nodeIndex;
      for (let i = 0; i < railNodesBuilt.length; i += 1) {
        railNodesBuilt[i].el.classList.toggle('active', i === nodeIndex);
      }
      /* 0.1.127（用户复测"提前量不稳定/偶发早滚"）：**内容滚动不再走节点级跟随**——高亮切换时按
         "节点贴 24px 边才补滚"是节点级、事后的（与滑块隔着一个 gap，gap 大时偶发早滚/大跳）；
         改由 syncRailIndicator 的「跟随滑块 + 48px 带」逐事件平滑驱动。显式动作（点节点跳转等）
         仍走 followRailActive(true)。 */
    }
    /* 0.1.12：诊断长帧采样（默认关，零常态开销）——「调试日志」开关打开时逐帧量 rAF 间隔，
       每 10s 汇总一条上报（扩展写 globalStorage/perf-log.jsonl，真机取数用）；
       跳转窗口（rAF/原生）单独分组，供"运行中跳转 vs 运行中不跳转"对照。 */
    let perfSampling = false;
    let perfFrames = [];
    let perfLastNow = 0;
    let perfSince = 0;
    function perfStep(now) {
      if (!perfSampling) return;
      if (perfLastNow !== 0) perfFrames.push({ dt: Math.round((now - perfLastNow) * 10) / 10, jump: railAnimFrame !== undefined || railNativeAnim === true });
      perfLastNow = now;
      if (now - perfSince >= 10_000) { perfReport(); perfSince = now; }
      requestAnimationFrame(perfStep);
    }
    function perfReport() {
      const stat = (list) => {
        if (list.length === 0) return null;
        const d = list.map(item => item.dt).sort((a, b) => a - b);
        return {
          n: d.length,
          avg: Math.round((d.reduce((a, b) => a + b, 0) / d.length) * 10) / 10,
          p95: d[Math.floor(d.length * 0.95)],
          max: d[d.length - 1],
          long32: d.filter(x => x > 32).length,
          long50: d.filter(x => x > 50).length,
        };
      };
      const all = stat(perfFrames);
      if (all === null) return;
      const jump = stat(perfFrames.filter(item => item.jump));
      perfFrames = [];
      vscode.postMessage({
        type: 'perf-log',
        payload: {
          kind: 'frames', running: state !== undefined && state.running === true,
          nodes: elements.messages === undefined || elements.messages === null ? 0 : elements.messages.querySelectorAll('*').length,
          all, jump,
        },
      });
    }
    /* 0.1.31（P0 真机取证）：加载时间线 / 视图记忆事件 → perf-log（扩展写 globalStorage/perf-log.jsonl）。
       只在「调试日志」开关打开时发；事件都是低频里程碑，零常态开销。 */
    const webviewLoadAt = performance.now();
    function diagOn() {
      return state !== undefined && state !== null && state.uiSettings !== undefined && state.uiSettings.diagnostics === true;
    }
    /* 0.1.102：搜索走路**常开**真机取证（写 globalStorage/perf-log.jsonl，kind='search'）。
       为何常开：搜索落点属"时序敏感"类问题（恢复窗口回拉 / 填充与跳转竞争），headless 复现不出，
       必须让真机把"按键 → 目标 → 起跳 → 落地"讲清楚；量小（每次动作 1–2 行，走路才写）。 */
    function searchTrace(phase, fields) {
      try {
        vscode.postMessage({ type: 'perf-log', payload: Object.assign({ kind: 'search', phase, atMs: Math.round(performance.now()) }, fields || {}) });
      } catch { /* 证失败静默 */ }
    }
    function diagLoad(phase, fields) {
      if (!diagOn()) return;
      try {
        vscode.postMessage({
          type: 'perf-log',
          payload: Object.assign({ kind: 'load', phase, atMs: Math.round(performance.now() - webviewLoadAt) }, fields || {}),
        });
      } catch { /* 诊断失败静默 */ }
    }
    setInterval(() => {
      const on = state !== undefined && state.uiSettings !== undefined && state.uiSettings.diagnostics === true;
      if (on && !perfSampling) { perfSampling = true; perfFrames = []; perfLastNow = 0; perfSince = performance.now(); requestAnimationFrame(perfStep); }
      if (!on && perfSampling) { perfSampling = false; perfFrames = []; }
    }, 2000);
    /* 0.1.50（A）：内容变化后的轨道更新**推迟到本帧渲染之后**（rAF 内再 setTimeout(0)）——
       紧跟"刚写完 DOM"同步读几何会在同一任务里强制整篇布局（冷/热切实测 174~188ms 长任务）。
       推迟期间沿用旧轨道几何（点/滑块不动、不闪），下一帧末统一重排。 */
    let railUpdateFrame;
    let railUpdatePending;
    function scheduleRailUpdate(current) {
      railUpdatePending = current;
      if (railUpdateFrame !== undefined) return;
      railUpdateFrame = requestAnimationFrame(() => {
        railUpdateFrame = undefined;
        /* 再等一拍：本帧的布局/绘制完成后读数才是干净的（rAF 回调仍在本帧布局之前）。 */
        window.setTimeout(() => {
          const pending = railUpdatePending;
          railUpdatePending = undefined;
          const target = state !== undefined && state !== null ? state : pending;
          if (target === undefined || target === null) return;
          try { updateTurnRail(target); } catch { /* 自愈失败不抛 */ }
        }, 0);
      });
    }
    function railFirstPaintPending(current) {
      return Boolean(current && current.phase === 'ready' && current.hasMoreHistory === true
        && (!current.turnRailSettings || current.turnRailSettings.granularity !== 'turn')
        && current.turnRailSettings?.scrollbar !== 'native' && currentRailTable() === undefined);
    }
    function syncRailFirstPaint(current) {
      const preparing = railFirstPaintPending(current);
      const rail = elements.turnRail, button = elements.turnRailPrepare;
      rail.classList.toggle('preparing', preparing);
      const failed = preparing && railPreparationFailedFor === current.sessionId;
      rail.setAttribute('aria-busy', String(preparing && !failed));
      button.disabled = !failed;
      button.textContent = failed ? '↻' : '…';
      button.title = failed ? '导航暂不可用，点击重试；正文仍可滚动' : '正在准备完整导航';
      button.setAttribute('aria-label', button.title);
      if (preparing) {
        // No geometry reads: body paints immediately, native scrolling remains
        // available, and no incomplete numbered node can receive a first click.
        rail.classList.remove('hidden');
        setScrollbarHidden(false);
        hideRailBadge(); hideRailTip(); railBadgeHovering = false;
        railTweenCancel();
        for (const stale of [...elements.turnRailClip.querySelectorAll('.turn-rail-node')]) stale.remove();
        railKey = ''; railListSessionId = ''; railTurnList = []; railNodesBuilt = [];
        railEls = new Map(); railTurnEls = new Map(); railTops = []; railActiveNode = -1;
        railGeomDirty = true;
      }
      return preparing;
    }
    elements.turnRailPrepare.addEventListener('click', () => {
      if (!railFirstPaintPending(state) || railPreparationFailedFor !== state.sessionId) return;
      railPreparationFailedFor = '';
      syncRailFirstPaint(state);
      vscode.postMessage({ type: 'rail-retry', sessionId: state.sessionId });
    });
    function updateTurnRail(current) {
      const railStarted = performance.now();
      const rail = elements.turnRail;
      if (rail === undefined || rail === null) return;
      /* 表可能先于首帧正文到达；未渲染该会话时不能按全是前缀的空 DOM 展示轨道。 */
      if (!current || renderedSessionId !== current.sessionId) { rail.classList.add('hidden'); return; }
      /* 空 loading 先保留表；正文到达再建节点，避免切换期间反复构建整条前缀轨道。 */
      if (current.phase === 'loading' && array(current.messages).length === 0) { rail.classList.add('hidden'); return; }
      if (syncRailFirstPaint(current)) return;
      rail.classList.toggle('restoring', railRevealPending);
      const cfg = (current && current.turnRailSettings) || {};
      /* 0.0.151（用户建议③）：节点颜色设置——自定义色写 CSS 变量，'theme' 移除变量回默认。 */
      const railColorVar = (name, value) => {
        if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) rail.style.setProperty(name, value);
        else rail.style.removeProperty(name);
      };
      railColorVar('--rail-mark-color', cfg.markColor);
      railColorVar('--rail-stop-color', cfg.stopColor);
      /* 0.1.114（G55）：徽标开关关即隐（设置台即时生效）；轨道隐藏/原生两路各自再收尾（防悬空）。
         0.1.120：同处复位悬停标记——否则"悬停中被隐藏/关开关"会留陈旧悬停态 ⇒ 徽标不再按 1s 淡出。 */
      if (cfg.nodeBadge === false) { hideRailBadge(); railBadgeHovering = false; }
      /* 0.1.122（G55）：提示两行档即时生效（高度由显示时测量）。 */
      if (elements.railTip !== undefined && elements.railTip !== null) elements.railTip.classList.toggle('two-line', cfg.tipTwoLine === true);
      /* 0.0.128：滚动条方式互斥——native 模式下整套轨道（节点+滑块）隐藏，只留系统滚动条；
         custom 模式隐藏 #scroll 原生滚动条，轨道接管（滑块=滚动条）。 */
      const nativeMode = cfg.scrollbar === 'native';
      /* 0.1.50（B）：类名只在真变化时切——每次 render 无条件 toggle 会让样式失效，
         紧随其后的 clientHeight 读取就**强制整篇布局**（真机 6.4 万节点实测 200ms）。 */
      setScrollbarHidden(!nativeMode);
      if (nativeMode) {
        rail.classList.add('hidden');
        hideRailBadge();
        hideRailTip();
        railBadgeHovering = false;
        railTweenCancel();
        railKey = ''; railListSessionId = ''; railTurnList = []; railNodesBuilt = []; railEls = new Map(); railTurnEls = new Map(); railTops = []; railActiveNode = -1;
        railStickyIndex = undefined;
        railLayoutSign = '';
        railLayout = { y: [], offsets: [], heights: [], tail: RAIL_TAIL, contentH: 0 };
        return;
      }
      const turns = railTurnsOf(current);
      let navigationRebound = false;
      if (railNavigationLocked) {
        const target = resolveRailTurn({ id: railNavigationId, seq: railNavigationSeq }, turns);
        if (target) {
          navigationRebound = railNavigationId !== target.id || railNavigationSeq !== target.seq;
          railNavigationId = target.id; railNavigationSeq = target.seq;
          if (navigationRebound && restoreCtx && restoreCtx.navigation === true) restoreCtx.anchorSeq = target.seq;
        }
      }
      if (railNavigationLocked && pendingRailJumpSeq === undefined && !turns.some(turn => turn.id === railNavigationId)) {
        railNavigationLocked = false; railNavigationSeq = undefined; railNavigationId = undefined;
        if (restoreCtx && restoreCtx.kind === 'history-merge') clearRestoreCtx();
      }
      /* 0.1.21（流式卡顿）：运行中几何刷新降频到 250ms——每帧读 clientHeight/节点 rect
         会在"刚写完 DOM"后触发全量同步布局（真机实测单次 133ms，占流式帧开销大头）；
         流式期轨道布局本就冻结（railLayoutFrozen），按帧重测零收益。用户滚动时另有
         scroll 处理器即时刷高亮，不受此处降频影响。 */
      const runningNow = current.running === true;
      const nowMs = performance.now();
      /* 0.1.50（B）：脏标记驱动——换会话/换状态都会重跑本函数，"空闲态每帧必量 clientHeight"
         会在刚重建 DOM 的帧里强制整篇布局；改为尺寸真变（resize 观察者置脏）/从无到有/兜底 2s 才量。 */
      const needsGeom = railClientHeight === 0 || railGeomDirty || nowMs - railGeomAt > 2000;
      if (needsGeom) {
        railGeomAt = nowMs;
        railGeomDirty = false;
        railClientHeight = elements.scroll.clientHeight;
      }
      const available = railClientHeight - 24;
      if (turns.length <= 1 || available < 40) {
        rail.classList.add('hidden');
        /* 0.0.157（用户实测"只有一轮"）：轨道隐藏时**把原生滚动条还给系统**——custom 模式下
           原生滚动条由轨道接管（滑块=滚动条），轨道一藏（单轮/空会话/视口过矮）就会两者皆无，
           单轮长对话彻底没有滚动指示。还原仅 1px 内边距差（14→15px），代价可忽略。 */
        setScrollbarHidden(false);   /* 0.1.50（B）：走统一入口，缓存与类同步 */
        hideRailBadge();
        hideRailTip();
        railBadgeHovering = false;
        railTweenCancel();
        railKey = ''; railListSessionId = ''; railTurnList = []; railNodesBuilt = []; railEls = new Map(); railTurnEls = new Map(); railTops = []; railActiveNode = -1;
        railStickyIndex = undefined;
        railLayoutSign = '';
        railLayout = { y: [], offsets: [], heights: [], tail: RAIL_TAIL, contentH: 0 };
        return;
      }
      const railBuildStarted = performance.now();
      /* 0.0.128（G54 落地）：节点绝对定位 + 比例间距（放得下铺满、放不下自滚）+ 自绘滑块——
         见 layoutTurnRail / syncRailIndicator / railMap*。全部轮出节点，无抽稀（0.0.124 起）。 */
      const nodeTurns = turns.map((_, index) => index);
      /* 0.1.122：key 计入「编号文案档位 / 摘要长度」——设置切换即时重建节点文案（标题/aria/提示）。 */
      const key = turns.map(turn => turn.id).join('|') + '~' + turns.map(turn => turn.text.length).join(',')
        + '@' + railNumberStyle() + '/' + String(railSummaryLen())
        /* 0.1.124（数据层根治）：表身份计入 key——全量表到达/换代即重建（不再等下一次几何刷新）。 */
        + '#' + railTableSessionId + ':' + String(railTableStamp);
      railTurnList = turns;
      railListSessionId = String(current === undefined || current === null ? '' : current.sessionId || '');
      if (key !== railKey) {
        railKey = key;
        buildTurnRail(turns, nodeTurns);
        /* 0.1.122：重建后立即补一遍收藏/标注/停点合成（否则新节点直到下一次几何刷新才带上 ★/✎/菱形）。 */
        applyRailMarks();
      }
      rail.classList.remove('hidden');
      const railBuildMs = performance.now() - railBuildStarted;
      if (performance.now() - railStarted > 30) diagLoad('rail-phases', { sessionId: current.sessionId, total: Math.round(performance.now() - railStarted), build: Math.round(railBuildMs), turns: turns.length });
      if (needsGeom) {
        refreshRailOffsets();
        /* 分页补偿改变正文坐标，即便节点 ID/视口签名未变也必须刷新映射。
           只更新 railTops、沿用旧 offsets 会让滑块先跳到别段，250ms 后再返回。 */
        if (restoreCtx !== undefined && restoreCtx.kind === 'history-merge') layoutTurnRail();
        else maybeLayoutTurnRail();
        /* updateRailActive 读 scrollHeight/clientHeight（同一次强制布局）；运行中降频，
           用户滚动时由 scroll 处理器即时补刷高亮。 */
        updateRailActive();
        /* 0.0.148（G53）：每次状态渲染重刷收藏/停点标记——设置开关或记忆变化即时生效；
           节点集未变时 buildTurnRail 不重跑（key 去重），这里是无重建刷新点。
           0.1.21：它只依赖记忆与设置、不随流式增长，故随几何一起降频。 */
        applyRailMarks();
      }
      /* 0.1.123（Phase 3）：跨会话编号片落点的脉冲**挂起补试**——落地块先于轨道重建时，
         在每次渲染到轨道处重试一次（见 pulseRailNodeForMessage 注释）。 */
      tryRailPulseNow();
      if (navigationRebound && pendingRailJumpSeq === undefined && railAnimFrame === undefined && railNativeAnim !== true) railMemoAfterJump();
    }
    /* 0.0.124（G52）：内容滚动 → 把当前轮节点带进轨道视口（上下各留 24px 余量）；
       手动滚轨道后 1.5s 内暂停跟随（防互相抢）。 */
    let railManualUntil = 0;
    /* 自写读回位置与行程：尾随 scroll 不受派发延迟影响，真实新位置立即接管。 */
    let railSelfScrollTop = -1;
    let railSelfScrollExtent = -1;
    function writeRailScroll(value) {
      const clip = elements.turnRailClip;
      if (!clip) return;
      clip.scrollTop = value;
      railSelfScrollTop = clip.scrollTop;
      railSelfScrollExtent = Math.max(0, clip.scrollHeight - clip.clientHeight);
    }
    function followRailActive(force) {
      if (railNavigationLocked) { syncRailIndicator(); return; }
      const clip = elements.turnRailClip;
      if (clip === null || clip === undefined || railNodesBuilt.length === 0) return;
      /* 2026-09-24（用户复测反馈①）：**视图配置重建期间不跟随**——重建的瞬态会把内容位置短暂钳到
         "懒建空壳的矮内容底缘"，跟随据此把轨道视窗一路滚到末节点；内容位置随后被恢复窗口回正，
         轨道却留在底部（真机症状：改设置关面板后整条轨道滚到"滑块最低处"）。
         窗口内不跟随 = 用户把轨道滚到哪就留在哪；高亮/滑块仍照常随内容刷新（只有视窗不动）。
         force=true（点节点跳转等显式动作）不受限；切会话（kind='switch'）也不受限——那时轨道该跟新会话。 */
      if (force !== true && restoreCtx !== undefined && restoreCtx.userTouched !== true && restoreCtx.kind === 'view-cfg-rebuild') return;
      if (force !== true && Date.now() < railManualUntil) return;
      const entry = railNodesBuilt[railActiveNode];
      if (entry === undefined) return;
      const node = entry.el;
      const margin = 24;
      const railRect = clip.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      let delta = 0;
      if (nodeRect.top < railRect.top + margin) delta = nodeRect.top - (railRect.top + margin);
      else if (nodeRect.bottom > railRect.bottom - margin) delta = nodeRect.bottom - (railRect.bottom - margin);
      if (Math.abs(delta) < 1) return;
      /* 0.1.122：跟随改指数平滑（时长入设置；0=瞬时）——基线取当前目标，逐次滚动事件自然累加。 */
      railTweenTo((railTweenTarget !== null ? railTweenTarget : clip.scrollTop) + delta);
    }
    if (elements.turnRailClip !== null && elements.turnRailClip !== undefined) {
      elements.turnRailClip.addEventListener('scroll', () => {
        rememberRailViewport();
        if (renderedSessionId) scheduleViewStatePersist(renderedSessionId, 'rail-viewport');
        /* 先核对实际自写位置；浏览器因行程变短钳到边界也不是手动滚列。
           固定时间窗会吞真实输入，又会漏掉迟到回声，故不再按时间猜测。 */
        const ownPosition = Math.abs(elements.turnRailClip.scrollTop - railSelfScrollTop) < 1;
        const clip = elements.turnRailClip;
        const extent = Math.max(0, clip.scrollHeight - clip.clientHeight);
        const geometryClamp = railSelfScrollExtent >= 0 && extent !== railSelfScrollExtent
          && (clip.scrollTop <= 0.5 || clip.scrollTop >= extent - 0.5);
        railSelfScrollExtent = extent;
        if (ownPosition || geometryClamp) { railSelfScrollTop = clip.scrollTop; return; }
        railTweenCancel();
        railRevealPending = false;
        railManualUntil = Date.now() + 1500;
        if (renderedSessionId) viewMemoOf(renderedSessionId).railViewportManual = true;
        rememberRailViewport();
      }, { passive: true });
    }
    /* 0.0.133（用户：滑块可宽一点/加边缘触发空间）：**整列拖拽**——在节点或滑块上按下后，
       位移 >4px 即进入拖拽（滑块=逆映射连续滚动）；未位移松手仍按点击（节点=跳转）。
       层级不再承担"谁被点中"的职责（滑块在节点之下，药丸浮于轨道之上）。 */
    const RAIL_DRAG_THRESHOLD = 4;
    /* 0.0.142（用户需求）：边缘拖拽自动滚列——指针进入轨道上下缘的"触发带宽"内，列持续滚动。
       0.0.144②：带宽与最大速度入设置（turnRail.dragEdgePx / dragSpeed），默认 64px / 800px/秒。 */
    let railPressCandidate = null;      /* { y, grab }：已按下、待判定 */
    let railDragging = false;           /* 已越过阈值 */
    let railDragSuppressClick = false;  /* 拖拽后的 click 抑制（节点 click 消费一次后清） */
    let railEdgeDir = 0;                /* -1 上缘 / +1 下缘 / 0 不在带内 */
    let railEdgeFrame;                  /* 边缘自动滚列的 rAF 句柄 */
    let railDragLastY = 0;              /* 最近一次指针 y（自动滚列 tick 用同一位置重算内容） */
    if (elements.turnRail !== null && elements.turnRail !== undefined) {
      elements.turnRail.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        const target = event.target;
        const cls = target !== null && target !== undefined ? target.classList : undefined;
        if (cls === undefined || cls === null) return;
        if (!cls.contains('turn-rail-node') && !cls.contains('turn-rail-thumb')) return;
        const thumb = elements.turnRailThumb;
        const rect = thumb !== null && thumb !== undefined ? thumb.getBoundingClientRect() : undefined;
        railPressCandidate = { y: event.clientY, grab: rect === undefined ? 0 : event.clientY - rect.top };
        event.preventDefault();
      });
    }
    function stopRailEdgeScroll() {
      railEdgeDir = 0;
      if (railEdgeFrame !== undefined) { cancelAnimationFrame(railEdgeFrame); railEdgeFrame = undefined; }
    }
    /* 0.0.142：指针停在边缘带内 → 列按深入深度加速滚动；列动了就用**同一指针位置**重算内容
       （经典边缘自动滚动）——多节点时单次拖拽即可跨越整个轨道，无需中途滚轮接力。
       0.0.144②：带宽/最大速度取设置；速度按深度线性加速（px/秒）× 实际帧间隔——帧率无关，
       带宽内浅处很慢（不易滑过头），越深越快。 */
    function startRailEdgeScroll() {
      if (railEdgeFrame !== undefined) return;
      railTweenCancel();   /* 0.1.122：边缘自动滚列逐帧直写 clip.scrollTop——先停补间。 */
      let lastTick = 0;
      const tick = (now) => {
        railEdgeFrame = undefined;
        const clip = elements.turnRailClip;
        if (!railDragging || railEdgeDir === 0 || clip === null || clip === undefined || railThumbDrag === null || railThumbDrag === undefined) return;
        const rect = clip.getBoundingClientRect();
        const zone = railDragEdgePx();
        const depth = railEdgeDir < 0
          ? (rect.top + zone) - railDragLastY
          : railDragLastY - (rect.bottom - zone);
        const dt = lastTick === 0 ? 16 : Math.max(1, Math.min(50, now - lastTick));
        lastTick = now;
        const speed = railDragSpeed() * Math.max(0, Math.min(1, depth / Math.max(1, zone)));
        const step = Math.max(1, Math.round(speed * dt / 1000));
        const before = clip.scrollTop;
        writeRailScroll(clip.scrollTop + railEdgeDir * step);
        railManualUntil = Date.now() + 1500;
        if (clip.scrollTop !== before) {
          const content = railMapR2C((railDragLastY - rect.top) + clip.scrollTop - railThumbDrag.grab);
          const scrollEl = elements.scroll;
          const max = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
          scrollEl.scrollTop = Math.max(0, Math.min(max, content));
        }
        if (railDragging && railEdgeDir !== 0) railEdgeFrame = requestAnimationFrame(tick);
      };
      railEdgeFrame = requestAnimationFrame(tick);
    }
    function endRailThumbDrag() {
      railPressCandidate = null;
      if (railDragging) railDragSuppressClick = true;
      railDragging = false;
      stopRailEdgeScroll();
      if (railThumbDrag === null || railThumbDrag === undefined) return;
      railThumbDrag = null;
      if (elements.turnRailThumb !== null && elements.turnRailThumb !== undefined) elements.turnRailThumb.classList.remove('dragging');
    }
    window.addEventListener('mousemove', (event) => {
      if (railPressCandidate === null || railPressCandidate === undefined) return;
      /* 0.0.130：在窗口外松手收不到 mouseup → 以按键状态兜底结束拖拽（否则再次移入会"跳一下"）。 */
      if ((event.buttons & 1) === 0) { endRailThumbDrag(); return; }
      if (!railDragging) {
        if (Math.abs(event.clientY - railPressCandidate.y) < RAIL_DRAG_THRESHOLD) return;
        railDragging = true;
        if (restoreThroughTarget) vscode.postMessage({ type: 'cancel-history-navigation' });
        railNavigationLocked = false; railNavigationSeq = undefined; clearRestoreThroughTarget();
        railThumbDrag = { grab: railPressCandidate.grab };
        railTweenCancel();   /* 0.1.122：拖拽接管——先停补间，避免与直接写 scrollTop 打架。 */
        if (elements.turnRailThumb !== null && elements.turnRailThumb !== undefined) elements.turnRailThumb.classList.add('dragging');
      }
      const clip = elements.turnRailClip;
      if (clip === null || clip === undefined) return;
      /* 布局未就绪（重建窗口期）→ 不猜位置，避免拖拽把内容甩到顶端。 */
      if (railLayout.y.length < railTurnList.length) return;
      const rect = clip.getBoundingClientRect();
      const yInRail = (event.clientY - rect.top) + clip.scrollTop;
      const content = railMapR2C(yInRail - railThumbDrag.grab);
      const scrollEl = elements.scroll;
      const max = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
      scrollEl.scrollTop = Math.max(0, Math.min(max, content));
      railManualUntil = Date.now() + 1500;
      /* 0.0.142：边缘带判定——在带内启自动滚列，回到带内区域即停。
         0.0.144②：带宽取设置（默认 64px，比旧 24px 更早开始，不容易拖过头）。 */
      railDragLastY = event.clientY;
      const edgeZone = railDragEdgePx();
      railEdgeDir = event.clientY <= rect.top + edgeZone ? -1 : (event.clientY >= rect.bottom - edgeZone ? 1 : 0);
      if (railEdgeDir !== 0) startRailEdgeScroll();
      else stopRailEdgeScroll();
    });
    window.addEventListener('mouseup', endRailThumbDrag);
    /* 0.0.136（用户实测"reload 后首个节点点不动"）：抑制标志必须自愈——拖拽滑块后松手，尾随的
       click 若落在滑块/空白（**没有**节点 click 处理器来消费该标志），标志就一直挂着，把用户
       "下一次点击节点"整个吞掉（表现为节点点不动，再点一次才行）。冒泡期 window 监听：节点
       处理器先跑（真跳转的那次已被正确抑制），其余任何 click 都会把标志清掉。 */
    window.addEventListener('click', () => { railDragSuppressClick = false; });
    /* 0.0.133：滚轮改挂**轨道容器**（原挂最右滚条带——药丸/滑块之下的带子收不到事件，
       实测"指针在节点上滚不动节点列"）。仅轨道可滚时拦截，否则放行给内容。 */
    if (elements.turnRail !== null && elements.turnRail !== undefined) {
      elements.turnRail.addEventListener('wheel', (event) => {
        railNavigationLocked = false; railNavigationSeq = undefined;
        if (renderedSessionId) viewMemoOf(renderedSessionId).railViewportManual = true;
        const clip = elements.turnRailClip;
        if (clip === null || clip === undefined) return;
        /* 0.0.135：轨道不可滚（节点未满）或已到顶仍向上滚 → 交给"滚到顶自动加载更早消息"。
           此前这里直接 return，事件也不会冒泡到聊天区（轨道与 #scroll 是兄弟）→ 指针停在
           右侧轨道上往上滚毫无反应（用户实测）。 */
        const railAtTop = clip.scrollTop <= 0;
        if (clip.scrollHeight <= clip.clientHeight + 1 || (event.deltaY < 0 && railAtTop)) {
          if (event.deltaY < 0) {
            /* 0.0.136：同聊天区 wheel——明确用户意图，解除校正窗口的 userTouched 守卫。 */
            if (restoreCtx && restoreCtx.kind !== 'history-merge') restoreCtx.userTouched = true;
            maybeAutoLoadHistory(true);
          }
          return;
        }
        event.preventDefault();
        /* 0.1.122：改指数平滑滚列（时长入设置；0=瞬时）。基线取当前目标（连续滚轮事件自然累加）。 */
        railTweenTo((railTweenTarget !== null ? railTweenTarget : clip.scrollTop) + event.deltaY);
        railManualUntil = Date.now() + 1500;
        /* 0.1.114（G55）：滚节点列 → 徽标贴指针，显示指针附近节点的编号。
           0.1.120：滚列期间收起悬停提示并静默 600ms（防节点滑到指针下的伪悬停）。 */
        hideRailTip();
        muteRailTip(Date.now() + 600);
        showRailBadge('pointer', event.clientY);
      }, { passive: false });
    }
    /* 0.1.120（G55 复测反馈①）：悬停轨道 → 徽标浮出（就近节点，贴指针）；悬停节点 → 快提示（互斥，避免叠位）。
       注：轨道容器 pointer-events:none，事件来自节点/滑块/右侧滚轮带（悬停其余空隙落到对话区，属既有几何）。 */
    if (elements.turnRail !== null && elements.turnRail !== undefined) {
      elements.turnRail.addEventListener('mousemove', (event) => {
        const target = event.target;
        const cls = target !== null && target !== undefined && target.classList !== undefined ? target.classList : undefined;
        const overNode = cls !== undefined && cls !== null && cls.contains('turn-rail-node') === true;
        railBadgeHovering = true;
        if (overNode) {
          hideRailBadge();
          scheduleRailTip(target);
        } else {
          hideRailTip();
          showRailBadge('pointer', event.clientY);
        }
      });
      elements.turnRail.addEventListener('mouseleave', () => {
        railBadgeHovering = false;
        hideRailTip();
        if (railBadgeTimer !== undefined) clearTimeout(railBadgeTimer);
        railBadgeTimer = setTimeout(() => {
          railBadgeTimer = undefined;
          const badge = elements.railBadge;
          if (badge !== undefined && badge !== null) badge.classList.remove('show');
        }, 900);
      });
    }
    elements.scroll.addEventListener('scroll', () => {
      /* 0.1.9（A 削帧）：跳转动画期间不做几何判定——高亮由粘滞钉在点击节点上，动画收尾统一刷新，
         避免动画的每帧 scroll 事件再触发一次强制同步布局。 */
      if (railAnimFrame === undefined && railNativeAnim !== true) {
        /* 0.1.127（用户需求）：内容滚动 = 跟随恢复——"手动滚列后 1.5s 不打扰"的暂停期不挡
           内容滚动驱动的跟随（手动把轨道停到边缘位后开始滚内容，也应平滑跟回带内）。 */
        railManualUntil = 0;
        updateRailActive();
      }
      /* 0.1.120：内容滚动即收起悬停提示 + 静默；徽标**只认用户意图滚动**（草稿栏长高等程序性滚动不浮出）。 */
      hideRailTip();
      muteRailTip(Date.now() + 600);
      if (railBadgeScrollIntent()) showRailBadge('thumb');
    }, { passive: true });

    /* G29: 只有 #scroll（视口）尺寸变化才重评估折叠——conversation 高度变化 = 内容变化，不触发 */
    const conversationResizeObserver = new ResizeObserver(entries => {
      // A background page may finish while this viewport has no geometry.
      // Consume its saved target only after reveal, before tail/resize updates.
      tryRestoreThroughReady();
      scheduleTailScroll(false);
      const widthChanged = entries.some(entry => entry.target === elements.scroll);
      /* 0.1.50（B）：尺寸变化 → 轨道几何缓存下次更新重测（取代"每帧/每 2s 必测"）。
         视口尺寸变化还要**触发一次完整轨道更新**（含隐藏判定）——只重排不做隐藏判定的话，
         面板被压到极矮时该隐藏却没隐藏（0.1.43 真机复现过）。 */
      railGeomDirty = true;
      if (state !== undefined && state !== null) {
        clearTimeout(railResizeTimer);
        railResizeTimer = setTimeout(() => { try { updateTurnRail(state) } catch { /* 自愈失败不抛 */ } }, 200);
      }
      if (widthChanged) {
        /* 0.1.26：先抓锚点再触发折叠重判/重排（顺序不能反——反了锚点已是位移后的）。 */
        beginResizeAnchor();
      }
      /* G39 v2：校正窗口内内容高度变化（历史/折叠/图片结算）→ 以锚点重校正位置。
         0.1.29：改**同步**回正——本回调运行在「布局之后、绘制之前」，rAF 要等下一帧，
         中间那一帧会画出"内容滑走"的画面（用户实测拖动时"跳动"）。此刻尚无待决失效
         （折叠重判在下面才发起、且其重测推迟到 rAF），同步读数不会额外触发整篇重排。
         0.1.28：同时**续期**——布局还在变就说明没稳定，窗口不能到期收摊（见 extendRestoreWindow）。 */
      if (restoreCtx && !restoreCtx.userTouched) { applyViewRestoreNow(); extendRestoreWindow(); }
      if (widthChanged) { markAllFoldsDirty(); refitAllFrameBadges(); }
      /* G41：内容高度变化（历史/折叠/结算）→ 去抖重测轮次偏移（流式期间不逐帧重测）。 */
      scheduleRailMeasure();
    });
    conversationResizeObserver.observe(elements.conversation);
    conversationResizeObserver.observe(elements.scroll);

    function node(tag, className, text) {
      const value = document.createElement(tag);
      if (className) value.className = className;
      if (text !== undefined) value.textContent = text;
      return value;
    }

    function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined; }
    function array(value) { return Array.isArray(value) ? value : []; }
    function string(value, fallback) { return typeof value === 'string' ? value : (fallback || ''); }
    function pretty(value) {
      if (typeof value === 'string') {
        try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
      }
      try { return JSON.stringify(value, null, 2); } catch { return String(value); }
    }
    function contentText(content) {
      return array(content).map(part => {
        const item = record(part);
        if (!item) return '';
        if (typeof item.text === 'string') return item.text;
        if (typeof item.content === 'string') return item.content;
        if (Array.isArray(item.content)) return contentText(item.content);
        return '';
      }).filter(Boolean).join('\\n');
    }
    function link(href, label) {
      const anchor = node('a', '', label || href);
      anchor.href = href;
      anchor.addEventListener('click', event => { event.preventDefault(); vscode.postMessage({ type: 'open-link', href }); });
      return anchor;
    }

    function fileReference(value) {
      const match = /^((?:[A-Za-z]:[\\\\/]|\\/)?(?:[A-Za-z0-9_@.+~-]+[\\\\/])*[A-Za-z0-9_@.+~-]+\\.[A-Za-z][A-Za-z0-9]{0,9})(?::(\\d+))?(?::\\d+)?$/.exec(value);
      if (!match) return undefined;
      return { path: match[1], ...(match[2] ? { line: Number(match[2]) } : {}) };
    }
    function fileButton(path, line, label, className) {
      const button = node('button', 'file-link' + (className ? ' ' + className : ''), label || path);
      button.type = 'button'; button.title = '打开 ' + path + (line ? ':' + String(line) : '');
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); vscode.postMessage({ type: 'open-file', path, ...(line ? { line } : {}) }); });
      return button;
    }
    function appendFileText(parent, text) {
      const pattern = /(?:[A-Za-z]:[\\\\/]|\\/)?(?:[A-Za-z0-9_@.+~-]+[\\\\/])*[A-Za-z0-9_@.+~-]+\\.[A-Za-z][A-Za-z0-9]{0,9}(?::\\d+)?(?::\\d+)?/g;
      let last = 0;
      for (const match of text.matchAll(pattern)) {
        const index = match.index || 0;
        const reference = fileReference(match[0]);
        if (!reference) continue;
        if (index > last) parent.append(document.createTextNode(text.slice(last, index)));
        parent.append(fileButton(reference.path, reference.line, match[0]));
        last = index + match[0].length;
      }
      if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
    }

    function appendInline(parent, text) {
      const pattern = /(\\*\\*[^*]+\\*\\*|\\*[^*]+\\*|\\[[^\\]]+\\]\\(https?:\\/\\/[^)\\s]+\\)|\\x60[^\\x60]+\\x60)/g;
      let last = 0;
      for (const match of text.matchAll(pattern)) {
        const index = match.index || 0;
        if (index > last) appendFileText(parent, text.slice(last, index));
        const token = match[0];
        if (token.startsWith('**')) { const strong = node('strong'); appendFileText(strong, token.slice(2, -2)); parent.append(strong); }
        else if (token.startsWith('*')) { const em = node('em'); appendFileText(em, token.slice(1, -1)); parent.append(em); }
        else if (token.charCodeAt(0) === 96) {
          const value = token.slice(1, -1); const reference = fileReference(value);
          parent.append(reference ? fileButton(reference.path, reference.line, value, 'code-link') : node('code', '', value));
        }
        else {
          const split = token.indexOf('](');
          parent.append(link(token.slice(split + 2, -1), token.slice(1, split)));
        }
        last = index + token.length;
      }
      if (last < text.length) appendFileText(parent, text.slice(last));
    }

    function splitTableRow(line) {
      return line.split('|').map(part => part.trim()).filter((part, i, parts) => !(i === 0 && part === '') && !(i === parts.length - 1 && part === ''));
    }
    function isTableSeparator(line) {
      const t = line.trim();
      return t.indexOf('|') >= 0 && t.indexOf('-') >= 0 && /^[|: \\-]+$/.test(t);
    }

    // G15: read lazily so the vendor script can never be missed by load order.
    function mdlib() { return (typeof window !== 'undefined' && window.__g15md) || undefined; }
    /* G15: math placeholder constants — declared at script top so any early
       render path never hits a TDZ (0.0.33-fix). */
    const MATH_PH_OPEN = '\\uE002'; const MATH_PH_CLOSE = '\\uE003';
    const mathPhRe = new RegExp(MATH_PH_OPEN + '([^' + MATH_PH_CLOSE + ']+)' + MATH_PH_CLOSE, 'g');
    /* G15: math placeholder constants — declared at script top so any early
       render path never hits a TDZ (0.0.33-fix). */
    /* G15 (0.0.30): legacy hand-written parser kept as the vendor-less fallback
       (the vitest DOM stubs run this path — window.__g15md is absent there). */
    function renderMarkdownLegacy(text) {
      const root = node('div', 'markdown');
      const lines = String(text || '').replace(/\\r/g, '').split('\\n');
      let index = 0;
      while (index < lines.length) {
        const lineValue = lines[index];
        if (!lineValue.trim()) { index += 1; continue; }
        if (lineValue.startsWith(String.fromCharCode(96).repeat(3))) {
          const language = lineValue.slice(3).trim();
          const body = [];
          index += 1;
          while (index < lines.length && !lines[index].startsWith(String.fromCharCode(96).repeat(3))) body.push(lines[index++]);
          if (index < lines.length) index += 1;
          const pre = node('pre');
          const code = node('code', language ? 'language-' + language : '', body.join('\\n'));
          pre.append(code); root.append(pre); continue;
        }
        if (lineValue.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
          const header = splitTableRow(lineValue);
          const wrap = node('div', 'table-wrap');
          const table = node('table');
          const thead = node('thead');
          const headRow = node('tr');
          for (const cell of header) { const th = node('th'); appendInline(th, cell); headRow.append(th); }
          thead.append(headRow); table.append(thead);
          index += 2;
          const tbody = node('tbody');
          while (index < lines.length && lines[index].trim().includes('|')) {
            const cells = splitTableRow(lines[index].trim());
            const tableRow = node('tr');
            for (let cellIndex = 0; cellIndex < header.length; cellIndex += 1) {
              const td = node('td'); appendInline(td, cellIndex < cells.length ? cells[cellIndex] : ''); tableRow.append(td);
            }
            tbody.append(tableRow); index += 1;
          }
          table.append(tbody); wrap.append(table); root.append(wrap); continue;
        }
        const heading = /^(#{1,3})\\s+(.+)$/.exec(lineValue);
        if (heading) { const h = node('h' + heading[1].length); appendInline(h, heading[2]); root.append(h); index += 1; continue; }
        if (/^>\\s?/.test(lineValue)) {
          const quote = node('blockquote'); appendInline(quote, lineValue.replace(/^>\\s?/, '')); root.append(quote); index += 1; continue;
        }
        if (/^[-*]\\s+/.test(lineValue) || /^\\d+\\.\\s+/.test(lineValue)) {
          const ordered = /^\\d+\\./.test(lineValue);
          const list = node(ordered ? 'ol' : 'ul');
          while (index < lines.length && (ordered ? /^\\d+\\.\\s+/.test(lines[index]) : /^[-*]\\s+/.test(lines[index]))) {
            const item = node('li'); appendInline(item, lines[index].replace(ordered ? /^\\d+\\.\\s+/ : /^[-*]\\s+/, '')); list.append(item); index += 1;
          }
          root.append(list); continue;
        }
        const paragraph = [];
        while (index < lines.length && lines[index].trim() && !lines[index].startsWith(String.fromCharCode(96).repeat(3)) && !/^(#{1,3})\\s+/.test(lines[index]) && !/^>\\s?/.test(lines[index]) && !/^[-*]\\s+/.test(lines[index]) && !/^\\d+\\.\\s+/.test(lines[index])) paragraph.push(lines[index++]);
        const p = node('p'); appendInline(p, paragraph.join('\\n')); root.append(p);
      }
      /* G27 round2 (0.0.42): legacy 表格同样冻结列宽（渲染完成帧） */
      return root;
    }

    /* ---- G27 (0.0.40): 复制按钮统一基础设施（图标/配置/反馈/块原文提取） ---- */
    const COPY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
    const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 13 4 4L19 7"/></svg>';
    const CHEVRON_DOWN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>';
    const CHEVRON_UP_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 15 6-6 6 6"/></svg>';
    /* G6 (0.0.60): 默认值由设置数据驱动（deepseekHarness.copy.*，VS Code 设置面板/设置台写入，
       改动热更）；state 未到或字段缺失时回落到 0.0.60 前的硬编码默认值——按钮逻辑不变。 */
    function copyCfg() {
      const s = (state && state.copySettings) || {};
      /* codeCopyFormat: 代码块复制按钮默认输出纯文本（不带 fence 围栏）；'markdown'
         时输出含围栏的整段（右键菜单"复制为 Markdown"不受影响，始终完整 md）。
         plainMathFormat: 纯文本复制（块按钮 text 档 + 右键"复制纯文本"）中公式的输出形式。
           'tex'           = 无定界符 TeX 源（0.0.49 起的行为，默认保留）
           'tex-delimited' = 按 inline/display 分别包 $ / $$（粘回 Markdown 编辑器可渲染） */
      return {
        mathButtons: s.mathButtons !== false,
        blockButtons: s.blockButtons !== false,
        /* 0.0.162（公式四档）：markdown / tex / tex-delimited / mathml（非法回落 markdown）。 */
        mathFormat: s.mathFormat === 'tex' || s.mathFormat === 'tex-delimited' || s.mathFormat === 'mathml' ? s.mathFormat : 'markdown',
        plainMathFormat: s.plainMathFormat === 'tex-delimited' ? 'tex-delimited' : 'tex',
        codeCopyFormat: s.codeCopyFormat === 'markdown' ? 'markdown' : 'text',
        feedbackMs: typeof s.feedbackMs === 'number' && s.feedbackMs >= 200 && s.feedbackMs <= 6000 ? s.feedbackMs : 1000,
        /* G45（0.0.103）：「复制为 SVG」颜色（'theme' | '#rrggbb'）。 */
        mathSvgColor: typeof s.mathSvgColor === 'string' ? s.mathSvgColor : 'theme',
        /* G45 v1.2（0.0.105）：位图档位（'screen' | '512' | '1024' | '2048'）。 */
        svgPngEdge: typeof s.svgPngEdge === 'string' ? s.svgPngEdge : '1024',
      };
    }
    /* 0.0.162（全产品审查·公式四档）：公式「点击复制」输出文本（纯函数，单测直测）。
       markdown = 行内 $…$ / 块级 $$…$$；tex = 纯 TeX 源；tex-delimited = 同上定界符形态；
       mathml = 按需生成的 MathML（0.1.49 起渲染期不再保留隐藏层；缺失时回落 TeX——宁可复制可编辑源也不给空文本）。 */
    function mathFormatText(format, tex, display, mathml) {
      if (format === 'tex') return tex;
      if (format === 'mathml') return typeof mathml === 'string' && mathml !== '' ? mathml : tex;
      /* markdown / tex-delimited 同形（价格式由设置项语义区分：前者是"粘进 Markdown"，
         后者是"TeX 源带定界符"——当前实现相同，保留两档以便未来分化）。 */
      return display ? '$$' + tex + '$$' : '$' + tex + '$';
    }
    /* 0.1.49（D2）：MathML **按需生成**——渲染期已不再保留 KaTeX 的隐藏 MathML 层（省 ~26% 公式节点），
       但「复制为 MathML」/「公式按钮输出格式 = MathML」仍需它 ⇒ 第一次用到时算一次并缓存到 __mkd.mathml。
       返回 math 元素本身的 outerHTML（与旧实现一致：DOM 侧取的也是 math 元素，不含 .katex 包装 span）。 */
    function mathmlOf(b) {
      if (b === undefined || b === null) return '';
      if (typeof b.mathml === 'string') return b.mathml;
      const mdvK = mdlib();
      if (!mdvK || !mdvK.katex || typeof mdvK.katex.renderToString !== 'function') { b.mathml = ''; return ''; }
      try {
        const html = String(mdvK.katex.renderToString(String(b.raw || ''), { displayMode: b.display === true, throwOnError: false, output: 'mathml' }));
        const matched = html.match(/<math[\\s\\S]*<\\/math>/);
        b.mathml = matched === null ? '' : matched[0];
      } catch { b.mathml = ''; }
      return b.mathml;
    }
    /* G27 round2 (0.0.50): 复制成功的块级蓝光反馈——与公式点击复制同一 keyframes
       （dsh-copied-flash 1s 向外辐射）；class 加在被复制的宿主块上（段落/标题/列表项/
       引用块/代码包裹/表格/消息）。offsetWidth 强制 reflow 保证连续点击动画可重播。 */
    function flashCopied(host) {
      if (!host || typeof host.classList !== 'object' || !host.classList) return;
      host.classList.remove('copied-flash');
      void host.offsetWidth;
      host.classList.add('copied-flash');
      window.setTimeout(() => host.classList.remove('copied-flash'), copyCfg().feedbackMs + 100);
    }
    function copyButton(textGetter, tip, flashHost) {
      const btn = node('button', 'msg-action');
      btn.type = 'button';
      btn.title = tip;
      btn.setAttribute('aria-label', tip);
      btn.innerHTML = COPY_SVG;
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'copy-text', text: textGetter() });
        flashCopied(flashHost);
        btn.innerHTML = CHECK_SVG;
        btn.title = '已复制';
        window.setTimeout(() => { btn.innerHTML = COPY_SVG; btn.title = tip; }, copyCfg().feedbackMs);
      });
      return btn;
    }
    /* G27: 块级复制取原文——token.map=[start,end) 是 prepared 行号；跨行公式被占位符
       折叠成一行后行号偏移，srcLine[i] = prepared 第 i 行对应的源起始行。 */
    function blockSource(source, srcLine, map) {
      if (!map || map.length < 2) return '';
      const rows = String(source || '').replace(/\\r/g, '').split('\\n');
      /* G27 round2 (0.0.44): 跨行公式占位行 srcLine 存 {from,to}（整段公式源行范围）——
         段落 map 覆盖占位符行时按 to 展开，复制得到完整公式块而非只有起始行。 */
      const conv = (n) => { const v = srcLine ? srcLine[n] : undefined; return (v && typeof v === 'object') ? v.from : (v ?? n); };
      const convEnd = (n) => { const v = srcLine ? srcLine[n] : undefined; return (v && typeof v === 'object') ? v.to : (v ?? n); };
      return rows.slice(conv(map[0]), convEnd(map[1] - 1) + 1).join('\\n').trimEnd();
    }
    /* ---- G15 vendor pipeline (markdown-it token walker + KaTeX math + shiki) ---- */
    const MATH_SENTINEL = '\uE000';
    // $…$ / $$…$$ / \(…\) / \[…\] scanner — written instead of auto-render because
    // auto-render folds double-backslashes (matrix row breaks) when matching single-$ delimiters.
    function mathSegments(text) {
      const out = [];
      const src = String(text).split('\\\\$').join(MATH_SENTINEL);
      let last = 0;
      const flushText = (until) => {
        if (until > last) out.push({ type: 'text', text: src.slice(last, until) });
        last = until;
      };
      let i = 0;
      while (i < src.length) {
        const ch = src[i];
        if (ch === '$') {
          const display = src[i + 1] === '$';
          const openLen = display ? 2 : 1;
          const endMark = display ? '$$' : '$';
          let j = i + openLen; let content = ''; let closed = false;
          while (j < src.length) {
            if (src.startsWith(endMark, j)) { closed = true; break; }
            content += src[j]; j += 1;
          }
          if (closed && !display) {
            if (content !== content.trim() || content.indexOf('\\n') >= 0) closed = false;
          }
          if (closed) {
            const trimmed = content.trim();
            if (trimmed.length === 0 || trimmed.length > 2000 || trimmed.endsWith(',') || /^[0-9]+$/.test(trimmed)) closed = false;
          }
          if (closed) {
            const tex = content.trim();
            flushText(i);
            /* G27 round2 (0.0.44): raw = trim 前的原文——srcLine 行号推进需真实行数
               （多行 $$ 块 tex 被 trim 后无换行，会少算 2 行 → 后续块复制错位）。 */
            out.push({ type: 'math', display, tex, raw: content });
            last = j + (display ? 2 : 1);
            i = last;
            continue;
          }
        }
        if (ch === '\\\\' && src[i + 1] === '(') {
          let j = i + 2; let content = ''; let closed = false;
          while (j < src.length) {
            if (src.startsWith('\\\\', j) && src[j + 1] === ')') { closed = true; break; }
            content += src[j]; j += 1;
          }
          if (closed && content.trim().length > 0 && content.trim().length <= 2000) {
            flushText(i); out.push({ type: 'math', display: false, tex: content, raw: content });
            last = j + 2; i = last; continue;
          }
        }
        if (ch === '\\\\' && src[i + 1] === '[') {
          let j = i + 2; let content = ''; let closed = false;
          while (j < src.length) {
            if (src.startsWith('\\\\', j) && src[j + 1] === ']') { closed = true; break; }
            content += src[j]; j += 1;
          }
          if (closed && content.trim().length > 0 && content.trim().length <= 2000) {
            flushText(i); out.push({ type: 'math', display: true, tex: content, raw: content });
            last = j + 2; i = last; continue;
          }
        }
        i += 1;
      }
      flushText(src.length);
      for (const seg of out) if (seg.type === 'text') seg.text = seg.text.split(MATH_SENTINEL).join('$');
      return out;
    }
function mathEl(parent, tex, display) {
      const span = node('span', 'math');
      /* G27 round2 (0.0.42): 块级公式标记类——CSS 里 math-display 改 block+居中，
         inline 公式改 inline-block，两者背景高度都跟随内容（覆盖矩阵等超行高内容）。 */
      if (display === true) span.classList.add('math-display');
      const mdvK = mdlib();
      let katexRoot;
      if (mdvK && mdvK.katex) {
        const k = document.createElement('span');
        /* 0.1.49（D2）：只渲染 HTML 层——KaTeX 的 MathML 层是**视觉隐藏**的（给屏幕阅读器）。
           实测三形态对照（探针 _probe_d2_math_forms.mjs）：砍掉它节点 −26%，且与现状**逐像素相同**；
           MathML 出口（「复制为 MathML」/公式格式=MathML）改为**按需生成**（见 mathmlOf）。 */
        try { mdvK.katex.render(tex, k, { displayMode: display === true, throwOnError: false, output: 'html' }); }
        catch { k.textContent = tex; }
        /* 无障碍兜底：HTML 层自带 aria-hidden，少了 MathML 后 AT 读不到公式 ⇒ 给容器一个名字（原 TeX）。 */
        span.setAttribute('role', 'math');
        span.setAttribute('aria-label', tex);
        span.append(k);
        katexRoot = k;
      } else {
        span.textContent = tex;
      }
      /* G27 (0.0.40→0.0.41): 公式复制改"点击公式即复制"——原按钮 top:-2px 出界导致 hover 断链点不到
         （G27 round2 反馈①）；整块 hover 灰底提示可点、点击成功边缘蓝光 1s。拖选 guard 保留选中能力。 */
      /* 0.0.162（全产品审查 P0-4）：右键导出（复制 LaTeX / Markdown / SVG / MathML / PNG / 另存）
         与「公式复制按钮」开关**解耦**——此前关掉开关会连 data-mkd/__mkd 一起不注册，右键导出
         整条失联（用户会以为"导出功能坏了"）。绑定恒注册；仅外观与"点击复制"行为随开关。
         G45（0.0.103）：随附 MathML 序列化（KaTeX 隐藏层）与来源元素引用——「复制为 SVG / MathML」用。
         注：katexRoot 仅在 katex 可用时存在，且单测为极简 DOM 桩（无 querySelector）——两处都要防御。 */
      {
        /* 0.1.49（D2）：不再从 DOM 取 MathML（隐藏层已不渲染）——留 undefined，出口处按需生成。 */
        span.__mkd = { kind: 'math', raw: tex, md: (display ? '$$' + tex + '$$' : '$' + tex + '$'), el: span, display: display === true };
        span.dataset.mkd = 'math';
      }
      if (copyCfg().mathButtons) {
        span.classList.add('math-copy');
        span.title = '点击复制公式';
        span.addEventListener('click', () => {
          if (selectionDragEnded()) return;
          /* 只有「公式按钮输出格式 = MathML」才现算 MathML（其余档位零开销）。 */
          const fmt = mathFormatText(copyCfg().mathFormat, tex, display, copyCfg().mathFormat === 'mathml' && span.__mkd !== undefined ? mathmlOf(span.__mkd) : '');
          vscode.postMessage({ type: 'copy-text', text: fmt });
          span.classList.remove('copied');
          void span.offsetWidth;
          span.classList.add('copied');
          window.setTimeout(() => span.classList.remove('copied'), copyCfg().feedbackMs + 100);
        });
      }
      parent.append(span);
    }
    /* G15 (0.0.33→fix): 占位符为无状态自解码——内嵌 encodeURIComponent(tex)+显示标志，
       流式/并发渲染相互独立（前版模块级 mathPhPieces 数组在流式重入时竞态→渲染抛错闪烁）。
       注：模板内写两反斜杠（求值后 JS 源为 \uE002 转义序列）。 */

    function appendMathText(parent, text) {
      let last = 0;
      for (const m of String(text).matchAll(mathPhRe)) {
        if (m.index > last) appendRunOf(parent, text.slice(last, m.index));
        const body = m[1] || '';
        const display = body.endsWith('~1');
        if (display || body.endsWith('~0')) {
          const payload = body.slice(0, body.length - 2);
          let tex = payload;
          try { tex = decodeURIComponent(payload); } catch { /* keep raw */ }
          mathEl(parent, tex, display);
        } else {
          appendFileText(parent, m[0]);
        }
        last = m.index + m[0].length;
      }
      if (last < text.length) appendRunOf(parent, text.slice(last));
    }
    function appendRunOf(parent, part) {
      for (const seg of mathSegments(part)) {
        if (seg.type === 'text') { appendFileText(parent, seg.text); continue; }
        mathEl(parent, seg.tex, seg.display);
      }
    }
        function safeHref(value) {
      return /^https?:\\/\\//i.test(String(value || '')) ? String(value) : '';
    }
    function checkboxFrom(html) {
      const input = node('input');
      input.type = 'checkbox';
      input.disabled = true;
      if (html.indexOf('checked') >= 0) input.checked = true;
      return input;
    }
    function renderInlineTokens(parent, container, images) {
      const stack = [parent];
      const kids = container.children || [];
      for (const c of kids) {
        const top = stack[stack.length - 1];
        switch (c.type) {
          case 'text': appendMathText(top, c.content); break;
          case 'html_inline': if (c.content.indexOf('<input') === 0 && c.content.indexOf('checkbox') >= 0) top.append(checkboxFrom(c.content)); break;
          case 'code_inline': {
            const v = c.content; const ref = fileReference(v);
            top.append(ref ? fileButton(ref.path, ref.line, v, 'code-link') : node('code', '', v));
            break;
          }
          case 'strong_open': { const n = node('strong'); top.append(n); stack.push(n); break; }
          case 'em_open': { const n = node('em'); top.append(n); stack.push(n); break; }
          case 's_open': { const n = node('s'); top.append(n); stack.push(n); break; }
          case 'link_open': {
            /* 0.0.35: link(href,'') 的 label 兜底会先塞入 href 文本、
               随后 inline text 又追加一次 → 显示为 "urlurl" 重复——改为裸 a + 立即
               attach click（文本由后续 text token 提供）。 */
            const href = safeHref(c.attrGet ? c.attrGet('href') : undefined);
            const n = node('a');
            if (href) {
              n.href = href;
              n.addEventListener('click', event => { event.preventDefault(); vscode.postMessage({ type: 'open-link', href }); });
            }
            top.append(n); stack.push(n);
            break;
          }
          case 'image': {
            const src = String(c.attrGet ? c.attrGet('src') || '' : '');
            const alt = c.content || 'image';
            if (images && /^https:\\/\\//i.test(src)) {
              const img = node('img'); img.src = src; img.alt = alt; img.loading = 'lazy';
              img.referrerPolicy = 'no-referrer';
              top.append(img);
            } else {
              top.append(document.createTextNode('[图片: ' + alt + ']'));
            }
            break;
          }
          /* G27 round2 (0.0.48): 引用块内 softbreak 渲染为换行（用户反馈②——blockquote 内
             连续 > 行视觉合并成一行）；其余保持空格（markdown 段落语义）。复制不受影响
             （blockSource 走原 text，含 \n）。 */
          case 'softbreak':
            if (top.closest('blockquote')) top.append(node('br'));
            else top.append(document.createTextNode(' '));
            break;
          case 'hardbreak': top.append(node('br')); break;
          default: if (c.type.endsWith('_close')) stack.pop();
        }
      }
    }
    function renderFence(parent, t) {
      const pre = node('pre', 'shiki');
      const code = node('code', '', t.content);
      pre.append(code);
      parent.append(pre);
      const info = String(t.info || '').trim();
      const mdvT = mdlib(); if (!mdvT || !info) return pre;
      mdvT.tokenize(info, t.content).then(lines => {
        if (!lines || code.isConnected !== true) return;
        code.textContent = '';
        /* G27 round2 (0.0.41): ⑤ fence 尾部空行——tokenize 行数组尾恒多一空 token 组
           （markdown-it fence 保留尾换行），原样渲染则代码块底部多一行 1.55em 空行（G15 遗留）。
           修剪末尾连续空行，中间空行（代码内换行）保留。 */
        let last = lines.length - 1;
        while (last >= 0 && !(lines[last] && lines[last].length)) last -= 1;
        for (let i = 0; i <= last; i += 1) {
          const lineNode = node('span', 'shiki-line');
          for (const tok of lines[i] || []) {
            const s = node('span'); s.style.color = tok.color; s.textContent = tok.content;
            lineNode.append(s);
          }
          code.append(lineNode);
        }
      }).catch(() => { });
      return pre;
    }
    /* 0.0.37 修补 (用户反馈⑨补): markdown-it GFM 表格 th_open/td_open 带
       attrs style="text-align:center|right"——原实现未读取 → 居中对齐/右对齐失效。
       用 CSSOM 写入（CSP style-src 无 unsafe-inline 会拦 HTML style 属性，JS 设置不受限）。 */
    function applyCellAlign(cell, token) {
      for (const entry of (token.attrs || [])) {
        if (entry[0] !== 'style' || typeof entry[1] !== 'string') continue;
        const match = /(?:^|;)\\s*text-align:\\s*(left|center|right|justify)/.exec(entry[1]);
        if (match) cell.style.textAlign = match[1];
      }
    }
    function tableFrom(tokens, index, images) {
      const tableEl = node('table');
      let section; let row; let cell;
      let j = index + 1;
      for (; j < tokens.length; j += 1) {
        const t = tokens[j];
        if (t.type === 'table_close') break;
        else if (t.type === 'thead_open') { section = node('thead'); tableEl.append(section); }
        else if (t.type === 'tbody_open') { section = node('tbody'); tableEl.append(section); }
        else if (t.type === 'tr_open') { row = node('tr'); if (section) section.append(row); }
        else if (t.type === 'th_open') { cell = node('th'); if (row) { applyCellAlign(cell, t); row.append(cell); } }
        else if (t.type === 'td_open') { cell = node('td'); if (row) { applyCellAlign(cell, t); row.append(cell); } }
        else if (t.type === 'inline') { if (cell) renderInlineTokens(cell, t, images); }
        else if (t.type === 'th_close' || t.type === 'td_close') { cell = undefined; }
      }
      const wrap = node('div', 'table-wrap'); wrap.append(tableEl);
      return { el: wrap, next: j };
    }
    /* G27 (0.0.47): 超高块折叠——内容 > 设定行数（fold.blockMinLines，默认 3）才挂折叠按钮；
       折叠态 class 仅存 DOM，源文本不受影响（blockSource 与 .folded 无关），拖选时点击跳过（防误折叠）。
       0.0.96（G38 批次 2）：门槛从固定 3 改为设置驱动（判定处直接读 foldCfg()）。 */
    function contentLines(text) {
      const rows = String(text || '').split('\\n');
      while (rows.length > 0 && rows[rows.length - 1].trim() === '') rows.pop();
      return rows.length;
    }
    function foldButton(host, initiallyFolded) {
      const btn = node('button', 'msg-action');
      btn.type = 'button';
      btn.classList.add('fold-block');
      const applyState = (folded) => {
        host.classList.toggle('folded', folded);
        btn.title = folded ? '展开' : '折叠';
        btn.setAttribute('aria-expanded', folded ? 'false' : 'true');
        btn.innerHTML = folded ? CHEVRON_UP_SVG : CHEVRON_DOWN_SVG;
      };
      applyState(initiallyFolded === true);
      btn.addEventListener('click', () => {
        if (selectionDragEnded()) return;
        const folded = !host.classList.contains('folded');
        applyState(folded);
        /* G39 v2：超高块折叠（代码/引用/表格）按"消息 id#源行"记忆——切会话/Reload 后保持。 */
        const mk = host.dataset.mk;
        if (viewMemoryCfg().fold && typeof renderedSessionId === 'string' && typeof mk === 'string' && mk !== '') {
          const memo = viewMemoOf(renderedSessionId);
          if (folded) memo.blocks.set(mk, 'folded'); else memo.blocks.delete(mk);
          scheduleViewStatePersist(renderedSessionId);
        }
      });
      return btn;
    }
    /* G27 round2 (0.0.48): 块纯文本提取（右键"复制纯文本"）——open..close token 范围内
       inline children 拼文本：math→TeX 源、code_inline→内容、softbreak→空格、hardbreak→换行；
       表格按行 \t 分隔（tr 边界）；块级 token（段落/列表/引用/标题）间 \n。 */
    const TEXT_BLOCK_BREAK = new Set(['paragraph_open', 'heading_open', 'list_item_open', 'bullet_list_open', 'ordered_list_open', 'blockquote_open']);
    /* G27 round2 (0.0.49): 纯文本复制还原数学公式——渲染时数学被占位成
       Math_PH_OPEN + mathEncode(tex) + (~1|~0) + MATH_PH_CLOSE 文本节点（见 replaceMathPlaceholders），
       这里按 appendMathText 同一规则解码回 TeX 源（decode 失败保留原始占位串）。 */
    /* G27 round4 (0.0.53): plainMathFormat 接口——'tex-delimited' 时按占位符 ~1/~0
       （display/inline）还原定界符（$$…$$ / $…$），粘回 Markdown 编辑器可渲染；
       'tex'（默认）维持无定界符 TeX 源。decode 失败仍保留原始占位串。 */
    function plainMathText(text) {
      return String(text).replace(mathPhRe, (full, body) => {
        if (body.endsWith('~1') || body.endsWith('~0')) {
          const payload = body.slice(0, body.length - 2);
          let tex;
          try { tex = decodeURIComponent(payload); } catch { return payload; }
          if (copyCfg().plainMathFormat !== 'tex-delimited') return tex;
          return body.endsWith('~1') ? '$$' + tex + '$$' : '$' + tex + '$';
        }
        return full;
      });
    }
    /* 0.0.167（B4 补档）：TSV → CSV（最小引用：含 , " 或换行的单元包双引号，内部 " 翻倍）。 */
    function tsvToCsv(text) {
      return String(text).split('\\n').map(line => line.split('\\t').map(cell => (
        /[",\\n]/.test(cell) ? '"' + cell.replace(/"/g, '""') + '"' : cell
      )).join(',')).join('\\n');
    }
    function blockPlainText(tokens, openIndex) {
      const parts = [];
      let depth = 0; let inTr = false; let firstCell = true;
      /* 0.0.167（B4 补档）：列表纯文本保留符号与缩进——旧实现丢 bullet/序号/缩进，
         粘贴后看不出层级。listStack 记每层列表的序号状态；itemPrefixPending 防
         "符号与正文之间插入多余换行"（列表项内首个段落 open 不触发 pushLine）。 */
      const listStack = [];
      let itemPrefixPending = false;
      const pushLine = () => {
        if (itemPrefixPending) return;
        if (parts.length > 0 && parts[parts.length - 1] !== '\\n') parts.push('\\n');
      };
      for (let k = openIndex; k < tokens.length; k += 1) {
        const tk = tokens[k];
        if (tk.type === 'bullet_list_open') { listStack.push({ ordered: false, index: 0 }); depth += 1; continue; }
        if (tk.type === 'ordered_list_open') { listStack.push({ ordered: true, index: 0 }); depth += 1; continue; }
        if (tk.type === 'bullet_list_close' || tk.type === 'ordered_list_close') { listStack.pop(); depth -= 1; if (depth <= 0) break; continue; }
        if (tk.type === 'list_item_open') {
          pushLine();
          const listCtx = listStack[listStack.length - 1];
          let prefix = '';
          if (listCtx !== undefined) {
            listCtx.index += 1;
            prefix = '  '.repeat(Math.max(0, listStack.length - 1)) + (listCtx.ordered ? String(listCtx.index) + '. ' : '- ');
          }
          parts.push(prefix);
          itemPrefixPending = true;
          depth += 1;
          continue;
        }
        if (tk.type === 'tr_open') { if (inTr) pushLine(); inTr = true; firstCell = true; depth += 1; continue; }
        if (tk.type === 'th_open' || tk.type === 'td_open') { if (inTr && !firstCell) parts.push('\\t'); if (inTr) firstCell = false; depth += 1; continue; }
        if (tk.type === 'inline' && tk.children) {
          itemPrefixPending = false;
          for (const c of tk.children) {
            if (c.type === 'text') parts.push(plainMathText(c.content));
            else if (c.type === 'code_inline') parts.push(c.content);
            else if (c.type === 'math') parts.push(c.tex != null ? c.tex : (c.content || ''));
            else if (c.type === 'softbreak') parts.push(' ');
            else if (c.type === 'hardbreak') parts.push('\\n');
          }
          continue;
        }
        if (TEXT_BLOCK_BREAK.has(tk.type)) pushLine();
        if (tk.type.endsWith('_open')) { depth += 1; continue; }
        if (tk.type.endsWith('_close')) { depth -= 1; if (depth <= 0) break; }
      }
      return parts.join('').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n+/g, '\\n').trim();
    }
    /* G27 round2 (0.0.48): 块级右键菜单动作注册表——hover 工具条取前 ≤2 个高频动作
       （复制+折叠，见 attachBlockActions），右键菜单承载全部（复制为 Markdown / 复制纯文本 /
       复制 LaTeX）；未来新增动作只改这里（平移官方 menus.webview/context 时映射 webviewSection）。 */
    const BLOCK_ACTIONS = {
      default: [
        { label: '复制为 Markdown', run: b => () => vscode.postMessage({ type: 'copy-text', text: blockSource(b.srcInfo.source, b.srcInfo.srcLine, b.token.map) }) },
        { label: '复制纯文本', run: b => () => vscode.postMessage({ type: 'copy-text', text: b.plain() }) },
      ],
      math: [
        { label: '复制 LaTeX', run: b => () => vscode.postMessage({ type: 'copy-text', text: b.raw }) },
        { label: '复制为 Markdown', run: b => () => vscode.postMessage({ type: 'copy-text', text: b.md }) },
        /* G45（0.0.103）：矢量图 / 可编辑公式两条新出口。 */
        { label: '复制为 SVG', run: b => () => copyMathAsSvg(b) },
        { label: '复制为 MathML', run: b => () => copyMathAsMathml(b) },
        /* G45 v1.2（0.0.105）：纯位图出口（按档位栅格化）+ 文件出口（分享场景，不依赖剪贴板）。 */
        { label: '复制为 PNG', run: b => () => copyMathAsPng(b) },
        { label: '另存为 SVG 文件…', run: b => () => saveMathAsSvgFile(b) },
        { label: '另存为 PNG 文件…', run: b => () => saveMathAsPngFile(b) },
      ],
      /* 0.0.167（B4 补档）：表格纯文本实为 TSV——挂上明确标注 + 追加 CSV 档
         （粘进 Excel/Sheets 用 TSV，粘进其它表格软件/脚本用 CSV）。 */
      table: [
        { label: '复制为 Markdown', run: b => () => vscode.postMessage({ type: 'copy-text', text: blockSource(b.srcInfo.source, b.srcInfo.srcLine, b.token.map) }) },
        { label: '复制为 TSV（粘进 Excel/Sheets）', run: b => () => vscode.postMessage({ type: 'copy-text', text: b.plain() }) },
        { label: '复制为 CSV', run: b => () => vscode.postMessage({ type: 'copy-text', text: tsvToCsv(b.plain()) }) },
      ],
    };
    /* G45（0.0.103）：公式复制为 SVG / MathML。
       SVG：懒加载 MathJax tex-svg（window.__mathjaxUri；动态脚本须带页面 nonce 过 CSP）→ tex2svg →
       取内部 svg → 宽高按屏显 → currentColor 替换为设置色 → 栅格化 PNG 兜底 → 交扩展写剪贴板。
       MathML：由 TeX **按需生成**（0.1.49 起：渲染期已不保留隐藏 MathML 层；首次复制时算一次并缓存）→ 交扩展以 HTML Format 写剪贴板。 */
    let mathjaxLoading;
    function ensureMathJax() {
      if (window.MathJax && typeof window.MathJax.tex2svg === 'function') return Promise.resolve();
      if (mathjaxLoading !== undefined) return mathjaxLoading;
      mathjaxLoading = new Promise((resolve, reject) => {
        const uri = String(window.__mathjaxUri || '');
        if (uri === '') { mathjaxLoading = undefined; reject(new Error('no-mathjax-uri')); return; }
        const tag = document.createElement('script');
        const anchor = document.querySelector('script[nonce]');
        if (anchor && anchor.nonce) tag.setAttribute('nonce', anchor.nonce);
        tag.src = uri;
        tag.onload = () => {
          if (window.MathJax && typeof window.MathJax.tex2svg === 'function') resolve();
          else { mathjaxLoading = undefined; reject(new Error('mathjax-not-ready')); }
        };
        tag.onerror = () => { mathjaxLoading = undefined; reject(new Error('mathjax-load-error')); };
        document.head.append(tag);
      });
      return mathjaxLoading;
    }
    function mathSvgColorOf() {
      const value = String(copyCfg().mathSvgColor || '');
      if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
      const color = window.getComputedStyle(document.body).color;
      return color !== '' ? color : '#000000';
    }
    function svgToPngDataUrl(svgText) {
      return new Promise((resolve) => {
        try {
          const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
          const image = new Image();
          image.onload = () => {
            try {
              /* G45 v1.2（0.0.105）：分辨率策略=档位（copy.svgPngEdge）最长边目标 + 倍率护栏：
                 'screen'=固定 4×；512/1024/2048=最长边目标（倍率钳到 2–8×），画布边长 ≤4096。 */
              const longEdge = Math.max(1, Math.max(image.width || 200, image.height || 60));
              const edge = String(copyCfg().svgPngEdge || '1024');
              const target = edge === 'screen' ? 0 : Number(edge);
              let scale = target > 0 && Number.isFinite(target) ? target / longEdge : 4;
              scale = Math.min(8, Math.max(2, scale));
              scale = Math.min(scale, 4096 / longEdge);
              scale = Math.max(0.25, scale);
              const width = Math.max(1, Math.round((image.width || 200) * scale));
              const height = Math.max(1, Math.round((image.height || 60) * scale));
              const canvas = document.createElement('canvas');
              canvas.width = width; canvas.height = height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(image, 0, 0, width, height);
              resolve(canvas.toDataURL('image/png'));
            } catch { resolve(''); }
          };
          image.onerror = () => resolve('');
          image.src = url;
        } catch { resolve(''); }
      });
    }
    /* G45 v1.2（0.0.105）：统一渲染入口——tex2svg → 内部 svg → 宽高按屏显 → 颜色替换；
       三个出口（剪贴板双格式 / 纯 PNG / 另存文件）共用。 */
    function renderMathSvg(b) {
      const ready = window.MathJax && typeof window.MathJax.tex2svg === 'function';
      if (!ready) vscode.postMessage({ type: 'toast', text: '正在准备 SVG 组件…' });
      return ensureMathJax().then(() => {
        const rooted = window.MathJax.tex2svg(String(b.raw || ''), { display: String(b.md || '').indexOf('$$') === 0 });
        const svg = rooted && typeof rooted.querySelector === 'function' ? rooted.querySelector('svg') : null;
        if (!svg) throw new Error('no-svg');
        if (b.el && typeof b.el.getBoundingClientRect === 'function') {
          const box = b.el.getBoundingClientRect();
          if (box.width > 0) svg.setAttribute('width', String(Math.round(box.width)) + 'px');
          if (box.height > 0) svg.setAttribute('height', String(Math.round(box.height)) + 'px');
        }
        return svg.outerHTML.split('currentColor').join(mathSvgColorOf());
      });
    }
    function copyMathAsSvg(b) {
      renderMathSvg(b).then(text => svgToPngDataUrl(text).then(png => {
        vscode.postMessage({ type: 'copy-svg-clip', svg: text, png: png });
      })).catch(() => {
        vscode.postMessage({ type: 'toast', text: '复制 SVG 失败（组件加载或转换出错）', failed: true });
      });
    }
    function copyMathAsPng(b) {
      renderMathSvg(b).then(text => svgToPngDataUrl(text).then(png => {
        if (typeof png !== 'string' || png.indexOf('data:image/png') !== 0) throw new Error('no-png');
        vscode.postMessage({ type: 'copy-png-clip', png: png });
      })).catch(() => {
        vscode.postMessage({ type: 'toast', text: '复制 PNG 失败（组件加载或转换出错）', failed: true });
      });
    }
    /* 0.0.167（B4 补档）：公式「另存为 PNG 文件…」——复用 SVG 管线 + 档位栅格化（与"复制为 PNG"同源），
       经扩展 save-as(kind:'image') 写盘。 */
    function formulaFileName(ext) {
      const now = new Date();
      const pad = (value) => String(value).padStart(2, '0');
      return 'formula-' + String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) + '.' + ext;
    }
    function saveMathAsSvgFile(b) {
      renderMathSvg(b).then(text => {
        vscode.postMessage({ type: 'save-svg-file', svg: text, name: formulaFileName('svg') });
      }).catch(() => {
        vscode.postMessage({ type: 'toast', text: '生成 SVG 失败（组件加载或转换出错）', failed: true });
      });
    }
    function saveMathAsPngFile(b) {
      renderMathSvg(b).then(text => svgToPngDataUrl(text).then(png => {
        if (typeof png !== 'string' || png.indexOf('data:image/png') !== 0) throw new Error('no-png');
        vscode.postMessage({ type: 'save-as', kind: 'image', name: formulaFileName('png'), data: png });
      })).catch(() => {
        vscode.postMessage({ type: 'toast', text: '生成 PNG 失败（组件加载或转换出错）', failed: true });
      });
    }
    function copyMathAsMathml(b) {
      /* 0.1.49（D2）：按需生成（渲染期不再有隐藏 MathML 层）。 */
      const mathml = mathmlOf(b);
      if (mathml === '') { vscode.postMessage({ type: 'toast', text: '未找到该公式的 MathML', failed: true }); return; }
      vscode.postMessage({ type: 'copy-mathml-clip', mathml: mathml });
    }
    /* G27 (0.0.47): 统一块级按钮容器——复制 +（超高块）折叠按钮（替代逐宿主挂 .copy-block，
       hover 显示规则收敛为容器一条）；token.map 取源行范围（跨行公式补偿见 blockSource）。
       G27 round2 (0.0.48): +kind 标识、__mkd 数据绑定（右键菜单用，软更新复用节点保留）。
       0.1.18：--actions-w 动态让位随"文字让位"退役（按钮改遮挡式）。 */
    function attachBlockActions(el, token, srcInfo, opts, tokens, index) {
      if (!srcInfo || !token || !token.map || token.map.length < 2) return;
      /* 0.0.162（全产品审查 P0-4）：右键导出绑定（复制为 Markdown / 纯文本 / SVG / MathML / PNG / 另存）
         **恒注册**——「块级复制按钮」开关只该关掉悬浮按钮；此前连带 data-mkd/__mkd 一起不注册，
         关掉按钮后块右键导出整条失联。 */
      {
        const kind0 = opts.kind || 'default';
        el.dataset.mkd = kind0;
        el.__mkd = {
          kind: kind0, token, srcInfo,
          plain: (token.type === 'fence' || token.type === 'code_block')
            ? () => String(token.content || '').trimEnd()
            : () => blockPlainText(tokens || [], index || 0),
        };
      }
      if (!copyCfg().blockButtons) return;
      const cont = node('div', 'block-actions');
      /* G27 round3 (0.0.52): 代码块按钮默认输出纯文本（codeCopyFormat='text'，G6 设置台
         未来可改）——token.content 不含围栏，与右键"复制纯文本"同构；其余块沿用
         blockSource（md 格式）。markdown 档时 tip 改为"复制代码(Markdown)"以区分。
         G27 round4 (0.0.53): 代码块文本档尾行 trimEnd——fence content 尾部保留换行，
         复制结果末尾多一个空行（用户报告）。右键纯文本档同步（见 __mkd.plain）。 */
      const isCodeText = opts.kind === 'code' && copyCfg().codeCopyFormat === 'text';
      const copy = copyButton(
        isCodeText ? () => String(token.content || '').trimEnd() : () => blockSource(srcInfo.source, srcInfo.srcLine, token.map),
        isCodeText ? '复制代码(纯文本)' : (opts.kind === 'code' ? '复制代码(Markdown)' : opts.copyTip),
        el
      );
      copy.classList.add('copy-block');
      cont.append(copy);
      if (opts.foldable) {
        /* G39 v2：记忆键 = 消息 id#源起始行（整消息渲染时稳定）；命中记忆则初始即折叠态。 */
        const mk = (srcInfo && typeof srcInfo.keyPrefix === 'string' && token.map) ? srcInfo.keyPrefix + '#' + token.map[0] : undefined;
        if (mk !== undefined) el.dataset.mk = mk;
        const memoFolded = mk !== undefined && viewMemoryCfg().fold && typeof renderedSessionId === 'string' && viewMemoOf(renderedSessionId).blocks.get(mk) === 'folded';
        cont.append(foldButton(el, memoFolded));
      }
      el.append(cont);
      /* 0.1.18：--actions-w 随"文字让位"退役（按钮改遮挡式，悬停不再改布局）。 */
    }
    function walkBlocks(parent, tokens, images, srcInfo) {
      const stack = [parent];
      for (let i = 0; i < tokens.length; i += 1) {
        const t = tokens[i];
        const top = () => stack[stack.length - 1];
        switch (t.type) {
          case 'heading_open': { const h = node('h' + t.tag.slice(1)); top().append(h); stack.push(h); attachBlockActions(h, t, srcInfo, { copyTip: '复制标题', kind: 'heading' }, tokens, i); break; }
          /* G27 round2 (0.0.41): ③④ li/blockquote 内的 p 不再挂按钮（与 li/blockquote 按钮同角叠），
             段落复制由宿主 li/blockquote 按钮覆盖。 */
          case 'paragraph_open': {
            const p = node('p'); top().append(p); stack.push(p);
            const host = stack.length >= 2 ? stack[stack.length - 2] : undefined;
            if (!host || (host.tagName !== 'LI' && host.tagName !== 'BLOCKQUOTE')) attachBlockActions(p, t, srcInfo, { copyTip: '复制段落', kind: 'paragraph' }, tokens, i);
            break;
          }
          case 'bullet_list_open': { const ul = node('ul'); top().append(ul); stack.push(ul); break; }
          case 'ordered_list_open': {
            /* 0.0.51: 保留有序列表 start 属性——markdown-it 对 '10.' 起始列表生成
               start=10；此前丢弃导致浏览器一律从 1 编号（两位数起始列表渲染错）。 */
            const ol = node('ol');
            const start = t.attrGet && t.attrGet('start');
            if (start) ol.setAttribute('start', start);
            top().append(ol); stack.push(ol); break;
          }
          case 'list_item_open': { const li = node('li'); top().append(li); stack.push(li); attachBlockActions(li, t, srcInfo, { copyTip: '复制列表项', kind: 'list' }, tokens, i); break; }
          case 'blockquote_open': { const q = node('blockquote'); top().append(q); stack.push(q); attachBlockActions(q, t, srcInfo, { copyTip: '复制引用', kind: 'quote', foldable: t.map != null && t.map[1] - t.map[0] > foldCfg().blockMinLines }, tokens, i); break; }
          case 'inline': {
            const kids = t.children || [];
            const check = kids.length > 0 && kids[0].type === 'html_inline' && kids[0].content.indexOf('checkbox') >= 0;
            /* 0.0.37 修补 (用户反馈⑨补2): task-lists 的 checkbox 行真实结构是
               li_open → paragraph_open → inline——原检测假设栈顶即 LI，从未命中 →
               .task-list-item/.contains-task-list 类从未加上（checkbox CSS 全部失效）。
               向上回溯栈找到最近 LI（其直接父级若为列表容器即 ul/ol）。 */
            if (check) {
              let liAt = stack.length - 1;
              while (liAt >= 0 && stack[liAt].tagName !== 'LI') liAt -= 1;
              if (liAt >= 0) {
                stack[liAt].classList.add('task-list-item');
                if (liAt >= 1) stack[liAt - 1].classList.add('contains-task-list');
              }
            }
            renderInlineTokens(top(), t, images);
            break;
          }
          /* G27 round2 (0.0.46): fence/code_block 包 .code-wrap——按钮挂 wrapper 不随 pre 滚动内容移动 */
          case 'fence': { const wrap = node('div', 'code-wrap'); wrap.append(renderFence(wrap, t)); top().append(wrap); attachBlockActions(wrap, t, srcInfo, { copyTip: '复制代码块', kind: 'code', foldable: contentLines(t.content) > foldCfg().blockMinLines }, tokens, i); break; }
          case 'code_block': { const wrap = node('div', 'code-wrap'); const pre = node('pre'); const code = node('code', '', t.content); pre.append(code); wrap.append(pre); top().append(wrap); attachBlockActions(wrap, t, srcInfo, { copyTip: '复制代码块', kind: 'code', foldable: contentLines(t.content) > foldCfg().blockMinLines }, tokens, i); break; }
          case 'hr': top().append(node('hr')); break;
          case 'table_open': { const table = tableFrom(tokens, i, images); top().append(table.el); const body = table.el.querySelector('tbody'); attachBlockActions(table.el, t, srcInfo, { copyTip: '复制表格(Markdown)', kind: 'table', foldable: body != null && body.children.length > foldCfg().blockMinLines }, tokens, i); i = table.next - 1; break; }
          /* 0.0.36 fix (bug⑨②): tableFrom 停在 table_close 前，外层循环会落在 table_close 上；
             原 default 分支 _close-pop 把根栈弹出，表格后任一 block token 的 top() 为
             undefined → 整条消息降级 legacy（表格+总结段极常见）。显式 break + pop 守卫。 */
          case 'table_close': break;
          case 'html_block': case 'html_inline': break;
          default: if (t.type.endsWith('_close') && stack.length > 1) stack.pop();
        }
      }
    }
    function mathEncode(value) {
      /* G15 (0.0.36, bug⑨①/③): encodeURIComponent 不转义 * _ ( ) ! ~ ' . 且对孤立代理项
         抛 URIError——占位符会被 markdown-it 内联规则拆散（数学变乱码）或每帧裸抛（渲染
         中断）。此函数全量 %XX 编码（decodeURIComponent 反向还原），并要求调用方兜底 catch。 */
      return encodeURIComponent(String(value))
        .replace(/[!'()*_~.-]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
    }
    /* 0.1.19（用户实测）：G27 round2 的"列宽冻结"退役——它为 0.0.42 的"hover 让位/压缩"服务，
       而让位已在 0.1.18 退役（按钮改遮挡式，悬停不再改布局）。冻结本身把已压缩的列宽写死
       （table-layout:fixed + 百分比），长表头/内联公式在窄侧栏下压不进列 → 溢出到邻格。
       移除后回到 auto 布局：内容不可压时表格自然变宽、由 .table-wrap 横向滚动（内容不溢出）。 */
    function renderMarkdownVendor(text, images, keyPrefix) {
      const root = node('div', 'markdown');
      const mdv = mdlib();
      if (!mdv) return renderMarkdownLegacy(text);
      const source = String(text || '').replace(/\\\\r/g, '');
      let prepared = source;
      /* G27 (0.0.40): srcLine[i] = prepared 第 i 行对应的源起始行——跨行公式被占位符
         折叠成一行后 token.map 的行号偏移（实测：源 17 行 → prepared 16 行 → 后续全部偏移 1）。 */
      const srcLine = [];
      /* 0.0.36 fix (bug⑨①): 占位符构建原本在 try 之外——mathSegments/encodeURIComponent 对
         含孤立代理项的流式分片抛 URIError → 该消息及之后全部不渲染且每帧重抛。整体移入 try。 */
      /* G27 round2 (0.0.44): srcLine 按行事件推进（此前按 piece 行数推进，两种错位：
         ① 跨行 $$ 块——raw 含换行、tex 被 trim 后无 \n，只推 1 行，块后所有复制错位；
         ② 行内公式切分文本段后"每段各记一行"。现：行内公式并入当前行不推进，
         跨行公式按 raw 实际行数跳过，行号以源换行为准）。 */
      try {
        const parts = mathSegments(source);
        if (parts.some(piece => piece.type === 'math')) {
          let built = ''; let srcRow = 0; let lineOpen = false;
          const openLine = () => { srcLine.push(srcRow); lineOpen = true; };
          const appendText = (t) => {
            const segs = String(t).split('\\n');
            for (let n = 0; n < segs.length; n += 1) {
              const tailEmpty = n === segs.length - 1 && segs[n] === '';
              if (n > 0) {
                srcRow += 1;
                if (tailEmpty) lineOpen = false;
                else openLine();
              } else if (!lineOpen && !(built === '' && segs[0] === '')) {
                openLine();
              }
              built += (n > 0 ? '\\n' : '') + segs[n];
            }
          };
          const appendMath = (piece) => {
            const span = piece.display ? String(piece.raw).split('\\n').length : 0;
            if (span > 1) {
              if (lineOpen) { lineOpen = false; srcRow += 1; }
              srcLine.push({ from: srcRow, to: srcRow + span - 1 });
              lineOpen = true;
              srcRow += span - 1;
            } else if (!lineOpen) {
              openLine();
            }
            built += MATH_PH_OPEN + mathEncode(piece.tex) + ((piece.display === true) ? '~1' : '~0') + MATH_PH_CLOSE;
          };
          for (const piece of parts) {
            if (piece.type === 'math') appendMath(piece);
            else appendText(piece.text);
          }
          prepared = built;
        } else {
          const textLines = source.split('\\n');
          for (let n = 0; n < textLines.length; n += 1) srcLine.push(n);
        }
      } catch { return renderMarkdownLegacy(text); }
      let tokens;
      try { tokens = mdv.createMd().parse(prepared, {}); }
      catch { return renderMarkdownLegacy(text); }
      try { walkBlocks(root, tokens, images, { source, srcLine, ...(typeof keyPrefix === 'string' && keyPrefix !== '' ? { keyPrefix } : {}) }); }
      catch { return renderMarkdownLegacy(text); }
      /* G27 round2 (0.0.42): 表格列宽冻结——DOM 插入后下一帧布局完成再测（rAF 强制同步取宽，
         streaming 中 table 仍在 .streaming 容器内会被 closest 跳过，settle 帧另行触发）。 */
      return root;
    }
    function renderMarkdown(text, keyPrefix) {
      const mdvD = mdlib(); if (mdvD && typeof mdvD.createMd === 'function') {
        return renderMarkdownVendor(text, state ? state.markdownImages === true : false, keyPrefix);
      }
      return renderMarkdownLegacy(text);
    }
    function createMarkdownStream(text) {
      const stream = {
        root: node('div', 'markdown'), text: '', committedOffset: 0, scanOffset: 0,
        safeBoundary: 0, fenced: false, linePrefix: '', lineHasContent: false, tailNode: undefined, marker: document.createComment('stream-end'),
      };
      stream.root.append(stream.marker);
      appendMarkdownStream(stream, String(text || ''), true);
      return stream;
    }
    function scanMarkdownStream(stream, text) {
      for (let index = stream.scanOffset; index < text.length; index += 1) {
        const character = text[index];
        if (character === '\\n') {
          if (stream.linePrefix === String.fromCharCode(96).repeat(3)) stream.fenced = !stream.fenced;
          else if (!stream.lineHasContent && !stream.fenced) stream.safeBoundary = index + 1;
          stream.linePrefix = ''; stream.lineHasContent = false;
        } else {
          if (stream.linePrefix.length < 3) stream.linePrefix += character;
          if (!/\\s/.test(character)) stream.lineHasContent = true;
        }
      }
      stream.scanOffset = text.length;
    }
    function appendMarkdownNodes(parent, text, before) {
      if (!text || !parent) return [];
      const parsed = text.length > toolOutputChunkSize ? node('div', 'streaming-plain', text) : renderMarkdown(text);
      const children = parsed.classList && parsed.classList.contains('streaming-plain') ? [parsed] : [...parsed.childNodes];
      for (const child of children) parent.insertBefore(child, before || null);
      return children;
    }
    function appendMarkdownStream(stream, delta, streaming) {
      const previousBoundary = stream.safeBoundary;
      stream.text += String(delta || '');
      scanMarkdownStream(stream, stream.text);
      const boundary = streaming ? stream.safeBoundary : stream.text.length;
      if (boundary > stream.committedOffset) {
        if (stream.tailNode) stream.tailNode.remove();
        stream.tailNode = undefined;
        if (stream.root) appendMarkdownNodes(stream.root, stream.text.slice(stream.committedOffset, boundary), stream.marker);
        stream.committedOffset = boundary;
      }
      if (streaming && boundary < stream.text.length) {
        if (stream.tailNode && boundary === previousBoundary && stream.tailNode.firstChild) stream.tailNode.firstChild.appendData(String(delta || ''));
        else {
          if (stream.tailNode) stream.tailNode.remove();
          stream.tailNode = node('div', 'streaming-plain'); stream.tailNode.append(document.createTextNode(stream.text.slice(boundary)));
          if (stream.root) stream.root.insertBefore(stream.tailNode, stream.marker);
        }
      } else if (stream.tailNode) {
        stream.tailNode.remove(); stream.tailNode = undefined;
      }
    }

    function toolTitle(message, callView, resultView) {
      return string(resultView && resultView.title) || string(callView && callView.title) || message.text || '工具';
    }
    function fileBadgeEl(mediaType, name) {
      const icon = fileTypeIconEl(string(name) || (mediaType ? 'image.' + mediaType.split('/').pop() : 'file'), 'file-badge');
      icon.className = 'card-badge-img';
      return icon;
    }
    /* echoed state carries raw base64; drafts/optimistic carry data: URLs — accept both */
    function imageSrc(mediaType, data) {
      if (typeof data !== 'string' || !data) return undefined;
      if (data.startsWith('data:') || data.startsWith('http:') || data.startsWith('https:')) return data;
      return string(mediaType) ? 'data:' + mediaType + ';base64,' + data : undefined;
    }
    /* 0.0.55（反馈③）: 卡片绑定（__image 供预览实时取 src；__ctx 供右键复制/另存为取数据）。
       建卡与 syncImageCards 同步两处共用——绑定与可见缩略图必须始终指向同一张图。 */
    /* 0.0.167（B4 P2）：同容器（消息图片/文件条）内的图组——预览 ←/→ 切换的候选集；
       单图/无绑定返回 undefined（预览退化为单图模式）。 */
    function messageGalleryOf(card) {
      const container = card.parentElement;
      if (!container) return undefined;
      const gallery = [];
      let index = 0;
      for (const child of container.children) {
        const image = child.__image;
        const src = image === undefined ? undefined : imageSrc(string(image.mediaType), string(image.data));
        if (src === undefined) continue;
        if (child === card) index = gallery.length;
        gallery.push({ src, name: displayFileName(string(image.name, '图片')) || '图片' });
      }
      return gallery.length > 1 ? { gallery, galleryIndex: index } : undefined;
    }
    function bindImageCard(card, image) {
      card.__image = image;
      card.__ctx = { kind: 'image', mediaType: string(image.mediaType), name: displayFileName(string(image.name, '图片')) || '图片', data: string(image.data), attachmentId: string(image.attachmentId) };
    }
    function renderImageCard(image) {
      const mediaType = string(image.mediaType);
      const name = string(image.name, '图片');
      const src = imageSrc(mediaType, image.data);
      if (src) {
        const card = node('button', 'image-card');
        bindImageCard(card, image);
        card.type = 'button'; card.title = '打开预览：' + name;
        const preview = document.createElement('img');
        preview.src = src; preview.alt = name; preview.draggable = false;
        /* 0.0.55（反馈③）: 点击预览改读卡片当前绑定（card.__image）——此前闭包捕获建卡时的 src，
           syncImageCards 只改 img.src 不改闭包 → "看到的是 A、点开的是 B"（用户实测映射错位）。 */
        preview.addEventListener('click', () => {
          const live = card.__image;
          const liveSrc = live === undefined ? undefined : imageSrc(string(live.mediaType), string(live.data));
          if (liveSrc !== undefined) openImagePreview(liveSrc, messageGalleryOf(card));
        });
        card.append(preview); return card;
      }
      const isImage = mediaType.startsWith('image/');
      const status = node('div', isImage ? 'image-card-status' + (image.error ? ' failed' : '') : 'image-card-status file-card');
      bindImageCard(status, image);
      const badge = node('span', 'card-badge');
      badge.append(fileBadgeEl(mediaType, name));
      status.append(
        badge,
        node('span', 'card-name', displayFileName(name)),
        node('span', 'card-caption', isImage ? (image.error ? '预览失败' : '加载中…') : (mediaType || '附件')),
      );
      return status;
    }
    function renderImageCards(parent, images) {
      if (!Array.isArray(images) || !images.length) return;
      const gallery = node('div', 'message-images');
      for (const value of images) {
        const image = record(value); if (!image) continue;
        gallery.append(renderImageCard(image));
      }
      if (gallery.childNodes.length) parent.append(gallery);
    }
    /* G22 文件卡：扩展名徽标 + 文件名 + 体积/不可用；click → open-attachment */
    function formatBytes(size) {
      if (!(size > 0)) return '';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let value = size; let unit = 0;
      while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
      return (unit === 0 ? String(value) : value >= 10 ? String(Math.round(value)) : value.toFixed(1)) + ' ' + units[unit];
    }
    function fileCaption(file) {
      if (file.status === 'expired') return '不可用';
      return formatBytes(Number(file.size) || 0) || '附件';
    }
    function renderFileCard(file) {
      const name = string(file.name, string(file.path));
      const expired = file.status === 'expired';
      const card = node(expired ? 'div' : 'button', 'file-card' + (expired ? ' expired' : ''));
      /* 0.0.55（反馈⑧）: ctx 名用显示名（去 .dsh-paste 时间戳前缀）；复制文件名/复制文件/另存为都取它 */
      card.__ctx = { kind: 'file', name: displayFileName(name) || name, path: string(file.path) };
      const title = string(file.path, name) + (expired ? ' — 不再可用' : Number(file.size) > 0 ? ' · ' + formatBytes(Number(file.size)) : '');
      if (!expired) {
        card.type = 'button'; card.title = title;
        card.addEventListener('click', () => vscode.postMessage({ type: 'open-attachment', path: string(file.path) }));
      } else {
        card.title = title;
      }
      const badge = node('span', 'card-badge');
      badge.append(fileBadgeEl('', name));
      card.append(
        badge,
        node('span', 'card-name', displayFileName(name)),
        node('span', 'card-caption', fileCaption(file)),
      );
      return card;
    }
    function renderFileCards(parent, files) {
      if (!Array.isArray(files) || !files.length) return;
      const strip = node('div', 'message-files');
      for (const value of files) {
        const file = record(value); if (!file) continue;
        strip.append(renderFileCard(file));
      }
      if (strip.childNodes.length) parent.append(strip);
    }
    /* 乐观快照：ideContext.pinned 的 kind==='file' 项（与 extension recordMessageFiles 同一权威源） */
    function optimisticFileCards() {
      const cards = [];
      for (const item of array(ideContext.pinned)) {
        if (!item || item.kind !== 'file' || typeof item.path !== 'string' || item.path === '') continue;
        const name = (item.path.split('/').pop() || '');
        cards.push({ name, path: item.path, mime: '', size: 0, origin: 'workspace', status: 'active' });
      }
      return cards;
    }
    function appendPre(parent, text, className) {
      if (!text) return;
      parent.append(node('pre', className || '', String(text)));
    }
    function appendPrefixedPre(parent, text, prefix, className, continuation) {
      const value = String(text || '');
      if (!value) return;
      const element = node('pre', className || '', (continuation ? '' : prefix) + value.replace(/\\n/g, '\\n' + prefix));
      if (continuation) element.dataset.diffContinuation = 'true';
      parent.append(element);
    }
    function appendMarkdownPage(parent, text) {
      const value = String(text || '');
      if (!value) return;
      parent.append(renderMarkdown(value));
    }
    function appendItems(parent, values, appendItem) {
      if (!values.length) return;
      const container = node('div');
      for (const value of values) appendItem(container, value);
      parent.append(container);
    }
    /* 0.0.164（B3 审查 P1-4）：工具/命令卡复制入口——复制 body 的当前显示文本（innerText 与所见一致；
       deferred 卡加载多少复制多少，tooltip 已注明）。复用统一 copyButton（图标/反馈/时长同源）。 */
    function attachToolCopy(bodyEl, flashHost) {
      const copy = copyButton(() => bodyEl.innerText, '复制输出（当前显示的内容）', flashHost);
      copy.classList.add('tool-copy');
      bodyEl.append(copy);
      return bodyEl;
    }
    function renderToolBody(message, callView, resultView) {
      const body = node('div', 'tool-body');
      const view = resultView || callView;
      const card = string(view && view.card, 'generic');
      if (card === 'terminal') {
        const cwd = string(callView && callView.cwd);
        if (cwd) body.append(node('div', 'result-title', cwd));
        appendPre(body, string(resultView && resultView.output) || message.rawResult || string(callView && callView.title));
        if (resultView && (typeof resultView.exitCode === 'number' || resultView.signal)) body.append(node('div', '', resultView.signal ? '信号 ' + resultView.signal : '退出码 ' + resultView.exitCode));
      } else if (card === 'diff') {
        const paths = [];
        for (const diffValue of array(view.diffs)) {
          const diff = record(diffValue); if (!diff) continue;
          const filePath = string(diff.path, '文件变更');
          const continuation = diff.continuation === true;
          if (!continuation) {
            if (filePath !== '文件变更' && !paths.includes(filePath)) paths.push(filePath);
            const pathRow = node('div', 'diff-path');
            pathRow.append(filePath === '文件变更' ? document.createTextNode(filePath) : fileButton(filePath, undefined, filePath));
            body.append(pathRow);
          }
          if (typeof diff.oldText === 'string') appendPrefixedPre(body, diff.oldText, '- ', 'diff-old', continuation);
          appendPrefixedPre(body, string(diff.newText), '+ ', 'diff-new', continuation);
        }
        for (const filePath of paths) {
          const actions = node('div', 'tool-actions');
          const open = node('button', 'tool-action', paths.length === 1 ? '打开文件' : '打开 ' + filePath);
          open.type = 'button'; open.addEventListener('click', () => vscode.postMessage({ type: 'open-file', path: filePath })); actions.append(open);
          if (!message.streaming && !message.failed) {
            const review = node('button', 'tool-action', paths.length === 1 ? '审阅变更' : '审阅 ' + filePath);
            review.type = 'button'; review.addEventListener('click', () => vscode.postMessage({ type: 'review-file', path: filePath })); actions.append(review);
          }
          body.append(actions);
        }
      } else if (card === 'read') {
        const filePath = string(view.path, '文件'); const title = node('div', 'result-title');
        title.append(filePath === '文件' ? document.createTextNode(filePath) : fileButton(filePath, Number(view.offset) || undefined, filePath)); body.append(title);
        const lines = array(view.lines);
        if (lines.length) appendItems(body, lines, (container, value) => {
          const line = record(value); if (line) container.append(node('div', 'source-line', String(line.number).padStart(4, ' ') + '  ' + string(line.text)));
        });
        else appendPre(body, message.rawResult);
      } else if (card === 'search') {
        if (view.shape === 'paths') appendItems(body, array(view.paths), (container, pathValue) => {
          const filePath = string(pathValue); const row = node('div', 'source'); if (filePath) row.append(fileButton(filePath, undefined, filePath)); container.append(row);
        });
        if (view.shape === 'matches') {
          const matches = [];
          for (const fileValue of array(view.files)) {
            const file = record(fileValue); if (!file) continue; const filePath = string(file.path);
            matches.push({ kind: 'file', path: filePath });
            for (const matchValue of array(file.matches)) matches.push({ kind: 'match', path: filePath, value: matchValue });
          }
          appendItems(body, matches, (container, entry) => {
            if (entry.kind === 'file') { const title = node('div', 'result-title'); if (entry.path) title.append(fileButton(entry.path, undefined, entry.path)); container.append(title); return; }
            const match = record(entry.value); if (!match) return; const line = Number(match.lineNumber) || undefined; const row = node('div', 'source');
            if (entry.path) row.append(fileButton(entry.path, line, String(match.lineNumber) + ': ' + string(match.line))); container.append(row);
          });
        }
        if (view.truncated === true) body.append(node('div', '', '仅显示部分结果（共 ' + String(view.total || '') + ' 条）。'));
      } else if (card === 'web') {
        if (typeof view.answer === 'string') {
          if (view.plainText === true) body.append(node('div', 'streaming-plain', view.answer));
          else appendMarkdownPage(body, view.answer);
        }
        appendItems(body, array(view.sources), (container, sourceValue) => { const source = record(sourceValue); if (source && typeof source.url === 'string') container.append(link(source.url, string(source.title) || source.url)); });
        if (typeof view.url === 'string') body.append(link(view.url, view.url));
      } else {
        const presented = contentText(view && view.content);
        const raw = presented || message.rawResult || message.rawInput || (view && view.rawInput !== undefined ? view.rawInput : '');
        if (raw) appendPre(body, typeof raw === 'string' && raw.length > toolOutputChunkSize ? raw : pretty(raw));
        for (const locationValue of array(callView && callView.locations)) {
          const location = record(locationValue); if (!location) continue; const filePath = string(location.path); const line = Number(location.line) || undefined; const row = node('div', 'source');
          if (filePath) row.append(fileButton(filePath, line, filePath + (line ? ':' + String(line) : ''))); body.append(row);
        }
      }
      renderImageCards(body, message.images);
      return body;
    }
    function cancelDeferredRequest(messageId) {
      const request = loadingToolRequests.get(messageId);
      if (request) clearTimeout(request.timer);
      loadingToolRequests.delete(messageId);
    }
    function resetDeferredOutput(messageId) {
      cancelDeferredRequest(messageId); toolOutputPages.delete(messageId); toolOutputErrors.delete(messageId); deferredOutputViews.delete(messageId);
    }
    function prepareDeferredOutput(message) {
      const loaded = toolOutputPages.get(message.id);
      if (loaded && loaded.revision !== message.deferredBodyRevision) resetDeferredOutput(message.id);
    }
    function appendDeferredPage(parent, page, renderPage) {
      const rendered = renderPage(page);
      const continuation = rendered.querySelector('pre[data-diff-continuation="true"]');
      if (continuation) {
        const selector = continuation.classList.contains('diff-old') ? 'pre.diff-old' : 'pre.diff-new';
        const candidates = parent.querySelectorAll(selector);
        const target = candidates[candidates.length - 1];
        if (target) { target.textContent += continuation.textContent; return; }
      }
      parent.append(rendered);
    }
    function attachDeferredOutput(message, parent, renderPage, autoLoad, initialLabel) {
      prepareDeferredOutput(message);
      const pages = node('div'); const controls = node('div'); parent.append(pages, controls);
      const loaded = toolOutputPages.get(message.id) || { pages: [], nextCursor: undefined, revision: message.deferredBodyRevision };
      toolOutputPages.set(message.id, loaded);
      for (const page of loaded.pages) appendDeferredPage(pages, page, renderPage);
      function load(cursor) {
        if (loadingToolRequests.has(message.id)) return;
        const requestId = ++toolOutputRequestId;
        const timer = setTimeout(() => {
          const pending = loadingToolRequests.get(message.id);
          if (!pending || pending.requestId !== requestId) return;
          loadingToolRequests.delete(message.id); toolOutputErrors.set(message.id, { message: '输出加载超时。', cursor }); controller.renderControls();
        }, 15000);
        loadingToolRequests.set(message.id, { requestId, cursor, timer }); toolOutputErrors.delete(message.id); controller.renderControls();
        vscode.postMessage({ type: 'load-tool-output', messageId: message.id, sessionId: state && state.sessionId, requestId, ...(cursor ? { cursor } : {}) });
      }
      const controller = {
        revision: message.deferredBodyRevision,
        append(page, nextCursor) {
          appendDeferredPage(pages, page, renderPage); loaded.pages.push(page); loaded.nextCursor = nextCursor; controller.renderControls();
        },
        renderControls() {
          controls.replaceChildren();
          const error = toolOutputErrors.get(message.id);
          if (error) {
            controls.append(node('div', 'status error', error.message));
            const retry = node('button', 'tool-output-more', '重试'); retry.type = 'button'; retry.addEventListener('click', () => load(error.cursor)); controls.append(retry); return;
          }
          if (loadingToolRequests.has(message.id)) { controls.append(node('div', 'tool-output-loading', '正在加载输出…')); return; }
          if (loaded.pages.length === 0) {
            if (autoLoad !== false) load(undefined);
            else {
              const show = node('button', 'tool-output-more', initialLabel || '显示输出'); show.type = 'button'; show.addEventListener('click', () => load(undefined)); controls.append(show);
            }
            return;
          }
          if (loaded.nextCursor) {
            const more = node('button', 'tool-output-more', '显示更多'); more.type = 'button'; more.addEventListener('click', () => load(loaded.nextCursor)); controls.append(more);
          }
        },
      };
      deferredOutputViews.set(message.id, controller); controller.renderControls();
    }
    /* 0.0.131（用户反馈⑤）：ask_user_question → 问答记录卡——"我选了什么"必须看得见；
       解析失败/结果未到（等待回答）回落原生工具卡。 */
    function renderAskRecord(message, ask, waiting) {
      const box = node('section', 'ask-record');
      if (typeof message.id === 'string' && message.id !== '') box.dataset.mid = message.id;
      /* 0.1.11：留痕卡/决定卡带事件 seq——回答停点后"末段立即结束"判据需要（此前真机实证两卡无 seq，
         折叠条因此会在"答完审批→agent 产出下一条"之间反复消失/重现，用户实测"agent 产生一条，折叠加一条"）。 */
      if (typeof message.seq === 'number' && Number.isFinite(message.seq)) box.dataset.seq = String(message.seq);
      const head = node('div', 'record-head');
      head.append(node('span', 'record-title', '提问'));
      head.append(node('span', 'record-summary', waiting ? '等待回答…' : ('已回答 ' + String(ask.answered) + '/' + String(ask.total))));
      if (typeof message.time === 'number') head.append(node('span', 'record-time', formatMessageClock(message.time)));
      box.append(head);
      for (const question of ask.questions) {
        const row = node('div', 'ask-record-item');
        row.append(node('div', 'ask-record-question', question.question));
        const answers = node('div', 'ask-record-answers');
        if (question.answers.length === 0) answers.append(node('span', 'ask-record-skipped', waiting ? '—' : '已跳过'));
        else for (const answer of question.answers) answers.append(node('span', 'ask-record-answer', answer));
        row.append(answers); box.append(row);
      }
      return box;
    }
    /* 0.0.131（用户反馈⑤）：审批决定记录（extension 投影产出 role:'decision'）——会话流内留痕。 */
    function renderDecision(message) {
      const box = node('div', 'decision-card' + (message.failed === true ? ' rejected' : ''));
      if (typeof message.id === 'string' && message.id !== '') box.dataset.mid = message.id;
      /* 0.1.11：同 ask-record——决定卡带 seq，供"回答停点后末段立即结束"判据（见 applyWorkSegmentFold）。 */
      if (typeof message.seq === 'number' && Number.isFinite(message.seq)) box.dataset.seq = String(message.seq);
      const head = node('div', 'record-head');
      head.append(node('span', 'record-title', (message.failed === true ? '⛔ ' : '✔ ') + String(message.text || '审批')));
      if (typeof message.time === 'number') head.append(node('span', 'record-time', formatMessageClock(message.time)));
      box.append(head);
      if (message.detail) box.append(node('div', 'decision-reason', String(message.detail)));
      return box;
    }
    /* T2（2026-09-25 工具卡瘦身）：**折叠段里的工具卡通体懒建**——先建"壳"（details 骨架 + data-mid/seq），
       summary/标题/详情等"卡面"与正文，等它真的会显示时（段展开 / 尾段可见 / 搜索跳转命中）再补建。
       依据：全量 6,994 节点里 1,645 张卡**全部**位于折叠段内（零高、不参与排版）⇒ 壳期零观感差；
       开关沿用 ui.lazyFoldedBodies（与 D3 同源，开关变化走整会话重建 ⇒ 壳不会残留）。
       判据见 _temp/dsh_迁移计划/2026-09-24_工具卡瘦身_立项调研.md。 */
    let lazyToolCards = new Map();   /* 当前 DOM 的 mid -> message；随会话 DOM 缓存转移 */
    function shouldLazyTool(message) {
      if (!lazyBodiesEnabledNow()) return false;
      if (message === undefined || message === null) return false;
      if (message.role !== 'tool') return false;
      /* 提问留痕卡=输入记录，永不折叠（F3）⇒ 必须真建（也是 g96/g101 的结构依赖）。 */
      if (message.text === 'ask_user_question') return false;
      if (message.streaming === true || message.failed === true) return false;
      /* 有按需正文的卡：正文本就懒，卡面留着（体积可忽略，且其"显示完整回复"入口在卡面上）。 */
      if (message.deferredBody === true) return false;
      const id = typeof message.id === 'string' ? message.id : '';
      if (id === '' || lazyEagerIds.has(id)) return false;   /* 末尾豁免窗口同 D3（实时尾部不留壳） */
      return true;
    }
    function renderTool(message) {
      if (message.text === 'ask_user_question') {
        const ask = parseAskRecord(message.rawInput, message.rawResult);
        if (ask !== undefined) return renderAskRecord(message, ask, message.streaming === true);
      }
      const item = document.createElement('details');
      item.className = 'tool' + (message.failed ? ' failed' : '');
      /* G39 v2：工具卡也挂消息 id（滚动锚点恢复与展开记忆按 id 定位）。 */
      if (typeof message.id === 'string' && message.id !== '') item.dataset.mid = message.id;
      /* G49 v2（0.0.121）：事件 seq 落 DOM——工作段停点切段与轨道『加载穿透』定位都按它对齐。 */
      if (typeof message.seq === 'number' && Number.isFinite(message.seq)) item.dataset.seq = String(message.seq);
      if (shouldLazyTool(message)) {
        lazyToolCards.set(message.id, message);
        item.dataset.toolBuilt = '0';
        return item;
      }
      /* 同 id 被**正常重建**（内容变化 / 移出末尾豁免窗口）时清掉待建登记——与 lazyBodies 同款守卫，
         否则后续 ensureToolCard 会拿旧快照把已建好的卡面再补一遍。 */
      if (typeof message.id === 'string' && message.id !== '') lazyToolCards.delete(message.id);
      buildToolCard(item, message);
      return item;
    }
    /* 壳 → 真卡（可见补建 / 段展开 / 搜索跳转命中时调用）。只往既有 details 里补，不换节点。 */
    function ensureToolCard(el) {
      if (el === null || el === undefined || el.dataset === undefined) return false;
      const id = String(el.dataset.mid || '');
      const pending = id === '' ? undefined : lazyToolCards.get(id);
      if (pending === undefined) return false;
      lazyToolCards.delete(id);
      delete el.dataset.toolBuilt;
      buildToolCard(el, pending);
      return true;
    }
    /* 卡体补建（壳 → 真卡）：**只往既有 details 里补**，不换节点——renderedMessages 的 node 引用不失效。 */
    function buildToolCard(item, message) {
      const callView = record(message.callView);
      const resultView = record(message.resultView);
      const live = message.streaming === true;
      /* G39：展开记忆对"已完成"卡片同样生效（原 has&&live 条件让完成卡重建即折叠 → 切会话丢展开态）。 */
      item.open = live || message.failed === true || expandedToolIds.has(message.id);
      const summary = document.createElement('summary');
      summary.append(node('span', 'tool-icon' + (message.streaming ? ' live' : ''), message.streaming ? '' : (message.failed ? '!' : '✓')));
      summary.append(node('span', 'tool-title', toolTitle(message, callView, resultView)));
      summary.append(node('span', 'tool-detail', message.detail || ''));
      item.append(summary);
      let contentInitialized = false;
      const initializeContent = () => {
        if (contentInitialized) return;
        contentInitialized = true;
        if (message.deferredBody === true) {
          const body = node('div', 'tool-body'); item.append(attachToolCopy(body, item)); attachDeferredOutput(message, body, page => renderToolBody(page, record(page.callView), record(page.resultView)));
        } else item.append(attachToolCopy(renderToolBody(message, callView, resultView), item));
      };
      if (item.open) initializeContent();
      /* 0.0.108（回归修复①）：程序化设置 open（创建期展开流式卡/按记忆重建）同样会触发原生
         toggle 事件——原实现把它当用户意图写入 expandedToolIds，导致流式卡创建即"被记住展开"，
         结算重建后永不折叠。只有经由 summary 点击（用户操作）的 toggle 才写记忆。 */
      let userToggle = false;
      summary.addEventListener('click', () => { userToggle = true; });
      item.addEventListener('toggle', () => {
        if (!userToggle) { if (item.open) initializeContent(); return; }
        userToggle = false;
        if (item.open) { expandedToolIds.add(message.id); initializeContent(); }
        else expandedToolIds.delete(message.id);
        /* G39：展开态变化入记忆（同指针对应的会话）→ 去抖持久化。 */
        if (viewMemoryCfg().expand && typeof renderedSessionId === 'string') scheduleViewStatePersist(renderedSessionId);
      });
    }
    function renderCommand(message) {
      const item = node('div', 'command-card' + (message.failed ? ' failed' : ''));
      if (typeof message.id === 'string' && message.id !== '') item.dataset.mid = message.id;
      /* G49 v2（0.0.121）：事件 seq 落 DOM——工作段停点切段与轨道『加载穿透』定位都按它对齐。 */
      if (typeof message.seq === 'number' && Number.isFinite(message.seq)) item.dataset.seq = String(message.seq);
      const head = node('div', 'command-head');
      head.append(node('span', 'tool-icon' + (message.streaming ? ' live' : ''), message.streaming ? '' : (message.failed ? '!' : '✓')));
      head.append(node('span', 'command-name', message.text));
      head.append(node('span', 'tool-detail', message.detail || ''));
      item.append(head);
      if (message.deferredBody === true) {
        const result = node('div', 'command-result'); item.append(result); attachDeferredOutput(message, result, page => renderToolBody(page, record(page.callView), record(page.resultView)), false, '显示命令输出'); attachToolCopy(result, item);
      } else if (message.rawResult) { const result = node('div', 'command-result'); appendPre(result, message.rawResult); item.append(attachToolCopy(result, item)); }
      return item;
    }
    /* 0.0.108（用户补充①）：变更文件块过长自动折叠——超阈值（fold.changedFilesLines，默认 6 行）
       先显示前 N 个文件行，其余行与"整体被藏"的轮次标题隐藏；手动展开/收起按内容哈希入会话
       折叠记忆（renderedTail 重建后保持）。判定按"文件行数"（等高语义单位）——与用户消息的
       像素高度判定原理相同、判据不同。 */
    function changedFilesFoldKey(groups) {
      let hash = 5381;
      for (const group of groups) {
        hash = ((hash * 33) ^ (Number(group.turn) || 0)) >>> 0;
        for (const file of group.files || []) {
          const path = String(file.path || '');
          for (let i = 0; i < path.length; i += 1) hash = ((hash * 33) ^ path.charCodeAt(i)) >>> 0;
        }
      }
      return 'cf:' + hash.toString(36);
    }
    function renderChangedFiles(groups) {
      const box = node('section', 'changed-files'); const head = node('div', 'changed-files-head');
      head.append(node('span', 'changed-files-title', '变更文件'));
      const allFiles = groups.flatMap(group => group.files || []); const allRevertible = allFiles.length > 0 && allFiles.every(file => file.canRevert === true);
      const actions = node('div', 'changed-files-actions');
      const reviewAll = node('button', 'changed-action', '全部打开'); reviewAll.type = 'button'; reviewAll.addEventListener('click', () => vscode.postMessage({ type: 'review-all' })); actions.append(reviewAll);
      const keepAll = node('button', 'changed-action', '全部保留'); keepAll.type = 'button'; keepAll.addEventListener('click', () => vscode.postMessage({ type: 'keep-all' })); actions.append(keepAll);
      const revertAll = node('button', 'changed-action danger', '全部回退'); revertAll.type = 'button'; revertAll.disabled = !allRevertible; if (!allRevertible) revertAll.title = '部分文件的完整快照不可用'; revertAll.addEventListener('click', () => vscode.postMessage({ type: 'revert-all' })); actions.append(revertAll); head.append(actions); box.append(head);
      const foldCfgNow = foldCfg();
      const foldKey = changedFilesFoldKey(groups);
      const foldable = foldCfgNow.changedFilesEnabled && allFiles.length > foldCfgNow.changedFilesLines;
      const memoFold = viewMemoryCfg().fold && typeof renderedSessionId === 'string' ? viewMemoOf(renderedSessionId).folds.get(foldKey) : undefined;
      let foldedNow = memoFold === 'folded' || (memoFold === undefined && foldable);
      for (const group of groups) {
        const section = node('div', 'changed-turn'); section.append(node('div', 'changed-turn-title', group.turn > 0 ? '第 ' + String(group.turn) + ' 轮' : '更早的变更'));
        for (const file of group.files || []) {
          const row = node('div', 'changed-file'); row.append(fileButton(file.path, undefined, file.path));
          const stats = node('span', 'changed-file-stats'); stats.append(node('span', 'change-additions', '+' + String(file.additions || 0)), node('span', 'change-deletions', '−' + String(file.deletions || 0))); row.append(stats);
          const fileActions = node('div', 'changed-file-actions');
          const review = node('button', 'changed-action', '查看差异'); review.type = 'button'; review.addEventListener('click', () => vscode.postMessage({ type: 'review-file', path: file.path, turn: group.turn })); fileActions.append(review);
          const keep = node('button', 'changed-action', '保留'); keep.type = 'button'; keep.addEventListener('click', () => vscode.postMessage({ type: 'keep-file', path: file.path, turn: group.turn })); fileActions.append(keep);
          const revert = node('button', 'changed-action danger', '回退'); revert.type = 'button'; revert.disabled = file.canRevert !== true; if (revert.disabled) revert.title = '重载会话后完整快照不可用'; revert.addEventListener('click', () => vscode.postMessage({ type: 'revert-file', path: file.path, turn: group.turn })); fileActions.append(revert); row.append(fileActions); section.append(row);
        }
        box.append(section);
      }
      const applyFold = (folded) => {
        let index = 0;
        for (const row of box.querySelectorAll('.changed-file')) {
          row.hidden = folded && index >= foldCfgNow.changedFilesLines;
          index += 1;
        }
        for (const section of box.querySelectorAll('.changed-turn')) {
          const rows = section.querySelectorAll('.changed-file');
          section.hidden = folded && rows.length > 0 && Array.prototype.every.call(rows, row => row.hidden === true);
        }
      };
      if (foldable) {
        const more = node('button', 'changed-files-more'); more.type = 'button';
        const refresh = () => {
          more.textContent = foldedNow ? ('展开其余 ' + String(Math.max(0, allFiles.length - foldCfgNow.changedFilesLines)) + ' 个文件') : '收起';
          more.setAttribute('aria-expanded', foldedNow ? 'false' : 'true');
        };
        more.addEventListener('click', () => {
          if (selectionDragEnded()) return;
          foldedNow = !foldedNow;
          applyFold(foldedNow); refresh();
          if (viewMemoryCfg().fold && typeof renderedSessionId === 'string') {
            viewMemoOf(renderedSessionId).folds.set(foldKey, foldedNow ? 'folded' : 'expanded');
            scheduleViewStatePersist(renderedSessionId);
          }
        });
        applyFold(foldedNow); refresh(); box.append(more);
      }
      return box;
    }
    function renderPendingSteering(item) {
      const bubble = node('article', 'message user pending-steering');
      const body = node('div', 'message-body', item.preview || '引导消息');
      bubble.append(body); return bubble;
    }
    function renderAssistantPage(page) {
      const view = record(page.resultView);
      const body = view && view.plainText === true ? node('div', 'streaming-plain', page.text) : renderMarkdown(page.text);
      body.classList.add('assistant-page'); renderImageCards(body, page.images); return body;
    }
    /* 折叠内容按需构建（D3，0.1.44 在 0.1.33 基线上重引入）：默认折叠的"过程"内容（display:none）
       本不参与排版，却在装载时照建 markdown/DOM。折叠判定只读结构事实（class/data-seq/dataset.mid/
       折叠条），不需要正文 ⇒ 先建外壳、跑折叠、再只给"可见的"消息补正文；折叠内的正文等展开时再建。
       台架验收（0.1.41 时代，五判据全绿）：首屏构建 211→53ms、单次展开 1ms、DOM 节点 −19%、
       全展开后与一次建好逐值等价。开关 ui.lazyFoldedBodies（默认开，可关：关掉即整会话重建为全量）。 */
    const LAZY_FOLDED_BODIES_ENABLED = true;
    const LAZY_TAIL_KEEP = 8;              /* 末尾 N 条始终照常构建（实时尾部豁免） */
    let lazyBodies = new Map();          /* 当前 DOM 的 id -> message；不持有已淘汰会话 */
    let lazyEagerIds = new Set();          /* 末尾 N 条的 id：不懒建 */
    function lazyBodiesEnabledNow() {
      const ui = state === undefined || state === null ? undefined : state.uiSettings;
      if (ui !== undefined && ui !== null && typeof ui.lazyFoldedBodies === 'boolean') return ui.lazyFoldedBodies;
      return LAZY_FOLDED_BODIES_ENABLED === true;
    }
    function recomputeLazyEagerIds(current) {
      const list = array(current && current.messages);
      lazyEagerIds = new Set(list.slice(Math.max(0, list.length - LAZY_TAIL_KEEP)).map(m => m && m.id).filter(id => typeof id === 'string'));
    }
    function shouldLazyBody(message) {
      if (!lazyBodiesEnabledNow()) return false;
      if (message === undefined || message === null) return false;
      if (message.role !== 'assistant') return false;
      if (message.streaming === true || message.deferredBody === true) return false;
      if (typeof message.id !== 'string' || message.id === '' || lazyEagerIds.has(message.id)) return false;
      return true;
    }
    /* 按需补建正文（展开折叠 / 搜索结果跳转 / 可见补建时调用）。返回是否真的补建了。 */
    function ensureMessageBody(articleEl) {
      if (articleEl === null || articleEl === undefined) return false;
      const id = articleEl.dataset === undefined ? '' : String(articleEl.dataset.mid || '');
      const pending = id === '' ? undefined : lazyBodies.get(id);
      if (pending === undefined) {
        if (lazyMissLogged < 5) { lazyMissLogged += 1; diagLoad('lazy-miss-body', { id: String(id).slice(0, 24), cls: String(articleEl.className || '').slice(0, 32), lazyBody: articleEl.querySelector('.lazy-body') === null ? 0 : 1, bodyBuilt: String(articleEl.dataset === undefined ? '' : articleEl.dataset.bodyBuilt) }); }
        return false;
      }
      if (articleEl.dataset !== undefined) delete articleEl.dataset.bodyBuilt;
      lazyBodies.delete(id);
      const body = articleEl.querySelector('.message-body');
      if (body === null) return false;
      /* **替换**外壳体（而不是往里塞）——否则比"一次建好"多套一层 div（实测每体 +1 节点）。 */
      const real = renderMarkdown(pending.text, pending.id);
      real.classList.add('message-body');
      if (pending.streaming === true) real.classList.add('streaming');
      renderImageCards(real, pending.images);
      renderFileCards(real, pending.files);
      body.replaceWith(real);
      articleEl.dataset.bodyBuilt = '1';
      return true;
    }
    function renderMessage(message) {
      if (message.role === 'tool') return { message, node: renderTool(message) };
      if (message.role === 'decision') return { message, node: renderDecision(message) };
      if (message.role === 'command') return { message, node: renderCommand(message) };
      if (message.role === 'notice') { const notice = node('div', 'status notice' + (message.failed ? ' error' : '')); notice.append(node('span', 'notice-icon', message.failed ? '⚠' : 'ℹ'), node('span', 'notice-text', String(message.text || ''))); if (typeof message.id === 'string' && message.id !== '') notice.dataset.mid = message.id; return { message, node: notice }; }
      const item = node('article', 'message ' + message.role);
      /* G39：消息 id 挂到 DOM——折叠记忆按 id 存取（手动展开态跨会话切换保持）。 */
      if (typeof message.id === 'string' && message.id !== '') item.dataset.mid = message.id;
      /* G49 v2（0.0.121）：事件 seq 落 DOM——工作段停点切段与轨道『加载穿透』定位都按它对齐。 */
      if (typeof message.seq === 'number' && Number.isFinite(message.seq)) item.dataset.seq = String(message.seq);
      const head = node('div', 'message-head');
      head.append(node('span', 'avatar' + (message.role === 'assistant' ? ' deepseek-mark' : ''), message.role === 'user' ? 'Y' : ''));
      head.append(node('span', '', message.role === 'user' ? '你' : 'DeepSeek'));
      const lazy = shouldLazyBody(message);
      const markdown = message.role === 'assistant' && message.streaming === true ? createMarkdownStream(message.text) : undefined;
      const body = lazy
        ? node('div', 'lazy-body')   /* 外壳体不带 .markdown（否则补建后会多套一层，与一次建好的结构不等价） */
        : message.role === 'assistant'
          ? message.deferredBody === true ? node('div', 'markdown') : (markdown ? markdown.root : renderMarkdown(message.text, message.id))
          : node('div');
      if (lazy) { if (typeof message.id === 'string') { lazyBodies.set(message.id, message); item.dataset.bodyBuilt = '0'; } }
      /* 同 id 的消息被**正常重建**（内容变化 / 移出末尾豁免窗口）时清掉待建登记——否则后续
         ensureMessageBody 会拿旧快照文本把它已建好的正文再替换回去（内容回退）。 */
      else if (typeof message.id === 'string') lazyBodies.delete(message.id);
      /* G29: 用户文本包 .msg-text（折叠裁切宿主；升级路径按此更新文本） */
      let textEl;
      if (message.role === 'user') { textEl = node('div', 'msg-text', String(message.text || '')); body.append(textEl); }
      body.classList.add('message-body');
      if (message.streaming) body.classList.add('streaming');
      if (!lazy) {
        if (message.deferredBody === true) attachDeferredOutput(message, body, renderAssistantPage, false, '显示完整回复' + (message.bodyLength ? ' · ' + String(message.bodyLength) + ' 字符' : ''));
        else renderImageCards(body, message.images);
        renderFileCards(body, message.files);
      }
      /* G29: 用户气泡外套 .msg-row（[折叠按钮 | 气泡] 行；按钮居左侧空白栏） */
      const row = message.role === 'user' ? node('div', 'msg-row') : undefined;
      if (row) row.append(body);
      item.append(head, row || body);
      mountMessageActions(item, message);
      if (textEl) {
        /* G39：手动折叠记忆优先（按消息 id 命中 → 直接落态并跳过自动判定）；否则走自动折叠标记。 */
        const memoized = viewMemoryCfg().fold && typeof message.id === 'string' ? viewMemoOf(state.sessionId).folds.get(message.id) : undefined;
        if (memoized !== undefined) { textEl.dataset.manual = '1'; setMsgFold(item, textEl, memoized); }
        else markFoldDirty(textEl, messageHasAttachments(item));
      }
      return { message, node: item, ...(markdown ? { markdown } : {}) };
    }
    function messageHasAttachments(article) {
      return !!article.querySelector('.message-images, .message-files');
    }
    function foldCfg() {
      const s = (state && state.foldSettings) || {};
      return {
        enabled: s.enabled !== false,
        previewLines: typeof s.previewLines === 'number' && s.previewLines >= 1 && s.previewLines <= 20 ? s.previewLines : 4,
        triggerRatio: typeof s.triggerRatio === 'number' && s.triggerRatio >= 0.1 && s.triggerRatio <= 3 ? s.triggerRatio : 0.5,
        minFoldExtraLines: typeof s.minFoldExtraLines === 'number' && s.minFoldExtraLines >= 0 && s.minFoldExtraLines <= 50 ? s.minFoldExtraLines : 3,
        minChars: typeof s.minChars === 'number' && s.minChars >= 0 && s.minChars <= 20000 ? s.minChars : 100,
        blockMinLines: typeof s.blockMinLines === 'number' && s.blockMinLines >= 1 && s.blockMinLines <= 50 ? s.blockMinLines : 3,
        /* G49（0.0.119）：AI 工作段（过程）自动折叠开关，默认开。 */
        workSegmentsEnabled: s.workSegments !== false,
        /* 0.0.108（用户补充①）：变更文件块过长自动折叠（独立开关 + 行数阈值）。 */
        changedFilesEnabled: s.changedFiles !== false,
        changedFilesLines: typeof s.changedFilesLines === 'number' && s.changedFilesLines >= 1 && s.changedFilesLines <= 50 ? Math.round(s.changedFilesLines) : 6,
      };
    }
    function viewportHeight() { return elements.scroll.clientHeight; }
    let msgFoldScanScheduled = false;
    function scheduleMsgFoldScan() {
      if (msgFoldScanScheduled) return;
      msgFoldScanScheduled = true;
      requestAnimationFrame(() => { msgFoldScanScheduled = false; applyPendingMsgFolds(); });
    }
    /* 只打标不测量：渲染/升级/视口变化时标记，流式帧零 scrollHeight 读取。
       hasAttachments=true 放行 minChars 门槛（附件撑高的消息文本可能很短）。
       0.1.21：待测元素进 Set 直接持有——原实现每帧全树扫 querySelectorAll('.msg-text')
       （真机 4.9 万节点实测占流式帧 CPU 采样 ~19%），打标者本来就知道是哪个元素。 */
    const pendingFoldDirty = new Set();
    let msgFoldLinesWritten;
    function markFoldDirty(textEl, hasAttachments) {
      if (!textEl || textEl.dataset.manual === '1') return;
      if (!hasAttachments && (textEl.textContent || '').length < foldCfg().minChars) return;
      textEl.dataset.foldDirty = '1';
      pendingFoldDirty.add(textEl);
      scheduleMsgFoldScan();
    }
    function applyPendingMsgFolds() {
      const cfg = foldCfg();
      if (!cfg.enabled) { pendingFoldDirty.clear(); return; }
      /* 0.1.21：只在值真变时写 body 变量——写 body 上的继承型自定义属性会让引用它的 .msg-text 全部样式失效（每帧一次 = 白烧一次样式重算）。 */
      if (msgFoldLinesWritten !== cfg.previewLines) {
        msgFoldLinesWritten = cfg.previewLines;
        document.body.style.setProperty('--msg-fold-lines', String(cfg.previewLines));
      }
      const dirty = [];
      for (const textEl of pendingFoldDirty) {
        if (textEl.dataset.foldDirty !== '1') continue;
        textEl.dataset.foldDirty = '';
        if (textEl.dataset.manual === '1') continue;
        /* 元素可能已随重渲染被摘掉（不在文档里）→ 跳过。 */
        if (!elements.messages.contains(textEl)) continue;
        const article = textEl.closest('.message.user');
        if (!article) continue;
        dirty.push({ textEl, article });
      }
      pendingFoldDirty.clear();
      if (!dirty.length) return;
      /* 两遍测量（同帧、无中间绘制）：先复位折叠态量完整高度。折叠态量不到真值
         （文本被裁 + 附件已紧凑），且判定须与当前状态无关（防抖振）。 */
      for (const d of dirty) d.article.classList.remove('msg-folded');
      for (const d of dirty) {
        d.full = d.article.querySelector('.message-body').offsetHeight;
        d.lineHeight = parseFloat(getComputedStyle(d.textEl).lineHeight) || 21.45;
      }
      const viewport = viewportHeight();
      for (const d of dirty) {
        /* 触发阈值 = 视口一半；保底 max(...) 取"至少省 minFoldExtraLines 行"，防小视口折了等于没折 */
        const threshold = Math.max(viewport * cfg.triggerRatio, d.lineHeight * (cfg.previewLines + cfg.minFoldExtraLines));
        setMsgFold(d.article, d.textEl, d.full > threshold ? 'folded' : 'plain');
      }
    }
    /* 三态：folded=裁切+按钮「展开」；expanded=不裁切+按钮「收起」；plain=不裁切+无按钮 */
    function setMsgFold(article, textEl, state) {
      article.classList.toggle('msg-folded', state === 'folded');
      const existing = article.querySelector('.msg-fold-toggle');
      if (state === 'plain') { if (existing) existing.remove(); return; }
      const btn = existing || createFoldToggle(article, textEl);
      ensureFoldTogglePlaced(article, btn);
      const folded = state === 'folded';
      btn.innerHTML = '<span class="fold-label">' + (folded ? '展开' : '收起') + '</span>' + (folded ? CHEVRON_DOWN_SVG : CHEVRON_UP_SVG);
      btn.title = folded ? '展开完整消息' : '收起消息';
      btn.setAttribute('aria-expanded', folded ? 'false' : 'true');
    }
    function createFoldToggle(article, textEl) {
      const btn = node('button', 'msg-fold-toggle');
      btn.type = 'button';
      btn.addEventListener('click', () => {
        /* 拖选守卫（2026-09-24 改为手势判定）：拖选的收尾不触发折叠；已有选区时的单击照常生效。 */
        if (selectionDragEnded()) return;
        textEl.dataset.manual = '1';
        const collapsing = !article.classList.contains('msg-folded');
        setMsgFold(article, textEl, collapsing ? 'folded' : 'expanded');
        /* G39：手动折叠态入记忆表 + 去抖持久化（开关关闭时维持旧行为：切回按自动规则）。 */
        const mid = article.dataset.mid;
        if (viewMemoryCfg().fold && typeof renderedSessionId === 'string' && typeof mid === 'string' && mid !== '') {
          viewMemoOf(renderedSessionId).folds.set(mid, collapsing ? 'folded' : 'expanded');
          scheduleViewStatePersist(renderedSessionId);
        }
        /* 收起后内容骤缩，消息可能整体滚出视口上方 → nearest 最小滚动使其可见（展开时不滚） */
        if (collapsing && typeof article.scrollIntoView === 'function') article.scrollIntoView({ block: 'nearest' });
      });
      return btn;
    }
    /* 按钮固定为 .msg-row 首元素（气泡左侧空白栏）；prepend 幂等（附件在 body 内、不进 row） */
    function ensureFoldTogglePlaced(article, btn) {
      const row = article.querySelector('.msg-row');
      if (row && row.firstElementChild !== btn) row.prepend(btn);
    }
    /* 视口尺寸变化（面板拖拽/窗口缩放）→ 全量重评估；observer 回调按帧合并，无需额外 debounce */
    function markAllFoldsDirty() {
      for (const textEl of elements.messages.querySelectorAll('.msg-text')) {
        const article = textEl.closest('.message.user');
        if (article) markFoldDirty(textEl, messageHasAttachments(article));
      }
    }
    /* G5: 消息尾部 IconActions 行——user=时间·复制；assistant=复制·时钟药丸·时间（仿官方 clock:'start'/'end'） */
    const CLOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
    function renderCopyAction(message) {
      return copyButton(() => message.text, '复制消息');
    }
    function renderClockPill(meta) {
      if (!meta) return undefined;
      const hasDuration = typeof meta.durationMs === 'number' && meta.durationMs > 0;
      const parts = [];
      if (hasDuration) parts.push('用时 ' + formatRunDuration(meta.durationMs));
      if (typeof meta.firstTokenMs === 'number') parts.push('首 token ' + formatLatencySeconds(meta.firstTokenMs) + '秒');
      if (typeof meta.tokS === 'number') parts.push(formatTokensPerSecond(meta.tokS) + ' tok/s');
      if (parts.length === 0) return undefined;
      const pill = node('span', 'msg-clock');
      const primary = hasDuration ? formatRunDuration(meta.durationMs) : formatTokensPerSecond(meta.tokS) + ' tok/s';
      pill.innerHTML = CLOCK_SVG + '<span>' + primary + '</span>';
      pill.append(node('span', 'msg-clock-panel', parts.join(' · ')));
      return pill;
    }
    /* 0.0.167（B4 P2）：消息尾行「…」——把只藏在右键里的操作（复制/分叉/回退）摆到明面。 */
    const MORE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';
    function renderMessageMenuAction(message) {
      const btn = node('button', 'msg-action msg-action-more');
      btn.type = 'button';
      btn.title = '更多操作（复制 / 分叉 / 回退）';
      btn.setAttribute('aria-label', '更多操作');
      btn.innerHTML = MORE_SVG;
      btn.addEventListener('click', (event) => {
        /* 关键：document 级 click 监听会关菜单（line ~7110 的 closeCtxMenu）——
           不拦下这次冒泡，刚打开的菜单会在同一次点击里被立刻关掉（探针实证）。 */
        event.stopPropagation();
        const article = btn.closest('article.message');
        const rec = article === null ? undefined : messageForEl(article);
        const live = rec === undefined ? message : rec.message;
        const rect = btn.getBoundingClientRect();
        showCtxMenu(rect.left, rect.bottom + 2, () => messageMenuOptions(live, article === null ? undefined : article));
      });
      return btn;
    }
    function renderMessageActions(message, omitTime) {
      const row = node('div', 'message-actions');
      if (message.role === 'user') {
        if (omitTime !== true && typeof message.time === 'number') row.append(node('span', '', formatMessageClock(message.time)));
        row.append(renderCopyAction(message));
      } else {
        row.append(renderCopyAction(message));
        const clock = renderClockPill(message.meta);
        if (clock) row.append(clock);
        if (omitTime !== true && typeof message.time === 'number') row.append(node('span', '', formatMessageClock(message.time)));
      }
      row.append(renderMessageMenuAction(message));
      return row;
    }
    /* ---- D1（0.1.45 性能）：动作行「悬停浮出」——静止只留时间行（1 文本节点），
       复制/时钟/…按钮收进**全篇唯一**的共享工具条、悬停时贴在该消息尾部浮出（绝对定位不占布局）。
       实测（EUV 2261 消息）：构建期节点 18,683 → 13,256（−29%）、reconcile 50 → 25ms；
       稳定节点 −11.1%；悬停浮出 0.7ms、零布局位移。
       开关 ui.hoverActions（默认开）：关 = 回到"常显整行"（整会话重建，见 viewCfgKeyOf）。
       键盘/无 hover 兜底：焦点（键盘）落在消息上时同样浮出；右键菜单出口照旧。
       方案与判据见 _temp/dsh_迁移计划/2026-09-24_D1动作行按需建_方案与判据.md ---- */
    const hoverActionsOn = () => !(state !== undefined && state !== null && state.uiSettings !== undefined && state.uiSettings !== null && state.uiSettings.hoverActions === false);
    /* 键盘意图（Tab 等）与鼠标意图区分：只有前者触发"焦点浮出"，避免点击后工具条粘住。 */
    let keyboardIntent = false;
    document.addEventListener('keydown', () => { keyboardIntent = true; }, true);
    document.addEventListener('mousedown', () => { keyboardIntent = false; }, true);
    function stampTextOf(message) { return typeof message.time === 'number' ? formatMessageClock(message.time) : ''; }
    /* 静止行 = 时间行；时间随后才到（乐观升级/结算帧）时就地补齐。
       时间用 .message-time 定位而非 firstElementChild——同一行里还可能挂着悬停按钮组（.hover-actions）。 */
    function syncActionStamp(articleEl, message) {
      const row = articleEl.querySelector('.message-actions-stamp');
      const wanted = stampTextOf(message);
      const existing = row === null ? null : row.querySelector('.message-time');
      if (wanted === '') { if (existing !== null && existing !== undefined) existing.remove(); return; }
      if (existing !== null && existing !== undefined) { if (existing.textContent !== wanted) existing.textContent = wanted; return; }
      const span = node('span', 'message-time', wanted);
      if (row === null) {
        const fresh = node('div', 'message-actions message-actions-stamp');
        fresh.append(span);
        articleEl.append(fresh);
        return;
      }
      row.prepend(span); /* 时间永远排最前（按钮组在其右侧） */
    }
    function mountMessageActions(articleEl, message) {
      if (hoverActionsOn()) { syncActionStamp(articleEl, message); return; }
      articleEl.append(renderMessageActions(message));
    }
    /* 共享悬停按钮组（全篇唯一实例；内容每次浮出时重建，**行内接在时间右侧**——0.1.46 修订）。 */
    let hoverActionBar;
    let hoverActionArticle;
    let hoverActionsWired = false;
    function hoverActionBarOf() {
      if (hoverActionBar !== undefined) return hoverActionBar;
      hoverActionBar = node('div', 'hover-actions');
      return hoverActionBar;
    }
    function showHoverActions(article, message) {
      if (hoverActionArticle === article && hoverActionBar !== undefined && hoverActionBar.isConnected === true && article.contains(hoverActionBar)) return;
      let row = article.querySelector('.message-actions');
      if (row === null || row === undefined) {
        /* 无时间行的消息（缺 time 的旧数据）：临时建一行只放按钮，移出时由 hideHoverActions 回收。 */
        row = node('div', 'message-actions message-actions-stamp');
        article.append(row);
      }
      const bar = hoverActionBarOf();
      /* 时间已常显在行内 → 按钮组里省掉时间（按钮语义不变）。 */
      const fresh = renderMessageActions(message, true);
      bar.replaceChildren(...fresh.childNodes);
      const stamp = row.querySelector('.message-time');
      /* 助手行左对齐 ⇒ 按钮接在时间右侧；用户行右对齐 ⇒ 按钮排在时间左侧，
         这样时间始终钉在右缘、悬停时不左右一跳（原常显行也是"按钮在时间右侧"的右对齐形态）。 */
      if (stamp !== null && stamp !== undefined && article.classList.contains('user')) row.insertBefore(bar, stamp);
      else row.append(bar);
      hoverActionArticle = article;
    }
    function hideHoverActions() {
      if (hoverActionArticle === undefined) return;
      const host = hoverActionBar === undefined ? null : hoverActionBar.parentElement;
      hoverActionArticle = undefined;
      if (hoverActionBar !== undefined) hoverActionBar.remove();
      /* 只回收"为放按钮临时建的空行"；有时间行/正文的保持不动。 */
      if (host !== null && host !== undefined && host.classList.contains('message-actions-stamp') && host.children.length === 0) host.remove();
    }
    function hoverArticleOf(target) {
      if (target === null || target === undefined || typeof target.closest !== 'function') return undefined;
      const article = target.closest('article.message');
      return article === null || article === undefined ? undefined : article;
    }
    function wireHoverActions() {
      if (hoverActionsWired) return;
      hoverActionsWired = true;
      elements.messages.addEventListener('mouseover', (event) => {
        const article = hoverArticleOf(event.target);
        if (article === undefined) return;
        const rec = messageForEl(article);
        const message = rec === undefined ? undefined : rec.message;
        if (message === undefined) return;
        showHoverActions(article, message);
      });
      elements.messages.addEventListener('mouseout', (event) => {
        if (hoverActionArticle === undefined) return;
        const related = event.relatedTarget;
        if (related !== null && related !== undefined && typeof hoverActionArticle.contains === 'function' && hoverActionArticle.contains(related)) return;
        hideHoverActions();
      });
      /* 键盘路径：Tab 落到某条消息（tabindex=-1，供辅助工具/程序化聚焦）时同样浮出。 */
      elements.messages.addEventListener('focusin', (event) => {
        if (!keyboardIntent) return;
        const article = hoverArticleOf(event.target);
        if (article === undefined) return;
        const rec = messageForEl(article);
        const message = rec === undefined ? undefined : rec.message;
        if (message === undefined) return;
        showHoverActions(article, message);
      });
    }
    /* 开关翻转（设置台）→ 重建会话 + 重挂/撤掉悬停机制。每轮 render 开头核一次。 */
    /* 0.1.51（CV）：离屏内容跳过排版——开关应用（每轮 render 核一次）。
       类挂在 #messages 上、纯 CSS 生效，切换**不需要重建 DOM**（故不进 viewCfgKeyOf）；
       但排版行为变了 ⇒ 置脏轨道几何，让下一次轨道更新重测。 */
    const messageContainmentOn = () => !(state !== undefined && state !== null && state.uiSettings !== undefined && state.uiSettings !== null && state.uiSettings.messageContainment === false);
    let offscreenSkipApplied;
    function applyOffscreenLayoutMode() {
      const on = messageContainmentOn();
      if (offscreenSkipApplied === on) return;
      offscreenSkipApplied = on;
      elements.messages.classList.toggle('cv-offscreen', on);
      railGeomDirty = true;
    }
    let hoverActionsApplied;
    function applyMessageActionMode() {
      const on = hoverActionsOn();
      if (hoverActionsApplied === on) return;
      hoverActionsApplied = on;
      if (on) { document.body.dataset.hoverActions = 'on'; wireHoverActions(); }
      else { delete document.body.dataset.hoverActions; hideHoverActions(); }
    }
    /* 2026-09-01 闪烁修复: 帧间 message 仅 data 差异 (如 attachment hydration 完成) 时软更新, 避免全重建 */
    function canSoftUpdate(prev, next) {
      if (prev.role !== next.role) return false;
      if ((prev.text || '') !== (next.text || '')) return false;
      if (prev.deferredBodyRevision !== next.deferredBodyRevision) return false;
      /* G5: 尾部行内容变化（时间/结算后 meta 出现）必须重建，否则软更新路径残留旧 actions */
      if (prev.time !== next.time) return false;
      if (prev.meta?.durationMs !== next.meta?.durationMs) return false;
      if (prev.meta?.firstTokenMs !== next.meta?.firstTokenMs) return false;
      if (prev.meta?.tokS !== next.meta?.tokS) return false;
      const a = prev.images || [], b = next.images || [];
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i += 1) {
        if (a[i].id !== b[i].id || a[i].name !== b[i].name || a[i].mediaType !== b[i].mediaType) return false;
      }
      const c = prev.files || [], d = next.files || [];
      if (c.length !== d.length) return false;
      for (let i = 0; i < c.length; i += 1) {
        if (c[i].path !== d[i].path || c[i].name !== d[i].name || c[i].status !== d[i].status) return false;
      }
      /* 0.1.80（用户报③"选完不会立刻显示出选项"）：**工具/命令卡的卡面**完全由这些字段决定，
         旧实现一个都不比 ⇒ 结果帧（rawResult/detail/streaming 变化）走**软更新不重渲卡面** ⇒
         提问留痕卡一直停在"等待回答…"（真机实测：补丁帧后仍是 4 个"—"、0 个选项胶囊，
         只有切会话/重载的全量重建才显示"已回答 4/4"）。工具/命令卡不在流式文本路径上
         （软更新对它们本就只同步图片），重建代价=单卡，不存在闪烁顾虑。 */
      if (prev.role === 'tool' || prev.role === 'command') {
        if ((prev.detail || '') !== (next.detail || '')) return false;
        if (String(prev.rawInput === undefined ? '' : prev.rawInput) !== String(next.rawInput === undefined ? '' : next.rawInput)) return false;
        if (String(prev.rawResult === undefined ? '' : prev.rawResult) !== String(next.rawResult === undefined ? '' : next.rawResult)) return false;
        if ((prev.failed === true) !== (next.failed === true)) return false;
        if ((prev.streaming === true) !== (next.streaming === true)) return false;
        if ((prev.deferredBody === true) !== (next.deferredBody === true)) return false;
        if (toolTitle(prev, record(prev.callView), record(prev.resultView)) !== toolTitle(next, record(next.callView), record(next.resultView))) return false;
      }
      return true;
    }
    function syncImageCards(gallery, images) {
      if (!gallery) return;
      const list = images || [];
      const cards = [...gallery.children];
      for (let i = 0; i < cards.length || i < list.length; i += 1) {
        const card = cards[i], image = list[i];
        if (!card) { gallery.append(renderImageCard(image)); continue; }
        if (!image) { card.remove(); continue; }
        const src = imageSrc(image.mediaType, image.data);
        if (!src) continue; /* data 未就绪: 保留现图, 由后续软更新帧补齐 */
        if (card.classList.contains('image-card-status')) { card.replaceWith(renderImageCard(image)); continue; }
        const img = card.querySelector('img');
        if (!img || img.src === src) continue; /* 同一张图（src 相同）→ 绑定必然一致，零操作（hydration 帧不重解码） */
        /* 0.0.55（反馈③）: src 变了说明该位置换成了另一张图——绑定（预览/复制/另存为/alt/title）必须一起换，
           否则出现"看到的是 A、点开或复制的是 B"（用户实测图片映射错位）。 */
        img.src = src;
        img.alt = string(image.name, img.alt || '图片');
        card.title = '打开预览：' + string(image.name, '图片');
        bindImageCard(card, image);
      }
    }
    /* 0.0.36 fix (bug⑩): 身份字段级 images 比较——projectedMessages 每帧为含图消息重造
       images 数组（引用永不相等），原 === 判断把 hydration 帧误判为消息变更 → 流式消息
       整条重建 + KaTeX 重渲染 → 闪烁。 */
    function sameImagesIdentity(left, right) {
      if (left === right) return true;
      if (!left || !right || left.length !== right.length) return false;
      for (let i = 0; i < left.length; i += 1) {
        const a = left[i], b = right[i];
        if (!a || !b || a.attachmentId !== b.attachmentId || a.mediaType !== b.mediaType || a.name !== b.name) return false;
      }
      return true;
    }
    /* 乐观气泡原地升级: 复用 article/body/gallery/img, 仅清 class 并按需更新文本与 src */
    function upgradeOptimisticEcho(articleEl, message) {
      articleEl.classList.remove('optimistic');
      delete articleEl.dataset.echo;
      /* G49（0.0.119）：升级后补 mid——此前乐观气泡升级永不挂 id，导致锚点恢复与工作段
         折叠记忆对"刚发出的那条"取不到键（滚动锚点同样受益）。 */
      if (typeof message.id === 'string' && message.id !== '') articleEl.dataset.mid = message.id;
      if (typeof message.seq === 'number' && Number.isFinite(message.seq)) articleEl.dataset.seq = String(message.seq);
      const body = articleEl.querySelector('.message-body');
      if (!body) return;
      const text = message.text || '';
      /* G29: 更新目标改 .msg-text（旧逻辑依赖"body 首子节点是文本节点"——包层后首子节点为元素，
         旧写法会 insertBefore 第二条文本 → 回显后文本重复） */
      const textEl = body.querySelector('.msg-text');
      if (textEl && textEl.textContent !== text) textEl.textContent = text;
      syncImageCards(body.querySelector('.message-images'), message.images);
      /* G22: 乐观文件卡以持久数据重渲染（大小/状态修正；注入未命中则移除乐观卡） */
      const fileStrip = body.querySelector('.message-files');
      if (fileStrip) fileStrip.remove();
      renderFileCards(body, message.files);
      /* G5 0.0.39 fix: 乐观气泡初始渲染无 time/meta——原地升级必须补尾部行（否则切会话才出现） */
      syncMessageActions(articleEl, message);
      /* G29: 服务端文本/附件可能与乐观态不同 → 重评估折叠（manual 标记者内部门控跳过） */
      if (textEl) markFoldDirty(textEl, messageHasAttachments(articleEl));
    }
    /* G5: 尾部 IconActions 行同步——软更新路径（乐观升级/流式结算）不重建 article，
       time/meta 首次出现（user 时间、assistant 药丸）必须原位补上 */
    function syncMessageActions(articleEl, message) {
      if (hoverActionsOn()) {
        /* 悬停形态：静止只有时间行；工具条正挂在本条时原地刷新内容（结算帧补上时钟药丸）。 */
        syncActionStamp(articleEl, message);
        if (hoverActionArticle === articleEl && hoverActionBar !== undefined) {
          const freshRow = renderMessageActions(message, true);
          hoverActionBar.replaceChildren(...freshRow.childNodes);
        }
        return;
      }
      const current = articleEl.querySelector('.message-actions');
      const fresh = renderMessageActions(message);
      /* 0.1.6（运行期闪烁）：流式追加路径每帧调用——行内容未变时不得重建（此前 replaceWith 无情
         重建 → 复制/时钟按钮高频换代）。结构相同直接跳过；确实变了才替换。 */
      if (current) {
        if (current.isEqualNode(fresh)) return;
        current.replaceWith(fresh);
      } else articleEl.append(fresh);
    }
    function messageNode(message) {
      const rendered = renderedMessages.get(message.id);
      // Soft and streaming updates reuse DOM, but the authoritative sequence may change.
      if (rendered && rendered.message.seq !== message.seq) {
        if (typeof message.seq === 'number' && Number.isFinite(message.seq)) rendered.node.dataset.seq = String(message.seq);
        else delete rendered.node.dataset.seq;
      }
      if (rendered && !rendered.optimistic && rendered.message === message) return rendered.node;
      if (rendered && rendered.optimistic) {
        /* 2026-09-01 闪烁修复: 乐观气泡原地升级为正式气泡 (节点复用, 不重建) */
        upgradeOptimisticEcho(rendered.node, message);
        renderedMessages.set(message.id, { node: rendered.node, message });
        return rendered.node;
      }
      if (rendered && canSoftUpdate(rendered.message, message)) {
        /* 2026-09-01 闪烁修复: 帧间仅 data 补齐 (hydration 完成), 只同步 img src, 零重建 */
        syncImageCards(rendered.node.querySelector('.message-images'), message.images);
        /* 0.0.36 fix (bug⑩): canSoftUpdate 不比较 streaming——settle 帧（streaming→false）也走
           软更新，流式 class/尾部未提交文本会永久残留；此处清算：提交剩余尾部 + 移除流式态。 */
        if (rendered.message.streaming === true && message.streaming !== true) {
          if (rendered.markdown) {
            appendMarkdownStream(rendered.markdown, '', false);
            rendered.markdown.root.classList.remove('streaming');
          }
          rendered.node.querySelector('.message-body')?.classList.remove('streaming');
        }
        rendered.message = message;
        return rendered.node;
      }
      if (rendered && rendered.message.deferredBodyRevision !== message.deferredBodyRevision) resetDeferredOutput(message.id);
      const appended = pendingMessageAppends.get(message.id);
      if (rendered && rendered.markdown && appended !== undefined && message.role === 'assistant' && sameImagesIdentity(message.images, rendered.message.images)) {
        pendingMessageAppends.delete(message.id); appendMarkdownStream(rendered.markdown, appended, message.streaming === true);
        rendered.message = message;
        rendered.markdown.root.classList.toggle('streaming', message.streaming === true);
        /* A7 fix: .message-body streaming class persists after streaming ends (also caused leftover cursor blink) */
        rendered.node.querySelector('.message-body')?.classList.toggle('streaming', message.streaming === true);
        /* 0.0.36 fix (bug⑩): appended 帧可能同时带 hydration 数据（images 新数组+data），
           补齐 img src 防 "Loading…" 卡住（同步不破坏流式路径）。 */
        syncImageCards(rendered.node.querySelector('.message-images'), message.images);
        /* G5 0.0.39 fix: 结算帧 meta 首次出现（用时/首 token）——append 路径不重建，尾部行原位补 */
        syncMessageActions(rendered.node, message);
        return rendered.node;
      }
      /* 0.1.6（用户实测：运行阶段代码块/公式/表格的复制按钮"一闪一闪"）：只要文本是**单调前缀
         延伸**（流式增长的本质特征），无论上游此刻发的是 append、upsert 还是全量 state（重连
         补发/补丁丢弃后的全量帧/positions 变动触发的 reset——这些路径此前都落到整条重建），
         一律走增量追加：KaTeX/代码块/复制按钮/表格**零重建**。与 0.0.36 bug⑩ 同族（当时的
         误判源是 images 数组身份；本次把闸门改成"内容事实"而非"上游形态"）。 */
      if (rendered && rendered.markdown && message.role === 'assistant' && rendered.message.role === 'assistant'
        && typeof message.text === 'string' && typeof rendered.message.text === 'string'
        && message.text.length > rendered.message.text.length
        && message.text.startsWith(rendered.message.text)
        && message.detail === rendered.message.detail && message.failed === rendered.message.failed
        && message.deferredBody === rendered.message.deferredBody
        && sameImagesIdentity(message.images, rendered.message.images)) {
        const delta = message.text.slice(rendered.message.text.length);
        pendingMessageAppends.delete(message.id);
        appendMarkdownStream(rendered.markdown, delta, message.streaming === true);
        rendered.message = message;
        rendered.markdown.root.classList.toggle('streaming', message.streaming === true);
        rendered.node.querySelector('.message-body')?.classList.toggle('streaming', message.streaming === true);
        syncImageCards(rendered.node.querySelector('.message-images'), message.images);
        syncMessageActions(rendered.node, message);
        /* 0.1.19：列宽冻结已退役（auto 布局 + 遮挡式按钮，悬停零重排）。 */
        return rendered.node;
      }
      if (rendered) deferredOutputViews.delete(message.id);
      pendingMessageAppends.delete(message.id);
      const next = renderMessage(message);
      // reconcileMessages owns node placement. Replacing a connected node here
      // invalidates its cursor before insertBefore can finish reconciling the list.
      renderedMessages.set(message.id, next);
      return next.node;
    }
    function lastUserMessage(messages) {
      for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i].role === 'user') return messages[i];
      return undefined;
    }
    function reclaimOptimisticEchoes(messages) {
      const serverUser = lastUserMessage(messages);
      if (!serverUser || claimedEchoIds.has(serverUser.id)) return;
      if (serverUser.id === lastEchoAnchorId) return;
      const bubbles = elements.messages.querySelectorAll('.optimistic');
      if (!bubbles.length) return;
      const serverText = serverUser.text || '';
      let claim;
      for (const bubble of bubbles) {
        if ((bubble.dataset.echo || '') === serverText) { claim = bubble; break; }
      }
      if (!claim) claim = bubbles[0];
      claimedEchoIds.add(serverUser.id);
      if (claim && claim.dataset.echo === serverText) {
        /* 2026-09-01 闪烁修复: 精确匹配时不清除, 登记现有节点原地升级
           (删除会迫使 reconcile 重建 article/img, img 重解码导致回显闪一下) */
        renderedMessages.set(serverUser.id, { node: claim, message: serverUser, optimistic: true });
      } else {
        claim.remove();
      }
    }
    /* 0.0.37 (批次 2): 单条消息渲染隔离——某条消息渲染抛错不再拖垮整个会话列表
       （此前 scheduleRender 只 catch 整帧：坏消息之后所有消息不渲染 + 每帧重抛，
        bug⑨ 的空白/失效是该结构缺陷的表现之一）。失败条以此占位节点呈现。 */
    const renderFailedIds = new Set();
    function messageFallbackNode(message) {
      const item = node('article', 'message ' + message.role + ' render-failed');
      const head = node('div', 'message-head');
      head.append(node('span', 'avatar' + (message.role === 'assistant' ? ' deepseek-mark' : ''), message.role === 'user' ? 'Y' : ''));
      head.append(node('span', '', message.role === 'user' ? '你' : message.role === 'assistant' ? 'DeepSeek' : message.role === 'tool' ? '工具' : '命令'));
      item.append(head);
      const body = node('div', 'message-body');
      body.append(node('div', 'render-failed-note', '此消息渲染失败，已显示原文：'));
      body.append(node('div', 'streaming-plain', String(message.text || '') + (message.rawResult ? '\\n' + String(message.rawResult) : '')));
      item.append(body);
      return item;
    }
    /* 0.1.31（P1 首屏渐进渲染）：把"逐条建 DOM"拆成「优先片（同步上屏）」+「其余分片补齐」。
       优先片按状态自适应：跟底/运行中/无锚 → 尾部窗口；有恢复锚 → 锚点所在窗口（anchorIndex）。
       每片预算 PROGRESSIVE_SLICE_MS，片间让出主线程（scheduler.yield 优先，回退 setTimeout 0）。
       仅**首屏**启用（容器基本为空且消息数 ≥ 阈值）；其余渲染（含流式）走原路径。 */
    /* 0.1.31：P1 首屏渐进渲染**默认关**（本轮未达验收判据：首屏 ≤300ms 未过——首片之后的
       同步开销尚未定位透；见 _temp/dsh_迁移计划/2026-09-23_首屏渐进加载与位置记忆_方案.md）。
       打开即启用（DOM 等价与顺序已验：603 节点 / 49 条用户消息顺序一致 / 21 片补完）。 */
    const PROGRESSIVE_ENABLED = false;
    const PROGRESSIVE_MIN_MESSAGES = 120;
    const PROGRESSIVE_SLICE_MS = 30;
    /* 0.1.31：每片**节点数上限**——实测 251 条消息 JS 只花 31ms，但它们的布局/绘制要 ~600ms
       （实测首屏 614ms）。所以切片必须按"节点数"约束（≈ 一屏多一点的量），帧成本才可控。 */
    const PROGRESSIVE_SLICE_NODES = 2600;
    function nodeCostOf(el) {
      const count = el.querySelectorAll === undefined ? 0 : el.querySelectorAll('*').length;
      return count + 1;
    }
    let progressiveFill;
    function yieldToMain() {
      const sched = typeof globalThis !== 'undefined' ? globalThis.scheduler : undefined;
      if (sched !== undefined && sched !== null && typeof sched.yield === 'function') return sched.yield();
      return new Promise(resolve => setTimeout(resolve, 0));
    }
    function progressiveWindow(current, messages) {
      const memo = viewMemoOf(current.sessionId);
      const tailFirst = followConversationTail || current.running === true || current.approval !== null || current.question !== null || memo.atBottom === true || typeof memo.anchorIndex !== 'number';
      const center = tailFirst ? messages.length - 1 : Math.min(messages.length - 1, Math.max(0, memo.anchorIndex));
      return { center, tailFirst };
    }
    function startProgressiveFill(current, messages) {
      const container = elements.messages;
      const win = progressiveWindow(current, messages);
      /* 首片按**耗时预算**取（不是固定条数）——这个会话里单条消息就可能是几百 ms 的大输出，
         固定 25 条会让首片超预算、首屏时延失控（实测 443ms）。以中心为原点向两侧铺，超预算即停。 */
      const sliceStarted = performance.now();
      let sliceCost = 0;
      let head = win.center;          /* 向上（越小越早） */
      let tailIdx = win.center + 1;   /* 向下（越大越晚） */
      const firstNode = messageNode(messages[win.center]);
      container.append(firstNode); sliceCost += nodeCostOf(firstNode);
      while (performance.now() - sliceStarted < PROGRESSIVE_SLICE_MS && sliceCost < PROGRESSIVE_SLICE_NODES) {
        if (tailIdx < messages.length) { const n = messageNode(messages[tailIdx]); container.append(n); sliceCost += nodeCostOf(n); tailIdx += 1; }
        if (performance.now() - sliceStarted >= PROGRESSIVE_SLICE_MS || sliceCost >= PROGRESSIVE_SLICE_NODES) break;
        if (head > 0) { const n = messageNode(messages[head - 1]); container.insertBefore(n, container.firstChild); sliceCost += nodeCostOf(n); head -= 1; }
        if (head === 0 && tailIdx >= messages.length) break;
      }
      progressiveFill = { sessionId: current.sessionId, lo: head - 1, hi: tailIdx - 1, total: messages.length, slices: 1 };
      diagLoad('progressive-start', { sessionId: current.sessionId, messages: messages.length, center: win.center, tailFirst: win.tailFirst, firstSliceMs: Math.round(performance.now() - sliceStarted), firstSliceCount: (tailIdx - 1) - (head - 1) });
      const fill = progressiveFill;
      const finish = () => {
        if (progressiveFill !== fill) return;
        progressiveFill = undefined;
        renderedDomSignature = messageIdDigest(messages);
        renderedDomMessageCount = messages.length;
        diagLoad('progressive-done', { sessionId: current.sessionId, nodes: container.querySelectorAll('*').length, messages: container.querySelectorAll('.message').length, slices: fill.slices });
        scheduleViewFocusAnchor();
        try { applyWorkSegmentFold(current); } catch (error) { diagLoad('progressive-fold-error', { message: String(error && error.message ? error.message : error) }); }
        try { updateTurnRail(current); } catch { /* 轨道自愈兜底 */ }
        /* 0.1.102：填充收尾**立刻**再试一次待跳——0.1.101 的延迟解析等"渲染落定"，而收尾帧不推 state，
           只能靠 250ms 轮询兜 ⇒ 落位慢一拍（探针亦偶发"读太早"）。收尾即试，落位与填充无缝衔接。 */
        try { tryPendingSearchJump(); } catch { /* 自愈失败不抛 */ }
      };
      const step = () => {
        if (progressiveFill !== fill) return;
        const started = performance.now();
        let sliceCost = 0;
        while (performance.now() - started < PROGRESSIVE_SLICE_MS && sliceCost < PROGRESSIVE_SLICE_NODES) {
          if (fill.lo >= 0) { const n = messageNode(messages[fill.lo]); container.insertBefore(n, container.firstChild); sliceCost += nodeCostOf(n); fill.lo -= 1; }
          else if (fill.hi < messages.length - 1) { const n = messageNode(messages[fill.hi]); container.append(n); sliceCost += nodeCostOf(n); fill.hi += 1; }
          else { finish(); return; }
        }
        fill.slices += 1;
        yieldToMain().then(step, step);
      };
      yieldToMain().then(step, step);
      return true;
    }
    /* 立即补完（有新的状态推送进来时调用：先把剩余节点同步建完，避免与 reconcile 打架）。 */
    function flushProgressiveFill(current) {
      const fill = progressiveFill;
      progressiveFill = undefined;
      if (fill === undefined) return;
      const messages = array(current.messages);
      const container = elements.messages;
      for (let i = fill.lo; i >= 0; i -= 1) container.insertBefore(messageNode(messages[i]), container.firstChild);
      for (let i = Math.max(fill.hi + 1, 0); i < messages.length; i += 1) container.append(messageNode(messages[i]));
      renderedDomSignature = messageIdDigest(messages);
      renderedDomMessageCount = messages.length;
      scheduleViewFocusAnchor();
      try { applyWorkSegmentFold(current); } catch { /* 与正常路径同兜底 */ }
      diagLoad('progressive-flush', { sessionId: current.sessionId, nodes: container.querySelectorAll('*').length });
    }
    function reconcileMessages(messages, current) {
      if (progressiveFill !== undefined) {
        if (progressiveFill.sessionId !== current.sessionId) progressiveFill = undefined;
        else flushProgressiveFill(current);
      }
      const diagStarted = performance.now();
      let diagFirst = 0;
      reclaimOptimisticEchoes(messages);
      if (!messages.length) {
        renderedMessages.clear();
        lazyBodies.clear(); lazyToolCards.clear();
        const optimistic = [...elements.messages.querySelectorAll('.optimistic')];
        if (optimistic.length === 0) elements.messages.replaceChildren(renderEmpty(current));
        else elements.messages.replaceChildren(...optimistic);
        invalidateWorkFoldCache();
        return;
      }
      const ids = new Set(messages.map(message => message.id));
      for (const [id, rendered] of renderedMessages) {
        if (!ids.has(id)) {
          rendered.node.remove(); renderedMessages.delete(id); expandedToolIds.delete(id); resetDeferredOutput(id); pendingMessageAppends.delete(id);
          /* T2/D3：消息被移除 → 待建登记一并清（防同 id 复现时用旧快照补建）。 */
          lazyToolCards.delete(id); lazyBodies.delete(id);
          /* G39：消息被移除（回退/fork 等）→ 折叠记忆同步清（防同 id 复现时残留旧态）。 */
          if (typeof renderedSessionId === 'string') viewMemo.get(renderedSessionId)?.folds.delete(id);
        }
      }
      let cursor = elements.messages.firstChild;
      for (const message of messages) {
        let desired;
        try {
          desired = messageNode(message);
          renderFailedIds.delete(message.id);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          if (!renderFailedIds.has(message.id)) {
            renderFailedIds.add(message.id);
            vscode.postMessage({ type: 'webview-error', message: 'render-message:' + message.id + ':' + detail });
          }
          renderedMessages.delete(message.id);
          desired = messageFallbackNode(message);
        }
        /* 0.1.24（用户实测"过程折叠条消失了"）：工作段折叠条是**外地节点**（不在 renderedMessages 表里）。
           旧写法把它们当普通兄弟：游标停在条上时会把消息搬到条前面、末尾净化又把条删掉——此前靠
           "折叠每帧全量重建"掩盖着，0.1.21 的签名跳过一上线就暴露（任何一次状态更新后柱全没）。
           现在 reconcile 认得它们：跳过、不搬、不删（条的生命周期归 applyWorkSegmentFold）。 */
        while (cursor !== null && cursor.classList !== undefined && cursor.classList.contains('work-fold-bar')) cursor = cursor.nextSibling;
        if (desired === cursor) cursor = cursor.nextSibling;
        else elements.messages.insertBefore(desired, cursor);
        if (diagFirst === 0) { diagFirst = performance.now(); diagLoad('reconcile-first-node', { sessionId: current.sessionId, messages: messages.length }); }
      }
      while (cursor) {
        const next = cursor.nextSibling;
        const keepBar = cursor.classList !== undefined && cursor.classList.contains('work-fold-bar');
        if (!keepBar && (!cursor.classList || !cursor.classList.contains('optimistic'))) cursor.remove();
        cursor = next;
      }
      diagLoad('reconcile-done', {
        sessionId: current.sessionId, messages: messages.length,
        nodes: elements.messages.querySelectorAll('*').length,
        ms: Math.round(performance.now() - diagStarted),
        firstNodeMs: diagFirst === 0 ? -1 : Math.round(diagFirst - diagStarted),
      });
      lastEchoAnchorId = lastUserMessage(messages)?.id;
    }
    /* 0.0.125：工作段的键（折叠与轨道共用）——段起点消息 id（前导段用首个可见节点 id + ws~: 前缀）。 */
    function workSegmentKey(segment) {
      const startMid = segment.start !== null && segment.start.dataset ? segment.start.dataset.mid : undefined;
      const anchorMid = typeof startMid === 'string' && startMid !== ''
        ? startMid
        : (segment.nodes[0] && segment.nodes[0].dataset ? segment.nodes[0].dataset.mid : undefined);
      if (typeof anchorMid !== 'string' || anchorMid === '') return undefined;
      return (typeof startMid === 'string' && startMid !== '' ? 'ws:' : 'ws~:') + anchorMid;
    }
    /* 0.0.125：段列表（供轨道用）——每次渲染由 applyWorkSegmentFold 重算写入。 */
    let lastWorkSegments = [];
    /* 2026-09-25（用户报"带折叠中的首条命中点不动"的根因修复）：
       **元素 → 所在折叠条** 登记表（每次工作段折叠重算时写入）。
       此前"找折叠条"靠**兄弟链回溯**（遇可见兄弟即放弃），而折叠段中间可能夹着
       **永不折叠的输入记录卡**（审批决定卡/提问留痕卡是可见元素，且常是停点段的段首）——
       回溯到它就提前放弃 ⇒ 不展开 ⇒ 隐藏节点 scrollIntoView 静默无效。
       复现场景：目标前一个兄弟正是
       div.decision-card（可见）⇒ bars 全部保持 aria-expanded=false、
       目标 hidden=true、scrollTop 不动。 */
    const workFoldBarOf = new WeakMap();
    /* 【临时调试钩子，验证后删】查某 mid 的折叠条登记状态 */
    function reorderWorkSegments(segments) {
      lastWorkSegments = segments.map(segment => {
        const key = workSegmentKey(segment);
        let startEl = segment.start !== null ? segment.start : segment.nodes[0];
        /* 0.0.139（用户实测：停点节点标题成了"✓read 已完成"、跳转看不到自己的选择）：停点段
           （start=null，"我回答了一次提问/审批"）的段首锚点改用**提问留痕卡/审批决定卡本身**——
           它就在停点段首节点的前一个兄弟位置。节点标题随之变成问题原文，跳转落点直接看到选择。
           0.0.140：真机里留痕卡可能被包在 .message 壳里（或隔着本段折叠条）——两种形态都要认。
           0.1.80（停点节点标题成了 "create_goal"、菱形也不见了）：
           旧回溯只走 **1 跳且遇非留痕元素即中断**；而 agent 答完提问后常先产出一条叙述
           （如 "User confirmed: …"）再调下一个工具 ⇒ 段首节点前方隔着该叙述 ⇒ 中断 ⇒
           锚点留在工具卡上（标题=工具名；railNodeIsStop 判不到 .ask-record ⇒ 无菱形）。
           改为**有界回溯**（≤12 跳，一路往前找最近的留痕卡；折叠条不是内容，跳过继续找）。 */
        if (segment.start === null && startEl !== undefined) {
          /* 0.1.84（审查补洞）：回溯**以下一段之前不越界**——下界取"上一段的首节点"（找不到就退 12 跳硬顶）。
             否则隔着几个元素就可能抓到**更早那次停点**的留痕卡，节点标题/跳转落点张冠李戴。 */
          const previousSegment = segments[segments.indexOf(segment) - 1];
          const floorEl = previousSegment === undefined ? undefined : previousSegment.nodes[0];
          let prev = startEl.previousElementSibling;
          for (let hop = 0; hop < 12 && prev !== null && prev !== undefined; hop += 1) {
            if (prev.classList === undefined) break;
            const isRecord = (prev.matches !== undefined && prev.matches('.ask-record, .decision-card'))
              || (prev.querySelector !== undefined && prev.querySelector('.ask-record, .decision-card') !== null);
            if (isRecord) { startEl = prev; break; }
            if (prev === floorEl) break;
            prev = prev.previousElementSibling;
          }
        }
        /* 起始文本：user 消息优先取气泡正文（避免把头像/时间也带进标题）。
           0.1.80：留痕卡锚点取**问题原文**——卡片整段 textContent 会把"提问/已回答 4/4/时钟"
           一起带进节点标题（真机实测："第 2 轮 · 提问已回答 4/42024年8月30日 17:10仿真覆盖…"）。
           0.1.122（审查）：提取链扩为 用户气泡 .msg-text → 助手正文 .message-body → 工具卡标题 .tool-title → 兜底整段——
           此前助手/工具开头的段只落到整段 textContent（"DeepSeek…时钟"混进节点标题，真机探针逐字可见）。 */
        const pickStartText = (selector) => {
          if (startEl === undefined || startEl === null || typeof startEl.querySelector !== 'function') return undefined;
          const el = startEl.querySelector(selector);
          return el === null || el === undefined ? undefined : String(el.textContent || '');
        };
        let rawText = pickStartText('.msg-text');
        if (rawText === undefined) rawText = pickStartText('.message-body');
        if (rawText === undefined) rawText = pickStartText('.tool-title');
        if (rawText === undefined) rawText = startEl !== undefined && startEl.textContent ? String(startEl.textContent) : '';
        if (startEl !== undefined && startEl.querySelector !== undefined) {
          const questionEl = startEl.querySelector('.ask-record-question');
          if (questionEl !== null && questionEl !== undefined) rawText = String(questionEl.textContent || '');
          else {
            /* 0.1.82：审批决定卡锚点——取 .record-title（"✔ 已允许一次 · web_search"），
               别把时钟/原因原文（.record-time/.decision-reason）一起拼进节点标题。 */
            const titleEl = startEl.querySelector('.record-title');
            if (titleEl !== null && titleEl !== undefined) rawText = String(titleEl.textContent || '');
          }
        }
        const text = rawText.replace(/\\s+/g, ' ').trim();
        /* 0.0.148：给段节点补"锚点 seq"——卡片锚点（提问留痕卡/审批决定卡）本身没有 data-seq
           （真机实证：selfSeq/hostSeq 全 null），退用段首节点（停点之后的第一条）的 seq。
           收藏键与停点判定都依赖它（缺了会让键在两态间漂移，见 G53 反馈③④）。 */
        const seqOfElement = (el) => {
          if (el === undefined || el === null || typeof el.closest !== 'function') return undefined;
          const host = el.closest('[data-seq]');
          if (host === null) return undefined;
          const value = Number(host.getAttribute('data-seq'));
          return Number.isFinite(value) ? value : undefined;
        };
        const seq = seqOfElement(startEl) !== undefined ? seqOfElement(startEl) : seqOfElement(segment.nodes[0]);
        return { key, element: startEl, text, ...(seq === undefined ? {} : { seq }) };
      }).filter(entry => entry.element !== undefined);
    }
    /* G49（0.0.119）：AI 工作段折叠——"我输入一次（发消息/回答/审批）→ AI 停下"为一段；
       段内除"保留项"（最终答复；无答复时最后一张卡）外的过程（工具卡/命令卡/中间叙述）
       收进段首一条折叠条。时机：正在跑且无待答卡 → 不折（F5）；停下或等你回答（提问/审批
       卡在场）→ 折（F1/F3）。手动展开/收起按段键（ws:<段起点消息id>）入会话折叠记忆（F6）。
       每次渲染全量重算（条不在 reconcile 的节点表里，会被它清掉 → 此处重建）。
       0.1.21（用户实测"流式期草稿栏打字/贴图/预览全卡"）：**稳态整段跳过**——真机实测
       （EUV 1849 消息 / 4.9 万节点）原实现独吞流式帧开销 ~85%（每帧 ~35 次"插回 1800+
       子节点列表中间"，每次让其后全部兄弟重排：style 507ms + layout 320ms/帧）。
       折叠结论只由"消息结构 + 停点 + 运行态 + 开关 + 折叠记忆"决定，流式追加只改文本
       → 签名未变即零 DOM 写入；容器被清空/结构一变，签名立刻不同（含柱在场数兜底）。 */
    let workFoldSignatureCache = '';
    /* 容器被清空/重建（会话切换、视图配置变化、非 ready 态、空态）时作废折叠缓存——
       柱随容器一起没了，缓存若留着会跳过重建（折叠条消失）。 */
    function invalidateWorkFoldCache() { workFoldSignatureCache = ''; }
    function workFoldSignatureOf(current) {
      const parts = [
        current.sessionId,
        current.running === true ? 'R' : 'I',
        current.approval === null || current.approval === undefined ? '' : 'A',
        current.question === null || current.question === undefined ? '' : 'Q',
        foldCfg().workSegmentsEnabled === false ? 'off' : 'on',
        Array.isArray(current.segmentStops) ? current.segmentStops.join(',') : '',
      ];
      /* 子节点数只数**非折叠条**的：条是折叠自己的产物，数进去会让"跑完一轮签名就变"再跑一轮。 */
      let childCount = 0;
      for (const el of elements.messages.children) {
        if (el.classList !== undefined && el.classList.contains('work-fold-bar')) continue;
        childCount += 1;
      }
      parts.push(String(childCount));
      /* 只读"输入"，绝不纳入折叠自己的产物（柱数/折叠态数）——否则折叠一跑签名就变、
         下一帧再跑，自振荡（实测：每轮追加都触发 2 次全量重建 = 两次全列表重排）。
         容器被清空的情形由调用点显式作废缓存（invalidateWorkFoldCache）。 */
      for (const message of array(current.messages)) {
        if (message === undefined || message === null) { parts.push('-'); continue; }
        /* 只取会改变折叠判据的结构事实；文本长度不参与（流式追加不改折叠结论）。
           rawInput/rawResult/deferredBodyRevision 覆盖"工具卡后到一步变提问留痕卡"这类
           DOM 形态变化（id/role 不变但节点内容换了）。 */
        parts.push(String(message.id), String(message.role),
          message.streaming === true ? 's' : '',
          message.failed === true ? 'f' : '',
          typeof message.time === 'number' ? 't' : '',
          message.rawInput === undefined ? '' : 'i',
          message.rawResult === undefined ? '' : 'r',
          typeof message.deferredBodyRevision === 'string' ? message.deferredBodyRevision : '');
      }
      return parts.join('');
    }
    function applyWorkSegmentFold(current) {
      if (foldCfg().workSegmentsEnabled === false) {
        workFoldSignatureCache = '';
      } else {
        const signature = workFoldSignatureOf(current);
        if (signature === workFoldSignatureCache) {
          /* 0.1.30 兜底：段列表落后于 DOM 时强制重排（判据：DOM 里 ≥2 条 user 消息而段数 ≤1）。 */
          if (!(lastWorkSegments.length <= 1 && elements.messages.querySelectorAll('.message.user').length >= 2)) return;
        }
        workFoldSignatureCache = signature;
      }
      for (const bar of elements.messages.querySelectorAll('.work-fold-bar')) bar.remove();
      const nodes = [...elements.messages.children];
      const unmark = (el) => { if (el.classList && el.classList.contains('work-folded')) { el.hidden = false; el.classList.remove('work-folded'); } };
      if (foldCfg().workSegmentsEnabled === false) { for (const el of nodes) unmark(el); return; }
      const settled = current.running !== true || Boolean(current.approval) || Boolean(current.question);
      /* 0.0.131：段内用时（卡头摘要）——消息时间按 data-mid 反查（节点本身不带 time）。 */
      const timeByMid = new Map();
      for (const message of array(current.messages)) {
        if (message && typeof message.id === 'string' && typeof message.time === 'number') timeByMid.set(message.id, message.time);
      }
      /* G49 v2（0.0.121）：“已应答停点”也是段边界（用户界定：我输入一次 = 发消息 / 回答提问 / 审批）。 */
      const stopSeqs = (Array.isArray(current.segmentStops) ? current.segmentStops : [])
        .filter(seq => typeof seq === 'number' && Number.isFinite(seq))
        .sort((a, b) => a - b);
      let stopCursor = 0;
      let boundaryPending = false;
      let lastSeqSeen = undefined; /* 0.1.11：末元素 seq——尾部停点判据（见 trailingStopEnded）。 */
      const segments = [];
      let open = null;
      const openSegment = (startEl) => { open = { start: startEl, nodes: [] }; segments.push(open); };
      /* 0.0.125：段信息也供轨道使用（同源 = 跳转必落在段首，不会跳进折叠里）。 */
      for (const el of nodes) {
        if (!el.classList) continue;
        if (el.classList.contains('optimistic')) continue;
        const rawSeq = el.dataset && el.dataset.seq !== undefined ? Number(el.dataset.seq) : undefined;
        const seq = typeof rawSeq === 'number' && Number.isFinite(rawSeq) ? rawSeq : undefined;
        if (seq !== undefined) {
          /* 消费"在此之前已应答"的停点 → 当前节点起新段（一次性）。 */
          let consumed = false;
          while (stopCursor < stopSeqs.length && stopSeqs[stopCursor] < seq) { stopCursor += 1; consumed = true; }
          if (consumed) boundaryPending = true;
          lastSeqSeen = seq;
        }
        if (el.classList.contains('message') && el.classList.contains('user')) { boundaryPending = false; openSegment(el); continue; }
        /* 分页边界：首条可见消息之前的部分（其段起点的 user 消息尚未被加载）也要成段——
           否则翻页加载进来的旧内容永远不折（用户实测：长会话里只有最后一段折起）。 */
        if (open === null || boundaryPending) { boundaryPending = false; openSegment(null); }
        open.nodes.push(el);
      }
      /* 0.1.11（用户实测"agent 产生一条，折叠加一条"）：停点事件（审批决定卡/提问留痕卡，seq == 停点）
         已渲染、但它之后的新元素还没到时，**末段也必须立即视为已结束**——否则回答审批后到 agent 产出
         下一条之间，折叠条会先消失（整段过程全展开），下一条一来又折回，随每次产出反复（本会话 10 次审批）。
         判据：尚有未消费停点且它 ≤ 已见最后 seq（= 停点本体已在场，只是还没消化）。 */
      const trailingStopEnded = stopCursor < stopSeqs.length && lastSeqSeen !== undefined && stopSeqs[stopCursor] <= lastSeqSeen;
      /* 0.0.125：把"段首元素 + 段键 + 起始文本"交给轨道（railTurnsOf 的 segment 模式直接用）。 */
      reorderWorkSegments(segments);
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const ended = index < segments.length - 1 || settled || (trailingStopEnded && index === segments.length - 1);
        if (!ended) { for (const el of segment.nodes) unmark(el); continue; }
        let keeper = -1;
        for (let i = segment.nodes.length - 1; i >= 0; i -= 1) {
          const el = segment.nodes[i];
          if (el.classList.contains('message') && el.classList.contains('assistant')) { keeper = i; break; }
        }
        if (keeper === -1) keeper = segment.nodes.length - 1; /* F4：无答复轮保留最后一张卡 */
        /* 0.1.5（EUV 会话实测："以失败 read 为首一截过程没折叠"）：旧实现把
           slice(keepFrom)（最终答复**及其之后的一切**）整体 unmark——审批停点切出的中段，
           段尾常是"最后一条叙述之后的工具卡串"（后续步骤还没产出文本），于是露出一大截过程。
           新规则与设计原文（过程收进折叠条；最终答复可见；输入留痕永不折）逐条对齐：
           可见 = 最终答复 + 输入留痕（ask-record/decision-card）；其余无论位置一律进折叠条。 */
        /* 0.0.138（用户⑤复核：跳转不再展开后，"我选择了什么"被折进过程里看不见）：提问留痕卡
           与审批决定卡是**我的输入**，不属于"过程"——永不折叠，始终留在对话里可见。 */
        const isInputRecord = (el) => {
          if (el.matches !== undefined && el.matches('.ask-record, .decision-card')) return true;
          return el.querySelector !== undefined && el.querySelector('.ask-record, .decision-card') !== null;
        };
        const process = [];
        for (let i = 0; i < segment.nodes.length; i += 1) {
          const el = segment.nodes[i];
          if (i === keeper || isInputRecord(el)) unmark(el);
          else process.push(el);
        }
        if (process.length === 0) continue;
        const stamps = [];
        for (const item of (segment.start !== null && segment.start !== undefined ? [segment.start, ...segment.nodes] : segment.nodes)) {
          const mid = item.dataset ? item.dataset.mid : undefined;
          const stamp = typeof mid === 'string' ? timeByMid.get(mid) : undefined;
          if (typeof stamp === 'number') stamps.push(stamp);
        }
        const spanMs = stamps.length >= 2 ? Math.max(...stamps) - Math.min(...stamps) : undefined;
        const memoKey = workSegmentKey(segment);
        const memoized = memoKey !== undefined && viewMemoryCfg().fold && typeof renderedSessionId === 'string' ? viewMemoOf(renderedSessionId).folds.get(memoKey) : undefined;
        /* 0.0.137：跳转不再写任何临时展开（见 effectiveRailElement），折叠状态只剩"记忆 + 默认折起"。 */
        let folded = memoized !== 'expanded';
        const bar = node('button', 'work-fold-bar'); bar.type = 'button';
        const refresh = () => {
          /* 亚秒段不显示时长（夹具/极短段会出现"0秒"的怪文案）。 */
          const span = typeof spanMs === 'number' && spanMs >= 1000 ? ' · ' + formatRunDuration(spanMs) : '';
          bar.textContent = folded ? ('▸ 过程 · ' + String(process.length) + ' 步' + span) : '▾ 过程 · 收起';
          bar.setAttribute('aria-expanded', folded ? 'false' : 'true');
        };
        const apply = () => { for (const el of process) { el.hidden = folded; el.classList.add('work-folded'); } };
        /* 折叠态写入口（供点击与"搜索跳转展开命中段"共用）：next 省略 = 反转。
           单独抽出来是因为程序性展开不能走点击手势守卫（见 selectionDragEnded）。 */
        const setFolded = (next) => {
          folded = next === undefined ? !folded : next === true;
          /* 0.1.44（D3）+ T2：展开前先把段内"未补建的外壳/工具卡壳"补建——否则展开出来的是空壳。 */
          if (!folded) {
            const expandStarted = performance.now();
            let built = 0;
            for (const el of process) if (ensureMessageBody(el) || ensureToolCard(el)) built += 1;
            diagLoad('lazy-expand', { process: process.length, built, ms: Math.round(performance.now() - expandStarted) });
          }
          apply(); refresh();
          if (memoKey !== undefined && typeof renderedSessionId === 'string') {
            const memo = viewMemoOf(renderedSessionId);
            if (viewMemoryCfg().fold) {
              memo.folds.set(memoKey, folded ? 'folded' : 'expanded');
              scheduleViewStatePersist(renderedSessionId);
            }
          }
        };
        bar.__setFolded = setFolded;
        bar.addEventListener('click', () => {
          /* 2026-09-24：拖选守卫改为手势判定——只有"这次手势改动了选区"（拖选收尾）才不触发。
             旧实现"存在选区就 return"会让"先选中文字、再点折叠条"完全失效（用户实测）。 */
          if (selectionDragEnded()) return;
          /* T3-8（0.1.76）：手动开合过的段，搜索跳转不得替它折回。 */
          if (bar.dataset !== undefined) bar.dataset.userToggled = '1';
          setFolded();
        });
        apply(); refresh();
        elements.messages.insertBefore(bar, process[0]);
        /* 登记"过程节点 → 本条折叠条"（跳转展开据此直取，不再回溯兄弟链，见 workFoldBarOf）。 */
        workFoldBarOf.set(bar, bar);
        for (const el of process) workFoldBarOf.set(el, bar);
      }
    }
    function renderStatus(current) {
      /* 0.0.106（W6）：错误态卡片化——警示标题 + 详情 + 动作；正常态维持单行状态条。 */
      const failed = current.phase === 'error';
      const box = node('div', 'status' + (failed ? ' error status-card' : ''), failed ? '' : (current.statusText || '正在启动 DeepSeek Harness…'));
      if (failed) {
        box.append(node('div', 'status-card-title', '⚠ 运行时连接失败'));
        box.append(node('div', 'status-card-detail', current.statusText || 'DeepSeek Harness 运行时当前不可用'));
        const actions = node('div', 'actions');
        const retry = node('button', 'secondary', '重新连接'); const output = node('button', 'secondary', '显示输出');
        retry.addEventListener('click', () => vscode.postMessage({ type: 'restart' })); output.addEventListener('click', () => vscode.postMessage({ type: 'output' }));
        actions.append(retry, output); box.append(actions);
      }
      return box;
    }
    function renderEmpty(current) {
      const empty = node('div', 'empty'); empty.append(node('div', 'empty-logo deepseek-mark'), node('h2', '', '用 DeepSeek 构建'));
      empty.append(node('p', '', '在 ' + current.workspaceName + ' 中提问、探索代码并做出修改。'));
      /* 0.0.175（A11 空态）：补一行上手提示（隐藏操作提示的同一诉求，首屏就能看到入口）。 */
      empty.append(node('div', 'empty-hints', '@ 提及文件 · 拖入图片/文件 · / 查看命令'));
      return empty;
    }
    /* 0.0.106（W3）：危险操作警示——命令式审批（reason 含命令原文）按已知危险模式加强呈现；
       协议仅支持 allowed-once/rejected 两种结局（契约原文），故仅做视觉分级。 */
    const DANGEROUS_APPROVAL_RE = /(rm\\s+-[a-z]*[rf]|rmdir|\\bdel\\b|Remove-Item|\\brd\\s|git\\s+reset\\s+--hard|push\\b[^\\n]*--force|--force\\b|-Recurse|\\btaskkill\\b|Stop-Process|\\btruncate\\b|\\bformat\\b)/i;
    function renderApproval(approval) {
      const dangerous = DANGEROUS_APPROVAL_RE.test(String(approval.reason || ''));
      const box = node('section', 'interaction approval' + (dangerous ? ' danger' : ''));
      const title = node('div', 'interaction-title');
      if (dangerous) title.append(node('span', 'interaction-warn', '⚠'));
      title.append(node('span', '', (dangerous ? '危险操作待确认：' : '') + '允许执行 ' + approval.toolName + '？'));
      box.append(title);
      if (approval.reason) box.append(node('div', 'interaction-detail', approval.reason));
      const actions = node('div', 'actions');
      const allow = node('button', 'primary', '允许一次'); const reject = node('button', 'secondary', '拒绝');
      allow.addEventListener('click', () => vscode.postMessage({ type: 'approval', rpcId: approval.rpcId, approvalId: approval.approvalId, outcome: 'allowed-once' }));
      reject.addEventListener('click', () => vscode.postMessage({ type: 'approval', rpcId: approval.rpcId, approvalId: approval.approvalId, outcome: 'rejected' }));
      actions.append(allow, reject); box.append(actions); return box;
    }
    /* 0.1.112（真机事故：提问卡「其他」输入被周期清空）：卡片是**纯 DOM 态**——任何一次尾部重渲
       （状态帧带来新的 question 对象 / 切会话 / 改设置…）都会重建卡片 ⇒ 已填文本与已选选项全丢；
       真机实测 ws 空闲被服务端断开 ⇒ 每次重连重放 question/requested ⇒ 每 ~14s 清一次。
       改**草稿表**：按问题 id 存 {custom 文本, 已选选项}，渲染时回填、输入/选择时就地记账；
       换了一组提问（id 集合变化）整表清空。 */
    let questionDraftKey = '';
    let questionDrafts = new Map();
    function renderQuestions(request) {
      /* 0.0.106（W2）：标题/占位/按钮中文化 + 「跳过」出口（cancelled 结算，协议支持）。 */
      {
        const draftKey = (request.questions || []).map(question => question.id).join('|');
        if (draftKey !== questionDraftKey) { questionDraftKey = draftKey; questionDrafts = new Map(); }
      }
      const box = node('form', 'interaction question'); box.append(node('div', 'interaction-title', 'DeepSeek 需要你的确认'));
      for (const question of request.questions) {
        const item = node('div', 'question-item'); item.dataset.questionId = question.id;
        item.append(node('div', 'question-label', question.header || question.question));
        if (question.header) item.append(node('div', 'question-detail', question.question));
        if (question.detail) item.append(node('div', 'question-detail', question.detail));
        /* 2026-10-05（用户需求）：单行 input → 多行 textarea（自增高，见 growCustom）；
           Enter=提交 / Shift+Enter=换行（用户拍板——Shift+Enter 才是刻意换行键）；中文输入法回车不误提交。 */
        const custom = document.createElement('textarea'); custom.rows = 1; custom.className = 'custom-answer'; custom.placeholder = question.options && question.options.length ? '其他答案（可选）' : '输入你的答案'; custom.dataset.custom = 'true';
        /* 自增高：随内容长到 6 行（≈138px，与 CSS max-height 同值），再超出则框内滚动。 */
        const growCustom = () => { custom.style.height = 'auto'; custom.style.height = Math.min(custom.scrollHeight, 138) + 'px'; };
        /* 0.1.8（用户复测）：选项=自绘控件（role=radio/checkbox）——原生 radio 在 label 转发路径下
           预激活/取消回滚时序不可靠（实测：click 里同步/微任务回写的 checked 会被一个**异步任务**打回，
           致"再点已选项取消 / 点 other 框清选"在真实鼠标下失灵）。选中态改为纯 JS 模型：
           单选 chosen=行元素（再点同行为取消，点 other 框清空）；多选各自翻转。
           键盘：Space/Enter 选择、方向键在组内移动焦点（替代原生 radio 组的方向键导航）。 */
        const multi = question.multiSelect === true;
        const rows = [];
        let chosen = null;
        const setRow = (row, on) => { row.classList.toggle('selected', on); row.setAttribute('aria-checked', String(on)); };
        /* 0.1.112：草稿记账（任何重渲都可回填，见 questionDrafts 注释）。 */
        const draft = questionDrafts.get(question.id) || { custom: '', selected: [] };
        const saveDraft = () => {
          questionDrafts.set(question.id, {
            custom: custom.value,
            selected: rows.filter(row => row.classList.contains('selected')).map(row => row.dataset.value),
          });
        };
        const clearChosen = () => { chosen = null; for (const row of rows) setRow(row, false); saveDraft(); };
        const syncCustomActive = () => custom.classList.toggle('active', custom.value.trim() !== '' && (multi || chosen === null));
        const chooseRow = (row) => {
          if (multi) setRow(row, !row.classList.contains('selected'));
          else { const next = chosen === row ? null : row; chosen = next; for (const other of rows) setRow(other, other === next); }
          syncCustomActive();
          saveDraft();
        };
        custom.addEventListener('focus', () => { if (!multi) clearChosen(); syncCustomActive(); });
        /* 2026-10-05：input 一律记账——旧实现多选下不 saveDraft（clearChosen 才触发），
           任何重渲都会丢多选自填文本（与单选口径对齐修复）。 */
        custom.addEventListener('input', () => { if (!multi) clearChosen(); syncCustomActive(); saveDraft(); growCustom(); });
        custom.addEventListener('keydown', event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            submitAnswers();
          }
        });
        if (typeof draft.custom === 'string' && draft.custom !== '') custom.value = draft.custom;
        const group = node('div', 'option-group'); group.setAttribute('role', multi ? 'group' : 'radiogroup');
        group.setAttribute('aria-label', question.header || question.question);
        for (const option of question.options || []) {
          const row = node('div', 'option ' + (multi ? 'multi' : 'single'));
          row.setAttribute('role', multi ? 'checkbox' : 'radio');
          row.setAttribute('aria-checked', 'false');
          row.tabIndex = 0;
          row.dataset.value = option.label;
          const control = node('span', 'option-control'); control.setAttribute('aria-hidden', 'true');
          const copy = node('span', '', option.label); if (option.description) copy.append(node('span', 'option-description', option.description));
          row.addEventListener('click', () => { row.focus(); chooseRow(row); });
          row.addEventListener('keydown', event => {
            if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); chooseRow(row); return; }
            const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
            if (step === 0) return;
            event.preventDefault();
            rows[(rows.indexOf(row) + step + rows.length) % rows.length].focus();
          });
          rows.push(row);
          row.append(control, copy); group.append(row);
        }
        /* 0.1.112：回填草稿里的已选选项（单选只认一条；多选逐条恢复）。 */
        if (Array.isArray(draft.selected) && draft.selected.length > 0) {
          for (const row of rows) {
            if (draft.selected.indexOf(row.dataset.value) < 0) continue;
            if (multi) setRow(row, true);
            else { chosen = row; setRow(row, true); break; }
          }
          syncCustomActive();
        }
        if (rows.length > 0) item.append(group);
        item.append(custom); box.append(item);
        /* 回填的多行草稿要在入 DOM 后再量高度（构建期 scrollHeight 不可靠）。 */
        setTimeout(growCustom, 0);
      }
      const submit = node('button', 'primary', '提交'); submit.type = 'submit';
      const skip = node('button', 'secondary', '跳过'); skip.type = 'button';
      skip.title = '取消本次提问（等待中的工具调用将判为已取消）';
      /* 2026-10-05：随件上报问题 id 集——换代（重放）后卡片 rpcId 会过期，结算按 id 集匹配
         （与服务端重放机制配套，见 answerQuestions/cancelQuestions）。 */
      skip.addEventListener('click', () => vscode.postMessage({ type: 'question-cancel', rpcId: request.rpcId, questionIds: request.questions.map(question => question.id) }));
      const actions = node('div', 'actions'); actions.append(skip, submit); box.append(actions);
      /* 提交收敛为单出口：表单提交（点按钮）与「其他」框 Enter 都走这里。 */
      const submitAnswers = () => {
        const answers = []; let valid = true;
        for (const question of request.questions) {
          const item = box.querySelector('[data-question-id="' + CSS.escape(question.id) + '"]');
          const selected = Array.from(item.querySelectorAll('.option.selected')).map(row => row.dataset.value);
          const custom = item.querySelector('[data-custom=true]').value.trim();
          /* 0.1.8（用户复测）：单选下"选中的选项优先"——文本只做保留（不因点选项被清）；
             自定义仅在无选项选中时生效（此时它才计入答案，避免"选项与自定义同时上报"）。 */
          const customEffective = custom !== '' && (question.multiSelect === true || selected.length === 0);
          if (!selected.length && !customEffective) { item.classList.add('error-text'); valid = false; } else item.classList.remove('error-text');
          answers.push({ id: question.id, selected, ...(customEffective ? { custom } : {}) });
        }
        if (valid) vscode.postMessage({ type: 'question', rpcId: request.rpcId, answers });
      };
      box.addEventListener('submit', event => { event.preventDefault(); submitAnswers(); });
      return box;
    }
    function renderEfforts(model) {
      elements.efforts.replaceChildren(); const efforts = model && model.reasoningEfforts || [];
      for (const effort of efforts) elements.efforts.append(new Option(effort.label, effort.id, false, effort.selected === true));
      if (!efforts.length) elements.efforts.append(new Option('默认', ''));
      elements.efforts.title = efforts.length ? '推理强度' : '该模型没有推理强度设置';
    }
    /* 0.0.141（用户需求②）：帧徽标按宽度铺满单行——放不下的尾部徽标隐藏并折算为 "+m"。
       同步测量（调用点 chip 已入 DOM 且容器可见，强制一次布局即可读准）；侧栏尺寸变化时由
       resize observer 先还原全部徽标再重铺。 */
    function fitFrameBadges(chip) {
      const more = chip.querySelector('.frame-badge-more');
      if (more === null || more === undefined) return;
      const frames = [...chip.querySelectorAll('.frame-badge:not(.frame-badge-more)')];
      for (const badge of frames) badge.hidden = false;
      more.hidden = true;
      if (chip.scrollWidth <= chip.clientWidth) return;
      let shown = frames.length;
      more.hidden = false;
      const sync = () => { more.textContent = '+' + String(frames.length - shown); };
      sync();
      while (shown > 0 && chip.scrollWidth > chip.clientWidth) {
        shown -= 1;
        frames[shown].hidden = true;
        sync();
      }
    }
    function refitAllFrameBadges() {
      for (const chip of elements.attachments.querySelectorAll('.attachment-chip')) fitFrameBadges(chip);
    }
    function renderAttachments() {
      elements.attachments.replaceChildren(); elements.attachments.classList.toggle('hidden', draftImages.length === 0); syncDraftZoneVisibility();
      for (const image of draftImages) {
        const chip = node('div', 'attachment-chip');
        chip.__ctx = { kind: 'image', name: displayFileName(image.name) || '图片', data: string(image.data), id: string(image.id) };
        const label = node('span', 'attachment-name', displayFileName(image.name) || '图片');
        if (image.data) {
          const thumb = node('img', 'attach-thumb'); thumb.src = image.data; thumb.alt = image.name || '图片';
          thumb.title = '点击预览'; thumb.draggable = false;
          /* 0.0.79：带 draftId——GIF 预览控制条才会出现「选择发送」勾选框 */
          thumb.addEventListener('click', () => {
            /* 0.0.167（B4 P2）：草稿附件条整体作图组——←/→ 在草稿图间切换（仍带 draftId：动图翻帧/选帧）。 */
            const gallery = [];
            let galleryIndex = 0;
            for (const holder of elements.attachments.children) {
              const ctx = holder.__ctx;
              const holderSrc = ctx === undefined ? undefined : imageSrc(string(ctx.mediaType), string(ctx.data));
              if (holderSrc === undefined) continue;
              if (holder === chip) galleryIndex = gallery.length;
              gallery.push({ src: holderSrc, name: displayFileName(string(ctx.name, '图片')) || '图片' });
            }
            void openImagePreview(image.data, {
              draftId: string(image.id),
              ...(gallery.length > 1 ? { gallery, galleryIndex } : {}),
            });
          });
          chip.append(thumb); chip.append(label);
        } else {
          const iconWrap = node('span', 'context-icon');
          iconWrap.append(fileTypeIconEl(image.name || 'image.png', 'image'));
          chip.append(iconWrap, label);
        }
        const remove = node('button', 'attachment-remove', '✕'); remove.title = '移除附件';
        remove.addEventListener('click', (event) => { event.stopPropagation(); vscode.postMessage({ type: 'remove-attachment', id: image.id }); });
        /* 0.0.79（GIF②④）：选帧徽标（多选）。
           0.0.141（用户需求②）：不再固定"前 4 个 +N"，改按实际宽度铺——单行放得下几个放几个，
           放不下的尾部折成 "+m"（窄侧栏不再折成两三行）。 */
        const selectedFrames = draftFrameSelections(image);
        for (const frame of selectedFrames) chip.append(node('span', 'frame-badge', '第 ' + String(frame.index + 1) + ' 帧'));
        const more = node('span', 'frame-badge frame-badge-more');
        more.hidden = true;
        chip.append(more);
        chip.append(remove); elements.attachments.append(chip);
        fitFrameBadges(chip);
      }
      /* 清空入口已迁移到模式行垃圾桶按钮（④），此处不再渲染局部按钮 */
      updateSend();
    }
    /* preview v3: canvas renderer — true nearest-neighbor upscale, pixel-locked source window, consistent anchor (no fly-away), lerp on scale+translate together */
    const PREVIEW_MIN = 0.01; const PREVIEW_MAX = 32; // G4: 原 0.1/16——4K 图在 0.1x 仍超出屏幕，按用户要求扩到 0.01x~32x
    let previewImage = undefined;
    /* 0.0.79（GIF①）: GIF 预览 = 逐帧渲染（ImageDecoder 按需解码 + 自驱播放），
       帧画进离屏 canvas 后走既有几何链路；控制条可播放/停止/翻帧/勾选发送。 */
    let previewFrames = undefined;
    let previewFrameIndex = 0;
    let previewPlaying = false;
    let previewPlayTimer = undefined;
    let previewSourceToken = 0;
    let previewReturnPicker = '';
    function previewImageWidth() {
      const image = previewImage;
      return image === undefined ? 0 : (image.naturalWidth || image.width || 0);
    }
    function previewImageHeight() {
      const image = previewImage;
      return image === undefined ? 0 : (image.naturalHeight || image.height || 0);
    }
    let previewScale = 1; let previewTarget = 1; let previewFit = 1;
    let previewX = 0; let previewY = 0; let previewTargetX = 0; let previewTargetY = 0;
    let previewPan = false; let previewLastX = 0; let previewLastY = 0;
    let previewLoop = undefined;
    function previewDraw() {
      const image = previewImage;
      const canvas = elements.imagePreviewCanvas;
      const imageWidth = previewImageWidth();
      const imageHeight = previewImageHeight();
      if (!image || imageWidth <= 0) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.clientWidth; const ch = canvas.clientHeight;
      const bw = Math.max(1, Math.round(cw * dpr)); const bh = Math.max(1, Math.round(ch * dpr));
      if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      const s = previewScale;
      const srcW = cw / s; const srcH = ch / s;
      const srcX = imageWidth / 2 - (cw / 2 + previewX) / s;
      const srcY = imageHeight / 2 - (ch / 2 + previewY) / s;
      ctx.imageSmoothingEnabled = s <= 1.001;
      const clampV = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      const sx0 = clampV(srcX, 0, imageWidth);
      const sy0 = clampV(srcY, 0, imageHeight);
      const sx1 = clampV(srcX + srcW, 0, imageWidth);
      const sy1 = clampV(srcY + srcH, 0, imageHeight);
      let sw = sx1 - sx0; let sh = sy1 - sy0;
      if (sw > 0 && sh > 0) {
        /* 0.0.83（用户反馈②）: 去掉源窗口的整像素锁定（原 Math.round(sx0)）。旧行为两类可见缺陷：
           ① 图片边缘只剩 ≤0.5 源像素可见时窗口被推到图外（sw=0 → 边缘整块消失）；
           ② 锁定位移让内容跨半像素跳变，视口侧出现 0→s/2 设备像素的空白带锯齿（32× 时 16px）。
           现源窗口保持分数坐标（nearest 采样仍是纯色像素，实测混色=0），目标端继续按设备像素取整。 */
        const dx = Math.round((sx0 - srcX) * s * dpr) / dpr;
        const dy = Math.round((sy0 - srcY) * s * dpr) / dpr;
        ctx.drawImage(image, sx0, sy0, sw, sh, dx, dy, sw * s, sh * s);
      }
      const label = previewScale >= 10 ? previewScale.toFixed(1) : previewScale.toFixed(2);
      elements.zoomValue.textContent = '  ·  ×' + label + ' (1px=' + label + 'px)';
    }
    function updatePreviewControls() {
      if (previewFrames === undefined) {
        elements.previewControls.classList.add('hidden');
        elements.previewSelectWrap.classList.add('hidden');
        return;
      }
      elements.previewControls.classList.remove('hidden');
      elements.previewPlay.textContent = previewPlaying ? '停止' : '播放';
      elements.previewFrameLabel.textContent = '第 ' + String(previewFrameIndex + 1) + ' / ' + String(previewFrames.count) + ' 帧';
      if (previewFrames.draftId === '') {
        elements.previewSelectWrap.classList.add('hidden');
        return;
      }
      elements.previewSelectWrap.classList.remove('hidden');
      const entry = draftImages.find(image => image.id === previewFrames.draftId);
      elements.previewSelect.checked = entry !== undefined && draftFrameSelections(entry).some(frame => frame.index === previewFrameIndex);
    }
    function stopPreviewPlayback() {
      previewPlaying = false;
      if (previewPlayTimer !== undefined) { clearTimeout(previewPlayTimer); previewPlayTimer = undefined; }
      updatePreviewControls();
    }
    function schedulePreviewFrame(delayMs) {
      if (previewPlayTimer !== undefined) clearTimeout(previewPlayTimer);
      previewPlayTimer = setTimeout(() => {
        previewPlayTimer = undefined;
        void previewShowFrame(previewFrameIndex + 1);
      }, Math.max(30, delayMs));
    }
    async function previewShowFrame(index, options) {
      const frames = previewFrames;
      if (frames === undefined) return;
      const token = previewSourceToken;
      const wrapped = ((index % frames.count) + frames.count) % frames.count;
      try {
        const { image } = await frames.decoder.decode({ frameIndex: wrapped });
        if (token !== previewSourceToken || previewFrames !== frames) { image.close(); return; }
        const canvas = document.createElement('canvas');
        canvas.width = image.displayWidth; canvas.height = image.displayHeight;
        canvas.getContext('2d').drawImage(image, 0, 0);
        const durationMs = typeof image.duration === 'number' && image.duration > 0 ? image.duration / 1000 : 100;
        image.close();
        previewFrameIndex = wrapped;
        previewImage = canvas;
        /* 0.0.81: 首帧就绪才揭开 overlay（揭开与绘制同一同步块 → 不会先露出旧画布/空画布）。 */
        elements.imagePreview.classList.remove('hidden');
        if (options !== undefined && options.layout === true) previewLayout(); else previewDraw();
        updatePreviewControls();
        updatePreviewHint();
        if (previewPlaying) schedulePreviewFrame(durationMs);
      } catch {
        stopPreviewPlayback();
      }
    }
    function startPreviewPlayback() {
      if (previewFrames === undefined) return;
      previewPlaying = true;
      updatePreviewControls();
      schedulePreviewFrame(120);
    }
    let previewLastFrame = 0;
    function previewLooper(ts) {
      previewLoop = undefined;
      const frame = ts === undefined ? performance.now() : ts;
      const dt = Math.min(0.08, Math.max(0.001, (frame - (previewLastFrame || frame)) / 1000));
      previewLastFrame = frame;
      const t = 1 - Math.exp(-dt * 22);
      const scaleDiff = previewTarget - previewScale;
      if (scaleDiff < -0.0004 || scaleDiff > 0.0004) {
        previewScale += scaleDiff * t;
        previewX += (previewTargetX - previewX) * t;
        previewY += (previewTargetY - previewY) * t;
        if (Math.abs(previewTarget - previewScale) < 0.0004) { previewScale = previewTarget; previewX = previewTargetX; previewY = previewTargetY; }
        previewDraw();
        previewLoop = window.requestAnimationFrame(previewLooper);
      } else {
        previewScale = previewTarget; previewX = previewTargetX; previewY = previewTargetY;
        previewLastFrame = 0;
        previewDraw();
      }
    }
    function previewZoomFactor(event) {
      const delta = event.deltaMode === 1 ? event.deltaY * 20 : event.deltaY;
      const scaled = Math.max(-140, Math.min(140, delta));
      return Math.exp(-scaled * 0.0028);
    }
    /* 0.0.80: 底部 UI（控制条 42px + 提示行）预留带——避免贴底图被控制条遮住；
       图在剩余区域内视觉居中（中心上移半个预留带）。 */
    function previewBottomReserve() {
      /* 0.0.86（G36）: 预留带 = 底部卡片实高 + 上下边距（14px 底距 + 呼吸）；量不到时回落旧值。 */
      const height = elements.previewBar.offsetHeight;
      return height > 0 ? height + 24 : 64;
    }
    function previewMinScaleLimit() {
      const settings = state && state.previewSettings;
      return settings && typeof settings.minScale === 'number' ? settings.minScale : PREVIEW_MIN;
    }
    function previewMaxScaleLimit() {
      const settings = state && state.previewSettings;
      return settings && typeof settings.maxScale === 'number' ? settings.maxScale : PREVIEW_MAX;
    }
    /* 0.1.22：预览几何的**单一基准** = 画布 CSS 尺寸（画布绝对铺满覆盖层，见 .image-preview-canvas）。
       凡"取视口大小算中心/夹紧/适配"一律走这里——此前绘制按画布、缩放按覆盖层 rect，两把尺子差半个
       画布溢出量，初始位置与缩放锚点都随之偏。取不到画布时回落覆盖层 rect。 */
    function previewViewport() {
      const canvas = elements.imagePreviewCanvas;
      if (canvas !== null && canvas !== undefined && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
        return { w: canvas.clientWidth, h: canvas.clientHeight };
      }
      const rect = elements.imagePreview.getBoundingClientRect();
      return { w: rect.width, h: rect.height };
    }
    function previewLayout() {
      if (!previewImage) return;
      const viewport = previewViewport();
      const reserve = previewBottomReserve();
      previewFit = Math.min(viewport.w / previewImageWidth(), Math.max(1, viewport.h - reserve) / previewImageHeight(), 1);
      previewFit = Math.max(previewMinScaleLimit(), Math.min(1, previewFit));
      previewScale = previewFit; previewTarget = previewFit;
      previewX = 0; previewY = -reserve / 2;
      previewTargetX = 0; previewTargetY = -reserve / 2;
      previewDraw();
    }
    /* 0.0.80: 夹紧改为"至少保留 KEEP_VISIBLE px 图像可见"——旧式 pw/2+0.6·视口 允许小图
       完整飞出屏幕（用户实测"缩小后图不见了"），且会顶掉光标锚点缩放的定位感。 */
    const PREVIEW_KEEP_VISIBLE = 24;
    function clampPreviewPan() {
      if (!previewImage) return;
      const viewport = previewViewport();
      const pw = previewImageWidth() * previewTarget;
      const ph = previewImageHeight() * previewTarget;
      const limX = Math.max(PREVIEW_KEEP_VISIBLE / 2, viewport.w / 2 + pw / 2 - PREVIEW_KEEP_VISIBLE);
      const limY = Math.max(PREVIEW_KEEP_VISIBLE / 2, viewport.h / 2 + ph / 2 - PREVIEW_KEEP_VISIBLE);
      previewTargetX = Math.max(-limX, Math.min(limX, previewTargetX));
      previewTargetY = Math.max(-limY, Math.min(limY, previewTargetY));
    }
    let previewContextActive = false;
    let previewContextTimer = undefined;
    /* 0.0.81: 改为捕获阶段 + stopImmediatePropagation——右键关预览时 overlay 已在 pointerdown 隐藏，
       随后派发的 contextmenu 会命中其下方元素；这些元素若自带 handler（选帧器帧格），
       冒泡层 preventDefault 拦不住（0.0.55 只有文档级兜底 → 用户复测"选帧器右键退出后弹帧菜单"）。 */
    let previewContextSwipeOnce = false;
    function blockPreviewContextMenu(event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      /* 关预览后吞到的首个 contextmenu = 这次关闭手势的余波；吞掉即撤，兼容长按右键。 */
      if (previewContextSwipeOnce) { previewContextSwipeOnce = false; stopPreviewContextBlock(); }
    }
    function stopPreviewContextBlock() {
      if (previewContextTimer !== undefined) { clearTimeout(previewContextTimer); previewContextTimer = undefined; }
      if (previewContextActive) { previewContextActive = false; document.removeEventListener('contextmenu', blockPreviewContextMenu, true); }
    }
    function startPreviewContextBlock() {
      if (previewContextTimer !== undefined) { clearTimeout(previewContextTimer); previewContextTimer = undefined; }
      previewContextSwipeOnce = false;
      if (!previewContextActive) { previewContextActive = true; document.addEventListener('contextmenu', blockPreviewContextMenu, true); }
    }
    /* 0.0.167（B4 P2）：跨图切换——同一容器（消息图片条/草稿附件条/上下文面板）内的图组；
       ←/→ 在原图之间切换（动图时 ←/→ 仍翻帧，见全局 keydown）。 */
    let previewGallery = [];
    let previewGalleryIndex = 0;
    function updatePreviewHint() {
      const parts = ['左键拖动', '滚轮缩放', '右键/ESC 退出'];
      if (previewFrames !== undefined) {
        parts.push('←/→ 翻帧');
        if (previewFrames.draftId !== '') parts.push('勾选「选择发送」把该帧作为图片');
      } else if (previewGallery.length > 1) {
        parts.push('←/→ 切换图片（' + String(previewGalleryIndex + 1) + '/' + String(previewGallery.length) + '）');
      }
      elements.previewHintText.textContent = parts.join(' · ');
    }
    function previewStepImage(delta) {
      if (previewGallery.length < 2) return;
      const next = (previewGalleryIndex + delta + previewGallery.length) % previewGallery.length;
      const entry = previewGallery[next];
      if (entry === undefined || entry.src === '') return;
      void openImagePreview(entry.src, { gallery: previewGallery, galleryIndex: next });
    }
    async function openImagePreview(src, context) {
      /* 0.0.79（GIF①）: 动图 → 逐帧渲染 + 控制条（context.draftId 在场时提供"选择发送"）；
         其余 → 既有 canvas 单帧路径。context.frameIndex 指定初始帧（从选帧器预览时定格）。
         G34（0.0.82）: "是否动图"改字节嗅探（GIF / APNG / 动图 WebP），不再按 data URL 前缀写死 gif。 */
      const options = context || {};
      /* 0.0.167（B4 P2）：图组随打开参数落地（跨图切换的候选集与当前位置）。 */
      if (Array.isArray(options.gallery) && options.gallery.length > 1) {
        previewGallery = options.gallery.map(entry => ({ src: String((entry && entry.src) || ''), name: String((entry && entry.name) || '') }));
        const index = typeof options.galleryIndex === 'number' ? options.galleryIndex : previewGallery.findIndex(entry => entry.src === src);
        previewGalleryIndex = index >= 0 && index < previewGallery.length ? index : 0;
      } else {
        previewGallery = [];
        previewGalleryIndex = 0;
      }
      const token = ++previewSourceToken;
      stopPreviewPlayback();
      previewFrames = undefined;
      previewFrameIndex = 0;
      /* 0.0.80（用户反馈⑤）: 从选帧器「预览该帧」进入时，关闭预览回到选帧器。 */
      previewReturnPicker = typeof options.returnToPicker === 'string' ? options.returnToPicker : '';
      const kind = typeof src === 'string' && src.startsWith('data:') ? animatedKindOfBase64(src.slice(src.indexOf(',') + 1)) : undefined;
      const animated = kind !== undefined;
      if (animated) {
        /* 0.0.81: 不在此处揭开 overlay——解码未完成时画布还是上一次的残留（旧图+旧缩放闪现）。
           previewControls 先取消 hidden 只为让 previewBottomReserve() 在首帧布局时算到预留带；
           父层隐藏时它不可见。 */
        elements.previewControls.classList.remove('hidden');
        try {
          const animatedBase64 = src.slice(src.indexOf(',') + 1);
          const decoder = new ImageDecoder({ data: base64ToBytes(animatedBase64), type: ANIMATED_KIND_MIME[kind] });
          await decoder.tracks.ready;
          await decoder.completed;
          if (token !== previewSourceToken) return;
          previewFrames = { decoder, count: decoder.tracks.selectedTrack.frameCount, draftId: typeof options.draftId === 'string' ? options.draftId : '' };
          const startFrame = typeof options.frameIndex === 'number' ? options.frameIndex : 0;
          await previewShowFrame(startFrame, { layout: true });
          if (token !== previewSourceToken) return;
          /* 0.0.80（用户反馈④）: 默认播放可由设置关闭（preview.gifAutoplay=false → 打开时静止在首帧/指定帧）。 */
          const autoplay = state === undefined || state.previewSettings === undefined || state.previewSettings.gifAutoplay !== false;
          if (typeof options.frameIndex !== 'number' && autoplay) startPreviewPlayback();
        } catch (error) {
          if (token !== previewSourceToken) return;
          elements.imagePreview.classList.add('hidden');
          elements.previewControls.classList.add('hidden');
          showToast('无法解码 ' + ANIMATED_KIND_LABEL[kind] + '：' + (error instanceof Error ? error.message : String(error)), true);
          return;
        }
      } else {
        const image = new Image();
        image.onload = () => {
          if (token !== previewSourceToken) return;
          previewImage = image;
          elements.imagePreview.classList.remove('hidden');
          elements.previewControls.classList.add('hidden');
          elements.previewSelectWrap.classList.add('hidden');
          previewLayout();
          updatePreviewHint();
        };
        image.src = src;
      }
      startPreviewContextBlock();
    }
    function closeImagePreview(closedByRightClick) {
      /* 关闭后继续挡 contextmenu：右键关（closedByRightClick）等"下一个 contextmenu 被吞"或 1.5s 兜底
         ——长按右键可让 pointerdown→contextmenu 的间隔超过任何固定时限；ESC 等其余关闭沿用短挡。 */
      startPreviewContextBlock();
      if (closedByRightClick === true) {
        previewContextSwipeOnce = true;
        previewContextTimer = window.setTimeout(stopPreviewContextBlock, 1500);
      } else {
        previewContextTimer = window.setTimeout(stopPreviewContextBlock, 260);
      }
      if (previewLoop !== undefined) { window.cancelAnimationFrame(previewLoop); previewLoop = undefined; }
      previewSourceToken += 1;
      stopPreviewPlayback();
      previewFrames = undefined;
      elements.imagePreview.classList.add('hidden');
      elements.previewControls.classList.add('hidden');
      elements.previewSelectWrap.classList.add('hidden');
      previewImage = undefined;
      previewGallery = [];
      previewGalleryIndex = 0;
      /* 0.0.81: 清掉画布残留——解码是异步的，不清则下一次打开会在解码窗口露出上一张（含旧缩放）。 */
      const leftoverCanvas = elements.imagePreviewCanvas;
      const leftoverPaint = leftoverCanvas.getContext('2d');
      if (leftoverPaint) leftoverPaint.clearRect(0, 0, leftoverCanvas.width, leftoverCanvas.height);
      previewScale = 1; previewTarget = 1; previewX = 0; previewY = 0; previewTargetX = 0; previewTargetY = 0;
      previewLastFrame = 0;
      const reopenPicker = previewReturnPicker;
      previewReturnPicker = '';
      if (reopenPicker !== '') void openFramePicker(reopenPicker);
    }
    /* 0.0.79（GIF①）: 控制条交互（pointerdown 阻断——避免触发 overlay 的拖拽平移）。0.0.84: 提示行同理。 */
    /* 0.0.86（G36）: 阻断收敛到底部卡片（两行同属 UI；子元素事件冒泡到此即被拦下）。 */
    elements.previewBar.addEventListener('pointerdown', (event) => event.stopPropagation());
    elements.previewPlay.addEventListener('click', () => { if (previewPlaying) stopPreviewPlayback(); else startPreviewPlayback(); });
    elements.previewPrev.addEventListener('click', () => { stopPreviewPlayback(); void previewShowFrame(previewFrameIndex - 1); });
    elements.previewNext.addEventListener('click', () => { stopPreviewPlayback(); void previewShowFrame(previewFrameIndex + 1); });
    elements.previewSelect.addEventListener('change', () => {
      const draftId = previewFrames === undefined ? '' : previewFrames.draftId;
      if (draftId === '') return;
      const frameIndex = previewFrameIndex;
      if (previewPlaying) stopPreviewPlayback();
      void (async () => {
        await toggleFrameSelection(draftId, frameIndex);
        renderAttachments();
        updatePreviewControls();
      })();
    });
    window.addEventListener('resize', () => { if (!elements.imagePreview.classList.contains('hidden')) previewDraw(); });
    /* 0.0.78（GIF③）: 发送指定帧——草稿 GIF 选帧器。
       选帧即把该帧转 PNG 替换草稿（沿用 SVG→PNG 转码先例：data=发送形态，originData=原始 GIF，
       供「复制原格式」/发送留档）；「恢复默认（首帧）」还原整张 GIF 原样发送（回显走 0.0.77 动图）。 */
    /* 原始动图的裸 base64（优先 originData=已选帧前的原图；否则当前 data）。
       注意用 atob 而非 fetch(data:)——页面 CSP 的 connect-src 会拦 data: 拉取。 */
    function imageBase64Of(entry) {
      const origin = typeof entry.originData === 'string' && entry.originData !== '' ? entry.originData : undefined;
      const raw = origin !== undefined ? origin : string(entry.data);
      const comma = raw.indexOf(',');
      return comma >= 0 ? raw.slice(comma + 1) : raw;
    }
    function base64ToBytes(base64) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return bytes;
    }
    /* G34（0.0.82）: 动图能力判断——嗅探字节（animatedKindOfBytes 由 webview-chrome.js 注入），
       kind → ImageDecoder 类型 / 界面文案（按用户要求按实际格式显示：GIF / APNG / WebP）。 */
    const ANIMATED_KIND_MIME = { gif: 'image/gif', png: 'image/png', webp: 'image/webp' };
    const ANIMATED_KIND_LABEL = { gif: 'GIF', png: 'APNG', webp: 'WebP' };
    function animatedKindOfBase64(base64) {
      try {
        return animatedKindOfBytes(base64ToBytes(base64));
      } catch (_) {
        return undefined;
      }
    }
    /* 草稿条目缓存（同一草稿多次开菜单不重复解码；条目随 draft-images 重建 → 缓存自然失效）。 */
    function animatedKindOfEntry(entry) {
      if (entry === undefined) return undefined;
      if (entry.__animatedKind === undefined) {
        const kind = animatedKindOfBase64(imageBase64Of(entry));
        /* 嗅探失败（如超大图 atob 异常）时按媒体类型兜底：gif 恒可抽帧 */
        entry.__animatedKind = kind === undefined && string(entry.mediaType) === 'image/gif' ? 'gif' : kind === undefined ? '' : kind;
      }
      return entry.__animatedKind === '' ? undefined : entry.__animatedKind;
    }
    async function decodeFrame(imageBase64, frameIndex, mime) {
      const decoder = new ImageDecoder({ data: base64ToBytes(imageBase64), type: mime });
      await decoder.tracks.ready;
      await decoder.completed;
      const { image } = await decoder.decode({ frameIndex });
      const canvas = document.createElement('canvas');
      canvas.width = image.displayWidth; canvas.height = image.displayHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);
      image.close();
      return canvas;
    }
    let framePickerDraftId = '';
    /* 0.0.79（GIF②④）：选帧 = 多选集合（左键点选/取消）；草稿本体不动。
       0.0.96（G38 批次 2）：上限改由设置驱动——preview.maxFrameSelections（多选）/ preview.maxFrames（抽帧）。 */
    function frameCfg() {
      const s = (state && state.previewSettings) || {};
      return {
        maxFrameSelections: typeof s.maxFrameSelections === 'number' && s.maxFrameSelections >= 1 && s.maxFrameSelections <= 60 ? s.maxFrameSelections : 12,
        maxFrames: typeof s.maxFrames === 'number' && s.maxFrames >= 1 && s.maxFrames <= 240 ? s.maxFrames : 60,
      };
    }
    let framePickerTotal = 0;
    function draftFrameSelections(entry) {
      return entry !== undefined && Array.isArray(entry.frameSelections) ? entry.frameSelections : [];
    }
    function postDraftFrames(draftId, entry) {
      vscode.postMessage({
        type: 'set-draft-frames',
        id: draftId,
        frames: draftFrameSelections(entry).map(frame => ({ index: frame.index, data: frame.data })),
      });
    }
    async function toggleFrameSelection(draftId, frameIndex) {
      const entry = draftImages.find(image => image.id === draftId);
      if (entry === undefined) return false;
      const frames = [...draftFrameSelections(entry)];
      const existing = frames.findIndex(frame => frame.index === frameIndex);
      if (existing >= 0) {
        frames.splice(existing, 1);
      } else {
        const maxSelections = frameCfg().maxFrameSelections;
        if (frames.length >= maxSelections) {
          showToast('最多选 ' + String(maxSelections) + ' 帧', true);
          return false;
        }
        try {
          const kind = animatedKindOfEntry(entry);
          const canvas = await decodeFrame(imageBase64Of(entry), frameIndex, ANIMATED_KIND_MIME[kind]);
          frames.push({ index: frameIndex, data: canvas.toDataURL('image/png') });
        } catch (error) {
          showToast('该帧无法转为 PNG：' + (error instanceof Error ? error.message : String(error)), true);
          return false;
        }
        frames.sort((left, right) => left.index - right.index);
      }
      entry.frameSelections = frames;
      postDraftFrames(draftId, entry);
      return true;
    }
    async function copyFrameAsPng(draftId, frameIndex) {
      const entry = draftImages.find(image => image.id === draftId);
      if (entry === undefined) return;
      try {
        const kind = animatedKindOfEntry(entry);
        const canvas = await decodeFrame(imageBase64Of(entry), frameIndex, ANIMATED_KIND_MIME[kind]);
        const name = displayFileName(string(entry.name)) || 'image.' + string(kind);
        vscode.postMessage({
          type: 'copy-image-clip',
          data: canvas.toDataURL('image/png'),
          name: name.replace(/\\.[^.]+$/, '') + '-帧' + String(frameIndex + 1) + '.png',
        });
      } catch (error) {
        showToast('该帧无法复制为 PNG：' + (error instanceof Error ? error.message : String(error)), true);
      }
    }
    function updateFramePickerFooter() {
      const entry = draftImages.find(image => image.id === framePickerDraftId);
      const selected = draftFrameSelections(entry).length;
      const total = framePickerTotal > 0 ? '共 ' + String(framePickerTotal) + ' 帧；' : '';
      /* G34: 文案按实际格式（GIF / APNG / WebP），由字节嗅探得出 */
      const label = ANIMATED_KIND_LABEL[animatedKindOfEntry(entry)] || '动图';
      elements.framePickerInfo.textContent = total + (selected === 0 ? '未选（发送整张 ' + label + '）' : '已选 ' + String(selected) + ' 帧');
    }
    function closeFramePicker() {
      framePickerDraftId = '';
      framePickerTotal = 0;
      elements.framePicker.classList.add('hidden');
      elements.framePickerGrid.replaceChildren();
      elements.framePickerInfo.textContent = '';
    }
    async function openFramePicker(draftId) {
      const entry = draftImages.find(image => image.id === draftId);
      if (entry === undefined) return;
      const kind = animatedKindOfEntry(entry);
      const label = ANIMATED_KIND_LABEL[kind] || '动图';
      framePickerDraftId = draftId;
      framePickerTotal = 0;
      elements.framePickerTitle.textContent = '选择发送帧（' + label + '）';
      elements.framePickerDefault.textContent = '清除选择（发送整张 ' + label + '）';
      elements.framePicker.classList.remove('hidden');
      elements.framePickerGrid.replaceChildren(node('div', 'frame-picker-info', '正在解码…'));
      elements.framePickerInfo.textContent = '';
      try {
        const animatedBase64 = imageBase64Of(entry);
        const decoder = new ImageDecoder({ data: base64ToBytes(animatedBase64), type: ANIMATED_KIND_MIME[kind] });
        await decoder.tracks.ready;
        await decoder.completed;
        const count = decoder.tracks.selectedTrack.frameCount;
        framePickerTotal = count;
        const MAX_FRAMES = frameCfg().maxFrames;
        const step = count > MAX_FRAMES ? Math.ceil(count / MAX_FRAMES) : 1;
        const cells = [];
        for (let index = 0; index < count; index += step) {
          const { image } = await decoder.decode({ frameIndex: index });
          const canvas = document.createElement('canvas');
          canvas.width = image.displayWidth; canvas.height = image.displayHeight;
          canvas.getContext('2d').drawImage(image, 0, 0);
          image.close();
          const selectedNow = draftFrameSelections(entry).some(frame => frame.index === index);
          const cell = node('button', 'frame-picker-cell' + (selectedNow ? ' selected' : ''));
          cell.type = 'button';
          cell.title = '左键点选/取消；右键更多操作';
          const thumb = document.createElement('img');
          thumb.src = canvas.toDataURL('image/png');
          thumb.alt = '';
          cell.append(thumb, node('span', '', '第 ' + String(index + 1) + ' 帧'));
          cell.addEventListener('click', () => {
            void (async () => {
              const changed = await toggleFrameSelection(draftId, index);
              if (!changed) return;
              const selected = draftFrameSelections(entry).some(frame => frame.index === index);
              cell.classList.toggle('selected', selected);
              updateFramePickerFooter();
              renderAttachments();
            })();
          });
          cell.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            showCtxMenu(event.clientX, event.clientY, () => [
              ctxMenuOption('预览该帧', () => {
                closeFramePicker();
                /* 0.0.80（反馈⑤）: 退出预览回到选帧器；G34: 用实际格式的 mime（APNG=png / WebP） */
                void openImagePreview('data:' + ANIMATED_KIND_MIME[kind] + ';base64,' + imageBase64Of(entry), { draftId, frameIndex: index, returnToPicker: draftId });
              }),
              ctxMenuOption('复制该帧为 PNG', () => { void copyFrameAsPng(draftId, index); }),
            ]);
          });
          cells.push(cell);
        }
        if (cells.length === 0) throw new Error('帧数为 0');
        elements.framePickerGrid.replaceChildren.apply(elements.framePickerGrid, cells);
        updateFramePickerFooter();
      } catch (error) {
        elements.framePickerGrid.replaceChildren(node('div', 'frame-picker-info', '无法解码该 ' + label + '：' + (error instanceof Error ? error.message : String(error))));
      }
    }
    elements.framePickerClose.addEventListener('click', closeFramePicker);
    elements.framePickerDefault.addEventListener('click', () => {
      if (framePickerDraftId === '') return;
      const entry = draftImages.find(image => image.id === framePickerDraftId);
      if (entry === undefined) return;
      entry.frameSelections = [];
      postDraftFrames(framePickerDraftId, entry);
      closeFramePicker();
      renderAttachments();
    });
    elements.framePicker.addEventListener('click', (event) => { if (event.target === elements.framePicker) closeFramePicker(); });
    function effectivePlanMode(plan) { return Boolean(plan && (plan.pending ? !plan.active : plan.active)); }
    function policyMenuOption(label, description, selected, disabled, onSelect) {
      const option = node('button', 'command-option' + (selected ? ' selected' : ''));
      option.type = 'button'; option.setAttribute('role', 'menuitemradio'); option.setAttribute('aria-checked', String(selected)); option.disabled = disabled;
      /* 0.1.0 修复（用户实测）：本菜单的选项是**说明性文字**，不该复用 / 命令列表的等宽名
         （.command-option-name 用 editor-font-family）——补 policy-option-name 拉回 UI 字体。 */
      const line = node('span', 'command-option-line'); line.append(node('span', 'command-option-name policy-option-name', label));
      if (selected) line.append(node('span', 'command-option-current', '当前'));
      /* 标题行必须在（0.1.0 修复踩坑：上一版把这一行连 append 一起删了 → 权限标题全消失）。 */
      option.append(line);
      /* 描述与标题重复时不再重复渲染（运行时给权限项下发的是 label=description="只读" 同文）。 */
      if (String(description || '').trim() !== '' && String(description).trim() !== String(label).trim()) {
        option.append(node('span', 'command-option-description', description));
      }
      option.addEventListener('click', () => { if (selected) return; policyMenuOpen = false; elements.policyMenu.classList.add('hidden'); elements.policyTrigger.setAttribute('aria-expanded', 'false'); onSelect(); });
      return option;
    }
    function renderPolicyState(current) {
      const plan = current.plan || { available: false, active: false, pending: false };
      const planActive = effectivePlanMode(plan);
      const permissions = current.permissions || [];
      const selectedPermission = permissions.find(permission => permission.selected);
      const available = plan.available === true || permissions.length > 0;
      elements.modeChips.replaceChildren();
      const preset = current.agentPreset || { available: false, current: '', locked: true, busy: false, options: [] };
      if (preset.available && preset.options.length) {
        const selectedPreset = preset.options.find(option => option.selected) || preset.options[0];
        const chip = node('div', 'preset-chip' + (preset.locked ? ' locked' : ''));
        chip.append(node('span', 'preset-icon', '◇'));
        const select = node('select', 'preset-select'); select.setAttribute('aria-label', '代理预设');
        for (const option of preset.options) {
          const label = option.label;
          select.append(new Option(label, option.id, false, option.selected === true));
        }
        select.disabled = preset.locked || preset.busy || current.running === true || current.phase !== 'ready';
        select.title = preset.locked
          ? '首轮对话后代理预设已固定'
          : ((selectedPreset && selectedPreset.description) || '为新会话选择代理组合');
        select.addEventListener('change', () => vscode.postMessage({ type: 'select-agent-preset', agentPreset: select.value }));
        installDrop(select);
        chip.append(select);
        if (preset.locked) chip.append(node('span', 'preset-lock', '已锁定'));
        elements.modeChips.append(chip);
      }
      if (planActive) {
        const chip = node('span', 'plan-chip');
        chip.append(node('span', '', plan.pending ? '计划中…' : '计划'));
        const close = node('button', 'plan-chip-close', '✕'); close.type = 'button'; close.title = '退出计划模式'; close.setAttribute('aria-label', '退出计划模式'); close.disabled = current.running === true || plan.pending === true;
        close.addEventListener('click', () => vscode.postMessage({ type: 'select-mode', mode: 'normal' })); chip.append(close); elements.modeChips.append(chip);
      }
      let trash = elements.modeChips.querySelector('.clear-trash');
      if (!trash) {
        trash = node('button', 'icon-button clear-trash');
        trash.type = 'button';
        trash.setAttribute('aria-label', '清空本次会话草稿');
        trash.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v5M14 11v5"/></svg>';
        trash.addEventListener('click', clearDraftAll);
        elements.modeChips.append(trash);
      }
      updateTrashState(trash);
      const chipsVisible = Array.from(elements.modeChips.children).some(child => !child.classList.contains('hidden'));
      elements.modeChips.classList.toggle('hidden', !chipsVisible);
      elements.policyTrigger.classList.toggle('hidden', !available);
      elements.policyTrigger.classList.toggle('active', planActive);
      elements.policyTrigger.classList.toggle('full-access', selectedPermission && selectedPermission.value === 'danger-full-access');
      elements.policyTrigger.disabled = current.phase !== 'ready';
      const status = (plan.available === true ? (planActive ? '计划' : '普通') : '') + (selectedPermission ? (plan.available === true ? ' · ' : '') + selectedPermission.label : '');
      setTitleStable(elements.policyTrigger, status ? '模式与权限：' + status : '模式与权限');
      elements.policyTrigger.setAttribute('aria-label', elements.policyTrigger.title);
      elements.policyTrigger.setAttribute('aria-expanded', String(policyMenuOpen && available));

      elements.policyMenu.replaceChildren();
      if (plan.available === true) {
        elements.policyMenu.append(node('div', 'policy-section-label', '模式'));
        elements.policyMenu.append(
          policyMenuOption('普通', '在所选权限下正常工作。', !planActive, current.running === true || plan.pending === true, () => vscode.postMessage({ type: 'select-mode', mode: 'normal' })),
          policyMenuOption('计划', '先研究并制定方案，再动手修改。', planActive, current.running === true || plan.pending === true, () => vscode.postMessage({ type: 'select-mode', mode: 'plan' })),
        );
      }
      if (permissions.length > 0) {
        elements.policyMenu.append(node('div', 'policy-section-label', '权限'));
        for (const permission of permissions) {
          elements.policyMenu.append(policyMenuOption(
            permission.label,
            permission.description || permission.label,
            permission.selected === true,
            current.running === true,
            () => vscode.postMessage({ type: 'select-permission', permission: permission.value }),
          ));
        }
      }
      if (!available) policyMenuOpen = false;
      elements.policyMenu.classList.toggle('hidden', !policyMenuOpen || !available);
    }
    function formatTokens(value) {
      if (!Number.isFinite(value) || value < 0) return '0';
      if (value < 1000) return String(Math.round(value));
      // 3 位有效数字（24600→24.6K、1513680→1.51M）；Number() 兜底 toPrecision 的 '100'→'1' 与指数形式（100000→100K、999500→1M）
      const sig = n => String(Number(n.toPrecision(3)));
      if (value < 1000000) {
        const k = sig(value / 1000);
        return k === '1000' ? '1M' : k + 'K';
      }
      return sig(value / 1000000) + 'M';
    }
    function formatDuration(value) {
      if (!Number.isFinite(value) || value <= 0) return '0ms';
      if (value < 1000) return (value / 1000).toFixed(1).replace(/\\\.0$/, '') + 's';
      if (value < 60000) return (value / 1000).toFixed(value < 10000 ? 1 : 0) + 's';
      return (value / 60000).toFixed(1) + 'm';
    }
    function formatRate(tokens, ms) {
      return (tokens / (ms / 1000)).toFixed(1).replace(/\\\.0$/, '');
    }
    function usageStatsLine(usage, detail, twoDec) {
      const groups = [];
      const stats = usage && usage.sessionStats;
      if (stats && stats.steps > 0) {
        const headline = stats.turns + ' 轮 · ' + stats.steps + ' 步';
        const durations = [];
        if (stats.llmMs > 0) durations.push('LLM ' + formatDuration(stats.llmMs));
        if (stats.toolMs > 0) durations.push('工具 ' + formatDuration(stats.toolMs));
        const speeds = [];
        if (stats.ttftSteps > 0) speeds.push('首 token 均值 ' + formatDuration(stats.ttftMs / stats.ttftSteps));
        if (stats.decodeMs > 0) speeds.push(formatRate(stats.decodeTokens, stats.decodeMs) + ' tok/s');
        groups.push([headline, durations.join(' · '), speeds.join(' · ')].filter(Boolean).join(' · '));
      }
      const tokens = usage && usage.tokenUsage;
      if (tokens) {
        const input = tokens.uncachedInputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens;
        if (input > 0 || tokens.outputTokens > 0) {
          if (input > 0) groups.push('缓存命中 ' + (twoDec ? (tokens.cacheReadTokens / input * 100).toFixed(2) : Math.round(tokens.cacheReadTokens / input * 100)) + '%');
          groups.push('输入 ' + formatTokens(input) + ' · 输出 ' + formatTokens(tokens.outputTokens));
          if (detail) {
            groups.push('未命中 ' + formatTokens(tokens.uncachedInputTokens) + ' · 缓存读 ' + formatTokens(tokens.cacheReadTokens) + ' · 缓存写 ' + formatTokens(tokens.cacheWriteTokens));
            groups.push('上下文 ' + formatTokens(usage.usedTokens) + ' / ' + formatTokens(usage.contextWindow) + ' · ' + usage.percent + '% 已用');
          }
        }
      }
      return groups.join('  |  ');
    }
    function usageStatsSummary(usage, opts) {
      const ext = !!(opts && opts.ext);
      const stats = usage && usage.sessionStats;
      const tokens = usage && usage.tokenUsage;
      // C1 扩展排版：官方同款中文格式（2026-08-31 定稿）：
      //   "1 轮 · 32 步 | 首 token 平均 0.7s · 114 tok/s | 缓存命中 89.04% | 输入 1.7M tok · 输出 24.6K tok"
      if (ext) {
        const g = [];
        if (stats && stats.steps > 0) {
          g.push(stats.turns + ' 轮 · ' + stats.steps + ' 步');
          const speeds = [];
          if (stats.ttftSteps > 0) speeds.push('首 token 平均 ' + formatDuration(stats.ttftMs / stats.ttftSteps));
          if (stats.decodeMs > 0) speeds.push(formatRate(stats.decodeTokens, stats.decodeMs) + ' tok/s');
          if (speeds.length) g.push(speeds.join(' · '));
        }
        if (tokens) {
          const input = tokens.uncachedInputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens;
          if (input > 0 || tokens.outputTokens > 0) {
            if (input > 0) g.push('缓存命中 ' + (tokens.cacheReadTokens / input * 100).toFixed(2) + '%');
            g.push('输入 ' + formatTokens(input) + ' tok · 输出 ' + formatTokens(tokens.outputTokens) + ' tok');
          }
        }
        return g.join(' | ');
      }
      const groups = [];
      if (stats && stats.steps > 0) {
        groups.push(stats.turns + ' 轮');
        groups.push(stats.steps + ' 步');
      }
      if (tokens) {
        const input = tokens.uncachedInputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens;
        if (input > 0 || tokens.outputTokens > 0) {
          groups.push('输入 ' + formatTokens(input));
          groups.push('输出 ' + formatTokens(tokens.outputTokens));
          if (input > 0) groups.push('缓存命中 ' + (tokens.cacheReadTokens / input * 100).toFixed(2) + '%');
        }
      }
      return groups.join(' · ');
    }
    // ---- G3: 缓存命中率颜色连续渐变（原四档跳变）——分段线性 hue 插值，端点色相沿用原四色（红0/橙24/黄40/绿120）----
    function cacheHitColor(pct) {
      const p = Math.max(0, Math.min(100, pct));
      const stops = [[0, 0], [50, 0], [80, 24], [90, 40], [97, 90], [100, 120]];
      let from = stops[0]; let to = stops[stops.length - 1];
      for (let i = 1; i < stops.length; i++) {
        if (p <= stops[i][0]) { from = stops[i - 1]; to = stops[i]; break; }
      }
      const t = (p - from[0]) / ((to[0] - from[0]) || 1);
      const hue = from[1] + (to[1] - from[1]) * t;
      return 'hsl(' + hue.toFixed(1) + ', 70%, 60%)';
    }
    // 把摘要串渲染进容器并仅给命中率段上色（textContent 与纯文本一致）
    function renderSummarySpans(container, summary, ext) {
      container.textContent = '';
      const sep = ext ? ' | ' : ' · ';
      const parts = summary.split(sep);
      const idx = parts.findIndex(p => p.includes('%'));
      let color = null;
      if (idx >= 0) {
        const m = parts[idx].match(/([\\d.]+)%/);
        if (m) color = cacheHitColor(Number(m[1]));
      }
      parts.forEach((p, i) => {
        if (i) container.appendChild(document.createTextNode(sep));
        if (i === idx && color) {
          const s = document.createElement('span');
          s.style.color = color;
          s.textContent = p;
          container.appendChild(s);
        } else {
          container.appendChild(document.createTextNode(p));
        }
      });
    }
    // ---- C1: 峰谷时段判定（北京时区；2026-08-23 起周末全天空闲）---
    function usagePeriodTitle(peak) {
      return peak
        ? '高峰时段：北京时间工作日 09:00–12:00、14:00–18:00'
        : '空闲时段：北京时间工作日 12:00–14:00、18:00–次日 09:00；周末全天';
    }
    function beijingPeak(now = new Date()) {
      let weekday, hour, minute;
      try {
        const t = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Shanghai', hourCycle: 'h23',
          weekday: 'short', hour: '2-digit', minute: '2-digit',
        }).formatToParts(now);
        const part = k => (t.find(p => p.type === k) || {}).value ?? '';
        weekday = part('weekday');
        hour = Number(part('hour'));
        minute = Number(part('minute'));
      } catch {
        weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()];
        hour = now.getHours(); minute = now.getMinutes();
      }
      const minutes = hour * 60 + minute;
      const within = (a, b) => minutes >= a * 60 && minutes < b * 60;
      const weekend = weekday === 'Sat' || weekday === 'Sun';
      return { peak: !weekend && (within(9, 12) || within(14, 18)), weekend };
    }
    // ---- C1: 费用估算（价格表 = DeepSeek 官方刊例页，CNY 每百万 tokens）
    //      0.0.85（G9）: 价表更新为**现行价**（2026-09-10 12:00 北京时间起，官方页核对）——
    //      Flash 空闲 0.02/1/4（峰 ×2）；Pro 空闲 0.15/4.5/13.5（峰 ×2；官方页备注(2)：9/14 后 Pro 计费保持不变）。
    //      此为**回落后备**（无分段账本时用），正常路径由扩展侧账本按"事件时刻"分段计价。
    const PRICES = {
      flash: { peak: { hit: .04, miss: 2, out: 8 }, off: { hit: .02, miss: 1, out: 4 } },
      pro:   { peak: { hit: .3, miss: 9, out: 27 }, off: { hit: .15, miss: 4.5, out: 13.5 } },
    };
    const PRICE_ROWS = [
      /* 0.0.86: 官方现行模型名（旧名 deepseek-v4-flash / -vision-exp 由 V4.1-Flash 服务、按 Flash 价计费） */
      ['deepseek-flash', 'flash'],
      ['deepseek-v4-pro', 'pro'],
    ];
    // C1: 计价表随选中模型切换（flash/vision-exp → flash 单价，pro → pro 单价；未知回退 flash）
    function priceKeyFor(models) {
      const model = (models || []).find(m => m.selected === true);
      const name = String((model && (model.model || model.label)) || '');
      return /pro/i.test(name) ? 'pro' : 'flash';
    }
    function costOf(family, peak, tokenUsage) {
      const p = PRICES[family][peak ? 'peak' : 'off'];
      return {
        hit: (tokenUsage.cacheReadTokens * p.hit) / 1e6,
        miss: ((tokenUsage.uncachedInputTokens + tokenUsage.cacheWriteTokens) * p.miss) / 1e6,
        out: (tokenUsage.outputTokens * p.out) / 1e6,
      };
    }
    function formatCost(value) {
      return value >= 1 ? value.toFixed(2) : value.toPrecision(2);
    }
    /* 0.1.14（用户实测"悬停信息每步关闭又打开一次"）：原生 title 工具提示在 title 被**改写**时会
       自行关闭再弹——流式中"上下文用量/统计行/模式芯片"的 title 每步都在更新，鼠标停在上面就成了
       每步一闪。修法：悬停期间**冻结** title（记下待写值），mouseleave 时落笔——看着的提示稳定，
       离开后下次悬停即最新值。aria-label 不受影响（无障碍信息照常实时）。 */
    const stableTitleState = new WeakMap(); /* el -> { hovered, pending } */
    function armStableTitle(el) {
      if (el === null || el === undefined) return;
      const state = { hovered: false, pending: undefined };
      stableTitleState.set(el, state);
      el.addEventListener('mouseenter', () => { state.hovered = true; });
      el.addEventListener('mouseleave', () => {
        state.hovered = false;
        if (state.pending === undefined) return;
        const value = state.pending;
        state.pending = undefined;
        if (el.title !== value) el.title = value;
      });
    }
    function setTitleStable(el, text) {
      if (el === null || el === undefined) return;
      const next = String(text);
      const state = stableTitleState.get(el);
      if (state !== undefined && state.hovered) { state.pending = next; return; }
      if (el.title !== next) el.title = next;
    }
    function renderUsage(current) {
      const usage = current.usage || { available: false, percent: 0, usedTokens: 0, contextWindow: 0 };
      const stats = usageStatsSummary(usage, { ext: true });
      const peak = beijingPeak().peak;
      const light = node('span', 'usage-light ' + (peak ? 'peak' : 'off'));
      light.title = usagePeriodTitle(peak);
      const statsText = node('span', 'usage-stats-text');
      renderSummarySpans(statsText, stats, true);
      elements.usageStats.replaceChildren(...(usage.cost && usage.cost.pricingUnavailable ? [statsText] : [light, statsText]));
      setTitleStable(elements.usageStats, usageStatsLine(usage, true, true));
      elements.usageStats.classList.toggle('hidden', stats === '');
      elements.usageControl.classList.toggle('hidden', usage.available !== true);
      if (usage.available !== true) {
        usageOpen = false;
        elements.usagePanel.classList.add('hidden');
        elements.usageTrigger.setAttribute('aria-expanded', 'false');
        return;
      }
      const percent = Math.max(0, Math.min(100, Number(usage.percent) || 0));
      const circumference = 2 * Math.PI * 5.5;
      elements.usageFill.setAttribute('stroke-dasharray', (circumference * percent / 100) + ' ' + circumference);
      elements.usageTrigger.classList.toggle('warning', percent >= 75 && percent < 90);
      elements.usageTrigger.classList.toggle('danger', percent >= 90);
      /* aria-label 直接取源值（不读可能被冻结的 title）——无障碍信息保持实时。 */
      const triggerTitle = '上下文 ' + percent + '% 已用';
      setTitleStable(elements.usageTrigger, triggerTitle);
      elements.usageTrigger.setAttribute('aria-label', triggerTitle);
      elements.usageTrigger.setAttribute('aria-expanded', String(usageOpen));
      elements.usagePanel.replaceChildren();
      if (usageOpen) {
        const header = node('div', 'usage-header');
        header.append(node('span', '', '上下文'), node('span', 'usage-percent', percent + '% 已用'), node('span', 'usage-figures', '~' + formatTokens(usage.usedTokens) + ' / ' + formatTokens(usage.contextWindow)));
        const bar = node('div', 'usage-bar');
        const breakdown = usage.breakdown;
        /* C3: dsh-context 投影在场时弹窗升级为 6 段（官方同词条/同色板）；缺席回落 3 段旧观感 */
        const composition = current.context && current.context.available ? current.context.current : undefined;
        const parts = composition
          ? CONTEXT_CATS.map(cat => ({ key: cat.key, label: cat.label, className: 'ctx-cat-' + cat.key }))
          : breakdown ? [
            { key: 'systemTokens', label: '系统提示词', className: 'usage-system' },
            { key: 'toolsTokens', label: '工具', className: 'usage-tools' },
            { key: 'messageTokens', label: '消息', className: 'usage-messages' },
          ] : [];
        const source = composition || breakdown;
        const total = source ? parts.reduce((sum, part) => sum + Number(source[part.key] || 0), 0) : 0;
        if (total > 0) {
          for (const part of parts) {
            const width = percent * Number(source[part.key] || 0) / total;
            if (width <= 0) continue;
            const segment = node('span', 'usage-segment ' + part.className); segment.style.width = width + '%'; bar.append(segment);
          }
        } else {
          const segment = node('span', 'usage-segment ' + (composition ? 'ctx-cat-tool' : 'usage-messages')); segment.style.width = percent + '%'; bar.append(segment);
        }
        elements.usagePanel.append(header, bar);
        if (source) {
          const rows = node('dl', 'usage-rows ctx-legend');
          for (const part of parts) {
            const row = node('div', 'usage-row');
            const term = node('dt', ''); term.append(node('span', 'usage-swatch ' + part.className), document.createTextNode(part.label));
            row.append(term, node('dd', '', '~' + formatTokens(source[part.key]))); rows.append(row);
          }
          elements.usagePanel.append(rows);
        }
        if (composition) {
          const detail = node('button', 'usage-detail', '查看详情');
          detail.title = '打开上下文面板';
          detail.addEventListener('click', () => openContextPanel());
          elements.usagePanel.append(detail);
        }
        if (usage.cost && usage.cost.pricingUnavailable) {
          const note = node('section', 'usage-cost');
          note.append(node('b', '', '费用暂不估算'), node('div', 'usage-cost-note', '连接定价尚未核实，token 用量照常显示。'));
          elements.usagePanel.append(note);
        } else if (usage.tokenUsage || (usage.cost && usage.cost.rows.length > 0)) {
          const costSec = node('section', 'usage-cost');
          const costHead = node('div', 'usage-cost-head');
          const tag = node('span', 'usage-cost-tag ' + (peak ? 'peak' : 'off'), peak ? '高峰原价' : '空闲半价');
          tag.title = usagePeriodTitle(peak);
          const ledgerCost = usage.cost;
          const segmented = ledgerCost !== undefined && ledgerCost.rows.length > 0;
          const meter = ledgerCost === undefined ? undefined : ledgerCost.costMeter;
          costHead.append(node('b', '', meter !== undefined ? '费用（dsh-cost-meter）' : segmented ? '费用（按各段当时价）' : '费用估算'), tag);
          const costRows = node('dl', 'usage-rows');
          const rowsSpec = [];
          if (meter !== undefined) {
            /* J4: 装了 dsh-cost-meter → 直接显示它的精确账本（只读，来源标注） */
            rowsSpec.push(['dsh-cost-meter 总额', '¥' + formatCost(meter.cost), true]);
            for (const [model, value] of Object.entries(meter.byModel)) rowsSpec.push([model, '¥' + formatCost(value), false]);
          } else if (segmented && ledgerCost !== undefined) {
            /* J2: 逐段（模型族 × 峰谷 × 价表时代）按**事件时刻**计价 */
            rowsSpec.push(['累计（各段按当时价）', '¥' + formatCost(ledgerCost.total.total), true]);
            for (const row of ledgerCost.rows) {
              const label = (row.family === 'pro' ? 'Pro' : 'Flash') + ' · ' + (row.peak ? '高峰' : '空闲') + (row.era === 'aug' ? '（8月价）' : '');
              rowsSpec.push([label, '¥' + formatCost(row.cost.total), false]);
            }
            rowsSpec.push(['输入 命中 / 未命中', '¥' + formatCost(ledgerCost.total.hit) + ' + ¥' + formatCost(ledgerCost.total.miss), false]);
            rowsSpec.push(['输出（含思考）', '¥' + formatCost(ledgerCost.total.out), false]);
            if (ledgerCost.unsegmentedTokens > 0) {
              /* 0.1.10：残留按"已统计部分的命中/未命中构成"折算（旧口径一律按未命中价放大约 50×）。 */
              rowsSpec.push(['历史未分段 ~' + formatTokens(ledgerCost.unsegmentedTokens) + ' tokens（按已统计构成估算）', '¥' + formatCost(ledgerCost.unsegmentedCost), false]);
            }
          } else if (usage.tokenUsage) {
            const c = costOf(priceKeyFor(current.models), peak, usage.tokenUsage);
            const cost = c.hit + c.miss + c.out;
            rowsSpec.push(['估算（未分段，当前' + (peak ? '高峰' : '空闲') + '单价）', '¥' + formatCost(cost), true]);
            rowsSpec.push(['输入 命中 / 未命中', '¥' + formatCost(c.hit) + ' + ¥' + formatCost(c.miss), false]);
            rowsSpec.push(['输出（含思考）', '¥' + formatCost(c.out), false]);
          }
          for (const [label, value, big] of rowsSpec) {
            const r = node('div', 'usage-row');
            r.append(node('dt', '', label));
            r.append(node('dd', big ? 'amt' : '', value));
            costRows.append(r);
          }
          const prices = node('details', 'usage-cost-prices');
          const psum = document.createElement('summary');
          /* 0.0.87: 只列谷价 + 「高峰 ×2」注记（官方规则两族都恰为 2 倍）——宽度减半，窄侧栏不再需要横向滚动。 */
          psum.textContent = '每百万 tokens 价格（空闲价；高峰 ×2）';
          prices.append(psum);
          const tbl = node('table', '');
          const headRow = node('tr', '');
          headRow.append(node('th', '', ''), node('th', '', '缓存命中'), node('th', '', '未命中'), node('th', '', '输出'));
          tbl.append(headRow);
          for (const [name, key] of PRICE_ROWS) {
            const tr = node('tr', '');
            const p = PRICES[key];
            tr.append(
              node('td', '', name),
              node('td', '', '¥' + p.off.hit),
              node('td', '', '¥' + p.off.miss),
              node('td', '', '¥' + p.off.out),
            );
            tbl.append(tr);
          }
          prices.append(tbl);
          costSec.append(costHead, costRows, prices, node('div', 'usage-cost-note',
            '高峰 = 北京时间工作日 09:00–12:00、14:00–18:00，其余时间半价（周末全天）。'));
          elements.usagePanel.append(costSec);
        }
      }
      elements.usagePanel.classList.toggle('hidden', !usageOpen);
    }
    /* ---- C3 (0.0.69): 上下文面板（数据源 = dsh-context 投影派生；词条与官方 zh 词典一致） ---- */
    const CONTEXT_CATS = [
      { key: 'system', label: '系统提示词' },
      { key: 'tools', label: '工具定义' },
      { key: 'user', label: '用户消息' },
      { key: 'inject', label: '注入内容' },
      /* 0.0.130：dsh-context v0.9 新增类目（技能注入）——次序与插件 current 一致。 */
      { key: 'skill', label: '技能注入' },
      { key: 'assistant', label: '助手消息' },
      { key: 'tool', label: '工具结果' },
    ];
    const CONTEXT_FORM_LABELS = { instructions: '指令注入', catalog: '目录更新', snapshot: '状态快照', notice: '通知', relay: '代理转发', recall: '历史召回', context: '上下文注入' };
    const CONTEXT_KIND_BADGES = { inject: '注入', compaction: '压缩', prune: '剪枝', model: '切换', mode: '模式' };
    function contextEventLabel(ev) {
      if (ev.kind === 'compaction') return '压缩上下文' + (ev.count ? '（摘要替换 ' + ev.count + ' 条消息）' : '');
      if (ev.kind === 'prune') return '剪枝工具输出';
      if (ev.kind === 'model') return '模型切换：' + (ev.from || '?') + ' → ' + (ev.to || '?');
      if (ev.kind === 'mode') {
        if (ev.name === 'plan.on') return '进入计划模式';
        if (ev.name === 'plan.off') return '退出计划模式';
        return '模式切换' + (ev.name ? '：' + ev.name : '');
      }
      if (ev.sub === 'skill') return 'Skill 注入（' + (ev.name || '?') + '）';
      const base = CONTEXT_FORM_LABELS[ev.form || 'context'] || '上下文注入';
      return base + (ev.name ? ' · ' + ev.name : '') + (ev.detail ? ' · ' + ev.detail : '');
    }
    function contextEventPosition(ev) {
      if (typeof ev.turn !== 'number' || typeof ev.step !== 'number') return '';
      if ((ev.kind === 'compaction' || ev.kind === 'prune') && typeof ev.fromTurn === 'number' && typeof ev.fromStep === 'number') {
        if (ev.fromTurn === ev.turn) return '第' + ev.turn + '轮 ' + ev.fromStep + '→' + ev.step + '步';
        return '第' + ev.fromTurn + '轮' + ev.fromStep + '步 → 第' + ev.turn + '轮' + ev.step + '步';
      }
      return '第' + ev.turn + '轮·第' + ev.step + '步';
    }
    function contextClock(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return '';
      const d = new Date(ms);
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    function hideContextTip() { elements.ctxTip.classList.add('hidden'); }
    function positionContextTip(event) {
      const tip = elements.ctxTip;
      const x = Math.min(event.clientX + 10, window.innerWidth - tip.offsetWidth - 8);
      const y = Math.min(event.clientY + 12, window.innerHeight - tip.offsetHeight - 8);
      tip.style.left = Math.max(6, x) + 'px';
      tip.style.top = Math.max(6, y) + 'px';
    }
    function contextRequestTip(request) {
      const tipNodes = [node('div', 'ctx-tip-h', '第 ' + request.turn + ' 轮 · 第 ' + request.step + ' 步')];
      const rows = node('div', '');
      for (const cat of CONTEXT_CATS) {
        const value = Number(request[cat.key] || 0);
        if (value <= 0) continue;
        const row = node('div', 'ctx-tip-row');
        row.append(node('span', '', cat.label), node('span', '', '~' + formatTokens(value)));
        rows.append(row);
      }
      const sumRow = node('div', 'ctx-tip-row');
      sumRow.append(node('b', '', '合计'), node('b', '', '≈ ' + formatTokens(request.total)));
      rows.append(sumRow);
      tipNodes.push(rows);
      if (request.prompt !== undefined || request.output !== undefined) {
        const actual = node('div', 'ctx-tip-actual');
        const figures = [];
        if (request.prompt !== undefined) figures.push('输入 ' + formatTokens(request.prompt));
        if (request.cacheRead !== undefined) figures.push('缓存 ' + formatTokens(request.cacheRead));
        if (request.output !== undefined) figures.push('输出 ' + formatTokens(request.output));
        actual.textContent = '实际 ' + figures.join(' · ');
        tipNodes.push(actual);
      }
      return tipNodes;
    }
    /* ---- C3 v1.1：组成明细——展开态/内容缓存（跨重渲染保持；会话切换时清空） ---- */
    const contextOpenGroups = new Set();
    const contextOpenItems = new Set();
    const contextDetailCache = new Map();
    const contextDetailPending = new Set();
    let contextDetailSeq = 0;
    let renderedContextSession = '';
    const CONTEXT_GROUP_ORDER = [
      { key: 'system', label: '系统提示词' },
      { key: 'tools', label: '工具定义' },
      { key: 'user', label: '用户消息' },
      { key: 'inject', label: '注入内容' },
      { key: 'skill', label: '技能注入' },
      { key: 'assistant', label: '助手消息' },
      { key: 'tool', label: '工具结果' },
    ];
    function requestContextDetail(key, request) {
      if (contextDetailPending.has(key)) return;
      contextDetailPending.add(key);
      contextDetailSeq += 1;
      vscode.postMessage({ type: 'context-detail', sessionId: state ? state.sessionId : '', requestId: contextDetailSeq, key: key, request: request });
    }
    /* 无文本条目（工具结果 / 纯工具调用的助手消息）：静态提示，不发请求 */
    function contextItemStaticHint(item) {
      if (!item) return undefined;
      if (item.cat === 'tool') return '工具结果正文见聊天（投影仅含名称与用量）';
      if (item.cat === 'assistant' && item.preview === undefined && item.calls && item.calls.length) return '该条为工具调用（' + item.calls.join('、') + '）；正文见聊天';
      return undefined;
    }
    function contextItemRow(key, label, tokens, request, item) {
      const wrap = node('div', 'ctx-item');
      const head = node('div', 'ctx-item-head');
      head.append(node('span', 'ctx-item-preview', label));
      if (item && item.err === true) head.append(node('span', 'ctx-item-err', '失败'));
      if (item && item.imgs) head.append(node('span', 'ctx-item-dim', '图片 ×' + item.imgs));
      if (item && item.calls && item.calls.length && String(label).indexOf('调用 ') !== 0) {
        head.append(node('span', 'ctx-item-dim', '调用 ' + item.calls.join('、')));
      }
      if (tokens !== undefined) head.append(node('span', 'ctx-item-tokens', '~' + formatTokens(tokens)));
      const expanded = contextOpenItems.has(key);
      const hint = contextItemStaticHint(item);
      head.addEventListener('click', () => {
        if (contextOpenItems.has(key)) contextOpenItems.delete(key);
        else {
          contextOpenItems.add(key);
          if (hint === undefined && !contextDetailCache.has(key)) requestContextDetail(key, request);
        }
        renderedContextState = undefined;
        if (state) renderContextPanel(state);
      });
      wrap.append(head);
      if (expanded) {
        const missing = '内容不可用（可能已超出保留范围，或该条目无文本）。';
        if (hint !== undefined) wrap.append(node('div', 'ctx-detail-hint', hint));
        else if (contextDetailPending.has(key)) wrap.append(node('div', 'ctx-detail-hint', '加载中…'));
        else {
          const cached = contextDetailCache.get(key);
          if (cached === undefined || cached.error === true) wrap.append(node('div', 'ctx-detail-hint', missing));
          else {
            let any = false;
            if (cached.text !== undefined) {
              wrap.append(node('div', 'ctx-detail-text', cached.text));
              if (cached.capped === true) wrap.append(node('div', 'ctx-detail-hint', '（该条为投影摘要，正文上限 80 字符；完整内容见聊天）'));
              any = true;
            }
            if (Array.isArray(cached.images)) {
              for (const image of cached.images) {
                const src = imageSrc(string(image && image.mediaType), string(image && image.data));
                if (src === undefined) continue;
                const el = document.createElement('img');
                el.className = 'ctx-detail-img';
                el.src = src;
                el.alt = '图片';
                el.draggable = false;
                el.title = '点击放大预览';
                el.addEventListener('click', () => {
                  /* 0.0.167（B4 P2）：上下文明细里的多图同样支持 ←/→ 切换。 */
                  const siblings = [...wrap.querySelectorAll('.ctx-detail-img')];
                  const gallery = siblings.map(entry => ({ src: entry.src, name: entry.alt || '图片' }));
                  const index = Math.max(0, siblings.indexOf(el));
                  openImagePreview(src, gallery.length > 1 ? { gallery, galleryIndex: index } : undefined);
                });
                wrap.append(el);
                any = true;
              }
            }
            if (cached.description !== undefined) { wrap.append(node('div', 'ctx-detail-text', cached.description)); any = true; }
            if (cached.schema !== undefined) {
              let schemaText = '';
              try { schemaText = JSON.stringify(cached.schema, null, 2); } catch (_) { schemaText = ''; }
              if (schemaText) { wrap.append(node('div', 'ctx-detail-text', schemaText)); any = true; }
            }
            if (!any) wrap.append(node('div', 'ctx-detail-hint', missing));
          }
        }
      }
      return wrap;
    }
    function renderContextGroupBody(groupKey, context) {
      const body = node('div', 'ctx-group-body');
      if (groupKey === 'system') {
        const tokens = context.current ? context.current.system : undefined;
        body.append(contextItemRow('sys', context.systemPreview || '（系统提示词）', tokens, { kind: 'system' }, undefined));
        return body;
      }
      if (groupKey === 'tools') {
        const tools = context.tools || [];
        if (tools.length === 0) body.append(node('div', 'ctx-empty', '（无工具定义）'));
        for (const tool of tools) {
          body.append(contextItemRow('tool:' + tool.name, tool.name, tool.tokens, { kind: 'tool', name: tool.name }, undefined));
        }
        return body;
      }
      const items = (context.items || []).filter(item => item.cat === groupKey);
      if (items.length === 0) body.append(node('div', 'ctx-empty', '（无条目）'));
      for (const item of items) {
        let label = item.preview || '';
        if (item.cat === 'skill' && label === '') label = item.name ? String(item.name) : (item.skill ? String(item.skill) : '技能注入');
        if (item.cat === 'tool' && label === '') label = item.tool ? String(item.tool) : '工具结果';
        if (label === '' && item.imgs) label = '图片消息';
        if (label === '' && item.calls && item.calls.length) label = '调用 ' + item.calls.join('、');
        if (label === '') label = '（空）';
        body.append(contextItemRow('node:' + item.seq, label, item.tokens, { kind: 'node', seq: item.seq }, item));
      }
      return body;
    }
    function formatUpdateTime(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return '—';
      const d = new Date(ms);
      const pad = value => String(value).padStart(2, '0');
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    function renderContextPanel(current) {
      const body = elements.contextBody;
      const context = current.context;
      const prevScroll = body.scrollTop;
      if (!context || !context.available) {
        body.replaceChildren(node('div', 'ctx-empty', '未检测到上下文数据——需在 dsh 中安装并启用 dsh-context 插件。'));
        return;
      }
      const usage = current.usage || { percent: 0, usedTokens: 0, contextWindow: 0 };
      const percent = Math.max(0, Math.min(100, Number(usage.percent) || 0));
      const cards = [];
      const overview = node('section', 'context-card');
      overview.append(node('div', 'context-card-title', '当前上下文'));
      const headline = node('div', 'ctx-headline');
      headline.append(
        node('b', 'ctx-percent', percent + '%'),
        node('span', 'ctx-model', context.model ? context.model + ' · 已用' : '已用'),
        node('span', 'ctx-figures', '~' + formatTokens(usage.usedTokens) + ' / ' + formatTokens(usage.contextWindow)),
      );
      overview.append(headline);
      if (context.current) {
        const composition = context.current;
        const total = composition.total;
        const bar = node('div', 'ctx-bar');
        for (const cat of CONTEXT_CATS) {
          const value = Number(composition[cat.key] || 0);
          const width = total > 0 ? percent * value / total : 0;
          if (width <= 0) continue;
          const segment = node('span', 'ctx-seg ctx-cat-' + cat.key);
          segment.style.width = width + '%';
          segment.title = cat.label + ' ~' + formatTokens(value);
          bar.append(segment);
        }
        overview.append(bar);
        const legend = node('dl', 'usage-rows ctx-legend');
        for (const cat of CONTEXT_CATS) {
          const value = Number(composition[cat.key] || 0);
          const row = node('div', 'usage-row');
          const term = node('dt', '');
          term.append(node('span', 'usage-swatch ctx-cat-' + cat.key), document.createTextNode(cat.label));
          row.append(term, node('dd', '', '~' + formatTokens(value) + (total > 0 ? ' · ' + Math.round(value / total * 100) + '%' : '')));
          legend.append(row);
        }
        overview.append(legend);
      } else {
        overview.append(node('div', 'ctx-empty', '暂无组成数据。'));
      }
      cards.push(overview);
      /* v1.1：组成明细（6 类分组；条目内容按需加载） */
      const detailCard = node('section', 'context-card');
      detailCard.append(node('div', 'context-card-title', '组成明细'));
      if (context.droppedNodes > 0) {
        detailCard.append(node('div', 'ctx-detail-note', '更早的 ' + context.droppedNodes + ' 条内容已超出展示窗口'));
      }
      if (context.itemsTruncated === true) {
        // 50 = 扩展侧 CONTEXT_ITEMS_PER_CAT_LIMIT（webview 脚本无法 import，此处同步文案）
        detailCard.append(node('div', 'ctx-detail-note', '每类仅显示最近 50 条'));
      }
      const groups = node('div', 'ctx-groups');
      for (const spec of CONTEXT_GROUP_ORDER) {
        const group = node('div', 'ctx-group' + (contextOpenGroups.has(spec.key) ? ' open' : ''));
        const head = node('div', 'ctx-group-head');
        const caret = node('span', 'ctx-group-caret');
        caret.innerHTML = CHEVRON_DOWN_SVG;
        let count = 0;
        let groupTokens = 0;
        if (spec.key === 'system') {
          count = context.current ? 1 : 0;
          groupTokens = context.current ? context.current.system : 0;
        } else if (spec.key === 'tools') {
          count = (context.tools || []).length;
          groupTokens = context.current ? context.current.tools : 0;
        } else {
          count = context.itemsCount ? Number(context.itemsCount[spec.key] || 0) : 0;
          groupTokens = context.current ? Number(context.current[spec.key] || 0) : 0;
        }
        head.append(
          caret,
          node('span', 'usage-swatch ctx-cat-' + spec.key),
          node('span', 'ctx-group-name', spec.label),
          node('span', 'ctx-group-meta', count + ' 项 · ~' + formatTokens(groupTokens)),
        );
        head.addEventListener('click', () => {
          if (contextOpenGroups.has(spec.key)) contextOpenGroups.delete(spec.key);
          else contextOpenGroups.add(spec.key);
          renderedContextState = undefined;
          if (state) renderContextPanel(state);
        });
        group.append(head);
        if (contextOpenGroups.has(spec.key)) group.append(renderContextGroupBody(spec.key, context));
        groups.append(group);
      }
      detailCard.append(groups);
      cards.push(detailCard);
      const statsCard = node('section', 'context-card');
      statsCard.append(node('div', 'context-card-title', '上下文统计'));
      const grid = node('div', 'ctx-stats');
      const usageStats = usage.sessionStats;
      const tokenUsage = usage.tokenUsage;
      let cacheHit = '—';
      if (tokenUsage) {
        const input = tokenUsage.uncachedInputTokens + tokenUsage.cacheReadTokens + tokenUsage.cacheWriteTokens;
        if (input > 0) cacheHit = (tokenUsage.cacheReadTokens / input * 100).toFixed(2) + '%';
      }
      /* 0.1.2 守卫：dsh-context 数据降级（无 counts）时面板此前整块渲染崩（空面板）——缺项显示 0/—。 */
      const counts = context.counts || {};
      const statItems = [
        [usageStats ? String(usageStats.turns) : '—', '轮次'],
        [usageStats ? String(usageStats.steps) : '—', '步数'],
        [String(counts.injects ?? 0), '注入'],
        [String(counts.compactions ?? 0), '压缩'],
        [String(counts.prunes ?? 0), '剪枝'],
        [String(context.toolCalls ?? 0), '工具调用'],
        [String(context.images ?? 0), '图片'],
        [cacheHit, '缓存命中'],
      ];
      for (const item of statItems) {
        const stat = node('div', 'ctx-stat');
        stat.append(node('b', '', item[0]), node('span', '', item[1]));
        grid.append(stat);
      }
      statsCard.append(grid);
      cards.push(statsCard);
      const trendCard = node('section', 'context-card');
      trendCard.append(node('div', 'context-card-title', '上下文趋势'));
      const requests = context.requests || [];
      if (requests.length === 0) {
        trendCard.append(node('div', 'ctx-empty', '发起一轮对话后，这里会展示每次模型请求的上下文构成。'));
      } else {
        const cuts = new Map();
        for (const ev of context.cuts || []) {
          if (typeof ev.turn !== 'number' || typeof ev.step !== 'number') continue;
          cuts.set(ev.turn + ':' + ev.step, ev);
        }
        let max = 0;
        for (const request of requests) max = Math.max(max, request.total);
        const trend = node('div', 'ctx-trend');
        for (const request of requests) {
          const column = node('div', 'ctx-barcol');
          const stack = node('div', 'ctx-stack');
          stack.style.height = max > 0 ? Math.max(1, request.total / max * 100) + '%' : '0%';
          for (const cat of CONTEXT_CATS) {
            const value = Number(request[cat.key] || 0);
            if (value <= 0) continue;
            const segment = node('span', 'ctx-seg ctx-cat-' + cat.key);
            segment.style.height = request.total > 0 ? value / request.total * 100 + '%' : '0%';
            stack.append(segment);
          }
          column.append(stack);
          const cut = cuts.get(request.turn + ':' + request.step);
          if (cut) {
            const mark = node('span', 'ctx-cut', '✂');
            mark.title = contextEventLabel(cut);
            column.append(mark);
          }
          column.addEventListener('mouseenter', event => { elements.ctxTip.replaceChildren.apply(elements.ctxTip, contextRequestTip(request)); elements.ctxTip.classList.remove('hidden'); positionContextTip(event); });
          column.addEventListener('mousemove', positionContextTip);
          column.addEventListener('mouseleave', hideContextTip);
          trend.append(column);
        }
        trendCard.append(trend);
      }
      cards.push(trendCard);
      const eventsCard = node('section', 'context-card');
      eventsCard.append(node('div', 'context-card-title', '上下文事件'));
      const events = (context.events || []).slice().reverse();
      if (events.length === 0) {
        eventsCard.append(node('div', 'ctx-empty', '暂无上下文事件（压缩、注入、模型切换会出现在这里）。'));
      } else {
        const list = node('div', 'ctx-events');
        for (const ev of events) {
          const row = node('div', 'ctx-event');
          row.append(node('span', 'ctx-event-badge ' + ev.kind, CONTEXT_KIND_BADGES[ev.kind] || ev.kind));
          row.append(node('span', 'ctx-event-main', contextEventLabel(ev)));
          if (ev.tokens !== 0) row.append(node('span', 'ctx-event-tokens', (ev.tokens < 0 ? '−' : '+') + formatTokens(Math.abs(ev.tokens))));
          row.append(node('span', 'ctx-event-pos', contextEventPosition(ev) || contextClock(ev.time)));
          list.append(row);
        }
        eventsCard.append(list);
      }
      cards.push(eventsCard);
      body.replaceChildren.apply(body, cards);
      /* v1.1：数据更新/展开切换后保持滚动位置（避免每次推进跳回顶部） */
      if (prevScroll > 0) body.scrollTop = prevScroll;
    }
    // ---- G1: 峰谷灯定时刷新（用户发现只有点击圆环后峰谷指示才更新）——30s 轮询，时段翻转时重渲染 ----
    /* 不能以 usage.available 为条件（0.0.57 修复）：灯渲染在统计行内、与 available 无关；
       当运行时未上报 contextPressure 数值（available=false，如刚创建的会话）时会跳过重渲染，
       灯冻结在旧时段、直到下一次全量渲染（切会话）才纠正。 */
    let lastPeakState = beijingPeak().peak;
    setInterval(() => {
      const peak = beijingPeak().peak;
      if (peak !== lastPeakState) {
        lastPeakState = peak;
        if (state) renderUsage(state);
      }
    }, 30000);
    function sameSelection(left, right) {
      return left && right && left.path === right.path && left.startLine === right.startLine && left.endLine === right.endLine;
    }
    function contextLabel(reference) {
      if (reference.kind !== 'selection') {
        if (reference.path.includes('.dsh-paste')) return displayFileName(reference.path);
        return reference.path;
      }
      const lines = reference.startLine === reference.endLine ? 'L' + reference.startLine : 'L' + reference.startLine + '–' + reference.endLine;
      return reference.path + ' ' + lines + (reference.truncated ? ' (truncated)' : '');
    }
    /* G10: Material Icon Theme file-type badge icon (b64 data URL, CSP img-src data:).
       Unknown extensions fall back to the file.svg default; image extensions resolve via
       the shared 'image' key. The old text abbreviation map (PDF/DOC/…) is gone. */
    function fileTypeIconEl(name, kind) {
      const dot = name.lastIndexOf('.');
      const extension = (dot >= 0 ? name.slice(dot + 1).toLowerCase() : name.toLowerCase());
      const icon = document.createElement('img');
      icon.draggable = false;
      const key = FILE_TYPE_ICON_EXT[extension];
      icon.src = (key && FILE_TYPE_ICON_DATA[key]) || FILE_TYPE_ICON_DEFAULT;
      icon.alt = kind || 'file';
      return icon;
    }
    /* Stored names carry a Date.now() prefix (extension.ts storedName). Strip it for
       display only — the real on-disk name (with prefix) stays in titles/captions. */
    function displayFileName(name) {
      const base = string(name).split(/[\\\\/]/).pop() || '';
      return base.replace(/^\\d{10,}-/, '');
    }
    function clearDraftAll() {
      elements.prompt.value = '';
      /* 2026-09-25（用户复测反馈：点垃圾桶能否正确删除"所有"草稿）：**乐观全清**——文本/图片/pinned
         就地清掉并立即刷新草稿区，不等扩展回包。此前只清文本 ⇒ 点完垃圾桶垃圾桶与芯片仍在（要等回包才消失）；
         扩展侧 clear-draft 仍会清持久化草稿与 paste pin，回包再确认一次（幂等）。 */
      draftImages = [];
      renderAttachments();
      ideContext = { ...(ideContext || {}), pinned: [] };
      renderIdeContext();
      if (lastDraftSessionId) draftSlots.delete(lastDraftSessionId);
      syncDraftZoneVisibility();
      vscode.postMessage({ type: 'clear-draft' });
    }
    /* —— G10 右键菜单（文件/图片自定义 context menu，仿 Windows 右键；不含"打开"——左键已覆盖） —— */
    let ctxMenuOpen = false;
    /* G29 round2 (0.0.55): 侧栏内轻提示（~1.8s 自动淡出；位置贴输入框上沿，绝不遮挡 composer） */
    let toastTimer;
    function showToast(text, warn) {
      const el = elements.toast;
      if (!el) return;
      el.textContent = String(text || '');
      el.classList.toggle('warn', warn === true);
      const composer = document.querySelector('.composer');
      if (composer) el.style.bottom = Math.max(12, Math.round(window.innerHeight - composer.getBoundingClientRect().top + 10)) + 'px';
      void el.offsetWidth;
      el.classList.add('show');
      clearTimeout(toastTimer);
      /* 0.0.164（B3 审查 P1-7）：时长统一到「提示条显示时长」（ui.hintSeconds；此前写死 1800ms）。 */
      toastTimer = setTimeout(() => el.classList.remove('show'), hintMs());
    }
    function closeCtxMenu() {
      const menu = elements.ctxMenu;
      if (ctxMenuOpen && menu) { menu.classList.add('hidden'); ctxMenuOpen = false; }
    }
    function ctxMenuOption(label, handler) {
      const option = node('button', 'ctx-option');
      const title = node('span', 'ctx-option-title', label);
      option.append(title);
      option.addEventListener('click', (event) => { event.stopPropagation(); closeCtxMenu(); handler(); });
      return option;
    }
    function showCtxMenu(x, y, build) {
      const menu = elements.ctxMenu;
      menu.replaceChildren();
      const items = build(menu);
      for (const item of items) menu.append(item);
      menu.classList.remove('hidden');
      /* 视口边界钳制（右/下翻转） */
      const rect = menu.getBoundingClientRect();
      const px = Math.min(x, window.innerWidth - rect.width - 6);
      const py = Math.min(y, window.innerHeight - rect.height - 6);
      menu.style.left = Math.max(6, px) + 'px';
      menu.style.top = Math.max(6, py) + 'px';
      ctxMenuOpen = true;
    }
    function ctxMenuFor(target) {
      if (!target || typeof target.closest !== 'function') return undefined;
      const host = target.closest('.attachment-chip, .context-chip, .image-card, .image-card-status, .file-card');
      return host && host.__ctx ? host.__ctx : undefined;
    }
    /* ---- C3 (0.0.69): 上下文面板（数据源 = dsh-context 投影，经 state.context 下发） ---- */
    let contextPanelOpen = false;
    let renderedContextState;
    /* ---- G6 v1（0.0.62）: 设置台面板（侧栏内自绘；写通道 = set-config → Global 配置 → 热更回流） ---- */
    let settingsPanelOpen = false;
    let renderedSettingsKey = '';
    let dshSettings = null;
    let dshSettingsPending = false;
    /* 0.0.65（用户反馈④）: 展开态与就地更新——修改配置不再整页重拉，展开的 ns 与滚动位置保持。 */
    const dshOpenNs = new Set();
    const pendingDshEdits = [];
    let connectionsView;
    let connectionsExpanded = false;
    let connectionsBusy = false;
    let connectionsRequest = 0;
    let connectionsMessage = '';
    let connectionDraft;
    let connectionCandidates = [];
    function connectionRequest(operation, payload) {
      if (connectionsBusy) return;
      connectionsBusy = true;
      connectionsMessage = operation === 'discover-connection-models' ? '正在读取模型目录…' : '处理中…';
      vscode.postMessage({ type: operation, requestId: ++connectionsRequest, ...(payload || {}) });
      renderSettingsPanel();
    }
    function editConnection(item) {
      connectionDraft = item ? { ...item, models: (item.models || []).map(model => ({ ...model })), apiKey: '' }
        : { name: '新连接', vendor: 'custom', baseURL: '', api: 'openai-completions', models: [], apiKey: '', revision: connectionsView ? connectionsView.revision : 0 };
      connectionCandidates = [];
      connectionsMessage = '';
      renderSettingsPanel();
    }
    function renderConnectionsSection() {
      const section = settingsSection('模型与连接');
      section.id = 'modelConnectionsSection';
      const toggle = settingsAction(connectionsExpanded ? '收起' : '管理连接', () => {
        connectionsExpanded = !connectionsExpanded;
        if (!connectionsExpanded && connectionDraft) connectionDraft.apiKey = '';
        renderSettingsPanel();
        document.getElementById('modelConnectionsToggle')?.focus({ preventScroll: true });
      });
      toggle.id = 'modelConnectionsToggle';
      toggle.setAttribute('aria-expanded', String(connectionsExpanded));
      toggle.setAttribute('aria-controls', 'modelConnectionsManager');
      const hint = connectionsView ? '已配置 ' + (connectionsView.items || []).length + ' 条连接；日常切换模型在输入区。' : '配置厂商、接口、密钥和模型；日常切换模型在输入区。';
      const summary = settingsRow('连接管理', hint + (!connectionsExpanded && connectionDraft ? ' 有未保存的编辑，密钥需重新输入。' : ''), toggle);
      summary.classList.add('connections-summary');
      section.append(summary);
      const manager = node('div', 'connections-manager');
      manager.id = 'modelConnectionsManager';
      section.append(manager);
      if (!connectionsExpanded) { manager.hidden = true; return section; }
      manager.append(node('div', 'settings-row-hint', '连接配置由当前运行时管理。密钥只写入凭据服务，不回显。'));
      if (!state || state.phase !== 'ready') { manager.append(node('div', 'settings-row-hint', '运行时就绪后可管理连接。')); return section; }
      if (!connectionsView) {
        manager.append(settingsAction(connectionsBusy ? '正在加载…' : '读取连接列表', () => connectionRequest('describe-model-connections')));
        if (!connectionsBusy && !connectionsMessage) { connectionsBusy = true; vscode.postMessage({ type: 'describe-model-connections', requestId: ++connectionsRequest }); }
      } else {
        const layout = node('div', 'connections-layout');
        const list = node('div', 'connections-list');
        for (const item of connectionsView.items || []) {
          const button = settingsAction(item.name, () => editConnection(item));
          button.dataset.connection = item.provider;
          button.classList.toggle('selected', Boolean(connectionDraft && connectionDraft.provider === item.provider));
          button.disabled = connectionsBusy;
          list.append(button);
        }
        const add = settingsAction('＋ 添加连接', () => editConnection());
        add.disabled = connectionsBusy || !connectionsView.canAdd;
        list.append(add);
        const refresh = settingsAction('刷新列表', () => connectionRequest('describe-model-connections'));
        refresh.disabled = connectionsBusy; list.append(refresh);
        layout.append(list);
        const form = node('div', 'connections-form');
        const draft = connectionDraft;
        if (!draft) form.append(node('div', 'settings-row-hint', '选择一条连接进行编辑，或添加新连接。'));
        else {
          const field = (label, key, hint, type) => {
            const wrap = node('label', 'settings-row connection-field');
            wrap.append(node('span', 'settings-row-label', label));
            const input = document.createElement('input');
            input.type = type || 'text'; input.value = String(draft[key] || ''); input.dataset.connectionField = key;
            input.autocomplete = 'off'; input.spellcheck = false;
            input.disabled = connectionsBusy || !connectionsView.writable;
            input.addEventListener('input', () => { draft[key] = input.value; });
            wrap.append(input);
            if (hint) wrap.append(node('div', 'settings-row-hint', hint));
            form.append(wrap); return input;
          };
          if (!draft.native) {
            field('连接名称', 'name');
            const vendor = settingsEnum(draft.vendor || 'custom', [['custom', '自定义 / 兼容接口'], ['deepseek', 'DeepSeek'], ['openai', 'OpenAI'], ['anthropic', 'Anthropic']], chosen => {
              draft.vendor = chosen;
              if (chosen === 'anthropic') draft.api = 'anthropic-messages';
              else if (chosen === 'openai') draft.api = 'openai-responses';
              else draft.api = 'openai-completions';
              // Endpoint and model IDs remain explicit, so presets never replace a configured gateway.
              renderSettingsPanel();
            });
            form.append(settingsRow('厂商 / 类型', '接口地址由你填写；可为同一厂商添加多条连接。', vendor));
            const endpoint = field('接口地址', 'baseURL', '按服务商说明填写完整 HTTP(S) API 基址。');
            const endpointHint = endpoint.parentElement.querySelector('.settings-row-hint');
            endpointHint.id = 'connectionEndpointHint';
            endpoint.setAttribute('aria-describedby', endpointHint.id);
            const updateEndpointHint = () => {
              const guidance = {
                'openai-completions': { example: 'https://api.example.com/v1', hint: 'API 基址通常含 /v1；系统会追加 /chat/completions。不要填写完整请求地址，网关按服务商说明填写。' },
                'openai-responses': { example: 'https://api.example.com/v1', hint: 'API 基址通常含 /v1；系统会追加 /responses。不要填写完整请求地址，网关按服务商说明填写。' },
                'anthropic-messages': { example: 'https://api.example.com', hint: 'Anthropic 基址通常不含 /v1；系统会追加 /v1/messages。不要填写完整请求地址，网关按服务商说明填写。' },
              }[draft.api] || { example: '服务商提供的 API 基址', hint: '当前协议继承运行时目录；请按服务商说明填写完整 HTTP(S) API 基址。' };
              endpoint.placeholder = guidance.example;
              endpointHint.textContent = guidance.hint;
            };
            updateEndpointHint();
            form.append(settingsRow('接口协议', '按服务商实际支持的协议选择。', settingsEnum(draft.api || '', [['', '继承运行时目录'], ['openai-completions', 'OpenAI Chat Completions'], ['openai-responses', 'OpenAI Responses'], ['anthropic-messages', 'Anthropic Messages']], chosen => { draft.api = chosen; updateEndpointHint(); })));
          } else {
            form.append(settingsRow(draft.name, '在此更新密钥；接口和高级配置在下方 DSH 配置中修改。'));
          }
          const credential = draft.credential;
          field('API 密钥', 'apiKey', credential && credential.configured ? '已配置；留空保留现有密钥，输入新值后保存即可替换。' : '已有连接留空保留其凭据引用；新连接留空适用于免密接口。', 'password');
          if (!draft.native) {
            const modelField = node('label', 'settings-row connection-field');
            modelField.append(node('span', 'settings-row-label', '模型 ID（每行一个）'));
            const models = document.createElement('textarea'); models.rows = 4; models.dataset.connectionField = 'models';
            models.value = (draft.models || []).map(model => model.id).join('\\n');
            models.disabled = connectionsBusy || !connectionsView.writable;
            models.addEventListener('input', () => {
              const old = draft.models || [];
              draft.models = models.value.split(/\\r?\\n/).map(id => id.trim()).filter(Boolean).map(id => ({ ...(old.find(model => model.id === id) || {}), id }));
            });
            modelField.append(models, node('div', 'settings-row-hint', '可直接填写，不要求服务商提供模型列表。已有目录连接留空时继承其目录。'));
            form.append(modelField);
            const discover = settingsAction('读取模型目录（可选）', () => connectionRequest('discover-connection-models', { draft: { ...draft, provider: draft.provider || (draft.vendor !== 'custom' ? draft.vendor : undefined) } }));
            discover.disabled = connectionsBusy; form.append(discover);
            if (connectionCandidates.length) {
              const candidates = node('div', 'connection-candidates');
              candidates.append(node('div', 'settings-row-hint', '勾选要加入的模型；保存后才生效。'));
              for (const model of connectionCandidates) {
                const row = node('label', 'connection-candidate');
                const check = document.createElement('input'); check.type = 'checkbox'; check.checked = draft.models.some(item => item.id === model.id);
                check.addEventListener('change', () => {
                  if (check.checked) draft.models = [...draft.models.filter(item => item.id !== model.id), { ...model }];
                  else draft.models = draft.models.filter(item => item.id !== model.id);
                  models.value = draft.models.map(item => item.id).join('\\n');
                });
                row.append(check, node('span', '', model.name ? model.name + ' · ' + model.id : model.id)); candidates.append(row);
              }
              form.append(candidates);
            }
            const capacities = document.createElement('details'); capacities.className = 'connection-capacities';
            capacities.append(node('summary', '', '模型容量（可选）'));
            capacities.append(node('div', 'settings-row-hint', '目录返回的容量会随模型保存。未填写时沿用运行时默认；手工模型默认仅文本，不自动声明图片或思考能力。'));
            for (const model of draft.models || []) {
              const row = node('div', 'connection-capacity'); row.append(node('span', '', model.id));
              for (const key of ['contextWindow', 'maxTokens']) {
                const input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.placeholder = key === 'contextWindow' ? '上下文容量' : '输出上限';
                input.setAttribute('aria-label', model.id + ' ' + input.placeholder); input.value = model[key] === undefined ? '' : String(model[key]);
                input.addEventListener('input', () => { if (input.value === '') delete model[key]; else model[key] = Number(input.value); });
                row.append(input);
              }
              capacities.append(row);
            }
            form.append(capacities);
          }
          const actions = node('div', 'settings-actions');
          const save = settingsAction('保存连接', () => {
            if (!draft.name.trim()) { connectionsMessage = '请填写连接名称。'; renderSettingsPanel(); return; }
            if (!draft.native && !draft.provider && (!draft.baseURL || !draft.api || !draft.models.length)) { connectionsMessage = '新连接需要接口地址、协议和至少一个模型 ID。'; renderSettingsPanel(); return; }
            connectionRequest('save-model-connection', { draft });
          });
          save.classList.add('connection-save');
          save.disabled = connectionsBusy || !connectionsView.writable; actions.append(save);
          const cancel = settingsAction('取消编辑', () => { connectionDraft = undefined; connectionCandidates = []; connectionsMessage = ''; renderSettingsPanel(); });
          cancel.disabled = connectionsBusy; actions.append(cancel);
          if (draft.provider && draft.removable) {
            const remove = settingsAction('移除连接', () => connectionRequest('remove-model-connection', { provider: draft.provider, revision: draft.revision }));
            remove.disabled = connectionsBusy || !connectionsView.writable; actions.append(remove);
          }
          form.append(actions);
          if (draft.error) form.append(node('div', 'settings-row-hint', draft.error));
        }
        // Custom selects and every editable field respect the same operation lock.
        if (connectionsBusy || !connectionsView.writable) for (const input of form.querySelectorAll('input, textarea, select, button')) input.disabled = true;
        layout.append(form); manager.append(layout);
      }
      if (connectionsMessage) manager.append(node('div', 'settings-row-hint connections-status', connectionsMessage));
      return section;
    }
    function settingsSection(title) {
      const section = node('div', 'settings-section');
      section.append(node('div', 'settings-section-title', title));
      return section;
    }
    function settingsRow(label, hint, control, warn) {
      /* 0.0.97（G42）：warn=true → 行说明红字（哨兵值 -1 = 刻意设置的特殊值）。 */
      const row = node('div', 'settings-row');
      const texts = node('div', 'settings-row-text');
      texts.append(node('div', 'settings-row-label', label));
      if (hint) texts.append(node('div', 'settings-row-hint' + (warn === true ? ' settings-row-warn' : ''), hint));
      row.append(texts);
      if (control) row.append(control);
      return row;
    }
    function settingsSwitch(current, onToggle) {
      const button = node('button', 'settings-switch' + (current === true ? ' on' : ''));
      button.type = 'button';
      button.setAttribute('role', 'switch');
      button.setAttribute('aria-checked', current === true ? 'true' : 'false');
      button.append(node('span', 'settings-switch-knob'));
      button.addEventListener('click', () => {
        const next = button.getAttribute('aria-checked') !== 'true';
        button.setAttribute('aria-checked', next ? 'true' : 'false');
        button.classList.toggle('on', next);
        onToggle(next);
      });
      return button;
    }
    function settingsEnum(current, options, onPick) {
      const wrap = node('div', 'settings-enum');
      const select = document.createElement('select');
      for (const option of options) {
        const element = new Option(option[1], option[0], false, option[0] === current);
        /* 0.0.66（用户反馈）: 菜单项悬停显示原始值（翻译只在显示层，原始 key 始终可得）。 */
        element.title = String(option[0]);
        select.append(element);
      }
      wrap.append(select);
      installDrop(select, { down: true });
      select.addEventListener('change', () => onPick(select.value));
      return wrap;
    }
    /* G45（0.0.103）：公式复制颜色控件——「跟随主题」开关 + 常用色块 + RGB/HSL/Hex 三段联动输入 + 预览。
       仅 SVG 复制生效（行说明已注明）；HSL 即色相-饱和-亮度（与 HSI 定义差异见调研文档）。 */
    const COLOR_SWATCHES = ['#000000', '#ffffff', '#e5484d', '#f76b15', '#46a758', '#0090ff', '#8e4ec6', '#8b8d98'];
    function settingsColorPicker(current, onCommit) {
      const initial = typeof current === 'string' && /^#[0-9a-f]{6}$/i.test(current) ? current.toLowerCase() : undefined;
      let custom = initial !== undefined ? initial : '#000000';
      const wrap = node('div', 'settings-color');
      const head = node('div', 'settings-color-head');
      const body = node('div', 'settings-color-body');
      const toggle = settingsSwitch(initial === undefined, on => {
        body.classList.toggle('hidden', on);
        onCommit(on ? 'theme' : custom);
      });
      head.append(node('span', 'settings-color-label', '跟随主题'), toggle);
      wrap.append(head, body);
      const mkInput = (value, min, max) => {
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'settings-color-input';
        input.min = String(min); input.max = String(max); input.value = String(value);
        return input;
      };
      /* G45 v1.1（0.0.104）修复③：数字输入改自绘步进器——与设置台其他数字行同款样式
         （原生白色 spinner 在深色主题突兀）；步长 1，钳位到域。 */
      const mkStepperField = (value, min, max, commit) => {
        const stepper = node('span', 'settings-stepper');
        const input = mkInput(value, min, max);
        input.addEventListener('change', commit);
        const buttons = node('span', 'settings-stepper-buttons');
        const up = node('button', 'settings-step');
        up.type = 'button'; up.title = '增加'; up.setAttribute('aria-label', '增加'); up.innerHTML = CHEVRON_UP_SVG;
        const down = node('button', 'settings-step');
        down.type = 'button'; down.title = '减少'; down.setAttribute('aria-label', '减少'); down.innerHTML = CHEVRON_DOWN_SVG;
        const bump = (delta) => {
          const next = Math.min(max, Math.max(min, Math.round((Number(input.value) || 0) + delta)));
          input.value = String(next);
          commit();
        };
        up.addEventListener('click', () => bump(1));
        down.addEventListener('click', () => bump(-1));
        buttons.append(up, down);
        stepper.append(input, buttons);
        return { wrap: stepper, input };
      };
      const rgbFields = [mkStepperField(0, 0, 255, () => commitRgb()), mkStepperField(0, 0, 255, () => commitRgb()), mkStepperField(0, 0, 255, () => commitRgb())];
      const hslFields = [mkStepperField(0, 0, 360, () => commitHsl()), mkStepperField(0, 0, 100, () => commitHsl()), mkStepperField(0, 0, 100, () => commitHsl())];
      const hexInput = document.createElement('input');
      hexInput.type = 'text'; hexInput.className = 'settings-color-input settings-color-hex';
      hexInput.spellcheck = false; hexInput.maxLength = 7;
      /* G45 v1.1（0.0.104）修复②：可打开的系统调色盘——原生 color 输入，点击弹出取色器；
         拖动实时预览（input）、确定时提交（change）。 */
      const nativePicker = document.createElement('input');
      nativePicker.type = 'color';
      nativePicker.className = 'settings-color-native';
      nativePicker.title = '打开调色盘';
      nativePicker.value = custom;
      nativePicker.addEventListener('input', () => apply(nativePicker.value, false));
      nativePicker.addEventListener('change', () => apply(nativePicker.value, true));
      const preview = node('span', 'settings-color-preview');
      const fieldRow = (tag, inputs) => {
        const row = node('div', 'settings-color-fields');
        row.append(node('span', 'settings-color-tag', tag));
        for (const input of inputs) row.append(input);
        return row;
      };
      const swatches = node('div', 'settings-color-swatches');
      for (const hex of COLOR_SWATCHES) {
        const swatch = node('button', 'settings-swatch');
        swatch.type = 'button';
        swatch.title = hex;
        swatch.style.background = hex;
        swatch.addEventListener('click', () => apply(hex, true));
        swatches.append(swatch);
      }
      function syncFromHex(hex) {
        custom = hex;
        const rgb = hexToRgb(hex) || { r: 0, g: 0, b: 0 };
        const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
        rgbFields[0].input.value = String(rgb.r); rgbFields[1].input.value = String(rgb.g); rgbFields[2].input.value = String(rgb.b);
        hslFields[0].input.value = String(hsl.h); hslFields[1].input.value = String(hsl.s); hslFields[2].input.value = String(hsl.l);
        hexInput.value = hex;
        nativePicker.value = hex;
        preview.style.background = hex;
      }
      function apply(hex, commit) {
        syncFromHex(hex);
        if (commit === true) onCommit(hex);
      }
      /* commit* 为函数声明（提升）——供上面的步进器在点击时回调。 */
      function commitRgb() { apply(rgbToHex(Number(rgbFields[0].input.value) || 0, Number(rgbFields[1].input.value) || 0, Number(rgbFields[2].input.value) || 0), true); }
      function commitHsl() {
        const rgb = hslToRgb(Number(hslFields[0].input.value) || 0, Number(hslFields[1].input.value) || 0, Number(hslFields[2].input.value) || 0);
        apply(rgbToHex(rgb.r, rgb.g, rgb.b), true);
      }
      function commitHex() {
        const hex = normalizeHexColor(hexInput.value);
        if (hex !== undefined) apply(hex, true);
        else syncFromHex(custom);
      }
      hexInput.addEventListener('change', commitHex);
      /* G45 v1.1（0.0.104）修复②：调色盘入口带注明标签（与色块同尺寸同圆角）。 */
      swatches.append(node('span', 'settings-color-label settings-color-native-label', '调色盘'), nativePicker);
      body.append(swatches, fieldRow('RGB', rgbFields.map(f => f.wrap)), fieldRow('HSL', hslFields.map(f => f.wrap)), fieldRow('Hex', [hexInput, preview]));
      syncFromHex(custom);
      body.classList.toggle('hidden', initial === undefined);
      return wrap;
    }
    function settingsNumber(current, min, max, onCommit, step, norm) {
      /* G6 v2（0.0.64）: bounds 可选（dsh 字段的 min/max 来自 schema meta，可能缺省）。
         0.0.95（G38 批次 1）: 可选 step（默认按值域推导）；小数步长（0.1）用于折叠触发阈值。
         0.0.96（用户实测 bug 修复）: 未显式给步长且值域窄（<2）时按域宽 1/100 取"整齐"小数步长——
         此前固定 ±1 会被 min/max 夹紧成"跳端点"（如预览最小缩放 0.005–1：一点就 0.005↔1）。
         0.0.97（G42）: 可选 norm（提交前先过一遍，用于哨兵值 -1 这类"范围外特例"）。 */
      const hasMin = typeof min === 'number' && Number.isFinite(min);
      const hasMax = typeof max === 'number' && Number.isFinite(max);
      let stepValue = typeof step === 'number' && Number.isFinite(step) && step > 0 ? step : undefined;
      if (stepValue === undefined) {
        stepValue = 1;
        if (hasMin && hasMax && max - min > 0 && max - min < 2) {
          const raw = (max - min) / 100;
          const pow = Math.pow(10, Math.max(0, Math.min(6, Math.ceil(-Math.log10(raw)))));
          stepValue = Math.max(Math.pow(10, -6), Math.round(raw * pow) / pow);
        }
      }
      const stepDecimals = stepValue === 1 ? 0 : (String(stepValue).split('.')[1] || '').length;
      const wrap = node('span', 'settings-stepper');
      const input = document.createElement('input');
      input.type = 'number'; input.className = 'settings-number';
      input.value = String(current);
      if (hasMin) input.min = String(min);
      if (hasMax) input.max = String(max);
      if (stepValue !== 1) input.step = String(stepValue);
      function commitValue(raw) {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) { input.value = String(current); return; }
        let clamped = typeof norm === 'function' ? norm(parsed) : parsed;
        if (!Number.isFinite(clamped)) { input.value = String(current); return; }
        if (hasMin) clamped = Math.max(min, clamped);
        if (hasMax) clamped = Math.min(max, clamped);
        if (stepDecimals > 0) clamped = Number(clamped.toFixed(stepDecimals));
        input.value = String(clamped);
        onCommit(clamped);
      }
      input.addEventListener('change', () => commitValue(input.value));
      /* 0.0.63（用户反馈④）: 自绘步进（原生 spinner 白色突兀）；步长按 stepValue（默认 1）。 */
      const buttons = node('span', 'settings-stepper-buttons');
      const up = node('button', 'settings-step');
      up.type = 'button'; up.title = '增加'; up.setAttribute('aria-label', '增加');
      up.innerHTML = CHEVRON_UP_SVG;
      const down = node('button', 'settings-step');
      down.type = 'button'; down.title = '减少'; down.setAttribute('aria-label', '减少');
      down.innerHTML = CHEVRON_DOWN_SVG;
      up.addEventListener('click', () => commitValue(Number(input.value) + stepValue));
      down.addEventListener('click', () => commitValue(Number(input.value) - stepValue));
      buttons.append(up, down);
      wrap.append(input, buttons);
      return wrap;
    }
    function settingsText(current, onCommit) {
      const input = document.createElement('input');
      input.type = 'text'; input.className = 'settings-input';
      input.value = current === undefined || current === null ? '' : String(current);
      input.addEventListener('change', () => onCommit(input.value));
      return input;
    }
    function settingsAction(label, onClick) {
      const button = node('button', 'settings-action', label);
      button.type = 'button';
      button.addEventListener('click', onClick);
      return button;
    }
    function postSetConfig(key, value) { vscode.postMessage({ type: 'set-config', key, value }); }
    /* ---- 0.0.65（用户反馈①）: DSH 配置适度翻译（ns 标题 / 常用字段 / 枚举选项）——查不到的保持原文；
       行 title 恒给出原始键路径（ns.path），高级用户可对照。 ---- */
    const DSH_NS_TITLES = {
      'agent-default-model': '默认模型',
      'llm-deepseek': 'DeepSeek 模型参数',
      'ui-conversation': '对话交互',
      'ui-theme': '外观主题',
      'locale': '界面语言',
      'vision-router': '视觉路由',
      'web-search-deepseek': '联网搜索',
      'agent-presets': '智能体预设',
      'agent-loop': '代理循环',
      'shell': '终端',
      'dsh-context': '上下文统计',
      'permission': '权限',
      'dsh-market': '插件市场',
      'modlens': '图片理解',
      'llm-pi-ai': '第三方模型',
      'ui-onboarding': '首次引导',
      'project-guards': '本地守卫（快照/拦截/自动提交）',
    };
    /* 0.0.92：字段说明（悬停 tooltip + 行下说明行；查不到就不显示） */
    const DSH_FIELD_HINTS = {
      'project-guards': {
        backupDir: '破坏性操作执行前，把目标复制到这里——相对项目路径（_temp/backup），或绝对路径（如 D:\\dsh-backups）',
        backupRetentionDays: '备份保留天数，超期自动清理（只清理它自己的备份树）；-1 = 永不清理（手输，刻意设置的特殊值）',
        backupMaxBytes: '单个目标超过该大小就跳过快照（避免大目录拖慢执行）',
        autoCommit: '写/编辑文件后自动 git 提交（消息格式 auto: 更新N个文件…）；关掉则完全不自动提交',
      },
    };
    function dshFieldHint(ns, path) { const map = DSH_FIELD_HINTS[ns]; return (map && map[path]) || undefined; }
    const DSH_FIELD_LABELS = {
      'agent-default-model': { provider: '服务商', model: '模型', reasoningEffort: '思考强度' },
      'llm-deepseek': { apiKeyEnv: '密钥环境变量', baseURL: '接口地址', thinking: '模型思考', reasoningEffort: '思考强度', maxTokens: '单次最大输出 token', defaultContextWindow: '默认上下文窗口' },
      'ui-conversation': { busyEnter: '运行中发送消息' },
      'ui-theme': { preference: '主题' },
      'locale': { preference: '语言' },
      'vision-router': { model: '视觉模型', visionDepth: '视觉深度', cache: '启用缓存', cacheTtlSeconds: '缓存有效期（秒）', downscale: '超限下采样', downscaleMaxPixels: '下采样像素上限' },
      'web-search-deepseek': { apiKey: 'API 密钥', apiKeyEnv: '密钥环境变量', baseURL: '接口地址', model: '模型', maxTokens: '单次最大输出 token', maxUses: '每次对话最多搜索次数' },
      'agent-presets': { default: '默认预设' },
      'agent-loop': { maxParallelToolCalls: '并行工具调用上限' },
      'shell': { cwd: '工作目录', timeoutMs: '超时（毫秒）', maxTimeoutMs: '最大超时（毫秒）', maxOutputBytes: '输出上限（字节）', pwshPath: 'PowerShell 路径' },
      'dsh-context': { defaultGranularity: '默认统计粒度', defaultTrendMode: '趋势模式', defaultFileSort: '文件排序' },
      'permission': { defaultPreset: '默认权限档' },
      'dsh-market': { allowRestart: '允许重启运行时' },
      'ui-onboarding': { welcomeNoticeVersion: '欢迎提示版本' },
      'project-guards': { backupDir: '快照备份目录', backupRetentionDays: '备份保留天数', backupMaxBytes: '单目标快照上限（字节）', autoCommit: '写文件自动 git 提交' },
    };
    const DSH_OPTION_LABELS = {
      'agent-default-model.reasoningEffort': { off: '关闭', low: '低', high: '高', max: '最高' },
      'llm-deepseek.thinking': { enabled: '开', disabled: '关' },
      'llm-deepseek.reasoningEffort': { off: '关闭', low: '低', high: '高', max: '最高' },
      'ui-conversation.busyEnter': { queue: '排队（等本轮结束再发送）', steer: '插话（立刻引导 AI）' },
      'ui-theme.preference': { light: '亮色', dark: '暗色', system: '跟随系统' },
      'locale.preference': { zh: '中文', en: '英文' },
      'vision-router.visionDepth': { fast: '快速', standard: '标准', deep: '深度', custom: '自定义' },
      'dsh-context.defaultGranularity': { step: '按步', turn: '按轮' },
      'dsh-context.defaultTrendMode': { total: '累计', delta: '增量' },
      'dsh-context.defaultFileSort': { count: '按次数', latest: '按最新', path: '按路径' },
      'permission.defaultPreset': { 'read-only': '只读', 'workspace-write': '工作区可写', 'danger-full-access': '完全访问' },
    };
    function dshNsTitle(ns) { return DSH_NS_TITLES[ns] || ns; }
    function dshFieldLabel(ns, path) { const map = DSH_FIELD_LABELS[ns]; return (map && map[path]) || path; }
    function dshOptionLabel(ns, path, value) {
      const map = DSH_OPTION_LABELS[ns + '.' + path];
      const hit = map ? map[String(value)] : undefined;
      return hit || String(value);
    }
    /* ---- G6 v2（0.0.64）: DSH 配置编辑（单 op 提交；secret 只写不读） ---- */
    function mutateDshSetting(namespace, ops) {
      pendingDshEdits.push({ ns: namespace.ns, ops });
      if (pendingDshEdits.length > 8) pendingDshEdits.shift();
      vscode.postMessage({ type: 'dsh-settings-mutate', ns: namespace.ns, ops, expectedRevision: namespace.revision });
    }
    function dshSettingControl(namespace, field) {
      const path = Array.isArray(field.pathArray) ? field.pathArray : undefined;
      if (path === undefined || path.length === 0) return undefined;
      const wrap = node('span', 'settings-ns-control');
      /* 0.0.66（用户反馈）: 原始键路径 tooltip 也挂到控件本体（下拉触发区/输入框/开关）——
         此前只有字段名 label 有，下拉类字段悬停值区看不到。 */
      const fullKey = namespace.ns + '.' + field.path;
      const applyKeyTitle = () => {
        for (const el of wrap.querySelectorAll('.ds-trigger, input, .settings-switch')) {
          if (!el.title) el.title = fullKey;
        }
      };
      if (field.secretSet !== undefined) {
        /* 判据 C：secret 只写不读——固定空白密码态输入框，永不展示旧值。 */
        wrap.append(node('span', 'settings-ns-secret', field.secretSet === true ? '已设置' : '未设置'));
        const input = document.createElement('input');
        input.type = 'password'; input.className = 'settings-input settings-secret-input';
        input.placeholder = field.secretSet === true ? '输入新值' : '输入值';
        input.setAttribute('autocomplete', 'off');
        const save = node('button', 'settings-action', '设置');
        save.type = 'button';
        save.addEventListener('click', () => {
          if (input.value === '') return;
          mutateDshSetting(namespace, [{ op: 'set', path, value: input.value }]);
          input.value = '';
        });
        wrap.append(input, save);
        if (field.secretSet === true) {
          const clear = node('button', 'settings-action', '清除');
          clear.type = 'button';
          clear.addEventListener('click', () => mutateDshSetting(namespace, [{ op: 'unset', path }]));
          wrap.append(clear);
        }
        applyKeyTitle();
        return wrap;
      }
      if (field.type === 'boolean') {
        wrap.append(settingsSwitch(field.value === true, next => mutateDshSetting(namespace, [{ op: 'set', path, value: next }])));
      } else if (Array.isArray(field.options) && field.options.length > 0) {
        const options = field.options;
        wrap.append(settingsEnum(
          String(field.value),
          options.map(option => [String(option), dshOptionLabel(namespace.ns, field.path, option)]),
          chosen => {
            const raw = options.find(option => String(option) === chosen);
            if (raw !== undefined) mutateDshSetting(namespace, [{ op: 'set', path, value: raw }]);
          },
        ));
      } else if (field.type === 'number') {
        const fallback = typeof field.value === 'number' ? field.value : (typeof field.min === 'number' ? field.min : 0);
        wrap.append(settingsNumber(fallback, field.min, field.max, next => mutateDshSetting(namespace, [{ op: 'set', path, value: next }])));
      } else if (field.type === 'string') {
        wrap.append(settingsText(field.value, next => mutateDshSetting(namespace, [{ op: 'set', path, value: next }])));
      } else {
        return undefined;
      }
      if (field.overridden === true) {
        wrap.append(node('span', 'settings-badge', '已改'));
        const restore = node('button', 'settings-restore', '恢复');
        restore.type = 'button';
        restore.title = '恢复默认（清除本层覆盖）';
        restore.addEventListener('click', () => mutateDshSetting(namespace, [{ op: 'unset', path }]));
        wrap.append(restore);
      }
      applyKeyTitle();
      return wrap;
    }
    function renderSettingsPanel() {
      const body = elements.settingsBody;
      if (!body) return;
      const restoredScrollTop = body.scrollTop;
      body.replaceChildren();
      const current = state || {};
      body.append(renderConnectionsSection());
      /* 外观 */
      const appearance = settingsSection('外观');
      appearance.append(settingsRow('动效档位', 'Standard / Dots / Off（未加载完成时的占位动画）',
        settingsEnum(current.animationStyle === 'dots' ? 'dots' : current.animationStyle === 'off' ? 'off' : 'standard',
          [['standard', 'Standard'], ['dots', 'Dots'], ['off', 'Off']], value => postSetConfig('animationStyle', value))));
      appearance.append(settingsRow('渲染 Markdown 外链图片', '隐私考虑默认关闭；本地/数据图片不受影响',
        settingsSwitch(current.markdownImages === true, value => postSetConfig('markdownImages', value))));
      /* 0.0.109（G50）：悬停显示官方英文原文（映射=官方双语字典生成；自研文案无原文不显示）。 */
      const ui = current.uiSettings || {};
      appearance.append(settingsRow('悬停显示英文原文', '界面文案悬停时显示官方 dsh 的英文原文（tooltip）——只覆盖官方翻译过的文案；自研文案无原文不受影响',
        settingsSwitch(ui.showOriginalOnHover === true, value => postSetConfig('ui.showOriginalOnHover', value))));
      /* 0.0.145（用户需求①）：临时提示条（黄色：拖入跳过/压缩结果/溢出等）显示时长。 */
      appearance.append(settingsRow('提示条显示时长', '临时提示（黄色：文件跳过/压缩结果/超出上限等）显示多少秒后自动消失（1–60）',
        settingsNumber(typeof ui.hintSeconds === 'number' ? ui.hintSeconds : 4, 1, 60, value => postSetConfig('ui.hintSeconds', value))));
      /* 0.0.147（用户反馈①）：会话栏标签最小宽度——太窄时悬停的 ✎/✕ 占满标签、切换会话易误点。 */
      appearance.append(settingsRow('会话栏标签最小宽度', '顶部会话标签的最小宽度（px）：悬停时右侧会出现重命名 ✎ 与删除 ✕（共 46px），标签太窄标题会被挤没、点击切换容易误触（68–200）',
        settingsNumber(typeof ui.sessionTabMinWidth === 'number' ? ui.sessionTabMinWidth : 112, 68, 200, value => postSetConfig('ui.sessionTabMinWidth', value), 4)));
      /* 0.1.27（用户需求）：内容列（正文 + 草稿栏）最大宽度——宽侧栏时居中不再变宽，为可读性；
         **填 -1 表示无上限**（宽侧栏铺满）。 */
      appearance.append(settingsRow('内容列最大宽度', '正文与草稿栏的最大宽度（px，320–4000）：超过后居中、不再变宽（默认 760 ≈ 90 字符/行）。填 -1 表示无上限——宽侧栏时铺满。',
        settingsNumber(typeof ui.contentMaxWidth === 'number' ? ui.contentMaxWidth : 760, -1, 4000, value => postSetConfig('ui.contentMaxWidth', value), 20)));
      body.append(appearance);
      /* 性能（0.1.48）：把"默认开 = 更快"的两处按需构建集中成独立区——此前混在「诊断」区（排障项）里不好找。
         两行的开关都**默认开**：关掉 = 恢复上一版形态（更慢/更全量），故文案统一写"默认开 = 更快；关掉 = …"。 */
      const perfSection = settingsSection('性能');
      perfSection.append(settingsRow('折叠内容按需构建', '默认开 = 更快：默认折叠的"过程"内容不随装载一起构建（省约 75% 首屏构建、约 19% DOM 节点），展开该段时即时补建（实测 1ms）、搜索跳转前自动补建。关掉 = 恢复一次性全量构建（更慢）。',
        settingsSwitch(ui.lazyFoldedBodies !== false, value => postSetConfig('ui.lazyFoldedBodies', value))));
      /* 0.1.51（CV）：**试验档、默认关**——静止场景收益显著（前述探针：冷缓存首轮 layout −65%）；
         但开启后"面板隐藏→恢复"的位置保持与拖动期轨道点位会失真（CVOFF 对照实测 FAIL）⇒ 暂不默认开。 */
      perfSection.append(settingsRow('消息块布局包含', '开启后视口外消息不参与整篇排版：静止场景更快（冷缓存首轮 layout −65%、最长长任务 123→0ms、打开墙钟 −14%；滚动高度与轨道点位摘要逐值不变）。**已知代价**：开启后"面板隐藏→恢复"的位置保持与拖动侧栏时的轨道点位可能失真（对照实测 FAIL）⇒ 默认关，待修好交互再转默认开。',
        settingsSwitch(ui.messageContainment !== false, value => postSetConfig('ui.messageContainment', value))));
      perfSection.append(settingsRow('动作行悬停显示', '默认开 = 更快：消息尾部的「复制 / 时钟 / 更多」按钮改为悬停该消息时浮出（时间仍常显；省约 29% 装载期构建与 11% DOM 节点，实测浮出 0.7ms、不挤动布局）。关掉 = 恢复常显整行（更慢）。',
        settingsSwitch(ui.hoverActions !== false, value => postSetConfig('ui.hoverActions', value))));
      body.append(perfSection);
      /* 复制 */
      const copy = current.copySettings || {};
      const copySection = settingsSection('复制');
      copySection.append(settingsRow('公式复制按钮', '公式旁显示"点击复制"', settingsSwitch(copy.mathButtons !== false, value => postSetConfig('copy.mathButtons', value))));
      copySection.append(settingsRow('块级复制按钮', '段落/标题/列表/代码块悬浮复制', settingsSwitch(copy.blockButtons !== false, value => postSetConfig('copy.blockButtons', value))));
      /* 0.0.162（公式四档，用户点名）：点击公式按钮的输出格式——Markdown / TeX 源 / TeX + 定界符 /
         MathML（SVG/PNG/另存仍在右键菜单）。 */
      copySection.append(settingsRow('公式按钮输出格式', '点击公式旁复制按钮时的输出：Markdown（行内 $…$/块级 $$…$$）/ TeX 源 / TeX + 定界符 / MathML（文本序列化，粘进支持 MathML 的编辑器）；SVG / MathML / PNG 与「另存为 SVG·PNG 文件」在公式右键菜单',
        settingsEnum(copy.mathFormat === 'tex' || copy.mathFormat === 'tex-delimited' || copy.mathFormat === 'mathml' ? copy.mathFormat : 'markdown', [['markdown', 'Markdown（$ / $$）'], ['tex', 'TeX 源'], ['tex-delimited', 'TeX + 定界符'], ['mathml', 'MathML']], value => postSetConfig('copy.mathFormat', value))));
      copySection.append(settingsRow('纯文本复制中的公式', '块复制按钮的「纯文本」档与右键「复制纯文本」里，公式以哪种形式出现：TeX 源（无定界符，粘进 LaTeX/公式编辑器）或带定界符（$…$/$$…$$，粘回 Markdown 可渲染）。公式旁的复制按钮不受此设置影响——它按上面的「公式按钮输出格式」走。',
        settingsEnum(copy.plainMathFormat === 'tex-delimited' ? 'tex-delimited' : 'tex', [['tex', 'TeX 源'], ['tex-delimited', 'TeX + 定界符']], value => postSetConfig('copy.plainMathFormat', value))));
      copySection.append(settingsRow('代码块复制输出', undefined,
        settingsEnum(copy.codeCopyFormat === 'markdown' ? 'markdown' : 'text', [['text', '纯文本'], ['markdown', '含围栏']], value => postSetConfig('copy.codeCopyFormat', value))));
      /* G45（0.0.103）：公式复制为 SVG 的颜色（仅 SVG 生效；HSL = 色相-饱和-亮度）。 */
      copySection.append(settingsRow('公式复制颜色', '「复制为 SVG」的输出颜色——跟随主题 = 当前主题前景色；自定义支持色板与 RGB/HSL/Hex 输入（仅 SVG 生效，MathML 为公式标记无颜色）',
        settingsColorPicker(typeof copy.mathSvgColor === 'string' ? copy.mathSvgColor : 'theme', value => postSetConfig('copy.mathSvgColor', value))));
      /* G45 v1.2（0.0.105）：位图档位（「复制为 PNG」/ PNG 兜底的最长边目标）。 */
      copySection.append(settingsRow('PNG 最长边', '公式位图的分辨率档位——最长边目标（倍率护栏 2–8×）；「跟随屏显」= 固定 4×屏显尺寸',
        settingsEnum(typeof copy.svgPngEdge === 'string' ? copy.svgPngEdge : '1024', [['screen', '跟随屏显（4×）'], ['512', '512'], ['1024', '1024（默认）'], ['2048', '2048']], value => postSetConfig('copy.svgPngEdge', value))));
      /* 0.0.97（G42-A）：改秒呈现（0.2–6，步进 0.1）；状态仍毫秒（扩展侧读键时换算）。 */
      copySection.append(settingsRow('复制反馈时长', '秒（0.2–6，可小数）', settingsNumber(typeof copy.feedbackMs === 'number' ? Math.round(copy.feedbackMs / 100) / 10 : 1, 0.2, 6, value => postSetConfig('copy.feedbackSeconds', value), 0.1)));
      body.append(copySection);
      /* 搜索（2026-09-25 用户需求）：命中高亮的模式与颜色。 */
      const searchSection = settingsSection('搜索');
      const searchCfg = current.searchSettings || {};
      searchSection.append(settingsRow('命中高亮显示', '搜索跳转后，会话内命中词的高亮方式（默认一直常亮；闪烁为"呼吸"式明暗渐变）。', settingsEnum(searchCfg.highlightMode === 'blink' || searchCfg.highlightMode === 'blinkThenSteady' ? searchCfg.highlightMode : 'steady', [['steady', '一直常亮'], ['blink', '一直呼吸'], ['blinkThenSteady', '呼吸后常亮']], value => postSetConfig('search.highlightMode', value))));
      searchSection.append(settingsRow('命中高亮颜色', '跟随主题（默认，主题黄）或自选颜色；自选底色时字色按对比度自动取黑/白。', settingsColorPicker(searchCfg.highlightColor, value => postSetConfig('search.highlightColor', value))));
      /* 0.1.68（用户反馈）：分发场景下"翻色"要可关；「呼吸后常亮」的时长要可调。 */
      searchSection.append(settingsRow('命中字色', '自选底色时命中词的字色：自动对比 = 按"底色 × 当前浓淡"取纯黑/纯白（两端都看得清，明暗交叉点会翻一次色）；固定 = 按底色最浓时定一次、全程不翻（观感稳，淡端对比度略低）。仅自选底色生效。', settingsEnum(searchCfg.highlightFg === 'fixed' ? 'fixed' : 'auto', [['auto', '自动对比（会翻色）'], ['fixed', '固定不翻色']], value => postSetConfig('search.highlightFg', value))));
      searchSection.append(settingsRow('呼吸周期', '一个呼吸来回的时长（0.6–3 秒，默认 1.2）。「呼吸后常亮」档：每条命中**各自从进入视野**起呼吸 **2 个整周期**再转常亮——按整周期收尾，结束时必落在最亮处、不跳变；滚出视野再滚回来会**重新呼吸**。', settingsNumber(typeof searchCfg.blinkPeriod === 'number' && isFinite(searchCfg.blinkPeriod) ? searchCfg.blinkPeriod : 1.2, 0.6, 3, value => postSetConfig('search.blinkPeriod', value), 0.2)));
      /* 0.1.71（用户拍板）：结果排序开关（段内最近优先 / 时间正序）。 */
      /* 0.1.72（用户拍板）：长片段显示方式两档（覆盖层 / 底部详情区）。 */
      searchSection.append(settingsRow('长片段显示', '结果行的长片段（命中处更长的上下文）怎么出现：**悬停覆盖层**（默认）= 浮在该行旁、行高不变、指针移动不受影响（面板底部放不下会自动翻到行上方）；**底部详情区** = 面板底部常驻 3 行显示当前悬停/选中项的长片段，列表完全不动。', settingsEnum(searchSnippetView(), [['peek', '悬停覆盖层'], ['pane', '底部详情区']], value => postSetConfig('search.snippetView', value))));
      searchSection.append(settingsRow('结果排序', '结果面板内的排序：**最近优先**（默认，段内按消息时间新→旧，刚聊过的排最上）/ 时间正序（早→晚，与 Enter 逐处跳的方向一致）。三段结构（当前会话 / 本工作区 / 其他会话）不变。', settingsEnum(searchResultOrder(), [['recent', '最近优先'], ['oldest', '时间正序']], value => postSetConfig('search.resultOrder', value))));
      /* 0.1.103（用户需求）：Enter 逐处跳走进下一个会话的顺序。 */
      searchSection.append(settingsRow('会话组序（逐处跳）', 'Enter 逐处跳走进**下一个会话**的顺序（起点会话永远第一个）：**最近命中优先**（默认）= 其余会话按"组内最新一条命中的时间"排——刚聊过的会话先走；**侧栏顺序** = 按会话栏标签里的先后排——老会话先走。', settingsEnum(searchGroupOrder(), [['recent', '最近命中优先'], ['panel', '侧栏顺序']], value => postSetConfig('search.groupOrder', value))));
      /* 0.1.96（用户拍板）：工具卡内容默认不搜（参数长 JSON 噪声大、常与正文重复）；开关即时放大。 */
      searchSection.append(settingsRow('搜索工具卡内容', '搜索结果是否包含**工具卡内容**（工具调用的参数与输出，如「记录 · 工具：」行）。默认**关**——工具参数常与助手正文重复、长 JSON 噪声大；想搜命令/文件路径/工具输出时打开（即时生效，无需重建索引）。', settingsSwitch(searchIncludeTools(), value => postSetConfig('search.includeTools', value))));
      /* 0.1.122（G55）：行内节点编号片（点=跳该节点起点）整体开关。 */
      searchSection.append(settingsRow('行内节点编号片', '搜索结果行左侧的「N/M」编号小片（点击=跳到该节点起点并脉冲高亮）；关 = 不显示（行更清爽，跳段首入口一并关闭）',
        settingsSwitch(searchNodeChipEnabled(), value => postSetConfig('search.nodeChip', value))));
      /* 0.1.84（用户拍板）：跨会话跳转后的「返回搜索起点」胶囊可整体关闭。0.1.88：目标锚搜索起点、时长可调。 */
      searchSection.append(settingsRow('跨会话返回胶囊', '跨会话搜索跳转后，顶部显示「← 返回 搜索起点」——你输入本次查询时所在的会话。人回到该会话（跳回来或手点回来都算）即自动消失；期间跳去别的会话仍亮着（它始终是回起点的入口）；点 ✕ 可立即关闭。关掉后跨会话跳转照旧生效，只是不再弹这条提醒。', settingsSwitch(searchReturnPillEnabled(), value => postSetConfig('search.returnPill', value))));
      /* 0.1.88（用户需求）：胶囊显示时长入设置（秒）。 */
      searchSection.append(settingsRow('返回胶囊显示时长', '胶囊过多少秒自动消失（3–120，默认 12）。每次跨会话跳转重新计时；点 ✕ 可随时立即关闭。', settingsNumber(typeof searchCfg.returnPillSeconds === 'number' && isFinite(searchCfg.returnPillSeconds) ? searchCfg.returnPillSeconds : 12, 3, 120, value => postSetConfig('search.returnPillSeconds', value))));
      body.append(searchSection);
      /* 折叠 */
      const fold = current.foldSettings || {};
      const foldSection = settingsSection('消息折叠');
      foldSection.append(settingsRow('长用户消息自动折叠', undefined, settingsSwitch(fold.enabled !== false, value => postSetConfig('fold.enabled', value))));
      /* 0.0.95（G38 批次 1 · P1）: 触发阈值行——写通道白名单自 0.0.62 起已有，此前只有 VS Code 设置页入口。
         0.0.96（用户反馈）: 行说明补全三闸门与优先级（此前只述比例条件，用户实测"调 0.1 短消息不折"源于此理解差）。 */
      foldSection.append(settingsRow('触发阈值', '折叠需先过「豁免字符门槛」；实际阈值 = max(视口 × 此比例, 行高 × (预览行数 + 保底折叠行数))——保底项优先，比例调低不会低于它（0.1–3，可小数）', settingsNumber(typeof fold.triggerRatio === 'number' ? fold.triggerRatio : 0.5, 0.1, 3, value => postSetConfig('fold.triggerRatio', value), 0.1)));
      foldSection.append(settingsRow('预览行数', '折叠后显示的行数（1–20）；与保底行数相加参与实际阈值', settingsNumber(typeof fold.previewLines === 'number' ? fold.previewLines : 4, 1, 20, value => postSetConfig('fold.previewLines', value))));
      foldSection.append(settingsRow('保底折叠行数', '至少超出预览这么多行才折叠（0–50）；与预览行数相加 = 实际阈值下限，优先于触发比例', settingsNumber(typeof fold.minFoldExtraLines === 'number' ? fold.minFoldExtraLines : 3, 0, 50, value => postSetConfig('fold.minFoldExtraLines', value))));
      foldSection.append(settingsRow('豁免字符门槛', '短于此字符数的消息不参与折叠判定；带附件的消息免此门槛（按高度判定）', settingsNumber(typeof fold.minChars === 'number' ? fold.minChars : 100, 0, 20000, value => postSetConfig('fold.minChars', value), 10)));
      /* 0.0.96（G38 批次 2 · H1）: AI 输出超高块折叠门槛（G27 起固定 3 行，本次设置化）。 */
      foldSection.append(settingsRow('超高块折叠行数', 'AI 输出的代码/引用/表格超过此行数才显示悬浮「折叠」按钮（1–50）', settingsNumber(typeof fold.blockMinLines === 'number' ? fold.blockMinLines : 3, 1, 50, value => postSetConfig('fold.blockMinLines', value))));
      /* 0.0.108（用户补充①）：变更文件块过长自动折叠（独立设置项）。 */
      foldSection.append(settingsRow('变更文件自动折叠', '会话尾部「变更文件」块超过阈值行数时先显示前几行（其余隐藏，可一键展开）', settingsSwitch(fold.changedFiles !== false, value => postSetConfig('fold.changedFiles', value))));
      foldSection.append(settingsRow('变更文件折叠行数', '超过此行数才折叠（1–50）；折叠时保留的行数与「展开其余 N 个文件」的 N 由此决定', settingsNumber(typeof fold.changedFilesLines === 'number' ? fold.changedFilesLines : 6, 1, 50, value => postSetConfig('fold.changedFilesLines', value))));
      /* G49（0.0.119）：AI 工作段（过程）自动折叠——AI 停下要你输入时，中间的工具/命令/叙述收成一条。
         0.0.162：面板此前误读 fold.workSegmentsEnabled（那是 webview 内部的映射产物，不在设置对象上）
         → 恒显"开"、关掉后再也无法打开；改读真键 fold.workSegments。 */
      foldSection.append(settingsRow('工作过程自动折叠', 'AI 停下要你输入时，把两次输入之间的过程（工具卡/命令卡/中间叙述）收成段首一条「已收起 N 步过程」；你的消息、最终答复、提问/审批卡保持可见；运行中不折', settingsSwitch(fold.workSegments !== false, value => postSetConfig('fold.workSegments', value))));
      /* 0.0.163（审查 P1-2，用户点名"保留位置"）：存储区——五个落盘目录的 位置/占用/打开 + 清理动作。 */
      const storageSection = settingsSection('存储');
      if (storageEntries === undefined) {
        storageSection.append(node('div', 'settings-row-hint', '正在统计占用…'));
      } else if (storageEntries.length === 0) {
        storageSection.append(node('div', 'settings-row-hint', '暂无可显示的目录（部分目录在未使用时不创建）。'));
      } else {
        for (const entry of storageEntries) {
          const cell = node('div', 'storage-cell');
          cell.append(node('span', 'storage-size', entry.exists ? formatBytes(entry.bytes) : '—'));
          const open = node('button', 'settings-action', '打开');
          open.title = entry.path;
          open.addEventListener('click', () => vscode.postMessage({ type: 'storage-open', path: entry.path }));
          cell.append(open);
          const row = settingsRow(entry.label, entry.path, cell);
          const hint = row.querySelector ? row.querySelector('.settings-row-hint') : null;
          if (hint) hint.classList.add('storage-path');
          storageSection.append(row);
        }
      }
      const storageActions = node('div', 'settings-actions');
      storageActions.append(
        settingsAction('清空回收站…', () => vscode.postMessage({ type: 'storage-purge', target: 'recycle' })),
        settingsAction('立即清空草稿', () => vscode.postMessage({ type: 'storage-purge', target: 'drafts' })),
        settingsAction('清理临时文件', () => vscode.postMessage({ type: 'storage-purge', target: 'temp' })),
      );
      storageSection.append(storageActions);
      body.append(storageSection);
      body.append(foldSection);
      /* 图片 */
      const imageSection = settingsSection('图片');
      imageSection.append(settingsRow('右键菜单默认档', '图片右键菜单中两档复制的次序',
        settingsEnum(current.imageCopyFormat === 'png' ? 'png' : 'original', [['original', '复制原格式优先'], ['png', '复制 PNG 优先']], value => postSetConfig('imageCopyFormat', value))));
      /* 0.0.80（用户反馈④）: 预览缩放界限 + GIF 默认播放 */
      const preview = current.previewSettings || {};
      imageSection.append(settingsRow('预览最小缩放', '倍（0.005–1）', settingsNumber(typeof preview.minScale === 'number' ? preview.minScale : 0.01, 0.005, 1, value => postSetConfig('preview.minScale', value), 0.005)));
      imageSection.append(settingsRow('预览最大缩放', '倍（1–64）', settingsNumber(typeof preview.maxScale === 'number' ? preview.maxScale : 32, 1, 64, value => postSetConfig('preview.maxScale', value))));
      imageSection.append(settingsRow('动图预览默认播放', '关 = 打开时定格首帧（可手动播放）', settingsSwitch(preview.gifAutoplay !== false, value => postSetConfig('preview.gifAutoplay', value))));
      /* 0.0.96（G38 批次 2 · H4/H2）: 动图选帧器上限——抽帧数（超出按步长抽稀）与多选上限。 */
      imageSection.append(settingsRow('帧预览上限', '动图选帧器一次最多抽取的帧数，超出按步长抽稀（1–240）', settingsNumber(typeof preview.maxFrames === 'number' ? preview.maxFrames : 60, 1, 240, value => postSetConfig('preview.maxFrames', value))));
      imageSection.append(settingsRow('动图选帧上限', '选帧发送时最多可选帧数（1–60；不应大于帧预览上限）', settingsNumber(typeof preview.maxFrameSelections === 'number' ? preview.maxFrameSelections : 12, 1, 60, value => postSetConfig('preview.maxFrameSelections', value))));
      /* 0.0.97（批次 3-E1）：原图存储总量上限（哨兵 -1 = 不剪枝；磁盘占用阀）。 */
      const imageStore = current.imageStoreSettings || {};
      const storeMB = typeof imageStore.maxTotalMB === 'number' ? imageStore.maxTotalMB : 512;
      const storeNorm = (value) => value === -1 ? -1 : Math.min(4096, Math.max(16, Math.round(value)));
      imageSection.append(settingsRow('原图存储上限', storeMB === -1 ? '⚠ -1 = 不剪枝（原图只增不减，刻意设置的特殊值）' : 'MB，16–4096；超出时最旧原图优先清理；输入 -1 = 不剪枝', settingsNumber(storeMB, -1, 4096, value => postSetConfig('imageStore.maxTotalMB', value), 16, storeNorm), storeMB === -1));
      body.append(imageSection);
      /* 0.0.96（G38 批次 2 · H3）: 附件单次上限（拖入/粘贴的接收限制）。 */
      const attach = current.attachSettings || {};
      const attachSection = settingsSection('附件');
      attachSection.append(settingsRow('单次附件数', '一次拖入/粘贴最多接收的文件数，超出跳过并提示（1–200）', settingsNumber(typeof attach.maxFiles === 'number' ? attach.maxFiles : 20, 1, 200, value => postSetConfig('attach.maxFiles', value))));
      attachSection.append(settingsRow('单次附件总大小', 'MB；累计超出后其余文件跳过并提示（1–2048）', settingsNumber(typeof attach.maxTotalMB === 'number' ? attach.maxTotalMB : 100, 1, 2048, value => postSetConfig('attach.maxTotalMB', value))));
      /* 0.0.175（B5 文案群）：单文件上限入设置（此前写死 25MB）。 */
      attachSection.append(settingsRow('单文件大小上限', 'MB；拖入/粘贴的单个文件超过此值即跳过并提示（图片仍会先尝试「大图自动压缩」）（1–500）', settingsNumber(typeof attach.maxFileMB === 'number' ? attach.maxFileMB : 25, 1, 500, value => postSetConfig('attach.maxFileMB', value))));
      /* 0.0.145（G43 用户需求）：大图自动压缩——超阈值下采样 + 白底 JPEG 重编码（而非直接跳过）。 */
      attachSection.append(settingsRow('大图自动压缩阈值', 'MB；超过此大小的图片自动下采样 + JPEG 重编码后再附带（0 = 关闭，超限图仍按旧行为跳过）。默认 20 与运行时单图上限一致',
        settingsNumber(typeof attach.compressThresholdMB === 'number' ? attach.compressThresholdMB : 20, 0, 2048, value => postSetConfig('attach.compressThresholdMB', value))));
      attachSection.append(settingsRow('压缩最长边', '压缩时把图片等比缩到最长边不超过此像素数（512–16384；压缩后仍超限时自动逐级再降）',
        settingsNumber(typeof attach.compressMaxEdge === 'number' ? attach.compressMaxEdge : 4096, 512, 16384, value => postSetConfig('attach.compressMaxEdge', value), 256)));
      attachSection.append(settingsRow('JPEG 压缩质量', '40–95；越大越清晰、体积越大（透明像素压为白底）',
        settingsNumber(typeof attach.compressQuality === 'number' ? attach.compressQuality : 82, 40, 95, value => postSetConfig('attach.compressQuality', value))));
      body.append(attachSection);
      /* 会话 */
      const session = current.sessionSettings || {};
      const sessionSection = settingsSection('会话');
      /* 0.0.160（N1）：任务通知——审批/提问（agent 阻塞等你）与回合结束的 Windows 系统通知。
         判据：正看着侧栏就不弹；同一等待只提醒一次；点通知「查看」聚焦侧栏。 */
      sessionSection.append(settingsRow('任务通知', '侧栏不在视野时（切到别的应用/收起侧栏）用系统通知提醒：agent 需要你操作（审批、提问）或回合跑完。你正看着侧栏时一律不弹；同一等待只提醒一次；点通知上的「查看」回到侧栏',
        settingsEnum(ui.notifyLevel === 'off' ? 'off' : (ui.notifyLevel === 'action' ? 'action' : 'all'), [['all', '需要操作 + 跑完'], ['action', '仅需要操作'], ['off', '关闭']], value => postSetConfig('ui.notifyLevel', value))));
      /* 0.1.7（用户需求）：通知形式——系统档把"前台但侧栏不在视野"的窗口内横幅改为 Windows 右下角弹窗。 */
      sessionSection.append(settingsRow('通知形式', '「总是系统弹窗」= VS Code 在前台但侧栏不在视野时，改用 Windows 右下角弹窗（点击弹窗回到侧栏）；VS Code 在后台时两档一致（都走系统通知），不会弹两份',
        settingsEnum(ui.notifyStyle === 'system' ? 'system' : 'vscode', [['vscode', '跟随 VS Code'], ['system', '总是系统弹窗']], value => postSetConfig('ui.notifyStyle', value))));
      /* 0.0.161（用户需求）：草稿持久化——Reload/重启后按会话恢复 文本/图片/文件卡；关=Reload 即丢。 */
      sessionSection.append(settingsRow('保留未发送的草稿', '输入框里的文字、图片与待附文件（文件卡）按会话保留——重载窗口/重启 VS Code/重连运行时后回到该会话自动恢复；成功发出即清。关掉 = 回到"Reload 即丢"',
        settingsSwitch(ui.keepDrafts !== false, value => postSetConfig('ui.keepDrafts', value))));
      sessionSection.append(settingsRow('标签排序', '拖拽自定义（持久化）或按最后活动时间',
        settingsEnum(session.sortMode === 'activity' ? 'activity' : 'persisted', [['persisted', '持久化顺序'], ['activity', '最后活动']], value => postSetConfig('sessionSortMode', value))));
      /* 0.0.154（O3 会话加载机制）：打开即全量 + 上限条数（超限自动退回分页）。 */
      const sessionHistory = current.sessionHistorySettings || {};
      sessionSection.append(settingsRow('打开会话时加载全部历史', '打开/切回会话时一次性拉取整段历史（本地实测 2000+ 事件 <0.5s）——滚动位置、停点菱形、节点跳转全程可用；关 = 回到逐页加载',
        settingsSwitch(sessionHistory.loadAll !== false, value => postSetConfig('sessionHistory.loadAll', value))));
      sessionSection.append(settingsRow('全量加载上限', '超过此消息条数的会话自动退回分页模式（「加载更早消息」/上滚预取仍可用）：500–20000，默认 3000',
        settingsNumber(typeof sessionHistory.maxMessages === 'number' ? sessionHistory.maxMessages : 3000, 500, 20000, value => postSetConfig('sessionHistory.maxMessages', value), 500)));
      /* 0.0.95（G38 批次 1 · P2-P4）: 切会话视图记忆三开关（G39 v2 数据层先行，本次补设置台入口）。 */
      const viewMemory = current.sessionViewMemory || {};
      sessionSection.append(settingsRow('滚动位置记忆', '切走再切回停在离开位置（贴底离开回底部）；关 = 每次切回到底部',
        settingsSwitch(viewMemory.scroll !== false, value => postSetConfig('sessionViewMemory.scroll', value))));
      sessionSection.append(settingsRow('工具卡展开记忆', '工具/思考卡展开态跨切换保持；关 = 切回后回默认折叠',
        settingsSwitch(viewMemory.expand !== false, value => postSetConfig('sessionViewMemory.expand', value))));
      sessionSection.append(settingsRow('长消息折叠记忆', '手动展开/收起跨切换保持；关 = 切回后按自动规则重判',
        settingsSwitch(viewMemory.fold !== false, value => postSetConfig('sessionViewMemory.fold', value))));
      /* G41 v1.2（0.0.101）：轮次导航跳转动画时长（秒；0 = 瞬时）。0.0.122 增「轮」粒度开关。 */
      const turnRail = current.turnRailSettings || {};
      sessionSection.append(settingsRow('轮次导航粒度', '轨道上的「轮」：工作段（默认；与折叠分段同源——你的每次输入 + 已应答的审批/提问，跳转落在段首）/ 智能体回合（官方轮次大纲，长会话首屏即全量，可逐回合跳）',
        settingsEnum(turnRail.granularity === 'turn' ? 'turn' : 'segment', [['segment', '工作段（同折叠分段）'], ['turn', '智能体回合']], value => postSetConfig('turnRail.granularity', value))));
      sessionSection.append(settingsRow('跳转动画时长', '点击轮次导航节时的滚动动画时长（秒，0–1.5，步进 0.05）；0 = 瞬时跳转（不带动画）',
        settingsNumber(typeof turnRail.jumpSeconds === 'number' ? turnRail.jumpSeconds : 0.25, 0, 1.5, value => postSetConfig('turnRail.jumpSeconds', value), 0.05)));
      /* 0.0.128（G54 落地）：滚动条方式互斥 + 节点最小间距（密度）。 */
      /* 0.0.158（用户：设置面板记录 0.0.157 回落行为）：文案补"轨道不适用时自动回落系统滚动条"。 */
      sessionSection.append(settingsRow('滚动条方式', '自绘（默认）：节点轨道 + 可拖滑块，隐藏原生滚动条；滑块位置与节点联动（拖滑块=连续滚动，滚轮移到滑块上=浏览节点列）；轨道不适用时（只有一轮、空会话或视口过矮）自动回落到系统滚动条。原生：只保留系统滚动条，整套轨道隐藏',
        settingsEnum(turnRail.scrollbar === 'native' ? 'native' : 'custom', [['custom', '自绘（节点+滑块）'], ['native', '原生滚动条']], value => postSetConfig('turnRail.scrollbar', value))));
      /* 0.1.114（G55 轨道序号）：滚动静息徽标开关（默认开）——滚内容/拖滑块/滚节点列时浮出「N/M」。 */
      sessionSection.append(settingsRow('节点序号徽标', '滚动内容 / 拖动滑块 / 滚动节点列时，在轨道旁浮出「N/M」位置徽标（当前节点序号 / 可见节点总数），空闲 1 秒淡出；关 = 不显示',
        settingsSwitch(turnRail.nodeBadge !== false, value => postSetConfig('turnRail.nodeBadge', value))));
      /* 0.1.122（G55 内容设置）：摘要长度 / 编号文案档位 / 提示两行 / 节点列滚动动画。 */
      sessionSection.append(settingsRow('节点摘要长度', '节点悬停提示里保留的文字量（24–80 字，默认 40）——超长摘要截断加省略号',
        settingsNumber(typeof turnRail.summaryLength === 'number' ? turnRail.summaryLength : 40, 24, 80, value => postSetConfig('turnRail.summaryLength', value), 4)));
      sessionSection.append(settingsRow('编号文案档位', '节点编号的显示写法：N/M（默认）/ 第 N/M 个节点 / 第 N 轮。联动节点悬停提示前缀、搜索行编号片、浮出徽标（无障碍标签恒为完整措辞）',
        settingsEnum(railNumberStyle(), [['compact', 'N/M'], ['full', '第 N/M 个节点'], ['legacy', '第 N 轮']], value => postSetConfig('turnRail.numberStyle', value))));
      sessionSection.append(settingsRow('节点提示两行显示', '默认单行 + 省略号；开启后超长摘要折成两行（配合「节点摘要长度」使用更有意义）',
        settingsSwitch(turnRail.tipTwoLine === true, value => postSetConfig('turnRail.tipTwoLine', value))));
      sessionSection.append(settingsRow('节点列滚动动画', '滚轮滚节点列与高亮自动跟随的平滑收敛时长（秒，0–0.6，步进 0.05）；0 = 瞬时（关动画）',
        settingsNumber(typeof turnRail.scrollAnimSeconds === 'number' ? turnRail.scrollAnimSeconds : 0.18, 0, 0.6, value => postSetConfig('turnRail.scrollAnimSeconds', value), 0.05)));
      sessionSection.append(settingsRow('节点最小间距', '轨道上相邻节点的最小距离（px，12–96，步进 1）——轮数多时的密度控制：调大 → 轨道变长、节点更疏（需更多上下滚动）。各节点间距仍按段高比例分配，此项只是下限',
        settingsNumber(typeof turnRail.minGap === 'number' ? turnRail.minGap : 20, 12, 96, value => postSetConfig('turnRail.minGap', value), 1)));
      /* 0.0.144（用户需求②）：边缘拖拽自动滚列——触发带宽与最大速度（仅作用于拖拽，不影响滚轮滚列）。 */
      sessionSection.append(settingsRow('拖拽滚列 · 触发带宽', '按住滑块拖到轨道上下缘多少像素内开始自动滚列（px，8–200，步进 4）——带宽越大越早开始滚动、越不容易拖过头。仅作用于「边缘拖拽自动滚列」，不影响滚轮滚列',
        settingsNumber(typeof turnRail.dragEdgePx === 'number' ? turnRail.dragEdgePx : 64, 8, 200, value => postSetConfig('turnRail.dragEdgePx', value), 4)));
      sessionSection.append(settingsRow('拖拽滚列 · 最大速度', '边缘拖拽自动滚列的最大速度（px/秒，100–3000，步进 50）——进入带宽后按深度线性加速，越深越快；浅处很慢，便于精细定位。仅作用于「边缘拖拽自动滚列」，不影响滚轮滚列',
        settingsNumber(typeof turnRail.dragSpeed === 'number' ? turnRail.dragSpeed : 800, 100, 3000, value => postSetConfig('turnRail.dragSpeed', value), 50)));
      /* 0.0.148（G53）：含提问/审批停点节点自动标注（默认开）；右键节点可手动收藏/加标注。
         0.0.156：文案随 0.0.151/0.0.153 语义更新（小圆点→紫色圆角菱形、只属应答段）+ 收藏/标注独立性。 */
      sessionSection.append(settingsRow('标注提问/审批停点', '轨道上含提问/审批停点（工作段边界）的应答段节点显示紫色圆角菱形——一眼找到"需要你输入过的地方"。右键任意节点可收藏（金色）与编辑标注，两者各自独立——编辑标注不会自动收藏',
        settingsSwitch(turnRail.markStops !== false, value => postSetConfig('turnRail.markStops', value))));
      /* 0.0.149（用户：做成开关）：标注提示样式——只显示标注内容 / 标注+轮次摘要。 */
      sessionSection.append(settingsRow('标注提示样式', '悬停被标注的节点时提示的内容：只显示你写的标注 · 或标注后附「N/M · 摘要」',
        settingsEnum(turnRail.markNoteOnly === false ? 'full' : 'note', [['note', '只显示标注内容'], ['full', '标注 + N/M · 摘要']], value => postSetConfig('turnRail.markNoteOnly', value === 'note'))));
      /* 0.0.151（用户建议③）：节点颜色——复用「公式复制颜色」的取色组件（色板/调色盘/RGB/HSL/Hex）。 */
      sessionSection.append(settingsRow('收藏节点颜色', '轨道上被收藏节点的填充色（「跟随主题」= 主题黄）；被收藏且正在读时同样此色、节点正常放大',
        settingsColorPicker(typeof turnRail.markColor === 'string' ? turnRail.markColor : 'theme', value => postSetConfig('turnRail.markColor', value))));
      sessionSection.append(settingsRow('停点节点颜色', '含提问/审批停点节点的填充色（跟随主题 = 主题紫；节点为圆角菱形）',
        settingsColorPicker(typeof turnRail.stopColor === 'string' ? turnRail.stopColor : 'theme', value => postSetConfig('turnRail.stopColor', value))));
      /* 0.0.97（G42-B）：哨兵值 -1 = 永不删除（红字警示）；0/其他负值按 1 处理（norm）。 */
      const daysNorm = (value) => value === -1 ? -1 : Math.min(365, Math.max(1, Math.round(value)));
      const recycleDays = typeof session.recycleRetentionDays === 'number' ? session.recycleRetentionDays : 30;
      sessionSection.append(settingsRow('回收站保留天数', recycleDays === -1 ? '⚠ -1 = 永不删除（刻意设置的特殊值）' : '1–365；输入 -1 = 永不删除', settingsNumber(recycleDays, -1, 365, value => postSetConfig('recycleRetentionDays', value), 1, daysNorm), recycleDays === -1));
      const fileCardDays = typeof session.fileCardRetentionDays === 'number' ? session.fileCardRetentionDays : 30;
      sessionSection.append(settingsRow('文件卡副本保留天数', fileCardDays === -1 ? '⚠ -1 = 永不删除（刻意设置的特殊值）' : '1–365；输入 -1 = 永不删除', settingsNumber(fileCardDays, -1, 365, value => postSetConfig('fileCardRetentionDays', value), 1, daysNorm), fileCardDays === -1));
      body.append(sessionSection);
      /* 0.0.88：时间上下文——采样间隔（秒；写入 dsh profile 的 time-context 行） */
      const timeContext = current.timeContextSettings || {};
      const timeContextSection = settingsSection('时间上下文');
      timeContextSection.append(settingsRow('采样间隔（秒）', '0 = 每步都采样（token 略增）；60 = 每分钟最多一次；改动写入 dsh 配置，重启运行时后确保生效',
        settingsNumber(typeof timeContext.refreshSeconds === 'number' ? timeContext.refreshSeconds : 60, 0, 86400, value => postSetConfig('timeContext.refreshSeconds', value), 10)));
      body.append(timeContextSection);
      /* 运行环境（v1 只读展示） */
      const environment = current.environmentSettings || {};
      const envSection = settingsSection('运行环境（只读）');
      /* 0.0.146（用户）：侧栏扩展自身版本——reload/排障时一眼确认运行的哪一版（对应宿主的安装版本）。 */
      const versionRow = node('div', 'settings-ns-field');
      versionRow.append(node('span', 'settings-ns-path', '侧栏扩展 · dsh-sidebar'));
      versionRow.append(node('span', 'settings-ns-value', typeof current.extensionVersion === 'string' && current.extensionVersion !== '' ? current.extensionVersion : '—'));
      envSection.append(versionRow);
      const envLines = [
        ['DSH 可执行文件', environment.executable ? String(environment.executable) : '（内置 / 复用现有运行时）'],
        ['启动参数', environment.arguments && environment.arguments.length ? environment.arguments.join(' ') : '（默认）'],
        ['随侧栏启动', environment.autoStart === false ? '关' : '开'],
        ['复用现有运行时', environment.reuseExistingRuntime === false ? '关' : '开'],
        ['启动超时', typeof environment.startupTimeout === 'number' ? String(environment.startupTimeout) + ' ms' : '（默认）'],
        ['自主调试', environment.autonomousDebugging === true ? '开' : '关'],
      ];
      for (const line of envLines) {
        const row = node('div', 'settings-ns-field');
        row.append(node('span', 'settings-ns-path', line[0]));
        row.append(node('span', 'settings-ns-value', line[1]));
        envSection.append(row);
      }
      /* 0.0.73：适配矩阵（dsh/插件版本探测；超出已验证范围 → 未验证提示） */
      const compat = environment.compat;
      if (compat) {
        const compatRow = (label, line) => {
          const row = node('div', 'settings-ns-field');
          row.append(node('span', 'settings-ns-path', label));
          row.append(node('span', 'settings-ns-value', line.version || '—'));
          row.append(node('span', line.verified ? 'compat-badge ok' : 'compat-badge warn', line.verified ? '已验证' : '未验证'));
          return row;
        };
        envSection.append(compatRow('DSH 运行时', compat.dsh));
        for (const plugin of compat.plugins) envSection.append(compatRow('插件 · ' + plugin.name, plugin));
        if (compat.anyUnverified) {
          envSection.append(node('div', 'settings-row-hint', '当前版本组合不在适配矩阵内——升级 dsh/插件后请重跑复测清单（上下文明细等通道可能需要适配）。'));
        }
      }
      const envActions = node('div', 'settings-actions');
      envActions.append(settingsAction('在 VS Code 中打开完整 Web UI', () => vscode.postMessage({ type: 'open-web-ui' })));
      envSection.append(envActions);
      envSection.append(node('div', 'settings-row-hint', '以上为只读展示（改错会影响运行时启动）；修改请用下方「在 VS Code 设置中打开」。'));
      body.append(envSection);
      /* 0.0.75（G11）：更新检查——频率下拉 + 上次检查 + 可更新清单 + 立即检查 */
      const updateSection = settingsSection('更新检查');
      const updates = environment.updates || { stale: [] };
      updateSection.append(settingsRow('自动检查', undefined, settingsEnum(
        current.updateCheckFrequency === 'reload' ? 'reload'
          : current.updateCheckFrequency === 'weekly' ? 'weekly'
            : current.updateCheckFrequency === 'never' ? 'never' : 'startup',
        [['startup', '启动时（每天首次）'], ['reload', '每次 Reload'], ['weekly', '每周'], ['never', '永不']],
        value => postSetConfig('updateCheckFrequency', value))));
      const checkedRow = node('div', 'settings-ns-field');
      checkedRow.append(node('span', 'settings-ns-path', '上次检查'));
      checkedRow.append(node('span', 'settings-ns-value', typeof updates.checkedAt === 'number' ? formatUpdateTime(updates.checkedAt) : '—'));
      updateSection.append(checkedRow);
      if (updates.stale.length > 0) {
        for (const item of updates.stale) {
          const row = node('div', 'settings-ns-field');
          row.append(node('span', 'settings-ns-path', item.name === '@deepseek-ai/dsh' ? 'DSH 运行时' : '插件 · ' + item.name));
          row.append(node('span', 'settings-ns-value', (item.installed || '—') + ' → ' + (item.latest || '?')));
          row.append(node('span', 'compat-badge warn', '可更新'));
          updateSection.append(row);
        }
      } else if (typeof updates.checkedAt === 'number') {
        updateSection.append(node('div', 'settings-row-hint', '全部已是最新。'));
      } else {
        updateSection.append(node('div', 'settings-row-hint', '尚未检查（启动时自动或点「立即检查」）。'));
      }
      /* 0.0.90/0.0.91：技能（上游仓库）组——清单 ~/.dsh/skills/.sources.json 驱动；
         0.0.91 起无组标题（与插件行直接对齐）；非落后行用隐形占位徽标保持值列右缘对齐。 */
      const skillRows = updates.skills || [];
      if (skillRows.length > 0) {
        for (const item of skillRows) {
          const row = node('div', 'settings-ns-field');
          row.append(node('span', 'settings-ns-path', item.name));
          row.append(node('span', 'settings-ns-value', (item.installed || '—') + ' → ' + (item.latest || '?')));
          row.append(item.stale === true
            ? node('span', 'compat-badge warn', '可更新')
            : node('span', 'compat-badge badge-spacer', '可更新'));
          updateSection.append(row);
        }
      }
      if (updates.refreshError) {
        updateSection.append(node('div', 'settings-row-hint', String(updates.refreshError)));
      }
      if (updates.modelDrift) {
        updateSection.append(node('div', 'settings-row-hint', '模型目录有变化：' + updates.modelDrift));
      }
      const updateActions = node('div', 'settings-actions');
      updateActions.append(settingsAction('立即检查', () => vscode.postMessage({ type: 'check-updates' })));
      updateSection.append(updateActions);
      updateSection.append(node('div', 'settings-row-hint', '检查 npm registry 与技能上游（.sources.json）的最新版本（仅提醒，不自动升级）；失败/离线静默。'));
      body.append(updateSection);
      /* 0.1.0（B6 A8）：诊断——输出面板的调试日志开关（默认关；排障时打开）。
         2026-10-06 修复：本行原读 current.diagnostics（state 上并不存在此顶层字段，恒 undefined）
         ⇒ 开关点了也不会同步显示（reload 无效；实际写入正常）。全站口径 = ui（=current.uiSettings），
         此处漏改（"uiSettings 只写不读"家族第 4 例）。 */
      const diagSection = settingsSection('诊断');
      diagSection.append(settingsRow('调试日志', '把 webview 的每帧 [trace] 与调试明细写进「输出」面板（DeepSeek Harness 通道）。流式期间会持续刷屏，默认关闭，排障时临时打开。', settingsSwitch(ui.diagnostics === true, value => postSetConfig('ui.diagnostics', value))));
      body.append(diagSection);
      /* G6 v3（0.0.67）: 默认模型 / 思考档 / 预设——专用下拉（数据源=既有 state；
         写入 agent-default-model / agent-presets ns；只影响新建会话）。 */
      const defaultSection = settingsSection('默认模型与预设');
      const nsOf = (name) => (dshSettings && dshSettings.ok === true)
        ? dshSettings.namespaces.find(candidate => candidate.ns === name)
        : undefined;
      const fieldOf = (namespace, path) => namespace === undefined
        ? undefined
        : (namespace.fields || []).find(candidate => candidate.path === path);
      const defaultRow = (label, key, control) => {
        const row = settingsRow(label, undefined, control);
        row.title = key;
        for (const el of control.querySelectorAll('.ds-trigger, input')) { if (!el.title) el.title = key; }
        return row;
      };
      const modelNs = nsOf('agent-default-model');
      const presetNs = nsOf('agent-presets');
      const modelList = Array.isArray(current.models) ? current.models : [];
      if (modelNs === undefined) {
        defaultSection.append(node('div', 'settings-row-hint', '正在加载 DSH 配置…（本区需要运行时在线）'));
      } else if (modelList.length === 0) {
        defaultSection.append(node('div', 'settings-row-hint', '运行环境离线：暂无可用模型列表。'));
      } else {
        const providerField = fieldOf(modelNs, 'provider');
        const modelField = fieldOf(modelNs, 'model');
        const effortField = fieldOf(modelNs, 'reasoningEffort');
        const globalProvider = providerField ? providerField.value : undefined;
        const globalModel = modelField ? modelField.value : undefined;
        const globalEffort = effortField ? effortField.value : undefined;
        /* 0.0.68（用户复测反馈）: 模型 id 改名后全局默认可能指向"不在可用列表"的旧 id——
           ① 精确匹配失败时按显示名兜底匹配（自愈路径）；② 仍未命中→占位项明确标注"（当前 · 不在可用列表）"
           + 提示行；③ 思考档兜底用"首个可用模型的档位梯子"（不再退化成单选项）。 */
        const exactModel = modelList.find(candidate => candidate.provider === globalProvider && candidate.model === globalModel);
        const selectedModel = exactModel;
        const modelMatched = selectedModel !== undefined;
        const modelKey = JSON.stringify([globalProvider, globalModel]);
        const modelCurrentKey = selectedModel !== undefined
          ? JSON.stringify([selectedModel.provider, selectedModel.model])
          : modelKey;
        const modelOptions = modelList.map(candidate => [JSON.stringify([candidate.provider, candidate.model]), String(candidate.providerLabel || candidate.provider) + ' / ' + String(candidate.label || candidate.model)]);
        if (!modelMatched && globalModel !== undefined) {
          modelOptions.unshift([modelKey, String(globalModel) + '（当前 · 不在可用列表）']);
        }
        defaultSection.append(defaultRow('默认模型', 'agent-default-model.model',
          settingsEnum(modelCurrentKey, modelOptions, chosen => {
            let next;
            try { next = JSON.parse(chosen); } catch { return; }
            if (!Array.isArray(next) || next.length !== 2) return;
            const target = modelList.find(candidate => candidate.provider === next[0] && candidate.model === next[1]);
            const ops = [
              { op: 'set', path: ['provider'], value: next[0] },
              { op: 'set', path: ['model'], value: next[1] },
            ];
            /* 换模型时档位跟随：旧档不在新模型可选列表 → 用其默认档。 */
            const efforts = (target && target.reasoningEfforts) || [];
            if (!efforts.some(effort => effort.id === globalEffort)) {
              const fallback = (target && target.defaultReasoningEffort) || (efforts[0] && efforts[0].id);
              if (fallback !== undefined) ops.push({ op: 'set', path: ['reasoningEffort'], value: fallback });
            }
            mutateDshSetting(modelNs, ops);
          })));
        if (!modelMatched) {
          defaultSection.append(node('div', 'settings-row-hint', '当前默认模型不在该运行时提供的模型列表中（可能已改名）；建议重新选择一个可用模型。'));
        }
        const effortSource = (selectedModel && Array.isArray(selectedModel.reasoningEfforts) && selectedModel.reasoningEfforts.length > 0)
          ? selectedModel.reasoningEfforts
          : ((modelList[0] && modelList[0].reasoningEfforts) || []);
        const effortOptions = effortSource.map(effort => [String(effort.id), String(effort.label || effort.id)]);
        if (effortOptions.length === 0 && globalEffort !== undefined) effortOptions.push([String(globalEffort), String(globalEffort)]);
        defaultSection.append(defaultRow('默认思考档', 'agent-default-model.reasoningEffort',
          settingsEnum(String(globalEffort), effortOptions, chosen => mutateDshSetting(modelNs, [{ op: 'set', path: ['reasoningEffort'], value: chosen }]))));
        const presetField = fieldOf(presetNs, 'default');
        const presetState = current.agentPreset || {};
        const presetOptions = (presetState.options || []).map(option => [String(option.id), String(option.label || option.id)]);
        const presetCurrent = presetField ? presetField.value : presetState.current;
        if (presetOptions.length === 0 && presetCurrent !== undefined) presetOptions.push([String(presetCurrent), String(presetCurrent)]);
        defaultSection.append(defaultRow('默认预设', 'agent-presets.default',
          settingsEnum(String(presetCurrent), presetOptions, chosen => {
            if (presetNs === undefined) return;
            mutateDshSetting(presetNs, [{ op: 'set', path: ['default'], value: chosen }]);
          })));
        defaultSection.append(node('div', 'settings-row-hint', '修改的是新建会话的全局默认；当前已打开的会话不受影响。'));
      }
      body.append(defaultSection);
      /* DSH 配置（G6 v2 起可编辑；secret 只写不读） */
      const dshSection = settingsSection('DSH 配置');
      if (dshSettings === null) {
        dshSection.append(node('div', 'settings-row-hint', dshSettingsPending ? '加载中…' : '尚未加载'));
        if (!dshSettingsPending) { dshSettingsPending = true; vscode.postMessage({ type: 'describe-dsh-settings' }); }
      } else if (dshSettings.ok !== true) {
        dshSection.append(node('div', 'settings-row-hint', '读取失败：' + string(dshSettings.message || '未知错误')));
        dshSection.append(settingsAction('重试', () => { dshSettings = null; dshSettingsPending = true; vscode.postMessage({ type: 'describe-dsh-settings' }); }));
      } else {
        for (const namespace of dshSettings.namespaces) {
          const nsName = string(namespace.ns);
          const item = document.createElement('details');
          item.className = 'settings-ns';
          const summary = document.createElement('summary');
          summary.textContent = dshNsTitle(nsName) + ' · ' + String((namespace.fields || []).length) + ' 项' + (namespace.overridden === true ? ' · 已改' : '');
          summary.title = nsName;
          if (dshOpenNs.has(nsName)) item.open = true;
          item.addEventListener('toggle', () => { if (item.open) dshOpenNs.add(nsName); else dshOpenNs.delete(nsName); });
          item.append(summary);
          for (const field of namespace.fields || []) {
            const row = node('div', 'settings-ns-field');
            const hint = dshFieldHint(nsName, string(field.path));
            const pathEl = node('span', 'settings-ns-path', dshFieldLabel(nsName, string(field.path)));
            pathEl.title = nsName + '.' + string(field.path) + (hint === undefined ? '' : ' — ' + hint);
            row.append(pathEl);
            const control = dshSettingControl(namespace, field);
            if (control !== undefined) {
              row.classList.add('editable');
              row.append(control);
            } else {
              const valueText = JSON.stringify(field.value);
              const valueEl = node('span', 'settings-ns-value', typeof valueText === 'string' ? valueText.slice(0, 120) : '');
              if (typeof valueText === 'string') valueEl.title = valueText.slice(0, 500);
              row.append(valueEl);
            }
            item.append(row);
            if (hint !== undefined) item.append(node('div', 'settings-row-hint settings-ns-hint', hint));
          }
          dshSection.append(item);
        }
      }
      const dshActions = node('div', 'settings-actions');
      dshActions.append(settingsAction('在 VS Code 设置中打开', () => vscode.postMessage({ type: 'open-vscode-settings' })));
      dshActions.append(settingsAction('打开运行时配置文件', () => vscode.postMessage({ type: 'open-dsh-settings' })));
      dshActions.append(settingsAction('刷新 DSH 配置', () => { dshSettings = null; dshSettingsPending = true; vscode.postMessage({ type: 'describe-dsh-settings' }); }));
      dshSection.append(dshActions);
      body.append(dshSection);
      body.scrollTop = restoredScrollTop;
    }
    function openSettingsPanel(showConnections = false) {
      if (!settingsPanelOpen) connectionsExpanded = showConnections;
      else if (showConnections) connectionsExpanded = true;
      settingsPanelOpen = true;
      renderedSettingsKey = '';
      elements.settingsPanel.classList.remove('hidden');
      renderSettingsPanel();
      /* 0.0.74: 打开时拉一次最新适配矩阵（文件改动/升级后重开面板即刷新，无需 Reload） */
      vscode.postMessage({ type: 'describe-compat' });
      /* 0.0.163（审查 P1-2）：存储区占用统计（打开面板即刷新）。 */
      vscode.postMessage({ type: 'describe-storage' });
    }
    function closeSettingsPanel() {
      settingsPanelOpen = false;
      connectionsExpanded = false;
      if (connectionDraft) connectionDraft.apiKey = '';
      elements.settingsPanel.classList.add('hidden');
      document.getElementById('modelConnectionsSection')?.replaceWith(renderConnectionsSection());
    }
    elements.settingsOpen.addEventListener('click', () => { if (settingsPanelOpen) closeSettingsPanel(); else openSettingsPanel(); });
    elements.settingsClose.addEventListener('click', () => closeSettingsPanel());
    /* 0.0.163（用户反馈·颜色/边缘审查首条）：输入设备追踪——焦点环只在 **Tab 导航**时出现：
       指针按下 → body[data-input=pointer]（CSS 抑制 :focus-visible 环）；按 Tab → 恢复 keyboard
       （键盘用户行为不变）。治"鼠标开门 → Esc 关门后齿轮残留蓝环"。 */
    document.addEventListener('pointerdown', () => { document.body.dataset.input = 'pointer'; }, true);
    /* 2026-09-24（用户复测反馈②）：点击类控件的「拖选守卫」——从"存在选区就不响应"改为**手势判定**。
       五处共用（过程折叠条 / 消息折叠 / 块折叠 / 变更文件「展开其余 N 个」/ 公式点击复制）：
       旧判据只要页面上**存在**选区就吞掉点击，用户"先选中一段文字、再点按钮"时全部静默失效
       （实测：按下时浏览器并不清选区 ⇒ 旧守卫恒真）。正确判据 = 本次「按下 → 抬起」之间选区是否
       被这次手势**改动**：改了 ⇒ 是拖选的收尾（不触发，守卫本意）；没改 ⇒ 是点击，照常触发。 */
    let selectionTextAtDown = '';
    const selectionTextNow = () => (window.getSelection ? String(window.getSelection().toString() || '') : '');
    document.addEventListener('mousedown', () => { selectionTextAtDown = selectionTextNow(); }, true);
    function selectionDragEnded() {
      const now = selectionTextNow();
      return now !== '' && now !== selectionTextAtDown;
    }
    document.addEventListener('keydown', (event) => { if (event.key === 'Tab') document.body.dataset.input = 'keyboard'; }, true);
    /* C3: 上下文面板开合（入口 = 圆环弹窗底部「查看详情」） */
    function openContextPanel() {
      contextPanelOpen = true;
      renderedContextState = undefined;
      usageOpen = false;
      elements.usagePanel.classList.add('hidden');
      elements.usageTrigger.setAttribute('aria-expanded', 'false');
      elements.contextPanel.classList.remove('hidden');
      /* 0.0.130：明细（nodes/requests/events）走按需通道——仅面板可见时拉取，避免后台长会话反复拉大载荷。 */
      vscode.postMessage({ type: 'context-panel-visibility', open: true });
      if (state) renderContextPanel(state);
    }
    function closeContextPanel() {
      contextPanelOpen = false;
      elements.contextPanel.classList.add('hidden');
      hideContextTip();
      vscode.postMessage({ type: 'context-panel-visibility', open: false });
    }
    elements.contextClose.addEventListener('click', () => closeContextPanel());
    /* G27 round2 (0.0.48): markdown 块右键绑定——attachBlockActions/mathEl 挂 data-mkd + __mkd；
       软更新复用节点时绑定保留。 */
    function ctxMenuForBlock(target) {
      if (!target || typeof target.closest !== 'function') return undefined;
      const host = target.closest('[data-mkd]');
      return host && host.__mkd ? host.__mkd : undefined;
    }
    /* G27 round2 (0.0.48): 消息级右键——article.message 反向查 renderedMessages（无需 attribute，
       软更新节点复用不影响）。 */
    function messageForEl(article) {
      for (const [id, rec] of renderedMessages) {
        if (rec.node === article) return { id, message: rec.message };
      }
      return undefined;
    }
    /* G27 round2 (0.0.48): 对话分叉（轻量分支）——协议无 branch RPC（G5 调研），fork = 新建会话
       （扩展侧 fork-session）并预填分支点消息文本（fork-created 回执时写入草稿）；用途：回退重来
       / 模板复用（如每周数据处理方式定稿后 fork 出固定模板会话）。 */
    let pendingForkText;
    function forkFromMessage(message) {
      pendingForkText = String(message && message.text ? message.text : '');
      vscode.postMessage({ type: 'fork-session' });
    }
    /* 0.0.167（B4 P2）：消息级菜单项（右键 / 尾行「…」共用）。
       0.0.162（审查 P0-3）：复制改经扩展取**全文**——超长助手回复在 webview 态被瘦身
       （text 为空 + deferredBody），直接复制会得到空串且仍闪光报成功。
       0.0.164（B3 审查 P1-7）：无可复制文本（如纯图片消息）不闪光——失败反馈交给扩展侧 toast。 */
    function messageMenuOptions(message, article) {
      const options = [
        ctxMenuOption('复制该消息', () => {
          vscode.postMessage({ type: 'copy-message', id: message.id });
          if (String(message.text || '') !== '' || message.deferredBody === true) flashCopied(article);
        }),
        ctxMenuOption('从此消息分叉', () => forkFromMessage(message)),
      ];
      /* 0.0.76：turn-rewind 回退（用户消息 + 运行时装有插件时出现） */
      if (message.role === 'user' && typeof message.seq === 'number' && state && state.rewindAvailable === true) {
        options.push(ctxMenuOption('回退到发送这条消息之前…', () => {
          vscode.postMessage({ type: 'rewind-preview', sessionId: state.sessionId, messageSeq: message.seq });
        }));
      }
      return options;
    }
    document.addEventListener('contextmenu', (event) => {
      /* G29 round2 (0.0.55): 图片预览打开期间/关闭后（previewContextActive）禁弹一切菜单——
         右键关闭预览是 pointerdown 触发，overlay 随即隐藏，随后派发的 contextmenu 会命中其下方元素
         （此前只 preventDefault 原生菜单，拦不住本处自定义菜单 → 用户实测"光标在图上就弹菜单"）。
         0.0.81 起主拦截在捕获阶段（blockPreviewContextMenu），此处保留为兜底。 */
      if (previewContextActive) return;
      /* 流式期间文本未完，复制入口全部禁用（与 .block-actions/.math-copy 隐藏规则一致） */
      if (event.target.closest && event.target.closest('.streaming')) return;
      /* 0.0.55（反馈②补）：图片/文件卡优先——卡片在消息 article 内，必须比消息级先判，
         否则气泡里的图片/文件永远只能拿到"复制该消息/分叉"（0.0.48 消息级菜单引入后
         图片级被遮蔽的回归；用户 0.0.55 复测反馈"右键图片却出现消息菜单"）。 */
      const ctx = ctxMenuFor(event.target);
      if (ctx) {
        event.preventDefault();
        showCtxMenu(event.clientX, event.clientY, () => buildCtxMenuOptions(ctx));
        return;
      }
      /* G27 round2 (0.0.48): 块级（块在消息 article 内，也必须先于消息级） */
      const mkd = ctxMenuForBlock(event.target);
      if (mkd) {
        event.preventDefault();
        const host = event.target.closest('[data-mkd]');
        showCtxMenu(event.clientX, event.clientY, () => {
          const actions = BLOCK_ACTIONS[mkd.kind] || BLOCK_ACTIONS.default;
          /* G27 round2 (0.0.50): 右键复制同样点亮被复制的块（flashCopied 与按钮一致） */
          return actions.map(a => ctxMenuOption(a.label, () => { a.run(mkd)(); flashCopied(host); }));
        });
        return;
      }
      /* 消息级：复制该消息 / 从此消息分叉（右键与尾行「…」按钮共用 messageMenuOptions） */
      const article = event.target.closest && event.target.closest('article.message');
      if (article) {
        const rec = messageForEl(article);
        if (rec) {
          event.preventDefault();
          showCtxMenu(event.clientX, event.clientY, () => messageMenuOptions(rec.message, article));
          return;
        }
      }
    });
    /* 0.0.55: 图片/文件卡菜单项构建（从 contextmenu 处理器抽出——图片/文件级判断已前移，
       此处供其复用；draft chip 与气泡卡共用同一套项）。 */
    const IMAGE_FILE_RE = /\\.(png|jpe?g|gif|bmp|webp|avif|tiff?|ico|svg)$/i;
    /* 0.0.55（反馈②二次）: .NET(System.Drawing) 只能解码 png/jpeg/gif/bmp/tiff/ico（实测解码器列表无 webp），
       而运行时会把带元数据的上传图归一化为 **WebP**（有 alpha 时）→ 发送后"复制 PNG"的 PowerShell 解码
       必然失败（用户实测"发送后无法复制为PNG，只能复制原格式"）。改：这几种本侧（Chromium 可解）先经
       canvas 转 PNG 再交扩展端入剪贴板；其余格式原样直送（保留原始字节作为剪贴板 'PNG' 格式）。
       0.0.59（用户实测 gif 复制 PNG 灰底）: 剪贴板脚本只在载荷**是 PNG 签名**时才附 'PNG' 字节，非 PNG
       只剩 CF_BITMAP（无 alpha → 透明变灰 211,211,211）。所以凡不是 PNG 的位图都要先转 PNG——
       原列表漏了 gif/bmp/ico/tiff（gif 最常带透明）。 */
    const NEEDS_PNG_CONVERT = /^image\\/(webp|avif|svg\\+xml|gif|bmp|vnd\\.microsoft\\.icon|x-icon|tiff?)$/i;
    /* 0.0.56（审核 P1）: 转换 canvas 加尺寸上限——原实现按原尺寸建布，超大 webp/avif（如 8K）会撑出
       数百 MB 峰值甚至建布失败（回落原字节后仍失败，用户只见"复制失败"）。上限与运行时附件归一化
       上限（4096）取齐；缩小时开启平滑。 */
    const PNG_CONVERT_MAX_EDGE = 4096;
    function convertToPngDataUrl(src) {
      return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
          try {
            const natural = Math.max(img.naturalWidth, img.naturalHeight);
            if (natural <= 0) { resolve(undefined); return; }
            const scale = natural > PNG_CONVERT_MAX_EDGE ? PNG_CONVERT_MAX_EDGE / natural : 1;
            const width = Math.max(1, Math.round(img.naturalWidth * scale));
            const height = Math.max(1, Math.round(img.naturalHeight * scale));
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            const c = canvas.getContext('2d');
            if (c === null) { resolve(undefined); return; }
            c.imageSmoothingEnabled = scale < 1;
            c.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/png'));
          } catch { resolve(undefined); }
        };
        img.onerror = () => resolve(undefined);
        img.src = src;
      });
    }
    async function copyImageAsPng(ctx) {
      const data = string(ctx.data);
      const declared = string(ctx.mediaType);
      const fromUrl = (/^data:([^;,]+)/.exec(data) || [])[1] || '';
      const mime = declared !== '' ? declared : fromUrl;
      const src = imageSrc(mime, data);
      let payload = data;
      if (src !== undefined && NEEDS_PNG_CONVERT.test(mime)) {
        const png = await convertToPngDataUrl(src);
        if (typeof png === 'string') payload = png; /* 转换失败则回落原数据，由扩展端照常提示失败 */
      }
      vscode.postMessage({ type: 'copy-image-clip', data: payload, name: string(ctx.name, '图片') });
    }
    function buildCtxMenuOptions(ctx) {
      const options = [];
      if (ctx.kind === 'file') {
        options.push(ctxMenuOption('复制文件名', () => vscode.postMessage({ type: 'copy-text', text: ctx.name })));
        options.push(ctxMenuOption('复制路径', () => vscode.postMessage({ type: 'copy-text', text: ctx.path })));
        /* 0.0.55（反馈②）: 图片文件补"复制图片(PNG)"——此前图片若以文件形式附带（如拖入的 PNG），
           菜单只有文件类操作，没有位图复制入口。 */
        if (IMAGE_FILE_RE.test(string(ctx.path))) {
          options.push(ctxMenuOption('复制图片(PNG)', () => vscode.postMessage({ type: 'copy-file-as-image', path: ctx.path, name: ctx.name })));
        }
        options.push(ctxMenuOption('复制文件', () => vscode.postMessage({ type: 'copy-files', path: ctx.path, name: ctx.name })));
        options.push(ctxMenuOption('另存为…', () => vscode.postMessage({ type: 'save-as', kind: 'file', path: ctx.path, name: ctx.name })));
        options.push(ctxMenuOption('用其他程序打开…', () => vscode.postMessage({ type: 'open-with', path: ctx.path })));
      } else {
        /* 0.0.78（GIF③）: 草稿动图 → 选帧发送（消息卡无 id → 不出现；已选帧态=frameSelections 在场）。
           G34（0.0.82）: 判定改字节嗅探 → GIF / APNG / 动图 WebP 都给入口。 */
        const draftEntry = typeof ctx.id === 'string' ? draftImages.find(image => image.id === ctx.id) : undefined;
        if (draftEntry !== undefined && (animatedKindOfEntry(draftEntry) !== undefined || draftFrameSelections(draftEntry).length > 0)) {
          options.push(ctxMenuOption('选择发送帧…', () => { void openFramePicker(string(draftEntry.id)); }));
        }
        options.push(ctxMenuOption('复制文件名', () => vscode.postMessage({ type: 'copy-text', text: ctx.name })));
        /* 0.0.55（反馈③）+ 0.0.58：原格式复制对气泡图同样开放——extension 侧四级取数：
           id→草稿 origin、attachmentId→发送留档（落盘，真原字节）、name→会话级缓存、兜底→ctx.data 自身字节。
           G6 (0.0.60): imageCopyFormat 决定两档次序（两档都保留）——'original'（默认）原格式在前；'png' PNG 在前。 */
        if (ctx.data) {
          const originalOption = () => ctxMenuOption('复制原格式', () => vscode.postMessage({ type: 'copy-image-original', id: ctx.id, name: ctx.name, data: ctx.data, attachmentId: ctx.attachmentId }));
          const pngOption = () => ctxMenuOption('复制 PNG', () => { void copyImageAsPng(ctx); });
          if (state && state.imageCopyFormat === 'png') options.push(pngOption(), originalOption());
          else options.push(originalOption(), pngOption());
        }
        options.push(ctxMenuOption('另存为…', () => vscode.postMessage({ type: 'save-as', kind: 'image', name: ctx.name, data: ctx.data || '' })));
      }
      return options;
    }
    ['click', 'scroll', 'resize'].forEach((type) => document.addEventListener(type, closeCtxMenu));
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeCtxMenu(); if (!elements.framePicker.classList.contains('hidden')) closeFramePicker(); else if (settingsPanelOpen) closeSettingsPanel(); else if (contextPanelOpen) closeContextPanel(); } });

    function syncDraftZoneVisibility() {
      const hidden = elements.contextChips.classList.contains('hidden') && elements.attachments.classList.contains('hidden');
      elements.draftZone.classList.toggle('hidden', hidden);
      const trash = elements.modeChips.querySelector('.clear-trash');
      if (trash) updateTrashState(trash);
    }
    function updateTrashState(trash) {
      const has = elements.prompt.value !== '' || draftImages.length > 0 || (ideContext.pinned || []).length > 0;
      /* 2026-09-25 观感（批 3）：无草稿时**整块隐藏**——此前只是 35% 淡显，空态下像一块悬浮杂物。 */
      trash.classList.toggle('hidden', !has);
      trash.disabled = !has;
      trash.title = has
        ? '清空当前会话草稿（文本、图片与文件；其他会话不受影响）'
        : '无草稿（清空当前会话的文本、图片与文件）';
    }
    /* 0.0.36 fix (bug⑩): 签名守卫——pinned/selection/开关未变则跳过全量重建（原实现每帧
       replaceChildren 重建 chips，含 img dataURL 重解码，是流式掉帧闪烁的固定开销）。 */
    let lastIdeContextFingerprint;
    function ideContextFingerprint() {
      const includeOn = includeContextOn !== false;
      const pinned = ((ideContext && ideContext.pinned) || []).filter(item => includeOn || item.id !== '__attached__');
      const references = [];
      if (includeOn && ideContext && ideContext.selection && !pinned.some(item => sameSelection(item, ideContext.selection))) references.push(ideContext.selection);
      references.push(...pinned);
      return JSON.stringify(references.map(reference => [reference.kind, reference.path, reference.id, reference.text]));
    }
    function renderIdeContext() {
      const fingerprint = ideContextFingerprint();
      if (fingerprint === lastIdeContextFingerprint) { syncDraftZoneVisibility(); return; }
      lastIdeContextFingerprint = fingerprint;
      elements.contextChips.replaceChildren();
      const includeOn = includeContextOn !== false;
      const pinned = ((ideContext && ideContext.pinned) || []).filter(item => includeOn || item.id !== '__attached__');
      const references = [];
      if (includeOn && ideContext && ideContext.selection && !pinned.some(item => sameSelection(item, ideContext.selection))) references.push(ideContext.selection);
      references.push(...pinned);
      elements.contextChips.classList.toggle('hidden', references.length === 0); syncDraftZoneVisibility();
      for (const reference of references) {
        const attached = reference.id === '__attached__';
        const chip = node('div', 'context-chip' + (reference.kind === 'selection' ? ' selection' : '') + (attached ? ' attached' : ''));
        /* tooltip removed per user 2026-09-02: the chips are self-explanatory for file references */
        if (reference.kind === 'file') {
          /* Smart open (G22 parity): text → editor preview, others → system default app. */
          chip.classList.add('chip-file');
          chip.__ctx = { kind: 'file', name: displayFileName(reference.path), path: reference.path };
          chip.addEventListener('click', () => vscode.postMessage({ type: 'open-attachment', path: reference.path }));
        }
        const badge = node('span', 'context-icon');
        badge.append(fileTypeIconEl(reference.path, reference.kind));
        chip.append(badge, node('span', 'context-name', contextLabel(reference)));
        const remove = node('button', 'context-remove', '✕'); remove.title = attached ? '移除附件' : (reference.kind === 'selection' ? '忽略当前编辑器上下文' : '移除附件');
        remove.addEventListener('click', (event) => { event.stopPropagation(); vscode.postMessage({ type: 'remove-context', id: reference.id || '__active__' }); }); chip.append(remove);
        elements.contextChips.append(chip);
      }
    }
    function currentMentionQuery() {
      const cursor = elements.prompt.selectionStart || 0;
      const prefix = elements.prompt.value.slice(0, cursor);
      const match = /(?:^|[\\s(])@(?:\\{([^}]*)|([^\\s@{}]*))$/.exec(prefix);
      if (!match) return undefined;
      const start = prefix.lastIndexOf('@');
      return start < 0 ? undefined : { start, cursor, query: match[1] || match[2] || '' };
    }
    function requestMentions() {
      const mention = currentMentionQuery();
      if (!mention) { mentionCandidates = []; elements.mentionMenu.classList.add('hidden'); return; }
      const requestId = ++mentionRequestId;
      vscode.postMessage({ type: 'request-mentions', requestId, query: mention.query });
    }
    function renderMentionMenu() {
      const mention = currentMentionQuery();
      elements.mentionMenu.replaceChildren();
      if (!mention || !mentionCandidates.length) { elements.mentionMenu.classList.add('hidden'); return; }
      elements.commandMenu.classList.add('hidden');
      mentionIndex = Math.min(mentionIndex, mentionCandidates.length - 1);
      elements.mentionMenu.classList.remove('hidden');
      mentionCandidates.forEach((candidate, index) => {
        const option = node('button', 'command-option' + (index === mentionIndex ? ' selected' : ''));
        option.type = 'button'; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(index === mentionIndex));
        const line = node('div', 'command-option-line');
        if (candidate.kind === 'problems') {
          line.append(node('span', 'command-option-name', '@problems'), node('span', 'command-option-hint', '工作区诊断'));
          option.append(line, node('div', 'command-option-description', '包含全部当前错误与警告'));
        } else if (candidate.kind === 'problem') {
          const location = candidate.path + ':' + candidate.startLine + ':' + candidate.startCharacter;
          line.append(node('span', 'command-option-name', location), node('span', 'command-option-hint', candidate.severity === 'error' ? '错误' : '警告'));
          option.append(line, node('div', 'command-option-description', (candidate.source ? candidate.source + ' · ' : '') + candidate.message));
        } else {
          line.append(node('span', 'command-option-name', candidate.path + (candidate.kind === 'folder' ? '/' : '')));
          line.append(node('span', 'command-option-hint', candidate.kind === 'folder' ? '文件夹' : '文件'));
          option.append(line);
        }
        option.addEventListener('mousedown', event => { event.preventDefault(); pickMention(candidate); });
        elements.mentionMenu.append(option);
      });
    }
    function pickMention(candidate) {
      const mention = currentMentionQuery(); if (!mention) return;
      const path = candidate.kind === 'problem'
        ? candidate.path + ':' + candidate.startLine + ':' + candidate.startCharacter
        : candidate.path + (candidate.kind === 'folder' ? '/' : '');
      const encoded = candidate.kind === 'problems' ? '@problems' : (path.includes(' ') || candidate.kind === 'problem' ? '@{' + path + '}' : '@' + path);
      const suffix = elements.prompt.value.slice(mention.cursor);
      const insertion = encoded + (suffix.startsWith(' ') ? '' : ' ');
      elements.prompt.value = elements.prompt.value.slice(0, mention.start) + insertion + suffix;
      const cursor = mention.start + insertion.length;
      elements.prompt.setSelectionRange(cursor, cursor);
      mentionCandidates = []; mentionIndex = 0; elements.mentionMenu.classList.add('hidden');
      resizePrompt(); elements.prompt.focus();
    }
    function menuCandidates() {
      if (!state) return [];
      const raw = elements.prompt.value;
      if (raw.includes('\\n')) return [];
      if (raw.toLowerCase().startsWith('/permission ')) {
        const query = raw.slice('/permission '.length).trim().toLowerCase();
        if (query.includes(' ')) return [];
        return (state.permissions || [])
          .filter(permission => permission.value.toLowerCase().includes(query) || permission.label.toLowerCase().includes(query))
          .map(permission => ({ kind: 'permission', permission }));
      }
      const text = raw.trim();
      if (!text.startsWith('/') || text.includes(' ')) return [];
      const query = text.slice(1).toLowerCase();
      const commands = (state.commands || [])
        .filter(command => command.name.toLowerCase().includes(query))
        .map(command => ({ kind: 'command', command }));
      const commandNames = new Set((state.commands || []).map(command => command.name));
      const skills = (state.skills || [])
        .filter(skill => !commandNames.has(skill.name) && skill.name.toLowerCase().includes(query))
        .map(skill => ({ kind: 'skill', skill }));
      return [...commands, ...skills];
    }
    function renderCommandMenu() {
      const candidates = menuCandidates();
      elements.commandMenu.replaceChildren();
      if (!candidates.length) { elements.commandMenu.classList.add('hidden'); return; }
      elements.mentionMenu.classList.add('hidden');
      commandIndex = Math.min(commandIndex, candidates.length - 1);
      elements.commandMenu.classList.remove('hidden');
      let section = '';
      candidates.forEach((candidate, index) => {
        const nextSection = candidate.kind === 'permission' ? '' : (candidate.kind === 'command' ? '命令' : '技能');
        if (nextSection && nextSection !== section) {
          elements.commandMenu.append(node('div', 'command-section-label', nextSection)); section = nextSection;
        }
        const option = node('button', 'command-option' + (index === commandIndex ? ' selected' : ''));
        option.type = 'button'; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(index === commandIndex));
        const line = node('div', 'command-option-line');
        if (candidate.kind === 'permission') {
          const permission = candidate.permission;
          line.append(node('span', 'command-option-name', permission.label));
          if (permission.label !== permission.value) line.append(node('span', 'command-option-hint', permission.value));
          if (permission.selected) line.append(node('span', 'command-option-current', '当前'));
          option.append(line, node('div', 'command-option-description', permission.description || '使用此权限预设'));
        } else if (candidate.kind === 'command') {
          const command = candidate.command;
          line.append(node('span', 'command-option-name', '/' + command.name));
          if (command.input && command.input.hint) line.append(node('span', 'command-option-hint', command.input.hint));
          option.append(line, node('div', 'command-option-description', command.description));
        } else {
          const skill = candidate.skill;
          line.append(node('span', 'command-option-name', '/' + skill.name));
          line.append(node('span', 'command-option-hint', skill.modelInvocable ? '技能' : '仅用户'));
          const description = skill.whenToUse ? skill.description + ' · ' + skill.whenToUse : skill.description;
          option.append(line, node('div', 'command-option-description', description)); option.title = description;
        }
        option.addEventListener('mousedown', event => { event.preventDefault(); pickCandidate(candidate); });
        elements.commandMenu.append(option);
      });
    }
    function pickCandidate(candidate) {
      if (candidate.kind === 'permission') {
        vscode.postMessage({ type: 'send', text: '/permission ' + candidate.permission.value });
        elements.prompt.value = ''; commandIndex = 0; resetPrompt(); return;
      }
      if (candidate.kind === 'skill') {
        elements.prompt.value = '/' + candidate.skill.name + ' ';
        elements.prompt.placeholder = candidate.skill.whenToUse || candidate.skill.description || '技能说明';
        commandIndex = 0; resizePrompt(); renderCommandMenu(); elements.prompt.focus(); return;
      }
      pickCommand(candidate.command);
    }
    function pickCommand(command) {
      if (command.input) {
        elements.prompt.value = '/' + command.name + ' ';
        elements.prompt.placeholder = command.input.hint || '命令参数';
        commandIndex = 0; resizePrompt(); renderCommandMenu(); elements.prompt.focus(); return;
      }
      vscode.postMessage({ type: 'send', text: '/' + command.name });
      elements.prompt.value = ''; commandIndex = 0; resetPrompt();
    }
    function resetPrompt() { elements.prompt.placeholder = '向 DeepSeek 提问…'; resizePrompt(); renderCommandMenu(); renderMentionMenu(); }
    function postQueueAction(itemId, action, text) {
      vscode.postMessage({ type: 'queue-action', itemId, action, ...(text === undefined ? {} : { text }) });
    }
    function renderQueue(force) {
      const queue = (state && state.queue || []).filter(item => item.placement === 'queued');
      if (queueEditing && !queue.some(item => item.id === queueEditing.id)) queueEditing = null;
      const signature = JSON.stringify({ queue, running: state && state.running, editing: queueEditing });
      if (!force && signature === queueRenderSignature) return;
      queueRenderSignature = signature; elements.queueDock.replaceChildren(); elements.queueDock.classList.toggle('hidden', queue.length === 0);
      if (!queue.length) return;
      const head = node('div', 'queue-head'); head.append(node('span', '', '≡'), node('span', 'queue-title', queue.length === 1 ? '1 条排队消息' : queue.length + ' 条排队消息')); elements.queueDock.append(head);
      for (const item of queue) {
        const row = node('div', 'queue-row');
        if (queueEditing && queueEditing.id === item.id) {
          const editor = node('textarea', 'queue-editor'); editor.value = queueEditing.text; editor.rows = 1; editor.setAttribute('aria-label', '编辑排队消息');
          editor.addEventListener('input', () => {
            queueEditing = { id: item.id, text: editor.value };
            queueRenderSignature = JSON.stringify({ queue, running: state && state.running, editing: queueEditing });
            save.disabled = editor.value.trim() === '';
          });
          editor.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); queueEditing = null; renderQueue(true); return; }
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
              event.preventDefault(); const text = editor.value.trim(); if (!text) return; queueEditing = null; postQueueAction(item.id, 'edit', text); renderQueue(true);
            }
          });
          const actions = node('div', 'queue-actions'); const save = node('button', 'queue-action', '保存'); const cancelEdit = node('button', 'queue-action', '取消');
          save.type = cancelEdit.type = 'button'; save.disabled = queueEditing.text.trim() === ''; save.addEventListener('click', () => { const text = editor.value.trim(); if (!text) return; queueEditing = null; postQueueAction(item.id, 'edit', text); renderQueue(true); });
          cancelEdit.addEventListener('click', () => { queueEditing = null; renderQueue(true); }); actions.append(save, cancelEdit); row.append(editor, actions);
          requestAnimationFrame(() => { editor.focus(); editor.setSelectionRange(editor.value.length, editor.value.length); });
        } else {
          row.append(node('span', 'queue-preview', item.preview || '排队消息'));
          const actions = node('div', 'queue-actions');
          const edit = node('button', 'queue-action', '编辑'); edit.type = 'button'; edit.disabled = item.text === null; edit.title = item.text === null ? '带附件的消息不可编辑' : '编辑排队消息'; edit.addEventListener('click', () => { if (item.text !== null) { queueEditing = { id: item.id, text: item.text }; renderQueue(true); } });
          const remove = node('button', 'queue-action', '删除'); remove.type = 'button'; remove.addEventListener('click', () => postQueueAction(item.id, 'remove'));
          const steer = node('button', 'queue-action', '引导'); steer.type = 'button'; steer.disabled = !state.running; steer.title = state.running ? '立即把该消息应用到当前任务' : '仅在 DeepSeek 运行中才能引导'; steer.addEventListener('click', () => postQueueAction(item.id, 'steer'));
          actions.append(edit, remove, steer); row.append(actions);
        }
        elements.queueDock.append(row);
      }
    }
    function liveJob(job) { return job.status === 'running' || job.status === 'stopping'; }
    function jobDuration(job) {
      const end = liveJob(job) ? Date.now() : (Number(job.finishedAt) || Number(job.startedAt));
      const seconds = Math.max(0, Math.floor((end - Number(job.startedAt)) / 1000));
      if (seconds < 60) return seconds + 's';
      const minutes = Math.floor(seconds / 60); if (minutes < 60) return minutes + 'm ' + (seconds % 60) + 's';
      return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
    }
    function renderJobs() {
      const jobs = array(state && state.jobs);
      const live = jobs.filter(liveJob).length;
      elements.jobsControl.classList.toggle('hidden', jobs.length === 0);
      elements.jobsTrigger.classList.toggle('live', live > 0);
      elements.jobsCount.textContent = String(live || jobs.length);
      elements.jobsTrigger.title = live > 0 ? live + ' 个后台任务运行中' : jobs.length + ' 个后台任务';
      if (!jobs.length) { jobsOpen = false; elements.jobsMenu.classList.add('hidden'); elements.jobsTrigger.setAttribute('aria-expanded', 'false'); }
      elements.jobsMenu.replaceChildren();
      if (jobs.length) {
        elements.jobsMenu.append(node('div', 'jobs-title', live > 0 ? '后台任务 · ' + live + ' 个运行中' : '后台任务'));
        const ordered = [...jobs].sort((a, b) => liveJob(a) !== liveJob(b) ? (liveJob(a) ? -1 : 1) : (liveJob(a) ? Number(a.startedAt) - Number(b.startedAt) : Number(b.finishedAt || b.startedAt) - Number(a.finishedAt || a.startedAt)));
        for (const job of ordered) {
          const row = node('div', 'job-row'); const status = string(job.progress) || string(job.detail) || string(job.status);
          row.title = status; row.append(node('span', 'job-kind', string(job.kind, '任务')), node('span', 'job-label', string(job.label, '后台任务')), node('span', 'job-detail', status), node('span', 'job-duration', jobDuration(job))); elements.jobsMenu.append(row);
        }
      }
      if (jobsTimer) { clearInterval(jobsTimer); jobsTimer = undefined; }
      if (jobsOpen && live > 0) jobsTimer = setInterval(renderJobs, 1000);
    }
    /* ---- 0.1.25（性能）：每会话 DOM 缓存 ----------------------------------------------
       切会话 = 端侧全量重建 DOM（真机 1891 消息 / 5.2 万节点：1.1–2.2s，单条长任务最长 1.1s，
       layout 143–815ms 全在浏览器侧）。缓存策略：切走时把 #messages 的整棵子树搬进**离线容器**
       （不重排、不重绘、不动滚动），切回时若"消息签名 + 视图配置"一致就整棵挂回，并恢复
       节点表 / 折叠缓存 / cv 武装态——命中后只剩挂回与表拷贝（数十 ms）。
       LRU 2 个会话；超 9 万节点不缓存（内存换不来收益）；签名不符（后台会话又跑过/历史变了）
       一律弃用走原全量重建。 */
    const sessionDomCache = new Map();
    let pendingSessionDom;   /* 空 loading 帧期间暂存目标；替代尚未构建的 active DOM */
    /* 已渲染 DOM 对应的消息签名——必须在 **reconcile 之后**记录（stash 时 state.messages 已是新会话）。 */
    let renderedDomSignature = '';
    let renderedDomMessageCount = 0;
    const SESSION_DOM_CACHE_MAX = 2;
    const SESSION_DOM_SKIP_NODES = 90000;
    /* 视图记忆配置（三开关）也进缓存签名：配置变化时旧的 DOM 展开/折叠态不再合规
       （g83 门控场景：三开关全关 → 切回必须回到"卡片收起 + 按自动规则折叠"，不许带旧态）。 */
    function viewMemoryKeyNow() {
      const cfg = viewMemoryCfg();
      return (cfg.scroll ? '1' : '0') + (cfg.expand ? '1' : '0') + (cfg.fold ? '1' : '0');
    }
    function messageIdDigest(messages) {
      let hash = 5381;
      for (const message of messages) {
        const id = message === undefined || message === null ? '' : String(message.id);
        for (let i = 0; i < id.length; i += 1) hash = ((hash << 5) + hash + id.charCodeAt(i)) | 0;
      }
      return String(messages.length) + '#' + String(hash);
    }
    function pruneSessionDom(sessions) {
      if (!Array.isArray(sessions)) return;
      const ids = new Set(sessions.map(session => session.id));
      for (const id of sessionDomCache.keys()) if (!ids.has(id)) sessionDomCache.delete(id);
      if (pendingSessionDom && !ids.has(pendingSessionDom.sessionId)) pendingSessionDom = undefined;
    }
    function stashSessionDom(sessionId, sessions) {
      if (typeof sessionId !== 'string' || sessionId === '') return;
      if (Array.isArray(sessions) && !sessions.some(session => session.id === sessionId)) return;
      /* In-flight controls belong to the active request generation. Rebuild on return
         rather than retaining a canceled spinner/controller in an offline DOM. */
      if (loadingToolRequests.size > 0) return;
      const nodes = elements.messages.querySelectorAll('*').length;
      if (nodes === 0 || nodes > SESSION_DOM_SKIP_NODES) return;
      const container = document.createElement('div');
      container.append(...elements.messages.childNodes);
      sessionDomCache.set(sessionId, {
        container,
        rendered: new Map(renderedMessages),
        /* 待建快照属于这棵 DOM；LRU 淘汰时一起释放，避免跨会话 ID 串用。 */
        lazyBodies: new Map(lazyBodies),
        lazyToolCards: new Map(lazyToolCards),
        outputPages: new Map(toolOutputPages),
        outputViews: new Map(deferredOutputViews),
        outputErrors: new Map(toolOutputErrors),
        signature: renderedDomSignature + '~' + viewMemoryKeyNow(),
        messageCount: renderedDomMessageCount,
        viewCfgKey: renderedViewCfgKey,
        foldSignature: workFoldSignatureCache,
        /* 0.1.30：段列表（工作段折叠产物，轨道节点同源）必须一起存——否则切回时签名一致会
           跳过重排，而 lastWorkSegments 还停在上一会话的结果（实测切回长会话后轨道只剩 1 个点
           并整体隐藏）。存的元素引用指向本子树节点，挂回后仍有效。 */
        segments: lastWorkSegments,
      });
      while (sessionDomCache.size > SESSION_DOM_CACHE_MAX) {
        const oldest = sessionDomCache.keys().next().value;
        if (oldest === undefined) break;
        sessionDomCache.delete(oldest);
      }
    }
    function restoreSessionDom(cached, messages, viewCfgKey) {
      if (cached === undefined) return false;
      /* 后台任务可在离开时追加完成消息。原历史前缀未变时恢复旧 DOM/分页，
         后面的 reconcileMessages 会核对正文版本并追加新节点；前插/删除/换 ID 仍重建。 */
      if (messages.length < cached.messageCount || cached.signature !== messageIdDigest(messages.slice(0, cached.messageCount)) + '~' + viewMemoryKeyNow() || cached.viewCfgKey !== viewCfgKey) return false;
      elements.messages.append(...cached.container.childNodes);
      renderedMessages.clear();
      for (const [id, value] of cached.rendered) renderedMessages.set(id, value);
      lazyBodies = cached.lazyBodies;
      lazyToolCards = cached.lazyToolCards;
      for (const [id, value] of cached.outputPages) toolOutputPages.set(id, value);
      for (const [id, value] of cached.outputViews) deferredOutputViews.set(id, value);
      for (const [id, value] of cached.outputErrors) toolOutputErrors.set(id, value);
      renderedViewCfgKey = cached.viewCfgKey;
      workFoldSignatureCache = cached.foldSignature;
      if (Array.isArray(cached.segments)) lastWorkSegments = cached.segments;
      return true;
    }

    /* 0.1.31（P1）：首屏渐进判定——容器基本为空（无消息节点、无乐观节点、无折叠条）+ 消息数达阈值。 */
    function maybeProgressiveFirstPaint(current) {
      if (PROGRESSIVE_ENABLED !== true) return false;
      if (elements.messages === null || elements.messages === undefined) return false;
      const messages = array(current.messages);
      if (messages.length < PROGRESSIVE_MIN_MESSAGES) return false;
      for (const child of elements.messages.children) {
        if (child.classList !== undefined && child.classList.contains('work-fold-bar')) continue;
        return false;
      }
      diagLoad('progressive-eligible', { sessionId: current.sessionId, messages: messages.length });
      return startProgressiveFill(current, messages);
    }
    function renderConversation(current) {
      syncSearchHighlightSettings(current);
      applyMessageActionMode();
      applyOffscreenLayoutMode();
      const renderPhaseT0 = performance.now();
      let renderPhaseTailMs = 0;
      diagLoad('render-start', {
        sessionId: current.sessionId, messages: Array.isArray(current.messages) ? current.messages.length : -1,
        from: typeof renderedSessionId === 'string' ? renderedSessionId : '',
        running: current.running === true, sessionPhase: current.phase,
      });
      /* 本次渲染是否"同会话"——必须在切会话分支改 renderedSessionId **之前**判定，
         视图配置重建分支（下方）要靠它区分"同会话重建"与"切会话顺带换键"。 */
      const sameSessionRender = renderedSessionId === current.sessionId;
      pruneSessionDom(current.sessions);
      if (renderedSessionId !== current.sessionId) {
        pendingSessionDom = undefined;
        /* G39（0.0.93）：离开会话先存档（滚动位置 → 记忆表 + 去抖持久化），再按新会话记忆恢复。 */
        const memCfg = viewMemoryCfg();
        if (typeof renderedSessionId === 'string' && renderedSessionId !== '') {
          if (memCfg.scroll) captureScrollMemo(renderedSessionId, true);
          if (memCfg.scroll || memCfg.expand || memCfg.fold) scheduleViewStatePersist(renderedSessionId, 'switch-away');
        }
        const incomingMemo = viewMemoOf(current.sessionId);
        /* 0.1.25（性能）：切走前把整棵子树搬进离线缓存；切回若"消息签名一致"就整棵挂回——
           真机实测切到 1891 消息 / 5.2 万节点的会话要 1.1–2.2s（长任务最长 1.1s），缓存命中后
           只剩挂回 + 恢复节点表（数十 ms）。见 sessionDomCache / restoreSessionDom。 */
        /* 先取出将恢复的缓存，再存离开的 DOM；否则三会话轮转会先把目标当 LRU 淘汰。 */
        const incomingDom = sessionDomCache.get(current.sessionId);
        sessionDomCache.delete(current.sessionId);
        stashSessionDom(renderedSessionId, current.sessions);
        /* A skipped stash leaves its nodes attached (pending output or oversized DOM).
           Remove them before restoring a cached target so sessions cannot mix. */
        elements.messages.replaceChildren();
        for (const request of loadingToolRequests.values()) clearTimeout(request.timer);
        loadingToolRequests.clear(); toolOutputErrors.clear(); toolOutputPages.clear(); deferredOutputViews.clear();
        /* loading 可为空，也可仍带离开会话的正文；只拿目标 ready 正文消费缓存。 */
        const waitForBody = incomingDom !== undefined && current.phase !== 'ready';
        if (waitForBody) pendingSessionDom = { sessionId: current.sessionId, cached: incomingDom };
        const restored = waitForBody ? false : restoreSessionDom(incomingDom, array(current.messages), viewCfgKeyOf(current));
        renderedSessionId = current.sessionId;
        railRevealPending = true;
        railViewportRestored = false;
        railNavigationLocked = false; railNavigationSeq = undefined;
        pendingRailJumpSeq = undefined; pendingRailJumpSession = undefined; clearRestoreThroughTarget();
        if (!restored) {
          renderedMessages.clear(); elements.messages.replaceChildren(); invalidateWorkFoldCache();
          lazyBodies.clear(); lazyToolCards.clear();
        }
        /* 0.0.108（回归修复②）：正在运行（或等待审批/提问）的会话默认跟底——恢复位只对
           "空闲会话"生效。原实现让 atBottom=false 的记忆压掉运行中会话的尾巴跟随，
           用户切回运行中的会话时看不到流式进展（长会话必现）。 */
        const followLive = current.running === true || Boolean(current.approval) || Boolean(current.question);
        followConversationTail = !memCfg.scroll || incomingMemo.atBottom || followLive;
        expandedToolIds = memCfg.expand ? incomingMemo.expanded : new Set();
        startViewRestore(current.sessionId, incomingMemo, memCfg.scroll && !followLive);
        renderedHistoryKey = ''; renderedTail = {}; renderFailedIds.clear();
        pendingMessageAppends.clear(); claimedEchoIds.clear(); lastEchoAnchorId = undefined;
      } else if (pendingSessionDom !== undefined && pendingSessionDom.sessionId === current.sessionId && current.phase === 'ready') {
        const cached = pendingSessionDom.cached;
        pendingSessionDom = undefined;
        if (restoreSessionDom(cached, array(current.messages), viewCfgKeyOf(current))) {
          const memCfg = viewMemoryCfg(), incomingMemo = viewMemoOf(current.sessionId);
          const followLive = current.running === true || Boolean(current.approval) || Boolean(current.question);
          railRevealPending = true; railViewportRestored = false;
          followConversationTail = !memCfg.scroll || incomingMemo.atBottom || followLive;
          startViewRestore(current.sessionId, incomingMemo, memCfg.scroll && !followLive);
          renderedHistoryKey = ''; renderedTail = {};
        }
      }
      /* G6 (0.0.60): 视图设置（copyCfg/foldCfg/markdownImages/imageCopyFormat）是渲染期读取项，
         变化后已渲染消息不会自行回溯 → 快照变化则整会话重建（副作用：手动折叠/工具展开态复位，低频可接受）。 */
      const viewCfgKey = viewCfgKeyOf(current);
      if (viewCfgKey !== renderedViewCfgKey) {
        if (renderedViewCfgKey !== '') {
          /* 2026-09-24（遗留 bug①）：同会话重建同样要"存档 → 重建 → 按锚点恢复"——
             D3 懒建下重建产物先是空壳（内容骤矮）⇒ scrollTop 被钳到矮内容底缘、该次钳制事件
             还会让"近底"成立而**重开尾巴跟随**，补建把内容长回来后随即被钉到新底部
             （真机症状"改设置退出面板滑到底"）。恢复窗口（restoreCtx）是现成解药：
             它按锚点持续回正，且窗口内 synchronizeConversationTail 直接早退 ⇒ 不会被误判重开跟随。
             自由跟随时（atBottom / 运行中 / 审批提问）不恢复——保持原语义（贴底者仍贴底）。 */
          const memCfg = viewMemoryCfg();
          if (sameSessionRender && memCfg.scroll) {
            captureScrollMemo(current.sessionId, true);
            const memo = viewMemoOf(current.sessionId);
            const followLive = current.running === true || Boolean(current.approval) || Boolean(current.question);
            renderedMessages.clear(); elements.messages.replaceChildren(); renderedTail = {}; invalidateWorkFoldCache();
            lazyBodies.clear(); lazyToolCards.clear();
            followConversationTail = memo.atBottom || followLive;
            startViewRestore(current.sessionId, memo, memo.atBottom !== true && !followLive, 'view-cfg-rebuild');
          } else {
            renderedMessages.clear(); elements.messages.replaceChildren(); renderedTail = {}; invalidateWorkFoldCache();
          }
        }
        renderedViewCfgKey = viewCfgKey;
      }
      const statusKey = current.phase + '::' + current.statusText;
      if (statusKey !== renderedStatusKey) {
        renderedStatusKey = statusKey;
        elements.conversationStatus.replaceChildren();
        if (current.phase !== 'ready') elements.conversationStatus.append(renderStatus(current));
      }
      if (current.phase !== 'ready') {
        elements.conversationHistory.replaceChildren(); elements.messages.replaceChildren(); elements.conversationTail.replaceChildren(); invalidateWorkFoldCache();
        renderedHistoryKey = ''; renderedTail = {};
        return;
      }

      const historyKey = String(current.hasMoreHistory) + '::' + String(current.loadingHistory);
      if (historyKey !== renderedHistoryKey) {
        renderedHistoryKey = historyKey; elements.conversationHistory.replaceChildren();
        if (current.hasMoreHistory || current.loadingHistory) {
          const loader = node('div', 'history-loader'); const button = node('button', 'history-button', current.loadingHistory ? '正在加载更早消息…' : '加载更早消息'); button.type = 'button'; button.disabled = current.loadingHistory === true;
          button.addEventListener('click', () => {
            detachConversationTail();
            historyAnchor = { sessionId: current.sessionId, height: elements.scroll.scrollHeight };
            button.disabled = true; button.textContent = '正在加载更早消息…';
            vscode.postMessage({ type: 'load-history' });
          });
          loader.append(button); elements.conversationHistory.append(loader);
        }
      }
      recomputeLazyEagerIds(current);
      const progressive = maybeProgressiveFirstPaint(current);
      if (!progressive) {
        reconcileMessages(array(current.messages), current);
        renderedDomSignature = messageIdDigest(array(current.messages));
        renderedDomMessageCount = array(current.messages).length;
      }

      const tailStarted = performance.now();
      /* 0.1.112（真机事故）：提问卡改用**内容键**比较（而非对象引用）——状态帧每次都带**新对象**
         （ws 空闲断连重连还会重放 question/requested 并换代 rpcId），按引用比 ⇒ 每帧重建卡片：
         用户正在「其他」里打字被清空、焦点丢失。内容键刻意**排除 rpcId**（会换代；结算按问题 id，
         见 answerQuestions），同一组提问的重复到达不再触碰 DOM。 */
      const tailQuestionKey = (() => {
        const request = current.question;
        if (request === null || request === undefined) return '';
        const sep = String.fromCharCode(1);
        return (request.questions || []).map(question => [
          question.id, question.question, question.header, question.detail,
          question.multiSelect === true ? '1' : '0',
          (question.options || []).map(option => option.label).join(sep),
        ].join(sep)).join(String.fromCharCode(2));
      })();
      if (renderedTail.queue !== current.queue || renderedTail.changedFiles !== current.changedFiles || renderedTail.approval !== current.approval || renderedTail.questionKey !== tailQuestionKey) {
        renderedTail = { queue: current.queue, changedFiles: current.changedFiles, approval: current.approval, questionKey: tailQuestionKey };
        elements.conversationTail.replaceChildren();
        for (const item of current.queue || []) if (item.placement === 'steering') elements.conversationTail.append(renderPendingSteering(item));
        if (current.changedFiles && current.changedFiles.length) elements.conversationTail.append(renderChangedFiles(current.changedFiles));
        if (current.approval) elements.conversationTail.append(renderApproval(current.approval));
        if (current.question) elements.conversationTail.append(renderQuestions(current.question));
        else { questionDraftKey = ''; questionDrafts = new Map(); }   /* 0.1.112：提问结算/消失即清草稿表 */
      }
      renderPhaseTailMs = performance.now() - tailStarted;
      /* 0.1.26：渲染后刷新滚动焦点锚（内容/折叠变化后"视口顶那条"可能换人）。 */
      scheduleViewFocusAnchor();
      /* G49（0.0.119）：工作段折叠在消息与尾部渲染之后（每次状态推送重算；运行中不折）。
         0.0.125：折叠划段的结果供轨道使用（段模式）→ 必须在 updateTurnRail 之前。
         0.1.31（P1）：首屏渐进填充期间延后（填充完成时统一执行）——否则每片都要重折一遍。 */
      const foldStarted = performance.now();
      if (progressiveFill === undefined) { applyWorkSegmentFold(current); materializeVisibleLazyBodies(current); }
      const foldMs = performance.now() - foldStarted;
      /* G49 v2（0.0.121）：穿透加载后的待跳目标（若有）在新一帧里定位滚动。 */
      /* 0.1.94（走路表数据驱动的一部分）：**会话切换落地即刷新走路表**——本地即时扫描随"所处会话"变化
         （依赖本轮消息已渲染进 renderedMessages，故放在渲染管线尾部），落地会话的命中要并入其会话组；
         否则"点不点回搜索框"会让走向分叉（C3 判据）。
         0.1.106：**必须排在待跳落位之前**——落位会重建"可见性观察器"（searchVisibleTargets 读 walkOrder），
         旧顺序（先落位后同步表）让观察器盯着**上一会话**的表 ⇒ 落点永远收不到"进入视野"回报
         （真机 landing-sample 的「视野中」位恒 n；"视野中"标与呼吸起振都受累）。 */
      if (tabQuery.trim() !== '' && walkOrderSessionId !== current.sessionId) {
        walkOrderSessionId = current.sessionId;
        syncSearchWalkOrder();
      }
      /* 0.0.168（B4 反馈）：搜索命中跳转——会话切换/历史加载完成后落位并高亮。 */
      tryPendingSearchJump();
      /* 0.1.98：高亮脱钩自愈（渐进重渲/懒建替换命中消息 DOM 后，高亮不再静默消失）。 */
      repaintSearchHighlightsIfDetached();
      const renderTotalMs = performance.now() - renderPhaseT0;
      if (renderTotalMs > 60) {
        diagLoad('render-phases', {
          sessionId: current.sessionId, total: Math.round(renderTotalMs),
          tail: Math.round(renderPhaseTailMs), fold: Math.round(foldMs),
          messages: Array.isArray(current.messages) ? current.messages.length : -1,
        });
      }
    }
    function render(current) {
      /* 0.1.87：胶囊可见性每帧按规则判定（见 syncSearchReturnPill 注释）。 */
      syncSearchReturnPill();
      /* 0.0.175（A10）：首个状态帧到达 → 收起启动占位（此后由 status/空态接管）。 */
      if (elements.bootPlaceholder !== null && !elements.bootPlaceholder.classList.contains('hidden')) elements.bootPlaceholder.classList.add('hidden');
      const backgroundTarget = restoreThroughTarget || historyJumpTarget;
      const backgroundAnchor = backgroundTarget && backgroundTarget.sessionId === current.sessionId
        && renderedSessionId === current.sessionId ? { sessionId: current.sessionId, height: elements.scroll.scrollHeight } : undefined;
      if (backgroundAnchor && current.loadingHistory === true && historyAnchor === undefined) historyAnchor = backgroundAnchor;
      const preservingHistory = (historyAnchor && historyAnchor.sessionId === current.sessionId) || backgroundAnchor !== undefined;
      /* 0.0.141：合并补偿的参考元素必须在**本次 DOM 更新之前**从旧帧捕获——它代表"合并那一刻
         用户正看着哪条消息"（预取模式下用户可能仍在滚动，不能用请求时的位置）。 */
      const historyRef = preservingHistory ? captureHistoryAnchorRef() : undefined;
      state = current;
      if (current.phase === 'starting' || current.phase === 'error') {
        if (connectionsView || connectionsBusy) { connectionsView = undefined; connectionsBusy = false; connectionsRequest += 1; connectionsMessage = ''; if (connectionDraft) connectionDraft.apiKey = ''; }
      }
      if (renderedChrome.sessions !== current.sessions) {
        elements.sessions.replaceChildren();
        for (const session of current.sessions || []) { const option = new Option(sessionTitles[session.id] || session.title, session.id, false, session.id === current.sessionId); elements.sessions.append(option); }
        if (!elements.sessions.childElementCount) elements.sessions.append(new Option('新建会话', ''));
      } else if (elements.sessions.value !== current.sessionId) { elements.sessions.value = current.sessionId; }
      if (renderedChrome.models !== current.models) {
        elements.models.replaceChildren();
        const seenModels = new Set();
        const groups = new Map();
        for (const model of current.models || []) {
          const key = JSON.stringify([model.provider, model.model]);
          if (seenModels.has(key)) continue; seenModels.add(key);
          let group = groups.get(model.provider);
          if (!group) { group = document.createElement('optgroup'); group.label = model.providerLabel || model.provider; groups.set(model.provider, group); elements.models.append(group); }
          group.append(new Option((model.providerLabel || model.provider) + ' / ' + model.label, JSON.stringify({ provider: model.provider, model: model.model }), false, model.selected === true));
        }
        if (!elements.models.childElementCount) elements.models.append(new Option('默认模型', ''));
        else if (!(current.models || []).some(model => model.selected)) { const placeholder = new Option('请选择可用模型', '', true, true); placeholder.disabled = true; elements.models.prepend(placeholder); }
        renderEfforts((current.models || []).find(model => model.selected) || (current.models || [])[0]);
      }
      const policyChanged = renderedChrome.agentPreset !== current.agentPreset || renderedChrome.permissions !== current.permissions || renderedChrome.plan !== current.plan || renderedChrome.running !== current.running || renderedChrome.phase !== current.phase;
      if (policyChanged) renderPolicyState(current);
      if (renderedChrome.usage !== current.usage) renderUsage(current);
      /* C3 v1.1: 会话切换 → 明细展开态与内容缓存作废（seq/内容都是会话内的） */
      if (renderedContextSession !== current.sessionId) {
        renderedContextSession = current.sessionId;
        contextOpenGroups.clear();
        contextOpenItems.clear();
        contextDetailCache.clear();
        contextDetailPending.clear();
      }
      /* C3: 面板打开时随数据重渲染（context 引用变化或 usage 统计帧） */
      if (contextPanelOpen && (current.context !== renderedContextState || renderedChrome.usage !== current.usage)) {
        renderedContextState = current.context;
        renderContextPanel(current);
      }
      if (renderedChrome.jobs !== current.jobs) renderJobs();
      renderConversation(current);
      // Apply the first-paint gate in the body render task, before RAF/paint.
      syncRailFirstPaint(current);
      /* G41（0.0.98）：轮次导航条随会话内容更新（节点集变化才重建；否则仅刷新偏移/高亮）。 */
      /* 0.1.31（P1）：首屏渐进填充期间延后轨道重建——它会对部分 DOM 做强制定位读取
         （每轮 getBoundingClientRect），实测那是首片之后最大的一段同步阻塞（首屏 547ms）。 */
      /* 0.1.50（A）：改为**推迟一帧**（见 scheduleRailUpdate）——避免"建完 DOM 立刻强排"。 */
      if (progressiveFill === undefined) scheduleRailUpdate(current);
      /* G6 v1（0.0.62）: 设置台面板打开时，设置快照变化即重渲染（dsh 回执由消息处理直接重渲）。
         0.0.95（G38 批次 1）: sessionViewMemory 纳入 key——三开关在 VS Code 设置页被改时面板同步。 */
      if (settingsPanelOpen) {
        const settingsKey = JSON.stringify([
          current.animationStyle, current.markdownImages, current.copySettings, current.foldSettings,
          current.imageCopyFormat, current.previewSettings, current.attachSettings, current.imageStoreSettings,
          current.sessionSettings, current.sessionViewMemory, current.sessionHistorySettings, current.turnRailSettings, current.timeContextSettings, current.environmentSettings,
          current.updateCheckFrequency, current.uiSettings,
        ]);
        if (settingsKey !== renderedSettingsKey) { renderedSettingsKey = settingsKey; renderSettingsPanel(); }
      }
      /* G50（0.0.109）：hover 显示原文开关（页面级；开关或设置变化即时生效）。 */
      syncOriginalHover(Boolean(current.uiSettings && current.uiSettings.showOriginalOnHover));
      /* 0.1.27（用户需求）：内容列最大宽度可配（-1=无上限）——写 CSS 变量，全局即时生效。 */
      syncContentMaxWidth(current.uiSettings);
      const enabled = current.phase === 'ready' && current.routable !== false && Boolean(current.sessionId);
      elements.prompt.disabled = !enabled; elements.attach.disabled = !enabled; elements.newSession.disabled = current.phase !== 'ready'; elements.sessions.disabled = current.phase !== 'ready';
      renderSessionTabs(); updateRecycleBadge();
      elements.models.disabled = current.phase !== 'ready' || !(current.models || []).length; elements.efforts.disabled = !enabled || !elements.efforts.options.length || elements.efforts.value === '';
      syncCancelVisibility(current);
      /* 0.1.10：发送键提示跟随运行时设置（busyEnter）——运行中 Enter 的默认模式。 */
      const busyMode = current.busyEnter === 'steer' ? 'steer' : 'queue';
      elements.send.title = current.running
        ? (busyMode === 'steer' ? '插话（Enter）· 排队（Ctrl+Enter）' : '排队（Enter）· 插话（Ctrl+Enter）')
        : '发送（Enter）';
      updateSend(); renderQueue();
      const anyStreaming = array(current.messages).some(m => m.streaming === true);
      const activity = current.running === true && current.phase !== 'error';
      elements.a7Progress.classList.toggle('hidden', !activity);
      /* 0.1.2（朋友反馈②"颤动"）：思考行运行期常驻——仅换文案不换高度。此前随
         "工具执行（无 streaming）↔ 模型出文" 每步显隐，会话尾部高度 ±51px 摆动，
         底部钉住时整段内容上下颤动（探针实测锚点 93↔144px 往复）。 */
      elements.a7Thinking.classList.toggle('hidden', !activity);
      if (activity) {
        const thinkingLabel = elements.a7Thinking.querySelector('.a7-label');
        if (thinkingLabel !== null) thinkingLabel.textContent = anyStreaming ? '生成中' : '思考中';
      }
      const motion = current.animationStyle === 'off' ? 'off' : current.animationStyle === 'dots' ? 'dots' : 'standard';
      if (document.body.dataset.motion !== motion) document.body.dataset.motion = motion;
      includeContextOn = current.includeContext !== false;
      elements.includeContext.classList.toggle('active', includeContextOn);
      renderIdeContext();
      if (renderedChrome.commands !== current.commands || renderedChrome.skills !== current.skills || renderedChrome.permissions !== current.permissions) renderCommandMenu();
      renderedChrome = {
        workspaceName: current.workspaceName, cwd: current.cwd, sessions: current.sessions, models: current.models,
        agentPreset: current.agentPreset, permissions: current.permissions, plan: current.plan, running: current.running,
        phase: current.phase, usage: current.usage, jobs: current.jobs, commands: current.commands, skills: current.skills,
      };
      if (preservingHistory && current.loadingHistory !== true) {
        const anchor = historyAnchor || backgroundAnchor; historyAnchor = undefined;
        /* 0.0.133（用户反馈"向上滚到加载更早消息时会闪几下"）：锚点补偿由 rAF 改为**同步**——
           探针实测原实现首帧参考元素位移 784px（应为 44）、第二帧才校正，正是那一闪；
           在渲染末尾同步补偿 → 首个绘制帧即已就位（浏览器在 rAF 回调结束后才绘制）。
           0.0.141：① 补偿改按**合并瞬间**的相对量（+=），预取模式下用户边滚边合并也不丢位；
           ② 优先"参考元素回位"——合并会让窗口内既有内容重排（如工具结果刚拿到同窗口的
           tool/call → 正文变全，实测 728px），按 scrollHeight 差补偿会把这部分重算进去而漂移；
           参考元素法只看"视口顶那条消息"的新位置。找不到参考时退回高度差近似。 */
        selfScrollStamp = performance.now();
        let refNode;
        if (historyRef !== undefined) {
          for (const child of elements.messages.children) {
            if (child.dataset && child.dataset.mid === historyRef.id) { refNode = child; break; }
          }
        }
        /* 本次写入是程序性滚动——否则它自己的 scroll 事件会把刚开的校正窗口标记成"用户滚动"
           而当场作废（实测：L2 校正窗口被吞，漂移 729px 原样保留）。 */
        const beforeTop = elements.scroll.scrollTop;
        programmaticScroll = true;
        if (refNode !== undefined) {
          const scrollRect = elements.scroll.getBoundingClientRect();
          elements.scroll.scrollTop += (refNode.getBoundingClientRect().top - scrollRect.top) + historyRef.offset;
        } else {
          elements.scroll.scrollTop += elements.scroll.scrollHeight - anchor.height;
        }
        if (elements.scroll.scrollTop === beforeTop) programmaticScroll = false;   /* 零位移不产生事件 → 标志不得悬挂 */
        markScrollSeen();
        /* 0.0.141：合并帧之后布局仍会异步落定（长消息折叠重测/工具正文换轨等——实测两帧内参考
           元素还在漂移 ~700px，1.4s 后才稳）。开一个**短校正窗口**按同一参考元素持续回正
           （复用 G39 的 restoreCtx 机制：内容高度变化/重渲染都会触发重校正）；用户一滚动即停。 */
        if (historyRef !== undefined) {
          openRestoreWindow({
            sessionId: current.sessionId, top: elements.scroll.scrollTop,
            anchorId: historyRef.id, anchorOffset: historyRef.offset, anchorSeq: historyRef.seq,
            deadline: Date.now() + MERGE_SETTLE_WINDOW_MS, userTouched: false,
            /* 0.1.128：合并校正窗专项 kind——用户滚动时"重锚"而非关窗（见滚动处理器）。 */
            kind: 'history-merge',
          });
          /* 0.1.128（探针现场：合并后 50ms 内 cursor 7134 × 旧锚点 → active 闪现 34）：合并补偿后
             **立即重测轨道几何**——否则 250ms 去抖窗内徽标/滑块按陈旧锚点映射（"跳到错误节点/
             滑块飞走"的闪现来源）。一次强制测量，仅合并帧付出。 */
          /* 折叠条可能已被重建，先更新元素清单再测几何，避免量旧帧的脱离节点。 */
          railGeomDirty = true;
          updateTurnRail(current);
        }
      } else if (!preservingHistory) scheduleTailScroll(Boolean(current.approval || current.question));
      /* G39 v2：校正窗口内每次渲染后按锚点重校正（内容分多段到达时不漂移；用户滚动后自动停）。 */
      if (restoreCtx && restoreCtx.sessionId === current.sessionId) scheduleViewRestore();
      tryPendingRailJump();
      tryRestoreThroughReady();
    }
    /* 折叠落定后，给"仍然可见"的外壳分片补建正文（每片 ~30ms + 片间等一帧，不成长任务）。
       折叠内的正文不在此列——它们一直懒着，直到展开（折叠条 click）或搜索跳转命中。
       让出用 rAF：scheduler.yield 的续跑会排在其它任务之前（会连续把整队跑完、把渲染饿住），
       页签不可见时 rAF 不来 → 120ms setTimeout 兜底。 */
    let lazyMaterializeToken = 0;
    let lazyMissLogged = 0;
    function lazyYieldToMain() {
      return new Promise(resolve => {
        const timer = setTimeout(resolve, 120);
        const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
        if (raf === null) { clearTimeout(timer); resolve(); return; }
        raf(() => { clearTimeout(timer); resolve(); });
      });
    }
    function materializeVisibleLazyBodies(current) {
      diagLoad('lazy-entry', { size: lazyBodies.size, tools: lazyToolCards.size, children: elements.messages.childElementCount, enabled: lazyBodiesEnabledNow() });
      if (!lazyBodiesEnabledNow() || (lazyBodies.size === 0 && lazyToolCards.size === 0)) return;
      const token = ++lazyMaterializeToken;
      const queue = [];
      for (const child of elements.messages.children) {
        if (child.classList === undefined) continue;
        if (child.hidden === true) continue;
        /* D3：正文未补建的消息外壳；T2：卡面未补建的工具卡壳。两者共用同一条"可见即补建"管线。 */
        const isMessage = child.classList.contains('message');
        const isToolShell = child.classList.contains('tool') && child.dataset !== undefined && child.dataset.toolBuilt === '0';
        if (!isMessage && !isToolShell) continue;
        const id = child.dataset === undefined ? '' : String(child.dataset.mid || '');
        if (id === '') continue;
        if (isMessage) { if (lazyBodies.has(id)) queue.push(id); }
        else if (lazyToolCards.has(id)) queue.push(id);
      }
      diagLoad('lazy-queue', { queued: queue.length, size: lazyBodies.size, tools: lazyToolCards.size });
      const step = () => {
        if (token !== lazyMaterializeToken) return;
        const started = performance.now();
        /* 每片开始前抓当前阅读位置：用户可能已滚动，但 scroll 事件尚未派发。
           正文替换后在同一任务内回正，不能等 ResizeObserver 再捕获漂移后的锚点。 */
        const mergeCtx = restoreCtx !== undefined && restoreCtx.kind === 'history-merge'
          && restoreCtx.userTouched !== true && restoreCtx.sessionId === current.sessionId ? restoreCtx : undefined;
        const mergeRef = mergeCtx === undefined ? undefined : railNavigationLocked
          ? { id: mergeCtx.anchorId, offset: mergeCtx.anchorOffset, seq: railNavigationSeq }
          : captureHistoryAnchorRef();
        if (mergeRef !== undefined) {
          mergeCtx.anchorId = mergeRef.id; mergeCtx.anchorOffset = mergeRef.offset;
          mergeCtx.anchorSeq = mergeRef.seq; mergeCtx.top = elements.scroll.scrollTop;
        }
        let built = 0;
        while (queue.length > 0 && performance.now() - started < 30) {
          const id = queue.shift();
          const rendered = renderedMessages.get(id);
          if (rendered === undefined) { diagLoad('lazy-miss-rendered', { id: String(id).slice(0, 24) }); continue; }
          if (ensureMessageBody(rendered.node)) built += 1;
          else if (ensureToolCard(rendered.node)) built += 1;
        }
        if (built > 0 && mergeCtx !== undefined && restoreCtx === mergeCtx) {
          applyViewRestoreNow();
          extendRestoreWindow();
          railGeomDirty = true;
          updateTurnRail(current);
        }
        diagLoad('lazy-step', { built, left: queue.length });
        /* 0.1.103：补建会 replaceWith 换掉正文 DOM ⇒ 已登记的高亮区间脱钩。该管线不走 renderConversation
           的渲染尾（自愈守卫此前只在渲染尾跑）⇒ 真机"跳转后关键词不闪"（区间死了没人重画）。
           每片补建后顺手过一遍守卫（内部 150ms 节流，成本可忽略）。 */
        try { repaintSearchHighlightsIfDetached(); } catch { /* 自愈失败不抛 */ }
        if (queue.length > 0) lazyYieldToMain().then(step, (error) => diagLoad('lazy-error', { message: String(error && error.message ? error.message : error) }));
        else diagLoad('lazy-materialized', { sessionId: current.sessionId, remaining: lazyBodies.size });
      };
      if (queue.length > 0) lazyYieldToMain().then(step, step);
    }
    function scheduleRender(current) {
      if (historyJumpTarget && historyJumpTarget.sessionId !== current.sessionId) {
        vscode.postMessage({ type: 'cancel-history-navigation' }); clearHistoryJump();
        if (pendingSearchJump?.loadRequested === true) pendingSearchJump = undefined;
      }
      if (state && (state.cwd !== current.cwd || (state.phase === 'ready' && current.phase !== 'ready'))) {
        closeTabSearch();
        if (restoreThroughTarget) {
          vscode.postMessage({ type: 'cancel-history-navigation' });
          clearRestoreThroughTarget();
          clearRestoreCtx();
          historyAnchor = undefined;
        }
      }
      if (searchHistorySessionId !== '' && searchHistorySessionId !== current.sessionId) cancelPendingSearch();
      state = current; pendingRenderState = current;
      if (searchScope === 'session' && tabQuery.trim() !== '') applyTabFilter();
      if (renderFrame !== undefined) return;
      renderFrame = requestAnimationFrame(() => {
        renderFrame = undefined;
        const pending = pendingRenderState; pendingRenderState = undefined;
        if (pending) { try { render(pending); } catch (e) { vscode.postMessage({ type: 'webview-error', message: 'render:' + (e instanceof Error ? e.message : String(e)) }); } }
      });
    }
    function applyMessagesPatch(current, patch) {
      if (Array.isArray(patch && patch.reset)) { pendingMessageAppends.clear(); return patch.reset; }
      const prepends = array(patch && patch.prepends);
      for (const message of prepends) pendingMessageAppends.delete(message.id);
      const messages = [...prepends, ...(Array.isArray(current) ? current : [])];
      const indexes = new Map(messages.map((message, index) => [message.id, index]));
      for (const message of array(patch && patch.upserts)) {
        pendingMessageAppends.delete(message.id);
        const index = indexes.get(message.id);
        if (index === undefined) { indexes.set(message.id, messages.length); messages.push(message); }
        else messages[index] = message;
      }
      for (const append of array(patch && patch.appends)) {
        const index = indexes.get(append.id); const message = index === undefined ? undefined : messages[index];
        if (!message || message.role !== 'assistant') continue;
        pendingMessageAppends.set(append.id, string(pendingMessageAppends.get(append.id)) + string(append.text));
        /* G5 fix: append 帧顺带结算 meta/time（diff 侧已并入）——增量链路不丢时钟药丸数据 */
        messages[index] = {
          ...message,
          text: message.text + string(append.text),
          streaming: append.streaming === true,
          ...(append.meta === undefined ? {} : { meta: append.meta }),
          ...(append.time === undefined ? {} : { time: append.time }),
        };
      }
      return messages;
    }
    function applyStateUpdate(update) {
      if (!state) return;
      const patch = record(update && update.patch) || {};
      const messages = update && update.messages
        ? applyMessagesPatch(state.messages, update.messages)
        : state.messages;
      scheduleRender({ ...state, ...patch, messages });
    }
    /* G22 bug③: 纯文件（无文本无图片）也是有效发送内容——guard 须并入 pinned 文件判定（与 optimisticFileCards 同一权威源） */
    function hasPinnedFiles() { return optimisticFileCards().length > 0; }
    function updateSend() { elements.send.disabled = !state || state.phase !== 'ready' || state.routable === false || (elements.prompt.value.trim() === '' && draftImages.length === 0 && !hasPinnedFiles()); }
    function resizePrompt() { elements.prompt.style.height = 'auto'; elements.prompt.style.height = Math.min(elements.prompt.scrollHeight, 220) + 'px'; updateSend(); }
    function selectionFor(model, reasoningEffort) { return { provider: model.provider, model: model.model, ...(reasoningEffort ? { reasoningEffort } : {}) }; }
    function appendOptimisticEcho(mode, echoSeq) {
      const text = elements.prompt.value.trim();
      if (!text && !draftImages.length && !hasPinnedFiles()) return;
      const bubble = node('article', 'message user optimistic');
      bubble.dataset.echo = text;
      /* 0.0.56（审核 P2）: 气泡带本次发送序号——失败回执按序号精确删除（此前盲删最后一个，
         前发迟到失败会误删后发的气泡）。 */
      if (typeof echoSeq === 'number') bubble.dataset.echoSeq = String(echoSeq);
      const head = node('div', 'message-head');
      head.append(node('span', 'avatar', 'Y')); head.append(node('span', '', '你'));
      bubble.append(head);
      const body = node('div', 'message-body');
      /* G29: 与 renderMessage 同构（.msg-text + .msg-row），保证回显升级前后 DOM 一致 */
      const textEl = node('div', 'msg-text', text ? String(text) : '');
      body.append(textEl);
      const row = node('div', 'msg-row');
      row.append(body);
      bubble.append(row);
      if (draftImages.length) {
        /* 0.0.79（GIF②④）：乐观回显与发送形态一致——选了帧就展开成一帧一张 PNG */
        const echoImages = [];
        for (const image of draftImages) {
          const frames = draftFrameSelections(image);
          if (frames.length > 0) {
            for (const frame of frames) echoImages.push({ mediaType: 'image/png', data: frame.data, name: image.name });
          } else echoImages.push(image);
        }
        renderImageCards(body, echoImages);
      }
      const pinnedFiles = optimisticFileCards();
      if (pinnedFiles.length) renderFileCards(body, pinnedFiles);
      elements.messages.append(bubble);
      /* G29: 发送即判定（长消息上屏瞬间折叠，不等回显） */
      markFoldDirty(textEl, draftImages.length > 0 || pinnedFiles.length > 0);
      elements.messages.lastElementChild.scrollIntoView({ block: 'end' });
      markScrollSeen();
    }
    /* 0.0.56（审核 P1）: 发送在途守卫——附件草稿在框时"双击发送/连按 Enter"会在扩展清空
       draftImages 之前再次触发 send（同批图片重复上传 + 无文本气泡永不回收）。置位后等
       "草稿真的被清空"（说明本次发送已被扩展受理）或失败回执/超时再解除。 */
    let sendInFlight = false;
    const pendingPromptPreparations = new Map();
    function syncCancelVisibility(current) {
      const preparing = current && [...pendingPromptPreparations.values()].some(sid => sid === current.sessionId);
      elements.cancel.classList.toggle('hidden', !(current && current.running === true) && !preparing);
      elements.cancel.title = preparing && current.running !== true ? '停止准备消息' : '停止';
    }
    let sendSeqCounter = 0;
    function clearSendInFlightIfDrained() {
      if (!sendInFlight) return;
      if (draftImages.length === 0 && !hasPinnedFiles() && elements.prompt.value.trim() === '') sendInFlight = false;
    }
    function send(mode) {
      const text = elements.prompt.value.trim();
      if (sendInFlight) return;
      if ((!text && !draftImages.length && !hasPinnedFiles()) || !state || state.phase !== 'ready' || state.routable === false) return;
      sendInFlight = true;
      /* 0.0.108（回归修复②）：发送 = 用户明确开始新一轮——恢复尾巴跟随并终止视图校正窗口
         （否则校正 rAF 会把视图拉回旧位置，回复"不跟到底"）。 */
      clearRestoreCtx();
      followConversationTail = true;
      sendSeqCounter += 1; const echoSeq = sendSeqCounter;
      pendingPromptPreparations.set(echoSeq, state.sessionId);
      syncCancelVisibility(state);
      vscode.postMessage({ type: 'send', text, mode: mode || 'queue', echoSeq });
      /* 运行中的消息只在权威 inbox 的队列栏 / 待插话提示中显示。额外创建乐观气泡会在
         队列编辑、引导或删除后留下原文；实际消费后由正式 user message 落位。
         空闲发送仍原地升级乐观回显；失败路径会还原草稿，容忍不存在的气泡。 */
      if (text.indexOf('/') !== 0 && mode !== 'steer' && state.running !== true) appendOptimisticEcho(mode, echoSeq);
      elements.prompt.value = ''; commandIndex = 0; resetPrompt();
      window.setTimeout(() => { sendInFlight = false; }, 8000); /* 兜底：状态迟迟不回则解锁 */
    }
    elements.prompt.addEventListener('input', () => { policyMenuOpen = false; elements.policyMenu.classList.add('hidden'); elements.policyTrigger.setAttribute('aria-expanded', 'false'); commandIndex = 0; mentionIndex = 0; elements.prompt.placeholder = '向 DeepSeek 提问…'; resizePrompt(); renderCommandMenu(); requestMentions(); syncDraftZoneVisibility(); schedulePersistDraft(); });
    elements.prompt.addEventListener('click', () => { policyMenuOpen = false; elements.policyMenu.classList.add('hidden'); elements.policyTrigger.setAttribute('aria-expanded', 'false'); requestMentions(); });
    elements.prompt.addEventListener('keydown', event => {
      if (policyMenuOpen && event.key === 'Escape') { event.preventDefault(); policyMenuOpen = false; elements.policyMenu.classList.add('hidden'); elements.policyTrigger.setAttribute('aria-expanded', 'false'); return; }
      const mentionOpen = !elements.mentionMenu.classList.contains('hidden') && mentionCandidates.length > 0;
      if (mentionOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault(); mentionIndex = (mentionIndex + (event.key === 'ArrowDown' ? 1 : mentionCandidates.length - 1)) % mentionCandidates.length; renderMentionMenu(); return;
      }
      if (mentionOpen && event.key === 'Escape') { event.preventDefault(); mentionCandidates = []; elements.mentionMenu.classList.add('hidden'); return; }
      if (mentionOpen && (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && !event.isComposing))) { event.preventDefault(); pickMention(mentionCandidates[mentionIndex]); return; }
      const candidates = menuCandidates(); const menuOpen = !elements.commandMenu.classList.contains('hidden') && candidates.length > 0;
      if (menuOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault(); commandIndex = (commandIndex + (event.key === 'ArrowDown' ? 1 : candidates.length - 1)) % candidates.length; renderCommandMenu(); return;
      }
      if (menuOpen && event.key === 'Escape') { event.preventDefault(); elements.commandMenu.classList.add('hidden'); return; }
      if (menuOpen && (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && !event.isComposing))) { event.preventDefault(); pickCandidate(candidates[commandIndex]); return; }
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        /* 0.1.10（用户反馈）：运行中的默认模式**跟随运行时设置**（设置台「对话交互 → 运行中发送消息」，
           ui-conversation.busyEnter）；Ctrl/Cmd+Enter = 显式反选另一模式。 */
        const busy = state && state.busyEnter === 'steer' ? 'steer' : 'queue';
        const override = event.metaKey || event.ctrlKey;
        send(state && state.running ? (override ? (busy === 'steer' ? 'queue' : 'steer') : busy) : 'queue');
      }
    });
    /* 0.1.17（用户实测"插话像排队"）：发送按钮此前**写死 queue**——运行中应跟随设置
       （ui-conversation.busyEnter，与 Enter 一致）；Ctrl/Cmd+点击 = 反选另一模式。 */
    elements.send.addEventListener('click', (event) => {
      const busyMode = state && state.busyEnter === 'steer' ? 'steer' : 'queue';
      const override = event.metaKey || event.ctrlKey;
      send(state && state.running === true ? (override ? (busyMode === 'steer' ? 'queue' : 'steer') : busyMode) : 'queue');
    });
    elements.cancel.addEventListener('click', () => vscode.postMessage({ type: 'cancel', sessionId: state.sessionId })); elements.attach.addEventListener('click', () => vscode.postMessage({ type: 'attach' }));
    elements.includeContext.addEventListener('click', () => vscode.postMessage({ type: 'toggle-include-context' }));
    elements.imagePreview.addEventListener('pointerdown', (event) => {
      if (event.button === 0) {
        previewPan = true; previewLastX = event.clientX; previewLastY = event.clientY;
        elements.imagePreview.setPointerCapture(event.pointerId);
      } else if (event.button === 2) {
        closeImagePreview(true);
      }
    });
    elements.imagePreview.addEventListener('pointermove', (event) => {
      if (!previewPan) return;
      previewX += event.clientX - previewLastX; previewY += event.clientY - previewLastY;
      previewTargetX = previewX; previewTargetY = previewY;
      clampPreviewPan();
      previewX = previewTargetX; previewY = previewTargetY;
      previewLastX = event.clientX; previewLastY = event.clientY; previewDraw();
    });
    const endPreviewPan = (event) => {
      if (!previewPan) return;
      previewPan = false;
      if (elements.imagePreview.hasPointerCapture(event.pointerId)) elements.imagePreview.releasePointerCapture(event.pointerId);
    };
    elements.imagePreview.addEventListener('pointerup', endPreviewPan);
    elements.imagePreview.addEventListener('pointercancel', endPreviewPan);
    elements.imagePreview.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = elements.imagePreview.getBoundingClientRect();
      const viewport = previewViewport();
      const cursorX = event.clientX - rect.left; const cursorY = event.clientY - rect.top;
      const centerX = viewport.w / 2; const centerY = viewport.h / 2;
      const next = Math.max(previewMinScaleLimit(), Math.min(previewMaxScaleLimit(), previewTarget * previewZoomFactor(event)));
      /* 0.0.80: 光标在图上 → 锚光标（预期手感）；不在图上 → 锚图心，避免"图朝着远处光标飞出"。 */
      const halfW = previewImageWidth() * previewTarget / 2;
      const halfH = previewImageHeight() * previewTarget / 2;
      const onImage = previewImage !== undefined
        && cursorX >= centerX + previewTargetX - halfW && cursorX <= centerX + previewTargetX + halfW
        && cursorY >= centerY + previewTargetY - halfH && cursorY <= centerY + previewTargetY + halfH;
      const anchorX = onImage ? cursorX : centerX + previewTargetX;
      const anchorY = onImage ? cursorY : centerY + previewTargetY;
      const localX = (anchorX - centerX - previewTargetX) / previewTarget;
      const localY = (anchorY - centerY - previewTargetY) / previewTarget;
      previewTargetX = anchorX - centerX - localX * next;
      previewTargetY = anchorY - centerY - localY * next;
      previewTarget = next;
      clampPreviewPan();
      if (previewLoop === undefined) previewLoop = window.requestAnimationFrame(previewLooper);
    }, { passive: false });
    elements.imagePreview.addEventListener('contextmenu', (event) => event.preventDefault());
    /* G25: reset button — fit + center; pointerdown/click must not reach the
       pan handler underneath (pan starts on the overlay's pointerdown). */
    elements.previewReset.addEventListener('pointerdown', (event) => event.stopPropagation());
    elements.previewReset.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!elements.imagePreview.classList.contains('hidden')) previewLayout();
    });
    window.addEventListener('keydown', (event) => {
      if (elements.imagePreview.classList.contains('hidden')) return;
      if (event.key === 'Escape') { closeImagePreview(); return; }
      /* 0.0.167（B4 P2）：←/→ = 动图翻帧 / 静态图跨图切换（无图组时不动）。 */
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const delta = event.key === 'ArrowLeft' ? -1 : 1;
        if (previewFrames !== undefined) { stopPreviewPlayback(); void previewShowFrame(previewFrameIndex + delta); }
        else previewStepImage(delta);
        event.preventDefault();
      }
    });
    /* attachment intake (B6/B7): paste + drop feed the same byte path as Claude Code's onAddFiles.
       Rasterization (G16/G17): the dsh attachment protocol only accepts png/jpeg/webp/gif, so svg/bmp/ico/avif
       (native Chromium decode) and tiff (injected UTIF) are rendered to a PNG data URL before joining the image channel. */
    /* G10: Material Icon Theme file-type badge tables. Two levels avoid repeating the
       base64 payload for every alias ext (png/jpg/jpeg/webp/gif all map to the image key). */
    const FILE_TYPE_ICON_EXT = ${JSON.stringify(FILE_TYPE_ICON_EXT)};
    const FILE_TYPE_ICON_DATA = ${JSON.stringify(FILE_TYPE_ICON_DATA)};
    const FILE_TYPE_ICON_DEFAULT = ${JSON.stringify(FILE_TYPE_ICON_DEFAULT)};
    /* 0.0.131：问答记录解析（单函数自包含，源码注入；单测在 src/ask-record.ts 对应 spec）。 */
    const parseAskRecord = ${parseAskRecord.toString()};
    const RASTER_MIMES = new Set(${JSON.stringify(RASTERIZABLE_TARGETS)});
    const EXT_RASTER_MIME = ${JSON.stringify(EXT_TO_RASTER_MIME)};
    const rasterizeMimeOf = (name, mime) => {
      if (mime !== undefined && RASTER_MIMES.has(mime)) return mime;
      const dot = name.lastIndexOf('.');
      return EXT_RASTER_MIME[(dot >= 0 ? name.slice(dot + 1) : name).toLowerCase()];
    };
    /* G30（用户要求"非原生格式转码尽量无损"）: 上限 1024 → **4096**（与运行时附件归一化上限取齐，
       避免 SVG/BMP/ICO/AVIF/TIFF 在客户端就被压到 1024 后又被运行时按 4096 处理 = 白丢一次细节）；
       下限 512 保持（小图放大只为可读性，不破坏信息量）。 */
    const clampScale = (longest) => longest > 4096 ? 4096 / longest : longest < 512 ? 512 / longest : 1;
    const rasterizeCanvas = async (img) => {
      const width = img.naturalWidth; const height = img.naturalHeight;
      if (width <= 0 || height <= 0) return undefined;
      // Rasterizing is lossless, so only the sampling size matters: 1024 leaves headroom above
      // DSH vision's ~800px consumption, 512 keeps small icons readable instead of tiny by-design.
      const factor = clampScale(Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * factor));
      canvas.height = Math.max(1, Math.round(height * factor));
      const ctx = canvas.getContext('2d');
      if (ctx === null) return undefined;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try { return canvas.toDataURL('image/png'); } catch (_) { return undefined; }
    };
    const rasterizeNative = async (dataUrl) => {
      const img = new Image();
      const ok = await new Promise(resolve => {
        img.onload = () => resolve(true); img.onerror = () => resolve(false);
        img.src = dataUrl;
      });
      if (ok !== true) return undefined;
      return rasterizeCanvas(img);
    };
    const rasterizeTiff = async (base64) => {
      if (typeof window.UTIF !== 'object') return undefined;
      try {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        const ifds = window.UTIF.decode(bytes.buffer);
        if (!ifds || ifds.length === 0) return undefined;
        window.UTIF.decodeImage(bytes.buffer, ifds[0]);
        const crop = window.UTIF.toRGBA8(ifds[0]);
        const width = ifds[0].width; const height = ifds[0].height;
        if (!crop || !crop.buffer || !width || !height) return undefined;
        const factor = clampScale(Math.max(width, height));
        const imageData = new ImageData(new Uint8ClampedArray(crop.buffer, crop.byteOffset, crop.byteLength), width, height);
        const bitmap = await createImageBitmap(imageData);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * factor));
        canvas.height = Math.max(1, Math.round(height * factor));
        const ctx = canvas.getContext('2d');
        if (ctx === null) return undefined;
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        try { return canvas.toDataURL('image/png'); } catch (_) { return undefined; }
      } catch (_) { return undefined; }
    };
    const rasterize = (dataUrl, sourceMime) => {
      if (sourceMime === 'image/tiff') {
        const comma = dataUrl.indexOf(',');
        return comma >= 0 ? rasterizeTiff(dataUrl.slice(comma + 1)) : Promise.resolve(undefined);
      }
      return rasterizeNative(dataUrl);
    };
    /* 0.0.145（G43 用户需求）：大图自动压缩——超过阈值（MB 设置）的图片下采样到最长边 ≤ 设置值 +
       白底 JPEG 重编码（JPEG 无 alpha：先铺白底，避免透明像素变黑），逐级降档直到 ≤ 运行时单图上限；
       解码失败/仍超限返回 undefined（调用方按"跳过"处理）。
       解码优先 ImageDecoder 缩放解码（WebCodecs）——13k×20k 级 JPEG 全量解码要 GB 级内存，
       缩放解码让解码器直接出目标尺寸；回退 <img> 全量解码。 */
    const compressCfg = () => {
      const s = (state && state.attachSettings) || {};
      const clamp = (value, min, max, fallback) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
      return {
        thresholdMB: clamp(s.compressThresholdMB, 0, 2048, 20),
        maxEdge: Math.round(clamp(s.compressMaxEdge, 512, 16384, 4096)),
        quality: Math.round(clamp(s.compressQuality, 40, 95, 82)),
      };
    };
    const uploadLimitBytes = () => {
      const limit = state && state.imageLimits ? state.imageLimits.maxImageBytes : undefined;
      return typeof limit === 'number' && limit > 0 ? limit : 20 * 1024 * 1024;
    };
    const decodeScaled = async (dataUrl, mime, maxEdge) => {
      const comma = dataUrl.indexOf(',');
      if (comma < 0) return undefined;
      const mark = /^data:([^;,]+)/.exec(dataUrl);
      const type = mime !== undefined && mime !== '' ? mime : (mark === null ? 'image/jpeg' : mark[1]);
      if (typeof window.ImageDecoder === 'function') {
        try {
          const binary = atob(dataUrl.slice(comma + 1));
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          const decoder = new ImageDecoder({ data: bytes, type });
          const frame = await decoder.decode({ frameIndex: 0, desiredWidth: maxEdge });
          const image = frame.image;
          return {
            source: image,
            width: image.displayWidth || image.codedWidth,
            height: image.displayHeight || image.codedHeight,
            release: () => { try { image.close(); } catch (_) { /* ignore */ } try { decoder.close(); } catch (_) { /* ignore */ } },
          };
        } catch (_) { /* 回退 <img> */ }
      }
      const img = new Image();
      const ok = await new Promise(resolve => { img.onload = () => resolve(true); img.onerror = () => resolve(false); img.src = dataUrl; });
      if (ok !== true || img.naturalWidth <= 0 || img.naturalHeight <= 0) return undefined;
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => {} };
    };
    const compressForUpload = async (dataUrl, mime) => {
      const cfg = compressCfg();
      const limit = uploadLimitBytes();
      const steps = [
        { edge: cfg.maxEdge, quality: cfg.quality / 100 },
        { edge: Math.max(512, Math.round(cfg.maxEdge * 0.75)), quality: Math.max(0.4, cfg.quality / 100 * 0.88) },
        { edge: Math.max(512, Math.round(cfg.maxEdge * 0.55)), quality: 0.6 },
      ];
      for (const step of steps) {
        const decoded = await decodeScaled(dataUrl, mime, step.edge);
        if (decoded === undefined) return undefined;
        try {
          const factor = Math.min(1, step.edge / Math.max(1, Math.max(decoded.width, decoded.height)));
          const width = Math.max(1, Math.round(decoded.width * factor));
          const height = Math.max(1, Math.round(decoded.height * factor));
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx === null) return undefined;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(decoded.source, 0, 0, width, height);
          const jpeg = canvas.toDataURL('image/jpeg', step.quality);
          const comma = jpeg.indexOf(',');
          const bytes = comma < 0 ? 0 : Math.floor((jpeg.length - comma - 1) * 3 / 4);
          if (comma >= 0 && (bytes <= limit || step === steps[steps.length - 1])) {
            return { dataUrl: jpeg, bytes, width, height };
          }
        } finally {
          decoded.release();
        }
      }
      return undefined;
    };
    const SUPPORTED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
    const NATIVE_IMAGE_EXT = /\\.(png|jpe?g|webp|gif)$/i;
    const IMAGE_EXT = /\\.(png|jpe?g|webp|gif|svg|bmp|ico|avif|tiff?)$/i;
    /* 0.0.55（反馈①本轮补充）: 剪贴板/拖入的文件名可能不是干净文件名——网页复制图片常见 %XX 百分号编码
       （显示即乱码）、偶发 URL 或控制字符。统一清理：URL 取末段 → 百分号解码（解出控制字符则保留原样）
       → 去控制字符/非法文件名字符。清理在入库前做，草稿 chip、气泡卡片、复制提示三处显示一致。 */
    function sanitizeFileName(raw) {
      let name = string(raw).trim();
      if (!name) return '';
      if (/^https?:\\/\\//i.test(name)) { try { name = decodeURI(name.split(/[?#]/)[0]); } catch { /* keep */ } name = name.split('/').pop() || name; }
      if (/%[0-9a-fA-F]{2}/.test(name)) {
        try { const decoded = decodeURIComponent(name); if (decoded !== '' && !/[\\u0000-\\u001f\\u007f]/.test(decoded)) name = decoded; } catch { /* keep raw */ }
      }
      return name.replace(/[\\u0000-\\u001f\\u007f]/g, '').replace(/[\\\\/:*?"<>|]/g, '_').trim();
    }
    /* 批 C P2-15（0.0.61）: 拖入大文件夹防一次性 base64 解码洪水——单次附带累计上限，超限截断并提示。
       单文件 25MB 门槛继续生效。0.0.96（G38 批次 2）：上限改由设置驱动（attach.maxFiles / attach.maxTotalMB）。 */
    function attachCfg() {
      const s = (state && state.attachSettings) || {};
      const maxTotalMB = typeof s.maxTotalMB === 'number' && s.maxTotalMB >= 1 && s.maxTotalMB <= 2048 ? s.maxTotalMB : 100;
      /* 0.0.175（B5 文案群）：单文件上限此前写死 25MB，改由设置驱动（attach.maxFileMB，默认 25）。 */
      const maxFileMB = typeof s.maxFileMB === 'number' && s.maxFileMB >= 1 && s.maxFileMB <= 500 ? s.maxFileMB : 25;
      return {
        maxFiles: typeof s.maxFiles === 'number' && s.maxFiles >= 1 && s.maxFiles <= 200 ? s.maxFiles : 20,
        maxTotalMB,
        maxFileMB,
        maxFileBytes: maxFileMB * 1024 * 1024,
        maxTotalBytes: maxTotalMB * 1024 * 1024,
      };
    }
    /* G40（0.0.93）：原生图片格式粘贴/拖入的真实解码校验——损坏/空/伪装文件在此拦下（此前裸放行，
       坏字节会带进草稿：缩略图裂图、发送后才暴露）。 */
    const decodeImageOk = (dataUrl) => new Promise((resolve) => {
      const probe = new Image();
      probe.onload = () => resolve(probe.naturalWidth > 0 && probe.naturalHeight > 0);
      probe.onerror = () => resolve(false);
      probe.src = dataUrl;
    });
    const attachmentPost = async (files) => {
      const images = []; const documents = []; let skipped = 0; let unsupported = 0; let overflow = 0; let corrupt = 0;
      let compressed = 0; let compressedBytes = 0; let compressFailed = 0;
      let totalBytes = 0; let accepted = 0;
      const cfg = attachCfg();
      const compressTrigger = compressCfg().thresholdMB * 1024 * 1024;
      const readDataUrl = (file) => new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result); reader.onerror = () => resolve(undefined);
        reader.readAsDataURL(file);
      });
      for (const file of files) {
        const mime = file.type || '';
        const sourceMime = rasterizeMimeOf(file.name, mime === '' ? undefined : mime);
        const imageLike = mime.startsWith('image/') || IMAGE_EXT.test(file.name) || sourceMime !== undefined;
        /* 0.0.145（G43）：图片超过压缩阈值 → 先下采样 + 白底 JPEG 重编码再入列（取代旧的"超 25MB 直接跳过"）。
           大图解码+编码可达数秒 → 首次触发时先亮"正在压缩"提示（结果提示随后覆盖）。 */
        if (imageLike && compressTrigger > 0 && file.size > compressTrigger) {
          if (compressed + compressFailed === 0) {
            dropHint.textContent = '正在压缩过大图片…';
            dropHint.classList.remove('hidden'); dragBreathe(Math.max(hintMs(), 10_000));
          }
          const dataUrl = await readDataUrl(file);
          const out = typeof dataUrl === 'string' ? await compressForUpload(dataUrl, mime) : undefined;
          if (out === undefined) { compressFailed += 1; continue; }
          if (accepted >= cfg.maxFiles || totalBytes + out.bytes > cfg.maxTotalBytes) { overflow += 1; continue; }
          images.push({ name: sanitizeFileName(file.name), dataUrl: out.dataUrl });
          accepted += 1; totalBytes += out.bytes; compressed += 1; compressedBytes += out.bytes;
          continue;
        }
        if (file.size > cfg.maxFileBytes) { skipped += 1; continue; }
        if (accepted >= cfg.maxFiles || totalBytes + file.size > cfg.maxTotalBytes) { overflow += 1; continue; }
        if (imageLike) {
          if (sourceMime !== undefined) {
            const dataUrl = await readDataUrl(file);
            const png = typeof dataUrl === 'string' ? await rasterize(dataUrl, sourceMime) : undefined;
            /* 转码失败（多为空/损坏文件）→ corrupt 计数（不再并入"不支持"——格式本受支持，文案会误导） */
            if (png === undefined) { corrupt += 1; continue; }
            images.push({ name: sanitizeFileName(file.name), dataUrl: png });
            accepted += 1; totalBytes += file.size;
            continue;
          }
          if (SUPPORTED_IMAGE_MIMES.has(mime) || NATIVE_IMAGE_EXT.test(file.name)) {
            const dataUrl = await readDataUrl(file);
            if (typeof dataUrl !== 'string') continue;
            if ((await decodeImageOk(dataUrl)) !== true) { corrupt += 1; continue; }
            images.push({ name: sanitizeFileName(file.name), dataUrl });
            accepted += 1; totalBytes += file.size;
            continue;
          }
          unsupported += 1;
          continue;
        }
        const dataUrl = await readDataUrl(file);
        if (typeof dataUrl !== 'string') continue;
        documents.push({ name: sanitizeFileName(file.name), dataUrl });
        accepted += 1; totalBytes += file.size;
      }
      if (images.length > 0 || documents.length > 0) vscode.postMessage({ type: 'paste-files', images, documents });
      const hints = [];
      /* 0.0.146（用户）：文案改"压缩后 xxMB"（比"省 xxMB"更直接——看的是要发出去多大）。 */
      if (compressed > 0) hints.push('已自动压缩 ' + String(compressed) + ' 个过大图片（压缩后 ' + String(Math.max(1, Math.round(compressedBytes / 1024 / 1024))) + 'MB）');
      if (compressFailed > 0) hints.push(String(compressFailed) + ' 个图片压缩失败（无法解码）已跳过');
      if (skipped > 0) hints.push(String(skipped) + ' 个文件超过 ' + String(cfg.maxFileMB) + 'MB 已跳过');
      if (corrupt > 0) hints.push(String(corrupt) + ' 个图片无法解码（文件可能为空或已损坏）已跳过');
      if (unsupported > 0) hints.push(String(unsupported) + ' 个不支持的图片已跳过（协议仅支持 png/jpg/jpeg/webp/gif；svg/bmp/ico/avif/tiff 可自动转码）');
      if (overflow > 0) hints.push(String(overflow) + ' 个文件超出单次上限（' + cfg.maxFiles + ' 个 / ' + cfg.maxTotalMB + 'MB）已跳过');
      if (hints.length > 0) {
        dropHint.textContent = hints.join('；');
        dropHint.classList.remove('hidden'); dragBreathe(hintMs());
      }
    };
    elements.prompt.addEventListener('paste', (event) => {
      const pasted = Array.from(event.clipboardData?.files ?? []);
      if (pasted.length === 0) return;
      event.preventDefault();
      void attachmentPost(pasted);
    });
    const isFileDrag = (event) => {
      const types = Array.from(event.dataTransfer?.types ?? []);
      return types.includes('Files') || types.includes('text/uri-list')
        || types.includes('application/vnd.code.uri-list') || types.includes('application/x-vscode-file');
    };
    const dropHint = document.getElementById('dropHint');
    const DROP_HINT_READY = '松开以附带文件';
    let dragTimer = undefined;
    /* 0.0.145（用户需求①）：提示条显示时长（秒；设置 ui.hintSeconds，默认 4）。 */
    const hintMs = () => {
      const s = (state && state.uiSettings) || {};
      const seconds = typeof s.hintSeconds === 'number' && Number.isFinite(s.hintSeconds) ? Math.min(60, Math.max(1, s.hintSeconds)) : 4;
      return seconds * 1000;
    };
    const dragBreathe = (delay) => {
      clearTimeout(dragTimer);
      dragTimer = setTimeout(() => { document.body.classList.remove('file-drag'); dropHint.classList.add('hidden'); }, delay);
    };
    document.addEventListener('dragend', () => { document.body.classList.remove('file-drag'); dropHint.classList.add('hidden'); });
    document.addEventListener('dragover', (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      document.body.classList.add('file-drag');
      dropHint.textContent = DROP_HINT_READY;
      dropHint.classList.remove('hidden');
      dragBreathe(1500);
    });
    const handleDrop = (event) => {
      if (!isFileDrag(event)) return false;
      event.preventDefault();
      document.body.classList.remove('file-drag'); dropHint.classList.add('hidden');
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) { void attachmentPost(files); return true; }
      const uris = [];
      const uriListLines = (event.dataTransfer?.getData('text/uri-list') || '')
        .split('\\n').map(line => line.trim()).filter(Boolean);
      uris.push(...uriListLines);
      try {
        const codeList = JSON.parse(event.dataTransfer?.getData('application/vnd.code.uri-list') || '[]');
        if (Array.isArray(codeList)) for (const entry of codeList) {
          if (entry && typeof entry.uri === 'string') uris.push(entry.uri);
        }
      } catch (_) { /* not vnd.code JSON */ }
      if (uris.length > 0) { vscode.postMessage({ type: 'pin-file-uris', uris }); return true; }
      const plain = (event.dataTransfer?.getData('text/plain') || '').trim();
      if (plain.length > 0 && (plain.includes('\\\\') || plain.indexOf('/') >= 0)) { vscode.postMessage({ type: 'pin-file-uris', uris: [plain] }); return true; }
      dropHint.textContent = 'drop 收到: files=0, uri=' + String(uriListLines.length) + ' — 未提取到文件数据';
      dropHint.classList.remove('hidden'); dragBreathe(hintMs());
      return true;
    };
    document.addEventListener('drop', handleDrop);
    elements.prompt.addEventListener('drop', (event) => { if (handleDrop(event)) event.stopPropagation(); });
    elements.usageTrigger.addEventListener('click', event => {
      event.stopPropagation(); usageOpen = !usageOpen; policyMenuOpen = false; elements.policyMenu.classList.add('hidden'); elements.policyTrigger.setAttribute('aria-expanded', 'false'); if (state) renderUsage(state);
    });
    /* 0.1.14：悬停冻结 title 的三处装配（流式中每步更新的提示不再"关闭又打开"）。 */
    armStableTitle(elements.usageTrigger);
    armStableTitle(elements.usageStats);
    armStableTitle(elements.policyTrigger);
    elements.policyTrigger.addEventListener('click', event => {
      event.stopPropagation(); policyMenuOpen = !policyMenuOpen; usageOpen = false; elements.usagePanel.classList.add('hidden'); elements.usageTrigger.setAttribute('aria-expanded', 'false'); elements.commandMenu.classList.add('hidden'); elements.mentionMenu.classList.add('hidden'); if (state) renderPolicyState(state);
    });
    elements.jobsTrigger.addEventListener('click', event => {
      event.stopPropagation(); jobsOpen = !jobsOpen; elements.jobsMenu.classList.toggle('hidden', !jobsOpen); elements.jobsTrigger.setAttribute('aria-expanded', String(jobsOpen)); renderJobs();
    });
    elements.newSession.addEventListener('click', () => vscode.postMessage({ type: 'new-session' })); elements.sessions.addEventListener('change', () => vscode.postMessage({ type: 'select-session', sessionId: elements.sessions.value }));
    elements.models.addEventListener('change', () => {
      if (!elements.models.value) return; const selected = JSON.parse(elements.models.value); const model = (state.models || []).find(item => item.provider === selected.provider && item.model === selected.model); if (!model) return;
      renderEfforts(model); const effort = model.defaultReasoningEffort || (model.reasoningEfforts && model.reasoningEfforts[0] && model.reasoningEfforts[0].id); if (effort) elements.efforts.value = effort;
      elements.efforts.disabled = !model.reasoningEfforts || !model.reasoningEfforts.length; vscode.postMessage({ type: 'select-model', selection: selectionFor(model, effort) });
    });
    elements.efforts.addEventListener('change', () => { if (!elements.models.value) return; const selected = JSON.parse(elements.models.value); const model = (state.models || []).find(item => item.provider === selected.provider && item.model === selected.model); if (model) vscode.postMessage({ type: 'select-model', selection: selectionFor(model, elements.efforts.value) }); });
    document.addEventListener('click', event => {
      if (policyMenuOpen && !elements.policyMenu.contains(event.target) && !elements.policyTrigger.contains(event.target)) {
        policyMenuOpen = false; elements.policyMenu.classList.add('hidden'); elements.policyTrigger.setAttribute('aria-expanded', 'false');
      }
      if (usageOpen && !elements.usagePanel.contains(event.target) && !elements.usageTrigger.contains(event.target)) {
        usageOpen = false; elements.usagePanel.classList.add('hidden'); elements.usageTrigger.setAttribute('aria-expanded', 'false');
      }
      if (jobsOpen && !elements.jobsMenu.contains(event.target) && !elements.jobsTrigger.contains(event.target)) {
        jobsOpen = false; elements.jobsMenu.classList.add('hidden'); elements.jobsTrigger.setAttribute('aria-expanded', 'false'); renderJobs();
      }
      /* 0.0.168（B4 反馈）：点面板外收起内容命中列表（搜索框与标签过滤保持）。
         0.1.79（用户报①）：**放大镜按钮不算"面板外"**——它不属于 #tabSearch 容器，而它的 click 正是
         openTabSearch() 的入口：旧写法会把刚渲染出来的面板（空查询时=「最近搜索」历史）当场打回隐藏，
         用户看到的就是"搜了词也没有历史"（真代码探针实测：DOM 5 行、面板 hidden、行高 0）。 */
      if (!elements.tabSearchResults.classList.contains('hidden')
        && !elements.tabSearchResults.contains(event.target) && !elements.tabSearch.contains(event.target)
        && !elements.tabSearchToggle.contains(event.target)) {
        searchPanelCollapsed = true;
        elements.tabSearchResults.classList.add('hidden');
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && usageOpen) {
        usageOpen = false; elements.usagePanel.classList.add('hidden'); elements.usageTrigger.setAttribute('aria-expanded', 'false'); elements.usageTrigger.focus();
      }
    });
    window.addEventListener('message', event => {
      try { if (event.data && event.data.type) { const d = event.data; const meta = d.type === 'state-update' && d.update && d.update.patch ? Object.keys(d.update.patch).join('+') : (d.type === 'state' ? 'full' : ''); if (meta || d.type === 'session-titles') vscode.postMessage({ type: 'debug-trace', d: d.type + ':' + meta + ':' + (d.update && d.update.messages ? ('m:ap' + ((d.update.messages.appends || []).length) + ':up' + (((d.update.messages.upserts || []).length)) + ':del' + ((d.update.messages.deletes || d.update.messages.delete) ? ((d.update.messages.deletes || d.update.messages.delete).length) : 0)) : '') }); } } catch (_) {}
      if (!event.data) return;
      if (event.data.type === 'state') {
        const next = event.data.state;
        if (state?.sessionId !== next.sessionId) {
          railTable = undefined; railTableSessionId = ''; railTableStamp += 1; railKey = '';
          railPreparationFailedFor = '';
        }
        acceptRailTable(next.sessionId, event.data.rail);
        if (lastDraftSessionId !== undefined && typeof next.sessionId === 'string' && lastDraftSessionId !== next.sessionId) {
          const stillExists = array(next.sessions).some(s => s && s.id === lastDraftSessionId);
          if (stillExists) {
            draftSlots.set(lastDraftSessionId, { text: elements.prompt.value, images: draftImages.slice() });
            if (draftSlots.size > 32) draftSlots.delete(draftSlots.keys().next().value);
            publishDraftState();
            /* 0.0.161：切走时对上一会话立即冲刷文本持久化（图片由扩展侧随 sync-draft-images 落盘）。 */
            persistDraftNow(lastDraftSessionId);
          }
          const slot = draftSlots.get(next.sessionId) || { text: '', images: [] };
          elements.prompt.value = slot.text;
          commandIndex = 0; mentionIndex = 0;
          draftImages = slot.images.slice();
          resizePrompt(); renderAttachments(); requestMentions(); renderCommandMenu();
          /* 0.1.106（真机反馈④：Shift+Enter 跨会话时"直接聚焦输入框"）：会话切换的草稿槽位恢复会抢焦点，
             而逐处跳是**带焦点的键盘流**（焦点在搜索框）——抢走焦点后 Enter 会落进输入框（走路被打断/误输入）。
             搜索框持有焦点时不抢（其余场景照旧：手点会话、状态帧切会话仍恢复到输入框）。 */
          if (document.activeElement !== elements.tabSearchInput) elements.prompt.focus();
          const cursor = elements.prompt.value.length; elements.prompt.setSelectionRange(cursor, cursor);
          vscode.postMessage({ type: 'sync-draft-images', images: slot.images });
          lastDraftSessionId = next.sessionId;
        } else if (lastDraftSessionId === undefined && typeof next.sessionId === 'string') {
          lastDraftSessionId = next.sessionId;
        }

        pendingMessageAppends.clear(); claimedEchoIds.clear(); renderFailedIds.clear(); scheduleRender(next);
      }
      /* G39：持久化视图记忆回填（扩展在 ready 回复中先于首个 state 发来 → 首帧渲染即可用）。 */
      if (event.data.type === 'view-state' && Number.isSafeInteger(event.data.revision) && event.data.revision >= viewStateRevision) {
        viewStateRevision = event.data.revision;
        seedViewMemo(event.data.states);
      }
      if (event.data.type === 'view-state-removed') removeViewMemo(event.data.sessionId, event.data.revision);
      /* 0.1.76（T3-4）：扩展下发的搜索历史（ready 时一次）。 */
      if (event.data.type === 'search-history' && Array.isArray(event.data.items)) {
        searchHistory = event.data.items.filter(item => typeof item === 'string' && item !== '').slice(0, 10);
        if (tabSearchOpen() && tabQuery.trim() === '') renderSearchResults();
      }
      /* 0.0.168（B4 反馈）：跨会话内容搜索回执——请求号守卫丢弃过期轮次。
         0.0.170：分两路——local:true = 本工作区内容索引；否则 = 运行时（他工作区）。 */
      if (event.data.type === 'search-results') {
        if (event.data.requestId !== searchRequestId) return;
        if (searchScope === 'session' && (searchHistorySessionId === '' || event.data.sessionId !== searchHistorySessionId || state?.sessionId !== searchHistorySessionId)) return;
        const query = tabQuery.trim().toLowerCase();
        const items = Array.isArray(event.data.items) ? event.data.items : [];
        const cleaned = items
          .filter(item => item && typeof item.sessionId === 'string' && typeof item.snippet === 'string')
          .map(item => ({
            sessionId: item.sessionId,
            messageId: typeof item.messageId === 'string' ? item.messageId : '',
            snippet: String(item.snippet),
            title: typeof item.title === 'string' ? item.title : '',
            foreign: item.foreign === true,
            /* 0.1.89（用户需求）：本工作区子代理会话命中——单独标注、可点击打开。 */
            subagent: item.subagent === true,
            trashed: item.trashed === true,
            /* 0.1.96（用户拍板）：条目类型（文本/图片/文件/工具）——「工具」默认不展示（设置台可开）。 */
            kind: typeof item.kind === 'string' ? item.kind : '',
            /* 0.1.96（截图自查逮到的缺口）：扩展侧一直随回包带 time/snippetLong/total，
               但这里没接住 ⇒ 索引行的时间排序/悬停长片段/「共 N 处」从未生效。补齐三字段。 */
            snippetLong: typeof item.snippetLong === 'string' ? item.snippetLong : '',
            time: typeof item.time === 'number' && isFinite(item.time) ? item.time : 0,
            total: typeof item.total === 'number' && item.total > 0 ? item.total : 1,
            /* 0.1.123（G55 Phase 3）：命中所属消息的事件 seq——行内节点编号/跳段首由此换算（缺失不标）。 */
            ...(typeof item.seq === 'number' && isFinite(item.seq) ? { seq: item.seq } : {}),
          }));
        if (event.data.local === true) {
          searchLocalReady = true;
          searchIndexHits = cleaned;
          searchHitsQuery = query;
          /* 0.1.65（T3-7）：索引规模/新鲜度随本轮回包更新（建完重推时也带来最新值）。 */
          if (event.data.index !== undefined && event.data.index !== null) searchIndexStats = event.data.index;
          if (searchScope === 'session') searchLoading = searchIndexStats?.fulltextScanning === true;
          /* 0.1.123（G55 Phase 3）：他会话行的轨道节点表（只含本轮有命中的会话；缺表会话显示「—」）。 */
          if (event.data.nodes !== undefined && event.data.nodes !== null && typeof event.data.nodes === 'object') foreignNodeTables = event.data.nodes;
        } else {
          searchLoading = false;
          searchHits = cleaned;
          if (searchHitsQuery !== query) searchHitsQuery = query;
          searchHasMore = event.data.hasMore === true;
          searchNotes = typeof event.data.error === 'string' && event.data.error !== '' ? event.data.error : '';
        }
        /* 0.1.94（根因修复）：面板**收起期间**到达的结果同样要入走路表——applyTabFilter 在收起时不渲染面板
           （renderSearchResults 早退），旧实现的顺序表挂在渲染里 ⇒ 纯键盘流永远走不到这些命中。
           走路表改由数据驱动（syncWalkOrderFromModel），这里补上"收起态"的入表路径。 */
        if (!tabSearchOpen() || searchPanelCollapsed) syncSearchWalkOrder();
        applyTabFilter();
        return;
      }
      if (event.data.type === 'state-update') {
        if (state && event.data.sessionId === state.sessionId) acceptRailTable(state.sessionId, event.data.rail);
        applyStateUpdate(event.data.update);
      }
      /* G27 round2 (0.0.48): fork 回执——state（自动切到新会话）先于本消息到达，草稿写入后
         直接填提示框；若 state 尚未到（罕见时序），slot 已存，切换时自动恢复。 */
      if (event.data.type === 'fork-created' && typeof event.data.sessionId === 'string') {
        if (pendingForkText !== undefined) {
          draftSlots.set(event.data.sessionId, { text: pendingForkText, images: [] });
          pendingForkText = undefined;
          if (lastDraftSessionId === event.data.sessionId) {
            elements.prompt.value = (draftSlots.get(event.data.sessionId) || {}).text || '';
            resizePrompt();
          }
          publishDraftState();
        }
        return;
      }
      if (event.data.type === 'tool-output' && state && event.data.sessionId === state.sessionId && typeof event.data.messageId === 'string') {
        const request = loadingToolRequests.get(event.data.messageId);
        if (!request || request.requestId !== event.data.requestId) return;
        clearTimeout(request.timer); loadingToolRequests.delete(event.data.messageId);
        if (typeof event.data.error === 'string') {
          toolOutputErrors.set(event.data.messageId, { message: event.data.error, cursor: request.cursor });
          const controller = deferredOutputViews.get(event.data.messageId); if (controller) controller.renderControls(); return;
        }
        toolOutputErrors.delete(event.data.messageId);
        if (event.data.page && event.data.page.message) {
          const controller = deferredOutputViews.get(event.data.messageId);
          if (controller) controller.append(event.data.page.message, event.data.page.nextCursor);
          else {
            const message = array(state.messages).find(candidate => candidate.id === event.data.messageId);
            const loaded = toolOutputPages.get(event.data.messageId) || { pages: [], nextCursor: undefined, revision: message && message.deferredBodyRevision };
            loaded.pages.push(event.data.page.message); loaded.nextCursor = event.data.page.nextCursor; toolOutputPages.set(event.data.messageId, loaded);
          }
        }
      }
      /* 0.0.145（G43）：对话框路径的超限图压缩（扩展读文件 → 本侧下采样 + 白底 JPEG → 回包入列）。 */
      if (event.data.type === 'compress-image' && typeof event.data.id === 'string' && typeof event.data.data === 'string') {
        const mime = typeof event.data.mime === 'string' ? event.data.mime : undefined;
        void compressForUpload('data:' + (mime === undefined ? 'image/jpeg' : mime) + ';base64,' + event.data.data, mime)
          .then(out => vscode.postMessage({
            type: 'compress-image-result',
            id: event.data.id,
            ok: out !== undefined,
            dataUrl: out === undefined ? undefined : out.dataUrl,
            bytes: out === undefined ? 0 : out.bytes,
            width: out === undefined ? 0 : out.width,
            height: out === undefined ? 0 : out.height,
          }));
      }
      if (event.data.type === 'rasterize-image' && typeof event.data.id === 'string' && typeof event.data.data === 'string') {
        const mime = typeof event.data.mime === 'string' ? event.data.mime : undefined;
        const png = mime === undefined ? Promise.resolve(undefined) : rasterize('data:' + mime + ';base64,' + event.data.data, mime);
        void png.then(p => vscode.postMessage({ type: 'rasterize-image-result', id: event.data.id, name: event.data.name, png: p === undefined ? undefined : p }));
      }
      /* 批 C P2-8（0.0.61）: 文件卡「复制图片(PNG)」——.NET 不解码的格式（webp/avif/svg）由扩展端读
         文件回传字节，本侧 canvas 转 PNG 后复用 copy-image-clip 管道入剪贴板。 */
      if (event.data.type === 'convert-image-clip' && typeof event.data.data === 'string') {
        const src = imageSrc(string(event.data.mediaType), event.data.data);
        if (src === undefined) { showToast('复制图片失败（无法解码该文件）', true); return; }
        void convertToPngDataUrl(src).then(png => {
          if (typeof png === 'string') vscode.postMessage({ type: 'copy-image-clip', data: png, name: string(event.data.name) });
          else showToast('复制图片失败（无法解码该文件）', true);
        });
      }
      /* G6 v1（0.0.62）: 设置台"DSH 配置"回执 */
      if (event.data.type === 'open-model-connections') { openSettingsPanel(true); elements.settingsBody.scrollTop = 0; }
      if (event.data.type === 'model-connections-result') {
        if (event.data.requestId !== connectionsRequest) return;
        connectionsBusy = false;
        if (event.data.ok !== true) {
          connectionsMessage = string(event.data.message || '操作未完成，请重试。');
          if (event.data.committed) { connectionDraft = undefined; connectionCandidates = []; dshSettings = null; }
        }
        else if (event.data.operation === 'discover-connection-models') {
          connectionCandidates = array(event.data.models);
          connectionsMessage = connectionCandidates.length ? '已读取目录，请勾选要使用的模型。' : '目录为空；仍可手工填写模型 ID。';
        } else {
          connectionsView = event.data.view;
          if (event.data.operation === 'describe-model-connections') {
            if (connectionDraft) { const latest = connectionsView.items.find(item => item.provider === connectionDraft.provider); connectionDraft.revision = latest ? latest.revision : connectionsView.revision; }
            connectionsMessage = '连接列表已刷新。';
          } else {
            connectionsMessage = event.data.operation === 'remove-model-connection' ? '连接已移除。若正在使用它，请明确选择其他可用模型。' : '连接已保存。请在输入区选择此连接的模型。';
            connectionDraft = undefined; connectionCandidates = [];
            dshSettings = null;
          }
        }
        if (settingsPanelOpen) renderSettingsPanel();
      }
      if (event.data.type === 'dsh-settings') {
        dshSettingsPending = false;
        dshSettings = event.data.ok === true
          ? { ok: true, namespaces: array(event.data.namespaces) }
          : { ok: false, message: string(event.data.message) };
        if (settingsPanelOpen) renderSettingsPanel();
      }
      /* G6 v2（0.0.64）: dsh 配置写入回执。
         0.0.65（用户反馈④）: 成功 → 就地更新（值/覆盖态/revision），不重拉、不动展开态；
         冲突（判据 D）→ 才静默重拉最新（保留旧列表直到新数据到达，展开态由渲染保留）。 */
      if (event.data.type === 'dsh-settings-mutated') {
        const mutatedNs = string(event.data.ns);
        if (event.data.ok === true) {
          showToast('已写入 DSH 配置：' + mutatedNs);
          if (dshSettings && dshSettings.ok === true) {
            const namespace = dshSettings.namespaces.find(candidate => candidate.ns === mutatedNs);
            if (namespace !== undefined) {
              if (typeof event.data.revision === 'number') namespace.revision = event.data.revision;
              const index = pendingDshEdits.findIndex(entry => entry.ns === mutatedNs);
              const applied = index >= 0 ? pendingDshEdits.splice(index, 1)[0] : undefined;
              for (const op of (applied ? applied.ops : [])) {
                const pathKey = Array.isArray(op.path) ? op.path.join('.') : '';
                const field = (namespace.fields || []).find(candidate => candidate.path === pathKey);
                if (field === undefined) continue;
                if (op.op === 'unset') { field.value = field.inherited; field.overridden = false; }
                else if (op.op === 'set') { field.value = op.value; field.overridden = true; }
              }
            }
          }
          if (settingsPanelOpen) renderSettingsPanel();
        } else {
          showToast('写入未生效：' + string(event.data.message || '未知错误') + '（已刷新为最新值，可重试）', true);
          dshSettingsPending = true;
          if (settingsPanelOpen) vscode.postMessage({ type: 'describe-dsh-settings' });
        }
      }
      /* C3 v1.1（0.0.71）: 明细内容按需取的回执——缓存后重渲染（展开态/滚动由各自机制保持）。 */
      if (event.data.type === 'context-detail-result') {
        const key = typeof event.data.key === 'string' ? event.data.key : '';
        const currentSessionId = state ? state.sessionId : '';
        if (event.data.stale === true || event.data.sessionId !== currentSessionId) {
          if (key !== '') contextDetailPending.delete(key);
          return;
        }
        if (key !== '') {
          contextDetailPending.delete(key);
          if (event.data.ok === true && (event.data.text !== undefined || event.data.description !== undefined || event.data.schema !== undefined || (Array.isArray(event.data.images) && event.data.images.length > 0))) {
            contextDetailCache.set(key, {
              ...(event.data.text !== undefined ? { text: event.data.text } : {}),
              ...(event.data.description !== undefined ? { description: event.data.description } : {}),
              ...(event.data.schema !== undefined ? { schema: event.data.schema } : {}),
              ...(Array.isArray(event.data.images) && event.data.images.length > 0 ? { images: event.data.images } : {}),
              ...(event.data.capped === true ? { capped: true } : {}),
            });
          } else {
            contextDetailCache.set(key, { error: true });
          }
        }
        if (contextPanelOpen && state) renderContextPanel(state);
      }
      if (event.data.type === 'draft-images') { draftImages = event.data.images || []; renderAttachments(); clearSendInFlightIfDrained(); }
      /* 0.1.23：本地图片链接 → 直接进侧栏预览（扩展读盘后以 data URL 下发；图片路径不回显到对话）。 */
      if (event.data.type === 'preview-image' && typeof event.data.dataUrl === 'string' && event.data.dataUrl !== '') {
        void openImagePreview(event.data.dataUrl, {});
      }
      /* 0.0.161（用户需求）：Reload/重启后恢复持久化草稿——本地槽位为空才采纳（不覆盖正在输入的内容）；
         当前会话直接填回输入框（文本+图片），并回投 sync-draft-images 让扩展重建权威副本。 */
      if (event.data.type === 'draft-restore' && typeof event.data.sessionId === 'string') {
        const restoreSession = event.data.sessionId;
        const existing = draftSlots.get(restoreSession);
        const existingHas = existing !== undefined && ((((existing.text) || '').trim() !== '') || ((existing.images || []).length > 0));
        if (!existingHas) {
          const images = array(event.data.images)
            .map(entry => record(entry))
            .filter(entry => entry !== undefined)
            .map(image => ({ id: string(image.id), name: string(image.name), mediaType: string(image.mediaType), data: string(image.data) }))
            .filter(image => image.id !== '' && image.data !== '');
          const text = string(event.data.text);
          draftSlots.delete(restoreSession);
          draftSlots.set(restoreSession, { text, images });
          if (draftSlots.size > 32) draftSlots.delete(draftSlots.keys().next().value);
          if (lastDraftSessionId === restoreSession) {
            elements.prompt.value = text;
            draftImages = images.slice();
            resizePrompt(); renderAttachments();
            vscode.postMessage({ type: 'sync-draft-images', images: draftImages });
          }
          publishDraftState();
        }
      }
      if (event.data.type === 'ide-context') { ideContext = event.data.state || { pinned: [] }; renderIdeContext(); updateSend(); }
      if (event.data.type === 'mention-suggestions' && event.data.requestId === mentionRequestId) {
        const mention = currentMentionQuery();
        if (mention && mention.query === event.data.query) { mentionCandidates = event.data.candidates || []; mentionIndex = 0; renderMentionMenu(); }
      }
      /* G49 v2（0.0.121）：端侧穿透加载完成 → 定位滚动到目标轮。 */
      if (event.data.type === 'turn-jump-progress') {
        const target = historyJumpTarget;
        if (!target || target.mode !== 'loading' || event.data.requestId !== target.requestId || event.data.sessionId !== target.sessionId || event.data.seq !== target.seq) return;
        if (Number.isInteger(event.data.pages) && event.data.pages >= 0 && event.data.pages <= target.maxPages) target.pages = Math.max(target.pages, event.data.pages);
        syncHistoryJumpStatus(); return;
      }
      if (event.data.type === 'turn-jump-ready') {
        const target = historyJumpTarget;
        if (!target || target.mode !== 'loading' || event.data.requestId !== target.requestId || event.data.sessionId !== target.sessionId || event.data.seq !== target.seq) return;
        if (Number.isInteger(event.data.pages) && event.data.pages >= 0 && event.data.pages <= target.maxPages) target.pages = Math.max(target.pages, event.data.pages);
        target.totalPages += target.pages;
        target.canContinue = event.data.canContinue === true;
        target.reason = event.data.reason;
        target.mode = event.data.loaded === true ? 'ready' : 'paused';
        syncHistoryJumpStatus();
        const search = pendingSearchJump;
        if (search && search.loadRequested === true && event.data.sessionId === search.sessionId && event.data.seq === search.seq) {
          if (event.data.loaded === false) {
            pendingSearchJump = undefined;
            showToast(event.data.reason === 'error' ? '搜索命中加载失败，请重试' : '搜索命中超出本次可加载范围，请继续加载更早消息', true);
          } else { search.historyReady = true; search.deadline = Date.now() + 30_000; tryPendingSearchJump(); }
          return;
        }
        if (event.data.sessionId !== pendingRailJumpSession || event.data.seq !== pendingRailJumpSeq) return;
        if (event.data.loaded === false) {
          pendingRailJumpSeq = undefined; pendingRailJumpSession = undefined;
          railNavigationLocked = false; railNavigationSeq = undefined; railNavigationId = undefined;
          showToast(event.data.reason === 'error' ? '目标节点加载失败，请重试' : '目标节点超出本次可加载范围，请继续加载更早消息', true); return;
        }
        tryPendingRailJump();
        return;
      }
      /* 0.1.124（数据层根治）：当前会话轨道表（全量表）下发——存表并强制轨道重建。
         会话戳守卫：表只认当前会话（切走后到达/旧会话的表一律丢弃）。 */
      if (event.data.type === 'rail-nodes') {
        const railSession = typeof event.data.sessionId === 'string' ? event.data.sessionId : '';
        const currentSession = state !== undefined && state !== null && typeof state.sessionId === 'string' ? state.sessionId : '';
        if (railSession !== '' && railSession === currentSession && acceptRailTable(railSession, event.data.rail)) {
          try { updateTurnRail(state) } catch { /* 自愈失败不抛 */ }
          /* 0.1.124：几何/元素解析须随新清单重测——表到达常无内容变化（RO 不触发），
             否则 railTops 与元素表停在旧清单（表迟到路径=冷会话秒级返回时必踩）。 */
          scheduleRailMeasure();
          tryPendingRailJump();
        }
        return;
      }
      if (event.data.type === 'rail-unavailable' && event.data.sessionId === state?.sessionId && currentRailTable() === undefined) {
        railPreparationFailedFor = event.data.sessionId;
        syncRailFirstPaint(state);
        return;
      }
      /* 0.1.124（数据层根治）：恢复穿透完成——锚点已可定位则重开短窗精确回位；仍缺则明确提示，
         不静默停在数值位（校正窗口可能中途收窗，故用独立目标存档而非 restoreCtx）。 */
      if (event.data.type === 'restore-through-ready') {
        const target = restoreThroughTarget;
        if (!target || event.data.sessionId !== target.sessionId || event.data.seq !== target.anchorSeq) return;
        if (event.data.loaded === false) {
          clearRestoreThroughTarget();
          showToast(event.data.reason === 'error' ? '恢复上次阅读位置失败：已停在最近位置，可继续阅读' : '上次阅读位置超出可加载范围：已停在最近位置', true); return;
        }
        target.ready = true;
        syncRestoreThroughStatus();
        tryRestoreThroughReady();
      }
      if (event.data.type === 'restore-through-progress') {
        const target = restoreThroughTarget;
        if (!target || event.data.sessionId !== target.sessionId || event.data.seq !== target.anchorSeq) return;
        if (typeof event.data.pages !== 'number' || !Number.isInteger(event.data.pages) || event.data.pages < 0 || event.data.pages > 12) return;
        target.pages = Math.max(target.pages || 0, event.data.pages);
        syncRestoreThroughStatus();
      }
      if (event.data.type === 'focus-prompt') elements.prompt.focus();
      /* 0.1.17：撤销/重做转发（VS Code 工作台截走了 Ctrl+Z，经 keybinding → 命令 → 本消息回来）。 */
      if (event.data.type === 'exec-edit') {
        const command = event.data.command === 'redo' ? 'redo' : 'undo';
        try { document.execCommand(command); } catch { /* 无聚焦可编辑元素时静默 */ }
      }
      if (event.data.type === 'set-prompt' && typeof event.data.text === 'string') {
        elements.prompt.value = event.data.text; resizePrompt(); requestMentions(); renderCommandMenu(); elements.prompt.focus();
        const cursor = elements.prompt.value.length; elements.prompt.setSelectionRange(cursor, cursor);
      }
      /* 0.0.55（反馈①b）: 发送失败回执——清掉本次乐观气泡（它不在 messages 里、不会被 reconcile 清扫），
         文本/图片/文件由 extension 侧保留或还原，用户可改模型后直接重发。
         0.0.56（审核 P1/P2）: ①按 echoSeq 精确删气泡（此前盲删最后一个）；②解除发送在途守卫；
         ③会话已切走的失败——草稿原样存回原会话槽位，当前视图不动（按会话分流，防串台）。 */
      if (event.data.type === 'send-accepted') {
        pendingPromptPreparations.delete(event.data.echoSeq);
        syncCancelVisibility(state);
      }
      if (event.data.type === 'send-failed') {
        sendInFlight = false;
        pendingPromptPreparations.delete(event.data.echoSeq);
        syncCancelVisibility(state);
        const echoSeq = typeof event.data.echoSeq === 'number' ? String(event.data.echoSeq) : undefined;
        const roots = echoSeq === undefined ? [elements.messages] : [elements.messages,
          ...[...sessionDomCache.values()].map(cached => cached.container),
          ...(pendingSessionDom ? [pendingSessionDom.cached.container] : [])];
        const bubbles = [...new Set(roots)].flatMap(root => [...root.querySelectorAll('.optimistic')]);
        const targets = echoSeq === undefined ? bubbles.slice(-1) : bubbles.filter(bubble => bubble.dataset.echoSeq === echoSeq);
        for (const target of targets) target.remove();
        const restore = record(event.data.restore);
        if (restore !== undefined && typeof restore.sessionId === 'string') {
          const images = array(restore.images)
            .map(entry => record(entry))
            .filter(entry => entry !== undefined)
            .map(image => ({ id: string(image.id), name: string(image.name), mediaType: string(image.mediaType), data: string(image.data) }));
          draftSlots.delete(restore.sessionId);
          draftSlots.set(restore.sessionId, { text: string(restore.text), images });
          if (draftSlots.size > 32) draftSlots.delete(draftSlots.keys().next().value);
          publishDraftState();
        }
      }
      /* 0.0.163（审查 P1-2）：存储区快照到达——面板开着就重渲（未开则留存，下次打开直接用）。 */
      if (event.data.type === 'storage-state') {
        storageEntries = Array.isArray(event.data.entries) ? event.data.entries : [];
        if (settingsPanelOpen) { renderedSettingsKey = ''; renderSettingsPanel(); }
      }
      /* 0.0.55（反馈⑥）: 侧栏内轻提示（取代 VS Code 右下角通知，避免遮挡输入框） */
      if (event.data.type === 'toast' && typeof event.data.text === 'string') showToast(event.data.text, event.data.warn === true);
    });
    /* custom dropdowns (A1): restyle native selects with vscode-themed popup */
    /* 页面只保留当前打开的控件。逐控件注册 document 监听会把重建后移除的控件永久挂在文档上。 */
    let activeDrop;
    function closeOutsideDrop(event) {
      if (activeDrop !== undefined && !activeDrop.drop.contains(event.target)) activeDrop.close();
    }
    document.addEventListener('click', closeOutsideDrop);
    function installDrop(select, opts) {
      const drop = document.createElement('div'); drop.className = 'ds-drop';
      if (opts && opts.down) drop.classList.add('down');
      const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'ds-trigger';
      const label = document.createElement('span'); label.className = 'ds-label';
      /* 0.0.65（用户反馈③）: 文字 ▾ 换成细箭头 SVG（全站下拉统一观感）。 */
      const caret = document.createElement('span'); caret.className = 'ds-caret'; caret.innerHTML = CHEVRON_DOWN_SVG;
      const menu = document.createElement('div'); menu.className = 'ds-menu' + (opts && opts.down ? ' down' : ''); menu.hidden = true; menu.setAttribute('role', 'listbox');
      trigger.append(label, caret); drop.append(trigger, menu);
      const dropParent = select.parentNode;
      if (dropParent) dropParent.insertBefore(drop, select);
      else queueMicrotask(() => { const later = select.parentNode; if (later) later.insertBefore(drop, select); });
      select.style.display = 'none';
      trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-haspopup', 'listbox');
      function render() {
        trigger.disabled = select.disabled;
        const opt = select.selectedOptions[0];
        label.textContent = opt ? (opt.textContent || opt.value) : (select.value || '');
        menu.textContent = '';
        const walk = (container) => {
          for (const o of container.children) {
            if (o.tagName === 'OPTGROUP') {
              const gh = document.createElement('div'); gh.className = 'ds-group'; gh.textContent = o.label;
              menu.append(gh);
              walk(o);
            } else {
              const row = document.createElement('div');
              row.className = 'ds-option' + (o.selected ? ' selected' : '');
              row.setAttribute('role', 'option');
              if (o.title) row.title = o.title;
              const title = document.createElement('span'); title.className = 'ds-option-title'; title.textContent = o.textContent;
              row.append(title);
              row.addEventListener('click', () => { if (select.disabled || o.disabled) return; select.value = o.value; select.dispatchEvent(new Event('change')); close(); });
              menu.append(row);
            }
          }
        };
        walk(select);
      }
      function open() {
        if (activeDrop !== undefined) activeDrop.close();
        activeDrop = { drop, close };
        trigger.setAttribute('aria-expanded', 'true'); render(); menu.hidden = false;
        /* 0.0.109（G51）：打开后按视口钳制——①默认左对齐向右侧展开；②触右缘改右对齐（贴触发点）；
           ③右对齐仍出左缘（宽菜单+窄面板）则夹紧左缘到视口 6px（CSS max-width 保证夹紧后右侧必安全）。 */
        menu.classList.remove('align-right'); menu.style.left = '';
        if (menu.getBoundingClientRect().right > window.innerWidth - 6) {
          menu.classList.add('align-right');
          if (menu.getBoundingClientRect().left < 6) {
            menu.classList.remove('align-right');
            menu.style.left = Math.round(6 - drop.getBoundingClientRect().left) + 'px';
          }
        }
      }
      function close() {
        trigger.setAttribute('aria-expanded', 'false'); menu.hidden = true;
        if (activeDrop !== undefined && activeDrop.drop === drop) activeDrop = undefined;
      }
      trigger.addEventListener('click', () => (menu.hidden ? open() : close()));
      select.addEventListener('change', render);
      new MutationObserver(render).observe(select, { attributes: true, childList: true, subtree: true });
      render();
    }
    document.querySelectorAll('select').forEach(select => { if (select.id !== 'sessions') installDrop(select) });

    /* ---- G50（0.0.109）: 翻译文案 hover 显示官方英文原文 ---- */
    /* 映射=官方 dsh 双语字典生成物（ORIGINAL_TEXT_MAP，注入脚本定义；官方更新后重跑
       scripts/gen-original-text-map.mjs 再生成）。开启时对"叶子元素 + 文本精确命中 + 无既有
       title"挂 title=英文原文（打 data-orig 标记），关闭时清理；自研文案不在映射内、天然不受影响。 */
    let originalHoverEnabled = false;
    let originalScanPending = false;
    function applyOriginalText(root) {
      if (typeof ORIGINAL_TEXT_MAP !== 'object' || ORIGINAL_TEXT_MAP === null) return;
      const scope = root && typeof root.querySelectorAll === 'function' ? root : document.body;
      if (!scope) return;
      for (const el of scope.querySelectorAll('*')) {
        if (el.dataset && el.dataset.orig === '1') continue;
        if (el.children.length > 0) continue;
        if (typeof el.hasAttribute === 'function' && el.hasAttribute('title')) continue;
        const text = String(el.textContent || '').trim();
        if (text === '') continue;
        const original = ORIGINAL_TEXT_MAP[text];
        if (typeof original !== 'string' || original === '') continue;
        el.setAttribute('title', original);
        el.dataset.orig = '1';
      }
    }
    function clearOriginalText() {
      for (const el of document.querySelectorAll('[data-orig="1"]')) {
        el.removeAttribute('title');
        delete el.dataset.orig;
      }
    }
    function scheduleOriginalScan() {
      if (!originalHoverEnabled || originalScanPending) return;
      originalScanPending = true;
      requestAnimationFrame(() => { originalScanPending = false; applyOriginalText(document.body); });
    }
    /* vitest 极简 DOM 桩无 MutationObserver（手册 §20 第 9 条）——防御后桩环境静默跳过。 */
    if (typeof MutationObserver === 'function') new MutationObserver(scheduleOriginalScan).observe(document.body, { childList: true, subtree: true, characterData: true });
    /* 0.1.27（用户需求）：内容列最大宽度——写进 CSS 变量供 .conversation/.composer/.queue-dock 用。
       -1 = 无上限：用超大 px 而不是 none，避免 min()/百分比里出现关键字导致整条声明失效。 */
    let contentMaxApplied;
    function syncContentMaxWidth(ui) {
      const raw = ui !== undefined && ui !== null && typeof ui.contentMaxWidth === 'number' ? ui.contentMaxWidth : 760;
      const value = raw === -1 ? 100000 : Math.min(4000, Math.max(320, Math.round(raw)));
      if (value === contentMaxApplied) return;
      contentMaxApplied = value;
      document.documentElement.style.setProperty('--content-max', String(value) + 'px');
    }
    function syncOriginalHover(enabled) {
      const want = enabled === true;
      if (want === originalHoverEnabled) { if (want) scheduleOriginalScan(); return; }
      originalHoverEnabled = want;
      if (want) scheduleOriginalScan(); else clearOriginalText();
    }
    /* session tabs (E1): horizontal strip; hover reveals ✎/×, running sessions show whale mark without × */
    elements.sessions.style.display = 'none';
    const tabsEl = elements.sessionTabs;
    /* keyed incremental tab strip: running sessions stream state updates at a
       high rate, and rebuilding the whole strip every frame destroyed hovered
       delete buttons mid-click (flicker + missed taps). Nodes are reused and
       only the bits that changed are touched. */
    const tabNodes = new Map();
    /* 0.0.36 (bug⑪): 上次渲染的会话顺序——顺序未变时跳过节点移动（见 renderSessionTabs） */
    let lastTabOrder = '';
    /* 0.0.147: 上次应用的标签最小宽度——设置改变时对全部标签重算宽度（updateTab 只在
       标题文字变化时重算，设设置改了文字没变就永远不会触发）。 */
    let lastTabMinWidth = 0;
    /* G5 v9: 拖拽排序——dragstart 记录源 id，drop 上报 beforeId（目标前插入；strip 空白处=末尾） */
    let dragSourceId = undefined;
    /* G14 (0.0.15): tabs own a fixed width computed from the label so that
       hover actions never stretch the tab (edge tabs would be forced wider).
       Hover actions instead compress the title (flex-shrink + ellipsis).
       0.0.147（用户反馈①）: 最小宽度改为设置驱动（ui.sessionTabMinWidth，默认 112）——
       旧值 68px 悬停时 ✎/✕（共 46px）几乎占满标签、切换会话易误点。 */
    const TAB_MAX_W = 150;
    /* 设置无效/缺失时的兜底（= 设置默认值）；设置本身在 view-settings 侧夹取 68–200。 */
    const TAB_MIN_WIDTH_FALLBACK = 112;
    function tabMinWidth() {
      const raw = state && state.uiSettings ? Number(state.uiSettings.sessionTabMinWidth) : NaN;
      return Number.isFinite(raw) ? Math.min(200, Math.max(68, Math.round(raw))) : TAB_MIN_WIDTH_FALLBACK;
    }
    function labelWidth(label) {
      let w = 0;
      for (const ch of label) w += ch.codePointAt(0) > 0x7f ? 12 : 6.5;
      return w;
    }
    function setTabWidth(tab, label) {
      const min = tabMinWidth();
      const max = Math.max(TAB_MAX_W, min);
      const tw = Math.round(Math.max(min, Math.min(max, labelWidth(label) + 16)));
      tab.style.width = tw + 'px';
      /* 0.0.147: CSS 的 max-width:150px 会把 >150 的设置值压回去——内联同步放宽
         （探针实证：设置 160 时标签仍是 150）。 */
      tab.style.maxWidth = max + 'px';
    }
    function buildTab(s) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'session-tab';
      tab.setAttribute('role', 'tab');
      /* G5 v9: 拖拽排序（drop-before 语义）——已就位时 moveSessionBefore 返回原引用，extension 跳过重发 */
      tab.draggable = true;
      tab.addEventListener('dragstart', (event) => {
        dragSourceId = s.id;
        tab.classList.add('drag-source');
        const dt = event.dataTransfer;
        if (dt) { dt.effectAllowed = 'move'; dt.setData('text/plain', s.id); }
      });
      tab.addEventListener('dragover', (event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        tab.classList.add('drag-over');
      });
      tab.addEventListener('dragleave', () => tab.classList.remove('drag-over'));
      tab.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();
        tab.classList.remove('drag-over');
        if (dragSourceId !== undefined && dragSourceId !== s.id) {
          vscode.postMessage({ type: 'reorder-sessions', sessionId: dragSourceId, beforeId: s.id });
        }
        dragSourceId = undefined;
        for (const el of document.querySelectorAll('.session-tab.drag-source, .session-tab.drag-over')) {
          el.classList.remove('drag-source', 'drag-over');
        }
      });
      tab.addEventListener('dragend', () => {
        dragSourceId = undefined;
        for (const el of document.querySelectorAll('.session-tab.drag-source, .session-tab.drag-over')) {
          el.classList.remove('drag-source', 'drag-over');
        }
      });
      const title = document.createElement('span');
      title.className = 'tab-title';
      const act = document.createElement('span');
      act.className = 'tab-actions';
      const rn = document.createElement('button');
      rn.type = 'button'; rn.className = 'tab-action'; rn.textContent = '✎';
      rn.title = '重命名'; rn.setAttribute('aria-label', '重命名');
      rn.addEventListener('click', (event) => { event.stopPropagation(); if (elements.sessions.disabled) return; openRename(s.id); });
      act.append(rn);
      tab.append(title, act);
      tab.addEventListener('click', () => { if (elements.sessions.disabled) return; vscode.postMessage({ type: 'select-session', sessionId: s.id }); });
      return tab;
    }
    function setTabDelete(tab, s, show) {
      const actions = tab.querySelector('.tab-actions');
      const existing = actions.querySelector('.tab-action.danger');
      if (!show) { if (existing) existing.remove(); return; }
      if (existing) return;
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'tab-action danger'; del.textContent = '✕';
      del.title = '删除'; del.setAttribute('aria-label', '删除');
      del.addEventListener('click', (event) => { event.stopPropagation(); vscode.postMessage({ type: 'trash-session', sessionId: s.id }); });
      actions.append(del);
    }
    /* G5: tab tooltip —— 最后活动 + 创建时间（官方会话 hover 的 fork 形态；缺失显示"不可用"） */
    function sessionTooltip(label, s) {
      const updated = s.updatedAt === undefined ? '不可用' : formatMessageClock(s.updatedAt);
      const created = s.createdAt === undefined ? '不可用' : formatMessageClock(s.createdAt);
      return label + '\\n更新于 ' + updated + ' · 创建于 ' + created;
    }
    function updateTab(tab, s, currentId) {
      const label = sessionTitles[s.id] || s.title;
      const titleEl = tab.querySelector('.tab-title');
      if (titleEl.textContent !== label) { titleEl.textContent = label; setTabWidth(tab, label); }
      const tooltip = sessionTooltip(label, s);
      if (tab.title !== tooltip) tab.title = tooltip;
      const active = s.id === currentId;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      const running = s.running === true;
      tab.classList.toggle('running', running);
      let run = tab.querySelector('.tab-run');
      if (running && !run) { run = document.createElement('span'); run.className = 'deepseek-mark tab-run'; run.title = '运行中'; tab.insertBefore(run, tab.firstChild); }
      else if (!running && run) run.remove();
      setTabDelete(tab, s, !running && !(tabNodes.size === 1 && s.blank === true));
    }
    /* 0.0.167（B4 P1-5）：标签栏就地搜索——纯前端过滤（零新通道）：标题子串（大小写不敏感）
       命中的标签留在条上、其余 display:none；回车跳第一个匹配；Esc / ✕ 关闭并还原。 */
    let tabQuery = '';
    /* 0.0.168（B4 反馈）：内容命中（运行时 session.search 全文索引）——代际/请求号守卫 +
       结果面板折叠开关（跳转后收起，改词再展开）。 */
    let searchRequestId = 0;
    let searchHits = [];
    /* 0.0.170：本工作区内容索引命中（扩展侧子串匹配，带 messageId/title/trashed）。 */
    let searchIndexHits = [];
    let searchHitsQuery = '';
    /* 0.1.123（G55 Phase 3）：他会话「轨道节点表」缓存（扩展随本地搜索结果下发：{sid: {segment:[{seq,mid,key}], turn:[…]}}）。 */
    let foreignNodeTables = {};
    let searchHasMore = false;
    let searchNotes = '';
    let searchLoading = false;
    let searchLocalReady = false;
    let searchPanelCollapsed = false;
    /* 0.1.65（T3-1）：结果面板选中行（-1=未选；↑/↓ 进入，Enter 跳它，改词/关面板复位）。
       0.1.94：选中行按**消息**跟踪（不再按序号残留）；0.1.95：键升级为**会话+消息复合键**——
       投影器的 assistant:<turn>:<step> / user:<seq> 跨会话天然重号（真机实证：两个会话都有 assistant:1:1），
       只按 mid 匹配会把选中/走路解析到**他会话同号行**（真机"在第三个会话循环"根因）。 */
    let searchActiveRow = -1;
    let searchActiveKey = '';
    /* 0.1.65（T3-7）：索引规模与新鲜度（扩展随本地回包附来；脚注用）。 */
    let searchIndexStats;
    let searchHistorySessionId = '';
    /* 0.1.72（用户拍板）：长片段表（mid → 长片段）与 pane 模式的悬停行。 */
    let searchLongSnippets = new Map();
    let searchPeekMid = '';
    /* 0.1.66：当前所处命中（Enter 逐处跳的光标；occurrence 为 1 基序号）。 */
    let searchCursor;
    /* 0.1.94（用户拍板「先区域、再时间」）：逐处跳顺序表与**渲染解耦**——表由结果数据维护
       （搜索回包/面板渲染时合并，见 syncWalkOrderFromModel），面板收起期间晚到的命中同样入表；
       已建立条目保持相对次序，新条目并入其所属会话组；换词整表重来。
       面板按会话分组（见 searchRowModel）⇒ **面板所见次序 = Enter 所走次序**。 */
    let walkOrder = [];
    let walkOrderQuery = '';
    /* 0.1.97（真机反馈②：绕回第一会话落点不高亮/不呼吸）：本轮**面板里真实存在**的可跳行键集——
       步进只落到这些条目上（"所见即所走"）。陈旧条目（曾入表、现已不在面板：本地扫描窗口移走 / 索引重建）被跳过，
       否则绕回会选中一条不可见/不可渲染的条目 ⇒ 落点无高亮、无呼吸。 */
    let walkVisibleKeys = new Set();
    /* 走路表最近一次刷新时所在的会话（render 里"会话切换即刷新"的守卫，见 render()）。 */
    let walkOrderSessionId = '';
    /* 0.1.66：滚动联动——视口内的命中消息（结果顺序里第一个可见的）与观察器。 */
    let searchVisibleMid = '';
    let searchVisibleMids = new Set();
    let searchObserver;
    let searchObservedKey = '';
    let searchObservedNodes = [];   /* 0.1.70（审核）：观察的是哪批**节点对象**（防整树重渲后看陈旧节点） */
    let searchTimer = undefined;
    function tabTitleOf(s) { return sessionTitles[s.id] || s.title; }
    /* 0.1.76（A 类收尾 T3-5）：搜索范围（本工作区=本地+索引 / 当前会话=只本地即时扫描）与查询解析。
       解析：「-词」为**排除项**（只在词首且前面是空格/串首时生效，「a-b」不触发）；
       引号短语**不需要**特殊处理——匹配本来就是整串子串（「"甲 乙"」与「甲 乙」等价）。 */
    let searchScope = 'workspace';
    let searchHistory = [];
    function parseSearchQuery(raw) {
      const parts = String(raw === undefined || raw === null ? '' : raw).trim().split(/\\s+/).filter(part => part !== '');
      const excludes = [];
      const keep = [];
      for (const part of parts) {
        if (part.length > 1 && part.charAt(0) === '-') excludes.push(part.slice(1).toLowerCase());
        else keep.push(part);
      }
      return { include: keep.join(' '), excludes };
    }
    /* T3-6（0.1.76）→ 0.1.88（用户拍板重建）：跨会话搜索跳转后的「← 返回 搜索起点」胶囊。
       语义：目标是**搜索起点**——输入本次查询时所在的会话（与结果标签同源锚，0.1.83）；
       跨会话跳转 B→C→D **永不改写目标**（旧实现每跳改写 ⇒ 实际变成"返回上一站"，回到起点时票还亮着 = 用户所见），
       只有"输入新查询"才重锚（=新搜索）；12s 自动消失（时长入设置，3–120 秒）。 */
    let searchReturnPill;
    /* 0.1.96（用户拍板）：工具卡内容（工具调用参数/输出）默认不参与搜索——参数长 JSON 噪声大、
       常与助手正文重复；设置台「搜索」区可开（想搜命令/文件路径/工具输出时）。 */
    function searchIncludeTools() {
      const cfg = state === undefined || state === null ? undefined : state.searchSettings;
      return cfg !== undefined && cfg !== null && cfg.includeTools === true;
    }
    /* 0.1.122（G55）：搜索结果行内节点编号片开关（默认开）。 */
    function searchNodeChipEnabled() {
      const cfg = state === undefined || state === null ? undefined : state.searchSettings;
      return cfg === undefined || cfg === null || cfg.nodeChip !== false;
    }
    /* 0.1.103（用户需求）：Enter 逐处跳的**会话组序**——'recent'（默认）= 其余会话按组内最新命中时间降序；
       'panel' = 按会话栏（标签）里的先后顺序（老会话先走）。起点会话永远第一个。 */
    function searchGroupOrder() {
      const cfg = state === undefined || state === null ? undefined : state.searchSettings;
      return cfg !== undefined && cfg !== null && cfg.groupOrder === 'panel' ? 'panel' : 'recent';
    }
    /* 0.1.84（用户拍板）：胶囊可整体关闭（设置台「搜索」区，默认开）。 */
    function searchReturnPillEnabled() {
      const cfg = state === undefined || state === null ? undefined : state.searchSettings;
      return cfg === undefined || cfg === null || cfg.returnPill !== false;
    }
    /* 0.1.88（用户需求）：胶囊显示时长入设置（秒，3–120，默认 12）。 */
    function searchReturnPillSeconds() {
      const cfg = state === undefined || state === null ? undefined : state.searchSettings;
      const seconds = cfg === undefined || cfg === null ? undefined : cfg.returnPillSeconds;
      return typeof seconds === 'number' && isFinite(seconds) ? Math.min(120, Math.max(3, Math.round(seconds))) : 12;
    }
    function renderSearchReturnPillLabel() {
      const go = document.getElementById('searchReturnPillGo');
      if (go === null || searchReturnPill === undefined) return;
      const sessions = state === undefined || state === null ? [] : state.sessions || [];
      const summary = sessions.find(item => item.id === searchReturnPill.targetId);
      const title = summary === undefined ? '' : tabTitleOf(summary);
      const label = '← 返回 ' + (title === '' ? '搜索起点' : title);
      if (go.textContent !== label) go.textContent = label;
    }
    function armSearchReturnPillTimer() {
      if (searchReturnPill === undefined) return;
      window.clearTimeout(searchReturnPill.timer);
      searchReturnPill.seconds = searchReturnPillSeconds();
      searchReturnPill.timer = window.setTimeout(() => { hideSearchReturnPill(); }, searchReturnPill.seconds * 1000);
    }
    /* 跨会话跳转时调用：无票 ⇒ 开票（目标 = 搜索起点锚；锚为空则回落"离开的会话"）；有票 ⇒ 只续期，目标绝不改写。 */
    function noteSearchReturnPillJump(fromId) {
      if (!searchReturnPillEnabled()) return;
      if (searchReturnPill === undefined) {
        searchReturnPill = { targetId: searchOriginSessionId !== '' ? searchOriginSessionId : fromId, timer: undefined, seconds: 0 };
      }
      renderSearchReturnPillLabel();
      armSearchReturnPillTimer();
    }
    /* 0.1.88：新查询 = 新搜索起点 ⇒ 活着的票随锚换目标（与结果标签同源；人在新目标处则票隐）。
       换目标后**当场跑一次同步判定**——否则 hidden 类要等下一帧 render 才纠正，会出现
       "人已在新目标会话里、票还亮着"的残留窗口（探针实测抓到的唯一失败项）。 */
    function reanchorSearchReturnPill() {
      if (searchReturnPill === undefined) return;
      const now = state === undefined || state === null ? '' : String(state.sessionId || '');
      if (now === '' || now === searchReturnPill.targetId) return;
      searchReturnPill.targetId = now;
      syncSearchReturnPill();
    }
    function hideSearchReturnPill() {
      if (searchReturnPill !== undefined) window.clearTimeout(searchReturnPill.timer);
      searchReturnPill = undefined;
      const el = document.getElementById('searchReturnPill');
      if (el !== null) el.classList.add('hidden');
    }
    /* 0.1.87 起：可见性 = **渲染期纯函数**（每帧判定，不挂任何事件钩子——0.1.84/85/86 三轮的教训：
       撤除逻辑一旦挂在某条渲染路径上，漏一条路径就留屏）。0.1.88 只改判定内容：
       票在 且 当前会话 ≠ 目标 ⇒ 显示；人回到起点（跳回来 / 手点回来都算）即隐；
       跳去任何别的会话仍显示——它始终是"回起点"的入口。 */
    function syncSearchReturnPill() {
      const el = document.getElementById('searchReturnPill');
      if (el === null) return;
      if (searchReturnPill === undefined || !searchReturnPillEnabled()) { el.classList.add('hidden'); return; }
      /* 设置里改了时长 ⇒ 当场换新节奏（不必等下一次跳转）。 */
      if (searchReturnPill.seconds !== searchReturnPillSeconds()) armSearchReturnPillTimer();
      renderSearchReturnPillLabel();
      const now = state === undefined || state === null ? '' : String(state.sessionId || '');
      el.classList.toggle('hidden', now === searchReturnPill.targetId);
    }
    /* T3-8（0.1.76）：搜索跳转**自动展开**的段，在下一次跳转/新搜索时折回；用户手动开过的不动。 */
    let searchAutoFoldedBar;
    function foldBackAutoExpanded() {
      const bar = searchAutoFoldedBar;
      searchAutoFoldedBar = undefined;
      if (bar === undefined || bar === null || bar.isConnected !== true) return;
      if (bar.dataset !== undefined && bar.dataset.userToggled === '1') return;
      if (bar.getAttribute('aria-expanded') !== 'true') return;
      if (typeof bar.__setFolded === 'function') bar.__setFolded(true);
    }
    /* T3-4（0.1.76）：搜索历史——去重置顶、上限 10、落 workspaceState（Reload/重启仍在）。 */
    function pushSearchHistory(query) {
      const term = String(query === undefined || query === null ? '' : query).trim();
      if (term === '') return;
      const next = [term].concat(searchHistory.filter(item => item !== term)).slice(0, 10);
      searchHistory = next;
      vscode.postMessage({ type: 'save-search-history', items: next });
    }
    /* 0.1.80（用户拍板 E 方案：调研对照见 _temp/dsh_迁移计划/2026-09-26_搜索历史记录策略_调研与方案.md）：
       **搜索触发与写历史解耦**——旧实现把"250ms 防抖触发检索"直接当落历史信号，于是输入法（IME）
       拼音候选阶段的中途值（xia'zai / 选错的 瞎子啊）也进了历史（用户实测）。
       新口径三条件取或：① 组合期一律不写（且 compositionend 补一次提交点）；
       ② 回车提交 / 点结果行 ⇒ **立即**写并置顶；③ 否则"停笔 ≥1.2s"兜底写（对标 VS Code 编辑器
       Ctrl+F 输入框的 500ms Delayer 思路，1.2s 覆盖"拼音还没选完"，打字停顿研究以 ≥2s 为停笔惯例）。 */
    let searchComposing = false;
    let searchHistoryTimer;
    const SEARCH_HISTORY_SETTLE_MS = 1200;
    function scheduleSearchHistory() {
      if (searchHistoryTimer !== undefined) window.clearTimeout(searchHistoryTimer);
      searchHistoryTimer = window.setTimeout(() => {
        searchHistoryTimer = undefined;
        pushSearchHistory(tabQuery);
      }, SEARCH_HISTORY_SETTLE_MS);
    }
    function cancelSearchHistoryTimer() {
      if (searchHistoryTimer === undefined) return;
      window.clearTimeout(searchHistoryTimer);
      searchHistoryTimer = undefined;
    }
    /* 提交点（回车/点结果）：取消待落计时并立即落地当前词。 */
    function flushSearchHistory() {
      cancelSearchHistoryTimer();
      if (searchComposing) return;   /* 组合期不提交（Enter 在 IME 里常是选词） */
      pushSearchHistory(tabQuery);
    }
    /* 0.1.83（用户拍板"要切，但标签别漂"）：**搜索起点会话**——结果标签「当前会话/其他会话」
       以"开始这次搜索时所在的会话"为准，不随「Enter 逐处跳」跨到他会话而漂移。
       捕获点=新查询进输入框（打字/输入法定稿/点历史条目）；关面板即清（下次搜索重新锚定）。 */
    let searchOriginSessionId = '';
    function markSearchOrigin() {
      const now = state === undefined || state === null ? '' : String(state.sessionId || '');
      if (now !== '') searchOriginSessionId = now;
      /* 0.1.88：新查询 = 新搜索起点 ⇒ 活着的返回胶囊随锚换目标（与结果标签同源）。 */
      reanchorSearchReturnPill();
    }
    function searchOriginSession() {
      if (searchOriginSessionId !== '') return searchOriginSessionId;
      return state === undefined || state === null ? '' : String(state.sessionId || '');
    }
    /* T3-5（0.1.76）：范围开关（本工作区=本地+索引 / 当前会话=只本地即时扫描）。 */
    function searchScopeSwitch() {
      const wrap = node('span', 'tab-search-scope');
      for (const option of [['workspace', '本工作区'], ['session', '当前会话']]) {
        const btn = node('button', 'tab-search-scope-btn' + (searchScope === option[0] ? ' active' : ''), option[1]);
        btn.type = 'button';
        btn.addEventListener('click', (event) => {
          event.stopPropagation();
          if (searchScope === option[0]) return;
          searchScope = option[0];
          searchActiveRow = -1;
          searchActiveKey = '';
          searchCursor = undefined;
          requestSearch();
        });
        wrap.append(btn);
      }
      return wrap;
    }
    /* T3-4：空查询时的「最近搜索」面板。 */
    function renderSearchHistory(scroller) {
      const head = node('div', 'tab-search-note tab-search-count');
      head.append(searchScopeSwitch());
      head.append(node('span', 'tab-search-note-text', '最近搜索'));
      scroller.append(head);
      for (const term of searchHistory) {
        /* 0.1.80（用户需求）：行改「外层胶囊 + 内层点搜按钮 + 单条 ✕ 删除」——button 不可嵌套，
           故外层用 div（悬停底色统一挂它），删除按钮独立，绝不触发"点这条去搜"。 */
        const row = node('div', 'tab-search-history-row');
        const label = node('button', 'tab-search-history');
        label.type = 'button';
        label.append(node('span', 'tab-search-history-label', term));
        label.addEventListener('click', (event) => {
          event.stopPropagation();
          markSearchOrigin();   /* 0.1.83：点历史条目 = 新搜索 */
          elements.tabSearchInput.value = term;
          tabQuery = term;
          searchPanelCollapsed = false;
          searchActiveRow = -1;
          searchActiveKey = '';
          searchCursor = undefined;
          applyTabFilter();
          requestSearch();
        });
        const del = node('button', 'tab-search-history-del', '✕');
        del.type = 'button';
        del.title = '从历史中删除这一条';
        del.setAttribute('aria-label', '删除历史条目 ' + term);
        del.addEventListener('click', (event) => {
          event.stopPropagation();
          searchHistory = searchHistory.filter(item => item !== term);
          vscode.postMessage({ type: 'save-search-history', items: searchHistory });
          renderSearchResults();   /* 就地重渲：面板保持打开、"清空历史"仍在 */
        });
        row.append(label, del);
        scroller.append(row);
      }
      const clear = node('button', 'tab-search-history-clear', '清空历史');
      clear.type = 'button';
      clear.addEventListener('click', (event) => {
        event.stopPropagation();
        searchHistory = [];
        vscode.postMessage({ type: 'save-search-history', items: [] });
        renderSearchResults();
      });
      scroller.append(clear);
    }
    /* 排除词过滤（本地路径用；索引路径把 excludes 一并交给扩展，按条目全文过滤）。 */
    function searchTextAllowed(text, excludes) {
      if (excludes.length === 0) return true;
      const lowered = String(text === undefined || text === null ? '' : text).toLowerCase();
      for (const word of excludes) { if (lowered.indexOf(word) >= 0) return false; }
      return true;
    }
    /* 0.1.71（用户拍板）：结果排序档位——recent（默认，段内最近优先）/ oldest（时间正序）。 */
    function searchResultOrder() {
      const cfg = state === undefined || state === null ? undefined : state.searchSettings;
      return cfg !== undefined && cfg !== null && cfg.resultOrder === 'oldest' ? 'oldest' : 'recent';
    }
    /* S-4：片段里的命中词高亮（首个命中、大小写不敏感）。0.1.72 提到模块作用域——行内与详情区共用。 */
    function snippetRow(snippet, needle) {
      const holder = node('span', 'tab-search-hit-snippet');
      const text = String(snippet === undefined || snippet === null ? '' : snippet);
      const at = needle === '' ? -1 : text.toLowerCase().indexOf(needle.toLowerCase());
      if (at < 0) { holder.textContent = text; return holder; }
      holder.append(document.createTextNode(text.slice(0, at)));
      holder.append(node('mark', 'tab-search-mark', text.slice(at, at + needle.length)));
      holder.append(document.createTextNode(text.slice(at + needle.length)));
      return holder;
    }
    /* 0.1.73（用户反馈②）：覆盖层**一律向下浮出**、位置由 JS 计算——它挂在面板直属层里（不在滚动区内），
       所以不受面板裁剪，能越出结果框的下边界；顶到视口底就压高度，而不是回翻。 */
    let searchPeekShowTimer;
    let searchPeekHideTimer;
    let searchPeekRowMid = '';
    function showSearchPeek(row) {
      const layer = document.getElementById('tabSearchPeekLayer');
      if (layer === null || row === null || row === undefined) { hideSearchPeek(); return; }
      const mid = String(row.dataset.mid || '');
      const text = mid === '' ? undefined : searchLongSnippets.get(mid);
      if (text === undefined || text === '') { hideSearchPeek(); return; }
      searchPeekRowMid = mid;
      layer.replaceChildren();
      const box = node('div', 'tab-search-hit-peek');
      box.append(snippetRow(text, tabQuery.trim()));
      layer.append(box);
      const rowRect = row.getBoundingClientRect();
      const panelRect = elements.tabSearchResults.getBoundingClientRect();
      const top = Math.round(rowRect.top - panelRect.top + rowRect.height - 2);
      box.style.top = String(top) + 'px';
      /* 视口底不够：压高度（不回翻）。 */
      const room = window.innerHeight - rowRect.bottom - 10;
      box.style.maxHeight = room < 160 ? String(Math.max(56, Math.round(room))) + 'px' : '';
      layer.classList.add('visible');
    }
    function hideSearchPeek() {
      /* 0.1.75（复查）：一并取消**待触发**的显示计时器——否则重渲后它到点会用已脱钩的旧行弹出一个位置错乱的浮层。 */
      if (searchPeekShowTimer !== undefined) { window.clearTimeout(searchPeekShowTimer); searchPeekShowTimer = undefined; }
      const layer = document.getElementById('tabSearchPeekLayer');
      if (layer === null) return;
      layer.classList.remove('visible');
      layer.replaceChildren();
      searchPeekRowMid = '';
    }
    /* 悬停意图：进场 ~140ms 才显示、离场 ~160ms 才收起（快速扫过时不闪）。 */
    function schedulePeek(row) {
      if (searchPeekHideTimer !== undefined) { window.clearTimeout(searchPeekHideTimer); searchPeekHideTimer = undefined; }
      if (searchPeekShowTimer !== undefined) window.clearTimeout(searchPeekShowTimer);
      const mid = row === null ? '' : String(row.dataset.mid || '');
      if (mid !== '' && mid === searchPeekRowMid) return;
      searchPeekShowTimer = window.setTimeout(() => { searchPeekShowTimer = undefined; showSearchPeek(row); }, 140);
    }
    function schedulePeekHide() {
      if (searchPeekShowTimer !== undefined) { window.clearTimeout(searchPeekShowTimer); searchPeekShowTimer = undefined; }
      if (searchPeekHideTimer !== undefined) window.clearTimeout(searchPeekHideTimer);
      searchPeekHideTimer = window.setTimeout(() => { searchPeekHideTimer = undefined; hideSearchPeek(); }, 160);
    }
    /* 0.1.72：pane 模式的内容更新——悬停行优先，其次选中行（键盘可达：↑/↓ 走到哪条就看哪条）。 */
    /* 0.1.73：键盘可达——↑/↓ 选中或跳转落到的那条，在 peek 档也把长片段显示出来。 */
    function refreshSelectedPeek() {
      if (searchSnippetView() !== 'peek') return;
      const active = elements.tabSearchResults.querySelector('.tab-search-hit-active');
      if (active === null) { hideSearchPeek(); return; }
      showSearchPeek(active);
    }
    function updateSearchPeekPane() {
      const pane = document.getElementById('tabSearchPeekPane');
      if (pane === null) return;
      let mid = searchPeekMid;
      if (mid === '') {
        const active = elements.tabSearchResults.querySelector('.tab-search-hit-active');
        mid = active === null ? '' : String(active.dataset.mid || '');
      }
      const text = mid === '' ? undefined : searchLongSnippets.get(mid);
      if (text === undefined || text === '') { pane.classList.add('hidden'); pane.replaceChildren(); return; }
      pane.classList.remove('hidden');
      pane.replaceChildren(snippetRow(text, tabQuery.trim()));
    }
    /* 0.1.72（用户拍板）：长片段显示方式——peek（默认，悬停覆盖层，行高恒定）/ pane（面板底部固定详情区）。
       背景：行内展开会推挤下方行 ⇒ 指针从 A 往下走会**跳过 B**（用户实测）；调研结论=悬停揭示内容
       不该参与文档流（见 _temp/dsh_迁移计划/2026-09-26_悬停预览调研.md）。 */
    function searchSnippetView() {
      const cfg = state === undefined || state === null ? undefined : state.searchSettings;
      return cfg !== undefined && cfg !== null && cfg.snippetView === 'pane' ? 'pane' : 'peek';
    }
    function tabSearchOpen() { return !elements.tabSearch.classList.contains('hidden'); }
    /* 命中集合（标签过滤/计数用）= 本工作区索引 ∪ 运行时他区。 */
    function searchHitsFor(query) {
      if (searchHitsQuery !== query) return [];
      return searchIndexHits.concat(searchHits);
    }
    function applyTabFilter() {
      /* T3-6 的"切走第三个会话即撤"已并入渲染期判定 syncSearchReturnPill（0.1.87），此处不再单列。 */
      const list = (state && state.sessions) || [];
      const query = tabQuery.trim().toLowerCase();
      const hitIds = new Set(searchHitsFor(query).map(item => item.sessionId));
      let shown = 0;
      for (const s of list) {
        const node = tabNodes.get(s.id);
        if (!node) continue;
        const match = query === '' || hitIds.has(s.id) || tabTitleOf(s).toLowerCase().includes(query);
        node.classList.toggle('tab-filtered', !match);
        if (match) shown += 1;
      }
      if (query === '') elements.tabSearchCount.textContent = '';
      else {
        /* 0.0.169：有内容命中时不再显示"无匹配"（标签 0 条但内容有命中是常见情形）。 */
        let text = shown === 0 && hitIds.size === 0 ? '无匹配' : String(shown) + '/' + String(list.length);
        if (searchLoading) text += searchScope === 'session' ? ' · 本会话补查中…' : searchLocalReady ? ' · 跨工作区检索中…' : ' · 本工作区检索中…';
        else if (hitIds.size > 0) text += ' · 内容命中 ' + String(hitIds.size) + (searchHasMore ? '+' : '');
        elements.tabSearchCount.textContent = text;
      }
      renderSearchResults();
      return shown;
    }
    /* 0.0.169（用户反馈）：**当前会话内命中**——子串匹配（不受运行时 unicode61 分词限制；
       用户实测"内容明显有但搜不到"）。消息文本/图片名/文件名三路，最多 8 条。
       消息文本可能被瘦身（超长消息 text 空）→ 回落已渲染 DOM 文本。 */
    function localSessionHits(query, excludes) {
      const q = query.toLowerCase();
      /* 0.1.109（代码审查）：include 为空（只输排除词「-词」）时 indexOf('') 恒 0 ⇒ 会把**每条消息**
         当命中（60 条噪声行 + 走路表被污染）。此路径不止"请求搜索"会走（设置变更/会话落地/回绕解析
         都会现算模型），故在源头直接短路。 */
      if (q === '') return [];
      const skip = Array.isArray(excludes) ? excludes : [];
      const hits = [];
      /* 0.1.97（真机反馈：中段内容搜不到）：旧实现按消息顺序从头扫、满 20 条即停 ⇒
         长会话里**只有最旧的 20 条命中**（EUV 主会话：本地只出 09-19~21，索引只覆盖 09-23 ⇒ 中段 09-22 断档）。
         现改为**全量扫描**（同步子串，2261 条实测成本可忽略），命中按时间**从新到旧**取前 60 条。 */
      const allMessages = (state === undefined ? [] : state.messages) || [];
      for (let cursor = allMessages.length - 1; cursor >= 0; cursor -= 1) {
        if (hits.length >= 60) break;
        const message = allMessages[cursor];
        if (message === undefined || message === null) continue;
        if (typeof message.id !== 'string' || !renderedMessages.has(message.id)) continue;
        const sources = [];
        if (typeof message.text === 'string' && message.text !== '') sources.push({ kind: '文本', text: message.text });
        for (const image of message.images || []) if (typeof image.name === 'string' && image.name !== '') sources.push({ kind: '图片', text: image.name });
        for (const file of message.files || []) {
          if (typeof file.name === 'string' && file.name !== '') sources.push({ kind: '文件', text: file.name });
          else if (typeof file.path === 'string' && file.path !== '') sources.push({ kind: '文件', text: file.path });
        }
        if (sources.length === 0) {
          const rec = renderedMessages.get(message.id);
          const el = rec === undefined ? undefined : rec.node;
          const text = el === undefined || el === null ? '' : String(el.textContent || '');
          if (text !== '') sources.push({ kind: '正文', text: text });
        }
        let hit;
        for (const source of sources) {
          const lowered = source.text.toLowerCase();
          const index = lowered.indexOf(q);
          if (index < 0) continue;
          if (!searchTextAllowed(source.text, skip)) continue;   /* T3-5：排除词 */
          const from = Math.max(0, index - 16);
          const body = source.text.slice(from, index + q.length + 30).replace(/\\s+/g, ' ').trim();
          /* 0.1.65（T3-3）：与索引路径同口径的出现次数（"共 N 处"）。 */
          let total = 0;
          for (let at = lowered.indexOf(q); at >= 0; at = lowered.indexOf(q, at + q.length)) total += 1;
          /* 0.1.71（悬停展开）：同一处的**长片段**（前 120 / 后 240 字）；排序用消息时间戳。 */
          const longFrom = Math.max(0, index - 120);
          const longBody = source.text.slice(longFrom, index + q.length + 240).replace(/\\s+/g, ' ').trim();
          const prefix = (message.role === 'user' ? '你' : message.role === 'assistant' ? 'DeepSeek' : '记录') + ' · ' + source.kind + '：';
          hit = {
            messageId: message.id,
            kind: source.kind,
            total,
            time: typeof message.time === 'number' ? message.time : 0,
            snippet: prefix + (from > 0 ? '…' : '') + body + '…',
            snippetLong: prefix + (longFrom > 0 ? '…' : '') + longBody + '…',
          };
          break;
        }
        if (hit !== undefined) hits.push(hit);
      }
      return hits;
    }
    /* 0.1.114（G55 轨道序号）：行 → 节点编号「N/M」。当前会话按**轨道可见表**（railTurnList 区间查询，
       与隐藏/合并后的编号同源）即时求号；他会话 Phase 3 由扩展复算表接（此处暂 undefined）。
       取不到（无 seq / 未加载 / 表外）返回 undefined ⇒ 行内「—」。 */
    function messageSeqInCurrent(messageId) {
      if (typeof messageId !== 'string' || messageId === '') return undefined;
      const messages = state === undefined || state === null ? [] : (state.messages || []);
      for (const message of messages) {
        if (message !== undefined && message !== null && message.id === messageId) {
          return typeof message.seq === 'number' && Number.isFinite(message.seq) ? message.seq : undefined;
        }
      }
      return undefined;
    }
    /* 节点区间查询：最后一个起点 seq ≤ 目标 seq 的可见节点（隐藏段的区间归上一可见节点）。 */
    function railNodeIndexForSeq(seq) {
      if (typeof seq !== 'number' || !Number.isFinite(seq)) return -1;
      let hit = -1;
      for (let i = 0; i < railTurnList.length; i += 1) {
        const nodeSeq = railTurnSeqOf(railTurnList[i]);
        if (nodeSeq === undefined) continue;
        if (nodeSeq <= seq) hit = i;
        else break;
      }
      return hit;
    }
    /* 0.1.123（G55 Phase 3）：他会话可见节点表——扩展复算表（按当前粒度取 segment/turn）应用该会话
       railDropped（view-state 启动整包已在手）后重编号；缺表/形态异常返回 undefined（行显示「—」）。 */
    function foreignRailList(sessionId) {
      const tables = foreignNodeTables[sessionId];
      if (tables === undefined || tables === null) return undefined;
      const cfg = state === undefined || state === null ? undefined : state.turnRailSettings;
      const granularity = cfg !== undefined && cfg !== null && cfg.granularity === 'turn' ? 'turn' : 'segment';
      const list = granularity === 'turn' ? tables.turn : tables.segment;
      if (!Array.isArray(list)) return undefined;
      const dropped = viewMemoOf(sessionId).railDropped;
      if (dropped === undefined || dropped === null || dropped.size === 0) return list;
      return list.filter(entry => entry !== undefined && entry !== null && !dropped.has(entry.key));
    }
    /* 表区间查询（与 railNodeIndexForSeq 同规则）：最后一个 seq ≤ 目标的条目。 */
    function railNodeIndexOfList(list, seq) {
      if (typeof seq !== 'number' || !Number.isFinite(seq)) return -1;
      let hit = -1;
      for (let i = 0; i < list.length; i += 1) {
        const entry = list[i];
        if (entry === undefined || entry === null || typeof entry.seq !== 'number') continue;
        if (entry.seq <= seq) hit = i;
        else break;
      }
      return hit;
    }
    function nodeOrdinalOfRow(sessionId, messageId, seqHint) {
      const currentId = state === undefined || state === null ? '' : String(state.sessionId || '');
      const seq = typeof seqHint === 'number' && Number.isFinite(seqHint) ? seqHint : (sessionId === currentId ? messageSeqInCurrent(messageId) : undefined);
      if (sessionId === currentId) {
        const hit = railNodeIndexForSeq(seq);
        if (hit < 0) return undefined;
        return { num: hit + 1, total: railTurnList.length };
      }
      const list = foreignRailList(sessionId);
      if (list === undefined || list.length === 0) return undefined;
      const hit = railNodeIndexOfList(list, seq);
      if (hit < 0) return undefined;
      return { num: hit + 1, total: list.length };
    }
    /* 0.1.114（G55 Phase 2）：节点起点消息 id——段节点取元素/键内的消息 id（卡片锚点 = 留痕卡 id，
       与轨道点击落点一致）；全量表节点键不是消息 id，缺 mid 的前缀回落行跳。 */
    function nodeStartMidOf(turn) {
      if (turn === undefined || turn === null) return undefined;
      const el = turn.element;
      if (el !== undefined && el !== null && el.dataset !== undefined) {
        const mid = el.dataset.mid;
        if (typeof mid === 'string' && mid !== '') return mid;
      }
      if (Object.prototype.hasOwnProperty.call(turn, 'mid')) return typeof turn.mid === 'string' && turn.mid !== '' ? turn.mid : undefined;
      if (typeof turn.id === 'string' && turn.id !== '' && turn.id.indexOf('seq:') !== 0) {
        if (turn.id.indexOf('ws~:') === 0) return turn.id.slice(4);
        if (turn.id.indexOf('ws:') === 0) return turn.id.slice(3);
        return turn.id;
      }
      return undefined;
    }
    function nodeStartForRow(sessionId, messageId, seqHint) {
      const currentId = state === undefined || state === null ? '' : String(state.sessionId || '');
      const seq = typeof seqHint === 'number' && Number.isFinite(seqHint) ? seqHint : (sessionId === currentId ? messageSeqInCurrent(messageId) : undefined);
      if (sessionId === currentId) {
        const hit = railNodeIndexForSeq(seq);
        if (hit < 0) return undefined;
        const turn = railTurnList[hit], mid = nodeStartMidOf(turn);
        return mid === undefined ? undefined : { mid, seq: railTurnSeqOf(turn) };
      }
      /* 0.1.123（G55 Phase 3）：他会话——复算表按同一区间规则找节点；mid=null（窗口外前缀/无锚点）→ 回落行跳。 */
      const list = foreignRailList(sessionId);
      if (list === undefined || list.length === 0) return undefined;
      const hit = railNodeIndexOfList(list, seq);
      if (hit < 0) return undefined;
      const entry = list[hit];
      if (entry === undefined || entry === null || typeof entry.mid !== 'string' || entry.mid === '') return undefined;
      return { mid: entry.mid, seq: entry.seq };
    }
    /* 编号片跳转落点脉冲：按消息 seq 找当前轨道节点加 .pulse（一次性，1.1s 后移除）。
       0.1.123（Phase 3）：跨会话落地时**轨道尚未为新会话重建**（落地块先于渲染尾部）——
       改挂起重试：立即试一次，未就绪则留待 updateTurnRail（每次渲染到轨道处）补试（4s 上限）。
       守卫：state 与 renderedSessionId 必须**同为**脉冲消息所属会话——否则会命中旧会话清单里
       同 seq 的节点（G55 与 G55x 撞 seq 的探针实证：脉冲打旧节点即被清账、重试永不再来）。 */
    let railPulsePendingMid = '';
    let railPulsePendingSession = '';
    let railPulsePendingUntil = 0;
    const railPulseLog = [];   /* 诊断：最近 10 次尝试（cap 防无界）。 */
    function tryRailPulseNow() {
      if (railPulsePendingMid === '') return;
      const currentId = state === undefined || state === null ? '' : String(state.sessionId || '');
      const renderedId = String(renderedSessionId === undefined || renderedSessionId === null ? '' : renderedSessionId);
      const log = (note, idx) => { railPulseLog.push(note + ' mid=' + railPulsePendingMid + ' cur=' + currentId + ' ren=' + renderedId + ' idx=' + String(idx)); while (railPulseLog.length > 10) railPulseLog.shift(); };
      if (Date.now() > railPulsePendingUntil) { railPulsePendingMid = ''; log('expire', -2); return; }
      /* 精确守卫：**轨道清单自身的会话戳**必须等于脉冲会话（renderedSessionId 会在重建前先翻转——
         探针实证：脉冲打旧清单同 seq 节点即被清账）。 */
      if (railPulsePendingSession !== currentId || railListSessionId !== railPulsePendingSession) { log('guard', -1); return; }
      const idx = railNodeIndexForSeq(messageSeqInCurrent(railPulsePendingMid));
      const entry = idx < 0 ? undefined : railNodesBuilt[idx];
      if (entry === undefined) { log('noentry', idx); return; }
      railPulsePendingMid = '';
      const el = entry.el;
      el.classList.remove('pulse');
      void el.offsetWidth;
      el.classList.add('pulse');
      log('fired', idx);
      setTimeout(() => el.classList.remove('pulse'), 1100);
    }
    function pulseRailNodeForMessage(messageId, sessionId) {
      railPulsePendingMid = typeof messageId === 'string' ? messageId : '';
      railPulsePendingSession = typeof sessionId === 'string' ? sessionId : '';
      railPulsePendingUntil = Date.now() + 4000;
      tryRailPulseNow();
    }
    /* 0.0.169：当前会话命中（本地即时，先于运行时结果；点击直接跳消息）。
       0.0.170：本工作区索引命中（扩展侧）也可指定会话 + 消息 id——统一走这里。 */
    /* 0.1.114（G55 Phase 2）：pulse=true 时落点后脉冲对应轨道节点（编号片跳转专用；行走/回车不置）。 */
    function jumpToMessageHit(sessionId, messageId, query, occurrence, pulse, seqHint) {
      clearHistoryJump();
      vscode.postMessage({ type: 'cancel-history-navigation' });
      clearRestoreThroughTarget(); clearRestoreCtx();
      pendingRailJumpSeq = undefined; pendingRailJumpSession = undefined;
      railNavigationLocked = false; railNavigationSeq = undefined; railNavigationId = undefined;
      searchPanelCollapsed = true;
      elements.tabSearchResults.classList.add('hidden');
      /* 0.1.66：选中行交由"当前所处"在下次渲染时对齐（否则跳转前的旧选中行会劫持下一次 Enter）。 */
      searchActiveRow = -1;
      searchActiveKey = '';
      const target = typeof sessionId === 'string' && sessionId !== '' ? sessionId : (state === undefined ? '' : state.sessionId);
      /* 0.1.66：光标（第几处）随跳转登记；面板下一次渲染即显示"第 k/N 处"。
         0.1.95：光标带**会话**（复合键）——投影器 id 跨会话重号，只按 mid 找下一处会解析到他会话同号条目。 */
      searchCursor = { sessionId: target, mid: messageId, occurrence: typeof occurrence === 'number' && occurrence > 0 ? occurrence : 1 };
      /* 0.1.76（T3-6）→ 0.1.88：跨会话跳转 ⇒ 开票/续期「返回搜索起点」（目标锚搜索起点，不随跳转改写）。 */
      const jumpFrom = state === undefined || state === null ? '' : String(state.sessionId || '');
      if (jumpFrom !== '' && jumpFrom !== target) noteSearchReturnPillJump(jumpFrom);
      /* 0.1.97（真机反馈②的安抚项）：大会话（数千条）切回后首绘可能超过 8s ⇒ 待跳转静默超时、落点无高亮。
         放宽到 30s；期间每帧重试，一旦目标消息渲染出来即落位。 */
      pendingSearchJump = { messageId, query, sessionId: target, occurrence: searchCursor.occurrence, deadline: Date.now() + 30_000,
        ...(typeof seqHint === 'number' && Number.isFinite(seqHint) && seqHint > 0 ? { seq: seqHint } : {}), ...(pulse === true ? { pulse: true } : {}) };
      armSearchJumpPoll();   /* 0.1.102：具体待跳同样上轮询——填充完成的收尾帧不一定再推 state */
      if (state !== undefined && state.sessionId === target) tryPendingSearchJump();
      else vscode.postMessage({ type: 'select-session', sessionId: target });
    }
    function jumpToLocalHit(messageId, query, occurrence) {
      jumpToMessageHit(state === undefined ? '' : state.sessionId, messageId, query, occurrence);
    }
    /* 0.1.66（用户反馈①的延续）：Enter 逐处跳——同一消息内先走完它的 N 处，再进下一条结果，到头循环。
       返回 true 表示已发起跳转（调用方不再走"跳首条"的旧路径）。 */
    function stepSearchCursor(backward) {
      const order = walkOrder;
      if (order.length === 0) return false;
      const keyOf = entry => entry.sessionId + '~' + entry.messageId;
      /* 0.1.97：只把**面板里真实存在**的条目当落点（键集为空视作"面板未渲染过"，不设限）。 */
      const visible = entry => walkVisibleKeys.size === 0 || walkVisibleKeys.has(keyOf(entry));
      const firstVisible = direction => {
        if (direction >= 0) { for (const entry of order) if (visible(entry)) return entry; return undefined; }
        for (let i = order.length - 1; i >= 0; i -= 1) if (visible(order[i])) return order[i];
        return undefined;
      };
      const cursor = searchCursor;
      if (cursor === undefined) { const first = firstVisible(1); if (first === undefined) return false; jumpToHit(first, 1); return true; }
      const index = order.findIndex(hit => hit.sessionId === cursor.sessionId && hit.messageId === cursor.mid);
      if (index < 0) { const first = firstVisible(1); if (first === undefined) return false; jumpToHit(first, 1); return true; }
      const current = order[index];
      /* 同消息内逐处走：仅当该条目仍可见时生效（不可见的陈旧条目直接去找下一条可见的）。 */
      if (visible(current)) {
        const total = typeof current.total === 'number' && current.total > 0 ? current.total : 1;
        if (!backward && cursor.occurrence < total) { jumpToHit(current, cursor.occurrence + 1); return true; }
        if (backward && cursor.occurrence > 1) { jumpToHit(current, cursor.occurrence - 1); return true; }
      }
      /* 沿表前进/后退，跳过不可见条目，落到下一个可见条目（到头回绕）。 */
      for (let step = 1; step <= order.length; step += 1) {
        const nextIndex = backward ? ((index - step) % order.length + order.length) % order.length : (index + step) % order.length;
        const next = order[nextIndex];
        if (!visible(next)) continue;
        const nextTotal = typeof next.total === 'number' && next.total > 0 ? next.total : 1;
        const wrapped = backward ? nextIndex > index : nextIndex < index;
        if (backward && nextIndex > index) showToast('已回到最后一处');
        if (!backward && nextIndex < index) showToast('已回到第 1 处');
        /* 0.1.101（真机反馈①：绕回落点不是面板第一条、有时不落位不亮）：**回绕不做"按键即定格"**——
           走路时他会话的行只来自索引批（尾部窗口 + 每会话 12 条上限 + 可能指向未加载消息），
           与"落地后本地扫描出来的行"是两套行集 ⇒ 按键时的表首/表尾会把人带到错误位置
           （真机实证：绕回落点是索引批的 09-21 行，而面板首行是本地批的 09-19 行；索引行指向未加载
           消息时跳转永不落位 ⇒ 视觉停在会话底部、高亮不出现）。改为**延迟解析**：先记"回到该会话
           第一/最后一条**可跳行**"的意图，等落地会话渲染落定后按当时的 searchRowModel() 取行。 */
        /* 0.1.104（真机反馈②：Shift+Enter 走回原对话时落点在"大会话中间"）：**组边界跨越与回绕同病**——
           目标会话的行在"身处他会话"时只来自索引批（真机大会话只有 1 行 = 09-22 的中部消息），
           与落地后的本地批（52 行）不是一套 ⇒ 跨越组边界时同样**延迟到落地后按面板重解析**（该组第一/最后一条可跳行）。
           判据必须用"**恰为组边界**"（目标行是其会话组在走路方向上的首/末行）——不能用"目标会话≠当前会话"：
           手点会话后回到原表续走（目标行是组中间行）时那是**精确行**语义，延迟解析会把人带到组首/组尾（探针 C4 逮到）。
           回绕的 toast 语义不变（只在真回绕时提示）。 */
        const prevEntry = nextIndex > 0 ? order[nextIndex - 1] : undefined;
        const nextEntry = nextIndex < order.length - 1 ? order[nextIndex + 1] : undefined;
        const atGroupEdge = backward ? (nextIndex === order.length - 1 || (nextEntry !== undefined && nextEntry.sessionId !== next.sessionId))
          : (nextIndex === 0 || (prevEntry !== undefined && prevEntry.sessionId !== next.sessionId));
        searchTrace('step', { back: backward === true, len: order.length, i: nextIndex, to: String(next.messageId || ''), wrapped, edge: atGroupEdge });
        if (wrapped || atGroupEdge) { jumpToWrapEdge(next, backward); return true; }
        jumpToHit(next, backward ? nextTotal : 1);
        return true;
      }
      return false;
    }
    function jumpToHit(hit, occurrence) {
      jumpToMessageHit(hit.sessionId, hit.messageId, tabQuery.trim(), occurrence);
    }
    /* 0.1.101：回绕落点的**延迟解析**（见 stepSearchCursor 注释）——按键时只记意图（目标会话 +
       第一/最后），等目标会话成为当前且渲染落定（progressiveFill 结束、本地扫描完整）后，
       按那时的 searchRowModel() 取"该会话组里第一条/最后一条**已渲染**的可跳行"再跳——
       保证落点 = 用户落地后看到的面板行，且必然跳得动（有滚动 + 高亮）。
       超时（30s）回落到按键时的具体条目（旧行为：至少试一次）。 */
    function jumpToWrapEdge(entry, backward) {
      claimConversationScrollInput();
      const target = entry !== undefined && typeof entry.sessionId === 'string' && entry.sessionId !== ''
        ? entry.sessionId
        : (state === undefined || state === null ? '' : String(state.sessionId || ''));
      searchPanelCollapsed = true;
      elements.tabSearchResults.classList.add('hidden');
      searchActiveRow = -1;
      searchActiveKey = '';
      const jumpFrom = state === undefined || state === null ? '' : String(state.sessionId || '');
      if (jumpFrom !== '' && jumpFrom !== target) noteSearchReturnPillJump(jumpFrom);
      pendingSearchJump = {
        wrapEdge: backward === true ? 'last' : 'first', entry, sessionId: target,
        query: tabQuery.trim(), deadline: Date.now() + 30_000, armedAt: Date.now(),
      };
      searchTrace('wrap-arm', { session: String(target).slice(0, 20), entry: String(entry === undefined ? '' : entry.messageId || ''), back: backward === true });
      armSearchJumpPoll();
      if (state !== undefined && state.sessionId === target) tryPendingSearchJump();
      else vscode.postMessage({ type: 'select-session', sessionId: target });
    }
    /* 0.0.168：结果面板——内容命中列表（会话标题 + 片段）；点击跳会话并定位首个命中。
       0.0.169：分两段——「当前会话」本地子串命中（可跳）+ 运行时跨会话命中（他工作区标注不可打开）。
       0.1.94（用户拍板「先区域、再时间」）：改为**按会话分组**——同一会话的命中聚成一组，
       组内按「结果排序」排时间；组间 = 搜索起点会话第一 → 其余按"组内最新一条命中的时间"降序；
       回收站 / 子代理 / 其他工作区等**不可跳**的组殿后（同按时间降序）。 */
    /* 0.1.96（用户拍板「绝对短日期」）：结果行时间——今年内 MM-DD HH:mm；跨年 YYYY-MM-DD；
       无时间（运行时段条目）返回空串（不占位）。 */
    function searchTimeLabel(time) {
      if (typeof time !== 'number' || !isFinite(time) || time <= 0) return '';
      const date = new Date(time);
      const now = new Date();
      const pad = value => String(value).length >= 2 ? String(value) : '0' + String(value);
      const monthDay = pad(date.getMonth() + 1) + '-' + pad(date.getDate());
      if (date.getFullYear() !== now.getFullYear()) return String(date.getFullYear()) + '-' + monthDay;
      return monthDay + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    }
    function searchRowModel() {
      const query = tabQuery.trim();
      const queryLower = query.toLowerCase();
      const parsed = parseSearchQuery(query);
      const onlySession = searchScope === 'session';
      const orderRecent = searchResultOrder() === 'recent';
      const byTime = (a, b) => {
        const ta = typeof a.time === 'number' ? a.time : 0;
        const tb = typeof b.time === 'number' ? b.time : 0;
        return orderRecent ? tb - ta : ta - tb;
      };
      const localHits = localSessionHits(parsed.include, parsed.excludes).slice().sort(byTime);
      const indexHits = (searchHitsQuery === queryLower ? searchIndexHits : [])
        .filter(hit => !onlySession || (searchHistorySessionId === state?.sessionId && hit.sessionId === searchHistorySessionId && hit.trashed !== true)).slice().sort(byTime);
      const foreignHits = onlySession ? [] : (searchHitsQuery === queryLower ? searchHits : []);
      const origin = searchOriginSession();
      const currentId = state === undefined || state === null ? '' : String(state.sessionId || '');
      const sessionTitle = (sessionId, fallback) => {
        const summary = ((state && state.sessions) || []).find(s => s.id === sessionId);
        return summary === undefined ? fallback : tabTitleOf(summary);
      };
      const currentTitle = sessionTitle(currentId, '当前会话');
      /* S-2：命中消息的**折叠态标注**——只在当前会话可判定（他会话数据不在手，标"未知"反而噪声）。 */
      const foldBadgeOf = (sessionId, messageId) => {
        if (state === undefined || state === null || sessionId !== state.sessionId) return undefined;
        const rec = renderedMessages.get(messageId);
        if (rec === undefined) {
          const known = (state.messages || []).some(message => message !== undefined && message !== null && message.id === messageId);
          return known ? '未渲染' : '未加载';
        }
        return rec.node !== undefined && rec.node !== null && rec.node.hidden === true ? '折叠中' : undefined;
      };
      const groups = new Map();
      const groupOf = (sessionId, options) => {
        let group = groups.get(sessionId);
        if (group === undefined) {
          group = { sessionId, title: options.title, tag: options.tag, tagClass: options.tagClass, walkable: options.walkable === true, maxTime: 0, rows: [], seen: new Set() };
          groups.set(sessionId, group);
        }
        return group;
      };
      const pushRow = (group, row) => {
        if (row.messageId !== '' && group.seen.has(row.messageId)) return;
        if (row.messageId !== '') group.seen.add(row.messageId);
        const time = typeof row.time === 'number' ? row.time : 0;
        if (time > group.maxTime) group.maxTime = time;
        group.rows.push(row);
      };
      /* ① 本地即时扫描（人所在的会话）。标签口径锚"搜索起点"（0.1.90）。 */
      for (const hit of localHits) {
        const isOrigin = currentId === origin;
        const group = groupOf(currentId, {
          title: currentTitle, tag: isOrigin ? '当前会话' : '其他会话', tagClass: isOrigin ? 'tag-current' : 'tag-other', walkable: true,
        });
        pushRow(group, {
          messageId: hit.messageId, sessionId: currentId, snippet: hit.snippet, snippetLong: hit.snippetLong,
          total: hit.total, time: hit.time, badge: foldBadgeOf(currentId, hit.messageId), jumpable: true,
          onClick: () => jumpToLocalHit(hit.messageId, query, 1),
        });
      }
      /* ② 本工作区索引（与①同会话去重；回收站组不可跳）。
         子代理/他区条目在**运行时批次**（③）里单独标注——这里防御性跳过（生产链路上本地索引不覆盖它们）。 */
      const includeTools = searchIncludeTools();
      for (const hit of indexHits) {
        if (hit.subagent === true || hit.foreign === true) continue;
        /* 0.1.96（用户拍板）：工具卡内容默认不展示（条目仍建索引——打开开关即恢复，无需重建索引）。 */
        if (hit.kind === '工具' && !includeTools) continue;
        const trashed = hit.trashed === true;
        const isOrigin = hit.sessionId === origin;
        const group = groupOf(hit.sessionId, {
          title: hit.title !== '' ? hit.title : sessionTitle(hit.sessionId, hit.sessionId),
          tag: trashed ? '回收站' : (isOrigin ? '当前会话' : '其他会话'),
          tagClass: trashed ? 'tag-trash' : (isOrigin ? 'tag-current' : 'tag-other'),
          walkable: !trashed,
        });
        pushRow(group, {
          messageId: hit.messageId, sessionId: hit.sessionId, snippet: hit.snippet, snippetLong: hit.snippetLong,
          total: hit.total, time: hit.time, badge: foldBadgeOf(hit.sessionId, hit.messageId), jumpable: !trashed,
          /* 0.1.123（G55 Phase 3）：条目 seq 透传——编号片换算（他会话经复算表；当前会话未加载行也受益）。 */
          ...(typeof hit.seq === 'number' && Number.isFinite(hit.seq) ? { seq: hit.seq } : {}),
          onClick: () => {
            if (trashed) {
              showToast('该会话在回收站中（恢复后即可打开并跳转）', true);
              return;
            }
            jumpToMessageHit(hit.sessionId, hit.messageId, query, 1, false, hit.seq);
          },
        });
      }
      /* ③ 运行时：子代理 / 其他工作区——各自成组，不可跳。 */
      for (const hit of foreignHits) {
        const subagent = hit.subagent === true;
        const group = groupOf(hit.sessionId, {
          title: hit.title !== '' ? hit.title : sessionTitle(hit.sessionId, hit.sessionId),
          tag: subagent ? '子代理' : '其他工作区', tagClass: subagent ? 'tag-subagent' : 'tag-foreign', walkable: false,
        });
        pushRow(group, {
          messageId: '', sessionId: hit.sessionId, snippet: hit.snippet, snippetLong: hit.snippetLong, total: 1, time: 0, jumpable: false,
          onClick: () => {
            if (subagent) { jumpToSessionHit(hit.sessionId, query); return; }
            showToast('该会话属于其他工作区，本侧栏无法打开（可在官方 Web UI 打开该目录查看）', true);
          },
        });
      }
      const ordered = [...groups.values()];
      /* 0.1.103（用户需求）：组序可选——'recent'（默认）按组内最新命中时间降序；'panel' 按会话栏先后。
         起点会话永远第一（标签口径与走路语义同源）。 */
      const panelRank = new Map();
      for (const [index, item] of (((state && state.sessions) || [])).entries()) panelRank.set(item.id, index);
      const groupOrderMode = searchGroupOrder();
      ordered.sort((a, b) => {
        const rankA = a.walkable ? 0 : 1;
        const rankB = b.walkable ? 0 : 1;
        if (rankA !== rankB) return rankA - rankB;
        const originA = a.sessionId === origin ? 1 : 0;
        const originB = b.sessionId === origin ? 1 : 0;
        if (originA !== originB) return originB - originA;
        if (groupOrderMode === 'panel') {
          const pa = panelRank.has(a.sessionId) ? panelRank.get(a.sessionId) : Number.MAX_SAFE_INTEGER;
          const pb = panelRank.has(b.sessionId) ? panelRank.get(b.sessionId) : Number.MAX_SAFE_INTEGER;
          if (pa !== pb) return pa - pb;
        }
        return b.maxTime - a.maxTime;
      });
      let rowCount = 0;
      for (const group of ordered) rowCount += group.rows.length;
      return { groups: ordered, rowCount };
    }
    /* 0.1.94：走路表与渲染**解耦**（本轮根因修复）——由模型数据合并而来、不依赖面板是否展开；
       面板收起期间到达的索引结果同样入表（旧实现挂在渲染里 ⇒ 纯键盘流永远走不到索引命中）。
       合并规则：已建立的条目保持相对次序；新条目**并入其所属会话组**（插在该组已知条目之后）；
       全新会话组按模型次序追加到表尾。换词整表重来（与"换词复位光标"同源）。 */
    function syncWalkOrderFromModel(model) {
      /* 换词**或换范围**（本工作区/当前会话）⇒ 整表重来（范围改变命中集合本身）。 */
      const queryKey = tabQuery.trim().toLowerCase() + '::' + searchScope;
      if (queryKey === '') { walkOrder = []; walkOrderQuery = ''; return; }
      const desired = [];
      for (const group of model.groups) {
        for (const row of group.rows) {
          if (row.jumpable === true && typeof row.messageId === 'string' && row.messageId !== '') {
            desired.push({ sessionId: row.sessionId, messageId: row.messageId, total: typeof row.total === 'number' ? row.total : 1 });
          }
        }
      }
      const keyOf = entry => entry.sessionId + '~' + entry.messageId;
      /* 0.1.101：0.1.97 引入的"只落面板真实存在的条目"判据在 0.1.99 换表后**退化成了恒真**
         （键集与走路表同源）——未加载的消息行照样会被步进选中 ⇒ 跳转永不落位。这里做成真判据：
         **本会话**条目必须已渲染（未加载/未补建的行跳不过去）；他会话条目无从判定（数据不在手），
         保持放行——真落下去还有"回绕延迟解析"与超时兜底。 */
      const walkCurrentId = state === undefined || state === null ? '' : String(state.sessionId || '');
      walkVisibleKeys = new Set(desired.filter(entry => entry.sessionId !== walkCurrentId || renderedMessages.has(entry.messageId)).map(keyOf));
      /* 0.1.99（真机反馈：绕回落点不是"面板第一条"——用户用「时间正序」时尤其明显）：
         走路表 = **面板当前模型顺序**（所见即所走）。旧实现用"只增并集"的**累积顺序**（历次扫描追加的顺序），
         与面板显示顺序（受「结果排序」影响：最近优先=新→旧 / 时间正序=旧→新）不一致
         ⇒ 绕回落到"表首"（= 首次扫描时的第一条），却与面板首行对不上。
         面板分组与组序本身是稳定且与"人所处会话"无关的（0.1.94 语义），故直接整表跟随即可。 */
      walkOrder = desired;
      walkOrderQuery = queryKey;
    }
    /* 面板收起/结果晚到/会话落地时也要入表：搜索结果回包与 render 会话来帧走这里。 */
    function syncSearchWalkOrder() {
      if (tabQuery.trim() === '') { walkOrder = []; walkOrderQuery = ''; walkOrderSessionId = ''; return; }
      syncWalkOrderFromModel(searchRowModel());
      walkOrderSessionId = state === undefined || state === null ? '' : String(state.sessionId || '');
    }
    function renderSearchResults() {
      const panel = elements.tabSearchResults;
      const query = tabQuery.trim();
      /* 0.1.76（T3-4）：空查询时展示「最近搜索」（此前一律隐藏面板）。 */
      if (!tabSearchOpen() || searchPanelCollapsed) { panel.classList.add('hidden'); return; }
      if (query === '') {
        if (searchHistory.length === 0) { panel.classList.add('hidden'); return; }
        panel.replaceChildren();
        const historyScroller = node('div', 'tab-search-hits');
        historyScroller.id = 'tabSearchHits';
        const historyLayer = node('div', 'tab-search-peek-layer');
        historyLayer.id = 'tabSearchPeekLayer';
        panel.append(historyScroller, historyLayer);
        renderSearchHistory(historyScroller);
        panel.classList.remove('hidden');
        return;
      }
      const notes = [];
      if (searchLoading && searchScope !== 'session') notes.push(searchLocalReady ? '本工作区检索完成，正在检索其他工作区和子代理；已有结果可直接使用。首次检索可能需要较长时间。' : '正在检索本工作区会话内容…');
      else if (searchNotes !== '') notes.push(searchNotes);
      /* 0.1.94（用户拍板「先区域、再时间」）：分组模型 + 走路表（数据驱动；面板收起时也维护，见 syncSearchWalkOrder）。 */
      const model = searchRowModel();
      syncWalkOrderFromModel(model);
      walkOrderSessionId = state === undefined || state === null ? '' : String(state.sessionId || '');
      let rowIndex = 0;
      const appendRow = (group, options) => {
        const row = node('button', 'tab-search-hit');
        row.type = 'button';
        /* 0.1.94：会话标题/标签上移到**组头**（同一会话只出现一次）；行内保留折叠标 / 计数 / 视野中标。
           0.1.96（用户拍板）：行内元信息行**恒在**（徽标在左、时间在右、空着也占位）⇒ 结果行等高；
           时间 = 该消息时间（绝对短日期；运行时段条目无时间则不显示）。 */
        const title = node('span', 'tab-search-hit-title');
        if (options.badge !== undefined) title.append(node('span', 'tab-search-fold', options.badge));
        /* 0.1.114（G55 轨道序号）：节点编号片「N/M」——恒在（行高不变）、数据不可用「—」；
           title 与相邻「共 N 处」消歧；点编号片=跳该节点起点+脉冲。
           0.1.122：可整体关闭（search.nodeChip 设置，默认开）；文案随「编号文案档位」。 */
        if (searchNodeChipEnabled()) {
          const ordinal = nodeOrdinalOfRow(group.sessionId, options.messageId, options.seq);
          const chip = node('button', 'tab-search-node-chip' + (ordinal === undefined ? ' empty' : ''));
          chip.type = 'button';
          chip.dataset.node = ordinal === undefined ? '' : String(ordinal.num);
          if (ordinal !== undefined) {
            chip.textContent = railOrdinalText(ordinal.num, ordinal.total);
            chip.title = '第 ' + String(ordinal.num) + '/' + String(ordinal.total) + ' 个节点 · 点击跳到该段开头';
            /* 0.1.114（G55 Phase 2）：点编号片 = 跳该节点起点（复用消息跳转通道；落点后轨道节点脉冲）。
               前缀节点未加载（无起点消息 id）→ 回落整行跳（跳这条消息本身）。 */
            chip.addEventListener('click', (event) => {
              event.stopPropagation();
              flushSearchHistory();
              const start = nodeStartForRow(group.sessionId, options.messageId, options.seq);
              /* 0.1.123：起点不可达（未加载前缀 / 复算表缺 mid）→ 明确回落行跳并提示，不静默。 */
              if (start === undefined) { showToast('该节点起点暂不可达，改为定位本条消息'); options.onClick(); return; }
              jumpToMessageHit(group.sessionId, start.mid, query, 1, true, start.seq);
            });
          } else {
            chip.textContent = '—';
            chip.title = '该行暂无节点编号（未加载或数据不可用）';
            chip.disabled = true;
          }
          title.append(chip);
        }
        /* T3-3 / 0.1.66：当前所处那条显示"第 k/N 处"（走路标），其余多命中条目仍显示"共 N 处"（1 处是噪声）。
           0.1.95：与光标同口径按**会话+消息**匹配（id 跨会话重号，只比 mid 会标错行）。 */
        const total = options.total;
        const isCursor = searchCursor !== undefined && searchCursor.sessionId === group.sessionId && searchCursor.mid === options.messageId;
        if (isCursor && typeof total === 'number' && total > 1) title.append(node('span', 'tab-search-hit-count', '第 ' + String(searchCursor.occurrence) + '/' + String(total) + ' 处'));
        else if (typeof total === 'number' && total > 1) title.append(node('span', 'tab-search-hit-count', '共 ' + String(total) + ' 处'));
        /* 0.1.66：滚动联动——当前落在视口里的那条打"视野中"标（0.1.95：同样限本会话，防跨会话同号误标）。 */
        if (searchVisibleMid !== '' && searchVisibleMid === options.messageId && group.sessionId === (state === undefined || state === null ? '' : String(state.sessionId || ''))) {
          title.append(node('span', 'tab-search-inview', '视野中'));
          row.classList.add('tab-search-hit-inview');
        }
        /* 0.1.71/0.1.72：行内截断 2 行；长片段由覆盖层/底部详情区展示。
           0.1.99（用户反馈"悬停能看很多、行里只有一行内容"）：行内文本改用**长片段**（命中前后 120/240 字），
           截断到 2 行后能填满——此前用短片段（前 16/后 30 字）常只占一行。 */
        const timeLabel = searchTimeLabel(options.time);
        if (timeLabel !== '') title.append(node('span', 'tab-search-hit-time', timeLabel));
        const longSnippet = options.snippetLong !== undefined ? options.snippetLong : options.snippet;
        const shortSnippet = longSnippet !== undefined && longSnippet !== '' ? longSnippet : options.snippet;
        row.append(title);
        row.append(snippetRow(shortSnippet, query));
        if (typeof options.messageId === 'string' && options.messageId !== '' && longSnippet !== '') {
          /* 0.1.73：长片段只记表——覆盖层是**共享的一层**（面板直属、不吃指针、可越出面板下边界）。
             0.1.100：行内已改显示长片段（0.1.99）⇒ 不能再按"两片段不相等"登记，否则覆盖层为空（L2 g114 逮到）。 */
          searchLongSnippets.set(options.messageId, longSnippet);
        }
        /* 0.1.65：行上带目标消息 id（键盘导航/探针判定"跳的是不是选中那条"；他区行不可打开故不带）。
           0.1.95：同时带所属会话（行定位一律走**会话+消息**复合键）。 */
        if (typeof options.messageId === 'string' && options.messageId !== '') row.dataset.mid = options.messageId;
        row.dataset.session = group.sessionId;
        /* 0.1.95：行上记"共几处"——滚动同步（syncSearchSelectionToInView）改光标后就地刷新徽标，
           否则"第 k/N 处"要等下一次整面板重渲染才更新（真机反馈④）。 */
        row.dataset.total = String(typeof total === 'number' && total > 0 ? total : 1);
        const mine = rowIndex;
        rowIndex += 1;
        rowKeys.push(typeof options.messageId === 'string' && options.messageId !== '' ? group.sessionId + '~' + options.messageId : '');
        /* 0.1.94（修陈旧选中行）：选中行**按消息跟踪**（渲染末尾统一解析）、走路表由**数据**维护
           （syncWalkOrderFromModel）——两者都不再挂在"本轮渲染的行序"上。 */
        row.addEventListener('click', (event) => {
          event.stopPropagation();
          if (typeof options.messageId === 'string' && options.messageId !== '') { searchActiveRow = mine; searchActiveKey = group.sessionId + '~' + options.messageId; }
          /* 0.1.80：点结果行 = 提交点（E 方案）——立即把当前词落进历史。 */
          flushSearchHistory();
          options.onClick();
        });
        scroller.append(row);
      };
      panel.replaceChildren();
      /* 0.1.73：滚动容器与**覆盖层**分层——覆盖层不在滚动区里，因此不受面板裁剪、可突破下边界。 */
      const scroller = node('div', 'tab-search-hits');
      scroller.id = 'tabSearchHits';
      const peekLayer = node('div', 'tab-search-peek-layer');
      peekLayer.id = 'tabSearchPeekLayer';
      panel.append(scroller, peekLayer);
      searchLongSnippets = new Map();
      const rowKeys = [];
      /* 0.1.94（用户拍板「先区域、再时间」）：按会话分组渲染——组头（标题 + 标签 + 条数）+ 该组命中行。
         组序见 searchRowModel：搜索起点会话第一 → 其余按组内最新命中时间降序（不可跳组殿后）。 */
      for (const group of model.groups) {
        const head = node('div', 'tab-search-group');
        head.append(node('span', 'tab-search-group-label', group.title));
        head.append(node('span', 'tab-search-tag ' + group.tagClass, group.tag));
        head.append(node('span', 'tab-search-group-count', String(group.rows.length) + ' 条'));
        scroller.append(head);
        for (const row of group.rows) appendRow(group, row);
      }
      const shownHits = scroller.querySelectorAll('.tab-search-hit').length;
      /* S-4（2026-09-25 搜索打磨）→ 0.1.94：**段头计数**随分组口径改写——条数与会话数一眼可见。
         子代理/他区条数从**分组模型**反推（本函数不再直接持有 foreignHits）。 */
      let subagentCount = 0;
      let foreignCount = 0;
      for (const group of model.groups) {
        if (group.tagClass === 'tag-subagent') subagentCount += group.rows.length;
        else if (group.tagClass === 'tag-foreign') foreignCount += group.rows.length;
      }
      {
        const head = node('div', 'tab-search-note tab-search-count');
        head.append(searchScopeSwitch());
        head.append(node('span', 'tab-search-note-text', shownHits === 0 ? '检索范围' : '共 ' + String(shownHits) + ' 条 · ' + String(model.groups.length) + ' 个会话'
          + (subagentCount > 0 ? ' · 子代理 ' + String(subagentCount) : '')
          + (foreignCount > 0 ? ' · 其他工作区 ' + String(foreignCount) : '')));
        scroller.prepend(head);
      }
      if (shownHits === 0 && !searchLoading) {
        notes.push('无命中（标签仍按标题过滤）');
      } else if (!searchLoading && shownHits > 0) {
        notes.push('共 ' + String(shownHits) + ' 条' + (searchHasMore ? '（跨工作区仅显示前 20 条）' : '')
          + (subagentCount > 0 ? '，其中 ' + String(subagentCount) + ' 条在子代理会话（可点击打开）' : '')
          + (foreignCount > 0 ? '，' + String(foreignCount) + ' 条在其他工作区（本侧栏不可打开）' : '')
          + (subagentCount + foreignCount === 0 ? ' —— 点击跳转并定位' : ''));
      }
      for (const note of notes) scroller.append(node('div', 'tab-search-note', note));
      /* 0.1.65（T3-7）：**上限与新鲜度脚注**（常驻）——解释"为什么有些内容搜不到"，并显示索引规模/构建态。 */
      const stats = searchIndexStats;
      if (searchScope === 'session') {
        const active = searchHistorySessionId !== '' && searchHistorySessionId === state?.sessionId;
        const scanning = active && searchLoading;
        const complete = active && stats?.fulltextComplete === true;
        const note = scanning ? '正在补查本会话更早内容；换词、切会话或关闭搜索可停止。'
          : complete ? '本会话已查到历史开头（含超长正文）；命中数量仍受显示上限限制。'
          : active ? (stats?.fulltextFailed > 0 ? '本会话正文补查失败，保留已有命中；可重试。' : '会话内容已变化，全文覆盖待重新确认；可重新查找。')
          : '当前会话搜索已加载内容，可按需查找本会话更早内容。';
        scroller.append(node('div', 'tab-search-note tab-search-foot', note));
        const button = node('button', 'tab-search-scope-btn tab-search-history-btn', scanning ? '补查中…' : complete ? '重新查找本会话更早内容' : '查找本会话更早内容');
        button.type = 'button';
        button.disabled = scanning || !state?.sessionId || parseSearchQuery(tabQuery).include === '';
        button.addEventListener('click', event => { event.stopPropagation(); requestSessionHistorySearch(); });
        scroller.append(button);
      } else {
        if (stats === undefined || stats === null) scroller.append(node('div', 'tab-search-note tab-search-foot', '索引构建中…'));
        else {
          scroller.append(node('div', 'tab-search-note tab-search-foot',
            '缓存 ' + String(stats.sessions) + ' 会话 / ' + String(stats.entries) + ' 条'
            + ' · 每条前 ' + String(stats.textMax) + ' 字符 · 每会话上限 ' + String(stats.entriesMax) + ' 条 · 命中上限 ' + String(stats.hitsMax) + ' 条'
            + (typeof stats.sessionHitsMax === 'number' ? '（每会话 ' + String(stats.sessionHitsMax) + ' 条）' : '')
            + (stats.building === true ? ' · 索引构建中…' : '')));
        }
        const fulltextNote = stats && stats.fulltextScanning === true
          ? '正在补查较早正文… ' + String(stats.fulltextScanned || 0) + '/' + String(stats.fulltextSessions || 0) + ' 个会话；换词或关闭搜索可停止。'
          : stats && stats.fulltextComplete === true
            ? '本工作区普通会话已查到历史开头（含超长正文）；回收站使用保留缓存。'
            : stats && stats.fulltextFailed > 0
              ? String(stats.fulltextFailed) + ' 个会话正文补查失败，保留缓存命中；可重试。'
              : '较早正文按查询补查；命中数量仍受显示上限限制。';
        scroller.append(node('div', 'tab-search-note tab-search-foot', fulltextNote));
      }
      /* 0.1.72（用户拍板）：pane 模式——面板底部常驻详情区（sticky 底，不参与列表重排）。 */
      if (searchSnippetView() === 'pane') {
        const pane = node('div', 'tab-search-peek-pane hidden');
        pane.id = 'tabSearchPeekPane';
        scroller.append(pane);
      }

      /* 0.1.94（修陈旧选中行）：选中行**按消息解析**——优先走路光标那条，其次用户 ↑/↓ 选中的那条；
         两者都不在本轮面板里 ⇒ 清空（旧实现按序号残留 ⇒ 会标中一条"从未选过"的行并劫持 Enter）。
         0.1.95：一律用**会话+消息复合键**（id 跨会话重号）。 */
      let activeIndex = -1;
      if (searchCursor !== undefined && typeof searchCursor.mid === 'string' && searchCursor.mid !== '') activeIndex = rowKeys.indexOf(searchCursor.sessionId + '~' + searchCursor.mid);
      if (activeIndex < 0 && searchActiveKey !== '') activeIndex = rowKeys.indexOf(searchActiveKey);
      searchActiveRow = activeIndex;
      if (activeIndex < 0) searchActiveKey = '';
      else {
        const activeRows = panel.querySelectorAll('.tab-search-hit');
        if (activeRows[activeIndex] !== undefined) activeRows[activeIndex].classList.add('tab-search-hit-active');
      }
      /* 0.1.66：滚动联动——观察命中消息节点（进出视口才回调，不做逐帧量位置）。 */
      syncSearchVisibilityObserver();
      updateSearchPeekPane();
      /* 0.1.74（用户反馈①）：**渲染后不自动弹预览**——只在真悬停或 ↑/↓ 主动导航时浮出 */
      hideSearchPeek();
      panel.classList.remove('hidden');
    }
    /* 0.1.66（用户"闭环"设想）：把结果面板与**当前视口**对上——滚到某条命中所在的屏幕范围，
       面板里那一条打"视野中"标（并把面板滚到它）。用 IntersectionObserver：只在进出视口时回调，
       成本远低于滚动中逐帧量 rect（性能线踩过这个坑）。多条第同时可见取**结果顺序里第一条**。 */
    function searchVisibleTargets() {
      const targets = [];
      for (const hit of walkOrder) {
        if (state === undefined || state === null || hit.sessionId !== state.sessionId) continue;
        const rec = renderedMessages.get(hit.messageId);
        const el = rec === undefined ? undefined : rec.node;
        if (el !== undefined && el !== null && el.isConnected === true) targets.push({ mid: hit.messageId, el });
      }
      return targets;
    }
    /* 0.1.68（用户反馈①）：把"选中行 + 逐处跳光标"对齐到当前视野里的那条命中（所见即所处）。
       0.1.95：按**会话+消息**定位（id 跨会话重号 ⇒ 只比 mid 会标到他会话同号行）。 */
    function syncSearchSelectionToInView(sessionId, mid) {
      if (mid === '') return;
      const rows = elements.tabSearchResults.querySelectorAll('.tab-search-hit');
      let index = -1;
      rows.forEach((row, i) => { if (index < 0 && String(row.dataset.session || '') === sessionId && row.dataset.mid === mid) index = i; });
      if (index < 0) return;
      searchActiveRow = index;
      searchActiveKey = sessionId + '~' + mid;
      if (searchCursor === undefined || searchCursor.sessionId !== sessionId || searchCursor.mid !== mid) searchCursor = { sessionId, mid, occurrence: 1 };
      rows.forEach((row, i) => row.classList.toggle('tab-search-hit-active', i === index));
      refreshCursorBadges();
    }
    /* 0.1.95（真机反馈④"第 n/m 处不更新"）：滚动同步改光标后**就地刷新徽标文案**——
       旧写法徽标只在整面板重渲染时按光标渲染 ⇒ 滚动到新一条命中后仍显示旧的"共 N 处"。 */
    function refreshCursorBadges() {
      const rows = elements.tabSearchResults.querySelectorAll('.tab-search-hit');
      for (const row of rows) {
        const holder = row.querySelector('.tab-search-hit-title');
        if (holder === null) continue;
        const existing = holder.querySelector('.tab-search-hit-count');
        const total = Number(row.dataset.total === undefined ? '0' : row.dataset.total);
        const isCursor = searchCursor !== undefined
          && searchCursor.sessionId === String(row.dataset.session || '')
          && searchCursor.mid === String(row.dataset.mid || '');
        let text = '';
        if (isCursor && total > 1) text = '第 ' + String(searchCursor.occurrence) + '/' + String(total) + ' 处';
        else if (total > 1) text = '共 ' + String(total) + ' 处';
        if (text === '') { if (existing !== null) existing.remove(); continue; }
        if (existing === null) holder.append(node('span', 'tab-search-hit-count', text));
        else if (existing.textContent !== text) existing.textContent = text;
      }
    }
    /* 0.1.74：面板的滚动容器是内层 .tab-search-hits（0.1.73 起面板本身 overflow:visible 不再滚动）
        —— 之前 markSearchRowInView 还在写 panel.scrollTop ⇒ 等于没滚（真回归，本轮修）。 */
    function searchHitsScroller() {
      return document.getElementById('tabSearchHits') || elements.tabSearchResults;
    }
    let searchPanelScrollStamp = 0;
    let searchPanelUserScrolled = false;
    /* 把某一行**居中**在面板里（用户反馈②：重开面板时不要把视野中那条留在顶上）。 */
    function centerSearchPanelOn(row) {
      const scroller = searchHitsScroller();
      if (row === null || row === undefined) return;
      const target = row.offsetTop - (scroller.clientHeight - row.offsetHeight) / 2;
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      searchPanelScrollStamp = performance.now();
      scroller.scrollTop = Math.max(0, Math.min(max, Math.round(target)));
    }
    /* 重开面板（点击搜索框）时把「视野中」那条居中。 */
    function centerSearchPanelOnInView() {
      const mid = searchVisibleMid !== '' ? searchVisibleMid : (() => { const active = elements.tabSearchResults.querySelector('.tab-search-hit-active'); return active === null ? '' : String(active.dataset.mid || ''); })();
      if (mid === '') return;
      const rows = elements.tabSearchResults.querySelectorAll('.tab-search-hit');
      for (const row of rows) { if (String(row.dataset.mid || '') === mid) { centerSearchPanelOn(row); return; } }
    }
    function markSearchRowInView() {
      const rows = elements.tabSearchResults.querySelectorAll('.tab-search-hit');
      const currentSession = state === undefined || state === null ? '' : String(state.sessionId || '');
      for (const row of rows) {
        /* 0.1.95：限**本会话**行（id 跨会话重号 ⇒ 只比 mid 会给他会话同号行也打标）。 */
        const hit = row.dataset.mid === searchVisibleMid && searchVisibleMid !== '' && String(row.dataset.session || '') === currentSession;
        /* 0.1.96：元信息行恒在（行等高）——holder 必定存在，保留空守卫兜底。 */
        const holder = row.querySelector('.tab-search-hit-title');
        const existing = row.querySelector('.tab-search-inview');
        if (hit && existing === null && holder !== null) holder.append(node('span', 'tab-search-inview', '视野中'));
        else if (!hit && existing !== null) existing.remove();
        row.classList.toggle('tab-search-hit-inview', hit);
      }
      if (searchVisibleMid === '') return;
      for (const row of rows) {
        if (row.dataset.mid !== searchVisibleMid || String(row.dataset.session || '') !== currentSession) continue;
        /* 0.1.74：滚**内层滚动容器**（面板不滚了）；只在"用户还没手动滚过面板"时跟随居中，
           免得把用户自己翻到的地方抢走。 */
        if (!searchPanelUserScrolled) centerSearchPanelOn(row);
        return;
      }
    }
    function syncSearchVisibilityObserver() {
      const targets = searchVisibleTargets();
      const key = targets.map(target => target.mid).join('|');
      /* 0.1.70（审核）：**key 之外还要比节点身份**——整树重渲会换掉消息节点但 mid 不变，
         只比 mid 会一直观察"已脱钩的旧节点" ⇒ 进出视口不再回调 ⇒「视野中」标与呼吸计时静默失效。 */
      const sameNodes = targets.length === searchObservedNodes.length && targets.every((target, index) => target.el === searchObservedNodes[index]);
      if (key === searchObservedKey && sameNodes) return;
      searchObservedKey = key;
      searchObservedNodes = targets.map(target => target.el);
      if (searchObserver !== undefined) { searchObserver.disconnect(); searchObserver = undefined; }
      searchVisibleMids = new Set();
      if (searchVisibleMid !== '' && key.indexOf(searchVisibleMid) < 0) { searchVisibleMid = ''; }
      if (targets.length === 0 || typeof window.IntersectionObserver !== 'function') return;
      const order = targets.map(target => target.mid);
      searchObserver = new window.IntersectionObserver(entries => {
        for (const entry of entries) {
          const mid = entry.target.dataset === undefined ? '' : String(entry.target.dataset.mid || '');
          if (mid === '') continue;
          if (entry.isIntersecting === true) {
            searchVisibleMids.add(mid);
            /* 0.1.68：本命中**进入视野**即开呼吸计时（「呼吸后常亮」按条计时；「一直呼吸」不看这个）。 */
            if (!searchSeenAt.has(mid)) searchSeenAt.set(mid, performance.now());
          } else {
            searchVisibleMids.delete(mid);
            /* 0.1.69（用户反馈）：**离开视野即撤计时** ⇒ 再滚回来会重新呼吸（此前只认第一次）。
               0.1.105：光标那条不撤——跨会话落点后观察器重建/布局抖动会给落点补发一次"离场"，
               撤了计时就等于把刚起的呼吸掐掉（真机"闪一下就不呼吸"）。光标离场语义上=用户滚走，
               届时选中/光标本身已跟随视野移走，不会长期滞留。 */
            const keepCursor = searchCursor !== undefined && searchCursor.mid === mid;
            if (!keepCursor) searchSeenAt.delete(mid);
          }
        }
        /* 0.1.70（审核）：**视野变化时若 rAF 表已停就重新起表**。停表有两处：
           ①「呼吸后常亮」全部落定；②「一直呼吸」下某一帧恰好"视野内一条都没有"——
           旧实现只在 ① 重起，于是 ② 之后新进入视野的永远不再呼吸
           （真机探针逮到：面板标着「视野中」却一直常亮、不再呼吸）。 */
        if (searchPulseRaf === undefined && searchPaintScopes.length > 0 && searchVisibleMids.size > 0) {
          const look = searchHighlightLook();
          if (look.mode !== 'steady') startSearchHighlightPulse(look);
        }
        /* 0.1.103：**光标优先于"顺序首个可见"**——光标那条仍在视野里就不改选中/徽标。
           真机（最近优先）：落点下方紧邻的更新命中常与落点同屏，旧口径把选中从落点偷到它身上
           ⇒ 面板选中行跳走（"定位不准/跳转到中间"），下一次 Enter 又从被偷的条目续走（走位发飘）。
           光标离屏（= 用户滚去别处）才回落到"顺序首个可见"的老口径。 */
        const hereSession = state === undefined || state === null ? '' : String(state.sessionId || '');
        const cursorHere = searchCursor !== undefined && searchCursor.sessionId === hereSession && searchCursor.mid !== '' && searchVisibleMids.has(searchCursor.mid);
        let first = '';
        if (cursorHere) first = searchCursor.mid;
        else for (const mid of order) { if (searchVisibleMids.has(mid)) { first = mid; break; } }
        /* 0.1.95（真机反馈①）：**落点稳定窗口期间整块让位**——旧写法只挡"选中跟随"、不挡"视野中标"，
           跳转自己的程序化滚动会把徽标带到最后一条仍部分可见的旧命中上，选中却停在落点 ⇒
           用户看到"被选中的和视野中不是同一个"。现在窗口内两者都留给落点（=光标），窗口结束/用户滚动后再跟随。 */
        if (Date.now() < searchJumpSettleUntil) return;
        if (first === searchVisibleMid) return;
        searchVisibleMid = first;
        /* 0.1.68（用户反馈①）：**选中状态跟随视野**——滚到哪条，面板的选中行与"第 k/N 处"光标就跟到哪条。
           守卫：还没跳过（无光标）时不设——否则"刚搜完就自动选中了一条"，首次 Enter 的"跳第一条"语义会被改掉。 */
        if (searchCursor !== undefined) {
          const cursorBefore = String(searchCursor.mid || '');
          syncSearchSelectionToInView(state === undefined || state === null ? '' : String(state.sessionId || ''), first);
          if (String(searchCursor.mid || '') !== cursorBefore) searchTrace('io-cursor-move', { from: cursorBefore, to: String(first || '') });
        }
        markSearchRowInView();
      }, { root: elements.scroll, threshold: 0 });
      for (const target of targets) searchObserver.observe(target.el);
    }
    function closeSearchObserver() {
      if (searchObserver !== undefined) { searchObserver.disconnect(); searchObserver = undefined; }
      searchObservedKey = '';
      searchObservedNodes = [];
      searchVisibleMids = new Set();
      searchVisibleMid = '';
    }
    function cancelPendingSearch() {
      if (historyJumpTarget) {
        vscode.postMessage({ type: 'cancel-history-navigation' }); clearHistoryJump();
        pendingRailJumpSeq = undefined; pendingRailJumpSession = undefined;
        railNavigationLocked = false; railNavigationSeq = undefined; railNavigationId = undefined;
      }
      if (pendingSearchJump?.loadRequested === true) { vscode.postMessage({ type: 'cancel-history-navigation' }); pendingSearchJump = undefined; }
      clearTimeout(searchTimer);
      searchRequestId += 1;
      searchLoading = false;
      searchLocalReady = false;
      if (searchHistorySessionId !== '') { searchIndexHits = []; searchIndexStats = undefined; searchHistorySessionId = ''; }
      vscode.postMessage({ type: 'cancel-search' });
    }
    function requestSessionHistorySearch() {
      const parsed = parseSearchQuery(tabQuery);
      const sessionId = state?.sessionId;
      if (searchScope !== 'session' || !sessionId || parsed.include === '' || searchLoading) return;
      cancelPendingSearch();
      searchHistorySessionId = sessionId;
      searchHitsQuery = tabQuery.trim().toLowerCase();
      searchLoading = true;
      applyTabFilter();
      vscode.postMessage({ type: 'search-session-history', sessionId, query: parsed.include, excludes: parsed.excludes, requestId: searchRequestId });
    }
    function requestSearch() {
      cancelPendingSearch();
      foldBackAutoExpanded();   /* T3-8：换词新搜索也把上次自动展开的段折回 */
      const query = tabQuery.trim();
      const parsed = parseSearchQuery(query);
      if (query !== '' && parsed.include === '') {
        /* 只输排除词：给出提示而不是空搜（T3-5 判据③）。 */
        searchRequestId += 1;
        searchHits = [];
        searchIndexHits = [];
        searchHitsQuery = '';
        searchLoading = false;
        searchNotes = '至少要有一个要搜的词（- 开头的是排除词）';
        cancelSearchHistoryTimer();   /* 0.1.80：无效查询（只输排除词）不落历史 */
        applyTabFilter();
        return;
      }
      if (query === '') cancelSearchHistoryTimer();   /* 0.1.84（审查）：清空输入即撤待落计时 */
      else scheduleSearchHistory();   /* 0.1.80：检索触发只"起个停笔计时"——真正落历史见 flushSearchHistory/口径注释 */
      searchRequestId += 1;
      clearSearchHighlights();   /* 用户报②③：下一次搜索开始即清旧高亮（"保持到下次搜索"语义） */
      /* 新查询先清空两路旧命中（否则上一轮的他区条目会在本地回包到达前挂在新词上）。 */
      searchHits = [];
      searchIndexHits = [];
      searchHasMore = false;
      searchNotes = '';
      if (query === '') {
        searchHitsQuery = '';
        searchLoading = false;
        applyTabFilter();
        return;
      }
      searchHitsQuery = query.toLowerCase();
      searchLoading = true;
      applyTabFilter();
      /* T3-5：范围=当前会话 时**不发索引请求**（只本地即时扫描，更快更聚焦）。 */
      if (searchScope === 'session') { searchLoading = false; applyTabFilter(); return; }
      vscode.postMessage({ type: 'search-sessions', query: parsed.include, excludes: parsed.excludes, requestId: searchRequestId });
    }
    function scheduleSearch() {
      cancelPendingSearch();
      searchTimer = setTimeout(requestSearch, 250);
    }
    /* 0.0.168：跳转到命中会话 + 定位首个命中（文本/文件名/图片名三路）。 */
    let pendingSearchJump;
    /* 0.1.101：待跳转不能只等渲染帧——大会话"渐进填充完成"不必然伴随新的 state 帧，
       没有这个轻轮询，解析/落位可能干等到超时（真机=绕回后长时间不动）。250ms 一跳，落定即停。 */
    let searchJumpPoll;
    function armSearchJumpPoll() {
      if (searchJumpPoll !== undefined) return;
      const tick = () => {
        searchJumpPoll = undefined;
        const pending = pendingSearchJump;
        if (pending === undefined) return;
        tryPendingSearchJump();
        if (pendingSearchJump === pending) armSearchJumpPoll();
      };
      searchJumpPoll = window.setTimeout(tick, 250);
    }
    function jumpToSessionHit(sessionId, query) {
      if (typeof sessionId !== 'string' || sessionId === '') return;
      claimConversationScrollInput();
      searchPanelCollapsed = true;
      elements.tabSearchResults.classList.add('hidden');
      pendingSearchJump = { sessionId, query, deadline: Date.now() + 12_000 };
      if (state !== undefined && state.sessionId === sessionId) tryPendingSearchJump();
      else vscode.postMessage({ type: 'select-session', sessionId });
    }
    /* 命中扫描：状态里的消息文本/图片名/文件名为准；瘦身消息（text 空）回落已渲染 DOM 文本。 */
    function findSearchHitMessage(query) {
      const q = query.toLowerCase();
      for (const message of (state === undefined ? [] : state.messages) || []) {
        const parts = [String(message.text || '')];
        for (const image of message.images || []) parts.push(String(image.name || ''));
        for (const file of message.files || []) { parts.push(String(file.name || '')); parts.push(String(file.path || '')); }
        let hit = parts.some(part => part.toLowerCase().includes(q));
        if (!hit) {
          const rec = renderedMessages.get(message.id);
          const el = rec === undefined ? undefined : rec.node;
          const text = el === undefined || el === null ? '' : String(el.textContent || '');
          hit = text.toLowerCase().includes(q);
        }
        if (hit && typeof message.id === 'string' && renderedMessages.has(message.id)) return message.id;
      }
      return undefined;
    }
    /* 2026-09-24（遗留 bug②）：命中在"工作段折叠"里时节点是 display:none（零矩形）——
       scrollIntoView 会静默落空（与 0.1.28"锚点被折叠隐藏"同族）。跳转前先展开所在段：
       点折叠条 = 与用户手点同一条路径（补建正文 + 重排 + 写折叠记忆 + 持久化）。
       与轨道跳转的区别：0.0.137 的"跳转永不展开"针对**轨道**（目标是段首、通常本就可见，临时展开会
       被重折回而互相打架）；搜索是"我要看这条内容"，展开才是符合意图的落点。 */
    function revealFoldedHit(el) {
      if (el === undefined || el === null) return false;
      let hidden = false;
      for (let node = el; node !== null && node !== undefined; node = node.parentElement) {
        if (node.hidden === true) { hidden = true; break; }
        if (node === elements.messages) break;
      }
      if (!hidden) return false;
      /* 首选：workFoldBarOf 直取所在段的折叠条（段中间夹输入记录卡时兄弟链回溯会提前放弃）。 */
      const mapped = workFoldBarOf.get(el);
      if (mapped !== undefined && mapped.isConnected === true) {
        if (typeof mapped.__setFolded === 'function') {
          mapped.__setFolded(false);
          /* T3-8：记下"这条是搜索跳转自动展开的"，并清掉手动标记（这次是程序展开）。 */
          searchAutoFoldedBar = mapped;
          if (mapped.dataset !== undefined) mapped.dataset.userToggled = '';
        } else mapped.click();
        return true;
      }
      /* 回退：兄弟链回溯（登记表缺失或陈旧时用——折叠每次重算会删掉并重建条子 ⇒ 登记可能过期）。
         2026-09-25 修正：**允许跨过"永不折叠的输入记录卡"**（提问留痕卡/审批决定卡恒可见，
         且常是停点段的段首）——它们夹在折叠段中间，旧实现遇到"可见兄弟"即放弃 ⇒
         真机表现为"带折叠中标的首条命中点不动"。其余可见兄弟仍然停下（防跨到别的段）。 */
      for (let bar = el.previousElementSibling; bar !== null && bar !== undefined; bar = bar.previousElementSibling) {
        if (bar.classList !== undefined && bar.classList.contains('work-fold-bar')) {
          /* 走折叠条的写入口（而非 bar.click()）：程序性展开不该受"点击手势守卫"影响
             （守卫看的是"这次手势是否改动了选区"，程序调用没有手势可言），且展开语义明确。
             入参语义 = "折叠态"：false = 展开（__setFolded 见 applyWorkSegmentFold）。 */
          if (typeof bar.__setFolded === 'function') {
            bar.__setFolded(false);
            searchAutoFoldedBar = bar;
            if (bar.dataset !== undefined) bar.dataset.userToggled = '';
          }
          else bar.click();
          return true;
        }
        const recordCard = bar.matches !== undefined && bar.matches('.ask-record, .decision-card');
        if (bar.hidden !== true && !recordCard) return false;
      }
      return false;
    }
    /* 2026-09-25（用户报②③）：搜索跳转的"命中定位三件套"。
       ② 词级高亮：用 CSS Custom Highlight API 登记文本区间——**不改 DOM** ⇒ 对 KaTeX/代码块/表格零破坏；
          不支持该 API 的环境静默退回"整条闪烁"（下面保留）。
       ③ 落点＝命中词：把**命中词**居中，而不是把整条消息居中——长消息里命中词可能在屏幕外
          （真机实测：2227 字的消息高 1698px，block:center 只保证"消息盒子"居中，命中词在下半段就出屏）。
       ③b 落点稳定：跳转后 1.5s 内每 120ms 复查一次，布局变化（懒建分片补建/图片/折叠重排）把它顶偏就重新居中；
          用户一滚动/按键立即让位（连点别的命中也会作废旧窗口）。 */
    const SEARCH_MATCH_HIGHLIGHT = 'dsh-search-match';
    function searchHighlightRegistry() {
      const cssApi = window.CSS;
      return cssApi !== undefined && cssApi !== null && cssApi.highlights !== undefined ? cssApi.highlights : undefined;
    }
    function searchMatchRanges(root, query) {
      const out = [];
      if (root === undefined || root === null || typeof query !== 'string' || query === '') return out;
      const needle = query.toLowerCase();
      const inMath = (node) => {
        const parent = node === null || node === undefined ? undefined : node.parentElement;
        return parent !== undefined && parent !== null && typeof parent.closest === 'function' && parent.closest('.katex') !== null;
      };
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      let node = walker.nextNode();
      while (node !== null && node !== undefined) {
        /* 0.1.85（用户报②：搜 $NA$ 这类公式既不亮也不居中）：公式内的文本**交给下面的整体粒度分支**，
           这里跳过——否则单字符查询会与整块高亮重复计入（"共 N 处"失真）。 */
        if (inMath(node)) { node = walker.nextNode(); continue; }
        const text = String(node.nodeValue || '');
        const lower = text.toLowerCase();
        let from = 0;
        for (;;) {
          const at = lower.indexOf(needle, from);
          if (at < 0) break;
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + needle.length);
          out.push(range);
          from = at + needle.length;
          if (out.length >= 80) break;
        }
        node = walker.nextNode();
      }
      /* 0.1.85（用户报②）：**公式取整体粒度**——KaTeX 把 $NA$ 渲染成逐字形 span（N/A 各自成节点），
         单文本节点扫描永远匹配不到 "NA" ⇒ 既不亮也不居中。改为：拼出公式容器（.katex）的子树文本，
         命中即用一条**跨元素 Range 覆盖整块**（数学式对读者本就是原子单元；精确到字形反而看不清）。
         Custom Highlight API 接受跨元素 Range，getBoundingClientRect 也能给出整块盒 ⇒ 高亮与居中同时成立。 */
      const formulas = typeof root.querySelectorAll === 'function' ? root.querySelectorAll('.katex') : [];
      for (const box of formulas) {
        /* 0.1.86（用户复测：整块公式全亮、且逐字形分段看着奇怪）：从"整块公式"改**精确到命中字符**——
           累出"扁平文本 + 节点偏移表"，命中区间的首尾各定位到具体文本节点与偏移，只给命中的那几个字形上色
           （相邻字形仍是各自的小盒 = KaTeX 把每个字形做成 inline-block 的固有形态；命中区间跨结构时才会连成一片）。 */
        const map = [];
        const inner = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, null);
        let item = inner.nextNode();
        let flat = '';
        while (item !== null && item !== undefined) {
          const value = String(item.nodeValue || '');
          if (value !== '') { map.push({ node: item, start: flat.length }); flat += value; }
          item = inner.nextNode();
        }
        if (flat === '') continue;
        const locate = (index) => {
          for (const entry of map) {
            const length = String(entry.node.nodeValue || '').length;
            if (index >= entry.start && index < entry.start + length) return { node: entry.node, offset: index - entry.start };
          }
          return undefined;
        };
        const lower = flat.toLowerCase();
        let from = 0;
        for (;;) {
          const at = lower.indexOf(needle, from);
          if (at < 0) break;
          const head = locate(at);
          const tail = locate(at + needle.length - 1);
          if (head !== undefined && tail !== undefined) {
            const range = document.createRange();
            range.setStart(head.node, head.offset);
            range.setEnd(tail.node, tail.offset + 1);
            out.push(range);
          }
          from = at + needle.length;
          if (out.length >= 80) break;
        }
      }
      /* 0.1.85：两路合流后按**文档顺序**排序再截断——Enter 逐处跳吃这个顺序（旧实现公式命中会整体排到最后）。 */
      out.sort((a, b) => a.compareBoundaryPoints(Range.START_TO_START, b));
      return out.slice(0, 40);
    }
    /* 2026-09-25（用户需求）高亮外观：模式（一直常亮 / 一直呼吸＝正弦脉冲 / 呼吸后常亮）+ 颜色 + 前景对比度。
       **::highlight() 只支持 color/background-color/text-decoration/text-shadow（不支持 animation/transition，
       MDN 明示）** ⇒ 呼吸由 JS 按帧步进 CSS 变量 --search-hit-bg 的 alpha 实现（rAF≈60fps、正弦 1→0.25→1），
       只写变量不重造 Range。
       **作用域必须最小**：继承型自定义属性写在 body 上会让 Chromium 重算全树样式——实测 3.1 万节点 ≈330ms/次
       （大会话里闪烁会退化成 ~3fps）；写在命中那条消息（数百节点）上 ≈0.05ms/次，且 ::highlight() 伪元素
       继承自起源元素，颜色照样生效（getComputedStyle(el, '::highlight(名)') 实测读回一致）。
       前景：自选底色按 **WCAG 相对亮度阈值 sqrt(1.05*0.05)-0.05 ≈ 0.179** 自动切黑/白字
       （判据源自 WCAG 对比度公式；Firefox Color.sys.mjs 同款），主题档不覆盖字色。 */
    let searchPulseRaf;
    let searchPaintScopes = [];             /* 变量写到哪些元素上（命中所在的消息；无则空=不写） */
    let searchSeenAt = new Map();           /* 0.1.68：mid → 该命中**进入视野**的时刻（呼吸计时起点） */
    let searchEntryLevels = new Map();      /* 0.1.70（审核·性能）：元素 → 上次写入的明暗档（同值跳过写） */
    let searchHealPaintAt = 0;              /* 0.1.101：自愈重画节流时间戳（防逐帧 churn 触发全扫） */
    let searchJumpSettleUntil = 0;          /* 0.1.68：跳转落点稳定窗口内不顺从滚动改选区（防抢） */
    let renderedSearchSettingsKey = '';     /* 高亮设置签名（变更即重绘，不等下一次跳转） */
    const SEARCH_FG_THRESHOLD = Math.sqrt(1.05 * 0.05) - 0.05;
    const searchLinear = value => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    function searchRelLuminance(rgb) {
      return 0.2126 * searchLinear(rgb[0]) + 0.7152 * searchLinear(rgb[1]) + 0.0722 * searchLinear(rgb[2]);
    }
    function searchHexToRgb(hex) {
      return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    }
    /* 页面底色：优先主题变量 --vscode-editor-background（webview 一定有），退化到 body/html 的实底色。
       每次重绘刷新一次（换主题后下一次跳转即跟上），不做逐帧读（样式读取会触发重算）。 */
    let searchBgRgbCache;
    function searchPageBgRgb() {
      if (searchBgRgbCache !== undefined) return searchBgRgbCache;
      const style = window.getComputedStyle(document.body);
      searchBgRgbCache = searchCssColorOf(style.getPropertyValue('--vscode-editor-background'))
        || searchCssColorOf(style.backgroundColor)
        || searchCssColorOf(window.getComputedStyle(document.documentElement).backgroundColor)
        || [30, 30, 30];
      return searchBgRgbCache;
    }
    function searchCssColorOf(text) {
      const value = String(text === undefined || text === null ? '' : text).trim();
      if (/^#[0-9a-f]{6}$/i.test(value)) return searchHexToRgb(value);
      const rgb = /^rgba?\\(([^)]+)\\)$/i.exec(value);
      if (rgb === null) return undefined;
      const parts = rgb[1].split(',').map(part => parseFloat(part));
      if (parts.length < 3 || parts.some(part => !isFinite(part))) return undefined;
      return [Math.round(parts[0]), Math.round(parts[1]), Math.round(parts[2])];
    }
    /* 0.1.67（用户反馈③）：字色由**有效底色**决定——把"自选色 × 当前不透明度"与**页面底色**合成，
       按 WCAG 相对亮度阈值取**纯黑/纯白**。
       旧写法（把字色按 alpha 混回正文色）在半透明谷值处会落在"中灰底 + 灰字"，实测对比度只剩 ~1.2:1
       ——这正是用户看到的"背景最淡时字色偏灰、对比度不够"。滞回 12% 防交叉点附近来回翻。 */
    const searchFgChoices = new Map();
    let searchFgFixed;
    function searchFgForAlpha(mid, look, opacity) {
      const colorRgb = searchHexToRgb(look.color);
      if (look.fgMode === 'fixed') {
        /* 固定档：按"底色最浓"那一刻定一次，全程不翻（淡端对比度略低，但观感稳定；分发场景用）。 */
        if (searchFgFixed === undefined) {
          const peakMix = [0, 1, 2].map(channel => Math.round(colorRgb[channel] * 1 + searchPageBgRgb()[channel] * 0));
          searchFgFixed = searchRelLuminance(peakMix) > SEARCH_FG_THRESHOLD ? '#000000' : '#ffffff';
        }
        return searchFgFixed;
      }
      const strength = Math.max(0, Math.min(1, opacity));
      const bg = searchPageBgRgb();
      const mixed = [0, 1, 2].map(channel => Math.round(colorRgb[channel] * strength + bg[channel] * (1 - strength)));
      const luminance = searchRelLuminance(mixed);
      const margin = SEARCH_FG_THRESHOLD * 0.12;
      let choice = searchFgChoices.get(mid);
      if (choice === undefined) choice = luminance > SEARCH_FG_THRESHOLD ? 'black' : 'white';
      else if (choice === 'black' && luminance < SEARCH_FG_THRESHOLD - margin) choice = 'white';
      else if (choice === 'white' && luminance > SEARCH_FG_THRESHOLD + margin) choice = 'black';
      searchFgChoices.set(mid, choice);
      return choice === 'black' ? '#000000' : '#ffffff';
    }
    /* 0.1.70（审核）：跨命中收集区间（跳转路径与"设置变更后重绘"共用一套口径）。
       skipMid = 跳转目标（它的区间由调用方单独算，用于精确居中第 k 处）；脱钩/未渲染/他会话的跳过；总区间封顶 60。 */
    function searchRangesAcrossHits(query, skipMid) {
      const ranges = [];
      for (const hit of walkOrder) {
        if (ranges.length >= 60) break;
        if (hit.messageId === skipMid) continue;
        if (state === undefined || state === null || hit.sessionId !== state.sessionId) continue;
        const rec = renderedMessages.get(hit.messageId);
        const el = rec === undefined ? undefined : rec.node;
        if (el === undefined || el === null || el.isConnected !== true) continue;
        for (const range of searchMatchRanges(el, query)) {
          if (ranges.length >= 60) break;
          ranges.push(range);
        }
      }
      return ranges;
    }
    /* 区间 → 最小写入作用域：优先"命中所在的那条消息"，退化到起源元素本身；区间已脱钩则忽略。 */
    function searchScopesFor(ranges) {
      const out = [];
      for (const range of ranges) {
        const node = range.startContainer;
        const el = node === undefined || node === null ? null : (node.nodeType === 3 ? node.parentElement : (node.nodeType === 1 ? node : null));
        if (el === null || el.isConnected !== true) continue;
        const msg = el.closest === undefined ? null : el.closest('.message');
        const target = msg === null ? el : msg;
        if (out.some(entry => entry.el === target)) continue;
        /* 0.1.68：带上消息 id——「呼吸后常亮」按**每条命中各自进入视野**的时刻计时。 */
        const mid = msg === null || msg.dataset === undefined ? '' : String(msg.dataset.mid || '');
        out.push({ el: target, mid });
      }
      return out;
    }
    function resetSearchPaintScopes() {
      for (const entry of searchPaintScopes) { entry.el.style.removeProperty('--search-hit-bg'); entry.el.style.removeProperty('--search-hit-fg'); }
      searchPaintScopes = [];
      searchEntryLevels = new Map();
    }
    function stopSearchPulse() {
      if (searchPulseRaf !== undefined) { window.cancelAnimationFrame(searchPulseRaf); searchPulseRaf = undefined; }
    }
    function searchHighlightLook() {
      const cfg = state === undefined || state === null ? undefined : state.searchSettings;
      const mode = cfg !== undefined && cfg !== null && (cfg.highlightMode === 'blink' || cfg.highlightMode === 'blinkThenSteady') ? cfg.highlightMode : 'steady';
      const hex = cfg !== undefined && cfg !== null && typeof cfg.highlightColor === 'string' && /^#[0-9a-f]{6}$/i.test(cfg.highlightColor) ? cfg.highlightColor.toLowerCase() : undefined;
      /* 0.1.68（用户反馈）：字色档位（auto=随有效底色翻色 / fixed=按最浓端锁定不翻）。
         0.1.69（用户反馈）：设置项由"呼吸时长"改为"**呼吸周期**"（一个来回的秒数）。 */
      const fgMode = cfg !== undefined && cfg !== null && cfg.highlightFg === 'fixed' ? 'fixed' : 'auto';
      const period = cfg !== undefined && cfg !== null && typeof cfg.blinkPeriod === 'number' && isFinite(cfg.blinkPeriod) ? cfg.blinkPeriod : 1.2;
      return { mode, color: hex, fgMode, periodMs: Math.max(0.6, Math.min(3, period)) * 1000 };
    }
    function applySearchHighlightStyle(look, alphaOf) {
      /* 主题档保持 55% 半透明（不扰正文色）；自选色按用户所选实色，字色按"有效底色"取纯黑/纯白。 */
      const peak = look.color === undefined ? 0.55 : 1;
      for (const entry of searchPaintScopes) {
        const level = Math.max(0, Math.min(1, alphaOf(entry)));
        /* 0.1.70（审核·性能）：**与上次写入值相同就跳过**——视野外的命中不再每帧重复写入
           （呼吸期只有视口里那几条需要刷新；写入虽只 0.05ms/次，条数多时也是白烧帧预算）。 */
        const last = searchEntryLevels.get(entry.el);
        if (last !== undefined && Math.abs(last - level) < 0.01) continue;
        searchEntryLevels.set(entry.el, level);
        const opacity = level * peak;
        const percent = Math.round(opacity * 100);
        const base = look.color === undefined ? 'var(--vscode-charts-yellow, #e2b93d)' : look.color;
        entry.el.style.setProperty('--search-hit-bg', 'color-mix(in srgb, ' + base + ' ' + String(percent) + '%, transparent)');
        const fg = look.color === undefined ? undefined : searchFgForAlpha(entry.mid, look, opacity);
        if (fg === undefined) entry.el.style.removeProperty('--search-hit-fg');
        else entry.el.style.setProperty('--search-hit-fg', fg);
      }
    }
    /* 正弦呼吸：alpha 1 → 0.25 → 1（周期 1.2s）。
       「一直呼吸」= 视野内的命中一直呼吸；「呼吸后常亮」= **每条命中各自**从"进入视野"起呼吸 2 个整周期，之后常亮
       （0.1.68 用户实测：旧实现是全局一次性计时 ⇒ 滚到别的关键词时它早已落常亮）。
       rAF 驱动（≈60fps）：每步只写最小作用域的变量（实测 ≈0.05ms/次）；全落定后自动停表。 */
    function startSearchHighlightPulse(look) {
      stopSearchPulse();
      if (look.mode === 'steady') { applySearchHighlightStyle(look, () => 1); return; }
      applySearchHighlightStyle(look, () => 1);
      const base = performance.now();
      const period = look.periodMs;
      /* 「呼吸后常亮」：每条命中**各自**从进入视野起呼吸 **2 个整周期**。
         相位以该条自己的进入时刻为 0（= 峰值）⇒ 起振与收尾都落在最亮处，两端都不跳变
         （0.1.69 用户反馈：旧版按固定时长截断，常在淡端"啪"地跳到常亮）。 */
      const breatheWindow = period * 2;
      const tick = now => {
        searchPulseRaf = undefined;
        let pulsing = false;
        /* 0.1.105：脉冲的"可见"判据 = IO 视野集合 **∪ 当前光标命中**——跨会话落点那一刻观察器刚重建、
           IO 回包未到，旧判据会把落点当"视野外"⇒ 档位停在满亮不再呼吸（真机"呼吸后常亮"档却常亮不呼吸）。
           光标即"人正在看的那条"（0.1.95 起恒等于落点/视野），把它计入可见是安全的。 */
        const pulseSession = state === undefined || state === null ? '' : String(state.sessionId || '');
        applySearchHighlightStyle(look, entry => {
          /* 0.1.70（审核·性能）：**视野外不呼吸**——看不见的地方不必逐帧写变量（滚回来时按"重新进入视野"重新起表）。 */
          const cursorHere = searchCursor !== undefined && searchCursor.mid === entry.mid && searchCursor.sessionId === pulseSession;
          if (entry.mid === '' || !(searchVisibleMids.has(entry.mid) || cursorHere)) return 1;
          if (look.mode === 'blink') {
            pulsing = true;
            const phase = ((now - base) % period) / period;
            return 0.25 + 0.75 * (0.5 + 0.5 * Math.cos(phase * Math.PI * 2));
          }
          const seenAt = entry.mid === '' ? undefined : searchSeenAt.get(entry.mid);
          if (seenAt === undefined || now - seenAt >= breatheWindow) return 1;   /* 未进视野 / 已呼吸完 ⇒ 常亮 */
          pulsing = true;
          const phase = ((now - seenAt) % period) / period;
          return 0.25 + 0.75 * (0.5 + 0.5 * Math.cos(phase * Math.PI * 2));
        });
        if (!pulsing) return;
        searchPulseRaf = window.requestAnimationFrame(tick);
      };
      searchPulseRaf = window.requestAnimationFrame(tick);
    }
    /* 0.1.98（真机反馈"绕回落点闪一下就不闪/不呼吸"）：切回大会话时**渐进重渲/懒建补建**会替换命中消息的 DOM，
       已登记的高亮 Range 随之脱钩 ⇒ 高亮静默消失（视觉=闪一下就没）。
       渲染尾部做一次**廉价守卫**：绘制作用域里只要有元素掉线，就按当前光标就地重绘（重绘会重开呼吸计时，观感=重新呼吸）。 */
    function repaintSearchHighlightsIfDetached() {
      const query = tabQuery.trim();
      /* 0.1.101：没有光标就没有"该亮着的高亮"（只有跳转才登记光标），不必重画。 */
      if (query === '' || searchCursor === undefined) return;
      const registry = searchHighlightRegistry();
      const registered = registry === undefined ? undefined : registry.get(SEARCH_MATCH_HIGHLIGHT);
      /* 0.1.101 两处补盲（真机"闪一下就不亮/干脆不亮"的另一半）：
         ① 元素在、**文本节点被换**——懒建补建走 body.replaceWith(real)（见 ensureMessageBody），
            旧判据只看元素 isConnected ⇒ 区间已脱钩却不补；
         ② 登记被清空（会话切换帧里重画得到 0 区间 ⇒ clearSearchHighlights）而此后没有任何
            重画路径 ⇒ 高亮从此不再出现。登记缺失但**有光标**即视为该补。 */
      if (registered === undefined) { repaintSearchHighlightsFromCursor(); return; }
      let detached = false;
      for (const entry of searchPaintScopes) { if (entry.el === undefined || entry.el === null || entry.el.isConnected !== true) { detached = true; break; } }
      if (!detached) {
        for (const range of registered) {
          const start = range.startContainer;
          if (start === undefined || start === null || start.isConnected !== true) { detached = true; break; }
        }
      }
      if (!detached) {
        /* 0.1.108（真机取证：底部落地 200–400ms 后采样变问号，而 isConnected 判据**测不出来**）：
           按**视觉真相**兜底判定——落点那条消息在登记表里**一条区间都不在**（区间被换到别处/宿主脱离该消息，
           元素却仍连着），视觉上就是"没有高亮" ⇒ 重画。这也是"闪一下就不亮"的直接判据。 */
        const cursorNow = searchCursor;
        const cursorIn = cursorNow !== undefined && state !== undefined && state !== null && cursorNow.sessionId === state.sessionId;
        const recNow = cursorIn ? renderedMessages.get(cursorNow.mid) : undefined;
        const elNow = recNow === undefined ? undefined : recNow.node;
        if (elNow !== undefined && elNow !== null && elNow.isConnected === true) {
          let own = 0;
          for (const range of registered) {
            const start = range.startContainer;
            const host = start === undefined || start === null ? null : (start.nodeType === 3 ? start.parentElement : (start.nodeType === 1 ? start : null));
            if (host !== null && host !== undefined && elNow.contains(host)) { own += 1; break; }
          }
          if (own === 0) detached = true;
        }
      }
      if (!detached) return;
      /* 0.1.101：重画要逐命中扫文本（≤60 区间）——节流 150ms，防"逐帧替换类"DOM churn
         （流式尾行重排 / 懒建补建连续触发）把自愈变成每帧全扫（0.1.21 性能线的老坑）。 */
      const nowAt = performance.now();
      if (nowAt - searchHealPaintAt < 150) return;
      searchHealPaintAt = nowAt;
      repaintSearchHighlightsFromCursor();
    }
    /* 0.1.101：按当前光标就地重画（原自愈守卫的绘制段，抽出复用）。 */
    function repaintSearchHighlightsFromCursor() {
      const query = tabQuery.trim();
      if (query === '') return;
      const cursor = searchCursor;
      const inSession = cursor !== undefined && state !== undefined && state !== null && cursor.sessionId === state.sessionId;
      const rec = inSession ? renderedMessages.get(cursor.mid) : undefined;
      const el = rec === undefined ? undefined : rec.node;
      const ranges = [];
      if (el !== undefined && el !== null && el.isConnected === true) {
        for (const range of searchMatchRanges(el, query)) ranges.push(range);
      }
      for (const range of searchRangesAcrossHits(query, inSession ? cursor.mid : '')) ranges.push(range);
      /* 0.1.104：自愈结果取证（真机"关键词不亮"定位用：是"没画上"还是"画了又没了"）。 */
      if (ranges.length > 0) { paintSearchHighlights(ranges); searchTrace('heal-paint', { n: ranges.length, cursorIn: inSession }); }
      else { clearSearchHighlights(); searchTrace('heal-clear', { cursorIn: inSession, cursorMid: String(cursor === undefined ? '' : cursor.mid || '') }); }
    }
    function clearSearchHighlights() {
      stopSearchPulse();
      searchSeenAt = new Map();   /* 0.1.70（审核）：清高亮即清呼吸计时，避免重开同词时读到陈旧起点 */
      resetSearchPaintScopes();
      const registry = searchHighlightRegistry();
      if (registry !== undefined) registry.delete(SEARCH_MATCH_HIGHLIGHT);
    }
    function paintSearchHighlights(ranges) {
      const registry = searchHighlightRegistry();
      if (registry === undefined) return false;
      stopSearchPulse();
      searchBgRgbCache = undefined;   /* 换主题/面板背景变化后，下一次绘制重新读页面底色 */
      searchFgChoices.clear();
      searchFgFixed = undefined;
      /* 0.1.68：呼吸计时以"本条命中进入视野"为起点——绘制时已在视野里的那些，从现在起算。 */
      searchSeenAt = new Map();
      const HighlightCtor = window.Highlight;
      if (ranges.length === 0 || typeof HighlightCtor !== 'function') {
        resetSearchPaintScopes();
        registry.delete(SEARCH_MATCH_HIGHLIGHT);
        return false;
      }
      registry.set(SEARCH_MATCH_HIGHLIGHT, new HighlightCtor(...ranges));
      resetSearchPaintScopes();
      searchPaintScopes = searchScopesFor(ranges);
      for (const entry of searchPaintScopes) {
        if (entry.mid !== '' && searchVisibleMids.has(entry.mid)) searchSeenAt.set(entry.mid, performance.now());
      }
      startSearchHighlightPulse(searchHighlightLook());
      return true;
    }
    /* 设置变更即就地重绘（用户复测：三档切换此前要等下一次跳转才生效）。 */
    function syncSearchHighlightSettings(current) {
      const key = JSON.stringify(current === undefined || current === null ? null : current.searchSettings || null);
      if (key === renderedSearchSettingsKey) return;
      renderedSearchSettingsKey = key;
      /* 0.1.70（审核）：按当前命中表**重算区间**再绘制——旧实现复用 searchActiveRanges，
         而整树重渲（切会话/改渲染期设置）后那些 Range 已脱钩 ⇒ 高亮会整体静默消失。 */
      if (tabSearchOpen()) renderSearchResults();   /* 0.1.71：排序等面板项也吃设置 ⇒ 变更即重渲染 */
      /* 0.1.104（真机反馈③：切换「最近优先/时间正序」后再按 Enter 顺序不立即生效）：走路表此前只在
         面板渲染/会话落地时重建，而走路期间面板是收起的 ⇒ 换序要等"再点一次搜索栏（展开面板）"才生效。
         设置一变就重建走路表（数据驱动，与面板是否展开无关）。 */
      if (tabQuery.trim() !== '') syncSearchWalkOrder();
      const query = tabQuery.trim();
      if (query === '' || walkOrder.length === 0) return;
      const ranges = searchRangesAcrossHits(query, '');
      if (ranges.length > 0) paintSearchHighlights(ranges);
    }
    /* 把命中的第 occurrence 处区间居中（0.1.66：逐处跳；越界回落首处）；没有可用区间时退回"整条消息居中"。 */
    function centerOnSearchMatch(ranges, el, occurrence) {
      const wanted = typeof occurrence === 'number' && occurrence > 0 ? occurrence : 1;
      const range = ranges.length >= wanted ? ranges[wanted - 1] : (ranges.length > 0 ? ranges[0] : undefined);
      const rect = range === undefined ? undefined : range.getBoundingClientRect();
      if (rect !== undefined && rect.height > 0) {
        const srect = elements.scroll.getBoundingClientRect();
        selfScrollStamp = performance.now();
        elements.scroll.scrollTop += (rect.top - srect.top) - (srect.height - rect.height) / 2;
        markScrollSeen();
        return;
      }
      if (el !== undefined && el !== null && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
    }
    let searchSettleToken = 0;
    /* 0.1.111（审查低危）：释放监听**只装一次**——旧实现每次落地都 addEventListener({once:true})，
       用户一直不滚不动时这些一次性监听会随落地次数累积（走路 100 步 = 上百个）。改为常驻监听 +
       "当前待释放回调"槽位（每次落地覆盖槽位）。keydown 只释放"落地稳定窗口"（它管 IO 让位），
       不释放"高亮守护"（守护要扛住走路时的连续按键，见 0.1.107 注释）。 */
    let searchSettleRelease;
    let searchGuardianRelease;
    const fireSearchSettleRelease = () => { const fn = searchSettleRelease; searchSettleRelease = undefined; if (fn !== undefined) fn(); };
    const fireSearchGuardianRelease = () => { const fn = searchGuardianRelease; searchGuardianRelease = undefined; if (fn !== undefined) fn(); };
    elements.scroll.addEventListener('wheel', () => { fireSearchSettleRelease(); fireSearchGuardianRelease(); }, { passive: true });
    elements.scroll.addEventListener('mousedown', () => { fireSearchSettleRelease(); fireSearchGuardianRelease(); }, { passive: true });
    document.addEventListener('keydown', () => { fireSearchSettleRelease(); }, { passive: true });
    /* 0.1.107：高亮守护（见 tryPendingSearchJump 调用处注释）。 */
    let searchGuardianTimer;
    let searchGuardianToken = 0;
    function stopSearchHighlightGuardian() {
      searchGuardianToken += 1;
      searchGuardianRelease = undefined;
      if (searchGuardianTimer !== undefined) { window.clearTimeout(searchGuardianTimer); searchGuardianTimer = undefined; }
    }
    function startSearchHighlightGuardian() {
      stopSearchHighlightGuardian();
      const token = searchGuardianToken;
      searchGuardianRelease = () => { if (token === searchGuardianToken) stopSearchHighlightGuardian(); };
      const deadline = Date.now() + 9000;
      const tick = () => {
        if (token !== searchGuardianToken) return;
        searchGuardianTimer = undefined;
        if (Date.now() > deadline || tabQuery.trim() === '' || searchCursor === undefined) return;
        try { repaintSearchHighlightsIfDetached(); } catch { /* 自愈失败不抛 */ }
        searchGuardianTimer = window.setTimeout(tick, 400);
      };
      searchGuardianTimer = window.setTimeout(tick, 400);
    }
    /* 0.1.106（真机"多跳后只亮一下、没有高亮背景" + "落点偏上、偶发二次跳"）：落点稳定窗口升级为
       **自愈式落地守护**——① 每拍先跑高亮脱钩自愈（多跳/懒建补建会换掉命中消息的正文 DOM，
       区间脱钩而渲染尾自愈在那类路径上不一定被唤起）；② 命中漂移出中心就重新居中（布局晚结算：
       上方补建长高/图片解码 ⇒ 命中偏上）。窗口 1.5s→4.5s、拍 120→200ms（用户一动即让位，成本有界）；
       命中区间**每拍按当前 DOM 重算**（旧 ranges 可能已脱钩，用旧的等于对着空气量位置）。 */
    function startSearchLandingSettle(mid, query, occurrence) {
      const token = ++searchSettleToken;
      /* 用户一动（滚轮/按下/按键）就让位——落点窗口结束，"选区跟随视野"的守卫也一并解除。 */
      searchSettleRelease = () => {
        if (token !== searchSettleToken) return;
        searchSettleToken += 1;
        searchJumpSettleUntil = 0;
      };
      const deadline = Date.now() + 4500;
      const tick = () => {
        if (token !== searchSettleToken) return;
        if (Date.now() > deadline) return;
        /* ① 自愈：多跳/补建换掉正文后把区间就地重画（守卫内部自带 150ms 节流与连通性判定）。 */
        try { repaintSearchHighlightsIfDetached(); } catch { /* 自愈失败不抛 */ }
        /* ② 命中漂移就重新居中：按当前 DOM 重算命中区间（跳转目标必须是**光标那条**且仍在当前会话）。 */
        const cursor = searchCursor;
        const inSession = cursor !== undefined && cursor.mid === mid && state !== undefined && state !== null && cursor.sessionId === state.sessionId;
        const rec = inSession ? renderedMessages.get(mid) : undefined;
        const el = rec === undefined ? undefined : rec.node;
        if (el !== undefined && el !== null && el.isConnected === true) {
          const fresh = searchMatchRanges(el, query);
          const wanted = typeof occurrence === 'number' && occurrence > 0 ? occurrence : 1;
          const range = fresh.length >= wanted ? fresh[wanted - 1] : (fresh.length > 0 ? fresh[0] : undefined);
          /* 每次重算都会产出**新的** Range（未登记）——居中只取几何、不登记，登记交给自愈/跳转路径。 */
          const rect = range === undefined ? undefined : range.getBoundingClientRect();
          if (rect !== undefined && rect.height > 0) {
            const srect = elements.scroll.getBoundingClientRect();
            /* 0.1.107（真机"落位后跳一下"）：居中校正只在命中**跑出视口**时做——小幅漂移不纠正，
               免得把"稳"做成一次可见的跳；落点位置由落地窗口（锚=落点消息）钉住，本不该漂。 */
            const outOfView = rect.bottom < srect.top + 12 || rect.top > srect.bottom - 12;
            if (outOfView) {
              /* 0.1.111：稳定窗口的重新居中也是**程序性滚动**——标上令牌，别被下一次 scroll 事件
                 当成"用户接管"（那会提前终止落地窗口、与自身校正打架）。 */
              programmaticScroll = true;
              selfScrollStamp = performance.now();
              elements.scroll.scrollTop += (rect.top - srect.top) - (srect.height - rect.height) / 2;
              markScrollSeen();
            }
          }
        }
        window.setTimeout(tick, 200);
      };
      window.setTimeout(tick, 120);
    }
    function tryPendingSearchJump() {
      const pending = pendingSearchJump;
      if (pending === undefined) return;
      if (Date.now() > pending.deadline && !(pending.loadRequested === true && historyJumpTarget?.mode === 'loading')) {
        clearHistoryJump();
        pendingSearchJump = undefined;
        if (pending.wrapEdge !== undefined) searchTrace('wrap-timeout', { session: String(pending.sessionId || '').slice(0, 20), entry: String(pending.entry === undefined ? '' : pending.entry.messageId || '') });
        /* 0.1.101：延迟解析超时 ⇒ 回落到按键时的条目（旧行为兜底，至少尝试一次）。 */
        if (pending.wrapEdge !== undefined && pending.entry !== undefined) {
          const fallbackTotal = typeof pending.entry.total === 'number' && pending.entry.total > 0 ? pending.entry.total : 1;
          jumpToMessageHit(pending.entry.sessionId, pending.entry.messageId, pending.query, pending.wrapEdge === 'last' ? fallbackTotal : 1);
        }
        return;
      }
      /* 0.1.101：回绕延迟解析——目标会话就位且**渲染落定**（渐进填充结束）后，按当前面板模型取
         "该会话组第一/最后一条已渲染的可跳行"。失败（该组还没有可跳行）就等下一轮轮询/渲染帧。 */
      if (pending.wrapEdge !== undefined) {
        if (state === undefined || state.sessionId !== pending.sessionId) return;
        /* 换词/清词 ⇒ 这次回绕已作废（走路表随换词整表重来；防陈旧意图把人跳去无关位置）。 */
        if (tabQuery.trim() !== pending.query) { pendingSearchJump = undefined; return; }
        if (progressiveFill !== undefined) return;
        const model = searchRowModel();
        let pick;
        for (const group of model.groups) {
          if (group.sessionId !== pending.sessionId) continue;
          const usable = group.rows.filter(row => row.jumpable === true && typeof row.messageId === 'string' && row.messageId !== '' && renderedMessages.has(row.messageId));
          if (usable.length > 0) pick = pending.wrapEdge === 'last' ? usable[usable.length - 1] : usable[0];
          break;
        }
        if (pick === undefined) return;
        searchTrace('wrap-pick', {
          mid: String(pick.messageId || ''), edge: pending.wrapEdge,
          waitedMs: Date.now() - (typeof pending.armedAt === 'number' ? pending.armedAt : Date.now()),
          fill: progressiveFill === undefined ? 'done' : 'running', rendered: renderedMessages.size,
        });
        pendingSearchJump = undefined;
        const total = typeof pick.total === 'number' && pick.total > 0 ? pick.total : 1;
        jumpToMessageHit(pending.sessionId, pick.messageId, pending.query, pending.wrapEdge === 'last' ? total : 1);
        return;
      }
      /* 会话切换是异步的（select-session → 历史加载 → 多帧状态推送）——每帧试一次，
         直到命中已渲染或超时（历史加载慢时仍能落位）。 */
      if (state === undefined || state.sessionId !== pending.sessionId) return;
      /* 本地命中直接给消息 id；跨会话命中按关键词找首个命中消息。 */
      const messageId = typeof pending.messageId === 'string' && pending.messageId !== ''
        ? (renderedMessages.has(pending.messageId) ? pending.messageId : undefined)
        : findSearchHitMessage(pending.query);
      if (messageId === undefined) {
        if (progressiveFill !== undefined || state.loadingHistory === true) return;
        if (pending.historyReady === true && firstLoadedSeq() !== undefined && firstLoadedSeq() <= pending.seq) {
          clearHistoryJump();
          pendingSearchJump = undefined;
          showToast('已加载的历史中找不到该搜索命中，请重新检索', true);
        } else if (typeof pending.seq === 'number' && pending.loadRequested !== true && state.hasMoreHistory === true) {
          pending.loadRequested = true;
          startHistoryJump('search', pending.seq, { ...pending });
        } else if (typeof pending.seq === 'number' && pending.loadRequested !== true && state.hasMoreHistory === false) {
          clearHistoryJump();
          pendingSearchJump = undefined;
          showToast('已加载的历史中找不到该搜索命中，请重新检索', true);
        }
        return;
      }
      clearHistoryJump();
      pendingSearchJump = undefined;
      foldBackAutoExpanded();   /* T3-8：跳转成功时先折回上一次**自动展开**的段（手动态不动） */
      /* 0.1.102（真机取证定位：0.1.101 复测落点 09-23 00:37 = 记忆锚点）：G39 视图记忆的**校正窗口**在
         渐进填充/懒建期间会被 ResizeObserver 反复唤起（applyViewRestoreNow + extendRestoreWindow 续期），
         且它写入 scrollTop 前置位的 programmaticScroll 会把**紧随其后的跳转滚动**误当成程序性滚动
         ⇒ "用户接管"不置位 ⇒ 窗口继续把视图回拉到"离开该会话前的位置"，跳转落点被顶掉、高亮留在屏外。
         0.1.103：不再清窗（清窗会让布局 churn 无人吸收、落点被逐次拽回 ⇒ 回跳），改为**重锚到落点**（见下方）。 */
      searchTrace('jump', { mid: String(messageId || ''), occ: pending.occurrence, top: Math.round(elements.scroll.scrollTop) });
      const rec = renderedMessages.get(messageId);
      const el = rec === undefined ? undefined : rec.node;
      if (el === undefined || el === null) return;
      /* 0.1.44（D3）：命中"未补建的外壳"时先补建正文——否则壳高≈头部，scrollIntoView 落点会偏。 */
      /* 2026-09-24（遗留 bug②）：命中在"工作段折叠"里 → 先展开所在段（见 revealFoldedHit）。 */
      revealFoldedHit(el);
      ensureMessageBody(el);
      ensureToolCard(el);   /* T2：命中工具卡时先补建卡面（否则闪框落在一个空壳上） */
      /* 2026-09-25（用户报②③）：清旧高亮 → 登记本次命中词高亮 → **把命中词居中**（长消息里
         命中词可能在屏幕外，居中整条消息不够）→ 开 1.5s 落点稳定窗口（布局变化重新居中、用户一动让位）。 */
      clearSearchHighlights();
      const matchRanges = searchMatchRanges(el, pending.query);
      /* 0.1.67（用户反馈①）：把**其余已渲染命中消息**的命中词也一起登记高亮——
         用户滚到另一条命中（结果 B）时，那里的词同样该亮、该呼吸（旧实现只染"跳过去的那条"）。 */
      const paintAll = matchRanges.concat(searchRangesAcrossHits(pending.query, messageId));
      paintSearchHighlights(paintAll);
      /* 0.1.104：落点高亮取证（真机"关键词不亮"用）——本区间数 / 总区间数 / 是否仍被折叠隐藏 / 元素高。 */
      {
        let hiddenAncestor = false;
        for (let node = el; node !== null && node !== undefined && node !== elements.messages; node = node.parentElement) { if (node.hidden === true) { hiddenAncestor = true; break; } }
        searchTrace('jump-paint', { mid: String(messageId || ''), own: matchRanges.length, all: paintAll.length, hidden: hiddenAncestor, h: Math.round(el.getBoundingClientRect().height) });
        /* 0.1.107：DOM 规模取证——回答"验证工具是否真实"：夹具与真机的 DOM 体量应可逐项对照。 */
        searchTrace('landing-dom', {
          nodes: elements.messages.querySelectorAll('*').length,
          msgs: elements.messages.childElementCount,
          totalH: Math.round(elements.scroll.scrollHeight),
          viewH: Math.round(elements.scroll.clientHeight),
          targetH: Math.round(el.getBoundingClientRect().height),
          images: el.querySelectorAll('img').length,
          lazyLeft: lazyBodies.size,
        });
      }
      /* 0.1.77（用户报③）：跨会话跳转后**重建观察器**——否则它盯着上一个会话的旧节点，
         新会话的命中被判成"不在视野" ⇒ 高亮不呼吸（0.1.70 的"视野外不呼吸"把它放大成可见 bug）。 */
      searchObservedKey = '';
      syncSearchVisibilityObserver();
      /* 0.1.95（真机反馈①）：徽标**跟随落点**——跳转即把「视野中」记到目标条。
         旧写法只等 IO 回调 ⇒ 落点旁边旧命中仍部分可见时徽标会被带走，而选中停在落点 ⇒ 两者不一致。 */
      searchVisibleMid = messageId;
      markSearchRowInView();
      /* 0.1.111：记下居中前的滚动位置——落地窗口的 programmaticScroll 令牌按"位移比较"决定是否置位。 */
      const scrollTopBeforeJump = elements.scroll.scrollTop;
      /* 0.1.120：搜索落点是用户动作（点行/Enter）→ 落点徽标照常浮出（不受意图门控拦截）。 */
      stampRailBadgeIntent();
      centerOnSearchMatch(matchRanges, el, pending.occurrence);
      startSearchLandingSettle(messageId, pending.query, pending.occurrence);
      /* 0.1.114（G55 Phase 2）：编号片跳转 → 落点轨道节点脉冲（同一落点通道，一次性）。 */
      if (pending.pulse === true) pulseRailNodeForMessage(messageId, pending.sessionId);
      /* 0.1.105（真机"呼吸后常亮"两症状：顶部落地=常亮不呼吸 / 尾部落地=闪一下就不亮）：
         ① 呼吸起振**确定性触发**——旧路径只靠 IO 回包重启脉冲，落点那一刻若 IO 还没报"进入视野"
            （跨会话刚重建观察器），脉冲首帧即停 ⇒ 档位停在满亮、不再呼吸（"常亮不呼吸"）；
         ② 落地后 **2.6s 高亮采样**（档位 + 命中是否在视口 + 是否"视野中"）写 perf-log——
            真机复测直接读，判定"没画上 / 画了但屏外 / 画了但不再呼吸"。 */
      try {
        const sampleMid = String(messageId || '');
        if (sampleMid !== '' && !searchSeenAt.has(sampleMid)) searchSeenAt.set(sampleMid, performance.now());
        startSearchHighlightPulse(searchHighlightLook());
        const seq = [];
        let sampleN = 0;
        const sample = () => {
          sampleN += 1;
          const rec2 = renderedMessages.get(sampleMid);
          const el2 = rec2 === undefined ? undefined : rec2.node;
          if (el2 === undefined || el2 === null) { seq.push('no-el'); }
          else {
            let inView = null;
            let hostNote = '';
            const registry2 = searchHighlightRegistry();
            const current2 = registry2 === undefined ? undefined : registry2.get(SEARCH_MATCH_HIGHLIGHT);
            if (current2 !== undefined) {
              for (const range2 of current2) {
                const c2 = range2.startContainer; const host2 = c2.nodeType === 3 ? c2.parentElement : c2;
                if (host2 !== null && host2 !== undefined && el2.contains(host2)) {
                  const r2 = range2.getBoundingClientRect(); const sr2 = elements.scroll.getBoundingClientRect();
                  inView = r2.height > 0 && r2.bottom > sr2.top && r2.top < sr2.bottom;
                  break;
                }
              }
              /* 0.1.108：找不到本消息区间时补诊断——区间第一条到底住在哪（哪条消息 / 是否仍连着 / 是否仍在消息容器里）。 */
              if (inView === null) {
                for (const range2 of current2) {
                  const c2 = range2.startContainer; const host2 = c2.nodeType === 3 ? c2.parentElement : c2;
                  if (host2 === null || host2 === undefined) continue;
                  const msgHost = host2.closest === undefined ? null : host2.closest('.message');
                  hostNote = '~' + (msgHost === null ? '?' : String(msgHost.dataset.mid || '').slice(0, 10)) + (host2.isConnected === true ? 'c' : 'd') + (elements.messages.contains(host2) ? 'm' : '-');
                  break;
                }
              }
            }
            const raw2 = String(el2.style.getPropertyValue('--search-hit-bg'));
            const pct2 = /([0-9]+)%/.exec(raw2);
            seq.push((pct2 === null ? '-' : pct2[1]) + (inView === true ? 'V' : inView === false ? 'x' : '?') + (searchVisibleMids.has(sampleMid) ? 'y' : 'n') + hostNote);
          }
          if (sampleN < 13) window.setTimeout(sample, 200);
          else searchTrace('landing-sample', { mid: sampleMid, seq: seq.join(' ') });
        };
        window.setTimeout(sample, 200);
      } catch { /* 取证/起振失败不抛 */ }
      /* 0.1.103（真机"绕回后回跳几下/定位不准"）：把会话校正窗口**重锚到落点**（原本没有就开一个）——
         懒建补建每来一批，上方内容长高一次，落点就被顶走一次；0.1.102 的清窗把这些位移交给
         "落点稳定窗口"逐次可见地拽回（= 回跳几下）。重锚后由它在 ResizeObserver（布局后、绘制前）
         静默吸收，落点稳定窗口只负责命中词的精确定位；真实用户滚动仍置 userTouched 让位（同原语义）。
         跳转自身的滚动以 programmaticScroll 标注 ⇒ 不会被下一次 scroll 事件误判成"用户接管"。 */
      {
        /* 0.1.107（真机"落位后跳一下"）：锚点用**落点消息本身**（不是视口顶那条）——上方懒建补建/图片解码
           把内容撑高时，视口顶锚只保"顶那条不动"，落点（在它下方）会整体下移 ⇒ 随后被稳定窗口可见地拽回。
           以落点消息为锚：窗口把它钉在原位置，命中不再漂、也就没有"跳一下"。 */
        const scrollRectA = elements.scroll.getBoundingClientRect();
        const elRectA = el.getBoundingClientRect();
        const anchorNow = { id: String(messageId || ''), offset: Math.round(scrollRectA.top - elRectA.top) };
        if (anchorNow.id !== '' && state !== undefined && state !== null && typeof state.sessionId === 'string' && state.sessionId !== '') {
          if (restoreCtx !== undefined && restoreCtx.sessionId === state.sessionId) {
            restoreCtx.anchorId = anchorNow.id; restoreCtx.anchorOffset = anchorNow.offset; restoreCtx.anchorIndex = messageIndexOfAnchorMid(anchorNow.id);
            restoreCtx.userTouched = false; restoreCtx.kind = 'search-landing';
            restoreCtx.deadline = Math.max(restoreCtx.deadline, Date.now() + 1200);
            searchTrace('jump-restore-reanchor', { mid: String(messageId || ''), anchor: String(anchorNow.id || '') });
          } else {
            openRestoreWindow({ sessionId: state.sessionId, top: Math.round(elements.scroll.scrollTop), anchorId: anchorNow.id, anchorOffset: anchorNow.offset || 0, deadline: Date.now() + 1200, userTouched: false, kind: 'search-landing' });
            searchTrace('jump-landing-window', { mid: String(messageId || ''), anchor: String(anchorNow.id || '') });
          }
          /* 0.1.111（复审返工）：本标志是"下一次 scroll 事件是程序性"的一次性令牌。若居中本身没产生
             滚动（落点已在位），事件不来 ⇒ 令牌悬挂，会把**用户随后第一次真滚动**误判成程序性。
             判据用与 applyViewRestoreNow 相同的"**位移比较**"（而非 0.1.109 的 setTimeout 清零——
             那会在渲染步之前把令牌清掉，使紧随其后的程序性滚动被当成用户接管、提前终止校正窗口，
             L2 台架 g92 从 98.96 漂到 110.69 稳定判红，已复现并回退）。 */
          programmaticScroll = elements.scroll.scrollTop !== scrollTopBeforeJump;
        }
      }
      /* 落点若不在底部，明确脱离"尾巴跟随"（回到底部附近会自然重新跟随）——防运行中/贴底会话把落点又拽回底部。 */
      detachConversationTail();
      /* 0.1.107（真机"多跳后只亮一下、没有高亮背景"）：**独立高亮守护**——懒建补建换掉命中消息正文后
         区间脱钩，而渲染尾自愈在那些路径上不一定被唤起；落点稳定窗口又会**被走路时的按键释放**
         （用户一直在按 Enter/Shift+Enter）⇒ 自愈还没跑就被撤。守护只做"脱钩即重画"，
         400ms 一拍、最长 ~9s；只被真·指针交互（滚轮/按下）或下一次跳转终止（token）。 */
      startSearchHighlightGuardian();
      /* 0.1.68：落点稳定窗口期间，视野变化**不**改选区（否则自己的程序化滚动会把选中带跑）。 */
      searchJumpSettleUntil = Date.now() + 1600;
      el.classList.remove('search-hit-flash');
      void el.offsetWidth;
      el.classList.add('search-hit-flash');
      window.setTimeout(() => el.classList.remove('search-hit-flash'), 2700);
    }
    function openTabSearch() {
      elements.tabSearch.classList.remove('hidden');
      elements.tabSearchInput.value = tabQuery;
      elements.tabSearchInput.focus();
      searchPanelCollapsed = false;
      /* 0.1.74（用户反馈②）：重开面板时把「视野中」那条**居中**，而不是留在顶部。 */
      searchPanelUserScrolled = false;
      applyTabFilter();
      centerSearchPanelOnInView();
      if (tabQuery.trim() !== '' && searchHitsFor(tabQuery.trim().toLowerCase()).length === 0 && !searchLoading) scheduleSearch();
    }
    function closeTabSearch() {
      cancelPendingSearch();
      clearSearchHighlights();   /* 用户报②③：关面板即清掉会话内词级高亮（不留脏） */
      closeSearchObserver();     /* 0.1.66：关面板即撤观察器（不留后台回调） */
      cancelSearchHistoryTimer();   /* 0.1.80：关面板即撤"停笔落历史"计时（关掉还记一条属脏） */
      searchOriginSessionId = '';   /* 0.1.83：关面板即清"搜索起点会话"锚（下次搜索重新锚定） */
      searchComposing = false;      /* 组合态随面板关闭复位（IME 被强关时可能收不到 compositionend） */
      /* 0.1.74：清掉预览计时器与浮层（关面板后不该再有回调） */
      if (searchJumpPoll !== undefined) { window.clearTimeout(searchJumpPoll); searchJumpPoll = undefined; }   /* 0.1.101：回绕解析轮询 */
      stopSearchHighlightGuardian();   /* 0.1.107：关面板即撤高亮守护 */
      searchSettleToken += 1;          /* 0.1.109（代码审查）：关面板即作废落点稳定窗口（其 tick 会空转 4.5s） */
      searchSettleRelease = undefined;   /* 0.1.111：连同"让位回调"槽位一起清（防陈旧闭包挂着） */
      if (pendingSearchJump !== undefined) pendingSearchJump = undefined;   /* 0.1.109（审查）：关面板即撤在途待跳 */
      if (searchPeekShowTimer !== undefined) { window.clearTimeout(searchPeekShowTimer); searchPeekShowTimer = undefined; }
      if (searchPeekHideTimer !== undefined) { window.clearTimeout(searchPeekHideTimer); searchPeekHideTimer = undefined; }
      hideSearchPeek();
      /* 0.1.70（审核）：请求号前移 ⇒ 作废在途/后续回包（含扩展侧"索引建完自动重推"）——
         否则关面板后仍会有一轮结果写进状态（无视觉影响，但属脏）。 */
      searchRequestId += 1;
      tabQuery = '';
      elements.tabSearchInput.value = '';
      elements.tabSearch.classList.add('hidden');
      searchHits = []; searchIndexHits = []; searchHitsQuery = ''; searchHasMore = false; searchNotes = ''; searchLoading = false;
      searchActiveRow = -1;
      searchCursor = undefined;
      walkOrder = [];
      walkOrderQuery = '';
      walkOrderSessionId = '';
      searchPanelCollapsed = false;
      elements.tabSearchResults.classList.add('hidden');
      applyTabFilter();
    }
    /* 0.1.67（用户反馈②）：Enter 逐处跳**不要求焦点在搜索框**——点过会话内容（焦点跑掉）后也照常生效。
       仅在"有活跃搜索词 + 焦点不在可交互控件上"时接管：输入框/文本域/下拉/按钮/链接/可编辑区一律让位
       （否则会抢走发消息、按钮激活、卡片操作等 Enter）。 */
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      if (tabQuery.trim() === '') return;
      /* 事件源自搜索框 ⇒ 归它自己的处理（避免"输入框已聚焦但 activeElement 读到 BODY"这类重复处理）。 */
      if (event.target === elements.tabSearchInput) return;
      const active = document.activeElement;
      if (active !== null && active !== undefined) {
        const tag = String(active.tagName || '');
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A') return;
        if (active.isContentEditable === true) return;
      }
      if (stepSearchCursor(event.shiftKey === true)) {
        event.preventDefault();
        event.stopPropagation();
        /* 0.1.80：无焦点 Enter 也是"提交点"——真跳转了才把当前词落历史（E 方案）。 */
        flushSearchHistory();
      }
    });
    /* 0.1.72：结果面板的悬停——peek 模式做翻上避让（面板底放不下就翻到行上方），pane 模式切换详情区内容。 */
    elements.tabSearchResults.addEventListener('mouseover', (event) => {
      const target = event.target;
      const row = target === null || target === undefined || target.closest === undefined ? null : target.closest('.tab-search-hit');
      if (row === null) return;
      const mid = String(row.dataset.mid || '');
      if (searchSnippetView() === 'pane') {
        if (mid === searchPeekMid) return;
        searchPeekMid = mid;
        updateSearchPeekPane();
        return;
      }
      schedulePeek(row);
    });
    elements.tabSearchResults.addEventListener('mouseleave', () => {
      if (searchSnippetView() === 'pane') {
        if (searchPeekMid === '') return;
        searchPeekMid = '';
        updateSearchPeekPane();
        return;
      }
      schedulePeekHide();
    });
    /* 滚动时不重算位置：直接收起（拖滚动条时浮层跟着跑反而晃眼；重渲时层被重建也会自然收起）。 */
    /* 0.1.74：面板滚动——① 收起预览层 ② 区分用户滚动（回声判定：程序化滚动后 150ms 内的 scroll 不算用户） */
    elements.tabSearchResults.addEventListener('scroll', () => {
      hideSearchPeek();
      if (performance.now() - searchPanelScrollStamp > 150) searchPanelUserScrolled = true;
    }, true);
    elements.searchReturnPillGo.addEventListener('click', () => {
      if (searchReturnPill === undefined) return;
      const back = searchReturnPill.targetId;
      hideSearchReturnPill();
      vscode.postMessage({ type: 'select-session', sessionId: back });
    });
    /* 0.1.82（用户需求）：胶囊可手动关闭（不等 12s 自灭）。 */
    elements.searchReturnPillClose.addEventListener('click', (event) => {
      event.stopPropagation();
      hideSearchReturnPill();
    });
    elements.tabSearchToggle.addEventListener('click', () => { if (tabSearchOpen()) closeTabSearch(); else openTabSearch(); });
    elements.tabSearchClose.addEventListener('click', () => closeTabSearch());
    /* 0.1.80（用户拍板：组合期"一起挡"）：拼音候选阶段既不搜也不记——否则面板会闪一堆
       拼音假命中，历史还会留下 xia'zai / 瞎子啊 这类中间态。isComposing + searchComposing 双判
       （Chrome/Firefox 规范下组合期 input.isComposing 均为 true；另用 composition 事件兜平台差异）。 */
    elements.tabSearchInput.addEventListener('compositionstart', () => { searchComposing = true; cancelPendingSearch(); cancelSearchHistoryTimer(); });
    /* 0.1.84（审查补洞）：IME 被强关/切窗/失焦时可能收不到 compositionend ⇒ searchComposing 卡真
       ⇒ 之后**输入框彻底不响应**（input 全被 gate 掉）。失焦即复位兜底。 */
    elements.tabSearchInput.addEventListener('blur', () => { searchComposing = false; });
    elements.tabSearchInput.addEventListener('compositionend', () => {
      searchComposing = false;
      /* 组合结束补一次"输入"：Chrome 组合结束**不补发** input、Firefox 会补发——这里两头都覆盖
         （Firefox 场景下紧随其后的 input 会再跑一遍同款逻辑，幂等无害）。 */
      if (elements.tabSearchInput.value.trim() !== '') markSearchOrigin();   /* 0.1.83：定稿词=新查询 */
      tabQuery = elements.tabSearchInput.value;
      searchPanelCollapsed = false;
      searchActiveRow = -1;
      searchCursor = undefined;
      applyTabFilter();
      scheduleSearch();
      scheduleSearchHistory();
    });
    elements.tabSearchInput.addEventListener('input', (event) => {
      if (searchComposing || (event !== undefined && event !== null && event.isComposing === true)) return;
      markSearchOrigin();   /* 0.1.83：新查询 = 新搜索 ⇒ 以当前会话重新锚定标签基准 */
      tabQuery = elements.tabSearchInput.value;
      searchPanelCollapsed = false;
      searchActiveRow = -1;   /* T3-1：换词即复位选中（旧序号对新结果无意义） */
      searchActiveKey = '';
      searchCursor = undefined;   /* 0.1.66：换词复位"第几处"光标 */
      applyTabFilter();
      scheduleSearch();
    });
    /* 0.0.172（用户实测）：点面板外收起后，**再点回搜索框结果不回来**（只有改词才恢复）——
       聚焦即恢复（有词时）。
       0.1.79（用户报①）：空查询同样恢复——空查询的面板=「最近搜索」历史（T3-4），
       旧写法"空查询直接 return"让空查询一旦被收起后无任何路径叫回历史。 */
    elements.tabSearchInput.addEventListener('focus', () => {
      if (!searchPanelCollapsed) return;
      searchPanelCollapsed = false;
      /* 0.1.74：点回搜索框恢复结果时，同样把「视野中」居中，并且不自动弹预览。 */
      searchPanelUserScrolled = false;
      renderSearchResults();
      centerSearchPanelOnInView();
    });
    /* 双保险：真实点击一定先来 pointerdown（不依赖 focus 事件的触发条件）。 */
    elements.tabSearchInput.addEventListener('pointerdown', () => {
      if (!searchPanelCollapsed) return;
      searchPanelCollapsed = false;
      /* 0.1.74：点回搜索框恢复结果时，同样把「视野中」居中，并且不自动弹预览。 */
      searchPanelUserScrolled = false;
      renderSearchResults();
      centerSearchPanelOnInView();
    });
    elements.tabSearchInput.addEventListener('keydown', (event) => {
      /* 0.1.80：**组合期的键一律不管**——中文输入法里 Enter/Esc/方向键都在选词（keyCode 229），
         抢过来会导致"选词把面板关掉/直接跳走"（规范：组合期 IME 按键 keyCode 必须为 229）。 */
      if (searchComposing || event.isComposing === true || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.stopPropagation(); closeTabSearch(); return; }
      /* 0.1.65（T3-1）：结果面板键盘导航——↑/↓ 选行、Enter 跳选中行（未选时保持旧行为=首个内容命中）。
         输入框是单行，↑/↓ 本无用途，拦下不损原有输入习惯。 */
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter') {
        const rows = [...elements.tabSearchResults.querySelectorAll('.tab-search-hit')];
        if (event.key !== 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          if (rows.length === 0) return;
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          const from = searchActiveRow < 0 ? (delta > 0 ? -1 : rows.length) : searchActiveRow;
          searchActiveRow = Math.max(0, Math.min(rows.length - 1, from + delta));
          /* 0.1.94：↑/↓ 选中同步记 id（面板重排后按 id 复位，不再按序号残留）。 */
          searchActiveKey = String(rows[searchActiveRow].dataset.session || '') + '~' + String(rows[searchActiveRow].dataset.mid || '');
          rows.forEach((row, index) => row.classList.toggle('tab-search-hit-active', index === searchActiveRow));
          /* 0.1.75（复查）：只滚**内层滚动容器**的最小必要距离——scrollIntoView 可能连带滚动外层文档。 */
          const navScroller = searchHitsScroller();
          const navRow = rows[searchActiveRow];
          const navTop = navRow.offsetTop;
          const navBottom = navTop + navRow.offsetHeight;
          if (navTop < navScroller.scrollTop) { searchPanelScrollStamp = performance.now(); navScroller.scrollTop = navTop; }
          else if (navBottom > navScroller.scrollTop + navScroller.clientHeight) { searchPanelScrollStamp = performance.now(); navScroller.scrollTop = navBottom - navScroller.clientHeight; }
          refreshSelectedPeek();
          return;
        }
        event.stopPropagation();
        /* 0.1.80：Enter = 提交点（E 方案）——立即把当前词落进历史（不再等停笔计时）。 */
        flushSearchHistory();
        /* 0.1.66（用户反馈①）：Enter **逐处跳**——有光标就下一处（Shift+Enter 上一处），
           同一消息走完它的 N 处再进下一条结果，到头循环并轻提示。
           显式用 ↑/↓ 选中的行优先（跳到该行第一处），选中行与光标同行时则继续往前走。 */
        const selectedRow = searchActiveRow >= 0 ? rows[searchActiveRow] : undefined;
        const selectedMid = selectedRow === undefined ? '' : String(selectedRow.dataset.mid || '');
        const selectedSession = selectedRow === undefined ? '' : String(selectedRow.dataset.session || '');
        if (selectedRow !== undefined && selectedMid !== '' && (searchCursor === undefined || searchCursor.mid !== selectedMid || searchCursor.sessionId !== selectedSession)) {
          selectedRow.click();
          return;
        }
        if (stepSearchCursor(event.shiftKey === true)) return;
        /* 顺序表为空（面板从未渲染/已被清空）时才回退到"点选中行"——上面两条已覆盖其余情形。 */
        if (selectedRow !== undefined) { selectedRow.click(); return; }
      } else return;
      const query = tabQuery.trim();
      if (query === '') return;
      /* 优先跳内容命中（与结果面板首条一致）；无内容命中时退回首个标题匹配。 */
      const firstHit = searchHitsFor(query.toLowerCase())[0];
      if (firstHit !== undefined) { jumpToSessionHit(firstHit.sessionId, query); return; }
      const list = (state && state.sessions) || [];
      const lower = query.toLowerCase();
      const match = list.find(s => tabTitleOf(s).toLowerCase().includes(lower));
      if (match !== undefined) vscode.postMessage({ type: 'select-session', sessionId: match.id });
    });
    /* 0.0.72（用户反馈）: 新增/恢复/切换会话后，把新标签与活动标签一起滚进可视范围。
       0.0.80（用户反馈①）: 旧实现"并集超宽时左对齐"，会让相距很远的新标签仍留在右侧不可见 →
       改为两级：① 优先保证 priority（新增标签，缺省=活动标签）可见；② 若全部目标能同屏再扩展为并集可见。 */
    let lastActiveTabId;
    function revealTabs(nodes, priorityNode) {
      /* 0.0.167（B4 P1-5）：搜索过滤中的标签 display:none（rect 全 0）——不参与滚动计算，
         否则"显示全部"帧会被零矩形拉偏。 */
      const targets = nodes.filter(target => target !== undefined && target.isConnected && target.offsetWidth > 0);
      if (targets.length === 0) return;
      const priority = priorityNode !== undefined && priorityNode.isConnected ? priorityNode : targets[targets.length - 1];
      const strip = tabsEl.getBoundingClientRect();
      const margin = 6;
      const max = tabsEl.scrollWidth - tabsEl.clientWidth;
      const priorityRect = priority.getBoundingClientRect();
      let delta = 0;
      if (priorityRect.right > strip.right - margin) delta = priorityRect.right - (strip.right - margin);
      if (priorityRect.left - delta < strip.left + margin) delta = priorityRect.left - (strip.left + margin);
      const rects = targets.map(target => target.getBoundingClientRect());
      const left = Math.min(...rects.map(rect => rect.left));
      const right = Math.max(...rects.map(rect => rect.right));
      if (right - left <= strip.width - margin * 2) {
        if (right - delta > strip.right - margin) delta = right - (strip.right - margin);
        if (left - delta < strip.left + margin) delta = left - (strip.left + margin);
      }
      if (delta === 0) return;
      tabsEl.scrollLeft = Math.max(0, Math.min(max, tabsEl.scrollLeft + delta));
    }
    function renderSessionTabs() {
      const list = (state && state.sessions) || [];
      const currentId = state && state.sessionId;
      const previousIds = new Set(tabNodes.keys());
      const seen = new Set();
      for (const s of list) seen.add(s.id);
      for (const [id, node] of [...tabNodes]) { if (!seen.has(id)) { node.remove(); tabNodes.delete(id); } }
      const moved = list.map(item => item.id).join(',') !== lastTabOrder;
      /* 0.0.147: 最小宽度设置变化（含外部 Ctrl+, 改动）→ 全部标签重算宽度。 */
      const minWidthNow = tabMinWidth();
      const minWidthChanged = minWidthNow !== lastTabMinWidth;
      lastTabMinWidth = minWidthNow;
      for (const s of list) {
        let node = tabNodes.get(s.id);
        if (!node) { node = buildTab(s); tabNodes.set(s.id, node); }
        if (moved || node.parentNode !== tabsEl) {
          /* G24: the tab strip follows state.sessions order. 0.0.36 (bug⑪): 顺序不变时跳过
             移动（同位置 append 是 no-op 但每次仍触发遍历）；顺序变化的帧用 moveBefore 原子
             移动——Chromium 133+ 保留 :hover/focus（appendChild 的隐式 remove+insert 是
             moveBefore() 博客点名的状态丢失来源，造成运行时 ✎ 反复消失）。
             0.0.36 修补 (bug⑫): moveBefore 对【未挂载节点】移动进已连接父节点抛
             HierarchyRequestError（MDN/React 源码实证；insertBefore 则容忍）——首次渲染帧
             lastTabOrder 为空 → moved=true → 新 tab 全走 moveBefore → 第一帧即抛错且
             lastTabOrder 永不赋值 → tab 全消失。仅"已挂载→已挂载"的原位移动用 moveBefore。 */
          if (node && node.parentNode === tabsEl && typeof tabsEl.moveBefore === 'function') tabsEl.moveBefore(node, null);
          else tabsEl.append(node);
        }
        updateTab(node, s, currentId);
        /* 0.0.147: 设置变化帧强制重算宽度（标签文字没变时 updateTab 不会碰宽度）。 */
        if (minWidthChanged) setTabWidth(node, sessionTitles[s.id] || s.title);
      }
      lastTabOrder = list.map(item => item.id).join(',');
      /* 0.0.167（B4 P1-5）：搜索过滤态下新增/移除会话 → 过滤结果与计数同步刷新。 */
      if (tabQuery !== '') applyTabFilter();
      const addedTabs = list.filter(s => !previousIds.has(s.id)).map(s => tabNodes.get(s.id));
      if (currentId !== lastActiveTabId || addedTabs.length > 0) {
        revealTabs([...addedTabs, tabNodes.get(currentId)], addedTabs[0] ?? tabNodes.get(currentId));
      }
      lastActiveTabId = currentId;
    }
    /* E1: wheel scrolls the tab strip horizontally; hands the event back to the page at the edges */
    tabsEl.addEventListener('wheel', (e) => {
      if (e.deltaY === 0) return;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
      const max = tabsEl.scrollWidth - tabsEl.clientWidth;
      if (max <= 0) return;
      const prev = tabsEl.scrollLeft;
      const next = Math.min(max, Math.max(0, prev + e.deltaY * unit));
      tabsEl.scrollLeft = next;
      if (next !== prev) e.preventDefault();
    }, { passive: false });
    /* G5 v9: 拖到 strip 空白处 = 移到末尾（tab 上的 drop 已 stopPropagation，这里只接空白区） */
    tabsEl.addEventListener('dragover', (event) => {
      if (dragSourceId === undefined) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    });
    tabsEl.addEventListener('drop', (event) => {
      if (dragSourceId === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      if (!(event.target instanceof Element) || !event.target.closest('.session-tab')) {
        vscode.postMessage({ type: 'reorder-sessions', sessionId: dragSourceId });
      }
      dragSourceId = undefined;
      for (const el of document.querySelectorAll('.session-tab.drag-source, .session-tab.drag-over')) {
        el.classList.remove('drag-source', 'drag-over');
      }
    });
    /* E4 motion picker removed (0.0.63): 动效档位改由设置面板掌控（set-config → animationStyle 通道）。 */
    /* recycle bin (toolbar rightmost): restore or permanently purge trashed conversations */
    const recycleWrap = document.querySelector('.recycle-wrap');
    const recycleTrigger = document.getElementById('recycleSession');
    const recycleMenu = document.getElementById('recycleMenu');
    const recycleCount = document.getElementById('recycleCount');
    function closeRecycleMenu() { recycleMenu.hidden = true; recycleTrigger.setAttribute('aria-expanded', 'false'); }
    /* Running sessions stream state at frame rate; rebuild menu items on
       content change only, otherwise mid-click rows are re-created. */
    let recycleMenuMark = '';
    /* 0.0.147（用户反馈②）：其他项目回收站条目数——菜单底部提示行用；列表本体只含本项目。 */
    function recycleOthersCount() {
      const value = state ? state.recycleOthers : undefined;
      return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
    }
    function recycleMarkKey() {
      return JSON.stringify([(state && state.recycle) || [], recycleOthersCount()]);
    }
    function updateRecycleBadge() {
      const recycle = (state && state.recycle) || [];
      recycleCount.textContent = String(recycle.length);
      recycleCount.classList.toggle('hidden', recycle.length === 0);
      /* 计数只算本项目；其他项目条目数变化同样触发菜单重渲染（提示行文案含 N）。 */
      const mark = recycleMarkKey();
      if (mark !== recycleMenuMark) {
        recycleMenuMark = mark;
        if (!recycleMenu.hidden) renderRecycleMenuItems();
      }
    }
    function relativeAge(ts) {
      if (!ts) return '';
      const s = Math.max(0, (Date.now() - ts) / 1000);
      if (s < 60) return '刚刚';
      if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
      if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
      if (s < 86400 * 30) return Math.floor(s / 86400) + ' 天前';
      const d = new Date(ts);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function renderRecycleMenuItems() {
      const recycle = (state && state.recycle) || [];
      recycleMenu.textContent = '';
      /* 0.0.147：其他项目条目提示行（本项目为空也显示——"记录还在，只是不在这"。 */
      function appendOthersHint() {
        const others = recycleOthersCount();
        if (others <= 0) return;
        const hint = document.createElement('div');
        hint.className = 'ds-group recycle-others';
        hint.textContent = '另有 ' + String(others) + ' 条其他项目的记录（切到对应项目可见）';
        recycleMenu.append(hint);
      }
      if (!recycle.length) {
        const empty = document.createElement('div'); empty.className = 'ds-option'; empty.setAttribute('role', 'option');
        const t = document.createElement('span'); t.className = 'ds-option-title'; t.textContent = '回收站为空';
        empty.append(t); empty.style.opacity = '.6'; recycleMenu.append(empty);
        appendOthersHint();
        recycleMenuMark = recycleMarkKey();
        return;
      }
      const gh = document.createElement('div'); gh.className = 'ds-group'; gh.textContent = '已回收的会话';
      recycleMenu.append(gh);
      for (const r of recycle) {
        const row = document.createElement('div'); row.className = 'ds-option'; row.setAttribute('role', 'option');
        const title = document.createElement('span'); title.className = 'ds-option-title'; title.textContent = r.title;
        const time = document.createElement('span'); time.className = 'ds-option-time'; time.textContent = relativeAge(r.lastMessageAt);
        const revive = document.createElement('button'); revive.type = 'button'; revive.className = 'ds-option-act';
        revive.title = '恢复会话'; revive.setAttribute('aria-label', '恢复会话');
        revive.innerHTML = '<svg viewBox="0 0 24 24"><path d="M11 5 6 10l5 5"/><path d="M6 10h8a4 4 0 0 1 4 4"/></svg>';
        revive.addEventListener('click', (e) => {
          /* keep the menu open: batch restore several conversations; the row
             is dropped by the content-change reconcile in updateRecycleBadge */
          e.stopPropagation();
          vscode.postMessage({ type: 'restore-session', sessionId: r.id });
        });
        const del2 = document.createElement('button'); del2.type = 'button'; del2.className = 'ds-option-del';
        del2.title = '永久删除'; del2.setAttribute('aria-label', '永久删除');
        del2.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19"/></svg>';
        del2.addEventListener('click', (e) => {
          e.stopPropagation();
          openDelete(r.id);
        });
        row.append(title, time, revive, del2);
        recycleMenu.append(row);
      }
      appendOthersHint();
      recycleMenuMark = recycleMarkKey();
    }
    recycleTrigger.addEventListener('click', () => { if (recycleMenu.hidden) { recycleMenu.hidden = false; renderRecycleMenuItems(); recycleTrigger.setAttribute('aria-expanded', 'true'); } else closeRecycleMenu(); });
    if (recycleWrap) document.addEventListener('click', (e) => { if (!recycleWrap.contains(e.target)) closeRecycleMenu(); });
    /* session rename (local display titles) */
    const renamePopup = document.getElementById('renamePopup'); const renameInput = document.getElementById('renameInput');
    let pendingRenameId = '';
    function openRename(id) {
      if (!state) return;
      const sessionId = typeof id === 'string' && id ? id : state.sessionId;
      if (!sessionId) return;
      pendingRenameId = sessionId;
      const currentLabel = (sessionTitles[sessionId]) || (state.sessions || []).find(s => s.id === sessionId)?.title || '新建会话';
      renameInput.value = currentLabel;
      renamePopup.classList.remove('hidden');
      renameInput.focus(); renameInput.select();
    }
    function closeRename() { renamePopup.classList.add('hidden'); pendingRenameId = ''; }
    try {
      document.getElementById('renameCancel').addEventListener('click', closeRename);
      document.getElementById('renameOk').addEventListener('click', () => {
        const title = renameInput.value.trim();
        /* 0.1.0 修复（用户实测）：**清空 = 恢复默认名**（运行时给的名字）——此前空值被静默忽略，
           改名后再也回不到原名称。扩展侧收到空串会删掉本地改名并刷新为投影名。 */
        if (pendingRenameId) vscode.postMessage({ type: 'rename-session', sessionId: pendingRenameId, title });
        closeRename();
      });
      renameInput.addEventListener('keydown', (e) => { const k = e['key'] || ''; if (k === 'Enter') document.getElementById('renameOk').click(); if (k === 'Escape') closeRename(); });
      document.addEventListener('click', (e) => { if (!renamePopup.contains(e.target)) closeRename(); });
    } catch (_) { /* rename ui is optional; never block the chat view */
      renamePopup.classList.add('hidden');
    }
    /* 0.0.148（G53）：轨道节点标注弹窗（重命名弹窗同款样式）。
       0.0.156（用户反馈）：标注与收藏**独立**——确定=存标注（不改收藏）；空文本=删除标注（已收藏则金色保留）。 */
    const markPopup = document.getElementById('markPopup'); const markInput = document.getElementById('markInput');
    let pendingMarkKey = '';
    function openMarkNote(turnIndex) {
      if (typeof renderedSessionId !== 'string' || renderedSessionId === '') return;
      const exact = railMarkKeyOf(turnIndex);
      if (exact === undefined) return;
      /* 已有标注（含对账命中的键）→ 就地更新该键；无标注 → 写入精确键。 */
      const hit = railMarkQuery(turnIndex);
      pendingMarkKey = hit !== undefined ? hit.key : exact;
      markInput.value = hit !== undefined ? (hit.note || '') : '';
      markPopup.classList.remove('hidden');
      markInput.focus(); markInput.select();
    }
    function closeMark() { markPopup.classList.add('hidden'); pendingMarkKey = ''; }
    try {
      document.getElementById('markCancel').addEventListener('click', closeMark);
      document.getElementById('markOk').addEventListener('click', () => {
        const note = markInput.value.trim().slice(0, 60);
        const key = pendingMarkKey; closeMark();
        if (key !== '' && typeof renderedSessionId === 'string' && renderedSessionId !== '') {
          const marks = viewMemoOf(renderedSessionId).marks;
          if (note === '') marks.delete(key); else marks.set(key, note);
          applyRailMarks();
          scheduleViewStatePersist(renderedSessionId);
        }
      });
      markInput.addEventListener('keydown', (e) => { const k = e['key'] || ''; if (k === 'Enter') document.getElementById('markOk').click(); if (k === 'Escape') closeMark(); });
      document.addEventListener('click', (e) => { if (!markPopup.contains(e.target)) closeMark(); });
    } catch (_) { /* mark ui is optional; never block the chat view */
      markPopup.classList.add('hidden');
    }
    /* session delete (local store removal; runtime has no delete RPC) */
    const deletePopup = document.getElementById('deletePopup');
    let pendingDeleteId = '';
    function openDelete(id) {
      if (!state || !id || state.phase !== 'ready') return;
      pendingDeleteId = id;
      deletePopup.classList.remove('hidden');
    }
    function closeDelete() { deletePopup.classList.add('hidden'); pendingDeleteId = ''; }
    try {
      document.getElementById('deleteCancel').addEventListener('click', closeDelete);
      document.getElementById('deleteOk').addEventListener('click', () => {
        const id = pendingDeleteId; closeDelete();
        if (id) vscode.postMessage({ type: 'purge-session', sessionId: id });
      });
      /* outside-click only; the per-option × already stops propagation */
      document.addEventListener('click', (e) => { if (!deletePopup.contains(e.target)) closeDelete(); });
    } catch (_) { /* delete ui is optional; never block the chat view */
      deletePopup.classList.add('hidden');
    }
    window.addEventListener('message', event => {
      if (event.data.type === 'session-titles') {
        sessionTitles = event.data.titles || {};
        if (state && state.sessions) {
          elements.sessions.replaceChildren();
          for (const session of state.sessions) elements.sessions.append(new Option(sessionTitles[session.id] || session.title, session.id, false, session.id === state.sessionId));
          if (!elements.sessions.childElementCount) elements.sessions.append(new Option('新建会话', ''));
        }
        renderSessionTabs();
      }
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`
}
