import * as fs from 'node:fs'
import * as path from 'node:path'

/** 0.0.55（反馈⑧）: 显示名 —— basename 去 `.dsh-paste` 存储时间戳前缀（≥10 位数字 + 连字符）。
   与 webview 侧 displayFileName 同规则（存储/历史不动，仅显示与复制取用）。 */
export function displayNameOf(nameOrPath: string): string {
  const base = String(nameOrPath).split(/[\\/]/).pop() || ''
  return base.replace(/^\d{10,}-/, '')
}

/** Resolve an existing path to its filesystem identity without guessing case semantics. */
/* 2026-10-06（W8，性能）：realpath 结果进程内记忆——acceptFrame 逐事件做路径比较，同一路径在一次
   回合里会被反复解析（真机剖面 realpath 链 1.0s/27min）。只缓存**命中**（已存在文件的真实身份稳定）；
   未命中不缓存（文件可能稍后创建，保持"创建后即可得真身份"语义）。简单上限防膨胀。 */
const realPathCache = new Map<string, string>()
const REALPATH_CACHE_MAX = 2000
export function comparableFilePath(filePath: string): string {
  const normalized = path.normalize(filePath)
  const cached = realPathCache.get(normalized)
  if (cached !== undefined) return cached
  try {
    const resolved = path.normalize(fs.realpathSync.native(normalized))
    if (realPathCache.size >= REALPATH_CACHE_MAX) {
      const oldest = realPathCache.keys().next()
      if (!oldest.done) realPathCache.delete(oldest.value)
    }
    realPathCache.set(normalized, resolved)
    return resolved
  } catch {
    // Missing paths have no filesystem identity yet. Preserve their spelling so
    // case-sensitive volumes never merge two distinct future files.
    return normalized
  }
}

/* 0.1.22（用户实测：agent 在正文里给的链接 `figures/own/x.png` 点开报 ENOENT，其实文件就在项目的
   `_temp/drafts/.../figures/own/` 下）：**agent 的链接常是相对它自己工作目录写的**，按项目根解析会落空。
   回退搜索把"路径后缀"当 glob（双星号 + 斜杠 + 后缀），命中即打开；多命中按下面的排序取最匹配。 */

/* 反斜杠 → 正斜杠（路径分隔符统一；写成常量是为了让正则源码里只有一个反斜杠字符）。 */
const BACKSLASH_RE = new RegExp('\\\\', 'g')

/** 相对路径 → 回退搜索用的 glob；绝对路径 / 越界（../）不搜（那种情况落空就是真没有）。 */
export function linkSearchPattern(value: string): string | undefined {
  const raw = String(value).trim().replace(BACKSLASH_RE, '/')
  if (raw === '' || raw.startsWith('../') || raw.includes('/../')) return undefined
  if (/^[a-zA-Z]:\//.test(raw) || raw.startsWith('/')) return undefined
  const relative = raw.replace(/^\.\//, '')
  return relative === '' ? undefined : '**/' + relative
}

/** 候选排序（越小越优先）：`_temp/` 下的优先（本项目 AI 产出的默认归位处），其次路径越浅越优先。 */
export function rankLinkCandidate(cwd: string, filePath: string): number {
  const relative = path.relative(cwd, filePath).replace(BACKSLASH_RE, '/')
  const inTemp = relative === '_temp' || relative.startsWith('_temp/') || relative.includes('/_temp/')
  return (inTemp ? 0 : 1000) + relative.split('/').length
}

/* 0.1.23（用户实测：图片链接被当文本打开 → "文件似乎是二进制文件，不能作为文本打开"）：
   链接点击后的"用不用文本编辑器打开"判定——图片由调用方先行分流（走侧栏预览），
   这里只回答"其余里哪些该进文本编辑器"：**无扩展名按文本**（LICENSE / Makefile 这类），
   有扩展名但不在文本集合里的一律交 VS Code（pdf、二进制、未知格式），不再硬塞 openTextDocument。 */
export function linkOpensAsText(extension: string, textExtensions: ReadonlySet<string>): boolean {
  if (extension === '') return true
  return textExtensions.has(extension)
}
