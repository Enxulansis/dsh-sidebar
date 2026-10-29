import { readFileSync } from 'node:fs'

/** Strong shortest paths from V8's synthetic root. Self bytes, not retained bytes.
 * Strings are truncated in V8 names; report prefixes, never recover user data. */
export function summarizeHeap(path: string, marker: string | readonly string[]) {
  const markers = typeof marker === 'string' ? [marker] : marker
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const meta = data.snapshot.meta, nodes: number[] = data.nodes, edges: number[] = data.edges, strings: string[] = data.strings
  const nf: string[] = meta.node_fields, ef: string[] = meta.edge_fields
  const stride = nf.length, edgeStride = ef.length, count = nodes.length / stride
  const typeField = nf.indexOf('type'), nameField = nf.indexOf('name'), sizeField = nf.indexOf('self_size'), edgeCountField = nf.indexOf('edge_count')
  const edgeTypeField = ef.indexOf('type'), edgeNameField = ef.indexOf('name_or_index'), edgeToField = ef.indexOf('to_node')
  if ([typeField, nameField, sizeField, edgeCountField, edgeTypeField, edgeNameField, edgeToField].includes(-1) || !Number.isInteger(count)) throw Error('Unsupported heap schema')
  const nodeTypes: string[] = meta.node_types[typeField], edgeTypes: string[] = meta.edge_types[edgeTypeField]
  const starts = new Uint32Array(count + 1), parents = new Int32Array(count).fill(-1), parentEdges = new Int32Array(count).fill(-1), queue = new Uint32Array(count)
  for (let i = 0; i < count; i++) starts[i + 1] = starts[i]! + nodes[i * stride + edgeCountField]! * edgeStride
  if (starts[count] !== edges.length) throw Error('Heap edge count mismatch')
  let head = 0, tail = 1; queue[0] = 0; parents[0] = 0
  while (head < tail) {
    const from = queue[head++]!
    for (let edge = starts[from]!; edge < starts[from + 1]!; edge += edgeStride) {
      if (edgeTypes[edges[edge + edgeTypeField]!] === 'weak') continue
      const to = edges[edge + edgeToField]! / stride
      if (parents[to] !== -1) continue
      parents[to] = from; parentEdges[to] = edge; queue[tail++] = to
    }
  }
  const label = (i: number) => ({ type: nodeTypes[nodes[i * stride + typeField]!]!, name: strings[nodes[i * stride + nameField]!]!.slice(0, 160), selfBytes: nodes[i * stride + sizeField]! })
  const holdingPath = (index: number) => {
    const result: unknown[] = []
    for (let i = index, depth = 0; i !== 0 && depth < 32; i = parents[i]!, depth++) {
      const edge = parentEdges[i]!, type = edgeTypes[edges[edge + edgeTypeField]!]!
      result.push({ ...label(parents[i]!), edge: ['element', 'hidden'].includes(type) ? String(edges[edge + edgeNameField]) : strings[edges[edge + edgeNameField]!]!.slice(0, 160), edgeType: type })
    }
    return result.reverse()
  }
  const totals = new Map<string, { name: string; count: number; selfBytes: number }>(), payload: number[] = [], objects: number[] = [], buffers: number[] = []
  for (let i = 0; i < count; i++) {
    if (parents[i] === -1) continue
    const node = label(i), key = node.type + ':' + node.name
    const total = totals.get(key) ?? { name: key, count: 0, selfBytes: 0 }
    total.count++; total.selfBytes += node.selfBytes; totals.set(key, total)
    if (node.type === 'string' && markers.some(prefix => node.name.startsWith(prefix)) && node.selfBytes > 256 * 1024) payload.push(i)
    if (node.type === 'native' && node.name === 'system / JSArrayBufferData' && node.selfBytes > 256 * 1024) buffers.push(i)
    if (node.type === 'object' && /^(Session|Agent|ReactLoopAgent|SessionHistoryController|SessionAssistantStreamAccumulator|ClientRequest|IncomingMessage)$/.test(node.name)) objects.push(i)
  }
  const payloadBytes = payload.reduce((sum, i) => sum + nodes[i * stride + sizeField]!, 0)
  return { nodeCount: count, stronglyReachable: tail, selfBytes: [...totals.values()].reduce((sum, row) => sum + row.selfBytes, 0),
    topSelf: [...totals.values()].sort((a, b) => b.selfBytes - a.selfBytes).slice(0, 20),
    constructors: [...totals.values()].filter(row => /^object:(Session|Agent|ReactLoopAgent|SessionHistoryController|SessionAssistantStreamAccumulator|ClientRequest|IncomingMessage)$/.test(row.name)),
    payloadCount: payload.length, payloadBytes,
    payloadPaths: payload.slice(0, 16).map(i => ({ ...label(i), holdingPath: holdingPath(i) })),
    objectPaths: objects.slice(0, 16).map(i => ({ ...label(i), holdingPath: holdingPath(i) })),
    largeBuffers: { count: buffers.length, selfBytes: buffers.reduce((sum, i) => sum + nodes[i * stride + sizeField]!, 0),
      paths: buffers.slice(0, 16).map(i => ({ ...label(i), holdingPath: holdingPath(i) })) },
    caution: 'Heap snapshot triggers V8 GC. Strong shortest paths explain sampled ownership; self bytes are not dominator retained bytes. No natural-residency claim.' }
}
