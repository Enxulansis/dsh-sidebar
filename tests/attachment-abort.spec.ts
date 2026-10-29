import { createServer } from 'node:http'
import { expect, it } from 'vitest'
import { DshClient } from '../src/dsh-client.js'

it('propagates cancellation into the actual HTTP image body and releases the owned connection', async () => {
  let began!: () => void, closed!: () => void
  const started = new Promise<void>(r => { began = r }), stopped = new Promise<void>(r => { closed = r })
  const server = createServer((req, res) => {
    if (!req.url?.endsWith('/api/session/attachment')) { res.end(''); return }
    res.on('close', closed)
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(8 * 1024 * 1024) })
    res.write('{"type":"server-response","large":"' + 'A'.repeat(1024 * 1024))
    began()
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('No local address')
  const client = new DshClient(new URL(`http://127.0.0.1:${address.port}`)), abort = new AbortController()
  let deadline: ReturnType<typeof setTimeout> | undefined
  try {
    const response = client.attachment('private-session', 'private-image', abort.signal)
    const rejected = expect(response).rejects.toThrow()
    await started
    abort.abort()
    await rejected
    await Promise.race([stopped, new Promise((_, reject) => { deadline = setTimeout(() => reject(Error('Image connection did not close')), 3000) })])
  } finally {
    clearTimeout(deadline)
    client.dispose(); server.closeAllConnections()
    await new Promise<void>(r => server.close(() => r()))
  }
}, 10000)
