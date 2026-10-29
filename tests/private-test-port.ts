import { randomInt } from 'node:crypto'
import type { AddressInfo, Server } from 'node:net'

// This host's OS-assigned ports included Fetch-restricted 4045 and 6667.
// Use the high ephemeral range, then let the OS validate each candidate binding.
export const PRIVATE_TEST_PORT_MIN = 49_152
export const PRIVATE_TEST_PORT_MAX = 65_535
export const PRIVATE_TEST_PORT_ATTEMPTS = 16

export async function listenOnPrivateTestPort(server: Server): Promise<number> {
  let lastError: unknown
  for (let attempt = 0; attempt < PRIVATE_TEST_PORT_ATTEMPTS; attempt++) {
    const port = randomInt(PRIVATE_TEST_PORT_MIN, PRIVATE_TEST_PORT_MAX + 1)
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { server.off('error', onError); server.off('listening', onListening) }
        const onError = (error: Error) => { cleanup(); reject(error) }
        const onListening = () => { cleanup(); resolve() }
        server.once('error', onError); server.once('listening', onListening)
        try { server.listen(port, '127.0.0.1') } catch (error) { cleanup(); reject(error) }
      })
      return (server.address() as AddressInfo).port
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      if (code !== 'EADDRINUSE' && code !== 'EACCES') throw error
      lastError = error
    }
  }
  throw new Error(`Could not bind a private test port after ${PRIVATE_TEST_PORT_ATTEMPTS} candidates`, { cause: lastError })
}
