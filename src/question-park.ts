/* 2026-10-05（真机事故：连接风暴期提交落在"死窗口"——socket 恰在提交瞬间 1006 断开，应答包
   带着已失效的 clientId 到达网关，被丢弃并抛 "typert gateway: Remote event result identifies
   no active event stream"）。提交兜底：把失败的提交意图暂存，随"同一提问重放"自动重投——
   重放（服务端对未决事件的标准行为）后的 rpcId 必对应新的活流，正是活窗口。
   本模块 = 其中的纯逻辑（可单测）；状态机在 ChatController（extension.ts）。 */

/** 提问形状的最小结构约束（避免与 extension.ts 的类型定义相互 import）。 */
export interface ParkQuestionLike {
  id: string
  question: string
  header?: string
  detail?: string
  multiSelect?: boolean
  options?: readonly { label: string }[]
}

const SEP1 = String.fromCharCode(1)
const SEP2 = String.fromCharCode(2)

/** 提问内容键（id + 文案 + 选项标签，**刻意排除 rpcId**——重放会换代）。
    与 webview 侧尾部卡片的内容键同口径：同键 = 同一组提问的重复到达。 */
export function questionSetKey(questions: readonly ParkQuestionLike[]): string {
  return questions.map(question => [
    question.id, question.question, question.header ?? '', question.detail ?? '',
    question.multiSelect === true ? '1' : '0',
    (question.options ?? []).map(option => option.label).join(SEP1),
  ].join(SEP1)).join(SEP2)
}

/** 「跳过」的 id 集匹配：卡片侧只带 id（换代后 rpcId 会过期，不能作主键）。 */
export function matchesQuestionIds(questions: readonly ParkQuestionLike[], ids: readonly string[]): boolean {
  if (ids.length !== questions.length) return false
  const wanted = new Set(ids)
  return questions.every(question => wanted.has(question.id))
}

/** 暂存失败后的重投节流（毫秒）：每轮重放最多试一次，防风暴期快速重放引发重投风暴。 */
export const PARK_RETRY_THROTTLE_MS = 3_000
/** 暂存有效期：超过后不再重投（提问大概率已被服务端收尾），给用户明确的失败提示。 */
export const PARK_TTL_MS = 90_000

/** 打印用短 id（日志里的 clientId/rpcId 只留前 8 位）。 */
export function shortId(value: string): string {
  return value.length <= 8 ? value : value.slice(0, 8)
}

/** 暂存条目的决策视图（与控制器字段同形；纯函数便于单测，见 send-recovery 的 plan* 惯例）。 */
export interface ParkSnapshot {
  key: string
  atMs: number
  lastAttemptMs: number
  inFlight: boolean
}

export type ParkRetryPlan =
  | { kind: 'none' }      /* 无暂存 / 在途 / 与当前提问不匹配 */
  | { kind: 'wait' }      /* 节流窗口内，下轮重放再试 */
  | { kind: 'expire' }    /* 超时作废：明确告知用户重新提交 */
  | { kind: 'retry' }     /* 立即重投（用当前 rpcId） */

/** 每次"同一提问重放"到达时的重投决策。pendingKey=当前待答提问的内容键（无提问传 undefined）。 */
export function planParkRetry(park: ParkSnapshot | null, pendingKey: string | undefined, now: number): ParkRetryPlan {
  if (park === null || park.inFlight) return { kind: 'none' }
  if (pendingKey === undefined || pendingKey !== park.key) return { kind: 'none' }
  if (now - park.atMs > PARK_TTL_MS) return { kind: 'expire' }
  if (now - park.lastAttemptMs < PARK_RETRY_THROTTLE_MS) return { kind: 'wait' }
  return { kind: 'retry' }
}
