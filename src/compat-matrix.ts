export interface CompatLine {
  name: string
  version: string | undefined
  verified: boolean
}

export interface CompatMatrix {
  dsh: CompatLine
  plugins: CompatLine[]
  anyUnverified: boolean
}

/** RC4 candidate: verification applies to the exact tested backend, never to alpha or another RC. */
export const TESTED_DSH_VERSIONS = ['0.2.1-rc.4']
export const TESTED_PLUGIN_VERSIONS: Record<string, string[]> = {}
export const TRACKED_PLUGINS = ['dsh-context']

export function isVerifiedVersion(name: string, version: string | undefined): boolean {
  if (version === undefined || version === '') return false
  const versions = name === 'dsh' ? TESTED_DSH_VERSIONS : (TESTED_PLUGIN_VERSIONS[name] ?? [])
  return versions.includes(version)
}

/** 组装适配矩阵（版本缺席 → verified=false 且版本显示为空，由 UI 落成「—」）。 */
export function buildCompatMatrix(
  dshVersion: string | undefined,
  pluginVersions: Record<string, string | undefined>,
): CompatMatrix {
  const dsh: CompatLine = { name: 'dsh', version: dshVersion, verified: isVerifiedVersion('dsh', dshVersion) }
  const plugins = TRACKED_PLUGINS.map((name): CompatLine => {
    const version = pluginVersions[name]
    return { name, version, verified: isVerifiedVersion(name, version) }
  })
  return { dsh, plugins, anyUnverified: !dsh.verified || plugins.some(plugin => !plugin.verified) }
}
