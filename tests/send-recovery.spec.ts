import { describe, expect, it } from 'vitest'
import { planSendFailure } from '../src/send-recovery.ts'

describe('send failure recovery plan (0.0.56 审核 P1)', () => {
  it('restores in place when still on the sending session', () => {
    expect(planSendFailure('s1', 's1')).toEqual({ kind: 'restore-current' })
  })

  it('stashes into the origin session when the user switched away mid-flight', () => {
    expect(planSendFailure('s2', 's1')).toEqual({ kind: 'stash-origin', sessionId: 's1' })
  })

  it('treats an empty current session as "restore in place" (runtime not ready ≠ navigation)', () => {
    /* 0.0.56 复测 ③ 反例：运行时未就绪把 sessionId 置空时若走 stash 分支，草稿会存进不存在的会话槽，
       用户眼前"文本+图片凭空消失"——空 id 必须视为原地还原。 */
    expect(planSendFailure('', 's1')).toEqual({ kind: 'restore-current' })
  })
})
