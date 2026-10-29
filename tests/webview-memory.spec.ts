import { expect, it } from 'vitest'
import ts from 'typescript'
import { chatHtml } from '../src/webview.js'

// Exercise the actual switch/cache functions, including the lazy-message ownership transfer.
const html = chatHtml({ cspSource: 'test' } as any, { toString: () => 'test:/icon' } as any)
const script = ts.createSourceFile('webview.js', html.slice(html.lastIndexOf('<script') + html.slice(html.lastIndexOf('<script')).indexOf('>') + 1, html.lastIndexOf('</script>')), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const functions = new Map<string, string>()
let switchCode = ''
function visit(n: ts.Node) {
  if (ts.isFunctionDeclaration(n) && n.name) functions.set(n.name.text, n.getText(script))
  if (ts.isIfStatement(n) && n.expression.getText(script) === 'renderedSessionId !== current.sessionId') switchCode = n.getText(script)
  ts.forEachChild(n, visit)
}
visit(script)
if (!switchCode) throw Error('Production session switch not found')
const create = new Function(`
  const sessionDomCache = new Map(), SESSION_DOM_CACHE_MAX = 2, SESSION_DOM_SKIP_NODES = 90000;
  let lazyBodies = new Map(), lazyToolCards = new Map(), renderedMessages = new Map(), renderedSessionId, pendingSessionDom;
  let renderedDomSignature = '', renderedDomMessageCount = 0, renderedViewCfgKey = '', workFoldSignatureCache = '', lastWorkSegments = [];
  let railRevealPending, railViewportRestored, railNavigationLocked, railNavigationSeq, pendingRailJumpSeq, pendingRailJumpSession;
  let followConversationTail, expandedToolIds, renderedHistoryKey, renderedTail, lastEchoAnchorId;
  const renderFailedIds = new Set(), loadingToolRequests = new Map(), toolOutputErrors = new Map(), toolOutputPages = new Map(), deferredOutputViews = new Map(), pendingMessageAppends = new Map(), claimedEchoIds = new Set();
  const cfg = {scroll:false, expand:false, fold:false};
  const viewMemoryCfg = () => cfg, viewMemoOf = () => ({atBottom:true}), scheduleViewStatePersist = () => {}, captureScrollMemo = () => {}, clearRestoreThroughTarget = () => {}, startViewRestore = () => {}, invalidateWorkFoldCache = () => {}, viewCfgKeyOf = () => '', array = v => Array.isArray(v) ? v : [];
  function container() { return {childNodes:[], append(...nodes){this.childNodes.push(...nodes)}, querySelectorAll(){return this.childNodes}, replaceChildren(...nodes){this.childNodes=nodes}} }
  const elements = {messages:container()}, document = {createElement:container};
  ${['viewMemoryKeyNow', 'messageIdDigest', 'stashSessionDom', 'restoreSessionDom', 'pruneSessionDom'].map(name => functions.get(name) ?? (() => { throw Error('Missing production function ' + name) })()).join('\n')}
  return {switch(current){current={phase:'ready',...current};pruneSessionDom(current.sessions);${switchCode}}, dom(){return elements.messages.childNodes}, render(messages){elements.messages.replaceChildren(...messages);renderedMessages=new Map(messages.map(m=>[m.id,{message:m,node:m}]));renderedDomSignature=messageIdDigest(messages);renderedDomMessageCount=messages.length;for(const m of messages)(m.role==='tool'?lazyToolCards:lazyBodies).set(m.id,m)}, output(id,page,controller){toolOutputPages.set(id,page);deferredOutputViews.set(id,controller)}, request(id){loadingToolRequests.set(id,{requestId:1,timer:setTimeout(()=>{},5000)})}, outputs(){return {pages:toolOutputPages,views:deferredOutputViews,requests:loadingToolRequests}}, pending(){return {bodies:[...lazyBodies.values()],tools:[...lazyToolCards.values()],cached:[...sessionDomCache.values()]}}};
`)

it('releases evicted deferred message snapshots and restores colliding IDs from their own cached session', () => {
  const p = create(), messages = (sid: string) => [{ id: 'same-body', role: 'assistant', text: sid + '-body' }, { id: 'same-tool', role: 'tool', text: sid + '-tool' }]
  p.switch({ sessionId: 'a', messages: messages('a') }); p.render(messages('a'))
  p.switch({ sessionId: 'b', messages: messages('b') })
  expect(p.pending().bodies).toEqual([])
  expect(p.pending().tools).toEqual([])
  p.render(messages('b')); p.switch({ sessionId: 'a', messages: messages('a') })
  expect(p.pending().bodies.map((m: any) => m.text)).toEqual(['a-body'])
  expect(p.pending().tools.map((m: any) => m.text)).toEqual(['a-tool'])
  for (const sid of ['c', 'd', 'e']) { p.switch({ sessionId: sid, messages: messages(sid) }); p.render(messages(sid)) }
  expect(p.pending().cached).toHaveLength(2)
  const all = [p.pending(), ...p.pending().cached.map((c: any) => ({ bodies: [...c.lazyBodies.values()], tools: [...c.lazyToolCards.values()] }))]
  expect(all.flatMap(c => c.bodies.concat(c.tools)).map((m: any) => m.text).sort()).toEqual(['c-body', 'c-tool', 'd-body', 'd-tool', 'e-body', 'e-tool'])
})

it('keeps the incoming cached DOM when leaving a third session at the two-entry LRU limit', () => {
  const p = create(), messages = (sid: string) => [{ id: 'body', role: 'assistant', text: sid }]
  for (const sid of ['a', 'b', 'c']) { p.switch({ sessionId: sid, messages: messages(sid) }); p.render(messages(sid)) }
  p.switch({ sessionId: 'a', messages: messages('a') })
  expect(p.pending().bodies.map((m: any) => m.text)).toEqual(['a'])
  expect(p.pending().cached).toHaveLength(2)
})

it('preserves the cached target through the real empty loading frame until its ready messages arrive', () => {
  const p = create(), messages = (sid: string) => [{ id: 'body', role: 'assistant', text: sid }]
  p.switch({ sessionId: 'a', phase: 'ready', messages: messages('a') }); p.render(messages('a'))
  p.switch({ sessionId: 'b', phase: 'loading', messages: [] }); p.switch({ sessionId: 'b', phase: 'ready', messages: messages('b') }); p.render(messages('b'))
  p.switch({ sessionId: 'a', phase: 'loading', messages: [] })
  expect(p.pending().bodies).toEqual([])
  p.switch({ sessionId: 'a', phase: 'ready', messages: messages('a') })
  expect(p.pending().bodies.map((m: any) => m.text)).toEqual(['a'])
  expect(p.pending().cached).toHaveLength(1)
})

it('does not consume the target cache when loading still carries the outgoing session messages', () => {
  const p = create(), target = [{ id: 'output', role: 'tool' }], outgoing = [{ id: 'other', role: 'assistant' }]
  const page = { pages: [{ text: 'loaded' }], nextCursor: 'next' }, controller = { append() {} }
  p.switch({ sessionId: 'a', messages: target }); p.render(target); p.output('output', page, controller)
  p.switch({ sessionId: 'b', messages: outgoing }); p.render(outgoing)
  p.switch({ sessionId: 'a', phase: 'loading', messages: outgoing })
  expect(p.outputs().pages.size).toBe(0)
  p.switch({ sessionId: 'a', phase: 'ready', messages: [...target, { id: 'job-completed' }] })
  expect(p.outputs().pages.get('output')).toBe(page)
  expect(p.outputs().views.get('output')).toBe(controller)
})

it('discards a staged target on a new session intent or a changed ready message signature', () => {
  const p = create(), messages = (sid: string) => [{ id: 'body', role: 'assistant', text: sid }]
  p.switch({ sessionId: 'a', messages: messages('a') }); p.render(messages('a'))
  p.switch({ sessionId: 'b', messages: messages('b') }); p.render(messages('b'))
  p.switch({ sessionId: 'a', phase: 'loading', messages: [] })
  p.switch({ sessionId: 'c', phase: 'ready', messages: messages('c') })
  expect(p.pending().bodies).toEqual([])
  p.render(messages('c')); p.switch({ sessionId: 'b', phase: 'loading', messages: [] })
  p.switch({ sessionId: 'b', phase: 'ready', messages: [{ id: 'replacement-body' }] })
  expect(p.pending().bodies).toEqual([])
})

it('restores the unchanged prefix through loading when a background job appended a message', () => {
  const p = create(), messages = [{ id: 'output', role: 'tool' }]
  const page = { pages: [{ text: 'loaded' }], nextCursor: 'next' }, controller = { append() {} }
  p.switch({ sessionId: 'a', messages }); p.render(messages); p.output('output', page, controller)
  p.switch({ sessionId: 'b', messages }); p.render(messages)
  p.switch({ sessionId: 'a', phase: 'loading', messages: [] })
  p.switch({ sessionId: 'a', phase: 'ready', messages: [...messages, { id: 'job-completed' }] })
  expect(p.outputs().pages.get('output')).toBe(page)
  expect(p.outputs().views.get('output')).toBe(controller)
})

it.each([{messages:[]}, {messages:[{ id: 'new-earlier' }, { id: 'output' }]}, {messages:[{ id: 'different-output' }]}])('rejects a removed, prepended or replaced cached prefix: %j', ({messages:incoming}) => {
  const p = create(), messages = [{ id: 'output', role: 'tool' }]
  p.switch({ sessionId: 'a', messages }); p.render(messages); p.output('output', {}, {})
  p.switch({ sessionId: 'b', messages }); p.render(messages)
  p.switch({ sessionId: 'a', phase: 'ready', messages: incoming })
  expect(p.outputs().pages.size).toBe(0)
  expect(p.outputs().views.size).toBe(0)
})

it('releases deleted offline and staged DOMs immediately without caching the removed outgoing session', () => {
  const p = create(), messages = (id: string) => [{ id: 'image', role: 'assistant', text: id, images: [{ data: 'A'.repeat(1024 * 1024) }] }]
  const sessions = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  p.switch({ sessionId: 'a', sessions, messages: messages('a') }); p.render(messages('a'))
  p.switch({ sessionId: 'b', sessions, messages: messages('b') }); p.render(messages('b'))
  p.switch({ sessionId: 'c', sessions: [{ id: 'c' }], messages: messages('c') })
  expect(p.pending().cached).toEqual([])
  expect(p.pending().bodies).toEqual([])
})

it('restores deferred page data and its exact DOM controller together and releases them on LRU eviction', () => {
  const p = create(), messages = [{ id: 'output', role: 'tool' }]
  const page = { pages: [{ rawResult: 'output'.repeat(1024 * 1024) }], nextCursor: 'next' }, controller = { append() {} }
  p.switch({ sessionId: 'a', messages }); p.render(messages); p.output('output', page, controller)
  p.switch({ sessionId: 'b', messages }); p.render(messages)
  expect(p.outputs().pages.size + p.outputs().views.size).toBe(0)
  p.switch({ sessionId: 'a', messages })
  expect(p.outputs().pages.get('output')).toBe(page)
  expect(p.outputs().views.get('output')).toBe(controller)
  for (const id of ['c', 'd', 'e']) { p.switch({ sessionId: id, messages }); p.render(messages) }
  expect(p.pending().cached.every((cache: any) => cache.outputPages.size + cache.outputViews.size === 0)).toBe(true)
})

it('cancels in-flight deferred requests when switching and discards the stale loading DOM', () => {
  const p = create(), messages = [{ id: 'output', role: 'tool' }]
  p.switch({ sessionId: 'a', messages }); p.render(messages); p.request('output')
  p.switch({ sessionId: 'b', messages }); p.render(messages)
  expect(p.outputs().requests.size).toBe(0)
  expect(p.pending().cached).toEqual([])
})

it('removes an uncached outgoing loading DOM before attaching the cached target', () => {
  const p = create(), messages = (sid: string) => [{ id: sid, role: 'tool', text: sid }]
  p.switch({ sessionId: 'a', messages: messages('a') }); p.render(messages('a'))
  p.switch({ sessionId: 'b', messages: messages('b') }); p.render(messages('b')); p.request('b')
  p.switch({ sessionId: 'a', messages: messages('a') })
  expect(p.dom().map((m: any) => m.text)).toEqual(['a'])
  expect(p.outputs().requests.size).toBe(0)
})
