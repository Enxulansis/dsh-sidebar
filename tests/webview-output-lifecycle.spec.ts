import ts from 'typescript'
import { afterEach, expect, it, vi } from 'vitest'
import { chatHtml } from '../src/webview.js'

const html = chatHtml({ cspSource: 'test' } as any, { toString: () => 'test:/icon' } as any)
const script = ts.createSourceFile('webview.js', html.slice(html.lastIndexOf('<script') + html.slice(html.lastIndexOf('<script')).indexOf('>') + 1, html.lastIndexOf('</script>')), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const functions = new Map<string, string>()
let switchCode = '', replyCode = ''
function visit(n: ts.Node) {
  if (ts.isFunctionDeclaration(n) && n.name) functions.set(n.name.text, n.getText(script))
  if (ts.isIfStatement(n) && n.expression.getText(script) === 'renderedSessionId !== current.sessionId') switchCode = n.getText(script)
  if (ts.isIfStatement(n) && n.expression.getText(script).startsWith("event.data.type === 'tool-output'")) replyCode = n.getText(script)
  ts.forEachChild(n, visit)
}
visit(script)
if (!switchCode || !replyCode) throw Error('Production switch/output handler missing')
const create = new Function(`
 const sessionDomCache=new Map(),SESSION_DOM_CACHE_MAX=2,SESSION_DOM_SKIP_NODES=90000;
 let state,toolOutputRequestId=0,lazyBodies=new Map(),lazyToolCards=new Map(),renderedMessages=new Map(),renderedSessionId,pendingSessionDom;
 let renderedDomSignature='',renderedDomMessageCount=0,renderedViewCfgKey='',workFoldSignatureCache='',lastWorkSegments=[];
 let railRevealPending,railViewportRestored,railNavigationLocked,railNavigationSeq,pendingRailJumpSeq,pendingRailJumpSession,followConversationTail,expandedToolIds,renderedHistoryKey,renderedTail,lastEchoAnchorId;
 const renderFailedIds=new Set(),loadingToolRequests=new Map(),toolOutputErrors=new Map(),toolOutputPages=new Map(),deferredOutputViews=new Map(),pendingMessageAppends=new Map(),claimedEchoIds=new Set();
 const cfg={scroll:false,expand:false,fold:false},viewMemoryCfg=()=>cfg,viewMemoOf=()=>({atBottom:true}),scheduleViewStatePersist=()=>{},captureScrollMemo=()=>{},clearRestoreThroughTarget=()=>{},startViewRestore=()=>{},invalidateWorkFoldCache=()=>{},viewCfgKeyOf=()=>'',array=v=>Array.isArray(v)?v:[];
 function node(tag,cls,text){return {tag,text,childNodes:[],listeners:{},append(...n){this.childNodes.push(...n)},replaceChildren(...n){this.childNodes=n},querySelector(){return null},querySelectorAll(){return this.childNodes},addEventListener(e,fn){this.listeners[e]=fn},click(){this.listeners.click()}}}
 const document={createElement:node},elements={messages:node('div')},sent=[],vscode={postMessage:m=>sent.push(m)};
 ${['viewMemoryKeyNow','messageIdDigest','stashSessionDom','restoreSessionDom','pruneSessionDom','cancelDeferredRequest','resetDeferredOutput','prepareDeferredOutput','appendDeferredPage','attachDeferredOutput'].map(name => functions.get(name) ?? (() => { throw Error('Missing ' + name) })()).join('\n')}
 return {
 switch(current){current={phase:'ready',...current};state=current;pruneSessionDom(current.sessions);${switchCode}},
 render(message){const parent=node('section');elements.messages.replaceChildren(parent);renderedMessages.set(message.id,{message,node:parent});renderedDomSignature=messageIdDigest([message]);renderedDomMessageCount=1;attachDeferredOutput(message,parent,p=>node('div','',p.text),false);return parent},
 reply(data){const event={data};${replyCode}},sent,reset:resetDeferredOutput,
 counts(){return {requests:loadingToolRequests.size,pages:toolOutputPages.size,controllers:deferredOutputViews.size,cached:sessionDomCache.size}},
 };
`)
afterEach(() => vi.useRealTimers())

it('continues cached large output when a background completion appends a message while away', () => {
  vi.useFakeTimers()
  const p = create(), message = { id: 'same', deferredBodyRevision: 'r1' }, sessions = [{ id: 'a' }, { id: 'b' }]
  p.switch({ sessionId: 'a', messages: [message], sessions })
  const parent = p.render(message)
  parent.childNodes[1].childNodes[0].click()
  const first = p.sent.at(-1)
  p.reply({ ...first, type: 'tool-output', page: { message: { text: 'A'.repeat(1024 * 1024) }, nextCursor: 'more' } })
  expect(parent.childNodes[0].childNodes).toHaveLength(1)
  p.switch({ sessionId: 'b', messages: [message], sessions }); p.render(message)
  p.switch({ sessionId: 'a', messages: [message, { id: 'background-completed' }], sessions })
  parent.childNodes[1].childNodes[0].click()
  const next = p.sent.at(-1)
  expect(next.cursor).toBe('more')
  p.reply({ ...next, type: 'tool-output', page: { message: { text: 'next-page' } } })
  expect(parent.childNodes[0].childNodes.map((n: any) => n.text.length)).toEqual([1024 * 1024, 9])
  expect(parent.childNodes[1].childNodes).toEqual([])
  expect(p.counts().requests).toBe(0)
})

it('rejects large late pages after cancellation and accepts only the replacement request identity', () => {
  vi.useFakeTimers()
  const p = create(), message = { id: 'same', deferredBodyRevision: 'r1' }
  p.switch({ sessionId: 'a', messages: [message] })
  const oldParent = p.render(message); oldParent.childNodes[1].childNodes[0].click()
  const old = p.sent.at(-1)
  p.reset('same')
  const fresh = p.render({ ...message, deferredBodyRevision: 'r2' }); fresh.childNodes[1].childNodes[0].click()
  const next = p.sent.at(-1)
  p.reply({ ...old, type: 'tool-output', page: { message: { text: 'late'.repeat(1024 * 1024) } } })
  expect(fresh.childNodes[0].childNodes).toEqual([])
  expect(p.counts().requests).toBe(1)
  p.reply({ ...next, type: 'tool-output', page: { message: { text: 'current' } } })
  expect(fresh.childNodes[0].childNodes[0].text).toBe('current')
  p.reset('same')
  expect(p.counts()).toMatchObject({ requests: 0, pages: 0, controllers: 0 })
  expect(vi.getTimerCount()).toBe(0)
})
