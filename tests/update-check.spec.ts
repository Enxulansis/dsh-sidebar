import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  localDateKey,
  modelCatalogDiff,
  pickHighestVersion,
  shouldAutoCheck,
  updatesFrom,
} from '../src/update-check.js'

describe('Update check (0.0.75)', () => {
  it('compares semver including prerelease ordering', () => {
    expect(compareVersions('0.34.0', '0.34.0')).toBe(0)
    expect(compareVersions('0.34.0', '0.50.0')).toBe(-1)
    expect(compareVersions('0.1.1-rc.2', '0.1.1')).toBe(-1)
    expect(compareVersions('0.1.5-rc.2', '0.1.1-rc.2')).toBe(1)
    expect(compareVersions('0.1.1-rc.2', '0.1.1-rc.10')).toBe(-1)
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('banana', '1.0.0')).toBe(0)
  })

  it('picks the highest dist-tag version and flags stale entries', () => {
    expect(pickHighestVersion(['0.49.4', '0.50.0', '1.32.0-next.1'])).toBe('1.32.0-next.1')
    expect(pickHighestVersion([])).toBeUndefined()
    const items = updatesFrom(
      { 'dsh-context': '0.34.0', 'dsh-vision-router': '2.0.1', 'a': undefined, 'b': '1.0.0' },
      { 'dsh-context': '0.50.0', 'dsh-vision-router': '2.0.1', 'a': '9.9.9', 'b': '0.9.0' },
    )
    expect(items).toEqual([
      { name: 'dsh-context', installed: '0.34.0', latest: '0.50.0', stale: true },
      { name: 'dsh-vision-router', installed: '2.0.1', latest: '2.0.1', stale: false },
      { name: 'a', installed: undefined, latest: '9.9.9', stale: false },
      { name: 'b', installed: '1.0.0', latest: '0.9.0', stale: false },
    ])
  })

  it('summarizes model catalog drift including renames', () => {
    expect(modelCatalogDiff([], [{ key: 'p/a', label: 'A' }])).toBeUndefined()
    expect(modelCatalogDiff(
      [{ key: 'p/flash', label: 'DeepSeek-V4.1-Flash' }, { key: 'p/pro', label: 'Pro' }],
      [{ key: 'p/flash', label: 'DeepSeek-V4.1-Flash' }, { key: 'p/pro', label: 'Pro' }],
    )).toBeUndefined()
    expect(modelCatalogDiff(
      [{ key: 'p/old-flash', label: 'DeepSeek-V4.1-Flash' }, { key: 'p/pro', label: 'Pro' }],
      [{ key: 'p/flash', label: 'DeepSeek-V4.1-Flash' }, { key: 'p/pro', label: 'Pro' }],
    )).toBe('改名 p/old-flash→p/flash')
    expect(modelCatalogDiff(
      [{ key: 'p/pro', label: 'Pro' }],
      [{ key: 'p/pro', label: 'Pro' }, { key: 'p/x', label: 'X' }],
    )).toBe('新增 p/x')
    expect(modelCatalogDiff(
      [{ key: 'p/a', label: 'A' }, { key: 'p/b', label: 'B' }, { key: 'p/c', label: 'C' }, { key: 'p/d', label: 'D' }],
      [],
    )).toBe('移除 p/a、p/b、p/c 等 4 项')
  })

  it('decides auto-check timing per frequency', () => {
    const now = new Date('2026-09-12T15:00:00')
    expect(localDateKey(now)).toBe('2026-09-12')
    expect(shouldAutoCheck('never', {}, now)).toBe(false)
    expect(shouldAutoCheck('reload', { date: '2026-09-12', at: now.getTime() }, now)).toBe(true)
    expect(shouldAutoCheck('startup', { date: '2026-09-12' }, now)).toBe(false)
    expect(shouldAutoCheck('startup', { date: '2026-09-11' }, now)).toBe(true)
    expect(shouldAutoCheck('startup', {}, now)).toBe(true)
    expect(shouldAutoCheck('weekly', { at: now.getTime() - 6 * 24 * 3600 * 1000, date: '2026-09-06' }, now)).toBe(false)
    expect(shouldAutoCheck('weekly', { at: now.getTime() - 8 * 24 * 3600 * 1000, date: '2026-09-04' }, now)).toBe(true)
    expect(shouldAutoCheck('weekly', {}, now)).toBe(true)
  })
})
