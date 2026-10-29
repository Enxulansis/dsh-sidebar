import { describe, expect, it, vi } from 'vitest'
import { ModelConnections, validateConnectionDraft, type ConnectionClient, type ConfigurableProvider } from '../src/model-connections.js'
import type { SettingsDescription, SettingsNamespace } from '../src/runtime-settings.js'

function fixture() {
  const pi: SettingsNamespace = { ns: 'llm-pi-ai', value: { providers: {} }, base: { providers: {} }, user: {}, revision: 0, applies: 'live', secrets: [], schema: { uid: 0, refs: {} } }
  const native: SettingsNamespace = { ...pi, ns: 'llm-deepseek', value: { apiKeyEnv: 'EXTERNAL', apiKey: 'never-expose', headers: { Authorization: 'private' } } }
  const description: SettingsDescription = { writable: true, hasDocument: true, namespaces: [pi, native] }
  const providers: ConfigurableProvider[] = [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] }]
  const credentials = new Map<string, string>(), mutations: unknown[] = []
  const client: ConnectionClient = {
    settings: vi.fn(async () => structuredClone(description)), configurableProviders: vi.fn(async () => structuredClone(providers)),
    describeCredentials: vi.fn(async refs => Object.fromEntries(refs.map(ref => [ref, { configured: true, writable: true, source: 'managed' }]))),
    setCredential: vi.fn(async (ref, value) => { credentials.set(ref, value) }), unsetCredential: vi.fn(async ref => { credentials.delete(ref) }),
    discoverModels: vi.fn(async () => [{ id: 'shared', contextWindow: 10000, maxTokens: 1000 }]),
    mutateSettings: vi.fn(async (ns, ops, revision) => {
      const section = description.namespaces.find(item => item.ns === ns)!
      if (section.revision !== revision) throw new Error('settings-conflict')
      mutations.push({ ns, ops, revision })
      for (const op of ops) {
        let value = section.value as Record<string, unknown>
        for (const part of op.path.slice(0, -1)) { value[part] ??= {}; value = value[part] as Record<string, unknown> }
        const key = op.path.at(-1)!
        if (op.op === 'set') value[key] = op.value; else delete value[key]
        const route = op.path[1]
        if (route && !providers.some(provider => provider.provider === route)) providers.push({ provider: route, displayName: route, settingsNs: ns, settingsPath: ['providers', route], declared: true })
      }
      ++section.revision; return structuredClone(section)
    }),
  }
  return { pi, description, providers, credentials, mutations, client, manager: new ModelConnections(client) }
}
const draft = (revision = 0) => ({ revision, name: 'Gateway', api: 'openai-completions', baseURL: 'http://localhost:1234/v1', models: [{ id: 'shared' }], apiKey: 'mock-key' })

