import { expect, it } from 'vitest'
import ts from 'typescript'
import { chatHtml } from '../src/webview.js'

const html = chatHtml({ cspSource: 'test' } as any, { toString: () => 'test:/icon' } as any)
const script = ts.createSourceFile('webview.js', html.slice(html.lastIndexOf('<script') + html.slice(html.lastIndexOf('<script')).indexOf('>') + 1, html.lastIndexOf('</script>')), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const functions = new Map<string, string>()
function visit(n: ts.Node) { if (ts.isFunctionDeclaration(n) && n.name) functions.set(n.name.text, n.getText(script)); ts.forEachChild(n, visit) }
visit(script)
const create = new Function('turns', 'outline', 'stars', 'marks', `
  let visits=0, outlineReads=0;
  const renderedSessionId='test', railTurnList=turns, railTurnEls=new Map();
  const state={turnRailSettings:{},get turnOutline(){outlineReads++;return outline}};
  const memo={stars:new Set(stars),marks:new Map(marks)};
  const viewMemoOf=()=>memo, array=v=>Array.isArray(v)?v:[], record=v=>v;
  const railTurnSeqOf=turn=>{visits++;return turn?.seq};
  const railNodesBuilt=turns.map((_,turnIndex)=>({turnIndex,el:{classList:{toggle(){}},dataset:{},setAttribute(){}}}));
  const railNodeIsStop=()=>false,railOrdinalText=()=>'',railSnippetOf=()=>'';
  ${['railMarkKeyOf','railMarkUpperBound','outlineTurnStarts','turnStartOf','railMarkLookup','railHitKey','railStarQuery','railMarkQuery','applyRailMarks'].map(name => functions.get(name) ?? '').join('\n')}
  return {star:railStarQuery,mark:railMarkQuery,apply:applyRailMarks,counts:()=>({visits,outlineReads}),nodes:railNodesBuilt};
`) as (turns: any[], outline: any[], stars: string[], marks: [string, string][]) => any

it('does not scan the outline or other nodes when stars and notes are empty', () => {
  const turns = Array.from({ length: 1200 }, (_, i) => ({ id: 'n' + i, seq: i * 10 + 1, element: {} }))
  const p = create(turns, turns.map(t => ({ seq: t.seq - 1 })), [], [])
  expect(p.star(1199)).toBeUndefined(); expect(p.mark(1199)).toBeUndefined()
  expect(p.counts()).toEqual({ visits: 0, outlineReads: 0 })
})
it('shares one outline/first-node lookup for a dense marked rail instead of rescanning every predecessor', () => {
  const turns = Array.from({ length: 1200 }, (_, i) => ({ id: 'n' + i, seq: i * 10 + 1, element: {} }))
  const p = create(turns, turns.map(t => ({ seq: t.seq - 1 })), ['s10000'], [['s11000', 'note']])
  p.apply()
  expect(p.nodes[1000].el.dataset.tip).toContain('★')
  expect(p.nodes[1100].el.dataset.tip).toBe('✎ note')
  expect(p.counts().outlineReads).toBe(1)
  expect(p.counts().visits).toBeLessThan(1200 * 8)
})
it('keeps prefix intervals, exact segment keys and first-visible-node ownership independent for stars and notes', () => {
  const turns = [{ id: 'prefix', seq: 0, endSeq: 10 }, { id: 'first', seq: 11, element: {} }, { id: 'second', seq: 14, element: {} }, { id: 'next', seq: 21, element: {} }]
  const p = create(turns, [{ seq: 0 }, { seq: 10 }, { seq: 20 }], ['s4', 's10'], [['s14', 'exact']])
  expect(p.star(0)).toBe('s4'); expect(p.star(1)).toBe('s10'); expect(p.star(2)).toBeUndefined()
  expect(p.mark(1)).toBeUndefined(); expect(p.mark(2)).toEqual({ key: 's14', note: 'exact' })
  p.apply()
  expect(p.nodes[1].el.dataset.tip).toContain('★')
  expect(p.nodes[2].el.dataset.tip).toBe('✎ exact')
})
