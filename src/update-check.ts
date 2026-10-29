import type { UpdateCheckFrequency } from './view-settings.js'

export interface UpdateItem {
  name: string
  installed: string | undefined
  latest: string | undefined
  stale: boolean
}

export interface ModelCatalogEntry {
  /* provider/model 唯一键 */
  key: string
  label: string
}

/* ---- 0.0.90：技能（上游仓库）更新检查 ---- */

export interface SkillSourceEntry {
  name: string
  repo: string
  branch?: string
  versionFile?: string
  installedRef?: string
  sha?: string
  installedAt?: string
}

/** 探测结果：sha+date（gh / ls-remote）或 version（raw）；全空 = 检查失败。 */
export interface SkillProbeResult {
  sha?: string
  version?: string
  date?: string
  failed?: boolean
}

const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/

/** 解析 `~/.dsh/skills/.sources.json`（无效条目丢弃；整体无效 → 空数组 = 检查静默）。 */
export function parseSkillManifest(raw: unknown): SkillSourceEntry[] {
  const input = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : undefined
  const list = input !== undefined && Array.isArray(input.sources) ? input.sources : []
  return list.flatMap((entry): SkillSourceEntry[] => {
    const record = typeof entry === 'object' && entry !== null ? entry as Record<string, unknown> : undefined
    if (record === undefined) return []
    const { name, repo } = record
    if (typeof name !== 'string' || name === '' || typeof repo !== 'string' || !REPO_PATTERN.test(repo)) return []
    return [{
      name,
      repo,
      ...(typeof record.branch === 'string' && record.branch !== '' ? { branch: record.branch } : {}),
      ...(typeof record.versionFile === 'string' && record.versionFile !== '' ? { versionFile: record.versionFile } : {}),
      ...(typeof record.installedRef === 'string' && record.installedRef !== '' ? { installedRef: record.installedRef } : {}),
      ...(typeof record.sha === 'string' && /^[0-9a-f]{7,40}$/i.test(record.sha) ? { sha: record.sha.toLowerCase() } : {}),
      ...(typeof record.installedAt === 'string' ? { installedAt: record.installedAt } : {}),
    }]
  })
}

export interface SkillUpdateRow {
  name: string
  installed: string
  latest: string
  stale: boolean
}

const shortDate = (value: string | undefined): string | undefined => (value === undefined ? undefined : value.slice(0, 10))

/** 组装技能行：两边都有版本 → 版本说了算（未发版的提交不打扰）；否则 sha 不等即落后；
 *  探测失败 → "未知"、不判落后（不误报）。
 *  显示层：sha 不展示（内部仍用于判定）；无版本的上游用日期替代（最新侧），已装侧回退到安装日期。 */
export function skillUpdateItem(entry: SkillSourceEntry, probe: SkillProbeResult): SkillUpdateRow {
  const installed = entry.installedRef ?? shortDate(entry.installedAt) ?? '—'
  if (probe.failed === true || (probe.version === undefined && probe.sha === undefined)) {
    return { name: '技能 · ' + entry.name, installed, latest: '未知（检查失败）', stale: false }
  }
  let stale = false
  if (probe.version !== undefined && entry.installedRef !== undefined) {
    stale = compareVersions(probe.version, entry.installedRef) > 0
  } else if (probe.sha !== undefined && entry.sha !== undefined) {
    stale = probe.sha !== entry.sha
  }
  const latestParts: string[] = []
  if (probe.version !== undefined) latestParts.push(probe.version)
  const date = shortDate(probe.date)
  if (date !== undefined) latestParts.push(date)
  /* 仅当版本与日期都拿不到（如 ls-remote 后端）才回退展示短 sha */
  if (latestParts.length === 0 && probe.sha !== undefined) latestParts.push(probe.sha.slice(0, 7))
  return { name: '技能 · ' + entry.name, installed, latest: latestParts.length > 0 ? latestParts.join(' · ') : '未知', stale }
}

const PREVIOUS_SKILL_RESULT_SUFFIX = '（上次结果）'

/** 探测失败的技能行 ← 上一次成功快照里同名行的显示（latest/stale 沿用，标注「（上次结果）」）。 */
export function applySkillFallback(items: readonly SkillUpdateRow[], previous: readonly { name: string; latest?: string; stale?: boolean }[]): SkillUpdateRow[] {
  return items.map((item) => {
    if (!item.latest.startsWith('未知')) return item
    const prev = previous.find((candidate) => candidate.name === item.name)
    if (prev === undefined || prev.latest === undefined || prev.latest === '') return item
    const latest = prev.latest.endsWith(PREVIOUS_SKILL_RESULT_SUFFIX) ? prev.latest : prev.latest + PREVIOUS_SKILL_RESULT_SUFFIX
    return { ...item, latest, stale: prev.stale === true }
  })
}

