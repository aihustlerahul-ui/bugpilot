export type TrustProxyValue = boolean | number | string

export interface ParsedTrustProxy {
  value: TrustProxyValue
  warnings: string[]
}

// Parses TRUST_PROXY into an express 'trust proxy' setting. Returns undefined when unset.
// 'true' is deliberately treated as 1 hop: express's `true` trusts the left-most
// X-Forwarded-For entry, which a client can forge to dodge rate limits.
export function parseTrustProxy(raw?: string): ParsedTrustProxy | undefined {
  const value = raw?.trim()
  if (!value) return undefined
  const warnings: string[] = []
  if (value === 'true') {
    warnings.push(
      'TRUST_PROXY=true is treated as 1 hop. Set it to the real number of proxies in front of the app (or a subnet list) for accurate client IPs.',
    )
    return { value: 1, warnings }
  }
  if (value === 'false') return { value: false, warnings }
  if (/^\d+$/.test(value)) {
    const hops = Number(value)
    if (hops > 5) {
      warnings.push(
        `TRUST_PROXY=${hops} is a large hop count; it should equal the real number of proxies in front of the app.`,
      )
    }
    return { value: hops, warnings }
  }
  return { value, warnings }
}
