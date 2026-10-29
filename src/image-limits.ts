import type { ImageMediaType } from './dsh-client.js'

/** Deployment-resolved upload bounds published by the `imageLimits` session projection. */
export interface ImageAttachmentLimits {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  mediaTypes: readonly string[]
}

/** One already-attached or about-to-be-attached image, measured in decoded bytes. */
export interface ImageCandidate {
  mediaType: ImageMediaType
  bytes: number
  name?: string
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function countOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Read the limits published by DSH. Every field must be usable: a partial
 * payload leaves intake unguarded rather than enforcing a bound the runtime
 * never stated.
 */
export function imageLimitsOf(value: unknown): ImageAttachmentLimits | undefined {
  const record = recordOf(value)
  if (record === undefined) return undefined
  const maxImageBytes = countOf(record.maxImageBytes)
  const maxImagesPerMessage = countOf(record.maxImagesPerMessage)
  const maxMessageImageBytes = countOf(record.maxMessageImageBytes)
  const mediaTypes = Array.isArray(record.mediaTypes)
    ? record.mediaTypes.filter((entry): entry is string => typeof entry === 'string')
    : undefined
  if (maxImageBytes === undefined
    || maxImagesPerMessage === undefined
    || maxMessageImageBytes === undefined
    || mediaTypes === undefined
    || mediaTypes.length === 0) {
    return undefined
  }
  return { maxImageBytes, maxImagesPerMessage, maxMessageImageBytes, mediaTypes }
}

/**
 * G40 (0.0.93): magic-byte sanity for the dialog-path native formats. Rejects
 * empty/renamed/entirely-wrong bytes before they become draft attachments
 * (truncated-but-valid headers still pass; the webview's decode check covers
 * the paste/drop path in full).
 */
export function looksLikeImageBytes(bytes: Uint8Array, mediaType: string): boolean {
  const has = (...signature: number[]): boolean => signature.every((byte, index) => bytes.length > index && bytes[index] === byte)
  switch (mediaType) {
    case 'image/png':
      return has(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    case 'image/jpeg':
      return has(0xff, 0xd8, 0xff)
    case 'image/gif':
      return has(0x47, 0x49, 0x46, 0x38)
    case 'image/webp':
      return has(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    default:
      return true
  }
}

/** Render a byte bound for a message the user reads, never rounding a real bound to `0`. */
export function imageSizeText(bytes: number): string {
  const mib = bytes / (1024 * 1024)
  if (mib < 1) return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`
  const rounded = mib >= 10 ? Math.round(mib) : Math.round(mib * 10) / 10
  return `${String(rounded)} MB`
}

/**
 * Pre-flight one intake against the runtime's own bounds, mirroring the order the
 * official DSH composer applies. Returns the message to show, or `undefined` when
 * the batch may be attached.
 *
 * An unsupported media type is deliberately not rejected here: DSH answers that
 * case with its own reason, and duplicating the list would let the two drift. The
 * count and byte bounds still apply to such a batch — they hold whatever the types,
 * so one unadvertised file cannot carry an over-limit payload past this check.
 */
export function rejectImageAttachments(
  attached: readonly ImageCandidate[],
  incoming: readonly ImageCandidate[],
  limits: ImageAttachmentLimits | undefined,
): string | undefined {
  if (limits === undefined || incoming.length === 0) return undefined

  if (attached.length + incoming.length > limits.maxImagesPerMessage) {
    return `DeepSeek Harness 每条消息最多接受 ${String(limits.maxImagesPerMessage)} 张图片。`
  }

  const oversized = incoming.find(image => image.bytes > limits.maxImageBytes)
  if (oversized !== undefined) {
    const label = oversized.name === undefined ? '该图片' : `\`${oversized.name}\``
    return `${label}超过单张图片 ${imageSizeText(limits.maxImageBytes)} 的上限。`
  }

  const total = [...attached, ...incoming].reduce((sum, image) => sum + image.bytes, 0)
  if (total > limits.maxMessageImageBytes) {
    return `这些图片超过单条消息 ${imageSizeText(limits.maxMessageImageBytes)} 的上限。`
  }

  return undefined
}
