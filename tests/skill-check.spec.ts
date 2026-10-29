import { describe, expect, it } from 'vitest'
import { applySkillFallback, parseSkillManifest, skillUpdateItem } from '../src/update-check.js'

/* 0.0.90：技能上游检查——清单解析 + 落后判定（sha 不等 / semver 更高）。 */

const ENTRY = { name: 'web-access', repo: 'eze-is/web-access', branch: 'main', versionFile: 'SKILL.md', installedRef: 'v2.5.4', sha: '33eef84a55b1919396a80e7a55650a07bb83f590' }

describe('parseSkillManifest', () => {
  it('合法清单：全字段保留', () => {
    const items = parseSkillManifest({ version: 1, sources: [ENTRY] })
    expect(items).toHaveLength(1)
    expect(items[0]).toEqual(ENTRY)
  })
  it('无效条目丢弃（repo 非法 / name 缺失）；整体无效 → 空数组（静默）', () => {
    expect(parseSkillManifest({ sources: [{ name: 'x', repo: 'not-a-repo' }, { name: '', repo: 'a/b' }, ENTRY] })).toHaveLength(1)
    expect(parseSkillManifest(undefined)).toEqual([])
    expect(parseSkillManifest({})).toEqual([])
    expect(parseSkillManifest({ sources: 'oops' })).toEqual([])
  })
  it('sha 需 7-40 hex；非法则丢弃该字段', () => {
    const items = parseSkillManifest({ sources: [{ name: 'a', repo: 'a/b', sha: 'zzz' }] })
    expect(items[0]?.sha).toBeUndefined()
  })
})

describe('skillUpdateItem', () => {
  it('无版本信息时：sha 变了 → 落后；显示层用日期（不展示 sha）', () => {
    const diff = skillUpdateItem(ENTRY, { sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', date: '2026-09-13T00:00:00Z' })
    expect(diff.stale).toBe(true)
    expect(diff.installed).toBe('v2.5.4')
    expect(diff.latest).toBe('2026-09-13')
    expect(diff.latest).not.toContain('aaaaaaa')
    expect(skillUpdateItem(ENTRY, { sha: ENTRY.sha, date: '2026-09-13T00:00:00Z' }).stale).toBe(false)
  })
  it('两边都有版本 → 版本说了算；版本+日期都展示；仅 sha 才回退短 sha', () => {
    expect(skillUpdateItem(ENTRY, { sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', version: '2.5.4' }).stale).toBe(false)
    const item = skillUpdateItem(ENTRY, { sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', version: '2.5.5', date: '2026-09-13T00:00:00Z' })
    expect(item.stale).toBe(true)
    expect(item.latest).toBe('2.5.5 · 2026-09-13')
    expect(skillUpdateItem(ENTRY, { sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }).latest).toBe('aaaaaaa')
  })
  it('无 sha 时按 semver 比较：更新/相同/更旧', () => {
    const noSha = { name: 'x', repo: 'a/b', installedRef: 'v3.3.0' }
    expect(skillUpdateItem(noSha, { version: '3.3.1' }).stale).toBe(true)
    expect(skillUpdateItem(noSha, { version: '3.3.0' }).stale).toBe(false)
    expect(skillUpdateItem(noSha, { version: '3.2.9' }).stale).toBe(false)
  })
  it('探测失败 → 未知、不判落后（不误报）', () => {
    const item = skillUpdateItem(ENTRY, { failed: true })
    expect(item.latest).toContain('未知')
    expect(item.stale).toBe(false)
    const empty = skillUpdateItem(ENTRY, {})
    expect(empty.latest).toContain('未知')
    expect(empty.stale).toBe(false)
  })
  it('已装标签回退：installedRef → installedAt 日期 → —（不展示 sha）', () => {
    expect(skillUpdateItem({ name: 'n', repo: 'a/b', installedRef: 'v1.0.0' }, { failed: true }).installed).toBe('v1.0.0')
    expect(skillUpdateItem({ name: 'n', repo: 'a/b', installedAt: '2026-09-12' }, { failed: true }).installed).toBe('2026-09-12')
    expect(skillUpdateItem({ name: 'n', repo: 'a/b', sha: ENTRY.sha }, { failed: true }).installed).toBe('—')
  })
})

describe('applySkillFallback（失败行回填上次成功快照）', () => {
  const failedRow = { name: '技能 · nature-skills', installed: '2026-09-12', latest: '未知（检查失败）', stale: false }
  it('有上次行 → 回填 latest/stale 并标注「（上次结果）」', () => {
    const out = applySkillFallback([failedRow], [{ name: '技能 · nature-skills', latest: '2026-09-10', stale: true }])
    expect(out[0]?.latest).toBe('2026-09-10（上次结果）')
    expect(out[0]?.stale).toBe(true)
  })
  it('无上次行 / 成功行 → 不动', () => {
    expect(applySkillFallback([failedRow], [])[0]?.latest).toContain('未知')
    const okRow = { name: '技能 · web-access', installed: 'v2.5.4', latest: '2.5.4 · 2026-08-19', stale: false }
    expect(applySkillFallback([okRow], [{ name: '技能 · web-access', latest: 'x' }])[0]?.latest).toBe('2.5.4 · 2026-08-19')
  })
  it('连续失败沿用已标注快照，不重复增加上次结果；恢复成功清标注', () => {
    const once = applySkillFallback([failedRow], [{ name: failedRow.name, latest: '2.0.0', stale: true }])
    const again = applySkillFallback([failedRow], once)
    expect(again).toEqual(once)
    expect(again[0]?.latest).toBe('2.0.0（上次结果）')
    const recovered = { ...failedRow, latest: '3.0.0', stale: true }
    expect(applySkillFallback([recovered], again)).toEqual([recovered])
  })
})
