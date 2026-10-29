import fs from 'node:fs'
import path from 'node:path'
import { inflateSync } from 'node:zlib'
import { build } from 'esbuild'

const roots = new Set()
function packageRoot(file) {
  let dir = path.dirname(fs.realpathSync(file))
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
      if (manifest.name && manifest.version) return dir
    }
    dir = path.dirname(dir)
  }
  throw new Error('Missing package root')
}
for (const options of [
  { entryPoints: ['src/extension.ts'], platform: 'node', format: 'cjs', external: ['vscode'], target: 'node22' },
  { entryPoints: ['src/markdown-vendor-entry.ts'], platform: 'browser', format: 'iife' },
]) {
  const result = await build({ ...options, bundle: true, write: false, metafile: true, logLevel: 'silent' })
  for (const file of Object.keys(result.metafile.inputs)) {
    if (file.includes('node_modules/')) roots.add(packageRoot(file))
  }
}
for (const name of ['mathjax', 'pako', 'utif2']) roots.add(fs.realpathSync(path.join('node_modules', name)))
const packages = [...roots].map(root => ({ root, ...JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) }))
  .sort((a, b) => a.name.localeCompare(b.name))
let notices = 'THIRD-PARTY SOFTWARE NOTICES\n\nThese are bundled implementation libraries, not DSH runtime plugins.\nSource packages are pinned by pnpm-lock.yaml. License texts are reproduced from installed packages.\n'
for (const pkg of packages) {
  const files = fs.readdirSync(pkg.root).filter(name => /^(license|licence|copying|notice)([.-]|$)/i.test(name) && fs.statSync(path.join(pkg.root, name)).isFile())
  if (!files.length) throw new Error('No license text for ' + pkg.name)
  notices += '\n============================================================\n' + pkg.name + '@' + pkg.version + '\nLicense: ' + String(pkg.license) + '\n'
  for (const file of files) notices += '\n--- ' + file + ' ---\n' + fs.readFileSync(path.join(pkg.root, file), 'utf8').trim() + '\n'
}

// File badges are embedded SVG data, so the module dependency scan cannot find them.
notices += '\n============================================================\nMaterial Icon Theme 5.38.1 — embedded file-type icons\nSource: https://github.com/material-extensions/vscode-material-icon-theme\nLicense: MIT\n'
notices += fs.readFileSync('licenses/Material-Icon-Theme-MIT.txt', 'utf8').trim() + '\n'

// Read the copyright/license name records from the WOFF counterparts of
// KaTeX's embedded WOFF2 fonts. Do not rewrite the fonts themselves.
const fontNotices = new Set()
const fontDir = path.join('node_modules', 'katex', 'dist', 'fonts')
for (const file of fs.readdirSync(fontDir).filter(name => name.endsWith('.woff'))) {
  const bytes = fs.readFileSync(path.join(fontDir, file))
  if (bytes.toString('ascii', 0, 4) !== 'wOFF') throw new Error('Unexpected font format')
  for (let i = 0; i < bytes.readUInt16BE(12); i++) {
    const at = 44 + i * 20
    if (bytes.toString('ascii', at, at + 4) !== 'name') continue
    const offset = bytes.readUInt32BE(at + 4), compressed = bytes.readUInt32BE(at + 8), original = bytes.readUInt32BE(at + 12)
    const data = bytes.subarray(offset, offset + compressed)
    const table = compressed < original ? inflateSync(data) : data
    const base = table.readUInt16BE(4)
    for (let j = 0; j < table.readUInt16BE(2); j++) {
      const record = 6 + j * 12, id = table.readUInt16BE(record + 6)
      if (![0, 13, 14].includes(id)) continue
      const start = base + table.readUInt16BE(record + 10)
      const value = Buffer.from(table.subarray(start, start + table.readUInt16BE(record + 8)))
      const platform = table.readUInt16BE(record)
      const text = platform === 0 || platform === 3 ? value.swap16().toString('utf16le') : value.toString('latin1')
      if (text.trim()) fontNotices.add(text.trim())
    }
  }
}
notices += '\n============================================================\nKaTeX embedded font notices\n\n' + [...fontNotices].sort().join('\n\n')
notices += '\n\nAdditional font source attribution: Copyright 1995, 2009 American Mathematical Society.\n\n'
notices += fs.readFileSync('licenses/OFL-1.1.txt', 'utf8').trim() + '\n'
fs.writeFileSync('THIRD-PARTY-NOTICES.txt', notices, 'utf8')
console.log(JSON.stringify({ packages: packages.length, fontNotices: fontNotices.size, output: 'THIRD-PARTY-NOTICES.txt' }))
