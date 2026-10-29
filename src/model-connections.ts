import { randomUUID } from 'node:crypto'
import type { SettingsDescription, SettingsMutation, SettingsNamespace } from './runtime-settings.js'

/** Only our own validation messages are safe to display; upstream errors may contain secrets. */
export class ConnectionError extends Error {}

export interface ConfigurableProvider {
  provider: string; displayName: string; settingsNs: string; settingsPath: string[]; declared?: boolean; error?: string
}
export interface DiscoveredModel { id: string; name?: string; contextWindow?: number; maxTokens?: number }
export interface CredentialInfo { configured: boolean; source?: string; writable: boolean }
export interface ModelDiscoveryRequest { provider?: string; baseURL?: string; api?: string; apiKey?: string }
export interface ConnectionClient {
  settings(): Promise<SettingsDescription>
  configurableProviders(): Promise<ConfigurableProvider[]>
  describeCredentials(refs: string[]): Promise<Record<string, CredentialInfo>>
  setCredential(ref: string, value: string): Promise<void>
  unsetCredential(ref: string): Promise<void>
  mutateSettings(ns: string, ops: SettingsMutation[], revision: number): Promise<SettingsNamespace>
  discoverModels(ns: string, request: ModelDiscoveryRequest): Promise<DiscoveredModel[]>
}
export interface ConnectionView {
  provider: string; name: string; ns: string; revision: number; native: boolean; removable: boolean
  baseURL: string; api: string; models: DiscoveredModel[]; credential?: CredentialInfo; error?: string
}
export interface ConnectionsView { writable: boolean; canAdd: boolean; revision?: number; items: ConnectionView[] }
export interface ConnectionDraft {
  provider?: string; revision: number; name: string; baseURL: string; api: string
  models: DiscoveredModel[]; apiKey?: string
}
const APIs = new Set(['openai-completions', 'openai-responses', 'anthropic-messages'])
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const at = (value: unknown, path: readonly string[]): Record<string, unknown> => path.reduce<unknown>((part, key) => object(part)[key], value) as Record<string, unknown> ?? {}
const text = (value: unknown): string => typeof value === 'string' ? value : ''

