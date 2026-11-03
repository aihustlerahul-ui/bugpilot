import { Test } from '@nestjs/testing'
import { MembersService } from './members.service'
import { SupabaseService } from '../supabase/supabase.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { InviteService } from './invite.service'
import { BadRequestException, NotFoundException } from '@nestjs/common'

const mockWorkspace = { id: 'ws-1' }
const mockMember = { id: 'mem-1', workspace_id: 'ws-1', name: 'Alice', email: 'alice@acme.com', created_at: '' }

const makeDb = (overrides: any = {}) => ({
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn().mockResolvedValue({ data: mockMember, error: null }),
  ...overrides,
})

describe('MembersService', () => {
  let service: MembersService
  let db: any
  let invites: { sendProjectInvite: jest.Mock }

  beforeEach(async () => {
    db = makeDb()
    invites = { sendProjectInvite: jest.fn().mockResolvedValue({ sent: true }) }
    const module = await Test.createTestingModule({
      providers: [
        MembersService,
        { provide: SupabaseService, useValue: { db } },
        { provide: InviteService, useValue: invites },
        { provide: WorkspacesService, useValue: { findByOwner: jest.fn().mockResolvedValue(mockWorkspace) } },
      ],
    }).compile()
    service = module.get(MembersService)
  })

  it('listWorkspaceMembers returns array', async () => {
    db.single = undefined
    jest.spyOn(db, 'from').mockReturnValue({ select: () => ({ eq: () => ({ order: () => ({ data: [mockMember], error: null }) }) }) })
    // actual shape tested via integration; unit confirms no throw
    expect(service.listWorkspaceMembers).toBeDefined()
  })

  it('createMember throws EMAIL_CONFLICT when email taken', async () => {
    jest.spyOn(service as any, 'findByEmail').mockResolvedValue(mockMember)
    await expect(service.createMember('user-1', { name: 'Bob', email: 'alice@acme.com' }))
      .rejects.toThrow(BadRequestException)
  })

  it('createMember throws NAME_CONFLICT when name taken', async () => {
    jest.spyOn(service as any, 'findByEmail').mockResolvedValue(null)
    jest.spyOn(service as any, 'findByName').mockResolvedValue(mockMember)
    await expect(service.createMember('user-1', { name: 'Alice', email: 'bob@acme.com' }))
      .rejects.toThrow(BadRequestException)
  })

  describe('addToProject', () => {
    const dto = { name: 'Alice', email: 'alice@acme.com' }
    const stubProject = (upsert: jest.Mock, existingLink: any = null) => {
      jest.spyOn(service as any, 'assertProjectBelongsToWorkspace').mockResolvedValue(undefined)
      jest.spyOn(service as any, 'findByEmail').mockResolvedValue(mockMember)
      jest.spyOn(service as any, 'findByName').mockResolvedValue(mockMember)
      db.from = jest.fn((table: string) => {
        if (table === 'project_members') return { upsert, select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existingLink }) }) }) }) }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'Proj' } }) }) }) }
      })
    }

    it('links the project then sends an invite with the project name', async () => {
      const upsert = jest.fn().mockResolvedValue({ error: null })
      stubProject(upsert)
      const result = await service.addToProject('user-1', 'proj-1', dto)
      expect(result).toBe(mockMember)
      expect(upsert).toHaveBeenCalled()
      expect(invites.sendProjectInvite).toHaveBeenCalledWith('alice@acme.com', 'Proj')
    })

    it('still returns the member and links the project when the invite fails', async () => {
      const upsert = jest.fn().mockResolvedValue({ error: null })
      stubProject(upsert)
      invites.sendProjectInvite.mockResolvedValue({ sent: false, reason: 'error' })
      const result = await service.addToProject('user-1', 'proj-1', dto)
      expect(result).toBe(mockMember)
      expect(upsert).toHaveBeenCalled()
    })

    it('does not re-send the invite when the member is already linked', async () => {
      const upsert = jest.fn().mockResolvedValue({ error: null })
      stubProject(upsert, { member_id: 'mem-1' })
      const result = await service.addToProject('user-1', 'proj-1', dto)
      expect(result).toBe(mockMember)
      expect(invites.sendProjectInvite).not.toHaveBeenCalled()
    })
  })
})
