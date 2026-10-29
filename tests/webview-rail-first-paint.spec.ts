import ts from 'typescript'
import { it, expect } from 'vitest'
import { chatHtml } from '../src/webview.js'

const html = chatHtml({ cspSource: 'test' } as any, { toString: () => 'test:/icon' } as any)
const source = ts.createSourceFile('webview.js', html.slice(html.lastIndexOf('<script') + html.slice(html.lastIndexOf('<script')).indexOf('>') + 1, html.lastIndexOf('</script>')), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const functions = new Map<string, string>()
function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(source)); ts.forEachChild(node, visit) }
visit(source)
function setup() {
  return new Function(`
    let table, railPreparationFailedFor='', railKey='old', railListSessionId='old', railTurnList=[{}],railNodesBuilt=[{}],railEls=new Map(),railTurnEls=new Map(),railTops=[0],railActiveNode=0,railGeomDirty=false,railBadgeHovering=false;
    const classes=new Set(),attrs={},button={setAttribute:(k,v)=>button[k]=v},removed=[],scroll=[];
    const elements={turnRail:{classList:{toggle:(k,v)=>v?classes.add(k):classes.delete(k),remove:k=>classes.delete(k)},setAttribute:(k,v)=>attrs[k]=v},turnRailPrepare:button,turnRailClip:{querySelectorAll:()=>[{remove:()=>removed.push(true)}]}};
    const currentRailTable=()=>table,setScrollbarHidden=v=>scroll.push(v),hideRailBadge=()=>{},hideRailTip=()=>{},railTweenCancel=()=>{};
    ${['railFirstPaintPending','syncRailFirstPaint'].map(name => functions.get(name)).join('\n')}
    return {pending:railFirstPaintPending,sync:syncRailFirstPaint,table:v=>table=v,fail:id=>railPreparationFailedFor=id,classes,attrs,button,removed,scroll,list:()=>railTurnList};
  `)()
}
const paged = { phase: 'ready', sessionId: 'a', hasMoreHistory: true, turnRailSettings: { granularity: 'segment' } }
it('withholds incomplete segment nodes while keeping the body native-scrollable without geometry reads', () => {
  const p = setup(); expect(p.sync(paged)).toBe(true)
  expect(p.list()).toEqual([]); expect(p.removed).toHaveLength(1); expect(p.scroll).toEqual([false])
  expect(p.classes.has('preparing')).toBe(true); expect(p.attrs['aria-busy']).toBe('true'); expect(p.button.disabled).toBe(true)
})
it('allows complete tables, unpaged bodies, turn navigation and native scrolling immediately', () => {
  const p = setup()
  expect(p.pending({ ...paged, hasMoreHistory: false })).toBe(false)
  expect(p.pending({ ...paged, turnRailSettings: { granularity: 'turn' } })).toBe(false)
  expect(p.pending({ ...paged, turnRailSettings: { scrollbar: 'native' } })).toBe(false)
  p.table({ segment: [], turn: [] }); expect(p.sync(paged)).toBe(false); expect(p.classes.has('preparing')).toBe(false)
})
it('ends the busy indicator on failure and offers an explicit retry without hiding readable history', () => {
  const p = setup(); p.fail('a'); expect(p.sync(paged)).toBe(true)
  expect(p.attrs['aria-busy']).toBe('false'); expect(p.button.disabled).toBe(false); expect(p.button.textContent).toBe('↻')
  p.fail('b'); p.sync(paged); expect(p.button.disabled).toBe(true)
})
