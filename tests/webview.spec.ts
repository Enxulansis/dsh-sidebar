import { describe, expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'

function mainScript(html: string): string {
  const matches = [...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)]
  return matches[matches.length - 1]?.[1] ?? ''
}

import type * as vscode from 'vscode'
import { chatHtml, rasterizeTarget } from '../src/webview.js'
import { FILE_TYPE_ICON_EXT, FILE_TYPE_ICON_DATA, FILE_TYPE_ICON_DEFAULT } from '../src/file-type-icons.js'
import MarkdownIt from 'markdown-it'
  function runWebviewScript(g15md?: any): { api: any; getEl: (id: string) => any } {
      const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
      const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
      const html = chatHtml(webview, mark)
    const script = mainScript(html)
      const src = script + '\n;globalThis.__c1dom = { renderUsage, usageStatsSummary, usageStatsLine, cacheHitColor, renderSummarySpans, priceKeyFor, renderMarkdown, mathSegments, renderMarkdownVendor, canSoftUpdate, mathEncode, messageFallbackNode, blockPlainText, tsvToCsv, BLOCK_ACTIONS, flashCopied, sanitizeFileName, viewMemoOf, seedViewMemo, openPanel: (v) => { usageOpen = v; } };'

      const makeEl = (id = '', tag = ''): any => {
        const el: any = {
          id,
          tag,
          tagName: tag.toUpperCase(),
          style: {},
          children: [],
          className: '',
          dataset: {},
          style: { setProperty() {} },
          title: '',
          hidden: false,
          disabled: false,
          checked: false,
          value: '',
          classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
          append(...ns: any[]) { el.children.push(...ns); },
          appendChild(n: any) { el.children.push(n); return n; },
          replaceChildren(...ns: any[]) { el.children = [...ns]; },
          insertBefore(n: any) { el.children.push(n); return n; },
          removeChild(n: any) { const i = el.children.indexOf(n); if (i >= 0) el.children.splice(i, 1); return n; },
          setAttribute() {},
          getAttribute() { return null; },
          addEventListener() {},
          removeEventListener() {},
          focus() {},
          blur() {},
          click() {},
          setSelectionRange() {},
          closest() { return null; },
          contains() { return false; },
          querySelectorAll() { return []; },
          querySelector() { return null; },
          scrollIntoView() {},
          remove() {},
          dataset: {},
          parentElement: null,
        }
        let _text = ''
        Object.defineProperty(el, 'textContent', {
          get() {
            if (_text || !el.children.length) return _text
            let out = ''
            for (const c of el.children) out += c && c.textContent ? String(c.textContent) : ''
            return out
          },
          set(v: string) { _text = v; el.children = []; },
        })
        return el
      }
      const els: Record<string, any> = {}
      const messageHandlers: Array<(event: any) => void> = []
      const sent: Array<any> = []
      const documentStub = {
        getElementById(id: string) { return els[id] || (els[id] = makeEl(id)) },
        createElement(tag: string) { return makeEl('', tag) },
        createTextNode(t: string) { return { textContent: t, nodeType: 3 } },
        addEventListener() {},
        removeEventListener() {},
        body: makeEl('body'),
        querySelector() { return null; },
        querySelectorAll() { return []; },
      }
      const windowStub = {
        addEventListener(type: string, handler: (event: any) => void) { if (type === 'message') messageHandlers.push(handler) },
        removeEventListener() {},
        matchMedia() { return { matches: false, addEventListener() {}, remove() {} }; },
        requestAnimationFrame() { return 0; },
        setInterval() { return 0; },
        setTimeout() { return 0; },
        clearInterval() {},
        clearTimeout() {},
        scrollTo() {},
        location: { href: '' },
        /* G15 防回归：真实环境 vendor 存在时 renderMarkdownVendor 必须被调用（曾在
           惰性重构后残留 MDV 引用 → ReferenceError → 无条件回退 legacy，测试盲区漏检） */
        __g15md: undefined as any,
      }
      ;(windowStub as any).__g15md = g15md ?? undefined
      const vscodeStub = { postMessage(msg: any) { sent.push(msg) }, getState() { return {}; }, setState() {} }
      class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }

      try {
        new Function('document', 'window', 'acquireVsCodeApi', 'localStorage', 'Intl', 'requestAnimationFrame', 'setTimeout', 'console', 'ResizeObserver', src)(
          documentStub,
          windowStub,
          () => vscodeStub,
          { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
          Intl,
          windowStub.requestAnimationFrame,
          windowStub.setTimeout,
          console,
          ResizeObserverStub,
        )
      } catch (e) {
        throw new Error('webview init failed: ' + (e as Error).message)
      }
      return {
        api: (globalThis as any).__c1dom,
        getEl: (id: string) => els[id],
        sent,
        dispatch(data: any) { for (const h of messageHandlers) h({ data }) },
      }
    }



