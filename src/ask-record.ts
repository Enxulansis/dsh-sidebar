/**
 * 0.0.131：ask_user_question 的问答记录解析（单函数自包含——webview 脚本以源码注入
 * `${parseAskRecord.toString()}`，故内部不得引用模块级其它符号；类型在编译期擦除）。
 * 单测见 tests/ask-record.spec.ts。对齐官方 dsh-client-ui-tool 的 AskQuestionCard 规则：
 * - 问题取自调用参数 JSON { questions: [{ id, question }] }（header/options 不参与配对）；
 * - 答案取自结果文本 JSON { answers: [{ id, selected: string[], custom?: string }] }；
 * - 按 id 配对；数量/唯一性不符则判定不可配对（调用方回落原生工具卡）；
 * - 结果缺席（仍在等待回答）→ answers 全空、pending=true。
 */

export interface AskRecordQuestion {
  id: string
  question: string
  answers: string[]
}

export interface AskRecord {
  questions: AskRecordQuestion[]
  answered: number
  total: number
  /** 结果尚未到达（等待回答）——渲染层区分"等待回答"与"已跳过"。 */
  pending: boolean
}

export function parseAskRecord(rawInput: unknown, rawResult: unknown): AskRecord | undefined {
  const record = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  const parseJson = (text: unknown): unknown => {
    if (typeof text !== 'string' || text.trim() === '') return undefined
    try { return JSON.parse(text) } catch { return undefined }
  }
  const questionEntries = (): Array<{ id: string; question: string }> | undefined => {
    const parsed = record(parseJson(rawInput))
    const questions = parsed?.questions
    if (!Array.isArray(questions) || questions.length === 0) return undefined
    const seen = new Set<string>()
    const entries: Array<{ id: string; question: string }> = []
    for (const item of questions) {
      const question = record(item)
      if (question === undefined || typeof question.id !== 'string' || typeof question.question !== 'string') return undefined
      if (seen.has(question.id)) return undefined
      seen.add(question.id)
      entries.push({ id: question.id, question: question.question })
    }
    return entries
  }
  const answerEntries = (): Array<{ id: string; selected: string[]; custom?: string }> | undefined => {
    const parsed = record(parseJson(rawResult))
    const answers = parsed?.answers
    if (!Array.isArray(answers)) return undefined
    const entries: Array<{ id: string; selected: string[]; custom?: string }> = []
    for (const item of answers) {
      const answer = record(item)
      if (answer === undefined || typeof answer.id !== 'string') return undefined
      if (!Array.isArray(answer.selected) || !answer.selected.every(label => typeof label === 'string')) return undefined
      if (answer.custom !== undefined && typeof answer.custom !== 'string') return undefined
      entries.push({
        id: answer.id,
        selected: answer.selected as string[],
        ...(answer.custom === undefined ? {} : { custom: answer.custom }),
      })
    }
    return entries
  }
  const questions = questionEntries()
  if (questions === undefined) return undefined
  if (typeof rawResult !== 'string' || rawResult.trim() === '') {
    return { questions: questions.map(item => ({ ...item, answers: [] })), answered: 0, total: questions.length, pending: true }
  }
  const answers = answerEntries()
  if (answers === undefined || answers.length !== questions.length) return undefined
  const byId = new Map<string, { selected: string[]; custom?: string }>()
  for (const answer of answers) {
    if (byId.has(answer.id)) return undefined
    byId.set(answer.id, answer)
  }
  const paired: AskRecordQuestion[] = []
  for (const question of questions) {
    const answer = byId.get(question.id)
    if (answer === undefined) return undefined
    paired.push({
      id: question.id,
      question: question.question,
      answers: [...answer.selected, ...(answer.custom === undefined || answer.custom === '' ? [] : [answer.custom])],
    })
  }
  return { questions: paired, answered: paired.filter(item => item.answers.length > 0).length, total: paired.length, pending: false }
}
