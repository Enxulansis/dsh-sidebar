import { describe, expect, it } from 'vitest'
import { parseAskRecord } from '../src/ask-record.js'

/* 0.0.131（用户反馈⑤）：ask_user_question 问答记录解析——夹具为真实会话载荷（2026-09-16 实抓）。 */
const realArgs = JSON.stringify({
  questions: [
    { id: 'award_scope', header: '目标奖项', question: '这轮评奖评优，你要我把重点放在哪一档？', options: [{ label: '全覆盖' }, { label: '主攻国奖' }] },
    { id: 'deliverable', header: '交付物形态', question: '你要的「申报条件 + 需要的信息」，希望我产出成什么？' },
  ],
})
const realResult = JSON.stringify({
  answers: [
    { id: 'award_scope', selected: ['全覆盖：先搭总框架（推荐）'] },
    { id: 'deliverable', selected: ['知识库文档 + 个人信息采集表（推荐）'] },
  ],
})

describe('parseAskRecord', () => {
  it('pairs questions with answers by id (real payload shape)', () => {
    expect(parseAskRecord(realArgs, realResult)).toEqual({
      questions: [
        { id: 'award_scope', question: '这轮评奖评优，你要我把重点放在哪一档？', answers: ['全覆盖：先搭总框架（推荐）'] },
        { id: 'deliverable', question: '你要的「申报条件 + 需要的信息」，希望我产出成什么？', answers: ['知识库文档 + 个人信息采集表（推荐）'] },
      ],
      answered: 2,
      total: 2,
      pending: false,
    })
  })

  it('appends custom answers and keeps skipped items answerless', () => {
    const args = JSON.stringify({ questions: [{ id: 'q1', question: 'A?' }, { id: 'q2', question: 'B?' }] })
    const result = JSON.stringify({ answers: [{ id: 'q1', selected: ['选项一'], custom: '自己写的答案' }, { id: 'q2', selected: [] }] })
    const record = parseAskRecord(args, result)
    expect(record?.questions).toEqual([
      { id: 'q1', question: 'A?', answers: ['选项一', '自己写的答案'] },
      { id: 'q2', question: 'B?', answers: [] },
    ])
    expect(record?.answered).toBe(1)
  })

  it('returns a pending record when the result has not arrived', () => {
    const record = parseAskRecord(realArgs, undefined)
    expect(record?.pending).toBe(true)
    expect(record?.questions.every(question => question.answers.length === 0)).toBe(true)
    expect(record?.total).toBe(2)
  })

  it('rejects unpaired or malformed payloads', () => {
    expect(parseAskRecord(realArgs, JSON.stringify({ answers: [{ id: 'award_scope', selected: [] }] }))).toBeUndefined()
    expect(parseAskRecord(realArgs, 'not json')).toBeUndefined()
    expect(parseAskRecord('{bad', realResult)).toBeUndefined()
    expect(parseAskRecord(JSON.stringify({ questions: [] }), realResult)).toBeUndefined()
    expect(parseAskRecord(JSON.stringify({ questions: [{ id: 'x', question: 'a' }, { id: 'x', question: 'b' }] }), realResult)).toBeUndefined()
  })
})
