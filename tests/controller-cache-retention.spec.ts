import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { jobsSnapshotOf } from '../src/jobs.js'

const source = ts.createSourceFile('extension.ts', readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const controller = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'DshChatController') as ts.ClassDeclaration
const names = ['rememberHistoryWindow', 'acceptFrame']
const limit = source.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(source) === 'HISTORY_WINDOW_CACHE_CAP'))!
const code = ts.transpileModule(limit.getText(source) + '\nclass Probe {' + controller.members.filter(n => ts.isMethodDeclaration(n) && names.includes(n.name.getText(source))).map(n => n.getText(source)).join('\n') + '}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const Probe = new Function('jobsSnapshotOf', code + ';return Probe;')(jobsSnapshotOf)

it('keeps the actual controller LRU at four windows through 1000 distinct sessions and refreshes recency', () => {
  const p = new Probe()
  Object.assign(p, { historyEntries: [], historyBySession: new Map() })
  for (let i = 0; i < 1000; i++) {
    p.historyEntries = [{ event: { seq: i } }]
    p.rememberHistoryWindow(`s${i}`, i % 2 === 0)
    expect(p.historyBySession.size).toBeLessThanOrEqual(4)
  }
  expect([...p.historyBySession.keys()]).toEqual(['s996', 's997', 's998', 's999'])
  p.historyEntries = [{ event: { seq: 1000 } }]
  p.rememberHistoryWindow('s996', false)
  p.rememberHistoryWindow('next', true)
  expect([...p.historyBySession.keys()]).toEqual(['s998', 's999', 's996', 'next'])
  expect(p.historyBySession.get('s996')).toEqual({ entries: p.historyEntries, hasMore: false })
})

it('removes drained job snapshots in the actual controller without losing active foreign jobs', () => {
  const p = new Probe(), publish = vi.fn()
  Object.assign(p, { _state: { sessionId: 'current' }, queueRawText: new Map(), jobsBySession: new Map(), publish })
  p.acceptFrame({ channel: 'mux', payload: { type: 'session/jobs', sessionId: 'active', jobs: [{ id: 'keep', kind: 'subagent', label: 'keep', startedAt: 1, status: 'running' }] } })
  for (let i = 0; i < 1000; i++) {
    for (const jobs of [[{ id: `j${i}`, kind: 'subagent', label: 'job', startedAt: 1, status: 'running' }], []]) p.acceptFrame({ channel: 'mux', payload: { type: 'session/jobs', sessionId: `s${i}`, jobs } })
  }
  expect([...p.jobsBySession.keys()]).toEqual(['active'])
  p.acceptFrame({ channel: 'mux', payload: { type: 'session/subscribed', sessionId: 'current' } })
  expect(p.jobsBySession.has('current')).toBe(false)
  expect(publish).toHaveBeenCalledWith({ queue: [], jobs: [] })
})
