// G5 (0.0.39) 消息元信息格式函数（官方 message-chrome.ts 的中文移植，浏览器语法=注入 webview + node 单测单一来源）
// 用法: webview 端由 webview.ts `${vendoredChrome()}` 注入为全局函数；vitest import 本文件直接断言。
function pad2(n) {
  return String(n).padStart(2, '0')
}

// 同日 → 'HH:mm'；同年 → '8月29日 19:51'；跨年 → '2025年8月29日 19:51'
function formatMessageClock(time, now) {
  const d = new Date(time)
  const n = now === undefined ? new Date() : new Date(now)
  const clock = pad2(d.getHours()) + ':' + pad2(d.getMinutes())
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) return clock
  const md = d.getFullYear() === n.getFullYear()
    ? (d.getMonth() + 1) + '月' + d.getDate() + '日'
    : d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日'
  return md + ' ' + clock
}

// 用时：<60s → '45秒'；否则 '4分15秒'（分 + 补零秒）
function formatRunDuration(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes > 0 ? minutes + '分' + pad2(seconds) + '秒' : seconds + '秒'
}

// 首 token 延时：10 秒内 1 位小数，否则整秒
function formatLatencySeconds(ms) {
  const s = Math.max(0, (ms || 0)) / 1000
  return s < 10 ? String(Math.round(s * 10) / 10) : String(Math.round(s))
}

// tok/s：≥10 取整，<10 保留 1 位小数
function formatTokensPerSecond(tps) {
  const clamped = Math.max(0, tps || 0)
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
}

/* ---- G34（0.0.82）多格式动图字节嗅探：判断一幅图是否多帧 ----
   GIF（图像描述符 ≥ 2）/ PNG（acTL 且 num_frames > 1）/ 动图 WebP（VP8X 的 ANIMATION 位或 ANIM 块）。
   纯函数、只依赖 Uint8Array；返回 'gif' | 'png' | 'webp' | undefined（undefined = 静态或无法识别）。 */
function readU32BE(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}

function readU32LE(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

/* 跳到 GIF 子块链末尾（子块 = 长度字节 + 数据，0 长度结束） */
function gifSkipSubBlocks(bytes, offset) {
  while (offset < bytes.length) {
    const size = bytes[offset]
    offset += 1
    if (size === 0) return offset
    offset += size
  }
  return offset
}

/* GIF：按块结构扫描（图像描述符 0x2C 计数，命中第 2 个即提前返回） */
function gifFrameCount(bytes) {
  if (bytes.length < 13) return 0
  let offset = 6 + 7 /* 头 + 逻辑屏幕描述符 */
  const packed = bytes[10]
  if ((packed & 0x80) !== 0) offset += 3 * (1 << ((packed & 0x07) + 1)) /* 全局色表 */
  let count = 0
  while (offset < bytes.length) {
    const marker = bytes[offset]
    if (marker === 0x3b) break /* trailer */
    if (marker === 0x2c) {
      count += 1
      if (count > 1) return count
      if (offset + 10 > bytes.length) return count
      const localPacked = bytes[offset + 9]
      offset += 10 /* 描述符 */
      if ((localPacked & 0x80) !== 0) offset += 3 * (1 << ((localPacked & 0x07) + 1)) /* 局部色表 */
      offset += 1 /* LZW 最小码长 */
      offset = gifSkipSubBlocks(bytes, offset)
    } else if (marker === 0x21) {
      offset = gifSkipSubBlocks(bytes, offset + 2) /* 扩展块：label + 子块链 */
    } else {
      return count /* 结构异常，按已数到的算 */
    }
  }
  return count
}

/* PNG：acTL 必须出现在 IDAT 之前；num_frames > 1 即多帧 */
function pngIsAnimated(bytes) {
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = readU32BE(bytes, offset)
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
    if (type === 'acTL') return length >= 4 && readU32BE(bytes, offset + 8) > 1
    if (type === 'IDAT' || type === 'IEND') return false
    offset += 12 + length
  }
  return false
}

/* WebP：VP8X 的 ANIMATION 位（0x02）或显式 ANIM 块；出现 VP8/VP8L（帧数据）即静态 */
function webpIsAnimated(bytes) {
  let offset = 12
  let flagged = false
  while (offset + 8 <= bytes.length) {
    const fourcc = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
    const size = readU32LE(bytes, offset + 4)
    if (fourcc === 'ANIM') return true
    if (fourcc === 'VP8X') flagged = (bytes[offset + 8] & 0x02) !== 0
    else if (fourcc === 'VP8 ' || fourcc === 'VP8L') return false
    offset += 8 + size + (size % 2)
  }
  return flagged
}

function animatedKindOfBytes(bytes) {
  if (!bytes || bytes.length < 16) return undefined
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return gifFrameCount(bytes) > 1 ? 'gif' : undefined
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return pngIsAnimated(bytes) ? 'png' : undefined
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return webpIsAnimated(bytes) ? 'webp' : undefined
  }
  return undefined
}

/* 单测桥：webview 注入端无 module（纯 script 环境），node/vitest 端导出供断言。 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatMessageClock,
    formatRunDuration,
    formatLatencySeconds,
    formatTokensPerSecond,
    animatedKindOfBytes,
  }
}