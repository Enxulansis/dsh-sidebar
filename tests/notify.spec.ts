import { describe, expect, it } from 'vitest'
import {
  actionKeyOf,
  approvalNotifyText,
  completeNotifyText,
  CompletionConfirmer,
  completionCandidate,
  completionEdge,
  normalizeNotifyLevel,
  normalizeNotifyStyle,
  notifyChannel,
  questionNotifyText,
  shouldNotify,
} from '../src/notify.js'

/* 0.0.160（N1）：任务通知的判据（2026-09-18 用户确认口径）——
   ① 需要操作（审批/提问）不在看 → 必达；② 正看着不打扰 + 同一等待只提醒一次；
   ③ 等级可配；④ 完成只认"曾观测运行中 → 停下"的边（启动快照/首见即停不报）。 */
describe('Task notifications (0.0.160 N1)', () => {
  it('shouldNotify: 可见性 × 等级 × 类型', () => {
    const looking = { focused: true, viewVisible: true }
    const away = { focused: false, viewVisible: true }
    const hidden = { focused: true, viewVisible: false }
    /* 判据②：正看着一律不弹（两种都算"在看"：窗口失焦但侧栏可见 → 弹）。 */
    expect(shouldNotify('action', 'all', looking)).toBe(false)
    expect(shouldNotify('complete', 'all', looking)).toBe(false)
    expect(shouldNotify('action', 'all', away)).toBe(true)
    expect(shouldNotify('action', 'all', hidden)).toBe(true)
    /* 判据③：等级过滤（complete 仅 all 档；off 全关）。 */
    expect(shouldNotify('complete', 'action', away)).toBe(false)
    expect(shouldNotify('action', 'action', away)).toBe(true)
    expect(shouldNotify('action', 'off', away)).toBe(false)
    expect(shouldNotify('complete', 'off', away)).toBe(false)
  })

  it('normalizeNotifyLevel: 非法值回落 all', () => {
    expect(normalizeNotifyLevel('all')).toBe('all')
    expect(normalizeNotifyLevel('action')).toBe('action')
    expect(normalizeNotifyLevel('off')).toBe('off')
    expect(normalizeNotifyLevel('weird')).toBe('all')
    expect(normalizeNotifyLevel(undefined)).toBe('all')
    expect(normalizeNotifyLevel(3)).toBe('all')
  })

  /* 0.1.7（用户需求）：通知形式——系统档只改"前台但没在看"一档；失焦仍交 VS Code（不弹两份）。 */
  it('notifyChannel / normalizeNotifyStyle (0.1.7)', () => {
    const looking = { focused: true, viewVisible: true }
    const away = { focused: false, viewVisible: true }
    const hidden = { focused: true, viewVisible: false }
    const awayHidden = { focused: false, viewVisible: false }
    expect(notifyChannel('vscode', hidden)).toBe('vscode')
    expect(notifyChannel('system', hidden)).toBe('toast')
    expect(notifyChannel('system', away)).toBe('vscode')
    expect(notifyChannel('system', awayHidden)).toBe('vscode')
    expect(notifyChannel('system', looking)).toBe('vscode')
    expect(normalizeNotifyStyle('system')).toBe('system')
    expect(normalizeNotifyStyle('vscode')).toBe('vscode')
    expect(normalizeNotifyStyle('toast')).toBe('vscode')
    expect(normalizeNotifyStyle(undefined)).toBe('vscode')
  })

  it('actionKeyOf: 审批按 approvalId / 提问按内容（rpcId 变化不重复提醒）', () => {
    expect(actionKeyOf(null, null)).toBeUndefined()
    expect(actionKeyOf({ approvalId: 'ap1' }, null)).toBe('a:ap1')
    const q1 = { questions: [{ id: 'q1', question: '继续吗？' }] }
    const q2 = { questions: [{ id: 'q1', question: '继续吗？' }] } /* 同内容、不同对象（重发场景） */
    expect(actionKeyOf(null, q1)).toBe(actionKeyOf(null, q2))
    expect(actionKeyOf(null, { questions: [{ id: 'q2', question: '换个问法？' }] })).not.toBe(actionKeyOf(null, q1))
    expect(actionKeyOf(null, { questions: [] })).toBeUndefined()
    /* 审批优先于提问（状态里同时存在时）。 */
    expect(actionKeyOf({ approvalId: 'ap1' }, q1)).toBe('a:ap1')
  })

  it('0.1.16: 完成通知需"持续停止"确认——turn 边界短暂翻假不误报', () => {
    const confirmer = new CompletionConfirmer(4000)
    /* 翻假登记 → 到点前复核不通过、到点后通过；确认过即注销（防重复通知）。 */
    expect(confirmer.observe('s1', false, 0)).toBe('started')
    expect(confirmer.observe('s1', false, 1000)).toBeUndefined()
    expect(confirmer.confirm('s1', false, 3999)).toBe(false)
    expect(confirmer.confirm('s1', false, 4000)).toBe(true)
    expect(confirmer.confirm('s1', false, 4001)).toBe(false)
    /* 翻假后 1s 又跑起来（排队续跑）→ 撤销，永不通知。 */
    expect(confirmer.observe('s2', false, 0)).toBe('started')
    expect(confirmer.observe('s2', true, 1000)).toBe('cleared')
    expect(confirmer.confirm('s2', false, 9999)).toBe(false)
    /* 到点复核时已恢复运行 → 不通知。 */
    expect(confirmer.observe('s3', false, 0)).toBe('started')
    expect(confirmer.confirm('s3', true, 5000)).toBe(false)
    /* 从未登记过的会话不通知（判据④：首见即停不报，登记也只在完成边发生）。 */
    expect(confirmer.confirm('s4', false, 99999)).toBe(false)
  })

  it('completionCandidate: 等待提问/审批期间不报完成（0.1.113 真机"实际未停止却弹已停止"）', () => {
    /* runtime 在"等用户回答"时会把 running 降为 false —— 这不是真停止 */
    expect(completionCandidate(true, false, true)).toBe(false)
    expect(completionCandidate(true, false, false)).toBe(true)
    expect(completionCandidate(undefined, false, false)).toBe(false)
    expect(completionCandidate(true, true, true)).toBe(false)
  })

  it('completionEdge: 只有"曾观测运行中 → 停下"才算（判据④）', () => {
    expect(completionEdge(undefined, false)).toBe(false) /* 启动快照：首见即停，不报 */
    expect(completionEdge(undefined, true)).toBe(false)
    expect(completionEdge(true, false)).toBe(true)
    expect(completionEdge(true, true)).toBe(false)
    expect(completionEdge(false, false)).toBe(false)
  })

  it('文案：含会话名与摘要（审批=工具名 / 提问=首问截断）', () => {
    expect(approvalNotifyText('奖学金申请', 'bash')).toContain('奖学金申请')
    expect(approvalNotifyText('奖学金申请', 'bash')).toContain('bash')
    expect(questionNotifyText('奖学金申请', '要继续吗？')).toContain('要继续吗？')
    expect(questionNotifyText('奖学金申请')).toContain('奖学金申请')
    const long = questionNotifyText('t', 'x'.repeat(200))
    expect(long.length).toBeLessThan(120) /* 截断生效 */
    expect(completeNotifyText('奖学金申请')).toContain('奖学金申请')
  })
})
