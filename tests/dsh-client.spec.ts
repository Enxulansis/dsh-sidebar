import { afterEach, describe, expect, it, vi } from 'vitest'
import { DshClient, DshRpcError } from '../src/dsh-client.js'
import { createServer } from 'node:http'
import { listenOnPrivateTestPort } from './private-test-port.js'

/* 0.1.5 适配（批次 1）：断言点随协议更新——方法名斜杠化、args 包装、page 游标语义、
   records→events 映射、commands/execute 的 submittedAttachments 信封。 */
describe('DshClient queue protocol', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it.each(['ECONNRESET', 'UND_ERR_SOCKET'])('retries a read-only settings connection failure once: %s', async code => {
    let requests = 0
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init?: RequestInit) => {
      if (url.pathname === '/') return new Response()
      if (++requests === 1) throw new TypeError('fetch failed', { cause: { code } })
      const request = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: { namespaces: [] } } }))
    }))
    const client = new DshClient(new URL('http://127.0.0.1:31415'))
    try { await expect(client.settings()).resolves.toEqual({ namespaces: [] }); expect(requests).toBe(2) }
    finally { client.dispose() }
  })

  it('does not retry settings indefinitely when both connections reset', async () => {
    let requests = 0
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      if (url.pathname === '/') return new Response()
      requests++; throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })
    }))
    const client = new DshClient(new URL('http://127.0.0.1:31415'))
    try { await expect(client.settings()).rejects.toThrow('fetch failed'); expect(requests).toBe(2) }
    finally { client.dispose() }
  })

  it('uses only the remaining timeout budget for the settings retry', async () => {
    let requests = 0, now = 1000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const timeouts = vi.spyOn(AbortSignal, 'timeout')
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init?: RequestInit) => {
      if (url.pathname === '/') return new Response()
      if (++requests === 1) { now += 20000; throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }) }
      const request = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: { namespaces: [] } } }))
    }))
    const client = new DshClient(new URL('http://127.0.0.1:31415'))
    try { await client.settings(); expect(timeouts.mock.calls.map(args => args[0]).slice(-2)).toEqual([30000, 10000]) }
    finally { client.dispose(); clock.mockRestore(); timeouts.mockRestore() }
  })

  it.each(['business', 'http', 'timeout', 'disposed', 'deadline', 'mutation', 'prompt'])('does not replay unsafe or ineligible settings calls: %s', async mode => {
    let requests = 0, now = 1000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    let client!: DshClient
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init?: RequestInit) => {
      if (url.pathname === '/') return new Response()
      requests++
      const request = JSON.parse(String(init?.body))
      if (mode === 'business') return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result: { ok: false, error: { message: 'validation failed' } } }))
      if (mode === 'http') return new Response('', { status: 503 })
      if (mode === 'timeout') throw new DOMException('timeout', 'TimeoutError')
      if (mode === 'disposed') client.dispose()
      if (mode === 'deadline') now += 30000
      throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })
    }))
    client = new DshClient(new URL('http://127.0.0.1:31415'))
    try {
      const operation = mode === 'mutation' ? client.mutateSettings('fixture', [], 0) : mode === 'prompt' ? client.prompt('s', 'fixture') : client.settings()
      await expect(operation).rejects.toThrow()
      expect(requests).toBe(1)
    } finally { client.dispose(); clock.mockRestore() }
  })

  it('retries a read-only page reset and still honors the runtime cursor probe', async () => {
    const cursors: number[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init?: RequestInit) => {
      if (url.pathname === '/') return new Response()
      const request = JSON.parse(String(init?.body))
      cursors.push(request.payload.args.request.throughSeq)
      if (cursors.length === 1) throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })
      const result = cursors.length === 2 ? { ok: false, error: { message: 'past cursor 17' } } : { ok: true, value: { records: [], hasMore: false } }
      return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result }))
    }))
    const client = new DshClient(new URL('http://127.0.0.1:31415'))
    try { await expect(client.historyQuiet('s', 20)).resolves.toEqual({ events: [], hasMore: false }); expect(cursors).toEqual([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 17]) }
    finally { client.dispose() }
  })

  it('does not retry a page reset after its owner cancels', async () => {
    const abort = new AbortController(); let requests = 0
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      if (url.pathname === '/') return new Response()
      requests++; abort.abort(); throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })
    }))
    const client = new DshClient(new URL('http://127.0.0.1:31415'))
    try { await expect(client.historyQuiet('s', 20, undefined, abort.signal)).rejects.toThrow('fetch failed'); expect(requests).toBe(1) }
    finally { client.dispose() }
  })

  it('returns the prompt admission identity used by both echo and queued-message source', async () => {
    const ids: Array<{ transport: string; admission: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init?: RequestInit) => {
      if (url.pathname === '/') return new Response()
      const request = JSON.parse(String(init?.body))
      ids.push({ transport: request.rpcId, admission: request.payload.args.request.requestId })
      return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: { accepted: true } } }))
    }))
    const client = new DshClient(new URL('http://127.0.0.1:31415'))
    try {
      const first = await client.prompt('session-1', 'queued'), second = await client.prompt('session-1', 'steering', [], 'steer')
      expect(ids[0]?.admission).not.toBe(ids[0]?.transport)
      expect(first.rpcId).toBe(ids[0]?.admission)
      expect(second.rpcId).toBe(ids[1]?.admission)
      expect(first.rpcId).not.toBe(second.rpcId)
    } finally { client.dispose() }
  })

  it('preserves the stable cancellation code rather than reporting a transport failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init?: RequestInit) => {
      if (url.pathname === '/') return new Response()
      const request = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result: { ok: false, error: { code: 'gateway/cancelled', message: 'Message preparation was cancelled.', details: {} } } }))
    }))
    const client = new DshClient(new URL('http://127.0.0.1:31415'))
    try { const error = await client.prompt('a', 'cancelled').catch(e => e); expect(error).toBeInstanceOf(DshRpcError); expect(error.code).toBe('gateway/cancelled') }
    finally { client.dispose() }
  })

  it('cancels a pending search HTTP request and permits the next query to finish', async () => {
    let received!: () => void
    let disconnected!: () => void
    const started = new Promise<void>(resolve => { received = resolve })
    const closed = new Promise<void>(resolve => { disconnected = resolve })
    const server = createServer((req, res) => {
      if (req.method !== 'POST') { res.end(); return }
      let body = ''
      req.on('data', chunk => { body += String(chunk) })
      req.on('end', () => {
        const request = JSON.parse(body)
        if (request.payload.args.request.query === 'old') {
          res.on('close', disconnected)
          received()
          return
        }
        res.end(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: { items: [], hasMore: false } } }))
      })
    })
    await listenOnPrivateTestPort(server)
    const address = server.address() as { port: number }
    const client = new DshClient(new URL(`http://127.0.0.1:${address.port}`))
    const abort = new AbortController()
    try {
      const pending = client.searchSessions('old', abort.signal)
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await started
      abort.abort()
      await rejected
      await closed
      await expect(client.searchSessions('new')).resolves.toEqual({ items: [], hasMore: false })
    } finally {
      abort.abort()
      client.dispose()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('does not send a search canceled while authentication was pending', async () => {
    let authenticate!: (value: Response) => void
    const auth = new Promise<Response>(resolve => { authenticate = resolve })
    const fetchMock = vi.fn(() => auth)
    vi.stubGlobal('fetch', fetchMock)
    const client = new DshClient(new URL('http://127.0.0.1:31415'))
    const abort = new AbortController()
    const pending = client.searchSessions('old', abort.signal)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    abort.abort()
    authenticate(new Response())
    await rejected
    expect(fetchMock).toHaveBeenCalledTimes(1)
    client.dispose()
  })

  it('cancels the metadata list request owned by a search', async () => {
    let signal!: AbortSignal
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init?: RequestInit) => {
      if (url.pathname === '/') return new Response()
      signal = init!.signal as AbortSignal
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }))
    const client = new DshClient(new URL('http://127.0.0.1:31415'))
    const abort = new AbortController()
    const pending = client.listSessions(abort.signal)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(signal).toBeDefined())
    abort.abort()
    await rejected
    expect(signal.aborted).toBe(true)
    client.dispose()
  })

  it('uses real provider and credential RPC contracts without placing the key in settings', async () => {
    const requests: Array<{ method: string; payload: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body))
      requests.push({ method: request.method, payload: request.payload })
      return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: [] } }))
    }))
    const client = new DshClient(new URL('http://127.0.0.1:31415'))
    await client.configurableProviders()
    await client.describeCredentials(['REF'])
    await client.setCredential('REF', 'mock-key')
    await client.unsetCredential('REF')
    await client.discoverModels('llm-pi-ai', { provider: 'openai' })
    expect(requests).toEqual([
      { method: 'llm/listConfigurableProviders', payload: { args: {} } },
      { method: 'credentials/describe', payload: { args: { refs: ['REF'] } } },
      { method: 'credentials/set', payload: { args: { ref: 'REF', value: 'mock-key' } } },
      { method: 'credentials/unset', payload: { args: { ref: 'REF' } } },
      { method: 'llm/discoverModels', payload: { args: { settingsNs: 'llm-pi-ai', request: { provider: 'openai' } } } },
    ])
    client.dispose()
  })

  it('sends direct steering and official queue mutations through their real RPC methods', async () => {
    const requests: Array<{ method: string; payload: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string; payload: unknown }
      requests.push({ method: request.method, payload: request.payload })
      return new Response(JSON.stringify({
        type: 'server-response',
        rpcId: request.rpcId,
        result: { ok: true, value: { accepted: true } },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const client = new DshClient(new URL('http://127.0.0.1:31415'))

    await client.prompt('session-1', 'Change direction', [], 'steer')
    await client.updateQueue('session-1', 'item-1', {
      kind: 'edit',
      content: [{ type: 'text', text: 'Updated follow-up' }],
    })
    await client.updateQueue('session-1', 'item-1', { kind: 'steer' })

    expect(requests).toEqual([
      {
        method: 'session/prompt',
        payload: {
          args: {
            request: expect.objectContaining({
              sessionId: 'session-1',
              mode: 'steer',
              content: [{ type: 'text', text: 'Change direction' }],
            }),
          },
        },
      },
      {
        method: 'session/updateQueue',
        payload: {
          args: {
            request: {
              sessionId: 'session-1',
              itemId: 'item-1',
              action: { kind: 'edit', content: [{ type: 'text', text: 'Updated follow-up' }] },
            },
          },
        },
      },
      {
        method: 'session/updateQueue',
        payload: {
          args: {
            request: { sessionId: 'session-1', itemId: 'item-1', action: { kind: 'steer' } },
          },
        },
      },
    ])
  })

  it('reads the official runtime plugin inventory without inventing a management RPC', async () => {
    const requests: Array<{ method: string; payload: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string; payload: unknown }
      requests.push({ method: request.method, payload: request.payload })
      return new Response(JSON.stringify({
        type: 'server-response',
        rpcId: request.rpcId,
        result: {
          ok: true,
          value: {
            entries: [{
              entryId: 'plugin-1',
              moduleName: '@example/runtime-plugin',
              enabled: true,
              fiberPhase: 'active',
            }],
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const client = new DshClient(new URL('http://127.0.0.1:31415'))

    await expect(client.pluginInventory()).resolves.toEqual({
      entries: [{
        entryId: 'plugin-1',
        moduleName: '@example/runtime-plugin',
        enabled: true,
        fiberPhase: 'active',
      }],
    })
    expect(requests).toEqual([{ method: 'pluginInventory/list', payload: { args: {} } }])
  })

  it('reads a durable image through its authorizing session', async () => {
    const requests: Array<{ method: string; payload: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string; payload: unknown }
      requests.push({ method: request.method, payload: request.payload })
      return new Response(JSON.stringify({
        type: 'server-response',
        rpcId: request.rpcId,
        result: {
          ok: true,
          value: {
            attachment: {
              attachmentId: 'sha256:image',
              mediaType: 'image/png',
              bytes: 3,
              width: 1,
              height: 1,
            },
            data: 'YWJj',
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const client = new DshClient(new URL('http://127.0.0.1:31415'))

    await expect(client.attachment('session-1', 'sha256:image')).resolves.toMatchObject({ data: 'YWJj' })
    expect(requests).toEqual([{
      method: 'session/attachment',
      payload: { args: { request: { sessionId: 'session-1', attachmentId: 'sha256:image' } } },
    }])
  })

  it('describes and mutates official runtime settings with revision protection', async () => {
    const requests: Array<{ method: string; payload: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string; payload: unknown }
      requests.push({ method: request.method, payload: request.payload })
      return new Response(JSON.stringify({
        type: 'server-response',
        rpcId: request.rpcId,
        result: { ok: true, value: request.method === 'settings/describe'
          ? { writable: true, hasDocument: true, namespaces: [] }
          : { ns: 'agent-loop', revision: 4 } },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const client = new DshClient(new URL('http://127.0.0.1:31415'))

    await client.settings()
    await client.mutateSettings('agent-loop', [{
      op: 'set', path: ['maxParallelToolCalls'], value: 4,
    }], 3)

    expect(requests).toEqual([
      { method: 'settings/describe', payload: { args: {} } },
      {
        method: 'settings/mutate',
        payload: {
          args: {
            ns: 'agent-loop',
            ops: [{ op: 'set', path: ['maxParallelToolCalls'], value: 4 }],
            expectedRevision: 3,
          },
        },
      },
    ])
  })

  it('requests history through session/page with the probing throughSeq cursor', async () => {
    const requests: Array<{ method: string; payload: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string; payload: unknown }
      requests.push({ method: request.method, payload: request.payload })
      return new Response(JSON.stringify({
        type: 'server-response', rpcId: request.rpcId,
        result: { ok: true, value: { records: [], hasMore: false } },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const client = new DshClient(new URL('http://127.0.0.1:31415'))

    await client.history('session-1')
    await client.history('session-1', 42)
    await client.history('session-1', undefined, 3000)
    await client.history('session-1', undefined, 999_999)

    expect(requests).toEqual([
      {
        method: 'session/page',
        payload: {
          args: {
            request: {
              address: { kind: 'session', sessionId: 'session-1' },
              throughSeq: Number.MAX_SAFE_INTEGER,
              maxMessages: 500,
            },
          },
        },
      },
      {
        method: 'session/page',
        payload: {
          args: {
            request: {
              address: { kind: 'session', sessionId: 'session-1' },
              throughSeq: Number.MAX_SAFE_INTEGER,
              beforeSeq: 42,
              maxMessages: 500,
            },
          },
        },
      },
      /* 0.0.154："打开即全量"——显式 maxMessages 透传（分页默认 100→500；上限 20000 自夹取）。 */
      {
        method: 'session/page',
        payload: {
          args: {
            request: {
              address: { kind: 'session', sessionId: 'session-1' },
              throughSeq: Number.MAX_SAFE_INTEGER,
              maxMessages: 3000,
            },
          },
        },
      },
      {
        method: 'session/page',
        payload: {
          args: {
            request: {
              address: { kind: 'session', sessionId: 'session-1' },
              throughSeq: Number.MAX_SAFE_INTEGER,
              maxMessages: 20000,
            },
          },
        },
      },
    ])
  })

  it('maps session/page records into history entries (0.1.5)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { rpcId: string }
      return new Response(JSON.stringify({
        type: 'server-response', rpcId: request.rpcId,
        result: { ok: true, value: {
          records: [{ event: { type: 'user/message', seq: 7, time: 1, data: { role: 'user' } } }],
          hasMore: true,
        } },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const client = new DshClient(new URL('http://127.0.0.1:31415'))

    const page = await client.history('session-1')

    expect(page.hasMore).toBe(true)
    expect(page.events).toEqual([{ event: { type: 'user/message', seq: 7, time: 1, data: { role: 'user' } } }])
  })

  it('synthesizes the 0.1.1 diff view for write/edit records (0.1.5 carries no server view)', async () => {
    const write = {
      type: 'tool/call', seq: 3, time: 3,
      data: { turn: 1, step: 1, callId: 'c1', name: 'write', arguments: JSON.stringify({ file_path: 'a.txt', content: 'hi' }) },
    }
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { rpcId: string }
      return new Response(JSON.stringify({
        type: 'server-response', rpcId: request.rpcId,
        result: { ok: true, value: { records: [{ event: write }], hasMore: false } },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const client = new DshClient(new URL('http://127.0.0.1:31415'))

    const page = await client.history('session-1')

    expect(page.events).toEqual([{
      event: write,
      view: { for: 'call', view: { card: 'diff', title: 'write a.txt', diffs: [{ path: 'a.txt', oldText: null, newText: 'hi' }] } },
    }])
  })

  it('wraps command images in the submittedAttachments envelope (always present)', async () => {
    const requests: Array<{ method: string; payload: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string; payload: unknown }
      requests.push({ method: request.method, payload: request.payload })
      return new Response(JSON.stringify({
        type: 'server-response', rpcId: request.rpcId,
        result: {
          ok: true,
          value: { commandId: 'command-1', result: { kind: 'success' } },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const client = new DshClient(new URL('http://127.0.0.1:31415'))

    await client.executeCommand('session-1', '/compact')
    await client.executeCommand('session-1', '/plan inspect this', [{
      type: 'image',
      mediaType: 'image/png',
      data: 'YWJj',
      name: 'diagram.png',
    }])

    expect(requests).toEqual([
      {
        method: 'commands/execute',
        payload: { args: { agentId: 'session-1', line: '/compact', submittedAttachments: [] } },
      },
      {
        method: 'commands/execute',
        payload: {
          args: {
            agentId: 'session-1',
            line: '/plan inspect this',
            submittedAttachments: [{ type: 'image', mediaType: 'image/png', data: 'YWJj', name: 'diagram.png' }],
          },
        },
      },
    ])
  })
})
