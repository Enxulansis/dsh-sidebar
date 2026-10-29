import { describe, expect, it } from 'vitest'
import { questionSetKey, matchesQuestionIds, planParkRetry, PARK_RETRY_THROTTLE_MS, PARK_TTL_MS, type ParkQuestionLike } from '../src/question-park.ts'
import { isRetryableAnswerError } from '../src/dsh-client.ts'

/* 2026-10-05 真机事故（连接风暴期提交落进"死窗口"，应答被网关丢弃并抛
   "typert gateway: Remote event result identifies no active event stream"）的兜底逻辑锁死。 */

const question = (over: Partial<ParkQuestionLike> = {}): ParkQuestionLike => ({
  id: 'scope',
  question: '按哪个范围做？',
  header: '确认范围',
  options: [{ label: '全做' }, { label: '只修音量' }],
  multiSelect: false,
  ...over,
})

describe('questionSetKey（提问内容键）', () => {
  it('同内容同键（rpcId 换代不影响——键不含 rpcId）', () => {
    expect(questionSetKey([question()])).toBe(questionSetKey([question()]))
  })

  it('文案或 id 或选项变化 → 换键', () => {
    const base = questionSetKey([question()])
    expect(questionSetKey([question({ question: '换个问法？' })])).not.toBe(base)
    expect(questionSetKey([question({ id: 'scope2' })])).not.toBe(base)
    expect(questionSetKey([question({ options: [{ label: '全做' }] })])).not.toBe(base)
    expect(questionSetKey([question({ multiSelect: true })])).not.toBe(base)
  })

  it('多问题与顺序敏感', () => {
    const a = question({ id: 'a' })
    const b = question({ id: 'b' })
    expect(questionSetKey([a, b])).not.toBe(questionSetKey([b, a]))
  })
})

describe('matchesQuestionIds（「跳过」按 id 集结算）', () => {
  it('id 集相等（长度一致 + 全命中）才匹配', () => {
    expect(matchesQuestionIds([question({ id: 'a' }), question({ id: 'b' })], ['b', 'a'])).toBe(true)
    expect(matchesQuestionIds([question({ id: 'a' }), question({ id: 'b' })], ['a'])).toBe(false)
    expect(matchesQuestionIds([question({ id: 'a' })], ['a', 'b'])).toBe(false)
    expect(matchesQuestionIds([question({ id: 'a' })], ['b'])).toBe(false)
    expect(matchesQuestionIds([question({ id: 'a' })], [])).toBe(false)
  })
})

describe('planParkRetry（随重放重投的决策）', () => {
  const park = { key: 'k', atMs: 1_000, lastAttemptMs: 0, inFlight: false }
  const now = 1_000 + PARK_RETRY_THROTTLE_MS + 1

  it('无暂存 / 在途 → none', () => {
    expect(planParkRetry(null, 'k', now)).toEqual({ kind: 'none' })
    expect(planParkRetry({ ...park, inFlight: true }, 'k', now)).toEqual({ kind: 'none' })
  })

  it('与当前提问不匹配（换了提问 / 已无提问）→ none', () => {
    expect(planParkRetry(park, 'other', now)).toEqual({ kind: 'none' })
    expect(planParkRetry(park, undefined, now)).toEqual({ kind: 'none' })
  })

  it('超 TTL → expire（先于节流判定）', () => {
    expect(planParkRetry(park, 'k', 1_000 + PARK_TTL_MS + 1)).toEqual({ kind: 'expire' })
  })

  it('节流窗口内 → wait；窗口外 → retry', () => {
    const throttled = { ...park, lastAttemptMs: now - PARK_RETRY_THROTTLE_MS + 10 }
    expect(planParkRetry(throttled, 'k', now)).toEqual({ kind: 'wait' })
    expect(planParkRetry({ ...park, lastAttemptMs: now - PARK_RETRY_THROTTLE_MS }, 'k', now)).toEqual({ kind: 'retry' })
  })
})

describe('isRetryableAnswerError（连接类失败才兜底）', () => {
  it('网关"无活流"原话 → 可重试（真机事故原错）', () => {
    expect(isRetryableAnswerError(new Error('typert gateway: Remote event result identifies no active event stream'))).toBe(true)
  })

  it('传输/5xx/超时/写失败 → 可重试', () => {
    expect(isRetryableAnswerError(new Error('fetch failed'))).toBe(true)
    expect(isRetryableAnswerError(new Error('DSH transport failed: HTTP 502'))).toBe(true)
    expect(isRetryableAnswerError(new Error('The operation was aborted due to timeout'))).toBe(true)
    expect(isRetryableAnswerError(new Error('api gateway: Remote stream socket is closed'))).toBe(true)
  })

  it('业务类失败（4xx / 校验 / 非 Error）→ 不重试', () => {
    expect(isRetryableAnswerError(new Error('DSH transport failed: HTTP 401'))).toBe(false)
    expect(isRetryableAnswerError(new Error('该提问已不再等待回答。'))).toBe(false)
    expect(isRetryableAnswerError(new Error('Invalid DSH response for $events\\result.'))).toBe(false)
    expect(isRetryableAnswerError('boom')).toBe(false)
  })
})
