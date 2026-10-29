import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/* 0.1.20（2026-09-22 真机事故）静态防线：
   扩展宿主（extension.ts / dsh-client.ts / notify.ts …）跑在 Node 里，**没有 window**。
   事故当天 syncTaskNotifications 里写了 window.setTimeout → ReferenceError 从 publish 冒穿
   WebSocket 'message' 处理器，同一次 TCP 读取里后续帧全丢、close 事件永不触发（连接僵尸化、
   重连永不启动、侧栏静默冻结）。
   这里按源码扫描封死这一类：宿主侧文件不得出现浏览器全局。webview.ts 是浏览器侧（允许）。 */

const SRC = join(process.cwd(), 'src')

/* 只认"裸浏览器全局的 DOM 调用面"：vscode.window 前面是 '.'（被排除）；document 在宿主侧
   常做局部变量（TextDocument / 拖入的文件对象），故只盯 DOM 成员名；注释行整行跳过。 */
const FORBIDDEN = [
  { name: 'window', pattern: /(?<![.\w$])window\s*\.\s*(setTimeout|setInterval|clearTimeout|clearInterval|addEventListener|removeEventListener|location|open|focus|postMessage|requestAnimationFrame|cancelAnimationFrame|innerWidth|innerHeight|matchMedia|localStorage|document)\b/ },
  { name: 'document', pattern: /(?<![.\w$])document\s*\.\s*(createElement|createTextNode|querySelector|querySelectorAll|getElementById|documentElement|execCommand|addEventListener|body|head|hidden)\b/ },
  { name: 'localStorage', pattern: /(?<![.\w$])localStorage\s*\./ },
  { name: 'navigator', pattern: /(?<![.\w$])navigator\s*\.\s*(clipboard|userAgent|language|languages)\b/ },
  { name: 'requestAnimationFrame', pattern: /(?<![.\w$])requestAnimationFrame\s*\(/ },
]

/** 注释行整行跳过（本次事故的注释里就写了 window.setTimeout 这个反面教材）。 */
function isComment(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
}

/** 宿主侧 = src 下的 .ts/.js，除浏览器侧 webview 与随 webview 一起打包的浏览器模块。 */
function hostFiles(): string[] {
  return readdirSync(SRC)
    .filter(name => (name.endsWith('.ts') || name.endsWith('.js')) && !name.endsWith('.d.ts'))
    .filter(name => !name.startsWith('webview'))
    .filter(name => name !== 'webview-chrome.js' && name !== 'original-text-map.js')
    .filter(name => !name.startsWith('markdown-vendor'))
    .filter(name => !name.startsWith('debug-runtime-patch'))
}

describe('宿主侧禁用浏览器全局（0.1.20 事故静态防线）', () => {
  const files = hostFiles()

  it('扫描面非空（防"过滤过头导致假绿"）', () => {
    expect(files.length).toBeGreaterThan(30)
    expect(files).toContain('extension.ts')
    expect(files).toContain('dsh-client.ts')
  })

  for (const file of hostFiles()) {
    it(`${file} 不含浏览器全局`, () => {
      const text = readFileSync(join(SRC, file), 'utf-8')
      const hits: string[] = []
      for (const rule of FORBIDDEN) {
        text.split('\n').forEach((line, index) => {
          if (isComment(line)) return
          if (rule.pattern.test(line)) hits.push(`${file}:${String(index + 1)} ${rule.name} → ${line.trim().slice(0, 90)}`)
        })
      }
      expect(hits).toEqual([])
    })
  }
})
