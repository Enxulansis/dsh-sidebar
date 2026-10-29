import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { afterEach, expect, it, vi } from 'vitest'
import { chatHtml } from '../src/webview'

const source = ts.createSourceFile('extension.ts', readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
function host(saved: Record<string, unknown> = {}, update = vi.fn(async (_key: string, _value: unknown) => {})) {
  const names = ['capSessionViewStates', 'writeSessionViewStates', 'forgetSessionViewState', 'sanitizeSessionViewState', 'loadSessionViewStates']
  const funcs = source.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text ?? '')).map(n => n.getText(source)).join('\n')
  const surface = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'DshSurface') as ts.ClassDeclaration
  const methods = surface.members.filter(n => ts.isMethodDeclaration(n) && ['handleSessionViewState', 'flushViewStatesNow', 'persistViewStates'].includes(n.name.getText(source))).map(n => n.getText(source)).join('\n')
  const code = ts.transpileModule(`
    const SESSION_VIEW_STATE_KEY='dshSessionViewStates', SESSION_VIEW_STATE_CAP=32, SESSION_VIEW_STATE_ENTRY_CAP=200, SESSION_VIEW_STATE_ANCHOR_OFFSET_LIMIT=1000000;
    let sharedSessionViewStates, sessionViewStateRevision=0, sessionViewStateWrites=Promise.resolve();
    ${funcs}
    class Surface { viewStates=loadSessionViewStates(); ${methods} }
    return {loadSessionViewStates,forgetSessionViewState,Surface, settled:()=>sessionViewStateWrites,revision:()=>sessionViewStateRevision};
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const removed = vi.fn()
  return { ...new Function('EXT_CONTEXT', 'migrateWorkFoldEntries', 'sessionViewStateRemoved', code)({ workspaceState: { get: () => saved, update } }, () => false, { fire: removed }), update, removed }
}

const html = chatHtml({ cspSource: 'test' } as any, { toString: () => 'test:/icon' } as any)
const script = html.slice(html.lastIndexOf('<script') + html.slice(html.lastIndexOf('<script')).indexOf('>') + 1, html.lastIndexOf('</script>'))
const frontend = ts.createSourceFile('webview.js', script, ts.ScriptTarget.Latest, true)
function browser() {
  const names = ['viewMemoOf', 'trimViewMemo', 'trimViewMemoEntries', 'removeViewMemo', 'scheduleViewStatePersist', 'armJumpPersist']
  const funcs: string[] = []
  function visit(n: ts.Node) { if (ts.isFunctionDeclaration(n) && names.includes(n.name?.text ?? '')) funcs.push(n.getText(frontend)); ts.forEachChild(n, visit) }
  visit(frontend)
  const post = vi.fn(), capture = vi.fn()
  return { ...new Function('vscode', 'captureScrollMemo', `
    const VIEW_MEMO_CAP=32,VIEW_MEMO_ENTRY_CAP=200,viewMemo=new Map(),viewStateSendTimers=new Map();
    let viewStateRevision=0,renderedSessionId='active',state={sessionId:'active'},restoreCtx,restoreThroughTarget,jumpPersistTimer;
    const viewMemoryCfg=()=>({scroll:true}), rememberRailViewport=()=>{},diagLoad=()=>{};
    const clearRestoreCtx=()=>restoreCtx=undefined,clearRestoreThroughTarget=()=>restoreThroughTarget=undefined;
    ${funcs.join('\n')}
    return {viewMemo,viewStateSendTimers,viewMemoOf,removeViewMemo,scheduleViewStatePersist,armJumpPersist,
      setSession:id=>{renderedSessionId=id;state.sessionId=id},revision:()=>viewStateRevision};
  `)({ postMessage: post }, capture), post, capture }
}
afterEach(() => vi.useRealTimers())

it('caps durable hydration by original recency and shares records across surfaces', async () => {
  const saved = Object.fromEntries(Array.from({ length: 80 }, (_, i) => ['s'+i, { at: i, scrollTop: i }]))
  const h = host(saved), a = new h.Surface(), b = new h.Surface()
  expect(a.viewStates).toBe(b.viewStates)
  expect(Object.keys(a.viewStates)).toHaveLength(32)
  expect(a.viewStates.s47).toBeUndefined(); expect(a.viewStates.s79.scrollTop).toBe(79)
  await h.settled()
  expect(Object.keys(h.update.mock.calls.at(-1)?.[1] as object)).toHaveLength(32)
})

it('bounds rapid host updates before debounce and rejects stale deletion reports from either surface', async () => {
  vi.useFakeTimers()
  const h = host({ keep: { at: 1 } }), a = new h.Surface(), b = new h.Surface()
  for (let i = 0; i < 1000; i++) a.handleSessionViewState({ sessionId: 's'+i, revision: 0, scrollTop: i })
  expect(Object.keys(b.viewStates)).toHaveLength(32)
  h.forgetSessionViewState('s999')
  b.handleSessionViewState({ sessionId: 's999', revision: 0, urgent: true })
  a.flushViewStatesNow(); b.flushViewStatesNow()
  await h.settled()
  expect(b.viewStates.s999).toBeUndefined()
  expect((h.update.mock.calls.at(-1)?.[1] as any).s999).toBeUndefined()
  expect(h.removed).toHaveBeenCalledWith({ sessionId: 's999', revision: 1 })
  b.handleSessionViewState({ sessionId: 'new', revision: 1, urgent: true })
  await h.settled(); expect(b.viewStates.new).toBeDefined()
})

it('serializes a pending durable write with purge without resurrecting its snapshot', async () => {
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  const writes: any[] = []
  const update = vi.fn(async (_key: string, value: unknown) => { if (writes.length === 0) { writes.push(value); await gate } else writes.push(value) })
  const h = host({ a: { at: 1 }, keep: { at: 2 } }, update), a = new h.Surface()
  a.flushViewStatesNow(); await Promise.resolve()
  h.forgetSessionViewState('a'); a.flushViewStatesNow(); release()
  await h.settled()
  expect(writes.at(-1)).toHaveProperty('keep'); expect(writes.at(-1)).not.toHaveProperty('a')
})

it('front-end LRU retains the active session, flushes pending evictions, and bounds 1000 visits', () => {
  vi.useFakeTimers(); const b = browser()
  b.viewMemoOf('active')
  for (let i = 0; i < 1000; i++) { b.viewMemoOf('s'+i).scrollTop=i; b.scheduleViewStatePersist('s'+i, 'scroll') }
  expect(b.viewMemo.size).toBe(32); expect(b.viewMemo.has('active')).toBe(true)
  expect(b.viewStateSendTimers.size).toBe(31)
  expect(b.post.mock.calls[0]?.[0]).toMatchObject({ sessionId:'s0',scrollTop:0,urgent:true,revision:0 })
  b.viewMemoOf('s969'); b.viewMemoOf('extra'); expect(b.viewMemo.has('s969')).toBe(true); expect(b.viewMemo.has('s970')).toBe(false)
})

it('deletion cancels old scroll/jump callbacks while retaining unrelated pending reports', () => {
  vi.useFakeTimers(); const b = browser()
  b.setSession('a'); b.viewMemoOf('a'); b.viewMemoOf('keep').scrollTop=44
  b.scheduleViewStatePersist('a', 'scroll'); b.scheduleViewStatePersist('keep', 'scroll'); b.armJumpPersist()
  b.removeViewMemo('a', 1); vi.runAllTimers()
  expect(b.viewMemo.has('a')).toBe(false); expect(b.capture).not.toHaveBeenCalled()
  expect(b.post.mock.calls.map((c: any[]) => c[0])).toEqual([expect.objectContaining({ sessionId:'keep',scrollTop:44,revision:1 })])
})

it('a settled jump from the previous session cannot overwrite it with the new DOM position', () => {
  vi.useFakeTimers(); const b = browser()
  b.armJumpPersist(); b.setSession('next'); vi.runAllTimers()
  expect(b.capture).not.toHaveBeenCalled(); expect(b.post).not.toHaveBeenCalled()
})

it('deleting another session preserves an active jump report under the new revision', () => {
  vi.useFakeTimers();const b=browser(); b.viewMemoOf('active');b.viewMemoOf('deleted');b.armJumpPersist()
  b.removeViewMemo('deleted',1);vi.runAllTimers()
  expect(b.capture).toHaveBeenCalledWith('active',true)
  expect(b.post).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({sessionId:'active',revision:1,urgent:true}))
})

it('bounds each frontend collection before reporting, with the same host entry capacity', () => {
  const b=browser(), memo=b.viewMemoOf('active')
  for (let i=0;i<1000;i++) for(const field of ['expanded','folds','blocks','marks','stars','railDropped']) {
    if(memo[field] instanceof Set) memo[field].add('k'+i)
    else memo[field].set('k'+i,field==='marks'?'note':'folded')
  }
  b.scheduleViewStatePersist('active','capacity',true)
  for(const field of ['expanded','folds','blocks','marks','stars','railDropped']) expect(memo[field].size).toBe(200)
  expect(b.post.mock.calls[0]?.[0].expanded).toHaveLength(200)
})

it('keeps a ready early restore target while hidden or while the old session DOM is displayed', () => {
  let fn: ts.FunctionDeclaration | undefined
  function visit(n:ts.Node) { if(ts.isFunctionDeclaration(n)&&n.name?.text==='tryRestoreThroughReady')fn=n;ts.forEachChild(n,visit) }
  visit(frontend); expect(fn).toBeDefined()
  const open=vi.fn(),clear=vi.fn()
  const p=new Function('openRestoreWindow','clearRestoreThroughTarget',`
    let restoreThroughTarget={sessionId:'a',anchorId:'target',anchorSeq:10,anchorOffset:7,ready:true},state={sessionId:'a'},renderedSessionId='a',hidden=true,railRevealPending=false;
    const viewportDegenerate=()=>hidden,elements={scroll:{scrollTop:0},messages:{children:[{dataset:{mid:'target'}}]}},scheduleViewRestore=()=>{};
    ${fn!.getText(frontend)}
    return {run:tryRestoreThroughReady,show:()=>hidden=false,switchDOM:id=>renderedSessionId=id};
  `)(open,clear)
  p.run(); expect(clear).not.toHaveBeenCalled(); p.show();p.switchDOM('old');p.run();expect(clear).not.toHaveBeenCalled()
  p.switchDOM('a');p.run();expect(clear).toHaveBeenCalledTimes(1)
  expect(open).toHaveBeenCalledWith(expect.objectContaining({anchorId:'target',anchorOffset:7,kind:'restore-through'}))
})

it('reveal resize preserves an explicit saved target instead of substituting the old tail anchor', () => {
  let fn:ts.FunctionDeclaration|undefined
  function visit(n:ts.Node) { if(ts.isFunctionDeclaration(n)&&n.name?.text==='beginResizeAnchor')fn=n;ts.forEachChild(n,visit) }
  visit(frontend);expect(fn).toBeDefined()
  const open=vi.fn(),clear=vi.fn()
  const p=new Function('openRestoreWindow','clearRestoreCtx',`
    const state={sessionId:'a'},elements={scroll:{scrollTop:200}},viewFocusAnchor={id:'tail',offset:0},RESIZE_ANCHOR_WINDOW_MS=900,scheduleViewRestore=()=>{};
    let hidden=false,followConversationTail=false,restoreCtx={kind:'restore-through',userTouched:false}; const viewportDegenerate=()=>hidden;
    ${fn!.getText(frontend)}
    return {run:beginResizeAnchor,settled:()=>restoreCtx=undefined,hide:()=>hidden=true};
  `)(open,clear)
  p.run(); expect(open).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled()
  p.settled();p.run();expect(open).toHaveBeenCalledWith(expect.objectContaining({anchorId:'tail',resize:true}))
  open.mockClear();p.hide();p.run();expect(open).not.toHaveBeenCalled()
})

it('does not overwrite a saved anchor with the tail page while restoration is still active', () => {
  let fn:ts.FunctionDeclaration|undefined
  function visit(n:ts.Node){if(ts.isFunctionDeclaration(n)&&n.name?.text==='captureScrollMemo')fn=n;ts.forEachChild(n,visit)}
  visit(frontend);expect(fn).toBeDefined()
  const memo={scrollTop:1200,atBottom:false,anchorId:'early',anchorOffset:7,anchorSeq:104}
  const p=new Function('memo',`
    let restoreCtx={sessionId:'a',kind:'switch',userTouched:false},restoreThroughTarget,renderedSessionId='a'; const viewMemo=new Map([['a',memo]]);
    const viewportDegenerate=()=>false,viewMemoWritableNow=()=>true,viewMemoOf=()=>memo,elements={scroll:{scrollTop:1}},conversationNearBottom=()=>false,captureViewAnchor=()=>({id:'tail',offset:44,seq:2620,index:0}),messageIndexOfAnchorMid=()=>0;
    ${fn!.getText(frontend)}
    return {run:()=>captureScrollMemo('a',true),settle:()=>restoreCtx=undefined};
  `)(memo)
  p.run();expect(memo.anchorId).toBe('early');expect(memo.anchorSeq).toBe(104)
  p.settle();p.run();expect(memo.anchorId).toBe('tail');expect(memo.scrollTop).toBe(1)
})

it('persists the settled restoration immediately, so another Reload keeps the same early anchor', () => {
  vi.useFakeTimers();let fn:ts.FunctionDeclaration|undefined
  function visit(n:ts.Node){if(ts.isFunctionDeclaration(n)&&n.name?.text==='armRestoreWindowWatch')fn=n;ts.forEachChild(n,visit)}
  visit(frontend);expect(fn).toBeDefined();const send=vi.fn()
  const p=new Function('scheduleViewStatePersist',`
    let restoreCtxTimer,restoreCtx={sessionId:'a',kind:'restore-through',deadline:Date.now()+50,userTouched:false},renderedSessionId='a';
    const restoreWindowOver=()=>true,applyViewRestoreNow=()=>{},clearRestoreCtx=()=>restoreCtx=undefined,refreshViewFocusAnchor=()=>{};
    ${fn!.getText(frontend)}
    return {run:armRestoreWindowWatch};
  `)(send)
  p.run();vi.runAllTimers();expect(send).toHaveBeenCalledExactlyOnceWith('a','restore-settle',true)
})

it('loading and an in-flight page cannot clamp or consume the saved restoration target', () => {
  let fn:ts.FunctionDeclaration|undefined
  function visit(n:ts.Node){if(ts.isFunctionDeclaration(n)&&n.name?.text==='applyViewRestoreNow')fn=n;ts.forEachChild(n,visit)}
  visit(frontend);expect(fn).toBeDefined()
  const run=new Function('phase','loadingHistory',`
    const restoreCtx={sessionId:'a',anchorId:'early',anchorSeq:104},state={sessionId:'a',phase,loadingHistory};
    const restoreWindowOver=()=>false,viewportDegenerate=()=>false;
    ${fn!.getText(frontend)}
    applyViewRestoreNow();return restoreCtx;
  `)
  expect(run('loading',false).anchorSeq).toBe(104)
  expect(run('ready',true).anchorSeq).toBe(104)
})

it('layout scroll preserves the saved target, while native input and ordinary resize still yield to the user', () => {
  let block:ts.IfStatement|undefined
  function visit(n:ts.Node){if(ts.isIfStatement(n)&&n.expression.getText(frontend)==='!ownScroll && !echo && restoreCtx && !restoreCtx.userTouched')block=n;ts.forEachChild(n,visit)}
  visit(frontend);expect(block).toBeDefined()
  const run=new Function('kind','nativeScroll','intent',`
    const ownScroll=false,echo=false,restoreCtx={kind,userTouched:false},elements={scroll:{scrollTop:1,scrollHeight:50000,clientHeight:500}},railBadgeScrollIntent=()=>intent;
    ${block!.getText(frontend)}
    return restoreCtx.userTouched;
  `)
  for(const kind of ['switch','restore-through','view-cfg-rebuild']) {
    expect(run(kind,false,false)).toBe(false)
    expect(run(kind,true,false)).toBe(true)
    expect(run(kind,false,true)).toBe(true)
  }
  expect(run('resize',false,false)).toBe(true)
})

it('an expired cold-load window still requests an early anchor outside the loaded page', () => {
  const funcs:string[]=[]
  function visit(n:ts.Node){if(ts.isFunctionDeclaration(n)&&['restoreAnchorInPlace','restoreWindowOver'].includes(n.name?.text??''))funcs.push(n.getText(frontend));ts.forEachChild(n,visit)}
  visit(frontend);expect(funcs).toHaveLength(2)
  const extend=vi.fn()
  const p=new Function('extendRestoreWindow',`
    const viewportDegenerate=()=>false,state={sessionId:'a',phase:'ready',messages:[{}]},elements={messages:{children:[{dataset:{mid:'tail'}}],childElementCount:1}};
    let floor=2620;const firstLoadedSeq=()=>floor;
    ${funcs.join('\n')}
    return {run:()=>restoreWindowOver({sessionId:'a',kind:'switch',anchorId:'early',anchorSeq:104,deadline:Date.now()-10000,userTouched:false}),covered:()=>floor=1};
  `)(extend)
  expect(p.run()).toBe(false);expect(extend).toHaveBeenCalledOnce()
  p.covered();expect(p.run()).toBe(true)
})