describe('chat webview', () => {
  it('emits valid browser JavaScript', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)
    const script = mainScript(html)

    expect(script).toBeDefined()
    expect(() => new Function(script ?? '')).not.toThrow()
  })

  it('exposes A7 runtime motion elements, keyframes and accessibility rules', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)

    expect(html).toContain('id="a7-progress"')
    expect(html).toContain('id="a7-thinking"')
    expect(html).toContain('@keyframes a7-shimmer')
    expect(html).toContain('body.vscode-reduce-motion *')
  })

  it('exposes session trash/restore/purge with running marker and recycle bin', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)
    const script = mainScript(html)

    expect(html).toContain('id="deletePopup"')
    expect(html).toContain('删除此会话？此操作无法撤销。')
    expect(script).toContain('tab-run')
    expect(script).toContain("'trash-session'")
    expect(script).toContain("'restore-session'")
    expect(script).toContain("'purge-session'")
    expect(script).toContain("openDelete(r.id)")
    expect(html).toContain('id="recycleSession"')
    expect(script).toContain("'回收站为空'")
  })

  it('exposes E1 session tab strip; E4 motion moved into the settings panel (0.0.63)', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)
    const script = mainScript(html)

    expect(html).toContain('id="sessionTabs"')
    expect(html).toContain('class="session-tabs"')
    expect(html).not.toContain('id="motionToggle"')
    expect(html).not.toContain('id="motionMenu"')
    expect(html).not.toContain('id="renameSession"')
    expect(script).toContain("'session-tab'")
    expect(script).toContain("'tab-action'")
    expect(script).toContain('openRename(s.id)')
    expect(script).not.toContain("'set-motion'")
    expect(script).not.toContain('MOTION_OPTIONS')
    expect(script).toContain('动效档位')
    expect(script).toContain('renderSessionTabs()')
    /* motion 菜单选中不再画 √（用户 2026-08-30 要求，高亮即可、宽度 112） */
    expect(script).not.toContain('ds-option-check')
    /* 回收站菜单常开：sessions 高频流式更新时只能按内容变化重建，防回退到"每帧重建" */
    expect(script).toContain('recycleMenuMark')
    /* 回收站每行显示"最后消息距今"时间（快照 summary.updatedAt） */
    expect(script).toContain('relativeAge')
    /* running sessions stream state at frame rate; the tab strip must be
       reconciled in place, never rebuilt wholesale (mid-click deletes were lost) */
    expect(script).toContain('tabNodes')
    expect(script).not.toContain('tabsEl.textContent')
    /* G24 (0.0.17): the tab strip re-appends existing nodes every pass so a
       reordered sessions list (restored session settled right of the current
       tab) actually relocates tabs in the DOM */
    expect(script).toContain('tabsEl.append(node)')
    /* G14 (2026-09-01): hover-only actions — hidden state must not reserve
       the 32px slot, otherwise short labels get wide empty padding */
    expect(html).toContain('.tab-actions { display: flex; gap: 2px; flex: 0 0 0; width: 0;')
    expect(html).not.toContain('.session-tab.running .tab-actions')
    expect(html).toContain('color: var(--vscode-descriptionForeground); font-size: 13px;')
    /* G14 fix (0.0.14): hover state must also reset width, otherwise
       flex-basis:auto resolves against the hidden width:0 and the
       buttons collapse to slivers (× invisible) */
    expect(html).toContain('flex: 0 0 auto; width: auto;')
    /* G14 v2 (0.0.15): fixed tab width from label estimate — hover actions
       compress the title instead of stretching the tab (edge-tab safe).
       0.0.147: 最小宽度改设置驱动（默认 112；旧 68px 悬停时 ✎/✕ 占满标签）。 */
    expect(script).toContain('const TAB_MAX_W = 150')
    expect(script).toContain('const TAB_MIN_WIDTH_FALLBACK = 112')
    expect(script).toContain('labelWidth(label)')
    expect(script).toContain('setTabWidth(tab, label)')
    expect(html).toContain('height: 26px; box-sizing: border-box; padding: 2px 2px 2px 8px')
    expect(html).toContain('.tab-action { width: 22px; height: 22px;')
    /* G5 v7/v8: ✕ (U+2715) 细长叉替代 × (U+00D7) 乘号（26px 放大笔画仍细，v8 用户嫌 200% 太大
       调回 13px 与 ✎ 统一）；padding 归零使 13px glyph 在 22px 框内精确居中（原 0 0 2px 会把 glyph 推上 1px） */
    expect(script).toContain("del.textContent = '✕'")
    expect(html).toContain('width: 22px; height: 22px; padding: 0; border: 0; border-radius: 4px;')
    /* G14 v2 fix (still 0.0.15): actions must sit flush right inside a
       fixed-width tab even when the label is short (margin-left:auto) */
    expect(html).toContain('margin-left: auto;')
  })

  it('G5 v9: 除会话 tab 删除按钮外，其余关闭按钮统一为 ✕（U+2715），不再用 ×（U+00D7）', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const script = mainScript(chatHtml(webview, mark))

    expect(script).toContain("'attachment-remove', '✕'")
    expect(script).toContain("'plan-chip-close', '✕'")
    expect(script).toContain("'context-remove', '✕'")
    /* 缩放倍率文案里的 × 是乘法符号，不是关闭按钮——保持不动 */
    expect(script).not.toContain("'attachment-remove', '×'")
    expect(script).not.toContain("'context-remove', '×'")
    expect(script).not.toContain("'plan-chip-close', '×'")
  })

  it('G5 v9: 会话 tab 拖拽排序——draggable + drag-over 指示 + reorder-sessions 消息', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)
    const script = mainScript(html)

    expect(script).toContain('tab.draggable = true')
    expect(script).toContain("'reorder-sessions'")
    expect(script).toContain('dragSourceId')
    expect(script).toContain("'drag-over'")
    expect(html).toContain('.session-tab.drag-over')
  })

  it('G5 v12: 附件/上下文 ✕ 只移 glyph 不移框——padding 2px/2px 居中 + 字号 13px 对齐对话栏', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)

    expect(html).toContain('.context-remove, .attachment-remove { width: 18px; height: 18px; padding: 2px 0 2px;')
    expect(html).toContain('font-size: 13px; line-height: 1;')
    expect(html).not.toContain('position: relative; top: 1px')
    expect(html).not.toContain('.attachment-chip:has(.attach-thumb)')
  })

  it('G15: vendors a second nonce script slot for the markdown pipeline', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)

    /* 主脚本 + 图片 codec + G15 vendor 脚本 + G45 颜色工具 + G50 原文映射（测试环境 __dirname 无 dist 文件 → 空注入，但槽位必须存在） */
    expect((html.match(/<script nonce="/g) || []).length).toBe(5)
    /* CSP 远程图放行（markdownImages 开关的传输面） */
    expect(html).toContain('img-src vscode-webview: data: https:')
    /* 0.0.36 修补 (字体): font-src 缺省回退 default-src 'none' → KaTeX data: 字体被拦截（
       0.0.34 K1 验证在无 CSP 的 demo 页通过，真 webview 从未加载过字体——盲区） */
    expect(html).toContain('font-src vscode-webview: data:')
  })

  it('exposes attachment intake (include-context toggle, paste and drop handlers)', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const script = mainScript(chatHtml(webview, mark))

    expect(script).toContain("'toggle-include-context'")
    expect(script).toContain("addEventListener('paste'")
    expect(script).toContain("'pin-file-uris'")
    expect(script).toContain("'paste-files'")
  })

  it('exposes G25/G26 preview controls (reset button + pan clamp)', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)
    const script = mainScript(html)

    /* G25: reset button (fit + center) — pointerdown must not reach the pan handler */
    expect(html).toContain('id="previewReset"')
    expect(html).toContain('.preview-action {')
    expect(script).toContain("previewReset.addEventListener('pointerdown'")
    /* G26 (方案 B) → 0.0.80: 夹紧改为「至少保留 PREVIEW_KEEP_VISIBLE px 可见」——旧式
       pw/2 + 0.6·视口 允许小图完整飞出屏幕（用户实测"缩小后图不见了"），且会顶掉光标锚点缩放。 */
    expect(script).toContain('clampPreviewPan()')
    expect(script).toContain('PREVIEW_KEEP_VISIBLE')
    /* G15 0.0.33: 链接可点（open-link）+ 任务列表类名（vendor 修复） */
    expect(script).toContain("'open-link', href")
    expect(script).toContain("classList.add('task-list-item')")
    expect(script).toContain("'contains-task-list'")
    /* G27 round3 (0.0.51): 有序列表保留 start——两位数起始列表（'10.'）渲染时
       ol.setAttribute('start', start)，不丢弃 start 导致从 1 编号 */
    expect(script).toContain("const start = t.attrGet && t.attrGet('start')")
    expect(script).toContain("ol.setAttribute('start', start)")
  })

  it('uses append-only output and streaming paths', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const script = mainScript(chatHtml(webview, mark))

    expect(script).toContain('controller.append(event.data.page.message')
    expect(script).not.toContain('renderedMessages.delete(event.data.messageId)')
    expect(script).not.toContain('value.startsWith(stream.text)')
    expect(script).not.toContain('rendered.node.replaceWith')
    expect(script).toContain("pendingMessageAppends.set(append.id")
    expect(script).toContain("target.textContent += continuation.textContent")
  })

  it('detaches tail following before loading earlier history', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const script = mainScript(chatHtml(webview, mark))
    const historyClick = script.indexOf("button.addEventListener('click'")
    const detachTail = script.indexOf('detachConversationTail();', historyClick)
    const requestHistory = script.indexOf("vscode.postMessage({ type: 'load-history' })", historyClick)

    expect(historyClick).toBeGreaterThanOrEqual(0)
    expect(detachTail).toBeGreaterThan(historyClick)
    expect(detachTail).toBeLessThan(requestHistory)
  })

  it('updates tail following from every scroll source', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const script = mainScript(chatHtml(webview, mark))

    expect(script).toContain("elements.scroll.addEventListener('scroll', synchronizeConversationTail")
    expect(script).toContain('if (conversationNearBottom()) followConversationTail = true;')
    /* 0.0.131：唯一的 wheel 监听是"滚到顶自动加载更早消息"（滚轮在顶部不再产生 scroll 事件），
       它不参与尾巴跟随；尾巴跟随必须仍只挂在 scroll 上。 */
    expect(script).toContain("elements.scroll.addEventListener('wheel', (event) => {")
    expect(script).toContain('maybeAutoLoadHistory();')
    expect(script).not.toContain("addEventListener('wheel', synchronizeConversationTail")
  })

  describe('G15 vendor dispatch', () => {
    it('uses the vendor pipeline when window.__g15md exists (no legacy fallback)', () => {
      let parsed = false
      const fakeMd = { parse: () => { parsed = true; return [] } }
      const { api } = runWebviewScript({ createMd: () => fakeMd })
      const out = api.renderMarkdown('**bold** 文本')
      expect(parsed).toBe(true)
      expect(out.className).toBe('markdown')
    })
  })

  describe('G15 math scanner (state machine)', () => {
    it('splits inline, display and paren math and keeps $ escapes as text', () => {
      const { api } = runWebviewScript()
      const firstMath = (t: string) => api.mathSegments(t).find((s: any) => s.type === 'math')
      expect(firstMath('半径 $r$ 的圆')).toMatchObject({ type: 'math', display: false, tex: 'r' })
      expect(firstMath('$$\\sum_a^b x$$ 块')).toMatchObject({ type: 'math', display: true, tex: '\\sum_a^b x' })
      expect(firstMath('\\(a+b\\) 行')).toMatchObject({ type: 'math', display: false, tex: 'a+b' })
      expect(api.mathSegments('转义 \\$5 元').every(s => s.type === 'text')).toBe(true)
      expect(api.mathSegments('转义 \\$5 元')[0].text).toBe('转义 $5 元')
    })

    it('keeps price ambiguities and unclosed delimiters as plain text', () => {
      const { api } = runWebviewScript()
      expect(api.mathSegments('花费 $5 与 $6').every(s => s.type === 'text')).toBe(true)
      expect(api.mathSegments('未闭合 $x^2 + y^2 =').every(s => s.type === 'text')).toBe(true)
    })

    it('preserves double-backslash row breaks inside matrix math', () => {
      const { api } = runWebviewScript()
      const seg = api.mathSegments('矩阵 $\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$').find((s: any) => s.type === 'math')
      expect(seg.type).toBe('math')
      expect(seg.tex).toContain('\\\\')
    })
  })

  describe('G15 bug-⑨⑩ hardening (0.0.36)', () => {
    it('renders a table followed by a paragraph through walkBlocks (table_close stack guard)', () => {
      /* 回归: walkBlocks 曾把根栈 pop 掉 → 表格后任何 block 触发 TypeError → 整条消息静默降级 legacy */
      const { api } = runWebviewScript({ createMd: () => new MarkdownIt() })
      const root = api.renderMarkdownVendor('| A | B |\n| - | - |\n| 1 | 2 |\n\nText after')
      expect(root.className).toBe('markdown')
      expect(root.children[0].className).toBe('table-wrap')
      expect(root.children[1].tag).toBe('p')
      expect(root.children[1].textContent).toBe('Text after')
    })

    it('keeps lone surrogates inside math from aborting the vendor render', () => {
      /* 回归: encodeURIComponent 曾在 try 外对孤立代理项抛 URIError → 该帧渲染中断、之后每帧重抛 */
      const { api } = runWebviewScript({ createMd: () => new MarkdownIt() })
      expect(() => api.renderMarkdownVendor('公式 $a\uD83D$ 结尾')).not.toThrow()
    })

    it('encodes markdown-significant chars inside math placeholders (no emphasis split)', () => {
      /* 回归: encodeURIComponent 不转义 * _ ( ) ! ~ ' → 占位符被强调规则拆散 → PUA 乱码 */
      const { api } = runWebviewScript({ createMd: () => new MarkdownIt() })
      const root = api.renderMarkdownVendor('公式 $*x*$ 说明')
      expect(String(root.textContent)).toBe('公式 *x* 说明')
      const p = root.children[0]
      expect(p.children.some((c: any) => String(c.className) === 'math')).toBe(true)
    })

    it('keeps settle soft-updates eligible and percent-encodes math payload chars', () => {
      const { api } = runWebviewScript()
      const base = { role: 'assistant', text: 'hi', streaming: true }
      expect(api.canSoftUpdate(base, { ...base, streaming: false })).toBe(true)
      expect(api.mathEncode('*x_()~')).toBe('%2Ax%5F%28%29%7E')
      expect(() => api.mathEncode('$a\uD83D$')).toThrow()
    })

    it('hardens per-frame chrome: ide-context fingerprint, tab order skip, moveBefore and settle finalize', () => {
      const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
      const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
      const script = mainScript(chatHtml(webview, mark))
      expect(script).toContain('ideContextFingerprint')
      expect(script).toContain('lastTabOrder')
      expect(script).toContain('moveBefore')
      /* 0.0.36 修补 (bug⑫): moveBefore 只能用于已挂载节点的原位移动（否则 HierarchyRequestError
         → 首帧全 tab 消失）——条件必须有 parentNode 挂载守卫 */
      expect(script).toContain('parentNode === tabsEl && typeof tabsEl.moveBefore')
      expect(script).toContain("appendMarkdownStream(rendered.markdown, '', false)")
    })
  })

  describe('G15 batch-2 rendering isolation (0.0.37)', () => {
    it('builds a plain-text fallback node for a failed message render', () => {
      const { api } = runWebviewScript()
      const fallback = api.messageFallbackNode({ id: 'x', role: 'assistant', text: '原文内容' })
      expect(String(fallback.className)).toContain('render-failed')
      expect(fallback.children[0].className).toBe('message-head')
      const body = fallback.children[1]
      expect(body.className).toBe('message-body')
      /* children[0] = render-failed-note 提示；children[1] = 原文 streaming-plain */
      expect(body.children[0].textContent).toContain('渲染失败')
      expect(body.children[1].textContent).toBe('原文内容')
    })

    it('isolates failing messages per-id with one-time render-message reports', () => {
      const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
      const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
      const script = mainScript(chatHtml(webview, mark))
      expect(script).toContain('renderFailedIds')
      expect(script).toContain("vscode.postMessage({ type: 'webview-error', message: 'render-message:' +")
      /* 单条失败不再拖垮整帧: reconcile 内每消息 try/catch + 会话清场点同步清 renderFailedIds */
      expect(script).toContain('renderFailedIds.clear()')
    })
  })

  describe('G15 table align + task checkbox polish (0.0.37)', () => {
    it('applies text-align from markdown-it table tokens (center/right)', () => {
      const { api } = runWebviewScript({ createMd: () => new MarkdownIt() })
      const root = api.renderMarkdownVendor('| 列一 | 列二 | 列三 |\n| --- | :--: | ---: |\n| x | y | z |\n')
      const table = root.children[0].children[0]
      const headRow = table.children[0].children[0]
      const bodyRow = table.children[1].children[0]
      expect(headRow.children[1].style.textAlign).toBe('center')
      expect(headRow.children[2].style.textAlign).toBe('right')
      expect(bodyRow.children[1].style.textAlign).toBe('center')
      expect(bodyRow.children[2].style.textAlign).toBe('right')
      expect(headRow.children[0].style.textAlign).toBeUndefined()
    })

    it('styles checkboxes with a high-contrast custom checked state', () => {
      const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
      const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
      const html = chatHtml(webview, mark)
      expect(html).toContain('appearance: none')
      expect(html).toContain('input[type=checkbox]:checked')
      expect(html).toContain('background-size: 11px')
    })
  })

  describe('C1 cache-hit coloring (DOM level)', () => {
    const usage = {
      available: true,
      percent: 6,
      usedTokens: 59000,
      contextWindow: 942000,
      sessionStats: { turns: 1, steps: 4, ttftSteps: 4, ttftMs: 3600, decodeMs: 40000, decodeTokens: 4284, llmMs: 0, toolMs: 0 },
      tokenUsage: { uncachedInputTokens: 35060, cacheReadTokens: 64940, cacheWriteTokens: 0, outputTokens: 87900 },
    }

    it('maps hit rate to a continuous hue (monotonic across the old breakpoints)', () => {
      const { api } = runWebviewScript()
      const hueOf = (pct: number) => Number(String(api.cacheHitColor(pct)).match(/hsl\(([\d.]+)/)?.[1] ?? 'NaN')
      /* G3 (2026-09-01): 四档跳变 → 连续渐变；色相单调不减且不再有档位跳变 */
      expect(hueOf(64.94)).toBeLessThan(hueOf(80))
      expect(hueOf(80)).toBeLessThan(hueOf(90))
      expect(hueOf(90)).toBeLessThan(hueOf(97))
      expect(hueOf(97)).toBeLessThan(hueOf(100))
      expect(api.cacheHitColor(80)).toContain('hsl(')
      expect(api.cacheHitColor(120)).toBe(api.cacheHitColor(100))
      expect(api.cacheHitColor(-5)).toBe(api.cacheHitColor(0))
    })

    it('colors the 64.94% segment (inline hsl) inside the persistent usage line', () => {
      const { api, getEl } = runWebviewScript()

      api.renderUsage({ usage })
      const st = getEl('usageStats')
      const inner = st.children[1]
      const hits = inner.children.find((c: any) => c.style && String(c.style.color).startsWith('hsl('))

      expect(hits?.style.color).toContain('hsl(')
      expect(hits?.textContent).toBe('缓存命中 64.94%')
      expect(inner.textContent).toBe('1 轮 · 4 步 | 首 token 平均 0.9s · 107.1 tok/s | 缓存命中 64.94% | 输入 100K tok · 输出 87.9K tok')
    })

    it('still colors when the template literal rewritten past will not swallow escapes', () => {
      // 回归：2026-08-31 曾把 [\d.]+ 顺手写成 [d.]+（模板字符串内单反斜杠被求值折叠），
      // 浏览器端 match 不到数字 → 无上色。此断言保证 match 模式以双反斜杠写回。
      const { api } = runWebviewScript()
      const c = { children: [], className: '', classList: { add() {}, remove() {}, toggle() {} }, appendChild(n: any) { this.children.push(n); return n; } }
      api.renderSummarySpans(c, '1 轮 · 32 步 | 缓存命中 89.04% | 输入 1.7M tok', true)
      const hits = c.children.find((x: any) => x.style && String(x.style.color).startsWith('hsl('))
      expect(hits?.style.color).toContain('hsl(')
    })

    it('selects the price table from the selected model', () => {
      const { api } = runWebviewScript()
      expect(api.priceKeyFor([{ model: 'deepseek-v4-flash', selected: true }])).toBe('flash')
      expect(api.priceKeyFor([{ model: 'deepseek-v4-flash-vision-exp', selected: true }])).toBe('flash')
      expect(api.priceKeyFor([{ model: 'deepseek-v4-flash' }, { model: 'deepseek-v4-pro', selected: true }])).toBe('pro')
      expect(api.priceKeyFor([{ label: 'DeepSeek-V4-Pro-Think', selected: true }])).toBe('pro')
      expect(api.priceKeyFor([{ model: 'deepseek-v4-flash', selected: false }])).toBe('flash')
      expect(api.priceKeyFor([])).toBe('flash')
      expect(api.priceKeyFor(undefined)).toBe('flash')
    })

    it('prices the estimate with the selected model (0.0.85 官方现行价：flash 0.02/1/4、pro 0.15/4.5/13.5 谷价)', () => {
      const { api, getEl } = runWebviewScript()
      const panelCost = () => {
        const panel = getEl('usagePanel')
        const sec = panel.children.find((c: any) => String(c.className).includes('usage-cost'))
        const firstRow = sec.children[1].children[0]
        return Number(String(firstRow.children[1].textContent).replace('¥', ''))
      }
      /* 峰谷不影响比值断言：两族同处一个时段，比值由桶构成决定（新价三桶倍率不同：7.5× / 4.5× / 3.375×） */
      const expected = (price: { hit: number; miss: number; out: number }) => (
        (usage.tokenUsage.cacheReadTokens + usage.tokenUsage.cacheWriteTokens) / 1e6 * price.hit
        + usage.tokenUsage.uncachedInputTokens / 1e6 * price.miss
        + usage.tokenUsage.outputTokens / 1e6 * price.out
      )

      api.openPanel(true)
      api.renderUsage({ usage, models: [{ model: 'deepseek-v4-flash', selected: true }] })
      const flashCost = panelCost()
      api.renderUsage({ usage, models: [{ model: 'deepseek-v4-pro', selected: true }] })
      const proCost = panelCost()

      /* 峰/谷价 2 倍关系 → 允许实际时段对应的两套期望值之一 */
      const flashOk = [expected({ hit: 0.02, miss: 1, out: 4 }), expected({ hit: 0.04, miss: 2, out: 8 })]
      const proOk = [expected({ hit: 0.15, miss: 4.5, out: 13.5 }), expected({ hit: 0.3, miss: 9, out: 27 })]
      expect(flashOk.some((value) => Math.abs(flashCost - value) < 0.05)).toBe(true)
      expect(proOk.some((value) => Math.abs(proCost - value) < 0.05)).toBe(true)
      expect(proCost).toBeGreaterThan(flashCost)
    })
  })

  describe('C5 markdown table rendering (DOM level)', () => {
    it('renders a full table into table-wrap/table/thead/tbody', () => {
      const { api } = runWebviewScript()
      const root = api.renderMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |\n')
      const wrap = root.children[0]
      expect(wrap.className).toBe('table-wrap')
      expect(wrap.tag).toBe('div')
      const table = wrap.children[0]
      expect(table.tag).toBe('table')
      const thead = table.children[0]
      expect(thead.tag).toBe('thead')
      const headRow = thead.children[0]
      expect(headRow.tag).toBe('tr')
      const thA = headRow.children[0]
      expect(thA.tag).toBe('th')
      expect(thA.textContent).toBe('A')
      expect(headRow.children[1].textContent).toBe('B')
      const tbody = table.children[1]
      expect(tbody.tag).toBe('tbody')
      const bodyRow = tbody.children[0]
      expect(bodyRow.tag).toBe('tr')
      expect(bodyRow.children[0].textContent).toBe('1')
      expect(bodyRow.children[1].textContent).toBe('2')
      expect(root.children.length).toBe(1)
    })

    it('falls back to paragraphs when there is no separator row', () => {
      const { api } = runWebviewScript()
      const root = api.renderMarkdown('| A | B |\n| 1 | 2 |\n\nNext\n')
      expect(root.children.length).toBe(2)
      expect(root.children[0].tag).toBe('p')
      expect(root.children[0].textContent).toBe('| A | B |\n| 1 | 2 |')
      expect(root.children[1].tag).toBe('p')
      expect(root.children[1].textContent).toBe('Next')
    })

    it('renders inline markup inside table cells', () => {
      const { api } = runWebviewScript()
      const root = api.renderMarkdown('| **Bold** | `code` |\n| --- | --- |\n| x | y |\n')
      const thA = root.children[0].children[0].children[0].children[0].children[0]
      expect(thA.tag).toBe('th')
      expect(thA.children.some((c: any) => String(c.tag) === 'strong')).toBe(true)
      const thCode = root.children[0].children[0].children[0].children[0].children[1]
      expect(thCode.tag).toBe('th')
      expect(thCode.children.some((c: any) => String(c.tag) === 'code')).toBe(true)
    })

    it('keeps a paragraph after a table', () => {
      const { api } = runWebviewScript()
      const root = api.renderMarkdown('| A | B |\n| - | - |\n| 1 | 2 |\n\nText after\n')
      expect(root.children.length).toBe(2)
      expect(root.children[1].tag).toBe('p')
      expect(root.children[1].textContent).toBe('Text after')
    })
  })

  describe('G17 image rasterization targets', () => {
    it('classifies rasterizable formats by mime and extension', () => {
      expect(rasterizeTarget('photo.bmp', undefined)).toBe('image/bmp')
      expect(rasterizeTarget('PHOTO.BMP', '')).toBe('image/bmp')
      expect(rasterizeTarget('photo.bmp', 'image/bmp')).toBe('image/bmp')
      expect(rasterizeTarget('icon.ico', undefined)).toBe('image/vnd.microsoft.icon')
      expect(rasterizeTarget('icon.ico', 'image/x-icon')).toBe('image/x-icon')
      expect(rasterizeTarget('photo.avif', undefined)).toBe('image/avif')
      expect(rasterizeTarget('scan.tif', undefined)).toBe('image/tiff')
      expect(rasterizeTarget('scan.tiff', undefined)).toBe('image/tiff')
      expect(rasterizeTarget('pic.svg', undefined)).toBe('image/svg+xml')
      expect(rasterizeTarget('pic.png', undefined)).toBeUndefined()
      expect(rasterizeTarget('pic.jpg', 'image/jpeg')).toBeUndefined()
      expect(rasterizeTarget('pic.unknown', undefined)).toBeUndefined()
    })

    it('embeds the rasterize pipeline in the webview script with protocol-native passthrough', () => {
      const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
      const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
      const html = chatHtml(webview, mark)
    const script = mainScript(html)

      expect(script).toContain("'rasterize-image'")
      expect(script).toContain("'rasterize-image-result'")
      expect(script).toContain('rasterizeTiff')
      expect(script).toContain('"image/bmp"')
      expect(script).toContain('"image/vnd.microsoft.icon"')
      expect(script).toContain('"image/tiff"')
      expect(script).toContain('"image/svg+xml"')
      expect(script).toContain("'image/png', 'image/jpeg', 'image/webp', 'image/gif'")
      expect(script).not.toContain('rasterizeSvg')
      expect(script).not.toContain('svg-to-png')
      /* codec 以第二个 <script nonce> 注入；主 script 仍由第一个匹配提取，互不干扰 */
      expect((html.match(/<script nonce="/g) ?? []).length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('G18 optimistic echo reclamation (Y+ interceptor)', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)
    const script = mainScript(html)

    it('claims only a newly echoed server message, never server history', () => {
      expect(script).toContain('lastUserMessage(messages)')
      expect(script).toContain('claimedEchoIds.has(serverUser.id)')
      /* anchor guard: without it the last historical user message would FIFO-claim
         the fresh bubble on every interim render (e.g. agentPreset updates) */
      expect(script).toContain('serverUser.id === lastEchoAnchorId')
      expect(script).not.toContain("forEach(bubble => bubble.remove())")
    })

    it('matches by text first and falls back FIFO for rewritten text and image-only sends', () => {
      expect(script).toContain("(bubble.dataset.echo || '') === serverText")
      expect(script).toContain('claim = bubbles[0]')
    })

    it('upgrades the claimed bubble in place instead of removing and re-rendering it', () => {
      /* 2026-09-01 闪烁修复: 精确匹配的乐观气泡不清除, 登记为 optimistic 条目原地升级 */
      expect(script).toContain('renderedMessages.set(serverUser.id, { node: claim, message: serverUser, optimistic: true })')
      expect(script).toContain("classList.remove('optimistic')")
      expect(script).toContain('delete articleEl.dataset.echo')
    })

    it('soft-updates image sources on hydration frames instead of rebuilding the node', () => {
      /* 2026-09-01 闪烁修复: attachment data 补齐帧只同步 img src, 不重建 article/img (避免重解码闪帧) */
      expect(script).toContain('canSoftUpdate(rendered.message, message)')
      /* 0.0.55（反馈③）: src 相同 → 零操作（不重解码）；src 变化 → 连同绑定一起刷新 */
      expect(script).toContain('if (!img || img.src === src) continue;')
      expect(script).toContain('bindImageCard(card, image);')
      expect(script).toContain('data 未就绪: 保留现图')
    })

    it('exempts .optimistic bubbles from the tail sweep so they survive until reclaimed', () => {
      expect(script).toContain("cursor.classList.contains('optimistic')")
    })

    it('resets reclamation state on session switch and full state updates', () => {
      expect((script.match(/claimedEchoIds\.clear\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2)
      expect(script).toContain('lastEchoAnchorId = undefined')
    })

    it('renders draft images into the optimistic bubble and allows image-only sends', () => {
      expect(script).toContain('!text && !draftImages.length')
      /* G29 (0.0.54): 乐观气泡改为 .msg-text + .msg-row 同构结构（回显升级前后 DOM 一致） */
      expect(script).toContain("const body = node('div', 'message-body');")
      expect(script).toContain("const textEl = node('div', 'msg-text', text ? String(text) : '');")
      expect(script).toContain("const row = node('div', 'msg-row');")
      /* 0.0.79（GIF②④）: 乐观回显与发送形态一致——选了帧展开成一帧一张 PNG */
      expect(script).toContain('const echoImages = [];')
      expect(script).toContain('for (const image of draftImages) {')
      expect(script).toContain('renderImageCards(body, echoImages);')
      /* 0.0.55（反馈③）: 预览点击改读卡片实时绑定（__image），不再闭包捕获建卡时 src */
      expect(script).toContain('const live = card.__image;')
      /* 0.0.167（B4 P2）：同容器图组随打开参数下传（跨图切换候选）。 */
      expect(script).toContain('if (liveSrc !== undefined) openImagePreview(liveSrc, messageGalleryOf(card));')
    })
  })

  describe('0.0.56 audit fixes (send guard / echo seq / convert clamp / error detail)', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const script = mainScript(chatHtml(webview, mark))

    it('guards send re-entry until the draft is drained (audit P1-2)', () => {
      expect(script).toContain('let sendInFlight = false;')
      expect(script).toContain('if (sendInFlight) return;')
      expect(script).toContain('function clearSendInFlightIfDrained()')
      expect(script).toContain('if (draftImages.length === 0 && !hasPinnedFiles() && elements.prompt.value.trim() === \'\') sendInFlight = false;')
      /* draft-images 帧（扩展已受理并清空草稿）→ 解锁 */
      expect(script).toContain("if (event.data.type === 'draft-images') { draftImages = event.data.images || []; renderAttachments(); clearSendInFlightIfDrained(); }")
      /* 兜底超时解锁 */
      expect(script).toContain('window.setTimeout(() => { sendInFlight = false; }, 8000);')
    })

    it('tags each optimistic bubble with its send sequence (audit P1-2/P2-6)', () => {
      expect(script).toContain("vscode.postMessage({ type: 'send', text, mode: mode || 'queue', echoSeq });")
      expect(script).toContain('function appendOptimisticEcho(mode, echoSeq)')
      expect(script).toContain("if (typeof echoSeq === 'number') bubble.dataset.echoSeq = String(echoSeq);")
      // Retirement across active/cached/pending roots is exercised by the actual
      // cross-session cancellation test, rather than locking one selector implementation.
    })

    it('stashes a failed cross-session send into the origin draft slot (audit P1-1 webview side)', () => {
      expect(script).toContain("const restore = record(event.data.restore);")
      expect(script).toContain('draftSlots.set(restore.sessionId, { text: string(restore.text), images });')
      expect(script).toContain('publishDraftState();')
    })

    it('clamps the PNG conversion canvas to a safe edge (audit P1-5)', () => {
      expect(script).toContain('const PNG_CONVERT_MAX_EDGE = 4096;')
      expect(script).toContain('const scale = natural > PNG_CONVERT_MAX_EDGE ? PNG_CONVERT_MAX_EDGE / natural : 1;')
      expect(script).toContain('c.drawImage(img, 0, 0, width, height);')
    })

    it('reports error location and stack head to the output channel (audit P2-11)', () => {
      expect(script).toContain("const where = String(event.filename || '') + ':' + String(event.lineno || 0);")
      expect(script).toContain("(event.message || 'Unknown webview error') + ' @' + where")
    })
  })

  describe('G29 user message auto-fold (0.0.54)', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const script = mainScript(chatHtml(webview, mark))

    it('defaults foldCfg from state with pre-0.0.60 fallbacks (G6 0.0.60)', () => {
      expect(script).toContain('function foldCfg()')
      expect(script).toContain('const s = (state && state.foldSettings) || {};')
      expect(script).toContain("previewLines: typeof s.previewLines === 'number' && s.previewLines >= 1 && s.previewLines <= 20 ? s.previewLines : 4")
      expect(script).toContain("triggerRatio: typeof s.triggerRatio === 'number' && s.triggerRatio >= 0.1 && s.triggerRatio <= 3 ? s.triggerRatio : 0.5")
      expect(script).toContain("minFoldExtraLines: typeof s.minFoldExtraLines === 'number' && s.minFoldExtraLines >= 0 && s.minFoldExtraLines <= 50 ? s.minFoldExtraLines : 3")
      expect(script).toContain("minChars: typeof s.minChars === 'number' && s.minChars >= 0 && s.minChars <= 20000 ? s.minChars : 100")
    })

    it('wraps user text in .msg-text inside a .msg-row gutter row', () => {
      expect(script).toContain("if (message.role === 'user') { textEl = node('div', 'msg-text', String(message.text || '')); body.append(textEl); }")
      expect(script).toContain("const row = message.role === 'user' ? node('div', 'msg-row') : undefined;")
      expect(script).toContain('item.append(head, row || body);')
      /* D1 探针（动作行按需建）：行改经 mountMessageActions 挂载（形态门控；默认路径 = 原行为）。 */
      expect(script).toContain('mountMessageActions(item, message);')
      expect(script).toContain('markFoldDirty(textEl, messageHasAttachments(item))')
    })

    it('updates .msg-text on optimistic upgrade instead of body text nodes (no duplication)', () => {
      expect(script).toContain("const textEl = body.querySelector('.msg-text');")
      expect(script).toContain('if (textEl && textEl.textContent !== text) textEl.textContent = text;')
      /* 回归护栏：旧的"首子节点文本节点"写法必须不存在 */
      expect(script).not.toContain('body.childNodes[0]')
      expect(script).not.toContain('body.insertBefore(document.createTextNode(text), body.firstChild)')
    })

    it('measures full height (two-pass) against half the viewport before folding', () => {
      expect(script).toContain("d.article.classList.remove('msg-folded')")
      expect(script).toContain("d.full = d.article.querySelector('.message-body').offsetHeight;")
      expect(script).toContain('const threshold = Math.max(viewport * cfg.triggerRatio, d.lineHeight * (cfg.previewLines + cfg.minFoldExtraLines));')
      expect(script).toContain("setMsgFold(d.article, d.textEl, d.full > threshold ? 'folded' : 'plain')")
      expect(script).toContain('function viewportHeight() { return elements.scroll.clientHeight; }')
    })

    it('marks only dirty elements so streaming frames never measure', () => {
      expect(script).toContain("textEl.dataset.foldDirty = '1';")
      expect(script).toContain("if (textEl.dataset.foldDirty !== '1') continue;")
      expect(script).toContain("textEl.dataset.manual === '1') return;")
      expect(script).toContain("if (textEl.dataset.manual === '1') continue;")
    })

    it('pins the toggle in the gutter and scrolls the message back on manual collapse', () => {
      expect(script).toContain("const row = article.querySelector('.msg-row');")
      expect(script).toContain('if (row && row.firstElementChild !== btn) row.prepend(btn);')
      expect(script).toContain("btn.innerHTML = '<span class=\"fold-label\">' + (folded ? '展开' : '收起') + '</span>'")
      expect(script).toContain("article.scrollIntoView({ block: 'nearest' })")
      expect(script).toContain("btn.setAttribute('aria-expanded', folded ? 'false' : 'true');")
    })

    it('re-evaluates folds when the viewport (not the content) resizes', () => {
      expect(script).toContain('entries.some(entry => entry.target === elements.scroll)')
      expect(script).toContain('markAllFoldsDirty()')
    })

    it('styles the gutter toggle as top-sticky and compacts folded attachments to 40px', () => {
      const html = chatHtml(webview, mark)
      /* 0.0.55（反馈⑦）: 改顶挂——自然位=气泡左上（展开零位移），滚动时钉在视口顶部 */
      expect(html).toContain('.msg-fold-toggle { position: sticky; z-index: 3; top: 8px;')
      expect(html).not.toContain('.msg-fold-toggle { position: sticky; z-index: 3; bottom: 8px;')
      expect(html).toContain('.user .msg-row { display: flex; align-items: flex-start;')
      expect(html).toContain('max-height: calc(var(--msg-fold-lines, 4) * 1.65em);')
      expect(html).toContain('mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent);')
      expect(html).toContain('.message.user.msg-folded .file-card { width: 40px; height: 40px; flex: 0 0 40px; border-radius: 6px; }')
    })

    it('guards the custom context menu while the image preview is open or just closed (0.0.55 反馈②)', () => {
      expect(script).toContain('if (previewContextActive) return;')
    })

    it('resolves image/file cards before message-level in the context menu (0.0.55 反馈②补)', () => {
      /* 顺序守卫：0.0.48 起消息级菜单插在图片级之前，气泡里的图片/文件永远只能拿到"复制该消息" */
      const cardIdx = script.indexOf('const ctx = ctxMenuFor(event.target);')
      const msgIdx = script.indexOf("const article = event.target.closest && event.target.closest('article.message');")
      expect(cardIdx).toBeGreaterThan(-1)
      expect(msgIdx).toBeGreaterThan(-1)
      expect(cardIdx).toBeLessThan(msgIdx)
      expect(script).toContain('function buildCtxMenuOptions(ctx)')
    })

    it('uses display names for card context actions and offers original-format copy on bubbles (0.0.55 反馈③⑧)', () => {
      /* 图片卡绑定统一走 bindImageCard（建卡 + 同步两处共用）；0.0.58 起 ctx 带 attachmentId（复制原格式按 id 取留档原图） */
      expect(script).toContain('function bindImageCard(card, image) {')
      expect(script).toContain("card.__ctx = { kind: 'image', mediaType: string(image.mediaType), name: displayFileName(string(image.name, '图片')) || '图片', data: string(image.data), attachmentId: string(image.attachmentId) };")
      expect(script).toContain("card.__ctx = { kind: 'file', name: displayFileName(name) || name, path: string(file.path) };")
      expect(script).toContain("type: 'copy-image-original', id: ctx.id, name: ctx.name, data: ctx.data, attachmentId: ctx.attachmentId")
    })

    it('offers copy-as-PNG for image files on file cards and glows images on hover (0.0.55 反馈②⑤)', () => {
      expect(script).toContain('IMAGE_FILE_RE')
      expect(script).toContain("options.push(ctxMenuOption('复制图片(PNG)', () => vscode.postMessage({ type: 'copy-file-as-image', path: ctx.path, name: ctx.name })));")
      const html = chatHtml(webview, mark)
      /* 反馈⑤四次: hover 色统一为草稿栏文件 chip 的 hover 色（charts-blue 45% 混色）；
         图片卡用 outline（inset shadow 会被 img 盖住 → "jpg 没有 hover"）。 */
      expect(html).toContain('.image-card:hover { outline: 1px solid color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, var(--vscode-widget-border)); outline-offset: -1px; }')
      expect(html).toContain('.attachment-chip:hover { border-color: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, var(--vscode-widget-border)); }')
      expect(html).toContain('.file-card:hover { border-color: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, var(--vscode-widget-border)); }')
      expect(html).not.toContain('.image-card:hover { box-shadow: inset')
    })

    it('converts webp/avif to PNG in-webview before clipboard copy (0.0.55 反馈②二次)', () => {
      /* .NET 无法解码 webp（运行时把带元数据的上传图归一化为 WebP）→ 复制 PNG 必失败；
         本侧先经 canvas 转 PNG 再交给扩展端。 */
      expect(script).toContain('NEEDS_PNG_CONVERT')
      expect(script).toContain('function convertToPngDataUrl(src)')
      expect(script).toContain('async function copyImageAsPng(ctx)')
      expect(script).toContain("const pngOption = () => ctxMenuOption('复制 PNG', () => { void copyImageAsPng(ctx); });")
      /* G6 (0.0.60): imageCopyFormat 决定两档次序（两档都保留） */
      expect(script).toContain("if (state && state.imageCopyFormat === 'png') options.push(pngOption(), originalOption());")
      expect(script).toContain('else options.push(originalOption(), pngOption());')
    })

    it('shows an in-sidebar toast and drops the optimistic bubble on send failure (0.0.55 反馈①⑥)', () => {
      expect(script).toContain('function showToast(text, warn)')
      expect(script).toContain("if (event.data.type === 'toast' && typeof event.data.text === 'string') showToast(event.data.text, event.data.warn === true);")
      expect(script).toContain("if (event.data.type === 'send-failed')")
      expect(script).toContain("const bubbles = elements.messages.querySelectorAll('.optimistic');")
    })

    it('sanitizes attachment names at ingestion and keeps escapes intact (0.0.55 反馈①补)', () => {
      expect(script).toContain('function sanitizeFileName(raw)')
      expect(script).toContain('name: sanitizeFileName(file.name)')
      /* 模板折叠陷阱守卫：生成脚本里必须是转义序列文本，而不是裸控制字符 */
      expect(script).toContain('\\u0000-\\u001f\\u007f')
      expect(script.includes('\u0000')).toBe(false)
    })

    it('sanitizeFileName decodes percent-encoded clipboard names and strips unsafe chars (0.0.55 反馈①补)', () => {
      const { api } = runWebviewScript()
      const fn = api.sanitizeFileName
      expect(fn('%E6%88%AA%E5%9B%BE.png')).toBe('截图.png')
      expect(fn('https://example.com/a/%E5%9B%BE%E7%89%87.jpg')).toBe('图片.jpg')
      expect(fn('  普通 名称.png  ')).toBe('普通 名称.png')
      expect(fn('100%.png')).toBe('100%.png')          // 非编码的 % 不误伤
      expect(fn('a/b:c*d?.png')).toBe('a_b_c_d_.png')  // 非法文件名字符
      expect(fn('')).toBe('')
    })

    it('keeps .conversation overflow:clip so the sticky toggle can pin (sticky guard)', () => {
      const html = chatHtml(webview, mark)
      /* 0.1.27：内容列宽度改由 CSS 变量驱动（ui.contentMaxWidth，-1=无上限）；overflow:clip 的 sticky 守卫不变。 */
      expect(html).toContain('.conversation { width: 100%; min-width: 0; max-width: var(--content-max, 760px); margin: 0 auto; padding: 12px 14px 30px; overflow: clip; }')
      expect(html).not.toContain('padding: 12px 14px 30px; overflow: hidden; }')
    })
  })

  describe('G19 per-session draft slot isolation (DOM level)', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const script = mainScript(chatHtml(webview, mark))
    const imgA = { id: 'img-1', name: 'a.png', mediaType: 'image/png', data: 'data:image/png;base64,AAAA' }
    const imgB = { id: 'img-2', name: 'b.png', mediaType: 'image/png', data: 'data:image/png;base64,BBBB' }
    const baseState = (sessionId: string, sessions?: Array<{ id: string }>) => ({
      sessionId,
      phase: 'ready',
      messages: [],
      sessions: sessions || [{ id: 'sA' }, { id: 'sB' }, { id: 'sC' }],
    })

    it('saves the outgoing draft into a per-session slot and restores it on return', () => {
      const { getEl, sent, dispatch } = runWebviewScript()
      dispatch({ type: 'state', state: baseState('sA') })
      getEl('prompt').value = 'draft A'
      dispatch({ type: 'state', state: baseState('sB') })
      expect(getEl('prompt').value).toBe('')
      expect(sent.filter(m => m.type === 'sync-draft-images').at(-1)?.images).toEqual([])
      dispatch({ type: 'state', state: baseState('sA') })
      expect(getEl('prompt').value).toBe('draft A')
    })

    it('snapshots image attachments into the slot and syncs them back to the extension', () => {
      const { getEl, sent, dispatch } = runWebviewScript()
      dispatch({ type: 'state', state: baseState('sA') })
      dispatch({ type: 'draft-images', images: [imgA] })
      getEl('prompt').value = 'with image'
      dispatch({ type: 'state', state: baseState('sB') })
      expect(getEl('attachments').children.length).toBe(0)
      dispatch({ type: 'state', state: baseState('sA') })
      expect(getEl('prompt').value).toBe('with image')
      expect(getEl('attachments').children.some((c: any) => c.className === 'attachment-chip')).toBe(true)
      expect(sent.filter(m => m.type === 'sync-draft-images').at(-1)?.images).toEqual([imgA])
    })

    it('keeps slots independent across three sessions and clears B on send', () => {
      const { getEl, sent, dispatch } = runWebviewScript()
      dispatch({ type: 'state', state: baseState('sA') })
      getEl('prompt').value = 'A text'
      dispatch({ type: 'state', state: baseState('sB') })
      getEl('prompt').value = 'B text'
      dispatch({ type: 'draft-images', images: [imgB] })
      dispatch({ type: 'state', state: baseState('sC') })
      expect(getEl('prompt').value).toBe('')
      dispatch({ type: 'state', state: baseState('sB') })
      expect(getEl('prompt').value).toBe('B text')
      expect(sent.filter(m => m.type === 'sync-draft-images').at(-1)?.images).toEqual([imgB])
      /* 发送 = 提交: UI 已清（send 清文本 + draft-images [] 清图），切走 flush 到的就是空槽 */
      getEl('prompt').value = ''
      dispatch({ type: 'draft-images', images: [] })
      dispatch({ type: 'state', state: baseState('sA') })
      dispatch({ type: 'state', state: baseState('sB') })
      expect(getEl('prompt').value).toBe('')
    })

    it('skips saving a slot whose session was deleted', () => {
      const { getEl, dispatch } = runWebviewScript()
      dispatch({ type: 'state', state: baseState('sA') })
      getEl('prompt').value = 'orphan'
      /* A 已删: flush 时不在 state.sessions → 不写槽; 若日后残存 id 重用则回填空 */
      dispatch({ type: 'state', state: baseState('sB', [{ id: 'sB' }]) })
      dispatch({ type: 'state', state: baseState('sA', [{ id: 'sB' }]) })
      expect(getEl('prompt').value).toBe('')
    })

    it('adopts the first frame without restoring or syncing (no focus steal, no empty overwrite)', () => {
      const { sent, dispatch } = runWebviewScript()
      dispatch({ type: 'state', state: baseState('sA') })
      expect(sent.some(m => m.type === 'sync-draft-images')).toBe(false)
      /* 首帧仅记 sessionId; 无槽可恢复, prompt 保持初始空 */
      dispatch({ type: 'state', state: baseState('sA') })
      expect(sent.some(m => m.type === 'sync-draft-images')).toBe(false)
    })

    it('embeds the slot pipeline and per-session map in the webview script', () => {
      expect(script).toContain('draftSlots')
      expect(script).toContain('lastDraftSessionId')
      expect(script).toContain("'sync-draft-images'")
      expect(script).toContain('draftSlots.get(')
      /* 32 槽上限淘汰最旧（Map 插入序） */
      expect(script).toContain('draftSlots.size > 32')
    })
  })

  describe('G10 Material file-type badge icons', () => {
    it('embeds the ext→key→base64 tables in the webview script', () => {
      const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
      const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
      const html = chatHtml(webview, mark)
    const script = mainScript(html)

      expect(script).toContain('FILE_TYPE_ICON_EXT')
      expect(script).toContain('FILE_TYPE_ICON_DATA')
      expect(script).toContain('FILE_TYPE_ICON_DEFAULT')
      expect(script).toContain('data:image/svg+xml;base64,')
      expect(script).toContain('fileTypeIconEl(')
      /* 旧文本缩写映射整段移除 */
      expect(script).not.toContain('const badgeMap')
      expect(script).not.toContain("'PY': 'PY'")
      /* 新增脚本仍是合法 JS（既有语法校验用例同样覆盖） */
      expect(() => new Function(script)).not.toThrow()
    })

    it('maps 116 extensions to 45 Material icons with a base64 default', () => {
      expect(Object.keys(FILE_TYPE_ICON_EXT).length).toBe(116)
      expect(FILE_TYPE_ICON_EXT).toMatchObject({
        pdf: 'pdf', docx: 'word', xlsx: 'table', pptx: 'powerpoint', md: 'markdown',
        py: 'python', js: 'javascript', ts: 'typescript', yaml: 'yaml', zip: 'zip', ps1: 'powershell',
        png: 'image', svg: 'image', dockerfile: 'docker', drawio: 'drawio',
      })
      expect(Object.keys(FILE_TYPE_ICON_DATA).length).toBe(45)
      for (const key of Object.keys(FILE_TYPE_ICON_DATA)) {
        expect(FILE_TYPE_ICON_DATA[key]).toMatch(/^data:image\/svg\+xml;base64,/)
      }
      expect(FILE_TYPE_ICON_DEFAULT).toMatch(/^data:image\/svg\+xml;base64,/)
    })
    it('strips the stored timestamp prefix for display only and wires clear-draft', () => {
      const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
      const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
      const html = chatHtml(webview, mark)
    const script = mainScript(html)

      expect(script).toContain('displayFileName(')
      expect(script).toContain(String.raw`split(/[\\/]/)`)
      expect(script).toContain(String.raw`replace(/^\d{10,}-/, '')`)
      expect(script).not.toContain('replace(/^d{10,}')
      /* 模板串内正则须 \\d（防转义吃掉反斜杠），与 currentMentionQuery 同惯例 */
      expect(script).toContain("'clear-draft'")
      expect(script).toContain('clear-trash')
      expect(script).toContain('clearDraftAll(')
      expect(script).toContain('syncDraftZoneVisibility(')
      expect(script).toContain('draftSlots.delete(lastDraftSessionId)')
      /* 草稿栏文件智慧打开（G22 同构）：file 类 chip 才挂 open-attachment */
      expect(script).toContain("'chip-file'")
      expect(script).toContain("'open-attachment'")
      expect(script).toContain("reference.kind === 'file'")
      expect(html).toContain('id="draftZone"')
      expect(() => new Function(script)).not.toThrow()
    })

    it('wires the custom context menu (file/image two variants, five new messages)', () => {
      const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
      const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
      const html = chatHtml(webview, mark)
    const script = mainScript(html)

      expect(html).toContain('id="ctxMenu"')
      expect(script).toContain("'ctx-option'")
      expect(script).toContain("'copy-text'")
      expect(script).toContain("'copy-files'")
      expect(script).toContain("'copy-image-clip'")
      expect(script).toContain("'copy-image-original'")
      expect(script).toContain("'复制原格式'")
      expect(script).toContain("'复制 PNG'")
      expect(script).toContain("'save-as'")
      expect(script).toContain("'open-with'")
      expect(script).toContain("'用其他程序打开…'")
      expect(script).toContain("'另存为…'")
      expect(script).toContain('closeCtxMenu()')
      expect(script).toContain('__ctx')
      expect(() => new Function(script)).not.toThrow()
    })
  })
})

describe('G27 copy buttons (0.0.40)', () => {
  const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
  const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri

  it('rebuilds the whole conversation when view settings change (G6 0.0.60)', () => {
    const script = mainScript(chatHtml(webview, mark))
    expect(script).toContain('const viewCfgKey = viewCfgKeyOf(current);')
    /* 0.1.21：整会话重建同时作废工作段折叠缓存（柱随容器一起没了，缓存不失效会跳过后重建）。
       2026-09-24（遗留 bug①）：重建分支拆两态——同会话且开启位置记忆时"存档 → 重建 → 按锚点恢复"
       （否则 D3 懒建的空壳期会把 scrollTop 钳到矮内容底缘、并借"近底"重开跟随而滑到底）；
       其余（切会话顺带换键 / 关位置记忆）保持纯清空。 */
    expect(script).toContain('renderedMessages.clear(); elements.messages.replaceChildren(); renderedTail = {}; invalidateWorkFoldCache();')
    expect(script).toContain('const sameSessionRender = renderedSessionId === current.sessionId;')
    expect(script).toContain('captureScrollMemo(current.sessionId, true);')
    expect(script).toContain("startViewRestore(current.sessionId, memo, memo.atBottom !== true && !followLive, 'view-cfg-rebuild')")
    expect(script).toContain('current.copySettings || null')
    expect(script).toContain('current.foldSettings || null')
    expect(script).toContain('current.imageCopyFormat || \'\'')
  })

  it('batch C (0.0.61): 文件卡转码回路 + 附带单次上限（0.0.96 起设置驱动）', () => {
    const script = mainScript(chatHtml(webview, mark))
    expect(script).toContain("event.data.type === 'convert-image-clip'")
    expect(script).toContain("vscode.postMessage({ type: 'copy-image-clip', data: png, name: string(event.data.name) });")
    /* 0.0.96（G38 批次 2 · H3）: 上限由 attach.maxFiles / attach.maxTotalMB 驱动（原固定常量移除） */
    expect(script).not.toContain('const ATTACH_MAX_FILES = 20;')
    expect(script).not.toContain('const ATTACH_MAX_TOTAL_BYTES = 100 * 1024 * 1024;')
    expect(script).toContain('function attachCfg()')
    expect(script).toContain('maxFiles: typeof s.maxFiles === \'number\' && s.maxFiles >= 1 && s.maxFiles <= 200 ? s.maxFiles : 20')
    expect(script).toContain('if (accepted >= cfg.maxFiles || totalBytes + file.size > cfg.maxTotalBytes) { overflow += 1; continue; }')
    expect(script).toContain("个文件超出单次上限（' + cfg.maxFiles + ' 个 / ' + cfg.maxTotalMB + 'MB）已跳过")
  })

  it('G6 v1 (0.0.62): 设置台面板自绘 + set-config 写通道 + dsh 只读回执', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* 0.0.63: 下拉右对齐防越界 + 自绘步进 + hover 蓝线统一（hover 不再用 focusBorder 色） */
    expect(html).toContain('z-index: 46; left: auto; right: 0;')
    expect(html).toContain('.settings-step')
    /* 0.0.167: 焦点环现在合法地出现在搜索输入框（:focus）——本断言收窄到"hover 不得用 focusBorder 色"。 */
    expect(html).not.toMatch(/:hover\s*\{[^}]*border-color:\s*var\(--vscode-focusBorder\)/)
    expect(script).toContain("settingsOpen: document.getElementById('settingsOpen')")
    expect(script).toContain("settingsPanel: document.getElementById('settingsPanel')")
    expect(script).toContain('function renderSettingsPanel()')
    expect(script).toContain("vscode.postMessage({ type: 'set-config', key, value });")
    expect(script).toContain("vscode.postMessage({ type: 'describe-dsh-settings' })")
    expect(script).toContain("vscode.postMessage({ type: 'open-vscode-settings' })")
    expect(script).toContain("vscode.postMessage({ type: 'open-dsh-settings' })")
    expect(script).toContain("event.data.type === 'dsh-settings'")
    expect(script).toContain("function settingsSwitch(")
    expect(script).toContain("function settingsEnum(")
    expect(script).toContain("function settingsNumber(")
    expect(script).toContain("'settings-stepper'")
    expect(script).toContain("'settings-step'")
    /* G6 v2 (0.0.64): dsh 配置编辑契约 */
    expect(script).toContain("vscode.postMessage({ type: 'dsh-settings-mutate', ns: namespace.ns, ops, expectedRevision: namespace.revision });")
    expect(script).toContain("input.type = 'password'")
    expect(script).toContain("'settings-restore'")
    expect(script).toContain("event.data.type === 'dsh-settings-mutated'")
    expect(html).toContain('.settings-restore')
    /* 0.0.65: 翻译词典 / 就地更新与展开保持 / 细箭头 caret */
    expect(script).toContain("'ui-conversation': '对话交互'")
    expect(script).toContain("busyEnter: '运行中发送消息'")
    expect(script).toContain("queue: '排队（等本轮结束再发送）'")
    expect(script).toContain('caret.innerHTML = CHEVRON_DOWN_SVG')
    expect(script).toContain('pendingDshEdits')
    expect(script).toContain('dshOpenNs')
    /* 0.0.66: 原始键路径 tooltip 挂到控件本体 + 下拉选项携带原始值 */
    expect(script).toContain("for (const el of wrap.querySelectorAll('.ds-trigger, input, .settings-switch'))")
    expect(script).toContain('element.title = String(option[0])')
    expect(script).toContain('if (o.title) row.title = o.title;')
    /* G6 v3 (0.0.67): 默认模型/思考档/预设专用下拉 */
    expect(script).toContain("settingsSection('默认模型与预设')")
    expect(script).toContain("'agent-default-model.model'")
    expect(script).toContain("'agent-default-model.reasoningEffort'")
    expect(script).toContain("'agent-presets.default'")
    expect(script).toContain("{ op: 'set', path: ['provider'], value: next[0] },")
    /* 0.0.68: 模型改名兜底（占位标注 / 提示行 / 档位梯子 / 显示名自愈） */
    expect(script).toContain('（当前 · 不在可用列表）')
    expect(script).toContain('当前默认模型不在该运行时提供的模型列表中（可能已改名）；建议重新选择一个可用模型。')
    expect(script).toContain('const effortSource = (selectedModel && Array.isArray(selectedModel.reasoningEfforts)')
  })

  it('0.0.96: 数字步进审查——窄小数域窄步长 / 过慢项步长 / dsh 值域兜底', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* 预览最小缩放（用户实测 bug：±1 被 min/max 夹紧成跳端点）→ 步长 0.005 */
    expect(script).toContain("postSetConfig('preview.minScale', value), 0.005)")
    /* 过慢项：豁免门槛 ±10 / 时间上下文 ±10（反馈时长 0.0.97 起为秒键，见下方用例） */
    expect(script).toContain("postSetConfig('copy.feedbackSeconds', value), 0.1)")
    expect(script).toContain("postSetConfig('fold.minChars', value), 10)")
    expect(script).toContain("postSetConfig('timeContext.refreshSeconds', value), 10)")
    /* dsh 侧未显式给步长 → 窄域（<2）按域宽推导 */
    expect(script).toContain('if (hasMin && hasMax && max - min > 0 && max - min < 2) {')
    /* 触发阈值行说明：优先级 + 保底项优先 */
    expect(script).toContain('保底项优先，比例调低不会低于它')
  })

  it('0.0.98 (G41): 轮次导航条——容器/节点样式/构建与跳转接线（0.0.99 落位修复 + 0.0.100 等分融合 + 0.0.101 命中盒/动画）', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    expect(html).toContain('id="turnRail"')
    expect(html).toContain('.turn-rail-node.active')
    expect(script).toContain('function updateTurnRail(current)')
    /* 0.0.133：节点点击带"拖拽后抑制"守卫——整列拖拽的尾随 click 不得跳转。 */
    expect(script).toContain('if (railDragSuppressClick) { railDragSuppressClick = false; return; }')
    expect(script).toContain('railJump(turn, sessionId);')
    expect(script).toContain('railStickyTarget = railScrollTo(scrollEl.scrollTop + delta, railLayout.y[turnIndex]);')
    expect(script).toContain('if (restoreCtx) restoreCtx.userTouched = true;')
    /* 0.0.127：触底跳转粘滞——高亮钉在点击的节点上，滚离落点即释放；节点加大一档（10×12 / 12×14） */
    expect(script).toContain('const sticky = railStickyIndex !== undefined && (programmaticScroll || Math.abs(scrollEl.scrollTop - railStickyTarget) <= 4);')
    expect(script).toContain('pendingRailJumpSession = state.sessionId;')
    expect(script).toContain('railStickyIndex = undefined;')
    expect(html).toContain('width: 10px; height: 12px; border-radius: 6px;')
    expect(html).toContain('width: 12px; height: 14px;')
    /* 0.1.50（A）：内容变化后的轨道更新推迟到帧末（scheduleRailUpdate）——同步入口仍保留给滚动/resize。 */
    expect(script).toContain('function scheduleRailUpdate(current) {')
    expect(script).toContain('if (progressiveFill === undefined) scheduleRailUpdate(current);')
    expect(script).toContain('updateTurnRail(state);')
    /* 0.0.99 修复：导轨显式占 row2 会让自动排布把 main/footer 挤到 row3/row4（row2 塌 0、节点 0px 不可见）
       → main/footer 显式落位 */
    expect(html).toContain('.scroll { grid-column: 1; grid-row: 2;')
    expect(html).toContain('.composer-wrap { grid-column: 1; grid-row: 3;')
    /* 0.0.100（v1.1）等分 → 0.0.124（G52 方案 B）退役：固定间距 flex 清单 + 轨道自滚（见 0.0.124 断言组）；
       0.0.101（v1.2）：跳转动画；0.0.102（v1.3）：纵向药丸（节 8×10 / 胶囊 12×16）同心 */
    /* 0.0.133：节点再右移（left 5/命中盒 12 = 药丸级）、置于加宽后的滑块之上（z-index 2 > 1）。 */
    expect(html).toContain('.turn-rail-node { pointer-events: auto; position: absolute; left: 5px; width: 12px; height: 16px; margin-top: -8px; cursor: pointer; z-index: 2; transition: top .26s linear; }')
    expect(html).toContain('.turn-rail-node::after')
    expect(html).toContain('.turn-rail-node:hover::before')
    expect(html).toContain('left: 50%; top: 50%; transform: translate(-50%, -50%)')
    expect(script).toContain('function railScrollTo(target, thumbTo, followAfter)')
    expect(script).toContain('turnRailSettings')
  })

  it('0.0.155（用户反馈）: 未激活的金/紫节点与常规节点同款半透明', () => {
    const html = chatHtml(webview, mark)
    /* 基础常规节点 opacity .55；停点/收藏规则不再写死 opacity: 1（未激活时继承 .55 变淡）。 */
    expect(html).toContain('background: var(--vscode-descriptionForeground, #9d9d9d); opacity: .55;')
    expect(html).not.toContain('var(--rail-stop-color, var(--vscode-charts-purple, #b180d7)); opacity: 1;')
    expect(html).not.toContain('var(--rail-mark-color, var(--vscode-charts-yellow, #e3b341)); opacity: 1; }')
    /* 激活态全亮：蓝色节点规则自带 opacity: 1；菱形激活规则显式写回 opacity: 1（见 0.0.151 组）。 */
    expect(html).toContain('.turn-rail-node.active::after { background: var(--vscode-charts-blue, #4d6bfe); opacity: 1;')
  })

  it('0.0.154（O3 会话加载机制）: 设置台「会话」区两行（打开即全量 + 上限）', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    expect(script).toContain("settingsSwitch(sessionHistory.loadAll !== false, value => postSetConfig('sessionHistory.loadAll', value))")
    expect(script).toContain("settingsNumber(typeof sessionHistory.maxMessages === 'number' ? sessionHistory.maxMessages : 3000, 500, 20000, value => postSetConfig('sessionHistory.maxMessages', value), 500)")
    /* 面板重渲键纳入新快照（外部 Ctrl+, 改动同步）。 */
    expect(script).toContain('current.sessionViewMemory, current.sessionHistorySettings, current.turnRailSettings')
  })

  it('0.0.151（用户三条）: 停点=紫色圆角菱形 / 收藏激活去蓝环 / 节点颜色入设置', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* ③ 停点节点=本体换形换色：紫色圆角菱形（无附加元素）；规则置于 .active 之后（同特异度后者胜出，
       激活态放大仍由 .active 尺寸规则提供）；形状=停点身份、颜色=状态、大小=当前。 */
    /* 0.0.151b（用户复测两条）：正方形旋转（正菱形，此前 10×12 矩形转 45° 长短边不等）+ 9×9 缩宽
       + 激活态单独限尺寸（10×10，防 12×14 旋转外接超界）。 */
    /* 0.0.155（用户反馈）：未激活的菱形/金节点不再恒全亮——去掉 opacity: 1（继承基础 .55），
       激活态（.stop.active）单独恢复 opacity: 1（同特异度且规则在 .active 之后，须显式写回）。 */
    expect(html).toContain('.turn-rail-node.stop::after { background: var(--rail-stop-color, var(--vscode-charts-purple, #b180d7)); border-radius: 2px; width: 9px; height: 9px; transform: translate(-50%, -50%) rotate(45deg); }')
    expect(html).toContain('.turn-rail-node.stop.active::after { width: 10px; height: 10px; opacity: 1; }')
    expect(html).not.toContain('.turn-rail-stop')
    /* ① 收藏节点激活态=金底+正常放大（蓝环退役）。 */
    expect(html).toContain('.turn-rail-node.marked.active::after { background: var(--rail-mark-color, var(--vscode-charts-yellow, #e3b341)); }')
    expect(html).not.toContain('box-shadow: 0 0 0 2px var(--vscode-charts-blue')
    /* ③ 颜色设置：复用公式颜色的取色组件（色板/调色盘/RGB/HSL/Hex）+ CSS 变量写入。 */
    expect(script).toContain("settingsColorPicker(typeof turnRail.markColor === 'string' ? turnRail.markColor : 'theme', value => postSetConfig('turnRail.markColor', value))")
    expect(script).toContain("settingsColorPicker(typeof turnRail.stopColor === 'string' ? turnRail.stopColor : 'theme', value => postSetConfig('turnRail.stopColor', value))")
    expect(script).toContain("railColorVar('--rail-mark-color', cfg.markColor);")
    expect(script).toContain("railColorVar('--rail-stop-color', cfg.stopColor);")
    /* 区间扫描上界：turn 模式条目无 endSeq → 取"下一个有 seq 的节点"（截图自查实测：
       无上界时收藏后节点会把前节点一起标金）。 */
    expect(script).toContain('function railMarkUpperBound(turnIndex) {')
    expect(script).toContain('const endSeq = railMarkUpperBound(turnIndex);')
  })

  it('0.0.149（G53 反馈③④）: 停点判定收紧（已加载只认留痕卡）+ 键对账（前缀↔已加载）+ 模板转义守卫', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* ③ 修正：已加载节点只认段首元素是/含留痕卡·决定卡；区间兜底仅留给未加载前缀
       （旧逻辑区间链因留痕卡无 data-seq 而拉长 → 停点"之前"的节点全被误标，真机实证）。 */
    expect(script).toContain("const el = turn.element !== undefined ? turn.element : (typeof turn.id === 'string' ? railTurnEls.get(turn.id) : undefined);")
    /* 0.0.153：区间分支整体移除（菱形只认 DOM 留痕卡）。 */
    expect(script).not.toContain('stop >= turn.seq')
    expect(script).toContain("if (el.matches('.ask-record, .decision-card')) return true;")
    /* 0.0.153（用户口径）：菱形只属于应答段（DOM 留痕卡）；未加载轮不标——区间分支已移除。 */
    expect(script).not.toContain('for (const stop of array(state && state.segmentStops))')
    /* ④ 修正：段节点补锚点 seq（卡片无 data-seq → 退用段首节点），收藏键跨两态对账。 */
    expect(script).toContain('const seq = seqOfElement(startEl) !== undefined ? seqOfElement(startEl) : seqOfElement(segment.nodes[0]);')
    expect(script).toContain('function railMarkQuery(turnIndex, lookup) {')
    /* 0.0.156：清理函数改为对指定容器生成键集合（收藏只清 stars，标注不动）。 */
    expect(script).toContain('function railKeysToClear(turnIndex, scanKeys) {')
    expect(script).toContain('function turnStartOf(seq, starts) {')
    /* 轮起点回退只认轮首段（否则同轮多段同时变金——真机实证 node0/2/3）。 */
    expect(script).toContain('lookup.firstByStart.get(start) === turnIndex')
    /* 模板字面量转义守卫：前缀区间扫描正则必须双反斜杠（单反斜杠会在模板串里被吞成 /^s(d+)$/） */
    expect(script).toContain('/^s(\\d+)$/.exec(key);')
    /* 编辑标注就地更新已有键（对账命中的键别新建重复条目）。 */
    expect(script).toContain('pendingMarkKey = hit !== undefined ? hit.key : exact;')
    /* 0.0.151（用户反馈）重新定案：③ 停点=节点本体紫色圆角菱形（去掉右上角小圆点）；
       ① 收藏+激活=金底+正常放大（去掉蓝环）。断言见下方 0.0.151 组。 */
  })

  it('0.0.148（G53）: 轨道节点收藏（右键菜单/金色/标注弹窗/持久化）+ 停点自动标注', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* ① 收藏：右键节点 → 菜单（点击仍是跳转）；金色在非 active 时显示（当前轮蓝优先）。 */
    expect(script).toContain("el.addEventListener('contextmenu', (event) => {")
    expect(script).toContain('openRailNodeMenu(turnIndex, event.clientX, event.clientY);')
    expect(script).toContain("ctxMenuOption('★ 收藏此节点'")
    /* 0.0.156：取消收藏带 ☆（与收藏成对）；只动收藏、不动标注。 */
    expect(script).toContain("ctxMenuOption('☆ 取消收藏'")
    expect(script).toContain("ctxMenuOption('编辑标注…'")
    /* 0.0.155（用户反馈）：未激活金节点半透明（继承基础 .55），不再写死 opacity: 1。 */
    expect(html).toContain('.turn-rail-node.marked:not(.active)::after { background: var(--rail-mark-color, var(--vscode-charts-yellow, #e3b341)); }')
    /* ② 标注弹窗（重命名同款）+ 悬停文案「★ 标注 · N/M · 摘要」（0.1.114 起编号口径 = 可见节点序）。 */
    expect(html).toContain('<div id="markPopup" class="rename-popup hidden"><input id="markInput" maxlength="60"')
    expect(script).toContain('function openMarkNote(turnIndex) {')
    /* 0.0.149 反馈②：有标注时提示默认只显示标注内容（`turnRail.markNoteOnly` 关则叠加轮次摘要）。 */
    expect(script).toContain('const noteOnly = !(state && state.turnRailSettings && state.turnRailSettings.markNoteOnly === false);')
    /* 0.0.156：提示前缀随收藏状态切换——已收藏「★ 标注」/ 仅标注「✎ 标注」。 */
    expect(script).toContain("title = noteOnly ? (starred ? '★ ' : '✎ ') + note")
    /* 0.0.149 设置行：标注提示样式（两态枚举）。 */
    expect(script).toContain("settingsEnum(turnRail.markNoteOnly === false ? 'full' : 'note', [['note', '只显示标注内容'], ['full', '标注 + N/M · 摘要']],")
    /* ③ 停点自动标注：设置开关（默认开，显式 false 才关）+ 判定函数（形态 CSS 见 0.0.151 组）。 */
    expect(script).toContain('function railNodeIsStop(index) {')
    expect(script).toContain('settingsSwitch(turnRail.markStops !== false,')
    /* ④ 持久化：键=归一化 seq 优先（前缀节点→段节点不丢）；marks 随 session-view-state 上报、view-state 回填。 */
    expect(script).toContain("return 's' + String(seq);")
    expect(script).toContain('marks: Object.fromEntries(memo.marks),')
    expect(script).toContain("if (raw.marks && typeof raw.marks === 'object') {")
    /* ⑤ 每次状态渲染重刷标记（设置开关/记忆变化即时生效，无需重建节点）。 */
    expect(script).toContain('function applyRailMarks() {')
  })

  it('0.0.156（用户反馈）: 收藏与标注独立——编辑标注不再自动收藏', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* 数据模型：viewMemo 增 stars 集合；金色=收藏（stars）/ 标注=marks 两张表各自查询（键解析内核共用）。 */
    expect(script).toContain('marks: new Map(), stars: new Set(), railDropped: new Map() };')
    expect(script).toContain('function railHitKey(turnIndex, hasKey, scanKeys, lookup) {')
    expect(script).toContain('function railStarQuery(turnIndex, lookup) {')
    expect(script).toContain('const starred = railStarQuery(entry.turnIndex, lookup) !== undefined;')
    expect(script).toContain("entry.el.classList.toggle('marked', starred);")
    /* 菜单：收藏→stars.add（不再写 marks 空串）；取消收藏只清 stars（railKeysToClear 传 stars 容器）。 */
    expect(script).toContain("memo.stars.add(key); applyRailMarks(); scheduleViewStatePersist(renderedSessionId); })")
    expect(script).toContain('for (const candidate of railKeysToClear(turnIndex, memo.stars)) memo.stars.delete(candidate);')
    /* 标注弹窗：写文本=存标注（不改收藏）；留空=删除标注（已收藏则金色保留）。 */
    expect(script).toContain("if (note === '') marks.delete(key); else marks.set(key, note);")
    /* 持久化/回填：stars 数组上报（空数组=零收藏合法态）；旧数据无 stars 字段 → 按"有键=已收藏"迁移。 */
    expect(script).toContain('stars: [...memo.stars],')
    expect(script).toContain('if (Array.isArray(raw.stars)) {')
    expect(script).toContain("} else if (raw.marks && typeof raw.marks === 'object') {")
    /* 设置面板文案随 0.0.151/0.0.153 语义更新（右上角小圆点 → 紫色圆角菱形 + 独立性说明）。 */
    expect(script).toContain('应答段节点显示紫色圆角菱形')
    expect(script).not.toContain('右上角小圆点')
  })

  it('0.1.9（用户需求）: 轨道节点增删（隐藏/合并）+ 运行中末节点跳底 + 动画削帧', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* C 导航层覆盖：身份键与过滤（railTurnsOf 输出前筛），菜单入口 + 恢复全部 + 持久化上报。 */
    expect(script).toContain('function railDroppedSet() {')
    expect(script).toContain('function railEntryDropped(entry, dropped) {')
    expect(script).toContain("options.push(ctxMenuOption('与上一节点合并', () => {")
    expect(script).toContain("options.push(ctxMenuOption('从导航中隐藏此节点', () => {")
    expect(script).toContain("options.push(ctxMenuOption('恢复全部隐藏/合并的节点（' + String(memo.railDropped.size) + '）', () => {")
    expect(script).toContain('railDropped: Object.fromEntries(memo.railDropped),')
    /* 折叠不动：过滤只发生在 railTurnsOf（段模式），applyWorkSegmentFold 的可见性规则不读该表。 */
    expect(script).toContain('const visibleEntries = entries.filter(entry => !railEntryDropped(entry, dropped));')
    /* B 运行中末节点 → 跳真底 + 动画结束后才挂跟随（避免与流式钉底抢 scrollTop）。 */
    expect(script).toContain('railStickyTarget = railScrollTo(scrollEl.scrollHeight, railLayout.y[turnIndex], true);')
    expect(script).toContain('if (railFollowAfterAnim) { railFollowAfterAnim = false; followConversationTail = true; }')
    /* A 削帧：动画期间不做几何判定；滑块只取滑行值（不读 scrollTop/scrollHeight/clientHeight）。 */
    expect(script).toContain('if (railAnimFrame === undefined && railNativeAnim !== true) {')
    expect(script).toContain('内容滚动 = 跟随恢复')
    expect(script).toContain('if (railThumbGlideY !== undefined) {')
  })

  it('0.1.10（用户反馈）: 运行中 Enter 跟随运行时设置 busyEnter；插话不落乐观回显', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* Enter 默认模式 = 运行时设置（ui-conversation.busyEnter）；Ctrl/Cmd+Enter 显式反选。 */
    expect(script).toContain("const busy = state && state.busyEnter === 'steer' ? 'steer' : 'queue';")
    expect(script).toContain("send(state && state.running ? (override ? (busy === 'steer' ? 'queue' : 'steer') : busy) : 'queue');")
    /* 发送键提示随设置变化。 */
    expect(script).toContain("? (busyMode === 'steer' ? '插话（Enter）· 排队（Ctrl+Enter）' : '排队（Enter）· 插话（Ctrl+Enter）')")
    /* 插话不落乐观回显（唯一指示=底部待插话气泡）；失败路径容忍气泡缺席。 */
    expect(script).toContain("if (text.indexOf('/') !== 0 && mode !== 'steer' && state.running !== true) appendOptimisticEcho(mode, echoSeq);")
    /* 待插话气泡全中文（原 Steering…）。 */
    expect(html).toContain('已插话 · 将在下一步被 AI 看到')
    expect(html).not.toContain('Steering…')
  })

  it.each([[true, 'queue', 0], [true, 'steer', 0], [false, 'queue', 1]] as const)(
    'busy=%s mode=%s keeps pending inbox messages out of the transcript', (running, mode, expectedEchoes) => {
      const script = mainScript(chatHtml(webview, mark))
      const start = script.indexOf('function send(mode) {')
      const end = script.indexOf("elements.prompt.addEventListener('input'", start)
      const echoes: unknown[] = [], sent: unknown[] = []
      const context = {
        mode, sendInFlight: false, draftImages: [], hasPinnedFiles: () => false,
        state: { phase: 'ready', routable: true, running, sessionId: 'owned-ui-session' },
        elements: { prompt: { value: 'QUEUED_ORIGINAL' } },
        clearRestoreCtx() {}, followConversationTail: false, sendSeqCounter: 0,
        pendingPromptPreparations: new Map(), syncCancelVisibility() {},
        vscode: { postMessage: (message: unknown) => sent.push(message) },
        appendOptimisticEcho: (...args: unknown[]) => echoes.push(args),
        commandIndex: 0, resetPrompt() {}, window: { setTimeout() {} },
      }
      runInNewContext(script.slice(start, end) + ';send(mode)', context)
      expect(sent).toEqual([{ type: 'send', text: 'QUEUED_ORIGINAL', mode, echoSeq: 1 }])
      expect(echoes).toHaveLength(expectedEchoes)
      expect(context.elements.prompt.value).toBe('')
      expect(context.pendingPromptPreparations.get(1)).toBe('owned-ui-session')
    },
  )

  it('0.1.11（用户实测）: 回答停点后末段立即结束——折叠条不随产出反复增删', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* 判据：未消费停点 ≤ 已见最后 seq（停点本体已在场）→ 末段视为已结束。 */
    expect(script).toContain('const trailingStopEnded = stopCursor < stopSeqs.length && lastSeqSeen !== undefined && stopSeqs[stopCursor] <= lastSeqSeen;')
    expect(script).toContain('const ended = index < segments.length - 1 || settled || (trailingStopEnded && index === segments.length - 1);')
    /* 留痕卡/决定卡带 seq（尾部判据的据可依源）。 */
    expect(script).toContain("if (typeof message.seq === 'number' && Number.isFinite(message.seq)) box.dataset.seq = String(message.seq);")
  })

  it('0.1.12（用户实测）: 运行中跳转走原生平滑；静止走 rAF；诊断长帧汇总', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* 运行中 → 原生平滑（合成器驱动）；静止 → rAF 精确时长（jumpSeconds 语义不变）。 */
    expect(script).toContain('const railUseNative = () => state !== undefined && state.running === true && !railReducedMotion() && railJumpSeconds() > 0;')
    expect(script).toContain("if (railUseNative()) return railScrollToNative(target, thumbTo, followAfter);")
    expect(script).toContain("scrollEl.scrollTo({ top: to, behavior: 'smooth' });")
    expect(script).toContain("scrollEl.addEventListener('scrollend', onEnd);")
    /* 原生动画期同样跳过高亮几何判定（与 0.1.9 削帧同语言）。 */
    expect(script).toContain('if (railAnimFrame === undefined && railNativeAnim !== true) {')
    expect(script).toContain('内容滚动 = 跟随恢复')
    /* 诊断长帧汇总（perf-log.jsonl 的一手来源）。 */
    expect(script).toContain("type: 'perf-log',")
    expect(script).toContain("kind: 'frames', running:")
  })

  it('0.1.13（用户实测）: 原生跳转期间滑块只跟随真实滚动（消除"先跳终点→弹回→再跟过去"三段式）', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* 粘滞不作用于滑块（原生动画期强制走映射路径）；高亮粘滞不受影响。 */
    expect(script).toContain('const sticky = railNativeAnim !== true && railStickyIndex !== undefined && railStickyTarget !== undefined')
    /* 跟随用小 rAF 环（只刷滑块）；finish/打断/新跳转三处都收掉。 */
    expect(script).toContain('railNativeThumbFrame = requestAnimationFrame(stepThumb);')
    expect(script).toContain('if (railNativeThumbFrame !== undefined) { cancelAnimationFrame(railNativeThumbFrame); railNativeThumbFrame = undefined; }')
  })

  it('0.1.14（用户实测）: 悬停期间 title 冻结（流式中提示不再"每步关闭又打开"）', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    expect(script).toContain('function setTitleStable(el, text) {')
    expect(script).toContain('function armStableTitle(el) {')
    expect(script).toContain('setTitleStable(elements.usageStats, usageStatsLine(usage, true, true));')
    expect(script).toContain('setTitleStable(elements.usageTrigger, triggerTitle);')
    /* aria-label 取源值而非被冻结的 title（无障碍信息保持实时）。 */
    expect(script).toContain("elements.usageTrigger.setAttribute('aria-label', triggerTitle);")
    expect(script).toContain('armStableTitle(elements.policyTrigger);')
  })

  it('0.1.15（用户实测）: 高元素（失败卡/长消息）不得把会话顶出底部吸附', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* 自写钉底引发的 scroll 事件不参与脱离判定（只有用户滚动才脱离）。 */
    expect(script).toContain('if (performance.now() - selfScrollStamp < 150) return;')
    expect(script).toContain('else if (followConversationTail && conversationDetached()) {')
  })

  it('0.1.17（用户实测）: 发送按钮跟随插话设置 + 撤销/重做转发通道', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* 发送按钮不再写死 queue：运行中跟随 busyEnter（Ctrl/Cmd 反选）。 */
    expect(script).toContain("send(state && state.running === true ? (override ? (busyMode === 'steer' ? 'queue' : 'steer') : busyMode) : 'queue');")
    /* 撤销/重做转发（VS Code 工作台截走 Ctrl+Z → keybinding → 命令 → 本消息）。 */
    expect(script).toContain("if (event.data.type === 'exec-edit') {")
    expect(script).toContain("const command = event.data.command === 'redo' ? 'redo' : 'undo';")
    expect(script).toContain('try { document.execCommand(command); } catch { /* 无聚焦可编辑元素时静默 */ }')
  })

  it('0.0.160（N1）: 任务通知设置行（三态枚举 → ui.notifyLevel）', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* 「会话」区首行：需要操作 + 跑完（默认）/ 仅需要操作 / 关闭；判据与实现见 notify.ts + 扩展侧接线。 */
    expect(script).toContain("settingsEnum(ui.notifyLevel === 'off' ? 'off' : (ui.notifyLevel === 'action' ? 'action' : 'all'), [['all', '需要操作 + 跑完'], ['action', '仅需要操作'], ['off', '关闭']], value => postSetConfig('ui.notifyLevel', value))")
  })

  it('0.0.165（B3 复制面）: 工具/命令卡复制入口 + 反馈一致性', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* P1-4：工具/命令卡输出复制入口（复用统一 copyButton；复制 body 当前显示文本）。 */
    expect(script).toContain('function attachToolCopy(bodyEl, flashHost) {')
    expect(script).toContain("copyButton(() => bodyEl.innerText, '复制输出（当前显示的内容）', flashHost)")
    expect(script).toContain('item.append(attachToolCopy(renderToolBody(message, callView, resultView), item))')
    expect(script).toContain('item.append(attachToolCopy(result, item))')
    expect(html).toContain('.tool-copy { position: absolute; top: 2px; right: 4px; opacity: .45; z-index: 3; }')
    /* P1-7：toast 时长统一到 ui.hintSeconds；复制该消息按可复制性闪光。 */
    expect(script).toContain("toastTimer = setTimeout(() => el.classList.remove('show'), hintMs());")
    /* 0.0.167：消息级菜单项抽成 messageMenuOptions（右键与尾行「…」共用）——参数名随之 rec.message→message。 */
    expect(script).toContain("if (String(message.text || '') !== '' || message.deferredBody === true) flashCopied(article);")
  })

  it('0.0.163（B2 存储面）: 设置台「存储」区 + 消息接线', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* 打开面板拉取占用；区块渲染（路径 + 大小 + 打开）与清理动作；快照到达就重渲。 */
    expect(script).toContain("vscode.postMessage({ type: 'describe-storage' });")
    expect(script).toContain("settingsSection('存储')")
    expect(script).toContain("vscode.postMessage({ type: 'storage-open', path: entry.path })")
    expect(script).toContain("settingsAction('清空回收站…', () => vscode.postMessage({ type: 'storage-purge', target: 'recycle' }))")
    expect(script).toContain("settingsAction('立即清空草稿', () => vscode.postMessage({ type: 'storage-purge', target: 'drafts' }))")
    expect(script).toContain("settingsAction('清理临时文件', () => vscode.postMessage({ type: 'storage-purge', target: 'temp' }))")
    expect(script).toContain("if (event.data.type === 'storage-state') {")
  })

  it('0.0.162（全产品审查 B1）: P0 修复——折叠开关真键 / 公式四档 / 复制该消息取全文', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* P0-1：「工作过程自动折叠」面板此前误读 workSegmentsEnabled（webview 内部映射产物）→ 恒显开。 */
    expect(script).toContain("settingsSwitch(fold.workSegments !== false, value => postSetConfig('fold.workSegments', value))")
    /* 2026-10-06（同族第 4 例）：「调试日志」开关此前读 state 上不存在的顶层 current.diagnostics
       → 点了不同步显示（实测 reload 亦无效、写入本身正常）。口径 = ui（=current.uiSettings）。 */
    expect(script).toContain("settingsSwitch(ui.diagnostics === true, value => postSetConfig('ui.diagnostics', value))")
    expect(script).not.toContain("settingsSwitch(current.diagnostics === true, value => postSetConfig('ui.diagnostics'")
    /* 公式四档（用户点名）：设置行 + 纯函数。 */
    expect(script).toContain("[['markdown', 'Markdown（$ / $$）'], ['tex', 'TeX 源'], ['tex-delimited', 'TeX + 定界符'], ['mathml', 'MathML']]")
    expect(script).toContain("if (format === 'mathml') return typeof mathml === 'string' && mathml !== '' ? mathml : tex;")
    /* P0-3：「复制该消息」改经扩展取全文（超长助手回复 webview 态 text 为空）。 */
    expect(script).toContain("vscode.postMessage({ type: 'copy-message', id: message.id })")
  })

  it('0.0.161（用户需求）: 草稿持久化——设置开关 + 文本上报 + 恢复接线', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* 设置行：「会话」区开关（默认开）。 */
    expect(script).toContain("settingsSwitch(ui.keepDrafts !== false, value => postSetConfig('ui.keepDrafts', value))")
    /* 文本去抖上报（400ms）+ 输入即排程 + 切会话冲刷上一会话。 */
    expect(script).toContain("vscode.postMessage({ type: 'persist-draft', sessionId, text });")
    expect(script).toContain('schedulePersistDraft();')
    expect(script).toContain('persistDraftNow(lastDraftSessionId);')
    /* 恢复接线：本地槽位为空才采纳；当前会话直接填回输入框并回投图片权威源。 */
    expect(script).toContain("if (event.data.type === 'draft-restore' && typeof event.data.sessionId === 'string') {")
    expect(script).toContain("vscode.postMessage({ type: 'sync-draft-images', images: draftImages });")
  })

  it('0.1.7（用户需求）: 通知形式——「会话」区设置行（两档枚举 + 写通道）', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    expect(script).toContain("settingsEnum(ui.notifyStyle === 'system' ? 'system' : 'vscode', [['vscode', '跟随 VS Code'], ['system', '总是系统弹窗']], value => postSetConfig('ui.notifyStyle', value))")
  })

  it('0.0.147: 会话栏标签最小宽度设置 / 回收站按项目隔离（提示行 + 徽标只算本项目）', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* ① 会话栏：最小宽度设置驱动（默认 112）——旧值 68px 时悬停 ✎/✕（共 46px）
       几乎占满标签、切换会话易误点；宽度随设置变化对全部标签重算。 */
    expect(script).toContain('const TAB_MIN_WIDTH_FALLBACK = 112;')
    expect(script).toContain('function tabMinWidth() {')
    expect(script).toContain('Number(state.uiSettings.sessionTabMinWidth)')
    expect(script).toContain("settingsNumber(typeof ui.sessionTabMinWidth === 'number' ? ui.sessionTabMinWidth : 112, 68, 200,")
    expect(script).toContain('if (minWidthChanged) setTabWidth(node, sessionTitles[s.id] || s.title);')
    /* CSS 的 max-width:150px 会把 >150 的设置值压回去（探针实证 160→150）——内联放宽。 */
    expect(script).toContain("tab.style.maxWidth = max + 'px';")
    /* ② 回收站：列表本体只含本项目（扩展侧按 cwd 分类）；其他项目只给计数，
       菜单底部灰字提示行（本项目为空也显示）；徽标计数=本项目条目数。 */
    expect(script).toContain('function recycleOthersCount() {')
    expect(script).toContain("'另有 ' + String(others) + ' 条其他项目的记录（切到对应项目可见）'")
    expect(script).toContain('appendOthersHint();')
    expect(script).toContain('recycleMenuMark = recycleMarkKey();')
    expect(html).toContain('.recycle-others { margin-top: 4px;')
  })

  it('0.0.146: 设置台显示侧栏扩展版本 / 压缩提示文案改「压缩后 xxMB」', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* 运行环境（只读）首行显示扩展自身版本（reload/排障一眼确认运行版本）。 */
    expect(script).toContain("versionRow.append(node('span', 'settings-ns-path', '侧栏扩展 · dsh-sidebar'));")
    expect(script).toContain("typeof current.extensionVersion === 'string' && current.extensionVersion !== '' ? current.extensionVersion : '—'")
    /* 压缩提示文案：省 xxMB → 压缩后 xxMB（看的是要发出去多大）。 */
    expect(script).toContain("（压缩后 ' + String(Math.max(1, Math.round(compressedBytes / 1024 / 1024))) + 'MB）'")
    expect(script).not.toContain("（省 ' + String(Math.max(1, Math.round(savedBytes")
  })

  it('0.0.145: 大图自动压缩（ImageDecoder 缩放解码 + 白底 JPEG + 逐级降档）/ 提示条浮层化 + 时长设置', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* G43：压缩管线——解码优先 ImageDecoder 缩放解码（大图全量解码会占 GB 级内存），canvas 先铺白底
       （JPEG 无 alpha），逐级降档直到 ≤ 运行时单图上限；失败返回 undefined（按"跳过"处理）。 */
    expect(script).toContain('const compressCfg = () => {')
    expect(script).toContain('const decodeScaled = async (dataUrl, mime, maxEdge) => {')
    expect(script).toContain('new ImageDecoder({ data: bytes, type })')
    expect(script).toContain('decoder.decode({ frameIndex: 0, desiredWidth: maxEdge })')
    expect(script).toContain("ctx.fillStyle = '#ffffff';")
    expect(script).toContain("canvas.toDataURL('image/jpeg', step.quality)")
    expect(script).toContain('const compressForUpload = async (dataUrl, mime) => {')
    /* 两个入口：拖入/粘贴（就压 + 提示）与对话框（compress-image 回环）。 */
    expect(script).toContain('if (imageLike && compressTrigger > 0 && file.size > compressTrigger) {')
    expect(script).toContain("已自动压缩 ' + String(compressed) + ' 个过大图片")
    expect(script).toContain("event.data.type === 'compress-image'")
    expect(script).toContain("type: 'compress-image-result',")
    /* 提示条：浮层（不占位 → 不再推挤右侧轨道）+ 时长设置。 */
    expect(html).toContain('position: absolute; left: 2px; right: 2px; bottom: calc(100% + 4px);')
    expect(html).toContain('pointer-events: none;')
    expect(script).toContain('const hintMs = () => {')
    expect(script).toContain('dragBreathe(hintMs());')
    expect(script).toContain("settingsNumber(typeof ui.hintSeconds === 'number' ? ui.hintSeconds : 4, 1, 60,")
    expect(script).toContain("settingsNumber(typeof attach.compressThresholdMB === 'number' ? attach.compressThresholdMB : 20, 0, 2048,")
    expect(script).toContain("settingsNumber(typeof attach.compressMaxEdge === 'number' ? attach.compressMaxEdge : 4096, 512, 16384,")
    expect(script).toContain("settingsNumber(typeof attach.compressQuality === 'number' ? attach.compressQuality : 82, 40, 95,")
  })

  it('0.0.144: 滑块恒长（暂停对话内不变）/ 拖拽滚列两项设置（带宽·最大速度，帧率无关）/ 最小间距 96', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* ① 滑块长度恒定：每布局按 视口高/内容高 × 行程 一算（夹 [32,72]），滚动中不再逐帧变化
       （治"接近底部变短"=末段行程挤压；railEndY 也随恒定长度贴底）。 */
    expect(script).toContain('const thumbLen = Math.max(RAIL_MIN_THUMB, Math.min(RAIL_MAX_THUMB, Math.round(travel * viewportH / totalH)));')
    expect(script).toContain('function railThumbLen()')
    expect(script).toContain('const h = railThumbLen();')
    expect(script).not.toContain('let botY = railMapC2R(Math.min(st + viewport, maxScroll));')
    /* ② 边缘拖拽自动滚列：带宽/最大速度取设置（px / px·秒⁻¹），速度按深度线性加速 × 实际帧间隔（帧率无关）。 */
    expect(script).toContain('function railDragEdgePx()')
    expect(script).toContain('function railDragSpeed()')
    expect(script).toContain('const speed = railDragSpeed() * Math.max(0, Math.min(1, depth / Math.max(1, zone)));')
    expect(script).toContain('const step = Math.max(1, Math.round(speed * dt / 1000));')
    expect(script).toContain('const edgeZone = railDragEdgePx();')
    /* ③ 最小间距上限 48 → 96（密集会话可更疏）。 */
    expect(script).toContain("'turnRail.dragEdgePx'")
    expect(script).toContain("'turnRail.dragSpeed'")
    expect(script).toContain("settingsNumber(typeof turnRail.minGap === 'number' ? turnRail.minGap : 20, 12, 96,")
    expect(script).toContain("settingsNumber(typeof turnRail.dragEdgePx === 'number' ? turnRail.dragEdgePx : 64, 8, 200,")
    expect(script).toContain("settingsNumber(typeof turnRail.dragSpeed === 'number' ? turnRail.dragSpeed : 800, 100, 3000,")
  })

  it('0.0.143: 末段行程区——触底滑块贴轨道底（三路径同一终点 railEndY）', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* 用户实测："滑块无法滚到底部"——末段行程区内顶端从末节点比例滑到 railEndY()（=末节点 +
       底垫 − 最小身长 32；触底时身体恰好贴住轨道底）。正/逆映射 + 尾部重标定三条路径同一终点。 */
    expect(script).toContain('function railEndY()')
    expect(script).toContain('return railLayout.y[n - 1] + Math.max(0, railLayout.tail - railThumbLen());')
    expect(script).toContain('return base + fr * (railEndY() - base);')
    expect(script).toContain('const spanR = railEndY() - base;')
    expect(script).toContain('return railLayout.y[n - 1] + fLast * (railEndY() - railLayout.y[n - 1]);')
    expect(script).toContain('return axis.anchors[n - 1] + f * spanLast;')
  })

  it('0.0.142: 底垫=末段比例间距（保底反解）/ 边缘拖拽自动滚列', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* ③v2（用户实测 v1：底垫 2.7×间距、滑块离底太远）：底垫读作"最后一格"——与节点间距同公式、
       同 scale；保底 RAIL_TAIL 触发时用"固定底垫反解 scale"，铺满仍精确（无假滚动）。 */
    expect(script).toContain('const tailBase = Math.min(RAIL_MAX_GAP, Math.max(minGap, RAIL_PITCH * eh[n - 1] / avg));')
    expect(script).toContain('if (sumG > 0 && tailBase * scale < RAIL_TAIL) scale = Math.max(1, (avail - RAIL_TAIL) / Math.max(1, sumG));')
    expect(script).toContain('const tail = Math.max(tailBase * scale, RAIL_TAIL);')
    /* 边缘拖拽自动滚列：带宽内启动 rAF 循环（0.0.144 起带宽/速度入设置），用同一指针位置重算内容；松手/回带宽外即停。 */
    expect(script).toContain('function railDragEdgePx()')
    expect(script).toContain('function startRailEdgeScroll()')
    expect(script).toContain('function stopRailEdgeScroll()')
    expect(script).toContain('const content = railMapR2C((railDragLastY - rect.top) + clip.scrollTop - railThumbDrag.grab);')
    expect(script).toContain('if (railEdgeDir !== 0) startRailEdgeScroll();')
    expect(script).toContain('stopRailEdgeScroll();')
  })

  it('0.0.141: 上滚预取 / 合并瞬间补偿 / 滑块滑行 / 底垫按比例 / 帧徽标 +m', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* A① 预取：触发点从"距顶 24px"提前到 ~1.5 视口（滚到顶时内容已就位，无空窗）。 */
    expect(script).toContain('const HISTORY_PREFETCH_VIEWPORTS = 1.5;')
    expect(script).toContain('const margin = Math.max(24, elements.scroll.clientHeight * HISTORY_PREFETCH_VIEWPORTS);')
    expect(script).not.toContain('if (elements.scroll.scrollTop > 24) return;')
    /* A①b 自写门：预取的滚动路径不得被程序性写入（尾巴跟随/校正/补偿）误触——滚轮路径豁免。
       现场教训：折叠后的小页落在底部时首帧就命中边际 → reload 即偷拉一页并挂住 historyAnchor。 */
    expect(script).toContain('if (userIntent !== true && performance.now() - selfScrollStamp < 50) return;')
    expect(script).toContain('maybeAutoLoadHistory(true);')
    expect(script).toContain('selfScrollStamp = performance.now();')
    /* A② 合并补偿：优先"参考元素回位"（合并会让既有内容重排——按高度差补偿实测漂移 728px），
       参考在更新前从旧帧捕获（边滚边合并不丢位）；找不到参考退回高度差近似。 */
    expect(script).toContain('const historyRef = preservingHistory ? captureHistoryAnchorRef() : undefined;')
    expect(script).toContain('function captureHistoryAnchorRef()')
    expect(script).toContain('elements.scroll.scrollTop += (refNode.getBoundingClientRect().top - scrollRect.top) + historyRef.offset;')
    expect(script).toContain('elements.scroll.scrollTop += elements.scroll.scrollHeight - anchor.height;')
    expect(script).not.toContain('anchor.top + elements.scroll.scrollHeight')
    /* B 滑块滑行：与滚动动画同一条缓动；滑行值优先于粘滞；结束/打断即清。 */
    expect(script).toContain('railThumbGlideY = railThumbGlideFrom + (railThumbGlideTo - railThumbGlideFrom) * eased;')
    expect(script).toContain('topY = railThumbGlideY;')
    expect(script).toContain('railThumbGlideFrom = undefined; railThumbGlideTo = undefined; railThumbGlideY = undefined;')
    expect(script).toContain('railStickyTarget = railScrollTo(scrollEl.scrollTop + delta, railLayout.y[turnIndex]);')
    expect(script).toContain('railThumbGlideFrom = Number.isFinite(currentTop) ? currentTop : railMapC2R(from);')
    /* ③ 底垫随铺满 scale 缩放；三处使用改 railLayout.tail（拖拽映射两端 + 滑块顶端钳制）。
       0.0.142 起底垫改"末段比例间距"（见 0.0.142 用例）。 */
    expect(script).toContain('const tailBase = Math.min(RAIL_MAX_GAP, Math.max(minGap, RAIL_PITCH * eh[n - 1] / avg));')
    expect(script).toContain('const tail = Math.max(tailBase * scale, RAIL_TAIL);')
    expect(script).toContain('Math.min(railLayout.y[n - 1] + railLayout.tail, railPos)')
    expect(script).toContain('const capBot = railLayout.y[n - 1] + railLayout.tail;')
    /* ② 帧徽标按宽度铺 + "+m"（不再固定"前 4 个"；徽标不收缩、不折行）。 */
    expect(script).toContain('function fitFrameBadges(chip)')
    expect(script).toContain("chip.querySelectorAll('.frame-badge:not(.frame-badge-more)')")
    expect(script).toContain('more.textContent = ' + "'+'" + ' + String(frames.length - shown);')
    expect(script).not.toContain('selectedFrames.slice(0, 4)')
    expect(html).toContain('.frame-badge { flex: 0 0 auto; white-space: nowrap;')
    expect(script).toContain('refitAllFrameBadges();')
  })

  it('0.0.139: 前缀去重 / 停点节点锚定留痕卡 / 轨道调试快照', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* ① 该轮 user 消息已在窗口里 → 不再建前缀（此前前缀与首个段节点指向同一元素 = 重复节点，
       且段高会被记到下一个间距上——用户实测"第一个节点没意义"）。
       0.0.157：守卫改**开区间**——最后一个 outline 条目无 endSeq，旧写法（endSeq !== undefined && …）
       对该轮恒不跳过 → 单轮会话出两个同文案节点（用户实测），轨道本应隐藏却显示。 */
    expect(script).toContain('if (current && current.hasMoreHistory === true) return [];')
    /* 0.1.21：已加载 user seq 改从行数据取（与 DOM 同源、等价）——原全树 querySelectorAll
       在 4.9 万节点文档里每帧占流式帧 CPU 采样前几名；语义不变故断言随机制迁移。 */
    expect(script).not.toContain('return prefix.concat(visibleEntries);')
    expect(script).toContain('if (segmentCount > 0) return visibleEntries;')
    expect(script).not.toContain("elements.messages.querySelectorAll('.message.user[data-seq]')")
    /* ② 停点段（start=null）的段首锚点改用前一个兄弟的提问留痕卡/审批决定卡（标题=问题、跳转可见选择）。 */
    expect(script).toContain("prev.matches('.ask-record, .decision-card')")
    expect(script).toContain("prev.querySelector('.ask-record, .decision-card') !== null")
    /* ③ 只读调试快照（探针诊断用；只挂函数不累积数据）。 */
    expect(script).toContain('window.__raildbg = () => {')
    /* ④ 回包后前缀节点已被去重移除时，跳转按"已加载"直接定位（否则又静默失败）。 */
    expect(script).toContain("{ seq: pendingRailJumpSeq, assumeLoaded: true }")
  })

  it('0.0.157（用户实测）: 单轮会话不再出双节点 + 轨道隐藏时归还原生滚动条', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* ① 根因：前缀去重的开区间守卫（endSeq 缺失时旧写法恒 false）——断言见 0.0.139 组。 */
    expect(script).not.toContain('return prefix.concat(visibleEntries);')
    /* ② 单轮 → 1 条 turn → 既有"≤1 轮隐藏轨道"分支生效（本轮不再被重复节点绕过）。 */
    expect(script).toContain('if (turns.length <= 1 || available < 40) {')
    /* ③ 轨道隐藏（单轮/空会话/视口过矮）时把原生滚动条还给系统——custom 模式下滚动条由
       轨道滑块接管，两者同时消失会让单轮长对话没有任何滚动指示。 */
    /* 0.1.50（B）：滚动条隐藏类改走唯一入口 setScrollbarHidden（缓存与类同步，防"两个滑块"）。 */
    expect(script).toContain('setScrollbarHidden(false);')
    expect(script).toContain('function setScrollbarHidden(hidden) {')
    /* ④ 隐藏分支之后的每帧 toggle 会在轨道复现时重新收回原生滚动条（自洽，无残留）。 */
    expect(script).toContain('setScrollbarHidden(!nativeMode);')
    expect(script).toContain("elements.scroll.classList.toggle('scrollbar-hidden', hidden);")
  })

  it('0.0.138: 跳转后滑块粘滞到目标节点 / 选择留痕卡永不折叠', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* ① 落点粘滞与高亮同源：点节点后滑块顶端钉在该节点（锚点到不了落点时不再"差一截"）。
       0.0.141 起滑行值优先，粘滞降为 else 分支（交接点两者同值）。 */
    expect(script).toContain('if (sticky) topY = railLayout.y[railStickyIndex];')
    /* 0.1.13：原生动画期滑块不粘滞（只跟随真实滚动）——粘滞判据加了 railNativeAnim 前置。 */
    expect(script).toContain('const sticky = railNativeAnim !== true && railStickyIndex !== undefined && railStickyTarget !== undefined')
    /* ② 提问留痕卡 / 审批决定卡 = "我的输入"，不属于过程——永不折叠、始终可见。
       （注意节点自身可能就是留痕卡：matches 与 querySelector 都要查。） */
    expect(script).toContain("el.matches('.ask-record, .decision-card')")
    expect(script).toContain("el.querySelector('.ask-record, .decision-card') !== null")
    /* ③ endSeq 只取紧随其后的第一个条目（空 prompt 轮若反复覆写 → 区间失效，J5 回归教训）。 */
    expect(script).toContain("...(typeof rec.endSeq === 'number' && Number.isFinite(rec.endSeq) ? { endSeq: rec.endSeq } : {})")
  })

  it('0.0.137: 跳转按整轮区间判已加载 / 折起段用折叠条代位 / 跳转永不展开过程', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* ① turn/start 的 seq 不渲染元素——"未加载"判定必须用整轮区间 [seq, endSeq)。 */
    expect(script).toContain("...(typeof rec.endSeq === 'number' && Number.isFinite(rec.endSeq) ? { endSeq: rec.endSeq } : {})")
    expect(script).toContain("const unloaded = typeof turn.endSeq === 'number' ? loaded >= turn.endSeq : turn.seq < loaded;")
    /* ② 穿透加载回包后的跳转要取节点清单里的真实轮（带 endSeq），不得用裸 {seq} 退回旧守卫。 */
    expect(script).toContain('? railTurnList.find(candidate => candidate.id === railNavigationId)')
    expect(script).toContain(': railTurnList.find(candidate => candidate.seq === pendingRailJumpSeq);')
    /* ③ 折起段用折叠条代位（跳转/测距同源），跳转不再展开任何过程。 */
    expect(script).toContain('function effectiveRailElement(el)')
    expect(script).toContain('const el = effectiveRailElement(railElementFor(turn));')
    expect(script).not.toContain('expandSegmentFor')
    expect(script).not.toContain('expandSegmentBar')
    expect(script).not.toContain('jumpFolds')
  })

  it('0.0.136: 前缀节点收敛/未加载锚点不污染映射/滚轮即用户意图/拖拽抑制自愈', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* ① 段模式前缀只保留"有人类 prompt"的轮（goal 自动续轮/插件注入轮 prompt 为空 → 无节点）。 */
    expect(script).toContain('if (current && current.hasMoreHistory === true) return [];')
    /* ② 未加载轮判定 + 布局不得按名义步长推进（前缀锚点全钳到 0，已加载段真实偏移原样保留）。 */
    expect(script).toContain('function turnIsPending(turn)')
    expect(script).toContain("const value = measured ? top : (turnIsPending(railTurnList[i]) ? last : last + RAIL_FALLBACK_STEP);")
    /* ③ 滑块映射与高亮同源：删掉 p ≤ anchors[0] 的比例插值分支（前缀锚点为 0 时会把滑块从顶端拉下来）。 */
    expect(script).not.toContain('return a0 > 0 ? railLayout.y[0] * (p / a0) : railLayout.y[0];')
    /* ④ 聊天区/轨道滚轮上滚 = 明确用户意图（解除校正窗口 userTouched 守卫）。 */
    expect(script).toContain('if (restoreCtx) restoreCtx.userTouched = true;')
    /* ⑤ 拖拽抑制标志自愈：任何 click 冒泡到 window 即清（否则会吞掉下一次点节点）。 */
    expect(script).toContain("window.addEventListener('click', () => { railDragSuppressClick = false; });")
  })

  it('0.0.97 (G42 + 批次 3): 反馈时长秒键 / 哨兵 -1 红字 / 原图存储上限', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* 反馈时长：秒键 + 0.1 步进 + 毫秒状态的显示换算 */
    expect(script).toContain("postSetConfig('copy.feedbackSeconds', value), 0.1)")
    expect(script).toContain('Math.round(copy.feedbackMs / 100) / 10')
    /* 哨兵值：红字样式 + norm（跳过 0）+ 两行 */
    expect(html).toContain('.settings-row-warn { color: var(--vscode-errorForeground')
    expect(script).toContain('const daysNorm = (value) => value === -1 ? -1 : Math.min(365, Math.max(1, Math.round(value)));')
    expect(script).toContain('⚠ -1 = 永不删除（刻意设置的特殊值）')
    expect(script).toContain("settingsRow('回收站保留天数'")
    expect(script).toContain("settingsRow('文件卡副本保留天数'")
    /* 原图存储上限行（-1 = 不剪枝） */
    expect(script).toContain("settingsRow('原图存储上限'")
    expect(script).toContain("postSetConfig('imageStore.maxTotalMB', value), 16")
    expect(script).toContain('⚠ -1 = 不剪枝（原图只增不减，刻意设置的特殊值）')
  })

  it('G38 批次 1 (0.0.95): 设置台补齐折叠触发阈值行 + 会话记忆三开关', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* P1: 触发阈值行（小数步进 0.1；写通道白名单 0.0.62 起已有，此前仅 VS Code 设置页入口） */
    expect(script).toContain("settingsRow('触发阈值'")
    expect(script).toContain("postSetConfig('fold.triggerRatio', value), 0.1)")
    expect(script).toContain("if (stepValue !== 1) input.step = String(stepValue);")
    expect(script).toContain("if (stepDecimals > 0) clamped = Number(clamped.toFixed(stepDecimals));")
    /* P2-P4: 会话区记忆三开关（默认开 = !== false 语义，与 sessionViewMemoryNow 默认一致） */
    expect(script).toContain('const viewMemory = current.sessionViewMemory || {};')
    expect(script).toContain("settingsRow('滚动位置记忆'")
    expect(script).toContain("postSetConfig('sessionViewMemory.scroll', value)")
    expect(script).toContain("settingsRow('工具卡展开记忆'")
    expect(script).toContain("postSetConfig('sessionViewMemory.expand', value)")
    expect(script).toContain("settingsRow('长消息折叠记忆'")
    expect(script).toContain("postSetConfig('sessionViewMemory.fold', value)")
  })

  it('embeds unified copy infrastructure driven by G6 settings (0.0.60)', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    expect(script).toContain('function copyCfg()')
    expect(script).toContain('const s = (state && state.copySettings) || {};')
    /* 0.0.162（公式四档，用户点名）：mathFormat 归一扩为 markdown / tex / tex-delimited / mathml。 */
    expect(script).toContain("mathFormat: s.mathFormat === 'tex' || s.mathFormat === 'tex-delimited' || s.mathFormat === 'mathml' ? s.mathFormat : 'markdown'")
    expect(script).toContain('function mathFormatText(format, tex, display, mathml) {')
    expect(script).toContain("codeCopyFormat: s.codeCopyFormat === 'markdown' ? 'markdown' : 'text'")
    expect(script).toContain("plainMathFormat: s.plainMathFormat === 'tex-delimited' ? 'tex-delimited' : 'tex'")
    expect(script).toContain("isCodeText ? () => String(token.content || '').trimEnd() : () => blockSource(srcInfo.source, srcInfo.srcLine, token.map)")
    expect(script).toContain("'复制代码(纯文本)'")
    expect(script).toContain("'复制代码(Markdown)'")
    expect(script).toContain('function copyButton(textGetter, tip, flashHost)')
    expect(script).toContain('function flashCopied(host)')
    expect(script).toContain('void host.offsetWidth')
    expect(script).toContain('flashCopied(flashHost)')
    expect(script).toContain('a.run(mkd)(); flashCopied(host)')
    expect(script).toContain('flashCopied(article)')
    expect(script).toContain('function blockSource(source, srcLine, map)')
    /* 0.0.96（G38 批次 2）: 块折叠门槛由设置驱动（原 `const FOLD_MIN_LINES = 3` 移除） */
    expect(script).not.toContain('const FOLD_MIN_LINES = 3')
    expect(script).toContain('> foldCfg().blockMinLines')
    expect(script).toContain('function contentLines(text)')
    /* 0.0.108（回归修复 + 用户补充①②）: ①工具卡 toggle 记忆只记用户点击（程序化 open 不写）；
       ②运行中会话默认跟底（恢复位只对空闲会话）；脱离需一定力度（滞回 240px）；
       ③变更文件块过长自动折叠（独立设置项 fold.changedFiles*）。 */
    expect(script).toContain('let userToggle = false')
    expect(script).toContain("summary.addEventListener('click', () => { userToggle = true; })")
    expect(script).toContain('const followLive = current.running === true')
    expect(script).toContain('const TAIL_DETACH_PX = 240')
    expect(script).toContain('function changedFilesFoldKey(groups)')
    expect(script).toContain('changed-files-more')
    expect(script).toContain('changedFilesEnabled: s.changedFiles !== false')
    /* 0.0.119（G49）：AI 工作段折叠——段键前缀 / 条文案 / 隐藏类 / 默认开。 */
    expect(script).toContain("'ws:' : 'ws~:') + anchorMid")
    expect(script).toContain('分页边界')
    /* 0.0.131：卡头文案（过程 · N 步 · 用时）——原「已收起 N 步过程」对比度低被用户点名。 */
    expect(script).toContain("'▸ 过程 · ' + String(process.length) + ' 步' + span")
    expect(script).toContain("'▾ 过程 · 收起'")
    expect(script).toContain('applyWorkSegmentFold(current)')
    expect(script).toContain('workSegmentsEnabled: s.workSegments !== false')
    /* 0.0.128（G54 落地）：轨道＝绝对定位 + 比例间距（铺满/自滚）+ 自绘滑块（与原生滚条互斥）。 */
    expect(html).toContain('.turn-rail-clip { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; scrollbar-width: none; pointer-events: none; z-index: 1; }')
    expect(script).toContain('function layoutTurnRail()')
    expect(script).toContain('function syncRailIndicator()')
    expect(script).toContain('const RAIL_EH_FLOOR = 200;')
    /* 0.0.129（用户实测两条）：窄面板下节点药丸压气泡 → 自绘模式内容右侧留轨道宽度；滑块长度封顶 */
    expect(html).toContain('.scroll.scrollbar-hidden .conversation { padding-right: 15px; }')
    /* 0.0.131：长度语义收窄 32–72 + 底垫 76（触底滑块入垫，显示"还能看多少"）。 */
    expect(script).toContain('const RAIL_MAX_THUMB = 72;')
    expect(script).toContain('const RAIL_MIN_THUMB = 32;')
    expect(script).toContain('const RAIL_TAIL = 76;')
    expect(script).toContain('function followRailActive(force)')
    expect(script).toContain('railManualUntil = Date.now() + 1500')
    expect(script).toContain('followRailActive(true)')
    expect(script).not.toContain("el.style.top = String((turnIndex + 1) / (turns.length + 1) * 100) + '%'")
    /* 0.0.121（G49 v2）：停点切段（审批/提问应答）+ 轨道 turnOutline + 未加载轮穿透加载。 */
    expect(script).toContain('stopSeqs')
    expect(script).toContain("startHistoryJump('rail', turn.seq)")
    expect(script).toContain("if (event.data.type === 'turn-jump-ready')")
    expect(script).toContain('railElementFor')
    expect(script).toContain('tryPendingRailJump();')
    expect(html).toContain('.work-folded[hidden] { display: none; }')
    expect(html).toContain('.work-fold-bar {')
    /* 0.0.118（用户反馈①）：变更文件回退禁用态转灰（此前被全局 opacity 压暗红，被读成"红色很暗"）。 */
    expect(html).toContain('.changed-action:disabled { color: var(--vscode-descriptionForeground); }')
    /* 0.0.109（G51）: 下拉弹层宽度自适应 + 打开时视口钳制（三段：左对齐/右对齐/夹紧）。 */
    expect(script).toContain("menu.classList.add('align-right')")
    expect(script).toContain("menu.style.left = Math.round(6 - drop.getBoundingClientRect().left) + 'px'")
    /* CSS 在 style 段（不在 script）——对 html 断言。 */
    expect(html).toContain('width: max-content; min-width: 160px; max-width: min(360px, calc(100vw - 16px))')
    expect(html).toContain('.ds-menu.align-right { left: auto; right: 0; }')
    /* 0.0.109（G50）: hover 显示官方英文原文（映射注入 + 开关同步 + data-orig 标记与清理）。 */
    expect(script).toContain('function applyOriginalText(root)')
    expect(script).toContain('function clearOriginalText()')
    expect(script).toContain('function syncOriginalHover(enabled)')
    expect(script).toContain("el.dataset.orig = '1'")
    expect(script).toContain("typeof ORIGINAL_TEXT_MAP !== 'object'")
    expect(script).toContain('syncOriginalHover(Boolean(current.uiSettings && current.uiSettings.showOriginalOnHover))')
    /* G39 v2（0.0.94）: foldButton 带初始态参数（超高块折叠记忆命中时直接落折叠态） */
    expect(script).toContain('function foldButton(host, initiallyFolded)')
    expect(script).toContain("btn.classList.add('fold-block')")
    expect(script).toContain('function attachBlockActions(el, token, srcInfo, opts, tokens, index)')
    expect(script).toContain('applyState(folded)')
    /* G27 round2 (0.0.41): 公式复制改点击即复制（math-copy class），不再创建 copy-math 按钮 */
    expect(script).toContain("span.classList.add('math-copy')")
    expect(script).not.toContain("btn.classList.add('copy-math')")
    expect(script).toContain("copy.classList.add('copy-block')")
    expect(script).not.toContain('function attachBlockCopy(')
    /* G27 round2 (0.0.41): 拖选 guard——点击时选区非空跳过复制（保留选中公式能力） */
    expect(script).toContain("getSelection().toString()")
    expect(() => new Function(script)).not.toThrow()
  })

  it('fixes list-item extra blank lines, math-click styling, table corner yield, streaming off', () => {
    const html = chatHtml(webview, mark)
    expect(html).toContain('.markdown li > p { margin-bottom: 0; }')
    expect(html).toContain('.streaming .block-actions { display: none !important; }')
    expect(html).not.toContain('.streaming .copy-block, .streaming .copy-math')
    expect(html).not.toContain('.streaming .copy-block { display: none !important; }')
    /* 点击即复制交互：hover 灰底 + copied 蓝光动画 + 流式 pointer-events 屏蔽 */
    expect(html).toContain('.markdown span.math.math-copy:hover')
    expect(html).toContain('dsh-copied-flash')
    expect(html).toContain('.streaming span.math.math-copy { pointer-events: none; }')
    /* G27 round2 (0.0.50): 块复制/右键复制成功 → 宿主块闪同款蓝光（全局 class，p/li/h/引用/
       code-wrap/table-wrap/message 通用；box-shadow 在边框盒外，折叠/横滚不裁剪） */
    expect(html).toContain('.copied-flash { animation: dsh-copied-flash 1s ease-out; }')
    /* G27 round3 (0.0.51): 代码块发光圆角（code-wrap 补 radius 6px 与 pre 一致）；
       列表项发光左扩 marker 区（li 本体关动画，::before 承担光环左扩 22px） */
    expect(html).toContain('.markdown .code-wrap { position: relative; border-radius: 6px; }')
    expect(html).toContain('.markdown li.copied-flash { animation: none; }')
    expect(html).toContain('.markdown li.copied-flash::before')
    expect(html).toContain("content: ''; position: absolute; left: -22px; right: 0; top: 0; bottom: 0;")
    /* G27 (0.0.47): 块级按钮容器——复制/折叠按钮统入 .block-actions（定位沿袭 0.0.40~0.0.46） */
    expect(html).toContain('.block-actions { display: none; position: absolute; top: 2px; right: 2px;')
    expect(html).toContain('.block-actions > .copy-block, .block-actions > .fold-block')
    expect(html).toContain('.markdown li > .block-actions { top: auto; bottom: 2px; }')
    expect(html).toContain('.markdown blockquote > .block-actions { top: 2px; }')
    expect(html).toContain('.markdown li:has(> ul, > ol) > .block-actions { top: 2px; bottom: auto; }')
    expect(html).toContain('.markdown .table-wrap:hover > .block-actions')
    expect(html).not.toContain('.markdown pre:hover > .copy-block')
    /* G27 (0.0.47): 超高块折叠——clip+fade（max-height 截断 + 底部渐变），流式沿用容器隐藏 */
    expect(html).toContain('.markdown .code-wrap.folded > pre { max-height: 56px; overflow: hidden; }')
    expect(html).toContain('.markdown .table-wrap.folded { max-height: 70px; overflow: hidden; }')
    expect(html).toContain('.markdown blockquote.folded { max-height: 3.4em; overflow: hidden; }')
    expect(html).toContain('.markdown .folded::after')
    expect(html).toContain('linear-gradient(to bottom, transparent,')
    /* 0.1.18（用户实测）：表格"文字让位"退役——hover 不改布局，按钮直接遮挡表头右端。 */
    expect(html).not.toContain('.markdown .table-wrap:hover > table thead th:last-child')
    expect(html).not.toContain('padding-right: calc(var(--actions-w, 26px) + 4px);')
    expect(html).not.toContain('padding-right: 30px')
    /* 遮挡式：按钮容器保持绝对定位（零布局影响的物理前提）。 */
    expect(html).toContain('.block-actions { display: none; position: absolute; top: 2px; right: 2px;')
    /* G27 round2 (0.0.48): 胶囊背景——文字穿过按钮区时遮得住点得中 */
    expect(html).toContain('var(--vscode-widget-background, var(--vscode-sideBar-background, #252526))')
    expect(html).toContain('border: 1px solid var(--vscode-widget-border, transparent)')
  })

  it('yields math copy area on <span> and drops ul/li-inner-p buttons (vendor pipeline)', () => {
    const mdInstance = new MarkdownIt()
    const { api } = runWebviewScript({ createMd: () => mdInstance })
    const sample = [
      '段落一：行内公式 $x^2 + y_1$ 结束。',
      '',
      '$$\int_0^1 x^2 \, dx = \frac13$$',
      '',
      '- 列表项一',
      '- 列表项二 **粗**',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n')
    const root = api.renderMarkdownVendor(sample, false)
    /* stub DOM 的 classList.add 为空操作（只留有 className 直接赋值）——按 button tag + title 判定 */
    const countByTitle = (el: any, tip: string): number => {
      let n = 0
      for (const c of el.children || []) {
        if (c.tagName === 'BUTTON' && c.title === tip) n += 1
        n += countByTitle(c, tip)
      }
      return n
    }
    /* 公式不再有按钮——改为 span.title 计数（math-copy 点击面） */
    const countSpanByTitle = (el: any, tip: string): number => {
      let n = 0
      for (const c of el.children || []) {
        if (c.tagName === 'SPAN' && c.title === tip) n += 1
        n += countSpanByTitle(c, tip)
      }
      return n
    }
    expect(countSpanByTitle(root, '点击复制公式')).toBeGreaterThanOrEqual(2)
    expect(countByTitle(root, '复制段落')).toBeGreaterThanOrEqual(1)
    /* ③: ul/ol 按钮移除（列表整体复制改由 li 项负责）；li 内 p 按钮跳过 */
    expect(countByTitle(root, '复制列表')).toBe(0)
    expect(countByTitle(root, '复制列表项')).toBeGreaterThanOrEqual(2)
    /* 0.0.167（B4 补档）：表格 tip 明确标注 Markdown（纯文本/TSV/CSV 在右键菜单）。 */
    expect(countByTitle(root, '复制表格(Markdown)')).toBeGreaterThanOrEqual(1)
  })
})

