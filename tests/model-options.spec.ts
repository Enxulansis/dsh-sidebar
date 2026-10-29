import { describe, expect, it } from 'vitest'
import { dedupeModelOptions } from '../src/model-options.js'

/* Equal display names on different connections must remain selectable. */

const item = (provider: string, model: string, label: string, selected = false) => ({ provider, model, label, selected })

describe('dedupeModelOptions', () => {
  it('同名模型按连接保留', () => {
    const out = dedupeModelOptions([
      item('deepseek-official', 'deepseek-flash', 'DeepSeek-V4.1-Flash'),
      item('deepseek-official', 'deepseek-v4-pro', 'DeepSeek-V4-Pro'),
      item('deepseek-vision', 'deepseek-flash', 'DeepSeek-V4.1-Flash'),
      item('deepseek-vision', 'deepseek-v4-pro', 'DeepSeek-V4-Pro'),
      item('deepseek-modlens', 'deepseek-v4-pro', 'DeepSeek-V4-Pro (modlens vision)'),
      item('deepseek-modlens-vision', 'deepseek-v4-pro', 'DeepSeek-V4-Pro (modlens vision)'),
    ])
    expect(out.map(option => option.label)).toEqual([
      'DeepSeek-V4.1-Flash',
      'DeepSeek-V4-Pro',
      'DeepSeek-V4.1-Flash',
      'DeepSeek-V4-Pro',
      'DeepSeek-V4-Pro (modlens vision)',
      'DeepSeek-V4-Pro (modlens vision)',
    ])
  })

  it('当前选中的重复项必须保留（否则选中项从列表消失）', () => {
    const out = dedupeModelOptions([
      item('deepseek-official', 'deepseek-v4-pro', 'DeepSeek-V4-Pro'),
      item('deepseek-vision', 'deepseek-v4-pro', 'DeepSeek-V4-Pro', true),
      item('deepseek-modlens', 'deepseek-v4-pro', 'DeepSeek-V4-Pro'),
    ])
    const kept = out.filter(option => option.label === 'DeepSeek-V4-Pro')
    expect(kept.map(option => option.provider)).toEqual(['deepseek-official', 'deepseek-vision', 'deepseek-modlens'])
    expect(kept.some(option => option.selected)).toBe(true)
  })

  it('显示名不影响身份；精确 route/model 重复去重', () => {
    const out = dedupeModelOptions([
      item('a', 'x', '  DeepSeek-V4-Pro '),
      item('b', 'x', 'deepseek-v4-pro'),
      item('c', 'y', ''),
      item('c', 'y', ''),
    ])
    expect(out.map(option => option.provider)).toEqual(['a', 'b', 'c'])
  })
})
