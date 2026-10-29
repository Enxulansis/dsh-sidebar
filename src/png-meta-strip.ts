/**
 * 0.0.55（反馈①，用户拍板后实施）：上传前剥离 PNG 的**元数据块**（eXIf / tEXt / zTXt / iTXt）。
 *
 * 背景：dsh 运行时的附件归一化（dsh-attachment-local）要求「非动画 + **无元数据** + 8bit uchar +
 * sRGB + 未超限」才允许**原字节直通**；否则重编码——有透明通道的图会变成**有损 WebP**，附件库存
 * 归一化版本、侧栏显示它，用户实测"上传后色彩偏移、噪点变多"（测试图触发源：eXIf 184B +
 * tEXt "Software: Paint.NET"）。剥离这两类块后运行时判定为干净 → 直通 → 显示与原图一致。
 *
 * 边界：**只改上传副本**（内存中的字节），本地源文件永不写入；IDAT/IHDR（像素与尺寸）不触碰，
 * 属无损变换；gAMA/cHRM/sRGB/pHYs 保留（不参与运行时判定，且影响颜色渲染，不动更安全）。
 * 非 PNG 输入原样返回（JPEG 的 EXIF 剥离涉及 APPn 布局，风险更大，本期不做）。
 */

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const STRIP_CHUNKS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt'])
const TYPE_LENGTH = 4
const HEADER_LENGTH = 8

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < HEADER_LENGTH) return false
  for (let index = 0; index < PNG_MAGIC.length; index += 1) {
    if (bytes[index] !== PNG_MAGIC[index]) return false
  }
  return true
}

function byteAt(bytes: Uint8Array, offset: number): number {
  return bytes[offset] ?? 0
}

function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(byteAt(bytes, offset), byteAt(bytes, offset + 1), byteAt(bytes, offset + 2), byteAt(bytes, offset + 3))
}

/** 剥离 PNG 元数据块；非 PNG / 解析异常 / 无可剥离块时原样返回（保持输入引用）。 */
export function stripPngMetadataBytes(bytes: Uint8Array): Uint8Array {
  if (!isPng(bytes)) return bytes
  const kept: Array<{ start: number; end: number }> = []
  let offset = HEADER_LENGTH
  let stripped = 0
  let sawIend = false
  while (offset + 12 <= bytes.length) {
    const length = ((byteAt(bytes, offset) << 24 | byteAt(bytes, offset + 1) << 16 | byteAt(bytes, offset + 2) << 8 | byteAt(bytes, offset + 3)) >>> 0)
    const end = offset + 12 + length
    if (end > bytes.length) return bytes // 结构损坏：整体回退，不做外科手术
    const type = chunkType(bytes, offset + 4)
    if (STRIP_CHUNKS.has(type)) stripped += 1
    else kept.push({ start: offset, end })
    if (type === 'IEND') {
      sawIend = true
      offset = end
      break
    }
    offset = end
  }
  /* 未见 IEND（截断/损坏）→ 原样返回，绝不用重建结果替换不完整文件 */
  if (stripped === 0 || !sawIend) return bytes
  const size = HEADER_LENGTH + kept.reduce((sum, chunk) => sum + (chunk.end - chunk.start), 0)
  const out = new Uint8Array(size)
  out.set(bytes.subarray(0, HEADER_LENGTH), 0)
  let cursor = HEADER_LENGTH
  for (const chunk of kept) {
    out.set(bytes.subarray(chunk.start, chunk.end), cursor)
    cursor += chunk.end - chunk.start
  }
  return out
}

/** base64 版本（上传链路以 base64 传递）。解析失败时原样返回。 */
export function stripPngMetadataBase64(base64: string): string {
  if (typeof base64 !== 'string' || base64.length < 16) return base64
  let bytes: Buffer
  try {
    bytes = Buffer.from(base64, 'base64')
  } catch {
    return base64
  }
  const stripped = stripPngMetadataBytes(bytes)
  return stripped === bytes ? base64 : Buffer.from(stripped).toString('base64')
}

export const PNG_STRIPPED_CHUNKS = [...STRIP_CHUNKS]
export const PNG_TYPE_LENGTH = TYPE_LENGTH
