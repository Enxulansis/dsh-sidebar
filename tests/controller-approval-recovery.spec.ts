import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'

const source = ts.createSourceFile('extension.ts', readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const controller = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'DshChatController') as ts.ClassDeclaration
const method = controller.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(source) === 'fetchSessionHistory')!
const code = ts.transpileModule('class Probe {' + method.getText(source) + '}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const globals = { rememberActiveSession: () => {}, mergeHistoryEntries: (a: unknown[], b: unknown[]) => [...a, ...b],
  unavailableAgentPresetState: () => ({}), contextPanelStateOf: () => ({}), turnOutlineOf: () => [], imageLimitsOf: () => undefined,
  planModeStateOf: () => ({}), planModeWithCommandAvailability: () => ({}) }

it.each(['already-pending', 'arrives-during-load', 'resolved-during-load'])('restores only the selected session live approval: %s', async scenario => {
  const Probe = new Function(...Object.keys(globals), code + '; return Probe')(...Object.values(globals))
  const p = new Probe(), approval = { rpcId: 'rpc-a', approvalId: 'a', toolName: 'pwsh' }
  let pending: typeof approval | null = scenario === 'already-pending' ? approval : null
  const client = {
    history: async () => { pending = scenario === 'resolved-during-load' ? null : approval; return { events: [], hasMore: false } },
    models: async () => ({}), pendingApproval: vi.fn((sid: string) => sid === 'a' ? pending : null),
  }
  Object.assign(p, { client, cwd: 'owned', historyWindowGeneration: 1, _state: { sessionId: 'old', approval: { approvalId: 'old' } },
    historyBySession: new Map(), projector: { reset() {} }, output: { appendLine() {} },
    guardedDirtyCalls: new Set(), queueRawText: new Map(), summaries: [{ sessionId: 'a' }], projectionBaselines: new Map(), jobsBySession: new Map(), questionRpcIds: new Map(),
    requireClient: () => client, historyPullLimit: () => 100,
    publish: (patch: object) => Object.assign(p._state, patch), messagesPatch: () => ({}), modelPatch: () => ({}), diffReviews: { rebuild: () => [] } })
  for (const name of ['rememberVisited', 'replayUsageLedger', 'resetTurnMeta', 'markTurnMeta', 'rememberHistoryWindow', 'applyProjectionBaseline', 'maybeFetchContextDetail', 'syncLearnedTitle', 'clearParkedSubmission', 'usageWithCost', 'contextValuesWithDetail', 'hydrateImages', 'refreshBusyEnterMode', 'loadCommands', 'loadSkills', 'loadAgentPresets', 'loadPermissions']) p[name] = () => undefined
  await p.fetchSessionHistory('a', 1)
  expect(p._state.phase).toBe('ready')
  expect(p._state.approval).toEqual(scenario === 'resolved-during-load' ? null : approval)
  expect(client.pendingApproval).toHaveBeenCalledWith('a')
})