describe('G27 round2 (0.0.48): dynamic yield + capsule + block/message context menu + fork', () => {
  const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
  const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri

  it('binds block data (data-mkd/__mkd) and computes --actions-w from button geometry', () => {
    const script = mainScript(chatHtml(webview, mark))
    expect(script).toContain('el.dataset.mkd = kind')
    expect(script).toContain('el.__mkd')
    expect(script).toContain("span.dataset.mkd = 'math'")
    expect(script).toContain("span.__mkd = { kind: 'math', raw: tex, md:")
    /* 0.1.18：--actions-w 动态让位随"文字让位"退役（常量与写入一并删除）。 */
    expect(script).not.toContain('BLOCK_BUTTON_SIZE')
    expect(script).not.toContain("setProperty('--actions-w'")
    expect(script).toContain('0.1.18：--actions-w 随"文字让位"退役')
    /* 0.0.162（全产品审查 P0-4）：导出绑定与按钮开关解耦——__mkd/dataset 必须先于开关判定注册
       （否则关掉「块级复制按钮」连右键导出一起失联）。 */
    expect(script.indexOf('el.dataset.mkd = kind0;')).toBeGreaterThan(-1)
    expect(script.indexOf('el.dataset.mkd = kind0;')).toBeLessThan(script.indexOf('if (!copyCfg().blockButtons) return;'))
    expect(script.indexOf("span.dataset.mkd = 'math';")).toBeLessThan(script.indexOf('if (copyCfg().mathButtons) {'))
    expect(() => new Function(script)).not.toThrow()
  })

  it('round4 (0.0.53): plain text math output format interface + code fence trimEnd', () => {
    const script = mainScript(chatHtml(webview, mark))
    expect(script).toContain('function plainMathText(text)')
    expect(script).toContain("copyCfg().plainMathFormat !== 'tex-delimited'")
    expect(script).toContain("'$$' + tex + '$$' : '$' + tex + '$'")
    expect(script).toContain("? () => String(token.content || '').trimEnd()")
    expect(() => new Function(script)).not.toThrow()
  })

  it('turns blockquote softbreak into <br> while keeping soft spaces elsewhere', () => {
    const script = mainScript(chatHtml(webview, mark))
    expect(script).toContain("if (top.closest('blockquote')) top.append(node('br'));")
    expect(script).toContain("else top.append(document.createTextNode(' '));")
    expect(() => new Function(script)).not.toThrow()
  })

  it('registers block actions (md/plain/LaTeX) and message actions (copy/fork)', () => {
    const script = mainScript(chatHtml(webview, mark))
    expect(script).toContain('const BLOCK_ACTIONS = {')
    expect(script).toContain("label: '复制为 Markdown'")
    expect(script).toContain("label: '复制纯文本'")
    expect(script).toContain("label: '复制 LaTeX'")
    expect(script).toContain('function blockPlainText(tokens, openIndex)')
    expect(script).toContain('TEXT_BLOCK_BREAK')
    expect(script).toContain('function ctxMenuForBlock(target)')
    expect(script).toContain('function messageForEl(article)')
    expect(script).toContain("ctxMenuOption('复制该消息'")
    expect(script).toContain("ctxMenuOption('从此消息分叉'")
    expect(script).toContain('BLOCK_ACTIONS[mkd.kind] || BLOCK_ACTIONS.default')
    expect(script).toContain("closest('.streaming')")
    expect(() => new Function(script)).not.toThrow()
  })

  it('routes fork via fork-session message and fills the draft on fork-created', () => {
    const script = mainScript(chatHtml(webview, mark))
    expect(script).toContain("vscode.postMessage({ type: 'fork-session' })")
    expect(script).toContain("event.data.type === 'fork-created'")
    expect(script).toContain('draftSlots.set(event.data.sessionId, { text: pendingForkText, images: [] })')
    expect(script).toContain('pendingForkText !== undefined')
    expect(() => new Function(script)).not.toThrow()
  })

  it('computes plain text from inline children (math→tex, table→tab rows, breaks)', () => {
    const mdInstance = new MarkdownIt()
    const { api } = runWebviewScript({ createMd: () => mdInstance })
    const paragraph = [
      { type: 'paragraph_open' },
      { type: 'inline', children: [
        { type: 'text', content: '值 ' },
        { type: 'math', tex: 'E=mc^2' },
        { type: 'softbreak' },
        { type: 'text', content: '第二行' },
      ] },
      { type: 'paragraph_close' },
    ]
    expect(api.blockPlainText(paragraph, 0)).toBe('值 E=mc^2 第二行')
    const table = [
      { type: 'table_open' }, { type: 'thead_open' },
      { type: 'tr_open' },
      { type: 'th_open' }, { type: 'inline', children: [{ type: 'text', content: 'A' }] }, { type: 'th_close' },
      { type: 'th_open' }, { type: 'inline', children: [{ type: 'text', content: 'B' }] }, { type: 'th_close' },
      { type: 'tr_close' }, { type: 'thead_close' }, { type: 'tbody_open' },
      { type: 'tr_open' },
      { type: 'td_open' }, { type: 'inline', children: [{ type: 'text', content: '1' }] }, { type: 'td_close' },
      { type: 'td_open' }, { type: 'inline', children: [{ type: 'text', content: '2' }] }, { type: 'td_close' },
      { type: 'tr_close' }, { type: 'tbody_close' }, { type: 'table_close' },
    ]
    expect(api.blockPlainText(table, 0)).toBe('A\tB\n1\t2')
    /* G27 round2 (0.0.49): 渲染管线中的公式是占位文本节点（MATH_PH_OPEN + mathEncode +
       ~0|~1 + MATH_PH_CLOSE）——纯文本复制应解码回 TeX 源而非原样透出编码串 */
    const ph = (tex, display) => '' + api.mathEncode(tex) + (display ? '~1' : '~0') + ''
    const mathPara = [
      { type: 'paragraph_open' },
      { type: 'inline', children: [
        { type: 'text', content: '引用行一（公式 ' + ph('E=mc^2', false) + ' 结尾）' },
      ] },
      { type: 'paragraph_close' },
    ]
    expect(api.blockPlainText(mathPara, 0)).toBe('引用行一（公式 E=mc^2 结尾）')
    const mathDisplay = [
      { type: 'paragraph_open' },
      { type: 'inline', children: [{ type: 'text', content: ph('a^2+b^2', true) }] },
      { type: 'paragraph_close' },
    ]
    expect(api.blockPlainText(mathDisplay, 0)).toBe('a^2+b^2')
    /* BLOCK_ACTIONS 的 math 分支输出 md 包装（$...$） */
    const latex = api.BLOCK_ACTIONS.math[0]
    expect(latex.label).toBe('复制 LaTeX')
  })

  it('0.0.167（B4 补档）: 列表纯文本保留 bullet/序号/缩进 + 表格 TSV/CSV', () => {
    const mdInstance = new MarkdownIt()
    const { api } = runWebviewScript({ createMd: () => mdInstance })
    const tokens = mdInstance.parse('- 第一项\n- 第二项\n  - 嵌套 A\n  - 嵌套 B\n\n1. 甲\n2. 乙', {})
    const bullet = tokens.findIndex((t: any) => t.type === 'bullet_list_open')
    expect(api.blockPlainText(tokens, bullet)).toBe('- 第一项\n- 第二项\n  - 嵌套 A\n  - 嵌套 B')
    const ordered = tokens.findIndex((t: any) => t.type === 'ordered_list_open')
    expect(api.blockPlainText(tokens, ordered)).toBe('1. 甲\n2. 乙')
    /* 表格：TSV（Excel 列分隔）→ CSV（含 , " 的单元按 RFC4180 最小引用转义） */
    const tableTokens = mdInstance.parse('| a | b |\n| --- | --- |\n| 1,2 | "x" |', {})
    const table = tableTokens.findIndex((t: any) => t.type === 'table_open')
    const tsv = api.blockPlainText(tableTokens, table)
    expect(tsv).toBe('a\tb\n1,2\t"x"')
    expect(api.tsvToCsv(tsv)).toBe('a,b\n"1,2","""x"""')
    const labels = api.BLOCK_ACTIONS.table.map((a: any) => a.label)
    expect(labels).toContain('复制为 Markdown')
    expect(labels).toContain('复制为 TSV（粘进 Excel/Sheets）')
    expect(labels).toContain('复制为 CSV')
  })

  it('0.0.167（B4）: 标签栏搜索 / 预览键盘导航 / 消息「…」/ 轨道 tooltip / 公式另存 PNG', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* P1-5 标签栏就地搜索：搜索行 + 过滤类 + 过滤/开关逻辑。 */
    expect(html).toContain('id="tabSearch"')
    expect(html).toContain('.session-tab.tab-filtered { display: none; }')
    expect(html).toContain('.tab-search-input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }')
    expect(script).toContain('function applyTabFilter()')
    expect(script).toContain("node.classList.toggle('tab-filtered', !match)")
    expect(script).toContain("elements.tabSearchToggle.addEventListener('click'")
    /* 0.0.168：回车优先跳内容命中，退回首个标题匹配。 */
    expect(script).toContain('const match = list.find(s => tabTitleOf(s).toLowerCase().includes(lower));')
    /* 过滤态下的标签不参与滚动定位（rect 全 0 会拉偏 reveal）。 */
    expect(script).toContain('const targets = nodes.filter(target => target !== undefined && target.isConnected && target.offsetWidth > 0)')
    /* P2 预览：图组下传 + ←/→（动图翻帧 / 静态跨图）+ hint 动态文案。 */
    expect(script).toContain('function messageGalleryOf(card)')
    expect(script).toContain('function previewStepImage(delta)')
    expect(script).toContain('function updatePreviewHint()')
    expect(script).toContain("parts.push('←/→ 切换图片（' + String(previewGalleryIndex + 1) + '/' + String(previewGallery.length) + '）')")
    expect(html).toContain('<span id="previewHintText">')
    /* P2 隐藏操作提示：消息尾行「…」在菜单里；轨道 tooltip 不再附"右键：收藏 / 标注"后缀
       （0.1.5 用户+朋友反馈：每节点都挂无意义且占宽）。 */
    expect(script).toContain('function renderMessageMenuAction(message)')
    expect(script).toContain('function messageMenuOptions(message, article)')
    /* 0.1.120：提示文案改挂 data-tip（自绘快提示读取；原生 title 弃用——延迟约 1s）。 */
    expect(script).toContain('entry.el.dataset.tip = title;')
    expect(script).not.toContain('右键：收藏 / 标注')
    /* 公式补档：另存为 PNG 文件（复用渲染管线 + 档位栅格化）。 */
    expect(script).toContain('function saveMathAsPngFile(b)')
    expect(script).toContain("label: '另存为 PNG 文件…'")
    expect(script).toContain("vscode.postMessage({ type: 'save-as', kind: 'image', name: formulaFileName('png'), data: png })")
    /* P1-6：附件按钮文案与选择器对称（非图片走 pin/复制链）。 */
    expect(html).toContain('title="附加图片或文件（也可直接拖入 / 粘贴）"')
    expect(() => new Function(script)).not.toThrow()
  })

  it('0.0.168（B4 反馈）: 内容搜索通道 + 结果面板 + 命中跳转高亮 + 输入框主题边框', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* 边框：照搬 VS Code 原生输入框写法（0.0.172：outline 聚焦环 + 2px 圆角 + 不透明输入底色）。 */
    expect(html).toContain('.tab-search-input { flex: 1; min-width: 0; height: 24px; padding: 0 8px; border: 1px solid var(--vscode-widget-border); border-radius: 6px; background: var(--vscode-editor-background);')
    expect(html).toContain('.tab-search-input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }')
    /* 结果面板 + 命中高亮动画。 */
    expect(html).toContain('id="tabSearchResults"')
    expect(html).toContain('.tab-search-hit-snippet')
    expect(html).toContain('.message.search-hit-flash { animation: dsh-search-hit 2.6s ease-out 1; }')
    /* 请求/回执：请求号守卫 + 防抖 + 面板渲染。 */
    /* 0.1.76（T3-5）：查询解析后只发**要搜的词**，排除词单列（query=include, excludes）。 */
    expect(script).toContain("vscode.postMessage({ type: 'search-sessions', query: parsed.include, excludes: parsed.excludes, requestId: searchRequestId })")
    expect(script).toContain("if (event.data.type === 'search-results')")
    expect(script).toContain('if (event.data.requestId !== searchRequestId) return;')
    expect(script).toContain('function scheduleSearch()')
    expect(script).toContain('function renderSearchResults()')
    /* 跳转：会话切换后定位首个命中（文本/文件名/图片名）并高亮；渲染帧里重试。 */
    expect(script).toContain('function jumpToSessionHit(sessionId, query)')
    expect(script).toContain('function findSearchHitMessage(query)')
    expect(script).toContain('function tryPendingSearchJump()')
    expect(script).toContain('for (const image of message.images || []) parts.push(String(image.name || \'\'));')
    expect(script).toContain('tryPendingSearchJump();')
    /* 标签过滤：标题 ∪ 内容命中。 */
    expect(script).toContain('const hitIds = new Set(searchHitsFor(query).map(item => item.sessionId));')
    expect(() => new Function(script)).not.toThrow()
  })

  it('0.0.169（用户反馈）: 当前会话本地命中 + 跨工作区标注 + 命中会话标题解析', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* 本地子串命中（不受运行时分词限制）：三路来源 + 回落 DOM 文本。 */
    /* 0.1.76（T3-5）：本地扫描吃排除词（第二个入参）。 */
    expect(script).toContain('function localSessionHits(query, excludes)')
    expect(script).toContain("if (typeof message.text === 'string' && message.text !== '') sources.push({ kind: '文本', text: message.text });")
    /* 0.1.97（真机反馈"中段搜不到"）：本地扫描改**全量 + 从新到旧 + 上限 60**（旧：从头扫、满 20 停 ⇒ 只有最旧 20 条）。 */
    expect(script).toContain('for (let cursor = allMessages.length - 1; cursor >= 0; cursor -= 1) {')
    expect(script).toContain('if (hits.length >= 60) break;')
    /* 0.1.66：命中跳转带"第几处"（逐处跳） */
    expect(script).toContain('function jumpToLocalHit(messageId, query, occurrence)')
    /* 面板按会话分组（0.1.94）；标签口径锚"搜索起点"（0.1.90）——组头统一打标签，行内不再重复标题。
       0.0.170：统一走 appendRow（行内 badge/count/inview）；组头由 searchRowModel 的组元数据渲染。 */
    expect(script).toContain('const isOrigin = currentId === origin;')
    expect(script).toContain("title: currentTitle, tag: isOrigin ? '当前会话' : '其他会话', tagClass: isOrigin ? 'tag-current' : 'tag-other', walkable: true,")
    expect(script).toContain("tag: subagent ? '子代理' : '其他工作区', tagClass: subagent ? 'tag-subagent' : 'tag-foreign', walkable: false,")
    expect(script).toContain("head.append(node('span', 'tab-search-tag ' + group.tagClass, group.tag));")
    expect(script).toContain('该会话属于其他工作区，本侧栏无法打开（可在官方 Web UI 打开该目录查看）')
    /* 命中会话标题来自扩展侧解析（此前显示裸 sessionId）。 */
    expect(script).toContain("title: hit.title !== '' ? hit.title : sessionTitle(hit.sessionId, hit.sessionId),")
    expect(html).toContain('.tab-search-tag {')
    /* 本地命中直接带 messageId（渲染帧内落位）。 */
    /* 0.1.97：待跳转耐心 8s→30s（大会话切回首绘慢时不再静默超时）。
       0.1.114（G55 Phase 2）：命中跳转带 pulse 旗标（编号片点击=跳段首+脉冲）——断言同步。 */
    expect(script).toContain("pendingSearchJump = { messageId, query, sessionId: target, occurrence: searchCursor.occurrence, deadline: Date.now() + 30_000,")
    expect(script).toContain("typeof pending.messageId === 'string' && pending.messageId !== ''")
    expect(() => new Function(script)).not.toThrow()
  })

  /* 0.1.94（用户拍板「先区域、再时间」）：结果面板**按会话分组**、走路表**由结果数据维护**（与渲染解耦）。
     判据（C1–C4）行为面由 _temp/dsh_harness/_probe_search_grouped.mjs 覆盖；此处锁死关键形态。
     全记录见 经验总结/2026-09-27_搜索逐处跳与索引修复全记录.md。 */
  it('0.1.94: 面板按会话分组 + 走路表数据驱动（与渲染解耦）', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    expect(script).toContain('function searchRowModel() {')
    expect(script).toContain('function syncWalkOrderFromModel(model) {')
    expect(script).toContain('function syncSearchWalkOrder() {')
    /* 组头渲染（标题 + 标签 + 条数） */
    expect(script).toContain("const head = node('div', 'tab-search-group');")
    expect(script).toContain("head.append(node('span', 'tab-search-group-count', String(group.rows.length) + ' 条'));")
    expect(html).toContain('.tab-search-group {')
    /* 组序：可跳组在前、搜索起点优先、组内最新命中时间降序 */
    expect(script).toContain('const originA = a.sessionId === origin ? 1 : 0;')
    expect(script).toContain('walkable: options.walkable === true')
    /* 陈旧选中行改按消息跟踪（0.1.95：升级为会话+消息复合键） */
    expect(script).toContain('let searchActiveKey = ')
    expect(script).toContain("if (activeIndex < 0 && searchActiveKey !== '') activeIndex = rowKeys.indexOf(searchActiveKey);")
    expect(script).toContain("const index = order.findIndex(hit => hit.sessionId === cursor.sessionId && hit.messageId === cursor.mid);")
    /* 走路表三处刷新：面板收起/结果晚到、渲染、会话落地 */
    expect(script).toContain('if (!tabSearchOpen() || searchPanelCollapsed) syncSearchWalkOrder();')
    expect(script).toContain("if (tabQuery.trim() !== '' && walkOrderSessionId !== current.sessionId) {")
    /* 旧定向语义（0.1.91 冻结 / 0.1.92 并集）不得复活 */
    expect(script).not.toContain('freezeHitOrder')
    expect(script).not.toContain('orderSeen')
    expect(script).not.toContain('searchHitOrder')
    expect(() => new Function(script)).not.toThrow()
  })

  /* 0.1.96（用户拍板三条）：② 工具卡内容默认不搜（设置台可开）；④ 结果行等高（元信息行恒在 + 摘要保底两行）；
     ⑤ 行内时间右显（绝对短日期）。另修：扩展侧一直随回包带的 time/snippetLong/total 此前被本处理器丢掉。 */
  it('0.1.96: 工具卡过滤开关 + 行等高元信息行 + 行内时间 + 回包三字段补齐', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* ② 设置通道 + 过滤 */
    expect(script).toContain('function searchIncludeTools() {')
    expect(script).toContain("if (hit.kind === '工具' && !includeTools) continue;")
    expect(script).toContain("settingsRow('搜索工具卡内容'")
    expect(script).toContain("postSetConfig('search.includeTools', value)")
    expect(script).toContain("kind: typeof item.kind === 'string' ? item.kind : '',")
    /* ④ 行等高：元信息行恒在（去掉"有内容才挂"）+ 摘要保底两行 */
    expect(script).not.toContain('if (title.childElementCount > 0) row.append(title);')
    expect(script).toContain('row.append(title);')
    expect(html).toContain('.tab-search-hit-title { min-height: 16px; }')
    expect(html).toContain('min-height: calc(1.45em * 2);')
    /* ⑤ 时间右显（绝对短日期） */
    expect(script).toContain('function searchTimeLabel(time) {')
    expect(script).toContain("if (timeLabel !== '') title.append(node('span', 'tab-search-hit-time', timeLabel));")
    expect(html).toContain('.tab-search-hit-time { margin-left: auto;')
    /* 回包三字段补齐（截图自查逮到的缺口） */
    expect(script).toContain("snippetLong: typeof item.snippetLong === 'string' ? item.snippetLong : '',")
    expect(script).toContain("time: typeof item.time === 'number' && isFinite(item.time) ? item.time : 0,")
    expect(script).toContain("total: typeof item.total === 'number' && item.total > 0 ? item.total : 1,")
    expect(() => new Function(script)).not.toThrow()
  })

  it('0.0.170: 本工作区索引命中段 + 标签分色白字 + 回收站标注 + 同消息去重', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* 标签配色（用户反馈①：灰字灰底对比度差）：白字 + 蓝/绿/橙/红分色。 */
    expect(html).toContain('.tab-search-tag { flex: 0 0 auto; display: inline-flex; align-items: center; height: 15px; padding: 0 5px; border-radius: 4px; font-size: 10px; font-weight: 600; line-height: 1; color: #ffffff; background: var(--vscode-charts-blue, #4d6bfe); }')
    expect(html).toContain('.tab-search-tag.tag-current { background: var(--vscode-charts-green, #3fa96b); }')
    expect(html).toContain('.tab-search-tag.tag-foreign { background: var(--vscode-charts-orange, #d18616); }')
    expect(html).toContain('.tab-search-tag.tag-trash { background: var(--vscode-charts-red, #e06c75); }')
    /* 索引段：local:true 分流 + 按（会话，消息）去重 + 回收站行给解释。
       0.1.94：去重改为**分组内**按消息 id（同一会话的命中聚在一组，组内不重复）。 */
    expect(script).toContain('let searchIndexHits = [];')
    expect(script).toContain('if (event.data.local === true) {')
    expect(script).toContain("if (row.messageId !== '' && group.seen.has(row.messageId)) return;")
    /* 2026-09-25（搜索打磨 S-1）：**标签口径修正**——索引命中若属搜索起点会话也打「当前会话」；
       0.1.83：基准是"搜索起点会话"（跳转不漂）；0.1.94：标签挂在组头（isOrigin）。 */
    expect(script).toContain('const isOrigin = hit.sessionId === origin;')
    expect(script).toContain("tag: trashed ? '回收站' : (isOrigin ? '当前会话' : '其他会话'),")
    expect(html).toContain('.tab-search-tag.tag-other {')
    expect(script).toContain('该会话在回收站中（恢复后即可打开并跳转）')
    expect(script).toContain('function jumpToMessageHit(sessionId, messageId, query, occurrence, pulse, seqHint)')
    /* 命中集合 = 索引 ∪ 运行时（标签过滤与计数都吃这两路）。 */
    expect(script).toContain('return searchIndexHits.concat(searchHits);')
    expect(() => new Function(script)).not.toThrow()
  })

  it('0.0.172: 搜索框原生输入观感（outline 聚焦环）+ 聚焦恢复结果面板 + 标签文字居中', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    expect(html).toContain('border-radius: 6px; background: var(--vscode-editor-background);')
    expect(html).toContain('.tab-search-input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }')
    expect(html).toContain('.tab-search-hit-title { display: flex; align-items: center; gap: 6px; min-width: 0;')
    expect(script).toContain("elements.tabSearchInput.addEventListener('focus', () => {")
    /* 0.1.79（用户报①）：恢复路径不再按"空查询"早退——空查询的面板 =「最近搜索」历史（T3-4），
       旧断言钉的是被移除的早退写法；现在两条恢复路径（focus/pointerdown）都只判 collapsed。 */
    expect(script).not.toContain("if (tabQuery.trim() === '' || !searchPanelCollapsed) return;")
    expect(script).toContain('if (!searchPanelCollapsed) return;')
    expect(() => new Function(script)).not.toThrow()
  })

  /* 0.1.80（用户报③"选完不会立刻显示出选项"）：工具/命令卡的卡面字段必须参与 canSoftUpdate 判据——
     否则结果帧（rawResult/detail/streaming 变化）走软更新、卡面不重渲，提问留痕卡一直停在"等待回答…"
     （真机/夹具实测：补丁帧后仍是 4 个"—"、0 个选项胶囊；切会话全量重建才显示"已回答 4/4"）。 */
  it('0.1.80: 工具/命令卡结果帧必须重建卡面（提问卡"选完不显示"根因）', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    expect(script).toContain("if (prev.role === 'tool' || prev.role === 'command') {")
    expect(script).toContain("if (String(prev.rawResult === undefined ? '' : prev.rawResult) !== String(next.rawResult === undefined ? '' : next.rawResult)) return false;")
    expect(script).toContain("if ((prev.streaming === true) !== (next.streaming === true)) return false;")
    expect(() => new Function(script)).not.toThrow()
  })

  /* 0.1.80（用户报④：停点节点显示成 "create_goal" 而非菱形）：旧回溯只走 1 跳且遇非留痕元素即中断，
     而 agent 答完提问后常先产出一条叙述再调下一个工具 ⇒ 锚点落回工具卡（标题=工具名、railNodeIsStop
     判不到 .ask-record ⇒ 无菱形）。由合成夹具覆盖该回归路径。 */
  it('0.1.80: 停点段锚点有界回溯 + 留痕卡节点标题取问题原文', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    expect(script).toContain('for (let hop = 0; hop < 12 && prev !== null && prev !== undefined; hop += 1) {')
    expect(script).not.toContain("if (prev.classList.contains('work-fold-bar')) { prev = prev.previousElementSibling; continue; }")
    expect(script).toContain("const questionEl = startEl.querySelector('.ask-record-question');")
    expect(() => new Function(script)).not.toThrow()
  })

  /* 0.1.81（用户拍板 E 方案，调研见 _temp/dsh_迁移计划/2026-09-26_搜索历史记录策略_调研与方案.md）：
     搜索触发（250ms 防抖）与写历史解耦——组合期（IME 拼音）不搜不记；回车/点结果为提交点立即写；
     否则停笔 1.2s 兜底写。旧实现把防抖当落历史信号 ⇒ 历史里出现 xia'zai / 瞎子啊。 */
  it('0.1.81: 搜索历史只在提交点落（组合期不记 / 回车 / 点结果 / 停笔 1.2s）', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    expect(script).toContain('const SEARCH_HISTORY_SETTLE_MS = 1200;')
    expect(script).toContain('function scheduleSearchHistory() {')
    expect(script).toContain('function flushSearchHistory() {')
    expect(script).not.toContain("pushSearchHistory(query);   /* T3-4")
    expect(script).toContain("elements.tabSearchInput.addEventListener('compositionstart', () => { searchComposing = true; cancelPendingSearch(); cancelSearchHistoryTimer(); });")
    expect(script).toContain('if (searchComposing || (event !== undefined && event !== null && event.isComposing === true)) return;')
    expect(script).toContain('if (searchComposing || event.isComposing === true || event.keyCode === 229) return;')
    expect(() => new Function(script)).not.toThrow()
  })

  /* 0.1.81（用户需求）：历史条目单条删除（不影响「清空历史」）。 */
  it('0.1.81: 历史条目带单条删除按钮（外层胶囊 + 内层点搜 + ✕）', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    expect(script).toContain("const row = node('div', 'tab-search-history-row');")
    expect(script).toContain("const del = node('button', 'tab-search-history-del', '✕');")
    expect(script).toContain('searchHistory = searchHistory.filter(item => item !== term);')
    expect(script).toContain("const clear = node('button', 'tab-search-history-clear', '清空历史');")
    expect(html).toContain('.tab-search-history-del {')
    expect(() => new Function(script)).not.toThrow()
  })

  /* 0.1.82（用户需求②）：跨会话返回胶囊加独立关闭按钮——外层改 div，内层「返回」与「✕」两枚 button。 */
  it('0.1.82: 返回胶囊带关闭按钮（返回文字与 ✕ 各自独立）', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    expect(html).toContain('<div id="searchReturnPill" class="search-return-pill hidden">')
    expect(html).toContain('<button id="searchReturnPillGo" class="search-return-pill-go" type="button"></button>')
    expect(html).toContain('<button id="searchReturnPillClose" class="search-return-pill-close" type="button" title="关闭"')
    expect(script).toContain("elements.searchReturnPillClose.addEventListener('click', (event) => {")
    expect(script).toContain("const go = document.getElementById('searchReturnPillGo');")
    expect(() => new Function(script)).not.toThrow()
  })

  /* 0.1.82（用户报④的第二个现场）：审批决定卡作锚点时，节点标题只取 record-title，
     不要把时钟（.record-time）与原因原文（.decision-reason）一起拼进去。 */
  it('0.1.82: 决定卡锚点标题取 record-title（不含时钟/原因）', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    expect(script).toContain("const titleEl = startEl.querySelector('.record-title');")
    expect(() => new Function(script)).not.toThrow()
  })

  /* 0.1.83（用户拍板"要切，但标签别漂"）：结果标签以**搜索起点会话**为基准，不随 Enter 逐处跳跨会话漂移。 */
  it('0.1.83: 结果标签锚定"搜索起点会话"（跳转不漂）', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    expect(script).toContain('function searchOriginSession() {')
    expect(script).toContain('function markSearchOrigin() {')
    expect(script).toContain('const origin = searchOriginSession();')
    expect(script).toContain('const isOrigin = hit.sessionId === origin;')
    expect(script).not.toContain('const inCurrent = state !== undefined && state !== null && hit.sessionId === state.sessionId;')
    expect(script).toContain("searchOriginSessionId = '';   /* 0.1.83：关面板即清")
    expect(() => new Function(script)).not.toThrow()
  })


  /* 0.1.87（用户拍板："只要我人还在原会话就别出现"）：胶囊可见性 = **渲染期纯判定**（每帧跑，
     不挂事件钩子）——0.1.84–0.1.86 的事件钩子（会话变化钩子 / 关面板撤 / 同会话作废）全部回退。
     0.1.88 只改判定内容（目标锚搜索起点），"渲染期纯函数 + 无事件钩子"这条不变量保持不变。 */
  it('0.1.87/0.1.88: 胶囊=渲染期纯判定；语义补丁与事件钩子不复活', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    expect(script).toContain('function syncSearchReturnPill() {')
    /* 已回退：旧函数/旧钩子一个不留 */
    expect(script).not.toContain('function searchReturnPillSane')
    expect(script).not.toContain('next.sessionId !== searchReturnPill.toId) hideSearchReturnPill()')
    expect(script).not.toContain('searchReturnPill.fromId && now !== searchReturnPill.toId')
    /* 保留：✕ 关闭按钮 + 设置台开关 + 组合期失焦复位 + 空查询撤计时 */
    expect(script).toContain('elements.searchReturnPillClose.addEventListener(')
    expect(script).toContain('function searchReturnPillEnabled() {')
    expect(script).toContain("elements.tabSearchInput.addEventListener('blur', () => { searchComposing = false; });")
    expect(script).toContain("if (query === '') cancelSearchHistoryTimer();")
    expect(script).toContain("searchSection.append(settingsRow('跨会话返回胶囊'")
    expect(() => new Function(script)).not.toThrow()
  })

  /* 0.1.88（用户拍板重建 + 用户需求）：胶囊目标锚**搜索起点**（与结果标签同源锚，0.1.83）——
     跨会话跳转 B→C→D **永不改写目标**（旧实现每跳改写 ⇒ 变成"返回上一站"，回到起点时票还亮着 = 用户所见）；
     可见性 = 渲染期纯函数（当前会话 ≠ 目标，人回到起点即隐）；只有"输入新查询"才重锚；
     显示时长入设置（search.returnPillSeconds，3–120 秒）。 */
  it('0.1.88: 胶囊锚搜索起点、跳转不改写、时长可配', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    expect(script).toContain('function noteSearchReturnPillJump(fromId) {')
    expect(script).toContain("searchReturnPill = { targetId: searchOriginSessionId !== '' ? searchOriginSessionId : fromId")
    expect(script).toContain("el.classList.toggle('hidden', now === searchReturnPill.targetId);")
    expect(script).toContain('function searchReturnPillSeconds() {')
    expect(script).toContain('if (searchReturnPill.seconds !== searchReturnPillSeconds()) armSearchReturnPillTimer();')
    expect(script).toContain('reanchorSearchReturnPill();')
    expect(script).toContain("settingsRow('返回胶囊显示时长'")
    expect(script).not.toContain('showSearchReturnPill(jumpFrom')
    expect(() => new Function(script)).not.toThrow()
  })

  /* 0.1.88（现有缺陷修复）：模板串里的单反斜杠会被求值吃掉（\s→s）——真页正则退化成 /s+/：
     搜含 s 的词恒 0 命中、结果片段吞 s。修复 = 6 处双写；本用例锁死产物必须带反斜杠。 */
  it('0.1.88: 模板转义修复（\\s / \\( 双写）——产物不得再出现被吃形态', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    expect(script).toContain('split(/\\s+/)')
    expect(script).not.toContain('split(/s+/)')
    expect(script).toContain('replace(/\\s+/g, ')
    expect(script).not.toContain('replace(/s+/g, ')
    expect(script).toContain('/^rgba?\\(([^)]+)\\)$/i')
    expect(() => new Function(script)).not.toThrow()
  })

  /* 0.1.84（审查）：停点锚点回溯以"上一段首节点"为下界，防跨段抓错留痕卡。 */
  it('0.1.84: 停点锚点回溯有下界（不越到上一段之前）', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    expect(script).toContain('const floorEl = previousSegment === undefined ? undefined : previousSegment.nodes[0];')
    expect(script).toContain('if (prev === floorEl) break;')
    expect(() => new Function(script)).not.toThrow()
  })


  /* 0.1.85（用户报②：搜 $NA$ 这类公式既不亮也不居中——现有缺陷）：KaTeX 逐字形 span ⇒ 单文本节点扫描落空；
     修法=公式容器整体粒度（跨元素 Range）＋两路合流按文档序排序（Enter 逐处跳吃这个顺序）。 */
  it('0.1.85: 公式命中——.katex 整体粒度跨元素 Range + 文档序排序', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    expect(script).toContain("const formulas = typeof root.querySelectorAll === 'function' ? root.querySelectorAll('.katex') : [];")
    expect(script).toContain('if (inMath(node)) { node = walker.nextNode(); continue; }')
    expect(script).toContain('out.sort((a, b) => a.compareBoundaryPoints(Range.START_TO_START, b));')
    expect(script).toContain('return out.slice(0, 40);')
    expect(() => new Function(script)).not.toThrow()
  })


  /* 0.1.86（用户复测②："整个公式都会亮，且逐字形分段看着奇怪"）：公式命中改**精确到命中字符**——
     扁平文本 + 节点偏移表定位首尾，只给命中的那几个字形上色（探针实测命中框≈整块公式的 23%）。 */
  it('0.1.86: 公式命中精确到字符（不再是整块公式）', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    expect(script).toContain('const locate = (index) => {')
    expect(script).toContain('const tail = locate(at + needle.length - 1);')
    expect(script).toContain('range.setEnd(tail.node, tail.offset + 1);')
    expect(script).not.toContain('range.setStart(first, 0);')
    expect(() => new Function(script)).not.toThrow()
  })

  it('0.0.174: 聚焦环不再被指针抑制规则吃掉 + 标签文字在色块内真居中', () => {
    const html = chatHtml(webview, mark)
    /* 文本输入框点击时也匹配 :focus-visible（规范）——抑制规则必须排除输入控件，否则搜索框聚焦无环。 */
    expect(html).toContain('body[data-input="pointer"] :focus-visible:not(input):not(textarea):not(select) { outline: none; }')
    expect(html).not.toContain('body[data-input="pointer"] :focus-visible { outline: none; }')
    expect(html).toContain('display: inline-flex; align-items: center; height: 15px;')
  })

  it('0.0.175（B5）: 圆角统一刻度 + 交互态蓝走主题变量 + 单文件上限入设置 + 文案群 + 启动占位/空态提示', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    /* A9 圆角刻度：只允许 2/4/6/8/12/999/50%（+ 方向性变体） */
    for (const bad of ['border-radius: 1px;', 'border-radius: 3px;', 'border-radius: 5px;', 'border-radius: 7px;', 'border-radius: 9px;', 'border-radius: 10px;', 'border-radius: 14px;', 'border-radius: 16px;']) {
      expect(html).not.toContain(bad)
    }
    expect(html).toContain('.settings-switch { position: relative; flex: 0 0 auto; width: 32px; height: 18px; padding: 0; border: 1px solid var(--vscode-widget-border); border-radius: 999px;')
    /* C-2 交互态蓝统一（品牌色除外）：composer 聚焦环 / 选中态 / chip 选择态 / 模式 chip */
    expect(html).toContain('.composer:focus-within { border-color: var(--vscode-charts-blue, #4d6bfe); box-shadow: 0 0 0 1px var(--vscode-charts-blue, #4d6bfe),')
    expect(html).toContain('.policy-trigger.active { color: var(--vscode-charts-blue, #4d6bfe);')
    expect(html).toContain('inset 0 0 0 1px color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, transparent)')
    /* 文案群：动效档位去"同工具栏快捷菜单"；纯文本公式补说明；25MB 入设置 */
    expect(script).toContain("settingsRow('动效档位', 'Standard / Dots / Off（未加载完成时的占位动画）'")
    expect(script).not.toContain('同工具栏快捷菜单')
    expect(script).toContain("settingsRow('纯文本复制中的公式', '块复制按钮的「纯文本」档与右键「复制纯文本」里")
    expect(script).toContain("settingsRow('单文件大小上限',")
    expect(script).toContain('maxFileMB')
    expect(script).not.toContain('if (file.size > 25_000_000) { skipped += 1; continue; }')
    expect(script).toContain('个文件超过 ' + "' + String(cfg.maxFileMB) + '" + 'MB 已跳过')
    /* A10/A11：启动占位 + 空态提示 */
    expect(html).toContain('id="bootPlaceholder"')
    expect(html).toContain('@keyframes a7-boot-pulse')
    expect(script).toContain("empty.append(node('div', 'empty-hints', '@ 提及文件 · 拖入图片/文件 · / 查看命令'));")
    expect(() => new Function(script)).not.toThrow()
  })

  it('0.1.0 修复: 模式与权限菜单选项用 UI 字体（不再复用 / 命令列表的等宽名）', () => {
    const html = chatHtml(webview, mark)
    const script = mainScript(html)
    expect(script).toContain("node('span', 'command-option-name policy-option-name', label)")
    expect(html).toContain('.policy-option-name { font-family: var(--vscode-font-family); }')
    /* 0.1.0 回归教训：标题行必须真的 append（上一版删掉了它 → 权限标题全消失）；
       描述仅在与标题不同文时渲染。 */
    expect(script).toContain('option.append(line);')
    expect(script).toContain("String(description).trim() !== String(label).trim()")
    /* 改名清空 = 恢复默认名（空值也要上报）。 */
    expect(script).toContain("if (pendingRenameId) vscode.postMessage({ type: 'rename-session', sessionId: pendingRenameId, title });")
    expect(html).toContain('placeholder="留空=恢复默认名"')
    expect(() => new Function(script)).not.toThrow()
  })

  it('flashes the copied host block with the math-blue ring (G27 0.0.50)', () => {
    const mdInstance = new MarkdownIt()
    const { api } = runWebviewScript({ createMd: () => mdInstance })
    const calls = []
    const host = {
      offsetWidth: 0,
      classList: {
        add: (c) => calls.push('add:' + c),
        remove: (c) => calls.push('remove:' + c),
        contains: () => false,
      },
    }
    api.flashCopied(host)
    /* remove 先行（确保 reflow 后动画可重播），再 add 触发 dsh-copied-flash */
    expect(calls[0]).toBe('remove:copied-flash')
    expect(calls[calls.length - 1]).toBe('add:copied-flash')
  })
})

