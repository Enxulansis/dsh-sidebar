/* 0.0.160（N1）：任务通知——纯决策逻辑（可单测；OS 通知本体留在 extension）。
   判据（2026-09-18 用户确认）：
   ① 需要你操作（审批/提问）且你不在看 → 必达；
   ② 正看着（窗口聚焦 + 侧栏可见）→ 一律不弹；同一等待只提醒一次；
   ③ 跑完提醒可配（需要操作+跑完 / 仅需要操作 / 关闭）；
   ④ 只有"新出现的等待"与"新结束的回合"才提醒——Reload/重载时已有的等待不补弹。 */

export type NotifyLevel = 'all' | 'action' | 'off'

export const DEFAULT_NOTIFY_LEVEL: NotifyLevel = 'all'

export function normalizeNotifyLevel(value: unknown): NotifyLevel {
  return value === 'action' || value === 'off' ? value : DEFAULT_NOTIFY_LEVEL
}

/* 0.1.7（用户需求）：通知形式——「总是系统弹窗」= 窗口在前台但侧栏不在视野时，改用 Windows 右下角
   Toast（点击弹窗经 vscode:// 路由回侧栏）；窗口失焦时两档一致（VS Code 原生通知本就转系统通知）。 */
export type NotifyStyle = 'vscode' | 'system'

export const DEFAULT_NOTIFY_STYLE: NotifyStyle = 'vscode'

export function normalizeNotifyStyle(value: unknown): NotifyStyle {
  return value === 'system' ? 'system' : DEFAULT_NOTIFY_STYLE
}

export interface NotifyVisibility {
  /* VS Code 窗口是否聚焦（切到别的应用 = false）。 */
  focused: boolean
  /* 侧栏视图是否可见（收起/切走 = false）。 */
  viewVisible: boolean
}

export type NotifyKind = 'action' | 'complete'

/* 判据②：正看着 → 不打扰；判据③：等级过滤（complete 仅 all 档）。 */
export function shouldNotify(kind: NotifyKind, level: NotifyLevel, visibility: NotifyVisibility): boolean {
  if (level === 'off') return false
  if (kind === 'complete' && level !== 'all') return false
  return !(visibility.focused && visibility.viewVisible)
}

/* 出口解析（只决定"怎么弹"，不决定"该不该弹"——那是 shouldNotify 的职责）：
   系统档仅覆盖"前台但没在看"这一缺口（focused && !viewVisible）→ 自绘 Toast；
   失焦交给 VS Code 转系统通知、正看着本就不弹——避免弹两份。 */
export function notifyChannel(style: NotifyStyle, visibility: NotifyVisibility): 'toast' | 'vscode' {
  return style === 'system' && visibility.focused && !visibility.viewVisible ? 'toast' : 'vscode'
}

/* 判据②的去重键：同一等待只提醒一次。审批按 approvalId（服务端稳定）；提问**按内容**
   （首个问题的 id+文本）而非 rpcId——重进会话时服务端可能重发同一提问但换新 rpcId，
   内容键保证不重复提醒。两者都为空 = 无等待 → undefined。 */
export function actionKeyOf(
  approval: { approvalId: string } | null,
  question: { questions: ReadonlyArray<{ id: string; question: string }> } | null,
): string | undefined {
  if (approval !== null) return `a:${approval.approvalId}`
  if (question !== null) {
    const first = question.questions[0]
    if (first === undefined) return undefined
    return `q:${first.id}:${first.question}`
  }
  return undefined
}

/* 判据④的完成边：只有"曾观测到运行中 → 现在停下"才算（启动快照/首见即停 = 不报）。 */
export function completionEdge(previous: boolean | undefined, now: boolean): boolean {
  return previous === true && now === false
}

/* 0.1.113（真机实测"实际未停止却弹'已停止运行'"）：runtime 在**等待用户回答提问/审批**期间会把
   running 降为 false（日志实证：提问后 ~2min running=false、用户作答后 running=true），而 agent
   并未停止 ⇒ 完成边必须排除"当前会话有待答提问/审批"的情形，否则每轮等待都误报一次。 */
export function completionCandidate(previous: boolean | undefined, now: boolean, waitingAction: boolean): boolean {
  if (waitingAction) return false
  return completionEdge(previous, now)
}

/* 0.1.16（用户实测"浏览别的软件时老是弹'已停止'，其实 agent 还在跑"）：多轮连跑（排队续跑 /
   自动续轮）在 turn 边界会让 running 短暂翻假，逐次触发完成通知即为误报。改为**持续停止确认**：
   翻假只登记时刻，只有"停止持续 ≥ confirmMs"且到点复核仍未运行才算完成；期间回到运行中即撤销。 */
export const COMPLETION_CONFIRM_MS = 4000

export class CompletionConfirmer {
  private readonly pending = new Map<string, number>()

  constructor(private readonly confirmMs: number = COMPLETION_CONFIRM_MS) {}

  /** 登记一次"刚刚翻假"（重复 observe 不重置计时）；返回是否为新登记。 */
  observe(sessionId: string, running: boolean, nowMs: number): 'started' | 'cleared' | undefined {
    if (running) return this.pending.delete(sessionId) ? 'cleared' : undefined
    if (this.pending.has(sessionId)) return undefined
    this.pending.set(sessionId, nowMs)
    return 'started'
  }

  /** 定时器到点复核：仍在停止且已持续 ≥ confirmMs → 确认完成（并注销，防重复通知）。 */
  confirm(sessionId: string, running: boolean, nowMs: number): boolean {
    const since = this.pending.get(sessionId)
    if (since === undefined || running) return false
    if (nowMs - since < this.confirmMs) return false
    this.pending.delete(sessionId)
    return true
  }

  cancel(sessionId: string): void {
    this.pending.delete(sessionId)
  }
}

export function approvalNotifyText(sessionTitle: string, toolName: string): string {
  return `DSH：「${sessionTitle}」需要你确认一个操作（${toolName}）`
}

export function questionNotifyText(sessionTitle: string, firstQuestion?: string): string {
  const text = typeof firstQuestion === 'string' ? firstQuestion.trim().replace(/\s+/g, ' ') : ''
  if (text === '') return `DSH：「${sessionTitle}」向你提出了问题，等待你的回答`
  return `DSH：「${sessionTitle}」向你提问：${text.slice(0, 60)}`
}

export function completeNotifyText(sessionTitle: string): string {
  return `DSH：「${sessionTitle}」已停止运行，可回来查看`
}
