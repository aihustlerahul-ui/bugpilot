import { NotFoundException } from '@nestjs/common'
import { AccessService } from './access.service'

type Call = { table: string; filters: Record<string, any> }

// PostgREST ilike semantics: `*` behaves like `%`; `\\` escapes the next char.
function pgIlike(value: string, pattern: string): boolean {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\' && i + 1 < pattern.length) {
      re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    } else if (c === '%' || c === '*') re += '.*'
    else if (c === '_') re += '.'
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'is').test(value)
}

function makeDb(handler: (c: Call) => any, opts: { projectErrorCode?: string } = {}) {
  const calls: Call[] = []
  const db = {
    from(table: string) {
      const call: Call = { table, filters: {} }
      calls.push(call)
      const b: any = {
        select: (cols?: string) => ((call.filters.select = cols), b),
        order: () => b,
        eq: (k: string, v: any) => ((call.filters[`eq:${k}`] = v), b),
        in: (k: string, v: any) => ((call.filters[`in:${k}`] = v), b),
        ilike: (k: string, v: any) => ((call.filters[`ilike:${k}`] = v), b),
        maybeSingle: () =>
          Promise.resolve(
            table === 'projects' && opts.projectErrorCode
              ? { data: null, error: { code: opts.projectErrorCode, message: 'invalid input syntax for type uuid' } }
              : { data: handler(call), error: null },
          ),
        then: (res: any, rej: any) =>
          Promise.resolve({ data: handler(call), error: null }).then(res, rej),
      }
      return b
    },
  }
  return { db, calls }
}

const OWNED = { id: 'ws-1' }
const P_OWNED = { id: 'p1', workspace_id: 'ws-1', created_at: '2026-01-02' }
const P_OTHER = { id: 'p2', workspace_id: 'ws-2', created_at: '2026-01-03' }

const P_OTHER_FULL = {
  ...P_OTHER,
  name: 'Shared',
  sync_mode: 'manual',
  secret_column: 'owner-only',
  settings: { description: 'desc', default_view: 'kanban', integration_token: 'secret' },
}

function build(
  opts: { owner?: boolean; memberEmail?: string; members?: Array<{ id: string; email: string }>; projectErrorCode?: string },
) {
  const members = opts.members ?? (opts.memberEmail ? [{ id: 'm1', email: opts.memberEmail }] : [])
  const { db, calls } = makeDb(({ table, filters }) => {
    if (table === 'projects') {
      if (filters['eq:id']) {
        return [P_OWNED, P_OTHER].find((p) => p.id === filters['eq:id']) ?? null
      }
      if (filters['eq:workspace_id']) return opts.owner ? [P_OWNED] : []
      if (filters['in:id']) return [P_OTHER_FULL].filter((p) => filters['in:id'].includes(p.id))
      return []
    }
    if (table === 'workspace_members') {
      const eq = filters['eq:email']
      const like = filters['ilike:email']
      if (eq !== undefined) return members.filter((m) => m.email === eq)
      if (like !== undefined) return members.filter((m) => pgIlike(m.email, String(like)))
      return []
    }
    if (table === 'project_members') {
      const ids: string[] = filters['in:member_id'] ?? []
      if (!ids.includes('m1')) return []
      const row = { project_id: 'p2', member_id: 'm1' }
      if (filters['eq:project_id'] && filters['eq:project_id'] !== 'p2') return []
      return [row]
    }
    return []
  }, { projectErrorCode: opts.projectErrorCode })
  const workspaces: any = {
    findByOwner: jest.fn(async () => {
      if (!opts.owner) throw new NotFoundException('Workspace not found')
      return OWNED
    }),
  }
  const service = new AccessService({ db } as any, workspaces)
  ;(service as any).__calls = calls
  return service
}

const memberLookups = (s: AccessService): Call[] =>
  ((s as any).__calls as Call[]).filter((c) => c.table === 'workspace_members')