describe('G39 session view memory (0.0.93)', () => {
  const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
  const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
  const script = mainScript(chatHtml(webview, mark))

  it('keeps per-session memo maps instead of clearing on switch', () => {
    expect(script).toContain('const viewMemo = new Map();')
    expect(script).toContain('let expandedToolIds = new Set();')
    /* 旧行为（切会话直接 clear）必须不存在 */
    expect(script).not.toContain('expandedToolIds.clear()')
    expect(script).toContain('expandedToolIds = memCfg.expand ? incomingMemo.expanded : new Set();')
    /* 0.0.108（回归修复②）: 恢复位只对空闲会话生效——运行中（或审批/提问）的会话默认跟底。 */
    expect(script).toContain('followConversationTail = !memCfg.scroll || incomingMemo.atBottom || followLive;')
    expect(script).toContain('startViewRestore(current.sessionId, incomingMemo, memCfg.scroll && !followLive);')
  })

  it('restores scroll via anchor + correction window (v2) and persists via session-view-state', () => {
    expect(script).toContain('if (restoreCtx && restoreCtx.sessionId === current.sessionId) scheduleViewRestore();')
    expect(script).toContain('elements.scroll.scrollTop += (anchorRect.top - scrollRect.top) + ctx.anchorOffset;')
    expect(script).toContain('const VIEW_RESTORE_WINDOW_MS = 2500;')
    /* 0.1.28：锚节点被"工作段折叠"隐藏（零矩形）时不得照算——退回数值位置，不把视图扔走。 */
    expect(script).toContain('const anchorUsable = anchorRect !== undefined && (anchorRect.width > 0 || anchorRect.height > 0);')
    /* 0.1.28：临时窗口必须有结束判定且不许悬挂（悬挂会让锚缓存永久停更 → 位置被拽回旧锚点）。 */
    expect(script).toContain('function restoreWindowOver(ctx) {')
    expect(script).toContain('if (restoreAnchorInPlace(ctx)) return true;')
    expect(script).toContain('function extendRestoreWindow() {')
    /* 用户自己滚动 → 停止校正（程序性滚动除外） */
    /* 0.1.26：浏览器"内容变矮→scrollTop 钳到边界"也会派 scroll 事件，须豁免（否则校正被吞）。
       0.1.128：**历史合并校正窗**例外——用户滚动时"重锚到当前位置"而非关窗（内容头顶增长照常补针）。 */
    expect(script).toContain("if (!atEdge || restoreCtx.kind === 'history-merge' || nativeScroll) {")
    expect(script).toContain("restoreCtx.kind === 'history-merge'")
    expect(script).toContain("const atEdge = el.scrollTop <= 0.5 || el.scrollTop >= Math.max(0, el.scrollHeight - el.clientHeight) - 0.5;")
    /* 0.1.26：拖动侧栏宽度的锚点校正（ResizeObserver 是布局后通知 → 用滚动时预存的锚）。 */
    expect(script).toContain('function beginResizeAnchor() {')
    expect(script).toContain('const anchor = viewFocusAnchor;')
    expect(script).toContain('beginResizeAnchor();')
    expect(script).toContain("type: 'session-view-state', sessionId,")
    expect(script).toContain('expanded: [...memo.expanded], folds: Object.fromEntries(memo.folds), blocks: Object.fromEntries(memo.blocks),')
  })

  it('remembers tall-block folds per message id + source line (v2)', () => {
    expect(script).toContain("srcInfo.keyPrefix + '#' + token.map[0]")
    expect(script).toContain("if (folded) memo.blocks.set(mk, 'folded'); else memo.blocks.delete(mk);")
    expect(script).toContain("const memoFolded = mk !== undefined && viewMemoryCfg().fold && typeof renderedSessionId === 'string' && viewMemoOf(renderedSessionId).blocks.get(mk) === 'folded';")
    /* 整消息渲染时带 keyPrefix（工具输出页等不带 → 不参与记忆） */
    expect(script).toContain('(markdown ? markdown.root : renderMarkdown(message.text, message.id))')
  })

  it('seeds persisted state before first render (view-state message from extension)', () => {
    expect(script.includes("event.data.type === 'view-state' && Number.isSafeInteger(event.data.revision)")).toBe(true)
    expect(script.includes('seedViewMemo(event.data.states);')).toBe(true)
    expect(script).toContain("if (existing !== undefined) clearTimeout(existing);")
  })

  it('opens completed tool cards that carry an expanded memo (drop the live gate)', () => {
    expect(script).toContain('item.open = live || message.failed === true || expandedToolIds.has(message.id);')
    expect(script).not.toContain('expandedToolIds.has(message.id) && live')
  })

  it('records fold/expand changes with the message id', () => {
    expect(script).toContain('item.dataset.mid = message.id;')
    expect(script).toContain("viewMemoOf(renderedSessionId).folds.set(mid, collapsing ? 'folded' : 'expanded');")
    expect(script).toContain("if (viewMemoryCfg().expand && typeof renderedSessionId === 'string') scheduleViewStatePersist(renderedSessionId);")
    expect(script).toContain('const memoized = viewMemoryCfg().fold && typeof message.id === \'string\' ? viewMemoOf(state.sessionId).folds.get(message.id) : undefined;')
  })

  it('seedViewMemo merges persisted state once and filters junk', () => {
    const { api } = runWebviewScript()
    api.seedViewMemo({
      s1: { scrollTop: 123.4, atBottom: false, anchorId: 'msg-42', anchorOffset: 120, expanded: ['m1', '', 5], folds: { m2: 'expanded', m3: 'bogus' }, blocks: { 'm2#7': 'folded', bad: 'expanded' } },
      s2: 'junk',
    })
    const memo = api.viewMemoOf('s1')
    expect(memo.scrollTop).toBe(123.4)
    expect(memo.atBottom).toBe(false)
    expect(memo.anchorId).toBe('msg-42')
    expect(memo.anchorOffset).toBe(120)
    expect([...memo.expanded]).toEqual(['m1'])
    expect([...memo.folds.entries()]).toEqual([['m2', 'expanded']])
    expect([...memo.blocks.entries()]).toEqual([['m2#7', 'folded']])
    /* 已存在的会话不被二次 seed 覆盖 */
    api.seedViewMemo({ s1: { scrollTop: 999, atBottom: true, expanded: [], folds: {} } })
    expect(api.viewMemoOf('s1').scrollTop).toBe(123.4)
    /* 未知会话得到默认记忆（贴底） */
    expect(api.viewMemoOf('never-seen').atBottom).toBe(true)
  })
})

