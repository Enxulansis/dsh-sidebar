export function injectDebugRuntimePatch(args: readonly string[], patchPath: string): string[] {
  if (patchPath.trim() === '') throw new Error('调试运行时补丁路径为空。')
  if (args.some((arg, index) => arg === '--patch' && args[index + 1] === patchPath)) return [...args]

  if (args[0] === 'web') return ['web', '--patch', patchPath, ...args.slice(1)]
  if (args[0] === '--profile' && args[1] === 'web') {
    return ['--profile', 'web', '--patch', patchPath, ...args.slice(2)]
  }
  throw new Error('自主调试需要 DSH Web profile（`dsh web` 或 `dsh --profile web`）。')
}

export function supportsDebugRuntime(version: string | undefined): boolean {
  if (version === undefined || version.trim() === '') return true
  const match = /(?:^|\s|v)(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?(?:\s|$|\+)/i.exec(version.trim())
  if (match === null) return true
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  const rc = match[4] === undefined ? undefined : Number(match[4])
  if (major !== 0) return major > 0
  if (minor !== 1) return minor > 1
  if (patch !== 0) return patch > 0
  return rc === undefined || rc >= 8
}

export function debugRuntimePatch(endpoint: URL): string {
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') {
    throw new Error('调试 MCP 端点必须使用 IPv4 回环地址。')
  }
  return [
    '- insert:',
    '    - id: dsh-vscode-debug',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: vscode',
    '        transport: streamable-http',
    `        url: ${endpoint.href}`,
    '        headers:',
    "          Authorization: !!js '`Bearer ${process.env.DSH_VSCODE_DEBUG_TOKEN}`'",
    '        toolCallTimeoutMs: 15000',
    '        failOnStartupError: false',
    '        reconnect:',
    '          enabled: true',
    '          initialDelayMs: 500',
    '          maxDelayMs: 10000',
    '          maxAttempts: 10',
    '',
  ].join('\n')
}
