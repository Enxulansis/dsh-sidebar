import { describe, expect, it } from 'vitest'
import { displayNameOf, linkOpensAsText, linkSearchPattern, rankLinkCandidate } from '../src/file-path.ts'

describe('displayNameOf (0.0.55 反馈⑧)', () => {
  it('strips the .dsh-paste storage timestamp prefix (>=10 digits + dash)', () => {
    expect(displayNameOf('1757455200000-需求说明.docx')).toBe('需求说明.docx')
    expect(displayNameOf('_temp/.dsh-paste/1757455200000-report.pdf')).toBe('report.pdf')
    expect(displayNameOf('C:\\proj\\_temp\\.dsh-paste\\1757455200000-捕获.PNG')).toBe('捕获.PNG')
  })

  it('keeps ordinary names and short digit prefixes intact', () => {
    expect(displayNameOf('report.pdf')).toBe('report.pdf')
    expect(displayNameOf('12345-report.pdf')).toBe('12345-report.pdf') // <10 位不误伤
    expect(displayNameOf('capture-1757455200000.png')).toBe('capture-1757455200000.png') // 非前导
  })

  it('handles empty and path-only input', () => {
    expect(displayNameOf('')).toBe('')
    expect(displayNameOf('D:\\proj\\notes.md')).toBe('notes.md')
  })
})

/* 0.1.22（用户实测①：agent 链接 figures/own/x.png 点开报 ENOENT，文件其实在 _temp/drafts/... 下）：
   落空时的"按路径后缀回退搜索"——纯函数部分（glob 构造 + 候选排序）在此锁死。 */
describe('linkSearchPattern / rankLinkCandidate (0.1.22 链接回退)', () => {
  it('相对路径 → 双星号后缀 glob；正反斜杠都归一', () => {
    expect(linkSearchPattern('figures/own/x.png')).toBe('**/figures/own/x.png')
    expect(linkSearchPattern('.\\figures\\own\\x.png')).toBe('**/figures/own/x.png')
    expect(linkSearchPattern('./a/b.png')).toBe('**/a/b.png')
  })

  it('绝对路径 / 上跳越界 / 空值 一律不搜（落空即真没有）', () => {
    expect(linkSearchPattern('D:\\proj\\a.png')).toBeUndefined()
    expect(linkSearchPattern('/usr/x.png')).toBeUndefined()
    expect(linkSearchPattern('../outside.png')).toBeUndefined()
    expect(linkSearchPattern('a/../../x.png')).toBeUndefined()
    expect(linkSearchPattern('   ')).toBeUndefined()
  })

  it('排序：_temp 下的优先，其次路径越浅越优先', () => {
    const cwd = 'D:\\proj'
    const deepNoTemp = rankLinkCandidate(cwd, 'D:\\proj\\figures\\own\\a\\b\\x.png')
    const shallowNoTemp = rankLinkCandidate(cwd, 'D:\\proj\\figures\\x.png')
    const tempDeep = rankLinkCandidate(cwd, 'D:\\proj\\_temp\\drafts\\919\\figures\\own\\x.png')
    expect(tempDeep).toBeLessThan(deepNoTemp)
    expect(shallowNoTemp).toBeLessThan(deepNoTemp)
  })
})

/* 0.1.23（用户实测：图片链接被当文本打开 → "文件似乎是二进制文件，不能作为文本打开"）：
   分流判定的纯函数部分——图片在此之前已由 imageMediaType 接走，这里只管"其余谁来打开"。 */
describe('linkOpensAsText (0.1.23 链接打开方式)', () => {
  const TEXT = new Set(['md', 'txt', 'json', 'py'])

  it('文本扩展名 → 进编辑器；无扩展名按文本（LICENSE / Makefile 这类）', () => {
    expect(linkOpensAsText('md', TEXT)).toBe(true)
    expect(linkOpensAsText('py', TEXT)).toBe(true)
    expect(linkOpensAsText('', TEXT)).toBe(true)
  })

  it('非文本扩展名 → 交 VS Code（pdf/二进制/未知格式不再硬塞 openTextDocument）', () => {
    expect(linkOpensAsText('pdf', TEXT)).toBe(false)
    expect(linkOpensAsText('exe', TEXT)).toBe(false)
    expect(linkOpensAsText('bin', TEXT)).toBe(false)
    expect(linkOpensAsText('zip', TEXT)).toBe(false)
  })
})