interface ParsedVersion {
  parts: [number, number, number]
  prerelease: string[]
}

function parseVersion(version: string): ParsedVersion | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version.trim())
  if (match === null) return undefined
  const prerelease = match[4] === undefined ? [] : match[4].split('.')
  return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease }
}

function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  // semver: 无预发布 > 有预发布；逐段比较（数字小、字符串按字典序）
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1
  const count = Math.max(left.length, right.length)
  for (let index = 0; index < count; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    const aNumber = /^\d+$/.test(a) ? Number(a) : undefined
    const bNumber = /^\d+$/.test(b) ? Number(b) : undefined
    if (aNumber !== undefined && bNumber !== undefined) {
      if (aNumber !== bNumber) return aNumber < bNumber ? -1 : 1
      continue
    }
    if (aNumber !== undefined) return -1
    if (bNumber !== undefined) return 1
    if (a !== b) return a < b ? -1 : 1
  }
  return 0
}

/** semver 风格比较：left<right → -1；相等 → 0；left>right → 1；无法解析 → 0（不误报更新）。 */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === undefined || b === undefined) return 0
  for (let index = 0; index < 3; index += 1) {
    const av = a.parts[index] ?? 0
    const bv = b.parts[index] ?? 0
    if (av !== bv) return av < bv ? -1 : 1
  }
  return comparePrerelease(a.prerelease, b.prerelease)
}

/** dist-tags 值里挑最高版本（tags 可能含 next/latest 等）。 */
export function pickHighestVersion(versions: readonly string[]): string | undefined {
  let best: string | undefined
  for (const version of versions) {
    if (typeof version !== 'string' || version === '') continue
    if (best === undefined || compareVersions(version, best) > 0) best = version
  }
  return best
}

/** 组装"可更新"清单（latest 缺席或 ≤ 已装 → stale:false）。 */
export function updatesFrom(
  installed: Record<string, string | undefined>,
  latest: Record<string, string | undefined>,
): UpdateItem[] {
  return Object.keys(installed).map((name): UpdateItem => {
    const installedVersion = installed[name]
    const latestVersion = latest[name]
    const stale = installedVersion !== undefined
      && latestVersion !== undefined
      && compareVersions(latestVersion, installedVersion) > 0
    return { name, installed: installedVersion, latest: latestVersion, stale }
  })
}

function shortList(values: readonly string[], limit = 3): string {
  if (values.length <= limit) return values.join('、')
  return `${values.slice(0, limit).join('、')} 等 ${values.length} 项`
}

/** 模型目录漂移摘要（新增/移除/同名标签改 id 判为"改名"）；无变化 → undefined。 */
export function modelCatalogDiff(
  previous: readonly ModelCatalogEntry[],
  next: readonly ModelCatalogEntry[],
): string | undefined {
  if (previous.length === 0) return undefined
  const prevKeys = new Set(previous.map(entry => entry.key))
  const nextByKey = new Map(next.map(entry => [entry.key, entry]))
  const removed = previous.filter(entry => !nextByKey.has(entry.key))
  const added = next.filter(entry => !prevKeys.has(entry.key))
  const renames: string[] = []
  const addedLeft = [...added]
  const removedLeft = removed.filter((entry) => {
    const matchIndex = addedLeft.findIndex(candidate => candidate.label !== '' && candidate.label === entry.label)
    if (matchIndex < 0) return true
    const [renamed] = addedLeft.splice(matchIndex, 1)
    if (renamed === undefined) return true
    renames.push(`${entry.key}→${renamed.key}`)
    return false
  })
  const parts: string[] = []
  if (renames.length > 0) parts.push('改名 ' + shortList(renames))
  if (addedLeft.length > 0) parts.push('新增 ' + shortList(addedLeft.map(entry => entry.key)))
  if (removedLeft.length > 0) parts.push('移除 ' + shortList(removedLeft.map(entry => entry.key)))
  return parts.length === 0 ? undefined : parts.join('；')
}

export function localDateKey(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${String(now.getFullYear())}-${month}-${day}`
}

export interface AutoCheckState {
  at?: number
  date?: string
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** 自动检查时机决策：startup=每天首次激活；reload=每次激活；weekly=距上次 ≥7 天；never=不自动。 */
export function shouldAutoCheck(frequency: UpdateCheckFrequency, last: AutoCheckState, now: Date): boolean {
  if (frequency === 'never') return false
  if (frequency === 'reload') return true
  if (frequency === 'weekly') return last.at === undefined || now.getTime() - last.at >= WEEK_MS
  return localDateKey(now) !== last.date
}
