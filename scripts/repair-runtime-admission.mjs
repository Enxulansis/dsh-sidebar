/* Version-bound local SDK repair. Verify every source before touching any file;
   keep exact originals for transaction rollback and explicit later restoration. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
const require = createRequire(import.meta.url)
const { transformRuntimePackage, originalHashes, hash, repairTag } = require('../runtime/admission-repair.cjs')
const args = new Map()
for (let i=2;i<process.argv.length;i++) {
  const name=process.argv[i]
  if (name==='--apply') args.set(name,true)
  else { if(!name.startsWith('--')||!process.argv[i+1])throw Error('Expected named arguments');args.set(name,process.argv[++i]) }
}
for(const name of ['--runtime-root','--backup-dir','--report'])if(!args.has(name))throw Error('Required: '+name)
const root=fs.realpathSync(path.resolve(args.get('--runtime-root'))), modules=path.join(root,'node_modules','@deepseek-ai')
const backup=path.resolve(args.get('--backup-dir')), reportPath=path.resolve(args.get('--report'))
const helper=fs.readFileSync(fileURLToPath(new URL('../runtime/admission-cancellation.cjs',import.meta.url)))
const helperRel='dsh-api-session-controller/lib/admission-cancellation.cjs'
const types={
  'dsh-attachment/lib/types/index.d.ts':['c863172169065a97410a4bd0ad128bb25bee830998f10679202828352cb166de',4],
  'dsh-attachment/lib/types/admission.d.ts':['bccb41cc6ad594bb5265cdbc612d9029884d575b3dd9b74a15e47e803dc27f54',1],
  'dsh-attachment-local/lib/types/index.d.ts':['8bf4c1c54a2cd981991eec5d2a533758d4f859d1ba240b0e0a6c9645a066fa0d',3],
  'dsh-attachment-local/lib/types/store.d.ts':['b3f44505c21e48b06c179c7063cd26b9fac91aea50201027872ef81bc2cbfd75',3],
}
const target = rel => {
  const value=path.resolve(modules,rel),inside=path.relative(root,value)
  if(inside.startsWith('..')||path.isAbsolute(inside))throw Error('Repair target escapes runtime root')
  if(fs.existsSync(value)&&fs.realpathSync(value)!==value)throw Error('Repair refuses a linked target')
  return value
}
if(fs.existsSync(reportPath)) {
  const previous=JSON.parse(fs.readFileSync(reportPath,'utf8'))
  if(previous.state==='installed'&&previous.runtimeRoot===root&&previous.repair===repairTag) {
    for(const entry of previous.files)if(hash(fs.readFileSync(target(entry.relative)))!==entry.afterSha256)throw Error('Installed repair was changed: '+entry.relative)
    if(hash(fs.readFileSync(target(helperRel)))!==hash(helper))throw Error('Installed helper differs from source')
    console.log(JSON.stringify({state:'already-installed',verified:true,report:reportPath}));process.exit(0)
  }
}
const prepared=[]
for(const name of Object.keys(originalHashes)) {
  const relative=name+'/lib/index.js',file=target(relative),original=fs.readFileSync(file)
  const changed=Buffer.from(transformRuntimePackage(name,original.toString('utf8')),'utf8')
  const syntax=spawnSync(process.execPath,['--input-type=module','--check'],{input:changed,encoding:'utf8',windowsHide:true})
  if(syntax.status!==0)throw Error('Generated runtime syntax: '+syntax.stderr)
  prepared.push({relative,file,original,changed})
}
for(const [relative,[sha,count]] of Object.entries(types)) {
  const file=target(relative),original=fs.readFileSync(file)
  if(hash(original)!==sha)throw Error('Unknown runtime type declaration: '+relative)
  let matches=0
  const changed=Buffer.from(original.toString('utf8').replace(/\b(saveImages|saveImage|validateImage|admitPromptContent|admitEncodedImages|prepareImageFile|commitPreparedImageFile|validateImageFile)\(([^)]*)\):/g,(_,name,parameters)=>{matches++;return name+'('+parameters+', signal?: AbortSignal):'}),'utf8')
  if(matches!==count)throw Error('Type declaration contract changed: '+relative)
  prepared.push({relative,file,original,changed})
}
if(fs.existsSync(target(helperRel)))throw Error('Unexpected existing cancellation helper')
prepared.push({relative:helperRel,file:target(helperRel),original:null,changed:helper})
const metadata={repair:repairTag,runtimeRoot:root,checkedAt:new Date().toISOString(),state:args.has('--apply')?'prepared':'validated',backupDir:backup,
  files:prepared.map(e=>({relative:e.relative,beforeSha256:e.original?hash(e.original):null,afterSha256:hash(e.changed),bytes:e.changed.length})),
  packages:Object.keys(originalHashes).map(name=>({name,...JSON.parse(fs.readFileSync(target(name+'/package.json'),'utf8'))})).map(({name,version})=>({name,version}))}
fs.mkdirSync(path.dirname(reportPath),{recursive:true})
if(!args.has('--apply')) { fs.writeFileSync(reportPath,JSON.stringify(metadata,null,2)+'\n','utf8');console.log(JSON.stringify({state:'validated',files:prepared.length,report:reportPath}));process.exit(0) }
if(fs.existsSync(backup))throw Error('Use a fresh backup directory')
fs.mkdirSync(backup,{recursive:true})
for(const entry of prepared)if(entry.original){const p=path.join(backup,entry.relative);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,entry.original)}
fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify(metadata,null,2)+'\n','utf8')
fs.writeFileSync(reportPath,JSON.stringify(metadata,null,2)+'\n','utf8')
const written=[]
try {
  // Helper first so no newly loaded controller observes a missing import.
  for(const entry of [prepared.at(-1),...prepared.slice(0,-1)]) {
    const p=entry.file+'.'+randomUUID()+'.tmp'
    fs.writeFileSync(p,entry.changed)
    try { fs.renameSync(p,entry.file) } finally { if(fs.existsSync(p))fs.unlinkSync(p) }
    written.push(entry)
  }
  for(const entry of prepared)if(hash(fs.readFileSync(entry.file))!==hash(entry.changed))throw Error('Write verification failed')
  metadata.state='installed';metadata.installedAt=new Date().toISOString()
  fs.writeFileSync(reportPath,JSON.stringify(metadata,null,2)+'\n','utf8')
  console.log(JSON.stringify({state:'installed',files:prepared.length,report:reportPath,backup}))
} catch(error) {
  for(const entry of written.reverse()) { if(entry.original)fs.writeFileSync(entry.file,entry.original);else if(fs.existsSync(entry.file))fs.unlinkSync(entry.file) }
  metadata.state='rolled-back';metadata.error=String(error);fs.writeFileSync(reportPath,JSON.stringify(metadata,null,2)+'\n','utf8');throw error
}
