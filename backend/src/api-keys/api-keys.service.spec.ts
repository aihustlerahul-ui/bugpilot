import { createHash } from 'crypto'
import { NotFoundException } from '@nestjs/common'
import { ApiKeysService } from './api-keys.service'

type Row = Record<string, any>

// Minimal in-memory supabase fake: select/eq/order/insert/update/maybeSingle/single.
function makeDb(tables: Record<string, Row[]>) {
  const db = {
    from(table: string) {
      tables[table] = tables[table] ?? []
      let rows = [...tables[table]]
      let pendingInsert: Row | null = null
      let pendingUpdate: Row | null = null
      const b: any = {
        select: () => b,
        order: () => b,
        eq: (k: string, v: any) => ((rows = rows.filter((r) => r[k] === v)), b),
        is: (k: string, v: any) => ((rows = rows.filter((r) => (r[k] ?? null) === v)), b),
        insert: (row: Row) => {
          pendingInsert = { id: `id-${tables[table].length + 1}`, created_at: 'now', last_used_at: null, revoked_at: null, ...row }
          tables[table].push(pendingInsert)
          return b
        },
        update: (patch: Row) => ((pendingUpdate = patch), b),
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        single: () => Promise.resolve(pendingInsert ? { data: pendingInsert, error: null } : { data: rows[0] ?? null, error: rows[0] ? null : { message: 'no rows' } }),
        then: (res: any, rej: any) => {
          if (pendingUpdate) {
            rows.forEach((r) => Object.assign(tables[table].find((t) => t.id === r.id)!, pendingUpdate))
            return Promise.resolve({ data: rows, error: null }).then(res, rej)
          }
          return Promise.resolve({ data: rows, error: null }).then(res, rej)
        },
      }
      return b
    },
  }
  return db
}

function build() {
  const tables: Record<string, Row[]> = { api_keys: [] }
  const service = new ApiKeysService({ db: makeDb(tables) } as any)
  return { service, tables }
}

describe('ApiKeysService', () => {
  it('create returns a bp_live_ key and stores only its sha256 hash', async () => {
    const { service, tables } = build()
    const res = await service.create('u1', 'laptop')
    expect(res.key.startsWith('bp_live_')).toBe(true)
    expect(res.keyPrefix).toBe(res.key.slice(0, 12))
    const row = tables.api_keys[0]
    expect(row.key_hash).toBe(createHash('sha256').update(res.key).digest('hex'))
    expect(JSON.stringify(row)).not.toContain(res.key)
  })

  it('verify returns userId for a valid key', async () => {
    const { service, tables } = build()
    const { key, id } = await service.create('u1', 'laptop')
    await expect(service.verify(key)).resolves.toEqual({ userId: 'u1', keyId: id })
    expect(tables.api_keys[0].last_used_at).not.toBeNull()
  })

  it('verify returns null for an unknown key', async () => {
    const { service } = build()
    await service.create('u1', 'laptop')
    await expect(service.verify('bp_live_nope')).resolves.toBeNull()
  })

  it('verify returns null after revoke', async () => {
    const { service } = build()
    const { key, id } = await service.create('u1', 'laptop')
    await service.revoke('u1', id)
    await expect(service.verify(key)).resolves.toBeNull()
  })

  it('list never exposes key or hash', async () => {
    const { service } = build()
    const { key } = await service.create('u1', 'laptop')
    const list = await service.list('u1')
    expect(list).toHaveLength(1)
    expect(Object.keys(list[0]).sort()).toEqual(['createdAt', 'id', 'keyPrefix', 'lastUsedAt', 'name', 'revokedAt'])
    expect(JSON.stringify(list)).not.toContain(key)
  })

  it('revoke only affects keys owned by the caller', async () => {
    const { service, tables } = build()
    const { id, key } = await service.create('u1', 'laptop')
    await expect(service.revoke('u2', id)).rejects.toBeInstanceOf(NotFoundException)
    expect(tables.api_keys[0].revoked_at).toBeNull()
    await expect(service.verify(key)).resolves.not.toBeNull()
  })
})
