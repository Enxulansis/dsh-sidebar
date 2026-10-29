import { describe, expect, it } from 'vitest'
import { isBrokenSessionTitle, resolveSessionTitle } from '../src/session-titles.js'

/* 0.0.88：会话标题三级取值——本地持久化（重命名权威）→ 投影 → 回退。 */

describe('resolveSessionTitle', () => {
  it('持久化优先于投影（重命名后不被 dsh 旧标题覆盖）', () => {
    expect(resolveSessionTitle('旧标题', '我改的名字')).toBe('我改的名字')
  })

  it('无持久化时用投影（新会话标题即时显示）', () => {
    expect(resolveSessionTitle('论文润色', undefined)).toBe('论文润色')
    expect(resolveSessionTitle('论文润色', '')).toBe('论文润色')
  })

  it('都缺失 → 回退文案（冷会话重启场景改由持久化覆盖，此处保底）', () => {
    expect(resolveSessionTitle(undefined, undefined)).toBe('新建会话')
    expect(resolveSessionTitle('', '   ')).toBe('新建会话')
    expect(resolveSessionTitle(42, undefined)).toBe('新建会话')
  })

  /* 0.1.0 修复（用户实测"会话名称出问题"）：首条消息带 IDE 上下文信封时，运行时的回退标题
     是首条消息的截断（`<dsh-vscode-ide-context> Treat this JSON…`）——这类标题不得展示，
     否则本地学习会把它冻住、运行时随后的好标题再也进不来。 */
  it('信封式坏标题被忽略：本地坏标题不显示，落到投影', () => {
    expect(isBrokenSessionTitle('<dsh-vscode-ide-context> Treat this JSON')).toBe(true)
    expect(isBrokenSessionTitle('<dsh-vscode-ide-context>')).toBe(true)
    expect(isBrokenSessionTitle('  <dsh-vscode-ide-context>x')).toBe(true)
    expect(isBrokenSessionTitle('查询当前时间')).toBe(false)
    expect(isBrokenSessionTitle('<b>加粗标题</b>')).toBe(false)
    expect(isBrokenSessionTitle(undefined)).toBe(false)

    expect(resolveSessionTitle('查询当前时间', '<dsh-vscode-ide-context> Treat this JSON')).toBe('查询当前时间')
    expect(resolveSessionTitle(undefined, '<dsh-vscode-ide-context> Treat this JSON')).toBe('新建会话')
    expect(resolveSessionTitle('<dsh-vscode-ide-context> x', '我改的名字')).toBe('我改的名字')
  })
})
