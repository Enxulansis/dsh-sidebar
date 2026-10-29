import { describe, expect, it } from 'vitest'
import { applyTimeContextRefresh } from '../src/time-context-config.js'

/* 0.0.88：时间上下文采样间隔写盘变换（秒 → refreshIntervalMs 毫秒；只动目标行）。 */

const SAMPLE = [
  '# Your patch layer for this dsh profile',
  '- id: attachment-local',
  '  config:',
  '    maxImageBytes: 20971520',
  '',
  '# 2026-09-12: 挂载内建 time-context',
  '- insert:',
  '    - id: time-context',
  "      name: '@deepseek-ai/dsh-time-context'",
  '      config:',
  '        timeZone: Asia/Shanghai',
  '        refreshIntervalMs: 60000',
  '',
  '# 2026-09-12: MCP',
  '- insert:',
  '    - id: mcp-academic-search',
  "      name: '@deepseek-ai/dsh-mcp-client'",
].join('\n')

const withValue = (text: string, line: string) => text.replace(/.*refreshIntervalMs.*/, line)

describe('applyTimeContextRefresh', () => {
  it('替换数值：秒 → 毫秒，且只动目标行', () => {
    const result = applyTimeContextRefresh(SAMPLE, 120)
    expect(result).toBeDefined()
    expect(result!.changed).toBe(true)
    expect(result!.text).toContain('        refreshIntervalMs: 120000')
    expect(result!.text).toBe(withValue(SAMPLE, '        refreshIntervalMs: 120000'))
  })

  it('值相同 → changed=false 且文本不变', () => {
    const result = applyTimeContextRefresh(SAMPLE, 60)
    expect(result).toEqual({ text: SAMPLE, changed: false })
  })

  it('0 = 每步采样', () => {
    const result = applyTimeContextRefresh(SAMPLE, 0)
    expect(result!.text).toContain('        refreshIntervalMs: 0')
  })

  it('键缺失 → 插到 config: 之后（缩进 +2）', () => {
    const noKey = SAMPLE.replace('        timeZone: Asia/Shanghai\n        refreshIntervalMs: 60000', '        timeZone: Asia/Shanghai')
    const result = applyTimeContextRefresh(noKey, 300)
    expect(result!.changed).toBe(true)
    expect(result!.text).toContain('      config:\n        refreshIntervalMs: 300000\n        timeZone: Asia/Shanghai')
  })

  it('无 time-context 行 → undefined（调用方跳过）', () => {
    const stripped = SAMPLE.replace(/- id: time-context/, '- id: other-plugin').replace('dsh-time-context', 'other-plugin-name')
    expect(applyTimeContextRefresh(stripped, 60)).toBeUndefined()
  })

  it('越界钳制：>86400 → 86400；负数 → 0', () => {
    expect(applyTimeContextRefresh(SAMPLE, 200000)!.text).toContain('refreshIntervalMs: 86400000')
    expect(applyTimeContextRefresh(SAMPLE, -5)!.text).toContain('refreshIntervalMs: 0')
  })

  it('CRLF 文本保持 CRLF', () => {
    const crlf = SAMPLE.split('\n').join('\r\n')
    const result = applyTimeContextRefresh(crlf, 90)!
    expect(result.text).toContain('        refreshIntervalMs: 90000\r\n')
    expect(result.text.replace(/\r\n/g, '')).not.toContain('\n')
  })
})
