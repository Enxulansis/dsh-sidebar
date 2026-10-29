// @ts-nocheck — vendored webview-only entry; built by scripts/build.mjs (esbuild IIFE).
/* G15 (0.0.30): vendored markdown pipeline for the webview.
 * Bundled as an IIFE (`markdown-vendor.js`) and injected as a second
 * <script nonce> — the visible surface is window.__g15md. Never import
 * tobes into the extension bundle; this file is a webview-only entry. */
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import katex from 'katex'
import { createHighlighterCore } from '@shikijs/core'
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript'
import langPython from '@shikijs/langs/python'
import langJavascript from '@shikijs/langs/javascript'
import langTypescript from '@shikijs/langs/typescript'
import langJson from '@shikijs/langs/json'
import langYaml from '@shikijs/langs/yaml'
import langHtml from '@shikijs/langs/html'
import langCss from '@shikijs/langs/css'
import langBash from '@shikijs/langs/bash'
import langSql from '@shikijs/langs/sql'
import langMarkdown from '@shikijs/langs/markdown'
import themeGithubDark from '@shikijs/themes/github-dark'

declare global {
  interface Window {
    __g15md?: {
      createMd: () => MarkdownIt
      katex: typeof katex
      tokenize: (lang: string, code: string) => Promise<Array<Array<{ content: string, color: string }>> | undefined>
      /** Promise of the dynamically imported ighlighter readiness (already started) */
      ready: Promise<undefined | unknown>
    }
  }
}

const md = new MarkdownIt({ html: false, linkify: true, breaks: false })
md.use(taskLists, { label: false, labelAfter: false })
// G15 (0.0.33, A-report P0): the inline escape rule folds `\\`→`\` and drops
// `\e`-style sequences before our math scanner ever runs — matrix rows, \(…\)
// and `\$` prices all arrive corrupted. AI output is not hand-authored
// markdown: keeping escapes verbatim is strictly better (scanner owns `\$`).
md.inline.ruler.disable(['escape'])

const langAlias: Record<string, string> = {
  python3: 'python', py: 'python',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  yml: 'yaml', sh: 'bash', zsh: 'bash', shell: 'bash', console: 'bash', 'shell-session': 'bash',
  md: 'markdown', html5: 'html', vue: 'html', xml: 'html',
}
const grammar = (name: string) => {
  switch (name) {
    case 'python': return langPython
    case 'javascript': return langJavascript
    case 'typescript': return langTypescript
    case 'json': return langJson
    case 'yaml': return langYaml
    case 'html': return langHtml
    case 'css': return langCss
    case 'bash': return langBash
    case 'sql': return langSql
    case 'markdown': return langMarkdown
    default: return undefined
  }
}

const highlighterPromise: Promise<unknown | undefined> = createHighlighterCore({
  themes: [themeGithubDark],
  langs: [langPython, langJavascript, langTypescript, langJson, langYaml, langHtml, langCss, langBash, langSql, langMarkdown],
  engine: createJavaScriptRegexEngine({ forgiving: true }),
}).then((hl) => hl).catch(() => undefined)

window.__g15md = {
  createMd: () => md,
  katex,
  ready: highlighterPromise,
  tokenize: async (lang, code) => {
    const hl = await highlighterPromise as { codeToTokens: (code: string, opts: { lang: string, theme: string }) => Promise<{ tokens: Array<Array<{ content: string, color?: string }>> }> } | undefined
    if (!hl) return undefined
    const alias = langAlias[String(lang || '').toLowerCase()] || String(lang || '').toLowerCase()
    if (!grammar(alias)) return undefined
    try {
      const out = await hl.codeToTokens(code, { lang: alias, theme: 'github-dark' })
      return out.tokens.map(line => line.map(t => ({ content: t.content, color: t.color || '#e1e4e8' })))
    } catch { return undefined }
  },
}
