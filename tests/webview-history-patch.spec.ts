import ts from 'typescript'
import { expect, it } from 'vitest'
import { chatHtml } from '../src/webview.js'
import { diffConversationMessages, messagesPatchForWebview } from '../src/chat-state-patch.js'
import type { ConversationMessage } from '../src/conversation.js'

const html = chatHtml({ cspSource: 'test' } as any, { toString: () => 'test:/icon' } as any)
const start = html.lastIndexOf('<script')
const script = ts.createSourceFile('webview.js', html.slice(start + html.slice(start).indexOf('>') + 1, html.lastIndexOf('</script>')), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
let code = ''
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'applyMessagesPatch') code = node.getText(script)
  ts.forEachChild(node, visit)
}
visit(script)
if (!code) throw Error('Production history patch handler missing')
const create = new Function(`
  const pendingMessageAppends = new Map(), array = v => Array.isArray(v) ? v : [], string = v => typeof v === 'string' ? v : '';
  ${code}
  return { apply: applyMessagesPatch, pendingMessageAppends };
`)

it('retains hydrated message identity through repeated older-history patches and applies streaming updates at the shifted index', () => {
  const p = create()
  const photo: ConversationMessage = { id: 'photo', role: 'user', text: '', images: [{ attachmentId: 'image', mediaType: 'image/png', width: 20, height: 10, data: 'base64' }] }
  const assistant: ConversationMessage = { id: 'answer', role: 'assistant', text: 'A', streaming: true }
  const previous = [photo, assistant]
  const older: ConversationMessage = { id: 'older', role: 'assistant', text: 'Old' }
  const next = [older, { ...photo }, { ...assistant, text: 'AB' }]
  const restored = p.apply(previous, messagesPatchForWebview(diffConversationMessages(previous, next)!))
  expect(restored).toEqual(next)
  expect(restored[1]).toBe(photo)
  expect(p.pendingMessageAppends.get('answer')).toBe('B')
  const earliest = { ...older, id: 'earliest' }
  const again = p.apply(restored, messagesPatchForWebview(diffConversationMessages(next, [earliest, ...next])!))
  expect(again.map((m: ConversationMessage) => m.id)).toEqual(['earliest', 'older', 'photo', 'answer'])
  expect(again[2]).toBe(photo)
  expect(p.pendingMessageAppends.get('answer')).toBe('B')
  const replacement = { ...photo, images: [{ ...photo.images![0]!, error: 'unavailable' }] }
  const changed = p.apply(again, { upserts: [replacement] })
  expect(changed[2]).toBe(replacement)
  expect(p.apply(changed, { reset: [photo] })).toEqual([photo])
  expect(p.pendingMessageAppends.size).toBe(0)
})
