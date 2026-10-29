import { it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { summarizeHeap } from './heap-retention.js'

it('reports strong payload ownership while excluding a weak-only payload from residency counts', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-heap-schema-')), file = join(root, 'owned.heapsnapshot')
  try {
    writeFileSync(file, JSON.stringify({ snapshot: { meta: {
      node_fields: ['type', 'name', 'self_size', 'edge_count'], node_types: [['synthetic', 'object', 'string']],
      edge_fields: ['type', 'name_or_index', 'to_node'], edge_types: [['property', 'element', 'weak']],
    } }, nodes: [0,0,0,2, 1,1,24,1, 2,2,300000,0, 2,3,300000,0],
      edges: [0,4,4, 2,6,12, 0,5,8], strings: ['', 'Session', 'OWNED_REPLY_one', 'OWNED_REPLY_weak', 'session', 'text', 'weak'] }), 'utf8')
    const result = summarizeHeap(file, 'OWNED_REPLY_')
    expect(result.nodeCount).toBe(4); expect(result.stronglyReachable).toBe(3)
    expect(result.payloadCount).toBe(1); expect(result.payloadBytes).toBe(300000)
    expect(result.constructors).toEqual([{ name: 'object:Session', count: 1, selfBytes: 24 }])
    expect(result.payloadPaths[0]?.holdingPath).toEqual([
      { type: 'synthetic', name: '', selfBytes: 0, edge: 'session', edgeType: 'property' },
      { type: 'object', name: 'Session', selfBytes: 24, edge: 'text', edgeType: 'property' },
    ])
  } finally { unlinkSync(file); rmdirSync(root) }
})

it('separates strongly held native buffers and image string prefixes from weak buffers', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-heap-schema-')), file = join(root, 'images.heapsnapshot')
  try {
    writeFileSync(file, JSON.stringify({ snapshot: { meta: {
      node_fields: ['type', 'name', 'self_size', 'edge_count'], node_types: [['synthetic', 'object', 'string', 'native']],
      edge_fields: ['type', 'name_or_index', 'to_node'], edge_types: [['property', 'element', 'weak']],
    } }, nodes: [0,0,0,3, 1,1,24,2, 2,2,400000,0, 3,3,500000,0, 3,3,900000,0, 2,4,350000,0],
      edges: [0,5,4, 2,8,16, 0,9,20, 0,6,8, 0,7,12],
      strings: ['', 'Context', '/9j/owned', 'system / JSArrayBufferData', 'data:image/jpeg;base64,/9j/owned', 'context', 'image', 'bytes', 'weak', 'wire'] }), 'utf8')
    const result = summarizeHeap(file, ['/9j/', 'data:image/jpeg;base64,'])
    expect(result.payloadCount).toBe(2); expect(result.payloadBytes).toBe(750000)
    expect(result.largeBuffers.count).toBe(1); expect(result.largeBuffers.selfBytes).toBe(500000)
    expect(result.largeBuffers.paths[0]?.holdingPath).toEqual([
      { type: 'synthetic', name: '', selfBytes: 0, edge: 'context', edgeType: 'property' },
      { type: 'object', name: 'Context', selfBytes: 24, edge: 'bytes', edgeType: 'property' },
    ])
  } finally { unlinkSync(file); rmdirSync(root) }
})
