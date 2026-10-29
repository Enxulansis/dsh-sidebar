import ts from 'typescript'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { ImageOriginStore } from '../src/image-origin-store.js'

// Execute the actual controller methods with its collaborators, without loading VS Code.
const source = ts.createSourceFile('extension.ts', readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const wanted = new Set(['originDisplayOf', 'evictAttachmentResults', 'releaseSessionCaches'])
const methods: string[] = []
function visit(n: ts.Node) {
  if (ts.isMethodDeclaration(n) && wanted.has(n.name.getText(source))) methods.push(n.getText(source))
  ts.forEachChild(n, visit)
}
visit(source)
if (methods.length !== wanted.size) throw Error('Missing production origin lifecycle method')
const code = ts.transpileModule(`class Controller {
  generation=1; _state={sessionId:'a'}; originDisplays=new Map(); originLoads=new Map();
  attachmentResults=new Map(); attachmentLoads=new Map(); publications=0;
  historyWindowGeneration=0; historyNavigationGeneration=0; historyEntries=[];
  historyBySession=new Map(); jobsBySession=new Map(); projectionBaselines=new Map(); modelSelections=new Map(); runningStatusRevisions=new Map();
  diffReviews={releaseSession(){}}; client={forgetSession(){}};
  bumpAttachmentGeneration(){}; publish(){this.publications++}; messagesPatch(){return {}};
  ${methods.join('\n')}
}; return Controller`, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
const create = (store: any): any => new (new Function('ORIGIN_STORE', code)(store))()
const settle = async (controller: any) => {
  const until=Date.now()+3000
  while (controller.originLoads.size && Date.now()<until) await new Promise(r=>setTimeout(r,5))
  expect(controller.originLoads.size).toBe(0)
}

it('keeps 26 displayed originals unchanged across the 24-entry store LRU boundary, and releases evicted sessions', async () => {
  const root=mkdtempSync(join(tmpdir(),'dsh-origin-display-')), store=new ImageOriginStore(root)
  try {
    await store.load()
    const c=create(store), read=vi.spyOn(store,'dataOf')
    for(let i=0;i<26;i++) {
      const rawBase64=Buffer.from('original-'+i).toString('base64')
      store.remember('a','image-'+i,{rawBase64,label:'a.jpg',displayMediaType:'image/jpeg'})
      expect(c.originDisplayOf('a',{attachmentId:'image-'+i})).toEqual({data:rawBase64,mediaType:'image/jpeg'})
    }
    expect(store.cached('a','image-0')).toBeUndefined()
    for(let pass=0;pass<5;pass++) for(let i=0;i<26;i++) {
      expect(c.originDisplayOf('a',{attachmentId:'image-'+i}).data).toBe(Buffer.from('original-'+i).toString('base64'))
    }
    expect(read).not.toHaveBeenCalled()
    c.evictAttachmentResults(new Set(['b']))
    expect(c.originDisplays.size).toBe(0)
    await store.flush()
    const cold=new ImageOriginStore(root); await cold.load()
    const recovered=create(cold), coldRead=vi.spyOn(cold,'dataOf')
    for(let i=0;i<26;i++) expect(recovered.originDisplayOf('a',{attachmentId:'image-'+i})).toBeUndefined()
    await settle(recovered)
    for(let pass=0;pass<5;pass++) for(let i=0;i<26;i++) {
      expect(recovered.originDisplayOf('a',{attachmentId:'image-'+i}).data).toBe(Buffer.from('original-'+i).toString('base64'))
    }
    expect(coldRead).toHaveBeenCalledTimes(26)
    expect(recovered.publications).toBe(26)
    recovered.releaseSessionCaches('a')
    expect(recovered.originDisplays.size).toBe(0)
    await cold.flush()
  } finally { await store.flush(); rmSync(root,{recursive:true,force:true}) }
})

it.each(['evict','purge','restart'])('does not resurrect an original after an in-flight read is invalidated by %s', async reason => {
  let finish!: (data: any)=>void
  const store={cached:()=>undefined,hasDisplay:()=>true,dataOf:()=>new Promise(r=>{finish=r})}
  const c=create(store)
  c.originDisplayOf('a',{attachmentId:'image'})
  if(reason==='purge')c.releaseSessionCaches('a')
  else if(reason==='restart'){c.generation++;c.evictAttachmentResults(new Set())}
  else c.evictAttachmentResults(new Set(['b']))
  finish({rawBase64:'original',displayMediaType:'image/jpeg'})
  await Promise.resolve()
  expect(c.originDisplays.size).toBe(0);expect(c.originLoads.size).toBe(0);expect(c.publications).toBe(0)
})

it('keeps a replacement same-key read owned when an evicted read completes late', async () => {
  const finishes: Array<(data:any)=>void>=[]
  const store={cached:()=>undefined,hasDisplay:()=>true,dataOf:()=>new Promise(r=>{finishes.push(r)})}
  const c=create(store)
  c.originDisplayOf('a',{attachmentId:'image'});c.evictAttachmentResults(new Set())
  c.originDisplayOf('a',{attachmentId:'image'})
  finishes[0]!({rawBase64:'old',displayMediaType:'image/jpeg'});await Promise.resolve()
  expect(c.originLoads.size).toBe(1);expect(c.originDisplays.size).toBe(0)
  finishes[1]!({rawBase64:'current',displayMediaType:'image/jpeg'});await settle(c)
  expect(c.originDisplayOf('a',{attachmentId:'image'})).toEqual({data:'current',mediaType:'image/jpeg'})
  expect(c.publications).toBe(1)
})
