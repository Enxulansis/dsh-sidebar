import { describe, expect, it } from 'vitest'
import { attachActiveFileIfNeeded, type AttachBridge } from '../src/auto-attach.js'

const fakeBridge = (activeFile?: { path: string }): AttachBridge & { calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    viewState: () => (activeFile === undefined ? {} : { activeFile }),
    attachActiveFile: (relativePath: string) => { calls.push(relativePath) },
  }
}

describe('auto-attach (bug⑧)', () => {
  it('does not attach when the include-context toggle is off', () => {
    const bridge = fakeBridge({ path: 'src/a.ts' })

    attachActiveFileIfNeeded(bridge, false)

    expect(bridge.calls).toEqual([])
  })

  it('attaches the current active file when the toggle is on', () => {
    const bridge = fakeBridge({ path: 'src/a.ts' })

    attachActiveFileIfNeeded(bridge, true)

    expect(bridge.calls).toEqual(['src/a.ts'])
  })

  it('does nothing when there is no active file in view state', () => {
    const bridge = fakeBridge()

    attachActiveFileIfNeeded(bridge, true)

    expect(bridge.calls).toEqual([])
  })

  it('passes the path through unchanged (normalization is the bridge\'s job)', () => {
    const bridge = fakeBridge({ path: 'a\\b\\c.ts' })

    attachActiveFileIfNeeded(bridge, true)

    expect(bridge.calls).toEqual(['a\\b\\c.ts'])
  })
})