/* Model identity is an exact (connection route, model ID) pair. Names are presentation only. */

export interface ModelOptionLike {
  provider: string
  model: string
  label: string
  selected?: boolean
}

export function dedupeModelOptions<T extends ModelOptionLike>(items: readonly T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const key = JSON.stringify([item.provider, item.model])
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}
