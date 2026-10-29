import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export type PluginFiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

export interface PluginInventoryEntry {
  entryId: string
  moduleName: string
  enabled: boolean
  fiberPhase: PluginFiberPhase
}

export interface PluginInventorySnapshot {
  entries: readonly PluginInventoryEntry[]
}

export interface InstalledPlugin {
  name: string
  spec: string
  bundle: boolean
}

export type InstalledPluginStatus = 'active' | 'failed' | 'disabled' | 'loading' | 'inactive' | 'unknown'

interface ProfileManifest {
  dependencies?: Record<string, unknown>
  dsh?: { profile?: { bundles?: unknown[] } }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Explicit VS Code directory, then DSH_HOME, then ~/.dsh. */
export function resolveDshHome(
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = homedir(),
  configuredHome?: string,
): string {
  const configured = configuredHome?.trim() || env.DSH_HOME?.trim()
  if (configured === undefined || configured === '') return join(userHome, '.dsh')
  if (configured === '~') return userHome
  if (configured.startsWith('~/') || configured.startsWith('~\\')) {
    return resolve(userHome, configured.slice(2))
  }
  return resolve(configured)
}

/** Read the official web profile without mutating DSH-owned state. */
export function readInstalledPlugins(dshHome: string): InstalledPlugin[] {
  const manifestPath = join(dshHome, 'profiles', 'web', 'package.json')
  let source: string
  try {
    source = readFileSync(manifestPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  let manifest: ProfileManifest
  try {
    manifest = JSON.parse(source) as ProfileManifest
  } catch {
    throw new Error(`DSH web profile 清单不是有效的 JSON：${manifestPath}`)
  }

  const dependencies = record(manifest.dependencies) ?? {}
  const bundleValues = manifest.dsh?.profile?.bundles ?? []
  const bundles = new Set(bundleValues.filter((value): value is string => typeof value === 'string'))
  return Object.entries(dependencies)
    .flatMap(([name, spec]): InstalledPlugin[] => typeof spec === 'string'
      ? [{ name, spec, bundle: bundles.has(name) }]
      : [])
    .sort((left, right) => left.name.localeCompare(right.name))
}

/* 0.0.73 适配矩阵：读运行时的 dsh 版本与被跟踪插件的**已装**版本（profile node_modules；
   各自 best-effort——读不到返回 undefined，由上层显示「—」不报错）。 */
export function readInstalledVersions(
  dshHome: string,
  pluginNames: readonly string[],
): { dsh: string | undefined; plugins: Record<string, string | undefined> } {
  const versionOf = (packageJsonPath: string): string | undefined => {
    try {
      const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown }
      return typeof parsed.version === 'string' && parsed.version !== '' ? parsed.version : undefined
    } catch {
      return undefined
    }
  }
  const plugins: Record<string, string | undefined> = {}
  for (const name of pluginNames) {
    plugins[name] = versionOf(join(dshHome, 'profiles', 'web', 'node_modules', name, 'package.json'))
  }
  return {
    dsh: versionOf(join(dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')),
    plugins,
  }
}

/** Match one installed bundle to Loader entries without claiming unavailable provenance. */
export function installedPluginStatus(
  pluginName: string,
  inventory: PluginInventorySnapshot | undefined,
): InstalledPluginStatus {
  if (inventory === undefined) return 'unknown'
  const entries = inventory.entries.filter(entry => (
    entry.moduleName === pluginName || entry.moduleName.startsWith(`${pluginName}/`)
  ))
  if (entries.length === 0) return 'unknown'
  if (entries.some(entry => entry.enabled && entry.fiberPhase === 'failed')) return 'failed'
  if (entries.some(entry => entry.enabled && entry.fiberPhase === 'active')) return 'active'
  if (entries.every(entry => !entry.enabled)) return 'disabled'
  if (entries.some(entry => entry.enabled && (entry.fiberPhase === 'pending' || entry.fiberPhase === 'loading'))) {
    return 'loading'
  }
  return 'inactive'
}

/** Accept one pnpm package spec while preventing option injection into the official CLI forwarder. */
export function normalizePluginSpec(value: string): string {
  const spec = value.trim()
  if (spec === '') throw new Error('请输入 npm 包、GitHub 源码、tarball 或本地插件路径。')
  if (spec.startsWith('-')) throw new Error('插件来源不能以命令行选项开头。')
  if (/[\0\r\n]/.test(spec)) throw new Error('插件来源必须写在一行内。')
  return spec
}

/** Identify the dependency introduced by a successful official add command. */
export function findAddedPlugin(
  before: readonly InstalledPlugin[],
  after: readonly InstalledPlugin[],
): InstalledPlugin | undefined {
  const previousNames = new Set(before.map(plugin => plugin.name))
  return after.find(plugin => !previousNames.has(plugin.name))
}
