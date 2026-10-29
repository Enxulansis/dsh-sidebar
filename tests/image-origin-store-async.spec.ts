import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { ImageOriginStore } from '../src/image-origin-store.js'

const gate=vi.hoisted(()=>({file:'',waiting:undefined as (()=>void)|undefined,release:undefined as Promise<void>|undefined}))
vi.mock('node:fs/promises',async importOriginal=>{
  const actual=await importOriginal<typeof import('node:fs/promises')>()
  return {...actual,readFile:async (file: Parameters<typeof actual.readFile>[0], options?:any)=>{
    const result=await actual.readFile(file,options)
    if(file===gate.file){gate.waiting?.();await gate.release}
    return result
  }}
})

it.each(['purge','prune','replace'])('does not repopulate memory from a disk read invalidated by %s',async reason=>{
  const root=mkdtempSync(join(tmpdir(),'dsh-origin-read-')), store=new ImageOriginStore(root)
  let finish!:()=>void
  let cold: ImageOriginStore|undefined
  try {
    await store.load()
    const original={rawBase64:Buffer.from('original bytes').toString('base64'),label:'a.jpg',displayMediaType:'image/jpeg'}
    store.remember('a','image',original);await store.flush()
    cold=new ImageOriginStore(root);await cold.load()
    gate.file=join(root,cold.recordOf('a','image')!.file)
    const began=new Promise<void>(r=>{gate.waiting=r})
    gate.release=new Promise<void>(r=>{finish=r})
    const pending=cold.dataOf('a','image');await began
    if(reason==='purge')cold.purgeSession('a')
    else if(reason==='prune')cold.setMaxTotalBytes(0)
    else cold.remember('a','image',{...original,rawBase64:Buffer.from('new bytes').toString('base64')})
    finish()
    expect(await pending).toBeUndefined()
    if(reason==='replace')expect(cold.cached('a','image')?.rawBase64).toBe(Buffer.from('new bytes').toString('base64'))
    else {expect(cold.cached('a','image')).toBeUndefined();expect(cold.recordOf('a','image')).toBeUndefined()}
    await cold.flush()
  } finally { finish?.();gate.file='';gate.waiting=undefined;gate.release=undefined;await cold?.flush();await store.flush();rmSync(root,{recursive:true,force:true}) }
})