export function validateConnectionDraft(value: unknown): ConnectionDraft {
  const raw = object(value)
  if (!Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0) throw new ConnectionError('请刷新连接列表后重试。')
  const name = text(raw.name).trim(), baseURL = text(raw.baseURL).trim(), api = text(raw.api)
  if (name.length === 0 || name.length > 100) throw new ConnectionError('连接名称须为 1–100 个字符。')
  if (baseURL !== '') {
    let url: URL
    try { url = new URL(baseURL) } catch { throw new ConnectionError('请输入完整的 HTTP(S) 接口地址。') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new ConnectionError('接口地址须为 HTTP(S)，不能包含凭据、查询参数或片段。')
  }
  if (api !== '' && !APIs.has(api)) throw new ConnectionError('请选择支持的接口协议。')
  const ids = new Set<string>()
  if (!Array.isArray(raw.models) || raw.models.length > 500) throw new ConnectionError('模型列表最多可填写 500 项。')
  const models = raw.models.map(value => {
    const item = object(value), id = text(item.id).trim()
    if (!id || id.length > 200 || /[\s\x00-\x1f]/.test(id) || ids.has(id)) throw new ConnectionError('模型 ID 不能为空、重复或包含空白。')
    ids.add(id)
    const model: DiscoveredModel = { id }
    if (text(item.name).trim()) model.name = text(item.name).trim().slice(0, 200)
    for (const field of ['contextWindow', 'maxTokens'] as const) {
      if (item[field] === undefined) continue
      if (!Number.isSafeInteger(item[field]) || Number(item[field]) <= 0) throw new ConnectionError('模型容量必须为正整数。')
      model[field] = Number(item[field])
    }
    if (model.contextWindow && model.maxTokens && model.maxTokens > model.contextWindow) throw new ConnectionError('输出上限不能超过上下文容量。')
    return model
  })
  const apiKey = text(raw.apiKey).trim()
  if (apiKey && (!/^[\x21-\x7e]+$/.test(apiKey) || apiKey.length > 8192)) throw new ConnectionError('密钥含无效字符或过长。')
  const provider = text(raw.provider)
  if (provider && (!/^[a-zA-Z0-9_.-]+$/.test(provider) || ['__proto__', 'constructor', 'prototype'].includes(provider))) throw new ConnectionError('连接标识无效。')
  return { ...(provider ? { provider } : {}), revision: Number(raw.revision), name, baseURL, api, models, ...(apiKey ? { apiKey } : {}) }
}

/** Runtime is the source of truth. Only credential status and editable profile fields cross into the webview. */
export class ModelConnections {
  constructor(private readonly client: ConnectionClient, private readonly current: () => boolean = () => true) {}
  private assertCurrent(): void { if (!this.current()) throw new ConnectionError('运行时已切换，请刷新连接列表。') }
  private async snapshot(): Promise<{ description: SettingsDescription; providers: ConfigurableProvider[] }> {
    this.assertCurrent()
    const [description, providers] = await Promise.all([this.client.settings(), this.client.configurableProviders()])
    this.assertCurrent()
    return { description, providers }
  }
  async describe(): Promise<ConnectionsView> {
    const { description, providers } = await this.snapshot()
    const pi = description.namespaces.find(ns => ns.ns === 'llm-pi-ai')
    const items: ConnectionView[] = [], refs: string[] = []
    for (const provider of providers) {
      if (!['llm-deepseek', 'llm-pi-ai'].includes(provider.settingsNs)) continue
      const namespace = description.namespaces.find(ns => ns.ns === provider.settingsNs)
      if (!namespace) continue
      const profile = object(at(namespace.value, provider.settingsPath))
      // An unconfigured built-in catalog entry is offered by discovery, not a saved connection.
      if (provider.settingsNs === 'llm-pi-ai' && !Object.hasOwn(object(object(namespace.value).providers), provider.provider)) continue
      const ref = text(profile.apiKeyEnv)
      refs.push(ref)
      items.push({
        provider: provider.provider, name: text(profile.displayName) || provider.displayName,
        ns: namespace.ns, revision: namespace.revision, native: namespace.ns === 'llm-deepseek',
        removable: namespace.ns === 'llm-pi-ai' && !Object.hasOwn(object(object(namespace.base).providers), provider.provider),
        baseURL: text(profile.baseURL), api: text(profile.api),
        models: Array.isArray(profile.models) ? profile.models.map(value => { const model = object(value); return { id: text(model.id), ...(text(model.name) ? { name: text(model.name) } : {}), ...(typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {}), ...(typeof model.maxTokens === 'number' ? { maxTokens: model.maxTokens } : {}) } }).filter(model => model.id) : [],
        ...(provider.error ? { error: '此连接配置异常，请检查接口和模型设置。' } : {}),
      })
    }
    // Credentials service limits describe to 64 refs; batch without ever asking for values.
    const status: Record<string, CredentialInfo> = {}
    const unique = [...new Set(refs.filter(Boolean))]
    for (let index = 0; index < unique.length; index += 64) Object.assign(status, await this.client.describeCredentials(unique.slice(index, index + 64)))
    this.assertCurrent()
    items.forEach((item, index) => { const ref = refs[index], info = ref ? status[ref] : undefined; if (info) item.credential = info })
    return { writable: description.writable, canAdd: description.writable && Boolean(pi), ...(pi ? { revision: pi.revision } : {}), items }
  }
  async save(value: unknown): Promise<string> {
    const draft = validateConnectionDraft(value)
    const { description, providers } = await this.snapshot()
    if (!description.writable) throw new ConnectionError('当前运行时的设置不可写。')
    const existing = draft.provider ? providers.find(item => item.provider === draft.provider) : undefined
    if (draft.provider && !existing) throw new ConnectionError('连接已变化，请刷新列表。')
    const ns = existing?.settingsNs ?? 'llm-pi-ai'
    if (!['llm-pi-ai', 'llm-deepseek'].includes(ns)) throw new ConnectionError('此连接由其他适配器管理。')
    const namespace = description.namespaces.find(item => item.ns === ns)
    if (!namespace || namespace.revision !== draft.revision) throw new ConnectionError('配置已被其他窗口修改，请刷新列表后重试；草稿已保留。')
    const native = ns === 'llm-deepseek'
    if (!native && !existing && (!draft.baseURL || !draft.api || !draft.models.length)) throw new ConnectionError('新连接需要接口地址、协议和至少一个模型 ID。')
    if (!native && existing?.declared === true && (!draft.baseURL || !draft.api || !draft.models.length)) throw new ConnectionError('自定义连接需要接口地址、协议和至少一个模型 ID。')
    const provider = draft.provider ?? 'sidebar-' + randomUUID()
    const path = existing?.settingsPath ?? ['providers', provider]
    const profile = object(at(namespace.value, path))
    const ops: SettingsMutation[] = []
    if (!native) {
      ops.push({ op: 'set', path: [...path, 'displayName'], value: draft.name })
      for (const field of ['baseURL', 'api'] as const) ops.push(draft[field] ? { op: 'set', path: [...path, field], value: draft[field] } : { op: 'unset', path: [...path, field] })
      const oldModels = Array.isArray(profile.models) ? profile.models : []
      ops.push(draft.models.length ? { op: 'set', path: [...path, 'models'], value: draft.models.map(model => ({ ...object(oldModels.find(item => object(item).id === model.id)), ...model })) } : { op: 'unset', path: [...path, 'models'] })
    } else if (!draft.apiKey) throw new ConnectionError('请填写新的 DeepSeek 密钥。原生连接的其他配置请在 DSH 配置中修改。')
    let stagedRef: string | undefined
    if (draft.apiKey) {
      stagedRef = 'DSH_SIDEBAR_' + randomUUID().replace(/-/g, '').toUpperCase() + '_API_KEY'
      await this.client.setCredential(stagedRef, draft.apiKey)
      ops.push({ op: 'set', path: [...path, 'apiKeyEnv'], value: stagedRef })
    }
    try {
      this.assertCurrent()
      await this.client.mutateSettings(ns, ops, draft.revision)
    } catch (error) {
      // A definitive refusal leaves the staged ref unreferenced. On uncertain transport failure,
      // re-read before cleanup so an accepted settings mutation cannot lose its credential.
      if (stagedRef) {
        try {
          const latest = await this.client.settings()
          const view = latest.namespaces.find(item => item.ns === ns)
          if (view && text(object(at(view.value, path)).apiKeyEnv) === stagedRef) return provider
          if (view) await this.client.unsetCredential(stagedRef)
          else throw new ConnectionError('保存结果尚未确认，请刷新连接列表；新凭据已保留。')
        } catch { throw new ConnectionError('保存结果尚未确认，请刷新连接列表；新凭据已保留。') }
      }
      throw error
    }
    return provider
  }
  async remove(provider: string, revision: number): Promise<void> {
    const { description, providers } = await this.snapshot()
    const entry = providers.find(item => item.provider === provider)
    const namespace = description.namespaces.find(item => item.ns === entry?.settingsNs)
    if (!description.writable || entry?.settingsNs !== 'llm-pi-ai' || !namespace) throw new ConnectionError('此连接不能在这里移除。')
    if (Object.hasOwn(object(object(namespace.base).providers), provider)) throw new ConnectionError('此连接来自运行时基础配置，不能从用户设置中移除。')
    if (namespace.revision !== revision) throw new ConnectionError('配置已被其他窗口修改，请刷新连接列表后重试。')
    await this.client.mutateSettings(namespace.ns, [{ op: 'unset', path: entry.settingsPath }], revision)
    // Old refs can still belong to in-flight requests or shared profiles; never erase them here.
  }
  async discover(value: unknown): Promise<DiscoveredModel[]> {
    const draft = object(value), provider = text(draft.provider), api = text(draft.api), baseURL = text(draft.baseURL)
    if (api && !APIs.has(api)) throw new ConnectionError('请选择支持的接口协议。')
    if (baseURL) validateConnectionDraft({ revision: 0, name: '发现', baseURL, api, models: [] })
    const result = await this.client.discoverModels('llm-pi-ai', { ...(provider ? { provider } : {}), ...(baseURL ? { baseURL } : {}), ...(api ? { api } : {}), ...(text(draft.apiKey) ? { apiKey: text(draft.apiKey) } : {}) })
    this.assertCurrent()
    return result
  }
}
