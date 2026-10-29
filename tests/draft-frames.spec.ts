import { describe, expect, it } from 'vitest'
import { draftFrameSelectionsOf, expandedDraftImages, MAX_DRAFT_FRAME_SELECTIONS } from '../src/draft-frames.js'

describe('Draft frame selections (0.0.79)', () => {
  it('normalizes data URLs to raw base64, dedupes by index and sorts ascending', () => {
    expect(draftFrameSelectionsOf([
      { index: 2, data: 'data:image/png;base64,BBB' },
      { index: 0, data: 'AAA' },
      { index: 2, data: 'CCC' },
      { index: -1, data: 'X' },
      { index: 1.5, data: 'X' },
      { index: 3, data: '' },
      null,
    ])).toEqual([
      { index: 0, data: 'AAA' },
      { index: 2, data: 'CCC' },
    ])
  })

  it('caps the selection at the maximum', () => {
    const raw = Array.from({ length: 20 }, (_, index) => ({ index, data: 'D' + String(index) }))
    const frames = draftFrameSelectionsOf(raw)
    expect(frames).toHaveLength(MAX_DRAFT_FRAME_SELECTIONS)
    expect(frames[MAX_DRAFT_FRAME_SELECTIONS - 1]?.index).toBe(MAX_DRAFT_FRAME_SELECTIONS - 1)
  })

  it('expands selected frames to one PNG per frame and passes plain entries through', () => {
    const gif = { type: 'image' as const, mediaType: 'image/gif' as const, data: 'GIFDATA', name: 'anim.gif' }
    expect(expandedDraftImages([gif])).toEqual([gif])
    expect(expandedDraftImages([
      { ...gif, frameSelections: [{ index: 0, data: 'P0' }, { index: 2, data: 'P2' }] },
      { type: 'image', mediaType: 'image/png', data: 'PLAIN', name: 'b.png' },
    ])).toEqual([
      { type: 'image', mediaType: 'image/png', data: 'P0', name: 'anim.gif' },
      { type: 'image', mediaType: 'image/png', data: 'P2', name: 'anim.gif' },
      { type: 'image', mediaType: 'image/png', data: 'PLAIN', name: 'b.png' },
    ])
    expect(expandedDraftImages([{ ...gif, frameSelections: [] }])).toEqual([{ ...gif, frameSelections: [] }])
  })
})
