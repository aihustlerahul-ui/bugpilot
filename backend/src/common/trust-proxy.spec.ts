import { parseTrustProxy } from './trust-proxy'

describe('parseTrustProxy', () => {
  it('returns undefined when unset or empty', () => {
    expect(parseTrustProxy(undefined)).toBeUndefined()
    expect(parseTrustProxy('')).toBeUndefined()
    expect(parseTrustProxy('  ')).toBeUndefined()
  })
  it("treats 'true' as 1 hop with a warning", () => {
    const r = parseTrustProxy('true')!
    expect(r.value).toBe(1)
    expect(r.warnings).toHaveLength(1)
  })
  it('parses hop counts and warns above 5', () => {
    expect(parseTrustProxy('2')).toEqual({ value: 2, warnings: [] })
    const big = parseTrustProxy('10')!
    expect(big.value).toBe(10)
    expect(big.warnings).toHaveLength(1)
  })
  it("parses 'false'", () => {
    expect(parseTrustProxy('false')).toEqual({ value: false, warnings: [] })
  })
  it('passes subnet lists and other strings through unchanged', () => {
    expect(parseTrustProxy('10.0.0.0/8')).toEqual({ value: '10.0.0.0/8', warnings: [] })
    expect(parseTrustProxy('garbage')).toEqual({ value: 'garbage', warnings: [] })
  })
})