describe('model connection operations', () => {
  it('saves independent routes with equal model IDs, exposing no secret values', async () => {
    const f = fixture(), a = await f.manager.save(draft()), b = await f.manager.save(draft(1))
    expect(a).not.toBe(b)
    const view = await f.manager.describe()
    expect(view.items.map(item => item.provider)).toEqual(['deepseek-official', a, b])
    expect(JSON.stringify(view)).not.toMatch(/mock-key|never-expose|private|EXTERNAL/)
    expect(JSON.stringify(f.mutations)).not.toContain('mock-key'); expect(f.credentials.size).toBe(2)
  })
  it('preserves advanced fields and old credentials when updating a key', async () => {
    const f = fixture(), provider = await f.manager.save(draft()), profile = (f.pi.value as any).providers[provider], old = profile.apiKeyEnv
    profile.timeoutMs = 45000; profile.models[0].input = ['text', 'image']; profile.models[0].reasoningEfforts = { high: 'high' }
    await f.manager.save({ ...draft(1), provider, apiKey: 'replacement-key' })
    expect(profile.timeoutMs).toBe(45000); expect(profile.models[0].input).toEqual(['text', 'image'])
    expect(profile.apiKeyEnv).not.toBe(old); expect(f.credentials.get(old)).toBe('mock-key')
  })
  it('refuses stale revisions before writing a key', async () => {
    const f = fixture(); f.pi.revision = 2
    await expect(f.manager.save(draft())).rejects.toThrow('其他窗口'); expect(f.client.setCredential).not.toHaveBeenCalled()
  })
  it('cleans up only a staged key after a confirmed settings refusal', async () => {
    const f = fixture(); vi.mocked(f.client.mutateSettings).mockRejectedValue(new Error('conflict'))
    await expect(f.manager.save(draft())).rejects.toThrow('conflict'); expect(f.credentials.size).toBe(0)
  })
  it('retains the key when an accepted settings receipt is lost', async () => {
    const f = fixture(), original = f.client.mutateSettings
    f.client.mutateSettings = async (...args) => { await original(...args); throw new Error('network') }
    await expect(f.manager.save(draft())).resolves.toMatch(/^sidebar-/); expect(f.credentials.size).toBe(1)
    expect(f.client.unsetCredential).not.toHaveBeenCalled()
  })
  it('retains staged credentials when both mutation receipt and reread fail', async () => {
    const f = fixture(); vi.mocked(f.client.mutateSettings).mockImplementation(async () => { vi.mocked(f.client.settings).mockRejectedValue(new Error('unreachable')); throw new Error('receipt lost') })
    await expect(f.manager.save(draft())).rejects.toThrow('凭据已保留')
    expect(f.credentials.size).toBe(1); expect(f.client.unsetCredential).not.toHaveBeenCalled()
  })
  it('does not mutate settings after a credential failure', async () => {
    const f = fixture(); vi.mocked(f.client.setCredential).mockRejectedValue(new Error('denied'))
    await expect(f.manager.save(draft())).rejects.toThrow('denied'); expect(f.client.mutateSettings).not.toHaveBeenCalled()
  })
  it('does not commit after its runtime owner changes', async () => {
    const f = fixture(); let current = true
    vi.mocked(f.client.setCredential).mockImplementation(async () => { current = false })
    await expect(new ModelConnections(f.client, () => current).save(draft())).rejects.toThrow('运行时已切换')
    expect(f.client.mutateSettings).not.toHaveBeenCalled()
  })
  it('removes user routes, retaining keys potentially used by in-flight/shared requests', async () => {
    const f = fixture(), provider = await f.manager.save(draft())
    await f.manager.remove(provider, 1); expect((f.pi.value as any).providers[provider]).toBeUndefined(); expect(f.credentials.size).toBe(1)
    await expect(f.manager.remove('deepseek-official', 0)).rejects.toThrow('不能')
  })
  it('does not delete composition profiles through a user overlay', async () => {
    const f = fixture(), provider = await f.manager.save(draft()); (f.pi.base as any).providers[provider] = {}
    expect((await f.manager.describe()).items.find(item => item.provider === provider)?.removable).toBe(false)
    await expect(f.manager.remove(provider, 1)).rejects.toThrow('基础配置')
  })
  it('discovers explicitly and never stores the discovery credential', async () => {
    const f = fixture(); await f.manager.describe(); expect(f.client.discoverModels).not.toHaveBeenCalled()
    await expect(f.manager.discover({ provider: 'openai', api: 'openai-responses', apiKey: 'one-time' })).resolves.toHaveLength(1)
    expect(f.client.setCredential).not.toHaveBeenCalled()
    expect(f.client.discoverModels).toHaveBeenCalledWith('llm-pi-ai', { provider: 'openai', api: 'openai-responses', apiKey: 'one-time' })
  })
  it('allows unauthenticated local endpoints and manual models without discovery', async () => {
    const f = fixture(); expect(await f.manager.save({ ...draft(), apiKey: '' })).toMatch(/^sidebar-/)
    expect(f.client.discoverModels).not.toHaveBeenCalled(); expect(f.client.setCredential).not.toHaveBeenCalled()
  })
  it('updates only the native DeepSeek credential reference', async () => {
    const f = fixture(); await f.manager.save({ ...draft(), provider: 'deepseek-official', models: [] })
    expect(f.mutations).toEqual([{ ns: 'llm-deepseek', revision: 0, ops: [{ op: 'set', path: ['apiKeyEnv'], value: expect.stringMatching(/^DSH_SIDEBAR_/) }] }])
  })
  it.each([{ baseURL: 'https://user:secret@example.invalid/v1' }, { baseURL: 'ftp://host/path' }, { models: [{ id: 'a' }, { id: 'a' }] }, { models: [{ id: 'x', contextWindow: 100, maxTokens: 200 }] }, { api: 'invented' }])('rejects invalid draft %j', changes => {
    expect(() => validateConnectionDraft({ ...draft(), ...changes })).toThrow()
  })
})
