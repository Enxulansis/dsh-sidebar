import { createServer, type Server } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { listenOnPrivateTestPort, PRIVATE_TEST_PORT_MIN, PRIVATE_TEST_PORT_MAX, PRIVATE_TEST_PORT_ATTEMPTS } from './private-test-port.js'

const servers: Server[] = []
const serverOf = () => { const server = createServer((_req, res) => res.end('owned')); servers.push(server); return server }
afterEach(async () => {
  vi.restoreAllMocks()
  for (const server of servers.splice(0)) if (server.listening) {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

it.each([4045, 6667])('reproduces Fetch rejection before connecting to service port %i', async port => {
  await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toMatchObject({ cause: { message: 'bad port' } })
})

it('binds an actual Fetch-compatible loopback server in the private range', async () => {
  const server = serverOf(), port = await listenOnPrivateTestPort(server)
  expect(port).toBeGreaterThanOrEqual(PRIVATE_TEST_PORT_MIN); expect(port).toBeLessThanOrEqual(PRIVATE_TEST_PORT_MAX)
  const response = await fetch(`http://127.0.0.1:${port}/`)
  expect(await response.text()).toBe('owned')
  expect(server.listenerCount('error')).toBe(0)
})

it.each(['EADDRINUSE', 'EACCES'])('tries another candidate after simulated unavailable binding %s, without leaked listeners', async code => {
  const server = serverOf()
  const listeners = { error: server.listenerCount('error'), listening: server.listenerCount('listening') }
  vi.spyOn(server, 'address').mockReturnValue({ address: '127.0.0.1', family: 'IPv4', port: PRIVATE_TEST_PORT_MIN })
  const listen = vi.spyOn(server, 'listen').mockImplementationOnce(() => {
    queueMicrotask(() => server.emit('error', Object.assign(new Error('Unavailable candidate'), { code })))
    return server
  }).mockImplementationOnce(() => {
    queueMicrotask(() => server.emit('listening'))
    return server
  })
  const port = await listenOnPrivateTestPort(server)
  expect(listen).toHaveBeenCalledTimes(2)
  expect(port).toBe(PRIVATE_TEST_PORT_MIN)
  expect(server.listenerCount('error')).toBe(listeners.error)
  expect(server.listenerCount('listening')).toBe(listeners.listening)
})

it('does not retry unrelated server failures', async () => {
  const server = serverOf(), listen = vi.spyOn(server, 'listen').mockImplementationOnce(() => {
    queueMicrotask(() => server.emit('error', Object.assign(new Error('Unexpected bind error'), { code: 'EINVAL' })))
    return server
  })
  await expect(listenOnPrivateTestPort(server)).rejects.toThrow('Unexpected bind error')
  expect(listen).toHaveBeenCalledTimes(1); expect(server.listening).toBe(false)
})

it('bounds unavailable candidates and retains the final cause', async () => {
  const server = serverOf(), failure = Object.assign(new Error('Unavailable'), { code: 'EADDRINUSE' })
  const listeners = { error: server.listenerCount('error'), listening: server.listenerCount('listening') }
  const listen = vi.spyOn(server, 'listen').mockImplementation(() => { queueMicrotask(() => server.emit('error', failure)); return server })
  await expect(listenOnPrivateTestPort(server)).rejects.toMatchObject({ message: expect.stringContaining(String(PRIVATE_TEST_PORT_ATTEMPTS)), cause: failure })
  expect(listen).toHaveBeenCalledTimes(PRIVATE_TEST_PORT_ATTEMPTS)
  expect(server.listenerCount('error')).toBe(listeners.error); expect(server.listenerCount('listening')).toBe(listeners.listening)
})
