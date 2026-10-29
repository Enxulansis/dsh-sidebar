import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendCappedJsonl } from '../src/jsonl-log.js'

/* 2026-10-06（W7）：诊断 JSONL 追加式——旧实现每条"读全文件+改+写全文件"（真机剖面 1.5s/27min）。
   语义：追加；超阈值压缩一次保留最后 cap 行；失败静默。 */
describe('appendCappedJsonl（W7）', () => {
  it('追加写入且逐行完整', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'jsonl-')), 'log.jsonl')
    appendCappedJsonl(file, '{"a":1}', 400)
    appendCappedJsonl(file, '{"a":2}', 400)
    expect(readFileSync(file, 'utf8').trim().split('\n')).toEqual(['{"a":1}', '{"a":2}'])
  })

  it('超过阈值 → 压缩保留最后 cap 行（滚动语义）', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'jsonl-')), 'log.jsonl')
    // 先垫满 >128KB（每行 1KB）
    const pad = 'x'.repeat(1000)
    const chunks: string[] = []
    for (let i = 0; i < 140; i += 1) chunks.push(JSON.stringify({ i, pad }))
    writeFileSync(file, chunks.join('\n') + '\n')
    appendCappedJsonl(file, '{"tail":true}', 100)
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines.length).toBe(100)
    expect(lines[lines.length - 1]).toBe('{"tail":true}')
  })

  it('写入/压缩失败静默（不抛出）', () => {
    // 目录不存在 → append 失败 → 静默返回
    expect(() => appendCappedJsonl(join(tmpdir(), 'no-such-dir-' + String(Date.now()), 'x.jsonl'), '{}', 10)).not.toThrow()
  })
})
