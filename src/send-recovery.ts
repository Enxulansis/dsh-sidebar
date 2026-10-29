/**
 * 0.0.56（代码审核 P1）：发送失败后的恢复分流决策。
 *
 * 背景：发送采用"乐观清空"（点击即清空草稿栏并 publish），失败时成套还原。但发送是异步的——
 * 用户可能在 RPC 在途时**切换会话**。此时若无条件还原，会把会话 A 的文本/图片/附带文件灌进
 * 会话 B 的输入框（并抹掉 B 自己的 pinned）——审核确认为跨会话串台缺陷。
 *
 * 规则：还原目标 = **发送时的会话**。
 * - 仍停留在发送会话 → 就地还原（文本 + 图片 + pinned，路径与旧行为一致）；
 * - 已切走 → 不碰当前会话，把草稿存回原会话的槽位（pinned → pinnedSlots，文本/图片 → webview
 *   的 draftSlots），用户切回原会话时自动恢复。
 * 纯函数便于单测；真正执行还原由调用方完成。
 */
export type SendFailurePlan =
  | { kind: 'restore-current' }
  | { kind: 'stash-origin'; sessionId: string }

export function planSendFailure(currentSessionId: string, sentSessionId: string): SendFailurePlan {
  /* 空 id（运行时未就绪/重连中把 sessionId 置空）**不算"切走"**——否则草稿会被存进一个不存在的
     会话槽，用户眼前什么也看不到（0.0.56 首版复测实测：同会话失败后文本/图片"消失"）。 */
  if (currentSessionId === '' || currentSessionId === sentSessionId) return { kind: 'restore-current' }
  return { kind: 'stash-origin', sessionId: sentSessionId }
}