describe('AccessService', () => {
  const user = { id: 'u1', email: 'jane@team.com', emailVerified: true }

  it('returns owner for project in own workspace', async () => {
    const s = build({ owner: true })
    expect(await s.getProjectRole(user, 'p1')).toBe('owner')
  })

  it('returns member when linked via workspace_members email', async () => {
    const s = build({ memberEmail: 'jane@team.com' })
    expect(await s.getProjectRole(user, 'p2')).toBe('member')
  })

  it('returns null for unrelated project', async () => {
    const s = build({ memberEmail: 'other@team.com' })
    expect(await s.getProjectRole(user, 'p2')).toBeNull()
  })

  it('matches email case-insensitively and trimmed', async () => {
    const s = build({ memberEmail: 'Jane@Team.com' })
    expect(await s.getProjectRole({ id: 'u1', email: ' jane@team.com ', emailVerified: true }, 'p2')).toBe('member')
  })

  it('lists member projects when user owns no workspace', async () => {
    const s = build({ memberEmail: 'jane@team.com' })
    const list = await s.listAccessibleProjects(user)
    expect(list.map((p) => [p.id, p.role])).toEqual([['p2', 'member']])
  })

  it('lists owned and member projects newest first without duplicates', async () => {
    const s = build({ owner: true, memberEmail: 'jane@team.com' })
    const list = await s.listAccessibleProjects(user)
    expect(list.map((p) => [p.id, p.role])).toEqual([
      ['p2', 'member'],
      ['p1', 'owner'],
    ])
  })

  it('assertCanAccessProject throws NotFound when no role', async () => {
    const s = build({})
    await expect(s.assertCanAccessProject(user, 'p2')).rejects.toThrow(NotFoundException)
  })

  it('assertCanAccessProject returns role', async () => {
    const s = build({ owner: true })
    await expect(s.assertCanAccessProject(user, 'p1')).resolves.toBe('owner')
  })
  describe('email trust boundary (C2)', () => {
    it('sends the exact normalized email as the lookup filter', async () => {
      const s = build({ memberEmail: 'jane@team.com' })
      expect(await s.getProjectRole({ id: 'u1', email: ' Jane@Team.COM ', emailVerified: true }, 'p2')).toBe('member')
      const [lookup] = memberLookups(s)
      const value = lookup.filters['ilike:email'] ?? lookup.filters['eq:email']
      expect(value).toBe('jane@team.com')
    })

    it('gives no member access to an unverified email, and never queries members', async () => {
      const s = build({ memberEmail: 'jane@team.com' })
      expect(await s.getProjectRole({ id: 'u1', email: 'jane@team.com', emailVerified: false }, 'p2')).toBeNull()
      expect(await s.getProjectRole({ id: 'u1', email: 'jane@team.com' }, 'p2')).toBeNull()
      expect(await s.listAccessibleProjects({ id: 'u1', email: 'jane@team.com' })).toEqual([])
      expect(memberLookups(s)).toHaveLength(0)
    })

    it('does not let a "*@gmail.com" account match every gmail member', async () => {
      const s = build({ members: [{ id: 'm1', email: 'victim@gmail.com' }] })
      const attacker = { id: 'evil', email: '*@gmail.com', emailVerified: true }
      expect(await s.getProjectRole(attacker, 'p2')).toBeNull()
      expect(await s.listAccessibleProjects(attacker)).toEqual([])
    })

    it('does not let "%" or "_" over-match', async () => {
      const s = build({ members: [{ id: 'm1', email: 'axb@x.com' }] })
      expect(await s.getProjectRole({ id: 'u1', email: 'a_b@x.com', emailVerified: true }, 'p2')).toBeNull()
      expect(await s.getProjectRole({ id: 'u1', email: '%', emailVerified: true }, 'p2')).toBeNull()
      expect(await s.getProjectRole({ id: 'u1', email: '%@x.com', emailVerified: true }, 'p2')).toBeNull()
    })

    it('still matches a legitimate address containing "_" exactly', async () => {
      const s = build({ members: [{ id: 'm1', email: 'A_B@x.com' }] })
      expect(await s.getProjectRole({ id: 'u1', email: 'a_b@x.com', emailVerified: true }, 'p2')).toBe('member')
    })

    it('owner access does not depend on emailVerified', async () => {
      const s = build({ owner: true })
      expect(await s.getProjectRole({ id: 'u1', email: 'o@x.com', emailVerified: false }, 'p1')).toBe('owner')
      expect((await s.listAccessibleProjects({ id: 'u1', email: '' })).map((p) => p.id)).toEqual(['p1'])
    })
  })

  describe('invalid ids (M1)', () => {
    it('treats a non-UUID project id (Postgres 22P02) as not found', async () => {
      const s = build({ owner: true, projectErrorCode: '22P02' })
      expect(await s.getProjectRole(user, 'not-a-uuid')).toBeNull()
      await expect(s.assertCanAccessProject(user, 'not-a-uuid')).rejects.toThrow(NotFoundException)
    })

    it('still throws other database errors', async () => {
      const s = build({ owner: true, projectErrorCode: '57014' })
      await expect(s.getProjectRole(user, 'p1')).rejects.toThrow()
    })
  })

  describe('member project view (M2)', () => {
    it('returns only safe columns and settings keys to members', async () => {
      const s = build({ memberEmail: 'jane@team.com' })
      const [p] = await s.listAccessibleProjects(user)
      expect(p).toEqual({
        id: 'p2',
        name: 'Shared',
        workspace_id: 'ws-2',
        sync_mode: 'manual',
        created_at: '2026-01-03',
        settings: { description: 'desc', default_view: 'kanban' },
        role: 'member',
      })
    })
  })
})
