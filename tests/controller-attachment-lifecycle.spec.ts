import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'

const source = ts.createSourceFile('extension.ts', readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const controller = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'DshChatController') as ts.ClassDeclaration
const names = ['loadAttachment', 'evictAttachmentResults', 'releaseSessionCaches', 'disconnectClient']
const code = ts.transpileModule('class Probe {' + controller.members.filter(n => ts.isMethodDeclaration(n) && names.includes(n.name.getText(source))).map(n => n.getText(source)).join('\n') + '}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const Probe = new Function(code + ';return Probe;')()
function setup() {
  const calls: Array<{ resolve(value: unknown): void; reject(error: unknown): void; signal?: AbortSignal }> = []
  const client = { attachment: vi.fn((_sid: string, _id: string, signal?: AbortSignal) => new Promise((resolve, reject) => calls.push({ resolve, reject, signal }))), forgetSession: vi.fn(), dispose: vi.fn() }
  const p = new Probe()
  Object.assign(p, { _state: { sessionId: 'b' }, client, generation: 1, originDisplays: new Map(), originLoads: new Map(), attachmentResults: new Map(), attachmentLoads: new Map(), output: { appendLine: vi.fn() }, bumpAttachmentGeneration: vi.fn(), scheduleHydratePublish: vi.fn(), clientDisposables: [] })
  return { p, client, calls }
}
const image = { attachmentId: 'same', mediaType: 'image/png' }
const result = { attachment: image, data: 'A'.repeat(2 * 1024 * 1024) }

it('aborts evicted image requests and ignores late success without disturbing the new same-ID request', async () => {
  const { p, client, calls } = setup()
  const old = p.loadAttachment(client, 'a', image)
  expect(p.loadAttachment(client, 'a', image)).toBe(old)
  p.evictAttachmentResults(new Set(['b']))
  expect(p.attachmentLoads.size).toBe(0)
  expect(calls[0]?.signal?.aborted).toBe(true)
  const replacement = p.loadAttachment(client, 'a', image)
  calls[0]!.resolve(result); await old
  expect(p.attachmentResults.size).toBe(0)
  expect(p.attachmentLoads.size).toBe(1)
  calls[1]!.resolve(result); await replacement
  expect(p.attachmentResults.get('a\0same')).toEqual({ data: result.data })
  expect(p.attachmentLoads.size).toBe(0)
  expect(p.bumpAttachmentGeneration).toHaveBeenCalledTimes(1)
})

it('ignores a canceled late failure and releases all attachment maps on disconnect', async () => {
  const { p, client, calls } = setup()
  const load = p.loadAttachment(client, 'a', image)
  p.attachmentResults.set('b\0ready', { data: result.data })
  p.disconnectClient()
  expect(calls[0]?.signal?.aborted).toBe(true)
  expect(p.attachmentLoads.size + p.attachmentResults.size).toBe(0)
  calls[0]!.reject(Error('late error')); await load
  expect(p.output.appendLine).not.toHaveBeenCalled()
  expect(p.scheduleHydratePublish).not.toHaveBeenCalled()
  expect(client.dispose).toHaveBeenCalledOnce()
})

it('releases only a deleted session across controller caches and pending images', async () => {
  const { p, client, calls } = setup()
  const load = p.loadAttachment(client, 'a', image)
  const maps = ['historyBySession', 'jobsBySession', 'projectionBaselines', 'modelSelections', 'runningStatusRevisions']
  for (const key of maps) p[key] = new Map([['a', { large: result.data }], ['b', { keep: true }]])
  p.attachmentResults.set('a\0ready', { data: result.data }); p.attachmentResults.set('b\0ready', { data: 'keep' })
  p.diffReviews = { releaseSession: vi.fn() }
  p.releaseSessionCaches('a')
  for (const key of maps) expect([...p[key].keys()]).toEqual(['b'])
  expect([...p.attachmentResults.keys()]).toEqual(['b\0ready'])
  expect(p.diffReviews.releaseSession).toHaveBeenCalledWith('a')
  expect(client.forgetSession).toHaveBeenCalledWith('a')
  expect(calls[0]?.signal?.aborted).toBe(true)
  calls[0]!.resolve(result); await load
  expect(p.attachmentResults.has('a\0same')).toBe(false)
})
