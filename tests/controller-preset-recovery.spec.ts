import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { agentPresetStateOf } from '../src/agent-presets.js'

const source = ts.createSourceFile('extension.ts', readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const controller = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'DshChatController') as ts.ClassDeclaration
const method = controller.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(source) === 'loadAgentPresets')!
const code = ts.transpileModule('class Probe {' + method.getText(source) + '}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

it.each(['router-standard', 'router-spec'])('restores %s from the actual RC4 projection without selected-event replay', async preset => {
  const Probe = new Function('agentPresetStateOf', code + '; return Probe')(agentPresetStateOf)
  const p = new Probe()
  const roster = { presets: [{ id: 'standard', isDefault: true }, { id: 'router-standard' }, { id: 'router-spec' }] }
  Object.assign(p, { client: { listAgentPresets: async () => roster }, _state: { sessionId: 'a' },
    summaries: [{ sessionId: 'a', blank: false, projections: { asOfSeq: 45, values: { agentPreset: preset } } }],
    publish: vi.fn(), output: { appendLine: vi.fn() } })
  await p.loadAgentPresets(p.client, 'a')
  expect(p.publish).toHaveBeenCalledWith({ agentPreset: expect.objectContaining({ current: preset, locked: true }) })
  expect(p.output.appendLine).not.toHaveBeenCalled()
})
