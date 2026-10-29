import { spawn } from 'node:child_process'
import * as vscode from 'vscode'
import { resolveLaunch } from './launch.js'
import { terminateProcessTree } from './process-tree.js'
import {
  COMMUNITY_REGISTRY_URL,
  parseCommunityRuntimePlugins,
  type CommunityRuntimePlugin,
} from './plugin-catalog.js'
import {
  findAddedPlugin,
  installedPluginStatus,
  normalizePluginSpec,
  readInstalledPlugins,
  resolveDshHome,
  type InstalledPlugin,
  type InstalledPluginStatus,
  type PluginInventorySnapshot,
} from './plugin-profile.js'
import {
  hasSettingsOverrides,
  parseRuntimeSetting,
  runtimeSettingFields,
  settingConstantOptions,
  type RuntimeSettingField,
  type SettingsDescription,
  type SettingsMutation,
  type SettingsNamespace,
} from './runtime-settings.js'

const CATALOG_CACHE_KEY = 'deepseekHarness.communityRuntimePlugins'
const MAX_REGISTRY_BYTES = 5 * 1024 * 1024

interface CatalogCache {
  fetchedAt: number
  plugins: CommunityRuntimePlugin[]
}

interface PluginController {
  readonly cwd: string
  readonly runtimeOwnership: 'external' | 'managed' | undefined
  readonly state: {
    phase: 'loading' | 'ready' | 'error'
    statusText: string
    running: boolean
  }
  pluginInventory(): Promise<PluginInventorySnapshot>
  settings(): Promise<SettingsDescription>
  mutateSettings(ns: string, ops: SettingsMutation[], expectedRevision: number): Promise<SettingsNamespace>
  restart(): Promise<void>
}

type PluginPick = vscode.QuickPickItem & (
  | { action: 'install' }
  | { action: 'browse' }
  | { action: 'configure' }
  | { action: 'refresh' }
  | { action: 'plugin'; plugin: InstalledPlugin }
  | { action: 'empty' }
)

const STATUS_LABELS: Record<InstalledPluginStatus, string> = {
  active: '活动中',
  failed: '失败',
  disabled: '已禁用',
  loading: '加载中',
  inactive: '未激活',
  unknown: '状态不可用',
}

const STATUS_ICONS: Record<InstalledPluginStatus, string> = {
  active: 'pass-filled',
  failed: 'error',
  disabled: 'circle-slash',
  loading: 'loading~spin',
  inactive: 'circle-outline',
  unknown: 'extensions',
}

