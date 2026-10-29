import * as fs from 'node:fs'

/* 2026-10-06（W7，性能）：诊断 JSONL 追加式落盘——旧实现每条日志"读全文件 + 改 + 写全文件"
   （真机剖面 writeFileUtf8 诊断期烧 1.5s/27min）。改为 appendFileSync；文件超过阈值时压缩一次，
   保留最后 cap 行（滚动语义不变，阈内允许短暂超过 cap）。失败静默（诊断不阻断主链路）。 */
const COMPACT_THRESHOLD_BYTES = 128 * 1024

export function appendCappedJsonl(file: string, line: string, cap: number): void {
  try {
    fs.appendFileSync(file, line + '\n')
    if (fs.statSync(file).size <= COMPACT_THRESHOLD_BYTES) return
    let lines = fs.readFileSync(file, 'utf8').split('\n').filter(item => item.trim() !== '')
    if (lines.length > cap) lines = lines.slice(-cap)
    fs.writeFileSync(file, lines.join('\n') + '\n')
  } catch { /* 诊断写盘失败静默 */ }
}
