import { describe, expect, it } from 'vitest'
import { buildCompatMatrix, isVerifiedVersion } from '../src/compat-matrix.js'

describe('RC4 candidate compatibility matrix', () => {
  it('verifies only the exact tested backend', () => {
    expect(isVerifiedVersion('dsh', '0.2.1-rc.4')).toBe(true)
    expect(isVerifiedVersion('dsh', '0.2.1-rc.2')).toBe(false)
    expect(isVerifiedVersion('dsh', '0.2.2-alpha.2')).toBe(false)
    expect(isVerifiedVersion('dsh', '0.1.5-rc.1')).toBe(false)
    expect(isVerifiedVersion('dsh', '0.1.5')).toBe(false)
    expect(isVerifiedVersion('dsh', '0.1.1-rc.2')).toBe(false)
    expect(isVerifiedVersion('dsh', '0.1.6-alpha.2')).toBe(false)
    expect(isVerifiedVersion('dsh', '0.1.15')).toBe(false)
    expect(isVerifiedVersion('dsh-context', '0.52.2')).toBe(false)
    expect(isVerifiedVersion('dsh-context', '0.520.0')).toBe(false)
    expect(isVerifiedVersion('dsh-context', '0.34.0')).toBe(false)
    expect(isVerifiedVersion('unknown-plugin', '1.0.0')).toBe(false)
    expect(isVerifiedVersion('dsh', undefined)).toBe(false)
  })

  it('assembles the matrix and flags unverified combinations', () => {
    expect(buildCompatMatrix('0.2.1-rc.4', { 'dsh-context': '0.52.2' })).toEqual({
      dsh: { name: 'dsh', version: '0.2.1-rc.4', verified: true },
      plugins: [{ name: 'dsh-context', version: '0.52.2', verified: false }],
      anyUnverified: true,
    })
    expect(buildCompatMatrix('0.1.1-rc.2', { 'dsh-context': '0.52.2' }).anyUnverified).toBe(true)
    expect(buildCompatMatrix('0.1.5-rc.1', { 'dsh-context': undefined }).anyUnverified).toBe(true)
    expect(buildCompatMatrix(undefined, {}).plugins).toEqual([{ name: 'dsh-context', version: undefined, verified: false }])
  })
})