/** Manage runtime-capability bundles through the official DSH profile CLI. */
export class DshPluginManager {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: PluginController,
    private readonly output: vscode.OutputChannel,
    private readonly dshHome: string = resolveDshHome(),
  ) {}

  async show(): Promise<void> {
    while (true) {
      const plugins = readInstalledPlugins(this.dshHome)
      const inventory = await this.tryInventory()
      const selected = await vscode.window.showQuickPick(this.items(plugins, inventory), {
        title: 'DeepSeek Harness 运行时插件',
        placeHolder: 'DSH web profile 加载的工具、技能、MCP、记忆与 agent 钩子',
        matchOnDescription: true,
        matchOnDetail: true,
      })
      if (selected === undefined || selected.action === 'empty') return
      if (selected.action === 'browse') {
        await this.browseCatalog()
        return
      }
      if (selected.action === 'configure') {
        await this.configureSettings()
        continue
      }
      if (selected.action === 'refresh') continue
      if (selected.action === 'install') {
        await this.install()
        continue
      }
      await this.pluginActions(selected.plugin)
    }
  }

  private items(
    plugins: readonly InstalledPlugin[],
    inventory: PluginInventorySnapshot | undefined,
  ): PluginPick[] {
    const items: PluginPick[] = [
      {
        action: 'install',
        label: '$(add) 安装运行时插件…',
        detail: '安装 npm 包、GitHub 源码、tarball 或本地 DSH 捆绑包',
      },
      {
        action: 'browse',
        label: '$(search) 查找社区运行时插件…',
        detail: '搜索工具、技能、MCP 集成、记忆与 agent 钩子，一键安装',
      },
      {
        action: 'configure',
        label: '$(settings-gear) 配置运行时设置…',
        detail: '编辑内置插件与社区 DSH 插件注册的设置命名空间',
      },
      {
        action: 'refresh',
        label: '$(refresh) 刷新',
        detail: '重新读取当前 web profile 与 Loader 状态',
      },
      { action: 'empty', label: '已装入 DSH web profile', kind: vscode.QuickPickItemKind.Separator },
    ]

    if (plugins.length === 0) {
      items.push({
        action: 'empty',
        label: '$(info) 尚未安装社区运行时插件',
        detail: '内置 DSH 运行时仍可正常使用。',
      })
      return items
    }

    for (const plugin of plugins) {
      const status = plugin.bundle ? installedPluginStatus(plugin.name, inventory) : 'inactive'
      items.push({
        action: 'plugin',
        plugin,
        label: `$(${STATUS_ICONS[status]}) ${plugin.name}`,
        description: plugin.bundle ? STATUS_LABELS[status] : '不是 DSH 捆绑包',
        detail: `${plugin.spec} · 适用于使用 web profile 的所有项目`,
      })
    }
    return items
  }

  private async tryInventory(): Promise<PluginInventorySnapshot | undefined> {
    if (this.controller.state.phase !== 'ready') return undefined
    try {
      return await this.controller.pluginInventory()
    } catch (error) {
      this.output.appendLine(`[plugins] Runtime inventory unavailable: ${this.message(error)}`)
      return undefined
    }
  }

  private async install(): Promise<void> {
    if (!await this.requireIdle()) return
    const before = readInstalledPlugins(this.dshHome)
    const input = await vscode.window.showInputBox({
      title: '安装 DSH 运行时插件',
      prompt: '请输入 npm 包、GitHub 源码、tarball 或本地 DSH 插件路径。',
      placeHolder: '@scope/plugin 或 github:owner/repository',
      ignoreFocusOut: true,
      validateInput: (value) => {
        try {
          normalizePluginSpec(value)
          return undefined
        } catch (error) {
          return this.message(error)
        }
      },
    })
    if (input === undefined) return
    const spec = normalizePluginSpec(input)
    const confirmed = await vscode.window.showWarningMessage(
      `安装 ${spec}？`,
      {
        modal: true,
        detail: '第三方 DSH 插件以你的用户权限运行，可能访问文件、凭据与网络。此更改会作用于所有 VS Code 项目共用的 web profile。请仅安装你信任的来源。',
      },
      '安装',
    )
    if (confirmed !== '安装') return
    await this.installConfirmed(spec, spec, before)
  }

  private async installConfirmed(
    spec: string,
    displayName: string,
    before: readonly InstalledPlugin[] = readInstalledPlugins(this.dshHome),
  ): Promise<void> {
    await this.runOfficialPluginCommand(['add', spec], `正在安装 ${displayName}`)
    const installed = readInstalledPlugins(this.dshHome)
    const added = findAddedPlugin(before, installed)
    if (added !== undefined && !added.bundle) {
      await vscode.window.showWarningMessage(
        `${added.name} 已安装，但它未声明 DSH 捆绑包，因此未被激活。`,
      )
    }
    await this.restartAfterChange(`已安装 ${added?.name ?? spec}`)
  }

  private async browseCatalog(): Promise<void> {
    const plugins = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: '正在加载 DSH 社区运行时插件…',
    }, async () => this.loadCatalog())
    const installed = new Set(readInstalledPlugins(this.dshHome).map(plugin => plugin.name))
    const selected = await vscode.window.showQuickPick(plugins.map(plugin => {
      const alreadyInstalled = installed.has(plugin.npm ?? plugin.name)
      const stars = plugin.stars === undefined ? '' : ` · ★ ${String(plugin.stars)}`
      return {
        label: `${alreadyInstalled ? '$(pass-filled) ' : ''}${plugin.name}`,
        description: `${plugin.categoryLabel}${stars}`,
        detail: `${plugin.description} · ${plugin.owner}`,
        plugin,
        alreadyInstalled,
      }
    }), {
      title: '社区运行时插件',
      placeHolder: '搜索工具、技能、MCP、记忆、集成与 agent 钩子',
      matchOnDescription: true,
      matchOnDetail: true,
    })
    if (selected === undefined) return
    const actions = selected.alreadyInstalled
      ? [{ label: '$(github) 在 GitHub 上打开', action: 'open' as const }]
      : [
          { label: '$(cloud-download) 安装', action: 'install' as const },
          { label: '$(github) 在 GitHub 上打开', action: 'open' as const },
        ]
    const action = await vscode.window.showQuickPick(actions, {
      title: `${selected.plugin.owner}/${selected.plugin.name}`,
      placeHolder: selected.alreadyInstalled ? '已装入 DSH web profile' : selected.plugin.description,
    })
    if (action?.action === 'open') {
      await vscode.env.openExternal(vscode.Uri.parse(selected.plugin.url))
      return
    }
    if (action?.action !== 'install' || !await this.requireIdle()) return
    const confirmed = await vscode.window.showWarningMessage(
      `安装 ${selected.plugin.name}？`,
      {
        modal: true,
        detail: `${selected.plugin.description}\n\n来源：${selected.plugin.url}\n安装：${selected.plugin.installSpec}\n\n第三方 DSH 插件以你的用户权限运行，可能访问文件、凭据与网络。社区目录并非安全审查。`,
      },
      '安装',
    )
    if (confirmed !== '安装') return
    await this.installConfirmed(selected.plugin.installSpec, selected.plugin.name)
  }

  private async loadCatalog(): Promise<CommunityRuntimePlugin[]> {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15_000)
      let response: Response
      try {
        response = await fetch(COMMUNITY_REGISTRY_URL, {
          headers: { accept: 'application/json' },
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }
      if (!response.ok) throw new Error(`社区注册表返回 HTTP ${String(response.status)}。`)
      const source = await response.text()
      if (Buffer.byteLength(source, 'utf8') > MAX_REGISTRY_BYTES) {
        throw new Error('社区注册表响应异常过大。')
      }
      const plugins = parseCommunityRuntimePlugins(JSON.parse(source) as unknown, { locale: vscode.env.language })
      if (plugins.length === 0) throw new Error('社区注册表中没有兼容的运行时插件。')
      await this.context.globalState.update(CATALOG_CACHE_KEY, { fetchedAt: Date.now(), plugins } satisfies CatalogCache)
      return plugins
    } catch (error) {
      const cached = this.context.globalState.get<CatalogCache>(CATALOG_CACHE_KEY)
      if (cached !== undefined && Array.isArray(cached.plugins) && cached.plugins.length > 0) {
        this.output.appendLine(`[plugins] Community registry unavailable; using cache from ${new Date(cached.fetchedAt).toISOString()}: ${this.message(error)}`)
        return cached.plugins
      }
      throw new Error(`无法加载社区运行时插件：${this.message(error)}`)
    }
  }

  private async pluginActions(plugin: InstalledPlugin): Promise<void> {
    const selected = await vscode.window.showQuickPick([
      {
        label: '$(trash) 移除插件',
        description: plugin.name,
        detail: '从共用的 DSH web profile 中移除并重启运行时',
        action: 'remove' as const,
      },
    ], {
      title: plugin.name,
      placeHolder: plugin.spec,
    })
    if (selected?.action !== 'remove' || !await this.requireIdle()) return
    const confirmed = await vscode.window.showWarningMessage(
      `从 DSH web profile 中移除 ${plugin.name}？`,
      { modal: true, detail: '此更改会作用于使用该 profile 的所有 VS Code 项目。' },
      '移除',
    )
    if (confirmed !== '移除') return
    await this.runOfficialPluginCommand(['remove', plugin.name], `正在移除 ${plugin.name}`)
    await this.restartAfterChange(`已移除 ${plugin.name}`)
  }

  private async configureSettings(): Promise<void> {
    if (this.controller.state.phase !== 'ready') {
      await vscode.window.showWarningMessage('请先启动 DeepSeek Harness，再配置运行时设置。')
      return
    }
    let description = await this.controller.settings()
    if (!description.writable) {
      await vscode.window.showWarningMessage('当前 DSH profile 未提供可写的运行时设置。')
      return
    }
    while (true) {
      const selected = await vscode.window.showQuickPick(description.namespaces.map(namespace => ({
        label: `$(settings-gear) ${namespace.ns}`,
        description: hasSettingsOverrides(namespace) ? '已自定义' : '默认',
        detail: `${namespace.applies === 'restart' ? '需重启运行时' : '立即生效'} · ${String(runtimeSettingFields(namespace).length)} 项设置`,
        namespace,
      })), {
        title: 'DeepSeek Harness 运行时设置',
        placeHolder: '选择由 DSH 或运行时插件注册的设置命名空间',
        matchOnDescription: true,
        matchOnDetail: true,
      })
      if (selected === undefined) return
      const changed = await this.configureNamespace(selected.namespace)
      if (!changed) continue
      if (selected.namespace.applies === 'restart') {
        await this.restartAfterChange(`${selected.namespace.ns} 已更新`)
        return
      }
      await vscode.window.showInformationMessage(`${selected.namespace.ns} 已更新。`)
      description = await this.controller.settings()
    }
  }

  private async configureNamespace(namespace: SettingsNamespace): Promise<boolean> {
    if (namespace.applies === 'restart' && !await this.requireIdle()) return false
    const fields = runtimeSettingFields(namespace)
    type FieldPick = vscode.QuickPickItem & (
      | { action: 'field'; field: RuntimeSettingField }
      | { action: 'reset-all' }
    )
    const items: FieldPick[] = fields.map(field => ({
      action: 'field',
      field,
      label: field.path.join('.'),
      description: this.settingSummary(field),
      detail: `${field.overridden ? '已自定义' : '继承'}${field.node.meta?.description === undefined ? '' : ` · ${field.node.meta.description}`}`,
    }))
    if (hasSettingsOverrides(namespace)) {
      items.unshift({
        action: 'reset-all',
        label: '$(discard) 重置全部覆盖',
        description: namespace.ns,
        detail: '改用 DSH 及其插件提供的值',
      })
    }
    const selected = await vscode.window.showQuickPick(items, {
      title: namespace.ns,
      placeHolder: namespace.applies === 'restart' ? '更改会重启 DSH 运行时' : '更改立即生效',
      matchOnDescription: true,
      matchOnDetail: true,
    })
    if (selected === undefined) return false
    if (selected.action === 'reset-all') {
      const resets: SettingsMutation[] = fields
        .filter(field => field.overridden)
        .map(field => ({ op: 'unset', path: field.path }))
      if (resets.length === 0) return false
      await this.controller.mutateSettings(namespace.ns, resets, namespace.revision)
      return true
    }
    const mutation = await this.editSetting(namespace, selected.field)
    if (mutation === undefined) return false
    await this.controller.mutateSettings(namespace.ns, [mutation], namespace.revision)
    return true
  }

  private async editSetting(
    namespace: SettingsNamespace,
    field: RuntimeSettingField,
  ): Promise<SettingsMutation | undefined> {
    if (field.secretSet !== undefined) return this.editSecret(field)
    const options = settingConstantOptions(field, namespace.schema)
    if (options !== undefined) {
      type ValuePick = vscode.QuickPickItem & ({ value: unknown } | { reset: true })
      const choices: ValuePick[] = options.map(value => ({
        label: this.settingValue(value),
        ...(Object.is(value, field.value) ? { description: '当前' } : {}),
        value,
      }))
      const choiceItems: ValuePick[] = [
        ...choices,
        ...(field.overridden ? [{
          label: '$(discard) 使用继承值',
          description: this.settingValue(field.inherited),
          reset: true as const,
        }] : []),
      ]
      const selected = await vscode.window.showQuickPick(choiceItems, {
        title: field.path.join('.'), placeHolder: '选择一个值',
      })
      if (selected === undefined) return undefined
      if ('reset' in selected) return { op: 'unset', path: field.path }
      return { op: 'set', path: field.path, value: selected.value }
    }
    const action = await vscode.window.showQuickPick([
      { label: '$(edit) 修改值', action: 'edit' as const },
      ...(field.overridden ? [{
        label: '$(discard) 使用继承值',
        description: this.settingValue(field.inherited),
        action: 'reset' as const,
      }] : []),
    ], { title: field.path.join('.'), placeHolder: this.settingSummary(field) })
    if (action === undefined) return undefined
    if (action.action === 'reset') return { op: 'unset', path: field.path }
    const input = await vscode.window.showInputBox({
      title: field.path.join('.'),
      prompt: field.node.type === 'string' ? '请输入字符串值。' : '请以 JSON 输入新值。',
      value: field.value === undefined ? '' : field.node.type === 'string' ? String(field.value) : JSON.stringify(field.value),
      ignoreFocusOut: true,
      validateInput: source => {
        try {
          parseRuntimeSetting(field, source)
          return undefined
        } catch (error) {
          return this.message(error)
        }
      },
    })
    if (input === undefined) return undefined
    return { op: 'set', path: field.path, value: parseRuntimeSetting(field, input) }
  }

  private async editSecret(field: RuntimeSettingField): Promise<SettingsMutation | undefined> {
    if (field.secretSet) {
      const action = await vscode.window.showQuickPick([
        { label: '$(key) 替换密钥', action: 'replace' as const },
        { label: '$(trash) 清除密钥', action: 'clear' as const },
      ], { title: field.path.join('.'), placeHolder: 'DSH 不会暴露当前密钥值' })
      if (action === undefined) return undefined
      if (action.action === 'clear') return { op: 'unset', path: field.path }
    }
    const value = await vscode.window.showInputBox({
      title: field.path.join('.'),
      prompt: '请输入密钥。DSH 只会保存它，不会把值返回给本扩展。',
      password: true,
      ignoreFocusOut: true,
      validateInput: source => source.length === 0 ? '密钥不能为空。' : undefined,
    })
    return value === undefined ? undefined : { op: 'set', path: field.path, value }
  }

  private settingSummary(field: RuntimeSettingField): string {
    if (field.secretSet !== undefined) return field.secretSet ? '已配置密钥' : '未设置密钥'
    return this.settingValue(field.value)
  }

  private settingValue(value: unknown): string {
    if (value === undefined) return '未设置'
    if (typeof value === 'string') return value === '' ? '空字符串' : value
    const rendered = JSON.stringify(value)
    return rendered === undefined ? String(value) : rendered.length > 80 ? `${rendered.slice(0, 77)}…` : rendered
  }

  private async requireIdle(): Promise<boolean> {
    if (!this.controller.state.running) return true
    await vscode.window.showWarningMessage('请等待当前 DeepSeek 任务结束，再更改运行时插件。')
    return false
  }

  private async restartAfterChange(successMessage: string): Promise<void> {
    if (this.controller.runtimeOwnership === 'external') {
      await vscode.window.showWarningMessage(
        `${successMessage}。请重启外部 DeepSeek Harness 进程以应用此更改，然后在 VS Code 中重新连接。`,
      )
      return
    }
    await this.controller.restart()
    if (this.controller.state.phase === 'error') {
      throw new Error(`${successMessage}，但 DSH 无法重启：${this.controller.state.statusText}`)
    }
    await vscode.window.showInformationMessage(`${successMessage}。DeepSeek Harness 已重启。`)
  }

  private async runOfficialPluginCommand(args: readonly string[], title: string): Promise<void> {
    const defaultWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri
    const cwd = this.controller.cwd || defaultWorkspace?.fsPath || process.cwd()
    const workspace = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(cwd))?.uri ?? defaultWorkspace
    const config = vscode.workspace.getConfiguration('deepseekHarness', workspace)
    const executable = config.get<string>('executable', '')
    const launch = resolveLaunch(
      this.context.extensionUri.fsPath,
      executable,
      ['plugin', '--profile', 'web', ...args],
      { cwd },
    )
    const rendered = [launch.command, ...launch.args].map(part => JSON.stringify(part)).join(' ')
    this.output.appendLine(`[plugins] cwd: ${cwd}`)
    this.output.appendLine(`[plugins] launch: ${rendered}`)

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: true,
    }, async (_progress, token) => new Promise<void>((resolvePromise, rejectPromise) => {
      let diagnostics = ''
      let cancelled = false
      let settled = false
      const child = spawn(launch.command, launch.args, {
        cwd,
        env: { ...process.env, NO_COLOR: '1', ...launch.env, DSH_HOME: this.dshHome },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
      })
      const append = (chunk: Buffer | string): void => {
        const text = String(chunk)
        this.output.append(text)
        diagnostics = `${diagnostics}${text}`.slice(-16_000)
      }
      child.stdout.on('data', append)
      child.stderr.on('data', append)
      const cancellation = token.onCancellationRequested(() => {
        cancelled = true
        terminateProcessTree(child)
      })
      child.once('error', (error) => {
        if (settled) return
        settled = true
        cancellation.dispose()
        rejectPromise(error)
      })
      child.once('close', (code) => {
        if (settled) return
        settled = true
        cancellation.dispose()
        if (cancelled) {
          rejectPromise(new Error('插件操作已取消。'))
          return
        }
        if (code === 0) {
          resolvePromise()
          return
        }
        if (/pnpm not found|ENOENT.*pnpm/i.test(diagnostics) || code === 127) {
          rejectPromise(new Error('DSH 插件管理需要 PATH 中的 pnpm。请安装或启用 pnpm 后重试。'))
          return
        }
        rejectPromise(new Error(`官方 DSH 插件命令失败，退出码 ${String(code)}。详情请查看 DeepSeek Harness 输出。`))
      })
    }))
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
