import ts from 'typescript'
import { expect, it } from 'vitest'
import { chatHtml } from '../src/webview.js'

const html = chatHtml({ cspSource: 'test' } as any, { toString: () => 'test:/icon' } as any)
const script = ts.createSourceFile('webview.js', html.slice(html.lastIndexOf('<script') + html.slice(html.lastIndexOf('<script')).indexOf('>') + 1, html.lastIndexOf('</script>')), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const functions = new Map<string, string>()
let rebindCode = ''
function visit(n: ts.Node) {
  if (ts.isFunctionDeclaration(n) && n.name) functions.set(n.name.text, n.getText(script))
  if (ts.isIfStatement(n) && n.expression.getText(script) === 'railNavigationLocked' && n.getText(script).includes('resolveRailTurn')) rebindCode = n.getText(script)
  ts.forEachChild(n, visit)
}
visit(script)
if (!rebindCode) throw Error('Production navigation rebind missing')
const create = new Function(`
  const array=v=>Array.isArray(v)?v:[];
  let state={sessionId:'a',turnOutline:[{seq:4},{seq:848},{seq:1200}]},renderedSessionId='a',railListSessionId='a';
  let railTurnList=[],railKey='ready',fresh=[],pendingRailJumpSeq,pendingRailJumpSession,railNavigationLocked,railNavigationSeq,railNavigationId;
  let pendingSearchJump,restoreApplyFrame,railRevealPending,railThumbSmoothFrame,railThumbSmoothTarget,railThumbSmoothUserDriven,railThumbSmoothShown,programmaticScroll,restoreCtx,railStickyIndex,railStickyTarget,railGeomDirty,progressiveFill;
  const elements={turnRailClip:null,turnRailThumb:null,scroll:{scrollTop:0,scrollHeight:10000,clientHeight:500,getBoundingClientRect:()=>({top:0})}};
  const railLayout={y:[]},sent=[],vscode={postMessage:m=>sent.push(m)},viewMemoOf=()=>({}),cancelAnimationFrame=()=>{};
  const clearHistoryJump=()=>{},clearRestoreThroughTarget=()=>{},clearRestoreCtx=()=>{restoreCtx=undefined},railTweenCancel=()=>{},stampRailBadgeIntent=()=>{},cancelRailAnim=()=>{},detachConversationTail=()=>{},markScrollSeen=()=>{},updateRailActive=()=>{},followRailActive=()=>{},railMemoAfterJump=()=>{},captureHistoryAnchorRef=()=>({id:'landed',offset:0});
  const railElementFor=t=>t?.element,effectiveRailElement=e=>e;
  const startHistoryJump=(source,seq)=>sent.push({type:'load-turn',source,seq});
  const railScrollTo=top=>{elements.scroll.scrollTop=top;return top};
  const openRestoreWindow=ctx=>{restoreCtx=ctx},MERGE_SETTLE_WINDOW_MS=2000;
  function updateTurnRail(){railTurnList=fresh;railKey='ready'}
  ${['resolveRailTurn','railJump','tryPendingRailJump'].map(name => functions.get(name) ?? (()=>{throw Error('Missing '+name)})()).join('\n')}
  return {resolve:resolveRailTurn,jump:railJump,finish:tryPendingRailJump,sent,
    setup(old,next=old){railTurnList=old;fresh=next;railKey=next===old?'ready':''},
    switch(){state={...state,sessionId:'b'};renderedSessionId='b';railListSessionId='b'},
    rebind(turns){let navigationRebound=false;${rebindCode};railTurnList=turns;return navigationRebound},
    snapshot(){return{pending:pendingRailJumpSeq,navId:railNavigationId,navSeq:railNavigationSeq,sticky:railStickyIndex,scrollTop:elements.scroll.scrollTop,restore:restoreCtx}}
  };
`)

it('keeps a clicked temporary turn in its own interval after detailed stops insert ahead of it', () => {
  const p=create(), clicked={id:'seq:848',seq:848,endSeq:1200}
  const full=[{id:'s8',seq:8},{id:'s217',seq:217},{id:'s851',seq:851},{id:'s909',seq:909},{id:'s1203',seq:1203}]
  p.setup([{id:'seq:4',seq:4},clicked],full)
  p.jump(clicked,'a')
  expect(p.sent.at(-1)).toEqual({type:'load-turn',source:'rail',seq:851})
  expect(p.snapshot()).toMatchObject({navId:'s851',navSeq:851,pending:851})
})

it('retains a loaded stop identity when its temporary key is replaced', () => {
  const p=create(), element={getBoundingClientRect:()=>({top:100})}
  const clicked={id:'ws:card',seq:909,element}, full={id:'s909',seq:909,element}
  p.setup([clicked],[{id:'s8',seq:8},full])
  p.jump(clicked,'a')
  expect(p.snapshot()).toMatchObject({navId:'s909',navSeq:909,sticky:1,scrollTop:100})
  expect(p.sent.some((m:any)=>m.type==='load-turn')).toBe(false)
})

it('maps a temporary page-leading seq back to its containing detailed segment', () => {
  const p=create(), full=[{id:'s851',seq:851},{id:'s909',seq:909},{id:'s1203',seq:1203}]
  expect(p.resolve({id:'ws~:page',seq:920},full)).toBe(full[1])
  expect(p.resolve({id:'seq:4',seq:4,endSeq:848},full)).toBeUndefined()
  expect(p.resolve({id:'s920',seq:920},full)).toBeUndefined()
})

it('completes an in-flight old-seq request at the rebound detailed target', () => {
  const p=create(), clicked={id:'seq:848',seq:848,endSeq:1200}
  p.setup([clicked]);p.jump(clicked,'a')
  expect(p.snapshot().pending).toBe(848)
  const landed={id:'s851',seq:851,element:{getBoundingClientRect:()=>({top:150})}}
  expect(p.rebind([{id:'s8',seq:8},landed])).toBe(true);p.finish()
  expect(p.snapshot()).toMatchObject({pending:undefined,navId:'s851',sticky:1,scrollTop:150,restore:{anchorSeq:851}})
  expect(p.sent.filter((m:any)=>m.type==='load-turn')).toHaveLength(1)
})

it('ignores a detached button from a different session and a removed final node', () => {
  const p=create(), clicked={id:'seq:848',seq:848}
  p.setup([clicked]);p.switch();p.jump(clicked,'a')
  expect(p.sent).toHaveLength(0)
  const q=create();q.setup([{id:'s909',seq:909}]);q.jump({id:'s851',seq:851},'a')
  expect(q.sent).toHaveLength(0)
})