describe('D1 动作行悬停浮出（0.1.45）', () => {
  const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
  const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
  const html = chatHtml(webview, mark)
  const script = mainScript(html)

  it('开关读 state.uiSettings.hoverActions（默认开）且纳入视图配置键', () => {
    expect(script).toContain('const hoverActionsOn = () => !(state !== undefined && state !== null && state.uiSettings !== undefined && state.uiSettings !== null && state.uiSettings.hoverActions === false);')
    expect(script).toContain('current.uiSettings.hoverActions !== false')
    /* 按钮组**行内**接在时间右侧（0.1.46 修订：绝对定位版会压住时间）；关掉即整段 CSS 失效。 */
    expect(html).toContain('body[data-hover-actions="on"] .hover-actions { display: inline-flex;')
  })

  it('静止只挂时间行；开关关掉时回到常显整行', () => {
    expect(script).toContain('function syncActionStamp(articleEl, message) {')
    expect(script).toContain('if (hoverActionsOn()) { syncActionStamp(articleEl, message); return; }')
    expect(script).toContain('articleEl.append(renderMessageActions(message));')
  })

  it('全篇唯一共享按钮组（行内接在时间右侧）+ 悬停/键盘焦点两条浮出路径', () => {
    expect(script).toContain("hoverActionBar = node('div', 'hover-actions');")
    expect(script).toContain('const fresh = renderMessageActions(message, true);')
    expect(script).toContain('row.append(bar);')
    expect(script).toContain('row.prepend(span); /* 时间永远排最前（按钮组在其右侧） */')
    expect(script).toContain("elements.messages.addEventListener('focusin', (event) => {")
    expect(script).toContain("document.body.dataset.hoverActions = 'on';")
  })
})

