import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IssuesService } from './issues.service';
import { SourceMapService } from './source-map.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { SupabaseService } from '../supabase/supabase.service';
import { ChunkUploadType } from './dto/chunk-upload.dto';

describe('IssuesService', () => {
  const mockWorkspacesService = {
    findByOwner: jest.fn().mockResolvedValue({ id: 'ws-1', name: 'Acme Corp' }),
  };

  const mockSourceMapService = {
    resolveLocation: jest.fn().mockResolvedValue({
      originalFile: 'src/components/Button.tsx',
      originalLine: 42,
      originalColumn: 10,
      originalName: 'handleClick',
      status: 'resolved',
    }),
    resolveStackTrace: jest.fn().mockResolvedValue('resolved stack trace'),
  };

  describe('attachVideo', () => {
    it('throws NotFoundException when issue does not belong to user', async () => {
      const single = jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } });
      const update = jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single }) }) }) });
      const supabase = { db: { from: jest.fn().mockReturnValue({ update }) } } as unknown as SupabaseService;

      const module = await Test.createTestingModule({
        providers: [
          IssuesService,
          { provide: SupabaseService, useValue: supabase },
          { provide: SourceMapService, useValue: mockSourceMapService },
          { provide: WorkspacesService, useValue: mockWorkspacesService },
        ],
      }).compile();
      const service = module.get(IssuesService);

      await expect(
        service.attachVideo('user-1', 'issue-1', { videoStoragePath: 'user-1/project-1/1700-video.webm' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates video_storage_path and returns the issue', async () => {
      const single = jest.fn().mockResolvedValue({ data: { id: 'issue-1', reporter_id: 'user-1', video_storage_path: 'user-1/project-1/1700-video.webm' }, error: null });
      const update = jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single }) }) }) });
      const supabase = { db: { from: jest.fn().mockReturnValue({ update }) } } as unknown as SupabaseService;

      const module = await Test.createTestingModule({
        providers: [
          IssuesService,
          { provide: SupabaseService, useValue: supabase },
          { provide: SourceMapService, useValue: mockSourceMapService },
          { provide: WorkspacesService, useValue: mockWorkspacesService },
        ],
      }).compile();
      const service = module.get(IssuesService);

      const result = await service.attachVideo('user-1', 'issue-1', { videoStoragePath: 'user-1/project-1/1700-video.webm' });
      expect(result.video_storage_path).toBe('user-1/project-1/1700-video.webm');
    });
  });

  describe('findOne', () => {
    it('returns a signed videoUrl when video_storage_path is set', async () => {
      const singleIssue = jest.fn().mockResolvedValue({
        data: { id: 'issue-1', reporter_id: 'user-1', video_storage_path: 'user-1/proj/1-video.webm' },
        error: null,
      });
      const createSignedUrl = jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed/video.webm' } });
      const supabase = {
        db: {
          from: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: singleIssue }) }) }),
          }),
          storage: { from: jest.fn().mockReturnValue({ createSignedUrl }) },
        },
      } as unknown as SupabaseService;

      const module = await Test.createTestingModule({
        providers: [
          IssuesService,
          { provide: SupabaseService, useValue: supabase },
          { provide: SourceMapService, useValue: mockSourceMapService },
          { provide: WorkspacesService, useValue: mockWorkspacesService },
        ],
      }).compile();
      const service = module.get(IssuesService);

      const result = await service.findOne('user-1', 'issue-1');
      expect(result.videoUrl).toBe('https://signed/video.webm');
      expect(createSignedUrl).toHaveBeenCalledWith('user-1/proj/1-video.webm', 60 * 60);
    });
  });

  describe('Chunked Uploads', () => {
    it('initializes chunk upload, receives chunks, and completes upload', async () => {
      const uploadMock = jest.fn().mockResolvedValue({ data: { path: 'user-1/proj-1/123-video.webm' }, error: null });
      const supabase = {
        db: {
          from: jest.fn().mockReturnValue({
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: {}, error: null }) }),
            }),
          }),
          storage: { from: jest.fn().mockReturnValue({ upload: uploadMock }) },
        },
      } as unknown as SupabaseService;

      const module = await Test.createTestingModule({
        providers: [
          IssuesService,
          { provide: SupabaseService, useValue: supabase },
          { provide: SourceMapService, useValue: mockSourceMapService },
          { provide: WorkspacesService, useValue: mockWorkspacesService },
        ],
      }).compile();
      const service = module.get(IssuesService);

      // 1. Init
      const { uploadId } = await service.initChunkUpload('user-1', {
        project_id: 'proj-1',
        type: ChunkUploadType.VIDEO,
        total_chunks: 2,
      });
      expect(uploadId).toBeDefined();

      // 2. Upload chunks
      const chunk1 = Buffer.from('hello-').toString('base64');
      const chunk2 = Buffer.from('world').toString('base64');

      const res1 = await service.uploadChunk('user-1', { upload_id: uploadId, chunk_index: 0, chunk_data: chunk1 });
      expect(res1.ok).toBe(true);
      expect(res1.uploadedChunks).toBe(1);

      const res2 = await service.uploadChunk('user-1', { upload_id: uploadId, chunk_index: 1, chunk_data: chunk2 });
      expect(res2.ok).toBe(true);
      expect(res2.uploadedChunks).toBe(2);

      // 3. Complete
      const { storagePath } = await service.completeChunkUpload('user-1', { upload_id: uploadId, issue_id: 'issue-1' });
      expect(storagePath).toContain('video.webm');
      expect(uploadMock).toHaveBeenCalled();
    });

    it('correctly reassembles arbitrarily sliced base64 chunks with data prefix without corruption', async () => {
      let uploadedBuffer: Buffer | null = null;
      const uploadMock = jest.fn().mockImplementation((path, buffer) => {
        uploadedBuffer = buffer;
        return Promise.resolve({ data: { path }, error: null });
      });
      const supabase = {
        db: {
          from: jest.fn().mockReturnValue({
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: {}, error: null }) }),
            }),
          }),
          storage: { from: jest.fn().mockReturnValue({ upload: uploadMock }) },
        },
      } as unknown as SupabaseService;

      const module = await Test.createTestingModule({
        providers: [
          IssuesService,
          { provide: SupabaseService, useValue: supabase },
          { provide: SourceMapService, useValue: mockSourceMapService },
          { provide: WorkspacesService, useValue: mockWorkspacesService },
        ],
      }).compile();
      const service = module.get(IssuesService);

      const originalText = 'The quick brown fox jumps over the lazy dog! 1234567890';
      const fullBase64 = 'data:video/webm;base64,' + Buffer.from(originalText).toString('base64');

      // Slice into 3 arbitrary non-4-aligned pieces
      const piece1 = fullBase64.slice(0, 15);
      const piece2 = fullBase64.slice(15, 33);
      const piece3 = fullBase64.slice(33);

      const { uploadId } = await service.initChunkUpload('user-1', {
        project_id: 'proj-1',
        type: ChunkUploadType.VIDEO,
        total_chunks: 3,
      });

      await service.uploadChunk('user-1', { upload_id: uploadId, chunk_index: 0, chunk_data: piece1 });
      await service.uploadChunk('user-1', { upload_id: uploadId, chunk_index: 1, chunk_data: piece2 });
      await service.uploadChunk('user-1', { upload_id: uploadId, chunk_index: 2, chunk_data: piece3 });

      await service.completeChunkUpload('user-1', { upload_id: uploadId });

      expect(uploadedBuffer).not.toBeNull();
      expect((uploadedBuffer as unknown as Buffer).toString('utf-8')).toBe(originalText);
    });

    it('rejects complete when chunks are missing', async () => {
      const supabase = { db: { storage: { from: jest.fn() } } } as unknown as SupabaseService;
      const module = await Test.createTestingModule({
        providers: [
          IssuesService,
          { provide: SupabaseService, useValue: supabase },
          { provide: SourceMapService, useValue: mockSourceMapService },
          { provide: WorkspacesService, useValue: mockWorkspacesService },
        ],
      }).compile();
      const service = module.get(IssuesService);

      const { uploadId } = await service.initChunkUpload('user-1', {
        project_id: 'proj-1',
        type: ChunkUploadType.VIDEO,
        total_chunks: 3,
      });

      await service.uploadChunk('user-1', { upload_id: uploadId, chunk_index: 0, chunk_data: Buffer.from('a').toString('base64') });

      await expect(
        service.completeChunkUpload('user-1', { upload_id: uploadId }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Data Retention Policy', () => {
    it('cleans up expired unpinned issues and skips pinned issues', async () => {
      const expiredIssues = [
        {
          id: 'issue-expired-1',
          replay_storage_path: 'user-1/proj-1/rep1.json.gz',
          video_storage_path: 'user-1/proj-1/vid1.webm',
          metadata: {},
        },
        {
          id: 'issue-pinned-2',
          replay_storage_path: 'user-1/proj-1/rep2.json.gz',
          metadata: { is_pinned: true },
        },
      ];

      const removeMock = jest.fn().mockResolvedValue({ data: [], error: null });
      const updateMock = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: {}, error: null }) });

      const supabase = {
        db: {
          from: jest.fn().mockImplementation((table) => {
            if (table === 'issues') {
              return {
                select: jest.fn().mockReturnValue({
                  lt: jest.fn().mockResolvedValue({ data: expiredIssues, error: null }),
                }),
                update: updateMock,
              };
            }
            return {};
          }),
          storage: { from: jest.fn().mockReturnValue({ remove: removeMock }) },
        },
      } as unknown as SupabaseService;

      const module = await Test.createTestingModule({
        providers: [
          IssuesService,
          { provide: SupabaseService, useValue: supabase },
          { provide: SourceMapService, useValue: mockSourceMapService },
          { provide: WorkspacesService, useValue: mockWorkspacesService },
        ],
      }).compile();
      const service = module.get(IssuesService);

      const result = await service.runRetentionCleanup(14, false);
      expect(result.cleanedCount).toBe(1);
      expect(result.freedReplays).toBe(1);
      expect(result.freedVideos).toBe(1);
      expect(removeMock).toHaveBeenCalled();
    });
  });

  describe('Pinning & Source Maps', () => {
    it('toggles issue pin state', async () => {
      const updateSingle = jest.fn().mockResolvedValue({ data: { id: 'issue-1', metadata: { is_pinned: true } }, error: null });
      const selectSingle = jest.fn().mockResolvedValue({ data: { id: 'issue-1', metadata: {} }, error: null });

      const supabase = {
        db: {
          from: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: selectSingle }) }) }),
            update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: updateSingle }) }) }),
          }),
        },
      } as unknown as SupabaseService;

      const module = await Test.createTestingModule({
        providers: [
          IssuesService,
          { provide: SupabaseService, useValue: supabase },
          { provide: SourceMapService, useValue: mockSourceMapService },
          { provide: WorkspacesService, useValue: mockWorkspacesService },
        ],
      }).compile();
      const service = module.get(IssuesService);

      const result = await service.togglePin('user-1', 'issue-1', true);
      expect(result.metadata.is_pinned).toBe(true);
    });

    it('resolves sourcemap stack trace', async () => {
      const supabase = {} as unknown as SupabaseService;
      const module = await Test.createTestingModule({
        providers: [
          IssuesService,
          { provide: SupabaseService, useValue: supabase },
          { provide: SourceMapService, useValue: mockSourceMapService },
          { provide: WorkspacesService, useValue: mockWorkspacesService },
        ],
      }).compile();
      const service = module.get(IssuesService);

      const result = await service.resolveStack(undefined, undefined, undefined, 'Error: boom\n  at main.js:1:50');
      expect(result.resolvedStack).toBe('resolved stack trace');
      expect(mockSourceMapService.resolveStackTrace).toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('updates status and returns updated issue', async () => {
      const single = jest.fn().mockResolvedValue({
        data: { id: 'issue-1', status: 'In Dev' },
        error: null,
      });
      const update = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({ single }),
        }),
      });
      const supabase = {
        db: { from: jest.fn().mockReturnValue({ update }) },
      } as unknown as SupabaseService;

      const module = await Test.createTestingModule({
        providers: [
          IssuesService,
          { provide: SupabaseService, useValue: supabase },
          { provide: SourceMapService, useValue: mockSourceMapService },
          { provide: WorkspacesService, useValue: mockWorkspacesService },
        ],
      }).compile();
      const service = module.get(IssuesService);

      const result = await service.updateStatus('user-1', 'issue-1', 'In Dev');
      expect(result.status).toBe('In Dev');
    });

    it('throws NotFoundException when issue not found', async () => {
      const single = jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } });
      const update = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({ single }),
        }),
      });
      const supabase = {
        db: { from: jest.fn().mockReturnValue({ update }) },
      } as unknown as SupabaseService;

      const module = await Test.createTestingModule({
        providers: [
          IssuesService,
          { provide: SupabaseService, useValue: supabase },
          { provide: SourceMapService, useValue: mockSourceMapService },
          { provide: WorkspacesService, useValue: mockWorkspacesService },
        ],
      }).compile();
      const service = module.get(IssuesService);

      await expect(service.updateStatus('user-1', 'issue-missing', 'Resolved')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getDashboardMetrics', () => {
    it('returns zeroes if user has no workspace', async () => {
      const workspacesMock = {
        findByOwner: jest.fn().mockRejectedValue(new NotFoundException()),
      };
      const supabase = {} as unknown as SupabaseService;

      const module = await Test.createTestingModule({
        providers: [
          IssuesService,
          { provide: SupabaseService, useValue: supabase },
          { provide: SourceMapService, useValue: mockSourceMapService },
          { provide: WorkspacesService, useValue: workspacesMock },
        ],
      }).compile();
      const service = module.get(IssuesService);

      const res = await service.getDashboardMetrics('user-1');
      expect(res.total).toBe(0);
      expect(res.open).toBe(0);
      expect(res.recentIssues).toEqual([]);
    });

    it('returns zeroes if workspace has no projects', async () => {
      const workspacesMock = {
        findByOwner: jest.fn().mockResolvedValue({ id: 'ws-1' }),
      };
      const supabase = {
        db: {
          from: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        },
      } as unknown as SupabaseService;

      const module = await Test.createTestingModule({
        providers: [
          IssuesService,
          { provide: SupabaseService, useValue: supabase },
          { provide: SourceMapService, useValue: mockSourceMapService },
          { provide: WorkspacesService, useValue: workspacesMock },
        ],
      }).compile();
      const service = module.get(IssuesService);

      const res = await service.getDashboardMetrics('user-1');
      expect(res.total).toBe(0);
      expect(res.recentIssues).toEqual([]);
    });

    it('aggregates total, open, critical, resolved, trend, and recentIssues', async () => {
      const workspacesMock = {
        findByOwner: jest.fn().mockResolvedValue({ id: 'ws-1' }),
      };
      const today = new Date().toISOString();
      const mockIssues = [
        { id: '1', project_id: 'p-1', status: 'Incoming', severity: 'Critical', created_at: today },
        { id: '2', project_id: 'p-1', status: 'In Dev', severity: 'High', created_at: today },
        { id: '3', project_id: 'p-1', status: 'Resolved', severity: 'Critical', created_at: today },
        { id: '4', project_id: 'p-1', status: 'Closed', severity: 'Low', created_at: '2026-01-01T00:00:00Z' },
      ];
      const supabase = {
        db: {
          from: jest.fn().mockImplementation((table) => {
            if (table === 'projects') {
              return {
                select: jest.fn().mockReturnValue({
                  eq: jest.fn().mockResolvedValue({ data: [{ id: 'p-1', name: 'Web App' }], error: null }),
                }),
              };
            }
            if (table === 'issues') {
              return {
                select: jest.fn().mockReturnValue({
                  in: jest.fn().mockReturnValue({
                    order: jest.fn().mockResolvedValue({ data: mockIssues, error: null }),
                  }),
                }),
              };
            }
            return {};
          }),
        },
      } as unknown as SupabaseService;

      const module = await Test.createTestingModule({
        providers: [
          IssuesService,
          { provide: SupabaseService, useValue: supabase },
          { provide: SourceMapService, useValue: mockSourceMapService },
          { provide: WorkspacesService, useValue: workspacesMock },
        ],
      }).compile();
      const service = module.get(IssuesService);

      const res = await service.getDashboardMetrics('user-1');
      expect(res.total).toBe(4);
      expect(res.open).toBe(2);
      expect(res.critical).toBe(1);
      expect(res.resolved).toBe(2);
      expect(res.trend).toHaveLength(7);
      expect(res.recentIssues[0].projectName).toBe('Web App');
    });
  });
});
