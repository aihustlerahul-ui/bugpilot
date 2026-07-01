import { Test } from '@nestjs/testing'
import { NotFoundException } from '@nestjs/common'
import { IssuesService } from './issues.service'
import { SupabaseService } from '../supabase/supabase.service'

describe('IssuesService.attachVideo', () => {
  it('throws NotFoundException when issue does not belong to user', async () => {
    const single = jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } })
    const update = jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single }) }) }) })
    const supabase = { db: { from: jest.fn().mockReturnValue({ update }) } } as unknown as SupabaseService

    const module = await Test.createTestingModule({
      providers: [IssuesService, { provide: SupabaseService, useValue: supabase }],
    }).compile()
    const service = module.get(IssuesService)

    await expect(
      service.attachVideo('user-1', 'issue-1', { videoStoragePath: 'user-1/project-1/1700-video.webm' }),
    ).rejects.toThrow(NotFoundException)
  })

  it('updates video_storage_path and returns the issue', async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: 'issue-1', reporter_id: 'user-1', video_storage_path: 'user-1/project-1/1700-video.webm' }, error: null })
    const update = jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single }) }) }) })
    const supabase = { db: { from: jest.fn().mockReturnValue({ update }) } } as unknown as SupabaseService

    const module = await Test.createTestingModule({
      providers: [IssuesService, { provide: SupabaseService, useValue: supabase }],
    }).compile()
    const service = module.get(IssuesService)

    const result = await service.attachVideo('user-1', 'issue-1', { videoStoragePath: 'user-1/project-1/1700-video.webm' })

    expect(result.video_storage_path).toBe('user-1/project-1/1700-video.webm')
  })
})

describe('IssuesService.findOne', () => {
  it('returns a signed videoUrl when video_storage_path is set', async () => {
    const singleIssue = jest.fn().mockResolvedValue({
      data: { id: 'issue-1', reporter_id: 'user-1', video_storage_path: 'user-1/proj/1-video.webm' },
      error: null,
    })
    const createSignedUrl = jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed/video.webm' } })
    const supabase = {
      db: {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: singleIssue }) }) }),
        }),
        storage: { from: jest.fn().mockReturnValue({ createSignedUrl }) },
      },
    } as unknown as SupabaseService

    const module = await Test.createTestingModule({
      providers: [IssuesService, { provide: SupabaseService, useValue: supabase }],
    }).compile()
    const service = module.get(IssuesService)

    const result = await service.findOne('user-1', 'issue-1')

    expect(result.videoUrl).toBe('https://signed/video.webm')
    expect(createSignedUrl).toHaveBeenCalledWith('user-1/proj/1-video.webm', 60 * 60)
  })
})
