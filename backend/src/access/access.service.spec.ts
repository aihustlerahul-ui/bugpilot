import { NotFoundException } from '@nestjs/common'
import { AccessService } from './access.service'

type Call = { table: string; filters: Record<string, any> }

function makeDb(handler: (c: Call) => any) {
  return {
    from(table: string) {
      const call: Call = { table, filters: {} }
      const b: any = {
        select: () => b,
        order: () => b,
        eq: (k: string, v: any) => ((call.filters[`eq:${k}`] = v), b),
        in: (k: string, v: any) => ((call.filters[`in:${k}`] = v), b),
        ilike: (k: string, v: any) => ((call.filters[`ilike:${k}`] = v), b),
        maybeSingle: () => Promise.resolve({ data: handler(call), error: null }),
        then: (res: any, rej: any) =>
          Promise.resolve({ data: handler(call), error: null }).then(res, rej),
      }
      return b
    },
  }
}

const OWNED = { id: 'ws-1' }
const P_OWNED = { id: 'p1', workspace_id: 'ws-1', created_at: '2026-01-02' }
const P_OTHER = { id: 'p2', workspace_id: 'ws-2', created_at: '2026-01-03' }

function build(opts: { owner?: boolean; memberEmail?: string }) {
  const db = makeDb(({ table, filters }) => {
    if (table === 'projects') {
      if (filters['eq:id']) {
        return [P_OWNED, P_OTHER].find((p) => p.id === filters['eq:id']) ?? null
      }
      if (filters['eq:workspace_id']) return opts.owner ? [P_OWNED] : []
      if (filters['in:id']) return [P_OTHER].filter((p) => filters['in:id'].includes(p.id))
      return []
    }
    if (table === 'workspace_members') {
      const q = String(filters['ilike:email'] ?? '')
      return opts.memberEmail && q === opts.memberEmail.trim().toLowerCase()
        ? [{ id: 'm1' }]
        : opts.memberEmail && q.toLowerCase() === opts.memberEmail.trim().toLowerCase()
          ? [{ id: 'm1' }]
          : []
    }
    if (table === 'project_members') {
      const ids: string[] = filters['in:member_id'] ?? []
      if (!ids.includes('m1')) return []
      const row = { project_id: 'p2', member_id: 'm1' }
      if (filters['eq:project_id'] && filters['eq:project_id'] !== 'p2') return []
      return [row]
    }
    return []
  })
  const workspaces: any = {
    findByOwner: jest.fn(async () => {
      if (!opts.owner) throw new NotFoundException('Workspace not found')
      return OWNED
    }),
  }
  return new AccessService({ db } as any, workspaces)
}

describe('AccessService', () => {
  const user = { id: 'u1', email: 'jane@team.com' }

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
    expect(await s.getProjectRole({ id: 'u1', email: ' jane@team.com ' }, 'p2')).toBe('member')
  })

  it('lists member projects when user owns no workspace', async () => {
    const s = build({ memberEmail: 'jane@team.com' })
    const list = await s.listAccessibleProjects(user)
    expect(list).toEqual([{ ...P_OTHER, role: 'member' }])
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
})
