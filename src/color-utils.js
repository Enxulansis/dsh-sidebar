// G45 (0.0.103) 公式复制颜色工具（设置台色板用）——浏览器语法=注入 webview + node 单测单一来源
// 用法: webview 端由 webview.ts `${vendoredColorUtils()}` 注入为全局函数；vitest import 本文件直接断言。
// 色模说明：调色板采用 HSL（色相-饱和-亮度）——与 HSI/HSV 仅是饱和度/明度定义差异，UI 层通行 HSL。
function normalizeHexColor(raw) {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(value)) return value
  if (/^#[0-9a-f]{3}$/.test(value)) {
    return '#' + value[1] + value[1] + value[2] + value[2] + value[3] + value[3]
  }
  return undefined
}
function hexToRgb(hex) {
  const value = normalizeHexColor(hex)
  if (value === undefined) return undefined
  return {
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16),
  }
}
function clampRound(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(value)))
}
function rgbToHex(r, g, b) {
  const part = (value) => clampRound(value, 0, 255).toString(16).padStart(2, '0')
  return '#' + part(r) + part(g) + part(b)
}
function rgbToHsl(r, g, b) {
  const rn = clampRound(r, 0, 255) / 255
  const gn = clampRound(g, 0, 255) / 255
  const bn = clampRound(b, 0, 255) / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) }
}
function hslToRgb(h, s, l) {
  const hn = (((h % 360) + 360) % 360) / 360
  const sn = clampRound(s, 0, 100) / 100
  const ln = clampRound(l, 0, 100) / 100
  if (sn === 0) {
    const value = Math.round(ln * 255)
    return { r: value, g: value, b: value }
  }
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn
  const p = 2 * ln - q
  const channel = (t) => {
    let tn = t
    if (tn < 0) tn += 1
    if (tn > 1) tn -= 1
    if (tn < 1 / 6) return p + (q - p) * 6 * tn
    if (tn < 1 / 2) return q
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6
    return p
  }
  return {
    r: Math.round(channel(hn + 1 / 3) * 255),
    g: Math.round(channel(hn) * 255),
    b: Math.round(channel(hn - 1 / 3) * 255),
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizeHexColor, hexToRgb, rgbToHex, rgbToHsl, hslToRgb }
}
