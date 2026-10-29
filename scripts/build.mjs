import { build } from 'esbuild'
import { cp, rm } from 'node:fs/promises'

await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true })

await build({
  entryPoints: { extension: 'src/extension.ts' },
  outdir: 'dist',
  entryNames: '[name]',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['vscode'],
  minify: true,
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
})

// Vendored image codecs (G17): injected into the webview as a second <script nonce>.
// UTIF.js resolves pako via `self.pako` at module top-level, so pako must load first.
await cp('node_modules/utif2/UTIF.js', 'dist/utif.js')
await cp('node_modules/pako/dist/pako.min.js', 'dist/pako.js')
// G5 (0.0.39): 消息元信息格式函数注入 webview（vendoredChrome）——与 pako/utif 同源同通道。
await cp('src/webview-chrome.js', 'dist/webview-chrome.js')
// G15 (0.0.33): KaTeX styles must ship inside the webview bundle — before this
// line vendoredMarkdownStyles() always read an empty string and production
// formulas rendered unstyled (D-report P0).
await cp('node_modules/katex/dist/katex.min.css', 'dist/katex.min.css')
// G15 (0.0.34): KaTeX webfonts embedded as base64 data URIs — without them the
// formula glyphs fall back to system serif (user: "字体不统一，观感不佳" for Σ/n/i).
// The embedded CSS stays the single runtime artifact; fonts/ never ships.
await cp('node_modules/katex/dist/fonts', 'dist/katex/fonts', { recursive: true })
// G45 (0.0.103): MathJax tex-svg 组件——「复制为 SVG」用（webview 懒加载，见 ensureMathJax；不进 HTML 内联）。
await cp('node_modules/mathjax/es5/tex-svg.js', 'dist/mathjax-tex-svg.js')
// G45 (0.0.103): 颜色工具（设置台色板）——注入 webview + vitest 直测，同 webview-chrome 通道。
await cp('src/color-utils.js', 'dist/color-utils.js')
// G50 (0.0.109): 「中文 → 英文原文」映射（脚本生成物，gen-original-text-map.mjs）——注入 webview。
await cp('src/original-text-map.js', 'dist/original-text-map.js')
{
  const { readFileSync, writeFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const dist = fileURLToPath(new URL('../dist', import.meta.url))
  const css = readFileSync(join(dist, 'katex.min.css'), 'utf8')
  const fontsDir = join(dist, 'katex', 'fonts')
  const embedded = css.replace(/url\(fonts\/([^)]+\.woff2)\)/g, (match, name) => {
    const bytes = readFileSync(join(fontsDir, name))
    return `url(data:font/woff2;base64,${bytes.toString('base64')})`
  })
  writeFileSync(join(dist, 'katex-embedded.css'), embedded)
}

// G15 (0.0.30): vendored markdown pipeline (markdown-it + task-lists + KaTeX +
// shiki with the JavaScript regex engine — wasm-free, CSP untouched). The IIFE
// exposes window.__g15md and is injected like the codecs above.
await build({
  entryPoints: { 'markdown-vendor': 'src/markdown-vendor-entry.ts' },
  outdir: 'dist',
  format: 'iife',
  platform: 'browser',
  bundle: true,
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
})
