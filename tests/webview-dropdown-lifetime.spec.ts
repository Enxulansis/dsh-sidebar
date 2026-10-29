import { expect, it } from 'vitest'
import ts from 'typescript'
import { chatHtml } from '../src/webview.js'

const html = chatHtml({ cspSource: 'test' } as any, { toString: () => 'test:/icon' } as any)
const start = html.lastIndexOf('<script'), body = html.slice(start + html.slice(start).indexOf('>') + 1, html.lastIndexOf('</script>'))
const script = ts.createSourceFile('webview.js', body, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const names = new Set(['installDrop', 'closeOutsideDrop'])
const functions = script.statements.filter(s => ts.isFunctionDeclaration(s) && s.name && names.has(s.name.text)).map(s => s.getText(script)).join('\n')
const registration = script.statements.filter(s => ts.isExpressionStatement(s) && s.getText(script).includes("document.addEventListener('click', closeOutsideDrop)")).map(s => s.getText(script)).join('\n')

class El {
  children: El[] = []; parentNode?: El; listeners = new Map<string, Array<(e: any) => void>>()
  style: Record<string, string> = {}; attrs: Record<string, string> = {}; hidden = false; disabled = false
  className = ''; textContent = ''; value = ''; title = ''; selected = false; selectedOptions: El[] = []
  classList = { add() {}, remove() {} }
  constructor(public tagName = 'DIV') {}
  append(...children: El[]) { for (const child of children) { child.parentNode = this; this.children.push(child) } }
  insertBefore(child: El, before: El) { child.parentNode = this; this.children.splice(this.children.indexOf(before), 0, child) }
  contains(target: El): boolean { return target === this || this.children.some(c => c.contains(target)) }
  setAttribute(key: string, value: string) { this.attrs[key] = value }
  addEventListener(type: string, fn: (e: any) => void) { const list = this.listeners.get(type) ?? []; list.push(fn); this.listeners.set(type, list) }
  dispatchEvent(e: any) { for (const fn of this.listeners.get(e.type) ?? []) fn(e) }
  getBoundingClientRect() { return { left: 10, right: 100 } }
}
function fixture() {
  const document = { createElement: (tag: string) => new El(tag.toUpperCase()), clicks: [] as Array<(e: any) => void>, addEventListener(type: string, fn: (e: any) => void) { if (type === 'click') this.clicks.push(fn) } }
  const install = new Function('document', 'MutationObserver', 'window', 'queueMicrotask', `let activeDrop; const CHEVRON_DOWN_SVG=''; ${functions}\n${registration}\nreturn installDrop;`)(document, class { observe() {} }, { innerWidth: 500 }, (fn: () => void) => fn())
  const add = () => { const parent = new El(), select = new El('SELECT'); parent.append(select); install(select); return { select, trigger: parent.children[0].children[0], menu: parent.children[0].children[1] } }
  const click = (target: El) => { target.dispatchEvent({ type: 'click', target }); for (const fn of document.clicks) fn({ target }) }
  return { document, add, click }
}

it('keeps document dismissal listeners constant across repeated detached dropdown rebuilds', () => {
  const p = fixture()
  for (let i = 0; i < 200; i++) p.add()
  expect(p.document.clicks).toHaveLength(1)
})
it('closes the previous menu, preserves inside clicks and dismisses outside clicks', () => {
  const p = fixture(), a = p.add(), b = p.add()
  p.click(a.trigger); expect(a.menu.hidden).toBe(false)
  p.click(b.trigger); expect(a.menu.hidden).toBe(true); expect(b.menu.hidden).toBe(false)
  p.click(b.menu); expect(b.menu.hidden).toBe(false)
  p.click(new El()); expect(b.menu.hidden).toBe(true)
  p.click(b.trigger); expect(b.menu.hidden).toBe(false)
  p.click(b.trigger); expect(b.menu.hidden).toBe(true)
})
