import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  BadRequestException,
  ExecutionContext,
  HttpStatus,
} from '@nestjs/common';
import { IssuesController } from '../src/issues/issues.controller';
import { IssuesService } from '../src/issues/issues.service';
import { SupabaseService } from '../src/supabase/supabase.service';
import { SupabaseAuthGuard } from '../src/common/guards/supabase-auth.guard';
import {
  UpdateStatusDto,
  TRIAGE_STATUSES,
} from '../src/issues/dto/update-status.dto';
import { CreateIssueDto } from '../src/issues/dto/create-issue.dto';

describe('Milestone 2 Empirical Challenge: Triage Lifecycle & Route Collision', () => {
  let app: INestApplication;
  let mockIssuesService: {
    getDashboardMetrics: jest.Mock;
    findOne: jest.Mock;
    updateStatus: jest.Mock;
    create: jest.Mock;
  };

  const pipe = new ValidationPipe({ whitelist: true, transform: true });

  beforeAll(async () => {
    mockIssuesService = {
      getDashboardMetrics: jest.fn().mockResolvedValue({
        total: 10,
        open: 7,
        critical: 3,
        resolved: 3,
        trend: [{ date: '2026-09-12', count: 4 }],
        recentIssues: [{ id: 'issue-1', title: 'Test Issue', projectName: 'BugPilot' }],
      }),
      findOne: jest.fn().mockImplementation((userId: string, id: string) =>
        Promise.resolve({
          id,
          reporter_id: userId,
          title: `Issue ${id}`,
          status: 'In Dev',
        }),
      ),
      updateStatus: jest.fn().mockImplementation((userId: string, id: string, status: string) =>
        Promise.resolve({
          id,
          status,
          updated_at: new Date().toISOString(),
        }),
      ),
      create: jest.fn().mockImplementation((userId: string, dto: CreateIssueDto) =>
        Promise.resolve({
          id: 'new-issue-id',
          ...dto,
        }),
      ),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [IssuesController],
      providers: [
        { provide: IssuesService, useValue: mockIssuesService },
        { provide: SupabaseService, useValue: {} },
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          req.user = { id: 'test-challenger-user', email: 'challenger@bugpilot.test' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(pipe);
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Status Validation with ValidationPipe', () => {
    it('rejects unlisted statuses with HTTP 400 (BadRequestException)', async () => {
      const invalidStatuses = [
        'InvalidStatus',
        'In Progress',
        'backlog',
        'open',
        'CLOSED',
        'resolved',
        'Triage',
        'random_string_123',
      ];

      for (const status of invalidStatuses) {
        let caughtError: any = null;
        try {
          await pipe.transform(
            { status },
            { type: 'body', metatype: UpdateStatusDto },
          );
        } catch (err) {
          caughtError = err;
        }

        expect(caughtError).toBeInstanceOf(BadRequestException);
        expect(caughtError.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect(caughtError.getStatus()).toBe(400);
        const res = caughtError.getResponse();
        expect(res.message).toEqual(
          expect.arrayContaining([expect.stringContaining('status must be one of the following values')]),
        );
      }
    });

    it('rejects empty strings with HTTP 400 (BadRequestException)', async () => {
      let caughtError: any = null;
      try {
        await pipe.transform(
          { status: '' },
          { type: 'body', metatype: UpdateStatusDto },
        );
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(BadRequestException);
      expect(caughtError.getStatus()).toBe(400);
      const res = caughtError.getResponse();
      expect(res.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining('status should not be empty'),
          expect.stringContaining('status must be one of the following values'),
        ]),
      );
    });

    it('rejects non-string types with HTTP 400 (BadRequestException)', async () => {
      const nonStringValues = [
        12345,
        0,
        true,
        false,
        {},
        { nested: 'value' },
        ['In Dev'],
        null,
      ];

      for (const val of nonStringValues) {
        let caughtError: any = null;
        try {
          await pipe.transform(
            { status: val },
            { type: 'body', metatype: UpdateStatusDto },
          );
        } catch (err) {
          caughtError = err;
        }

        expect(caughtError).toBeInstanceOf(BadRequestException);
        expect(caughtError.getStatus()).toBe(400);
      }
    });

    it('rejects empty payload object with HTTP 400 (missing required status field)', async () => {
      let caughtError: any = null;
      try {
        await pipe.transform({}, { type: 'body', metatype: UpdateStatusDto });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(BadRequestException);
      expect(caughtError.getStatus()).toBe(400);
    });

    it('accepts all 6 legitimate triage lifecycle statuses', async () => {
      for (const status of TRIAGE_STATUSES) {
        const result = await pipe.transform(
          { status },
          { type: 'body', metatype: UpdateStatusDto },
        );
        expect(result.status).toBe(status);
      }
    });

    it('enforces whitelist stripping: strips extraneous properties', async () => {
      const result = await pipe.transform(
        { status: 'In Dev', forbiddenPayload: 'malicious', admin: true },
        { type: 'body', metatype: UpdateStatusDto },
      );
      expect(result.status).toBe('In Dev');
      expect((result as any).forbiddenPayload).toBeUndefined();
      expect((result as any).admin).toBeUndefined();
    });

    it('validates status in CreateIssueDto when provided', async () => {
      // Invalid status in CreateIssueDto
      let caughtError: any = null;
      try {
        await pipe.transform(
          { project_id: 'p1', description: 'desc', status: 'InvalidStatus' },
          { type: 'body', metatype: CreateIssueDto },
        );
      } catch (err) {
        caughtError = err;
      }
      expect(caughtError).toBeInstanceOf(BadRequestException);
      expect(caughtError.getStatus()).toBe(400);

      // Valid status in CreateIssueDto
      const validDto = await pipe.transform(
        { project_id: 'p1', description: 'desc', status: 'Confirmed' },
        { type: 'body', metatype: CreateIssueDto },
      );
      expect(validDto.status).toBe('Confirmed');

      // Optional status omitted in CreateIssueDto
      const omittedDto = await pipe.transform(
        { project_id: 'p1', description: 'desc' },
        { type: 'body', metatype: CreateIssueDto },
      );
      expect(omittedDto.status).toBeUndefined();
    });
  });

  describe('2. Route Collision Avoidance & Dispatch Verification', () => {
    it('verifies method declaration order in IssuesController: getDashboardMetrics precedes findOne', () => {
      const methods = Object.getOwnPropertyNames(IssuesController.prototype);
      const metricsIndex = methods.indexOf('getDashboardMetrics');
      const findOneIndex = methods.indexOf('findOne');

      expect(metricsIndex).toBeGreaterThanOrEqual(0);
      expect(findOneIndex).toBeGreaterThanOrEqual(0);
      // Declaration order in controller ensures static route is registered before parameterized route
      expect(metricsIndex).toBeLessThan(findOneIndex);
    });

    it('simulates Express routing dispatch: /api/issues/dashboard/metrics dispatches to getDashboardMetrics without colliding with :id', async () => {
      const expressApp = app.getHttpAdapter().getInstance();

      const req: any = {
        method: 'GET',
        url: '/api/issues/dashboard/metrics',
        headers: { host: 'localhost' },
        query: {},
        params: {},
      };

      let responseData: any = null;
      let statusCode = 200;

      await new Promise<void>((resolve, reject) => {
        const res: any = {
          statusCode: 200,
          setHeader: jest.fn(),
          getHeader: jest.fn(),
          status(code: number) {
            statusCode = code;
            return this;
          },
          json(data: any) {
            responseData = data;
            resolve();
            return this;
          },
          send(data: any) {
            responseData = data;
            resolve();
            return this;
          },
          end() {
            resolve();
          },
        };

        expressApp.handle(req, res, (err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });

      expect(mockIssuesService.getDashboardMetrics).toHaveBeenCalledTimes(1);
      expect(mockIssuesService.getDashboardMetrics).toHaveBeenCalledWith('test-challenger-user');
      expect(mockIssuesService.findOne).not.toHaveBeenCalled();
      expect(responseData).toEqual({
        total: 10,
        open: 7,
        critical: 3,
        resolved: 3,
        trend: [{ date: '2026-09-12', count: 4 }],
        recentIssues: [{ id: 'issue-1', title: 'Test Issue', projectName: 'BugPilot' }],
      });
    });

    it('simulates Express routing dispatch: /api/issues/issue-uuid-123 dispatches to findOne', async () => {
      const expressApp = app.getHttpAdapter().getInstance();

      const req: any = {
        method: 'GET',
        url: '/api/issues/issue-uuid-123',
        headers: { host: 'localhost' },
        query: {},
        params: {},
      };

      let responseData: any = null;

      await new Promise<void>((resolve, reject) => {
        const res: any = {
          statusCode: 200,
          setHeader: jest.fn(),
          getHeader: jest.fn(),
          status(code: number) {
            return this;
          },
          json(data: any) {
            responseData = data;
            resolve();
            return this;
          },
          send(data: any) {
            responseData = data;
            resolve();
            return this;
          },
          end() {
            resolve();
          },
        };

        expressApp.handle(req, res, (err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });

      expect(mockIssuesService.findOne).toHaveBeenCalledTimes(1);
      expect(mockIssuesService.findOne).toHaveBeenCalledWith('test-challenger-user', 'issue-uuid-123');
      expect(mockIssuesService.getDashboardMetrics).not.toHaveBeenCalled();
      expect(responseData).toEqual({
        id: 'issue-uuid-123',
        reporter_id: 'test-challenger-user',
        title: 'Issue issue-uuid-123',
        status: 'In Dev',
      });
    });

    it('simulates Express routing dispatch: /api/issues/dashboard (single segment) routes to findOne with id="dashboard"', async () => {
      const expressApp = app.getHttpAdapter().getInstance();

      const req: any = {
        method: 'GET',
        url: '/api/issues/dashboard',
        headers: { host: 'localhost' },
        query: {},
        params: {},
      };

      let responseData: any = null;

      await new Promise<void>((resolve, reject) => {
        const res: any = {
          statusCode: 200,
          setHeader: jest.fn(),
          getHeader: jest.fn(),
          status(code: number) {
            return this;
          },
          json(data: any) {
            responseData = data;
            resolve();
            return this;
          },
          send(data: any) {
            responseData = data;
            resolve();
            return this;
          },
          end() {
            resolve();
          },
        };

        expressApp.handle(req, res, (err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // GET /api/issues/dashboard is a single segment matching :id
      expect(mockIssuesService.findOne).toHaveBeenCalledWith('test-challenger-user', 'dashboard');
      expect(mockIssuesService.getDashboardMetrics).not.toHaveBeenCalled();
      expect(responseData.id).toBe('dashboard');
    });
  });
});
