import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findAddedPlugin,
  installedPluginStatus,
  normalizePluginSpec,
  readInstalledPlugins,
  resolveDshHome,
  type InstalledPlugin,
} from '../src/plugin-profile.js'

describe('DSH web profile plugins', () => {
  it('resolves the official DSH home convention', () => {
    const root = parse(process.cwd()).root
    const userHome = join(root, 'Users', 'example')
    const configuredHome = join(root, 'tmp', 'dsh-home')
    expect(resolveDshHome({}, userHome)).toBe(join(userHome, '.dsh'))
    expect(resolveDshHome({ DSH_HOME: '~/custom-dsh' }, userHome)).toBe(join(userHome, 'custom-dsh'))
    expect(resolveDshHome({ DSH_HOME: configuredHome }, userHome)).toBe(configuredHome)
  })

  it('reads dependencies and marks only declared profile bundles as active candidates', () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'dsh-vscode-profile-'))
    const profile = join(dshHome, 'profiles', 'web')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      dependencies: {
        '@example/runtime-plugin': '^1.2.3',
        'plain-library': '2.0.0',
      },
      dsh: { profile: { bundles: ['@example/runtime-plugin'] } },
    }))

    expect(readInstalledPlugins(dshHome)).toEqual([
      { name: '@example/runtime-plugin', spec: '^1.2.3', bundle: true },
      { name: 'plain-library', spec: '2.0.0', bundle: false },
    ])
  })

  it('uses an explicit home without mutating the inherited environment', () => {
    const env = { DSH_HOME: '~/old-home' }
    const userHome = join(parse(process.cwd()).root, 'Users', 'example')
    expect(resolveDshHome(env, userHome, '~/rc4-home')).toBe(join(userHome, 'rc4-home'))
    expect(resolveDshHome(env, userHome, ' ')).toBe(join(userHome, 'old-home'))
    expect(env.DSH_HOME).toBe('~/old-home')
  })

  it('maps matching Loader entries to a useful runtime status', () => {
    expect(installedPluginStatus('@example/runtime-plugin', {
      entries: [{
        entryId: 'plugin-1',
        moduleName: '@example/runtime-plugin/tool',
        enabled: true,
        fiberPhase: 'active',
      }],
    })).toBe('active')
    expect(installedPluginStatus('@example/runtime-plugin', {
      entries: [{
        entryId: 'plugin-1',
        moduleName: '@example/runtime-plugin/tool',
        enabled: true,
        fiberPhase: 'failed',
      }],
    })).toBe('failed')
  })

  it('validates sources and identifies the dependency added by pnpm', () => {
    expect(normalizePluginSpec('  github:owner/plugin  ')).toBe('github:owner/plugin')
    expect(() => normalizePluginSpec('--workspace-root')).toThrow(/命令行选项/)
    expect(() => normalizePluginSpec('plugin\nremove other')).toThrow(/一行/)

    const before: InstalledPlugin[] = [{ name: 'existing', spec: '1.0.0', bundle: true }]
    const after: InstalledPlugin[] = [
      { name: '@example/new-plugin', spec: 'github:owner/plugin', bundle: true },
      ...before,
    ]
    expect(findAddedPlugin(before, after)?.name).toBe('@example/new-plugin')
  })
})
