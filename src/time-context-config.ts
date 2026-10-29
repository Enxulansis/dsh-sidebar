/**
 * 0.0.88：把「时间上下文采样间隔（秒）」写进 dsh web profile 的 cordis.patch.yml——
 * 定位 time-context 插件行的 config 块，改写 refreshIntervalMs（秒 → 毫秒）。
 * 纯文本变换（不 import vscode）：只动目标行，其余字节保持原样；行/块缺失 → undefined（调用方跳过）。
 */

const ROW_MARKER = '- id: time-context'
const PLUGIN_MARKER = 'dsh-time-context'
const KEY = 'refreshIntervalMs'
const MAX_SECONDS = 86400

export interface TimeContextPatchResult {
  text: string
  changed: boolean
}

export function applyTimeContextRefresh(text: string, seconds: number): TimeContextPatchResult | undefined {
  const ms = Math.round(Math.min(MAX_SECONDS, Math.max(0, seconds))) * 1000
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)

  const rowIndex = lines.findIndex((line) => line.trim() === ROW_MARKER)
  if (rowIndex < 0) return undefined
  // 确认这确实是 time-context 插件行：其后紧邻几行内应出现插件名
  let nameIndex = -1
  for (let i = rowIndex + 1; i <= rowIndex + 4 && i < lines.length; i += 1) {
    const line = lines[i]
    if (line !== undefined && line.includes('name:') && line.includes(PLUGIN_MARKER)) { nameIndex = i; break }
  }
  if (nameIndex < 0) return undefined
  let configIndex = -1
  for (let i = nameIndex + 1; i <= nameIndex + 4 && i < lines.length; i += 1) {
    const line = lines[i]
    if (line !== undefined && line.trim() === 'config:') { configIndex = i; break }
  }
  if (configIndex < 0) return undefined
  const configLine = lines[configIndex]
  if (configLine === undefined) return undefined
  const configIndent = configLine.length - configLine.trimStart().length
  let blockEnd = configIndex + 1
  while (blockEnd < lines.length) {
    const line = lines[blockEnd]
    if (line !== undefined && line.trim() !== '' && line.length - line.trimStart().length <= configIndent) break
    blockEnd += 1
  }
  let keyIndex = -1
  for (let i = configIndex + 1; i < blockEnd; i += 1) {
    const line = lines[i]
    if (line !== undefined && line.trimStart().startsWith(KEY + ':')) { keyIndex = i; break }
  }

  const newLine = ' '.repeat(configIndent + 2) + KEY + ': ' + String(ms)
  if (keyIndex >= 0) {
    if (lines[keyIndex] === newLine) return { text, changed: false }
    lines[keyIndex] = newLine
  } else {
    lines.splice(configIndex + 1, 0, newLine)
  }
  return { text: lines.join(eol), changed: true }
}
