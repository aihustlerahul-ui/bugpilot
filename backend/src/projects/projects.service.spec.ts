import { NotFoundException } from '@nestjs/common'
import { ProjectsService } from './projects.service'

const owner = { id: 'u-owner', email: 'owner@x.com' }
const member = { id: 'u-member', email: 'member@x.com' }

function makeSupabase(rows: Record<string, any>) {
  // chainable query builder resolving to a project row by id
  return {
    db: {
      from: jest.fn(() => {
        let id: string | undefined
        let workspaceId: string | undefined
        const q: any = {
          select: () => q,
          eq: (col: string, val: string) => {
            if (col === 'id') id = val
            if (col === 'workspace_id') workspaceId = val
            return q
          },
          single: async () => {
            const row = id ? rows[id] : undefined
            if (!row || (workspaceId && row.workspace_id !== workspaceId)) {
              return { data: null, error: { message: 'not found' } }
            }
            return { data: row, error: null }
          },
          update: () => q,
          delete: () => q,
        }
        return q
      }),
    },
  }
}

describe('ProjectsService member access', () => {
  const rows = {
    p1: { id: 'p1', name: 'Own', workspace_id: 'ws1', settings: {} },
    p2: { id: 'p2', name: 'Shared', workspace_id: 'ws1', settings: {} },
  }
  let access: any
  let workspaces: any
  let service: ProjectsService

  beforeEach(() => {
    access = {
      listAccessibleProjects: jest.fn(),
      assertCanAccessProject: jest.fn(),
    }
    workspaces = {
      findByOwner: jest.fn(async (userId: string) => {
        if (userId === owner.id) return { id: 'ws1' }
        throw new NotFoundException('Workspace not found')
      }),
    }
    service = new ProjectsService(makeSupabase(rows) as any, workspaces, access)
  })

  it('findAll delegates to AccessService and returns role-tagged projects', async () => {
    const shared = [{ ...rows.p2, role: 'member' }]
    access.listAccessibleProjects.mockResolvedValue(shared)
    await expect(service.findAll(member)).resolves.toEqual(shared)
    expect(access.listAccessibleProjects).toHaveBeenCalledWith(member)
  })

  it('findOne returns a shared project with role for a member', async () => {
    access.assertCanAccessProject.mockResolvedValue('member')
    await expect(service.findOne(member, 'p2')).resolves.toEqual({ ...rows.p2, role: 'member' })
  })

  it('findOne throws NotFoundException for a project the user cannot access', async () => {
    access.assertCanAccessProject.mockRejectedValue(new NotFoundException('Project not found'))
    await expect(service.findOne(member, 'p1')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('findOne returns owner role for the owner', async () => {
    access.assertCanAccessProject.mockResolvedValue('owner')
    await expect(service.findOne(owner, 'p1')).resolves.toEqual({ ...rows.p1, role: 'owner' })
  })

  it('member cannot update or remove', async () => {
    await expect(service.update(member.id, 'p2', { name: 'x' } as any)).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.remove(member.id, 'p2')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('owner can still update and remove', async () => {
    await expect(service.update(owner.id, 'p1', { name: 'x' } as any)).resolves.toBeDefined()
    await expect(service.remove(owner.id, 'p1')).resolves.toEqual({ success: true })
  })
})
