/**
 * 0.0.88：会话标题取值——统一「本地持久化 → 投影 → 回退」三级来源。
 * 背景：重启后会话是冷的，dsh session.list 不下发投影块（无 title）；
 * 打开过的会话标题已持久化到 workspaceState，需要优先于空投影使用。
 * 纯函数（不 import vscode），测试见 tests/session-titles.spec.ts。
 */

/** 0.1.0 修复（用户实测"会话名称出问题"）：运行时在 LLM 标题就绪前会下发**首条消息截断**的
 *  回退标题；而首条消息带本扩展注入的 IDE 上下文信封，回退标题就成了
 *  `<dsh-vscode-ide-context> Treat this JSON…`。这类标题不得展示/学习——本地标题一旦写下会
 *  **恒优先**于投影，运行时随后生成的好标题再也进不来（实测：本地存着信封标题，运行时已是
 *  "查询当前时间"）。 */
export function isBrokenSessionTitle(value: unknown): boolean {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.startsWith('<dsh-vscode-ide-context')
}

export function resolveSessionTitle(projected: unknown, persisted: string | undefined): string {
  const remembered = typeof persisted === 'string' ? persisted.trim() : ''
  if (remembered !== '' && !isBrokenSessionTitle(remembered)) return remembered
  const value = typeof projected === 'string' ? projected.trim() : ''
  return value !== '' && !isBrokenSessionTitle(value) ? value : '新建会话'
}