describe('设置台「性能」区（0.1.48）', () => {
  const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
  const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
  const script = mainScript(chatHtml(webview, mark))

  it('两个"默认开 = 更快"的开关集中在新「性能」区，且开关按默认开渲染（ui 缺字段不显示成关）', () => {
    expect(script).toContain("const perfSection = settingsSection('性能');")
    expect(script).toContain("perfSection.append(settingsRow('折叠内容按需构建'")
    expect(script).toContain("perfSection.append(settingsRow('动作行悬停显示'")
    expect(script).toContain('settingsSwitch(ui.lazyFoldedBodies !== false, value => postSetConfig(\'ui.lazyFoldedBodies\', value))')
    expect(script).toContain('settingsSwitch(ui.hoverActions !== false, value => postSetConfig(\'ui.hoverActions\', value))')
    /* 旧位置（诊断区）不得再挂这两行——防回归双份 */
    expect(script).not.toContain("diagSection.append(settingsRow('折叠内容按需构建'")
    expect(script).not.toContain("diagSection.append(settingsRow('动作行悬停显示'")
  })
})

describe('webview 内嵌脚本可编译（模板串雷区静态防线）', () => {
  it('各非空 script 块都能通过语法编译——模板串里混入反引号 / 单反斜杠转义被吞，都会在这里立刻暴露', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)
    const blocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim() !== '')
    expect(blocks.length).toBeGreaterThan(0)
    for (const block of blocks) {
      /* 只编译不执行。0.1.45/0.1.49 两次实中：① 注释里写反引号 → 模板串提前结束；
         ② 正则里写 \s（模板求值后变成 s）→ 脚本语法错误 ⇒ 生产 UI 全死。 */
      expect(() => new Function(block)).not.toThrow()
    }
  })
})

describe('D2 公式瘦身：仅渲染 HTML 层 + MathML 按需生成（0.1.49）', () => {
  const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
  const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
  const script = mainScript(chatHtml(webview, mark))

  it('KaTeX 只输出 HTML（隐藏 MathML 层不再进 DOM），并给公式容器加无障碍名', () => {
    expect(script).toContain("mdvK.katex.render(tex, k, { displayMode: display === true, throwOnError: false, output: 'html' })")
    expect(script).toContain("span.setAttribute('role', 'math');")
    expect(script).toContain("span.setAttribute('aria-label', tex);")
  })

  it('MathML 出口走按需生成（mathmlOf 缓存；两个出口都改用它）', () => {
    expect(script).toContain('function mathmlOf(b) {')
    expect(script).toContain("if (typeof b.mathml === 'string') return b.mathml;")
    expect(script).toContain('const mathml = mathmlOf(b);')
    expect(script).toContain("copyCfg().mathFormat === 'mathml' && span.__mkd !== undefined ? mathmlOf(span.__mkd) : ''")
    /* 旧路径（渲染期从 DOM 取 .katex-mathml）必须已消失——防回潮双份 */
    expect(script).not.toContain("querySelector('.katex-mathml math')")
  })
})

describe('消息块布局包含（0.1.52）', () => {
  const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
  const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
  const html = chatHtml(webview, mark)
  const script = mainScript(html)

  it('CSS 只作用于 #messages 直接子级（消息块），默认开由状态门控', () => {
    expect(html).toContain('.cv-offscreen #messages > .message { contain: content; }')
    expect(script).toContain('const messageContainmentOn = () => !(state !== undefined && state !== null && state.uiSettings !== undefined && state.uiSettings !== null && state.uiSettings.messageContainment === false);')
    expect(script).toContain("elements.messages.classList.toggle('cv-offscreen', on);")
    /* 切换是纯 CSS 类 ⇒ 不进 viewCfgKeyOf（不触发整会话重建） */
    expect(script).not.toContain('current.uiSettings.messageContainment')
    /* 排版行为变化要置脏轨道几何 */
    expect(script).toContain('railGeomDirty = true;\n    }')
  })

  it('设置台「性能」区有一行，且默认按开渲染', () => {
    expect(script).toContain("perfSection.append(settingsRow('消息块布局包含'")
    expect(script).toContain("settingsSwitch(ui.messageContainment !== false, value => postSetConfig('ui.messageContainment', value))")
  })
})
