# QA Reporter Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the QA Reporter SaaS platform — Supabase as database/auth/storage only, NestJS as the backend API, Next.js as the frontend, with Azure DevOps sync via PAT.

**Architecture:** Extension authenticates via Supabase Auth (JWT), then POSTs bugs to NestJS. NestJS validates the JWT, stores issues in Supabase Postgres, uploads screenshots to Supabase Storage, and handles Azure DevOps sync. Next.js frontend calls NestJS for all data and actions — no direct Supabase calls from the frontend.

**Tech Stack:** NestJS (backend), Next.js 14 App Router + Tailwind + TanStack Query (frontend), Supabase (Postgres + Auth + Storage), Chrome MV3 (extension)

---

## Repo Structure

```
project-root/
  backend/                        ← NestJS API
    src/
      main.ts                     ← Bootstrap, port 4000
      app.module.ts               ← Root module
      common/
        guards/
          supabase-auth.guard.ts  ← JWT validation via Supabase
        decorators/
          user.decorator.ts       ← @CurrentUser() decorator
      supabase/
        supabase.module.ts        ← Global Supabase client provider
        supabase.service.ts       ← Supabase client wrapper
      workspaces/
        workspaces.module.ts
        workspaces.service.ts     ← CRUD for workspaces
        workspaces.controller.ts
      projects/
        projects.module.ts
        projects.service.ts
        projects.controller.ts
      issues/
        issues.module.ts
        issues.service.ts         ← Create issue, upload screenshots
        issues.controller.ts
      integrations/
        integrations.module.ts
        integrations.service.ts   ← Save PAT, test connection, sync to ADO
        integrations.controller.ts
        azure/
          azure.adapter.ts        ← Azure DevOps REST API calls
      encryption/
        encryption.service.ts     ← AES-256 encrypt/decrypt PAT
    .env
    package.json
    tsconfig.json
    nest-cli.json

  platform/                       ← Next.js frontend
    app/
      layout.tsx
      page.tsx                    ← Redirect to /projects
      (auth)/
        login/page.tsx
        signup/page.tsx
      (dashboard)/
        layout.tsx                ← Auth guard + sidebar
        projects/
          page.tsx
          [id]/
            page.tsx              ← Issue list
            issues/[issueId]/page.tsx ← Issue detail + sync button
        settings/
          integrations/page.tsx
    lib/
      supabase/
        client.ts                 ← Browser Supabase client (auth only)
        server.ts                 ← Server Supabase client (auth only)
      api/
        client.ts                 ← Fetch wrapper for NestJS calls
      types.ts
    middleware.ts                 ← Session refresh + route protection
    components/
      ProjectCard.tsx
      IssueRow.tsx
      IssueDetail.tsx
      SyncButton.tsx
      AzureSetupForm.tsx
    package.json

  src/                            ← Existing Chrome extension
    popup/
      auth.js                     ← New: Supabase auth
      api.js                      ← New: POST to NestJS
      popup.html                  ← Modified: login form + project selector
      popup.js                    ← Modified: auth flow + API call
    lib/
      supabase.js                 ← Supabase UMD bundle
      supabase-client.js          ← Extension Supabase client
```

---

## Task 1: Supabase Project Setup

**Files:** None (Supabase MCP + SQL)

- [ ] **Step 1: Create Supabase project via MCP**

  Use the Supabase MCP `create_project` tool. Save the project URL, anon key, and service role key.

- [ ] **Step 2: Run schema migration**

  Run via Supabase MCP `apply_migration` with name `initial_schema`:

  ```sql
  create extension if not exists "pgcrypto";

  create table workspaces (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    owner_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz default now()
  );

  create type sync_mode_enum as enum ('auto', 'manual');

  create table projects (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    name text not null,
    sync_mode sync_mode_enum not null default 'manual',
    created_at timestamptz default now()
  );

  create type sync_status_enum as enum ('pending', 'synced', 'failed');

  create table issues (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    reporter_id uuid not null references auth.users(id),
    description text not null,
    url text,
    route text,
    browser_info jsonb,
    element_info jsonb,
    screenshot_url text,
    element_screenshot_url text,
    sync_status sync_status_enum not null default 'pending',
    external_ticket_id text,
    external_ticket_url text,
    created_at timestamptz default now()
  );

  create type provider_enum as enum ('azure_devops', 'jira', 'monday');

  create table integrations (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    provider provider_enum not null,
    pat_encrypted text not null,
    config jsonb not null default '{}',
    created_at timestamptz default now(),
    unique(workspace_id, provider)
  );

  create type sync_log_status_enum as enum ('success', 'failed');

  create table issue_sync_logs (
    id uuid primary key default gen_random_uuid(),
    issue_id uuid not null references issues(id) on delete cascade,
    provider text not null,
    status sync_log_status_enum not null,
    error text,
    synced_at timestamptz default now()
  );
  ```

- [ ] **Step 3: Create screenshots storage bucket**

  Run via Supabase MCP `apply_migration` with name `storage_bucket`:

  ```sql
  insert into storage.buckets (id, name, public)
  values ('screenshots', 'screenshots', false);
  ```

- [ ] **Step 4: Disable RLS on all tables**

  Since NestJS uses the service role key (bypasses RLS), keep RLS off for now. All access control is enforced in NestJS.

  Run via Supabase MCP `apply_migration` with name `disable_rls`:

  ```sql
  alter table workspaces disable row level security;
  alter table projects disable row level security;
  alter table issues disable row level security;
  alter table integrations disable row level security;
  alter table issue_sync_logs disable row level security;
  ```

- [ ] **Step 5: Verify**

  Use Supabase MCP `list_tables` — confirm all 5 tables exist.

- [ ] **Step 6: Commit**

  ```bash
  git add docs/
  git commit -m "feat: supabase schema ready"
  ```

---

## Task 2: NestJS Backend Scaffold

**Files:**
- Create: `backend/` (full NestJS project)
- Create: `backend/src/main.ts`
- Create: `backend/src/app.module.ts`
- Create: `backend/src/supabase/supabase.module.ts`
- Create: `backend/src/supabase/supabase.service.ts`
- Create: `backend/src/common/guards/supabase-auth.guard.ts`
- Create: `backend/src/common/decorators/user.decorator.ts`

- [ ] **Step 1: Scaffold NestJS project**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3"
  npx @nestjs/cli new backend --package-manager npm --skip-git
  cd backend
  npm install @supabase/supabase-js @nestjs/config
  npm install -D @types/node
  ```

- [ ] **Step 2: Create environment file**

  Create `backend/.env`:
  ```
  SUPABASE_URL=https://YOUR_PROJECT.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
  SUPABASE_JWT_SECRET=your-jwt-secret
  ENCRYPTION_SECRET=your-32-char-random-string
  PORT=4000
  ```

  Get `SUPABASE_JWT_SECRET` from: Supabase Dashboard → Settings → API → JWT Secret.

- [ ] **Step 3: Create Supabase service**

  Create `backend/src/supabase/supabase.service.ts`:
  ```typescript
  import { Injectable } from '@nestjs/common'
  import { ConfigService } from '@nestjs/config'
  import { createClient, SupabaseClient } from '@supabase/supabase-js'

  @Injectable()
  export class SupabaseService {
    private client: SupabaseClient

    constructor(private config: ConfigService) {
      this.client = createClient(
        this.config.get('SUPABASE_URL')!,
        this.config.get('SUPABASE_SERVICE_ROLE_KEY')!,
      )
    }

    get db(): SupabaseClient {
      return this.client
    }
  }
  ```

- [ ] **Step 4: Create Supabase module**

  Create `backend/src/supabase/supabase.module.ts`:
  ```typescript
  import { Global, Module } from '@nestjs/common'
  import { SupabaseService } from './supabase.service'

  @Global()
  @Module({
    providers: [SupabaseService],
    exports: [SupabaseService],
  })
  export class SupabaseModule {}
  ```

- [ ] **Step 5: Create auth guard**

  Create `backend/src/common/guards/supabase-auth.guard.ts`:
  ```typescript
  import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
  } from '@nestjs/common'
  import { ConfigService } from '@nestjs/config'
  import * as jwt from 'jsonwebtoken'

  @Injectable()
  export class SupabaseAuthGuard implements CanActivate {
    constructor(private config: ConfigService) {}

    canActivate(context: ExecutionContext): boolean {
      const request = context.switchToHttp().getRequest()
      const authHeader = request.headers['authorization']
      if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedException()

      const token = authHeader.replace('Bearer ', '')
      try {
        const secret = this.config.get('SUPABASE_JWT_SECRET')!
        const payload = jwt.verify(token, secret) as any
        request.user = { id: payload.sub, email: payload.email }
        return true
      } catch {
        throw new UnauthorizedException()
      }
    }
  }
  ```

  Install jsonwebtoken:
  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3/backend"
  npm install jsonwebtoken
  npm install -D @types/jsonwebtoken
  ```

- [ ] **Step 6: Create CurrentUser decorator**

  Create `backend/src/common/decorators/user.decorator.ts`:
  ```typescript
  import { createParamDecorator, ExecutionContext } from '@nestjs/common'

  export const CurrentUser = createParamDecorator(
    (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user,
  )
  ```

- [ ] **Step 7: Update app.module.ts**

  Replace `backend/src/app.module.ts`:
  ```typescript
  import { Module } from '@nestjs/common'
  import { ConfigModule } from '@nestjs/config'
  import { SupabaseModule } from './supabase/supabase.module'

  @Module({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      SupabaseModule,
    ],
  })
  export class AppModule {}
  ```

- [ ] **Step 8: Update main.ts**

  Replace `backend/src/main.ts`:
  ```typescript
  import { NestFactory } from '@nestjs/core'
  import { AppModule } from './app.module'
  import { ValidationPipe } from '@nestjs/common'

  async function bootstrap() {
    const app = await NestFactory.create(AppModule)
    app.enableCors({ origin: ['http://localhost:3000', 'chrome-extension://*'] })
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
    app.setGlobalPrefix('api')
    await app.listen(process.env.PORT ?? 4000)
    console.log(`Backend running on http://localhost:4000`)
  }
  bootstrap()
  ```

- [ ] **Step 9: Verify backend starts**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3/backend"
  npm run start:dev
  ```

  Expected output: `Backend running on http://localhost:4000`

  Stop with Ctrl+C.

- [ ] **Step 10: Commit**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3"
  git add backend/
  git commit -m "feat: scaffold NestJS backend with Supabase service and auth guard"
  ```

---

## Task 3: Workspaces + Projects Module

**Files:**
- Create: `backend/src/workspaces/workspaces.service.ts`
- Create: `backend/src/workspaces/workspaces.controller.ts`
- Create: `backend/src/workspaces/workspaces.module.ts`
- Create: `backend/src/workspaces/dto/create-workspace.dto.ts`
- Create: `backend/src/projects/projects.service.ts`
- Create: `backend/src/projects/projects.controller.ts`
- Create: `backend/src/projects/projects.module.ts`
- Create: `backend/src/projects/dto/create-project.dto.ts`

**✅ Validation checkpoint:** After this task you can call `POST /api/workspaces` and `GET /api/projects` via curl.

- [ ] **Step 1: Install class-validator**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3/backend"
  npm install class-validator class-transformer
  ```

- [ ] **Step 2: Create workspace DTO**

  Create `backend/src/workspaces/dto/create-workspace.dto.ts`:
  ```typescript
  import { IsString, MinLength } from 'class-validator'

  export class CreateWorkspaceDto {
    @IsString()
    @MinLength(1)
    name: string
  }
  ```

- [ ] **Step 3: Create workspaces service**

  Create `backend/src/workspaces/workspaces.service.ts`:
  ```typescript
  import { Injectable, NotFoundException } from '@nestjs/common'
  import { SupabaseService } from '../supabase/supabase.service'
  import { CreateWorkspaceDto } from './dto/create-workspace.dto'

  @Injectable()
  export class WorkspacesService {
    constructor(private supabase: SupabaseService) {}

    async create(userId: string, dto: CreateWorkspaceDto) {
      const { data, error } = await this.supabase.db
        .from('workspaces')
        .insert({ name: dto.name, owner_id: userId })
        .select()
        .single()
      if (error) throw new Error(error.message)
      return data
    }

    async findByOwner(userId: string) {
      const { data, error } = await this.supabase.db
        .from('workspaces')
        .select('*')
        .eq('owner_id', userId)
        .single()
      if (error) throw new NotFoundException('Workspace not found')
      return data
    }
  }
  ```

- [ ] **Step 4: Create workspaces controller**

  Create `backend/src/workspaces/workspaces.controller.ts`:
  ```typescript
  import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
  import { SupabaseAuthGuard } from '../common/guards/supabase-auth.guard'
  import { CurrentUser } from '../common/decorators/user.decorator'
  import { WorkspacesService } from './workspaces.service'
  import { CreateWorkspaceDto } from './dto/create-workspace.dto'

  @Controller('workspaces')
  @UseGuards(SupabaseAuthGuard)
  export class WorkspacesController {
    constructor(private workspaces: WorkspacesService) {}

    @Post()
    create(@CurrentUser() user: any, @Body() dto: CreateWorkspaceDto) {
      return this.workspaces.create(user.id, dto)
    }

    @Get('me')
    findMine(@CurrentUser() user: any) {
      return this.workspaces.findByOwner(user.id)
    }
  }
  ```

- [ ] **Step 5: Create workspaces module**

  Create `backend/src/workspaces/workspaces.module.ts`:
  ```typescript
  import { Module } from '@nestjs/common'
  import { WorkspacesService } from './workspaces.service'
  import { WorkspacesController } from './workspaces.controller'

  @Module({
    providers: [WorkspacesService],
    controllers: [WorkspacesController],
    exports: [WorkspacesService],
  })
  export class WorkspacesModule {}
  ```

- [ ] **Step 6: Create project DTO**

  Create `backend/src/projects/dto/create-project.dto.ts`:
  ```typescript
  import { IsEnum, IsString, MinLength } from 'class-validator'

  export class CreateProjectDto {
    @IsString()
    @MinLength(1)
    name: string

    @IsEnum(['auto', 'manual'])
    sync_mode: 'auto' | 'manual' = 'manual'
  }
  ```

- [ ] **Step 7: Create projects service**

  Create `backend/src/projects/projects.service.ts`:
  ```typescript
  import { Injectable, NotFoundException } from '@nestjs/common'
  import { SupabaseService } from '../supabase/supabase.service'
  import { WorkspacesService } from '../workspaces/workspaces.service'
  import { CreateProjectDto } from './dto/create-project.dto'

  @Injectable()
  export class ProjectsService {
    constructor(
      private supabase: SupabaseService,
      private workspaces: WorkspacesService,
    ) {}

    async create(userId: string, dto: CreateProjectDto) {
      const workspace = await this.workspaces.findByOwner(userId)
      const { data, error } = await this.supabase.db
        .from('projects')
        .insert({ name: dto.name, sync_mode: dto.sync_mode, workspace_id: workspace.id })
        .select()
        .single()
      if (error) throw new Error(error.message)
      return data
    }

    async findAll(userId: string) {
      const workspace = await this.workspaces.findByOwner(userId)
      const { data, error } = await this.supabase.db
        .from('projects')
        .select('*')
        .eq('workspace_id', workspace.id)
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return data ?? []
    }

    async findOne(userId: string, projectId: string) {
      const workspace = await this.workspaces.findByOwner(userId)
      const { data, error } = await this.supabase.db
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .eq('workspace_id', workspace.id)
        .single()
      if (error) throw new NotFoundException('Project not found')
      return data
    }
  }
  ```

- [ ] **Step 8: Create projects controller**

  Create `backend/src/projects/projects.controller.ts`:
  ```typescript
  import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
  import { SupabaseAuthGuard } from '../common/guards/supabase-auth.guard'
  import { CurrentUser } from '../common/decorators/user.decorator'
  import { ProjectsService } from './projects.service'
  import { CreateProjectDto } from './dto/create-project.dto'

  @Controller('projects')
  @UseGuards(SupabaseAuthGuard)
  export class ProjectsController {
    constructor(private projects: ProjectsService) {}

    @Post()
    create(@CurrentUser() user: any, @Body() dto: CreateProjectDto) {
      return this.projects.create(user.id, dto)
    }

    @Get()
    findAll(@CurrentUser() user: any) {
      return this.projects.findAll(user.id)
    }

    @Get(':id')
    findOne(@CurrentUser() user: any, @Param('id') id: string) {
      return this.projects.findOne(user.id, id)
    }
  }
  ```

- [ ] **Step 9: Create projects module**

  Create `backend/src/projects/projects.module.ts`:
  ```typescript
  import { Module } from '@nestjs/common'
  import { ProjectsService } from './projects.service'
  import { ProjectsController } from './projects.controller'
  import { WorkspacesModule } from '../workspaces/workspaces.module'

  @Module({
    imports: [WorkspacesModule],
    providers: [ProjectsService],
    controllers: [ProjectsController],
    exports: [ProjectsService],
  })
  export class ProjectsModule {}
  ```

- [ ] **Step 10: Register modules in app.module.ts**

  Update `backend/src/app.module.ts`:
  ```typescript
  import { Module } from '@nestjs/common'
  import { ConfigModule } from '@nestjs/config'
  import { SupabaseModule } from './supabase/supabase.module'
  import { WorkspacesModule } from './workspaces/workspaces.module'
  import { ProjectsModule } from './projects/projects.module'

  @Module({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      SupabaseModule,
      WorkspacesModule,
      ProjectsModule,
    ],
  })
  export class AppModule {}
  ```

- [ ] **Step 11: Validate with curl**

  Start backend: `npm run start:dev` in `backend/`

  Sign up via Supabase Auth directly to get a JWT:
  ```bash
  curl -X POST https://YOUR_PROJECT.supabase.co/auth/v1/signup \
    -H "apikey: YOUR_ANON_KEY" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"password123"}'
  ```
  Copy the `access_token` from the response.

  Create workspace:
  ```bash
  curl -X POST http://localhost:4000/api/workspaces \
    -H "Authorization: Bearer <access_token>" \
    -H "Content-Type: application/json" \
    -d '{"name":"Acme Corp"}'
  ```

  Create project:
  ```bash
  curl -X POST http://localhost:4000/api/projects \
    -H "Authorization: Bearer <access_token>" \
    -H "Content-Type: application/json" \
    -d '{"name":"Web Dashboard","sync_mode":"manual"}'
  ```

  List projects:
  ```bash
  curl http://localhost:4000/api/projects \
    -H "Authorization: Bearer <access_token>"
  ```

  Expected: JSON array with the project you created.

- [ ] **Step 12: Commit**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3"
  git add backend/
  git commit -m "feat: add workspaces and projects modules to NestJS"
  ```

---

## Task 4: Issues Module

**Files:**
- Create: `backend/src/issues/issues.service.ts`
- Create: `backend/src/issues/issues.controller.ts`
- Create: `backend/src/issues/issues.module.ts`
- Create: `backend/src/issues/dto/create-issue.dto.ts`

**✅ Validation checkpoint:** After this task you can POST a bug with a base64 screenshot and see it stored in Supabase.

- [ ] **Step 1: Create issue DTO**

  Create `backend/src/issues/dto/create-issue.dto.ts`:
  ```typescript
  import { IsOptional, IsString, IsObject } from 'class-validator'

  export class CreateIssueDto {
    @IsString()
    project_id: string

    @IsString()
    description: string

    @IsOptional()
    @IsString()
    url?: string

    @IsOptional()
    @IsString()
    route?: string

    @IsOptional()
    @IsObject()
    browser_info?: Record<string, string>

    @IsOptional()
    @IsObject()
    element_info?: Record<string, string>

    @IsOptional()
    @IsString()
    screenshot?: string  // base64

    @IsOptional()
    @IsString()
    element_screenshot?: string  // base64
  }
  ```

- [ ] **Step 2: Create issues service**

  Create `backend/src/issues/issues.service.ts`:
  ```typescript
  import { Injectable, NotFoundException } from '@nestjs/common'
  import { SupabaseService } from '../supabase/supabase.service'
  import { CreateIssueDto } from './dto/create-issue.dto'

  @Injectable()
  export class IssuesService {
    constructor(private supabase: SupabaseService) {}

    private async uploadScreenshot(base64: string, path: string): Promise<string | null> {
      try {
        const buffer = Buffer.from(
          base64.replace(/^data:image\/\w+;base64,/, ''),
          'base64',
        )
        const { error } = await this.supabase.db.storage
          .from('screenshots')
          .upload(path, buffer, { contentType: 'image/png', upsert: false })
        if (error) return null

        const { data } = await this.supabase.db.storage
          .from('screenshots')
          .createSignedUrl(path, 60 * 60 * 24 * 365)
        return data?.signedUrl ?? null
      } catch {
        return null
      }
    }

    async create(userId: string, dto: CreateIssueDto) {
      const timestamp = Date.now()
      const basePath = `${userId}/${dto.project_id}/${timestamp}`

      const [screenshot_url, element_screenshot_url] = await Promise.all([
        dto.screenshot
          ? this.uploadScreenshot(dto.screenshot, `${basePath}-screenshot.png`)
          : Promise.resolve(null),
        dto.element_screenshot
          ? this.uploadScreenshot(dto.element_screenshot, `${basePath}-element.png`)
          : Promise.resolve(null),
      ])

      const { data, error } = await this.supabase.db
        .from('issues')
        .insert({
          project_id: dto.project_id,
          reporter_id: userId,
          description: dto.description,
          url: dto.url ?? null,
          route: dto.route ?? null,
          browser_info: dto.browser_info ?? null,
          element_info: dto.element_info ?? null,
          screenshot_url,
          element_screenshot_url,
          sync_status: 'pending',
        })
        .select()
        .single()

      if (error) throw new Error(error.message)
      return data
    }

    async findByProject(userId: string, projectId: string) {
      const { data, error } = await this.supabase.db
        .from('issues')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return data ?? []
    }

    async findOne(userId: string, issueId: string) {
      const { data, error } = await this.supabase.db
        .from('issues')
        .select('*')
        .eq('id', issueId)
        .single()
      if (error) throw new NotFoundException('Issue not found')
      return data
    }

    async updateSyncStatus(
      issueId: string,
      status: 'pending' | 'synced' | 'failed',
      externalTicketId?: string,
      externalTicketUrl?: string,
    ) {
      await this.supabase.db
        .from('issues')
        .update({
          sync_status: status,
          external_ticket_id: externalTicketId ?? null,
          external_ticket_url: externalTicketUrl ?? null,
        })
        .eq('id', issueId)
    }
  }
  ```

- [ ] **Step 3: Create issues controller**

  Create `backend/src/issues/issues.controller.ts`:
  ```typescript
  import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
  import { SupabaseAuthGuard } from '../common/guards/supabase-auth.guard'
  import { CurrentUser } from '../common/decorators/user.decorator'
  import { IssuesService } from './issues.service'
  import { CreateIssueDto } from './dto/create-issue.dto'

  @Controller('issues')
  @UseGuards(SupabaseAuthGuard)
  export class IssuesController {
    constructor(private issues: IssuesService) {}

    @Post()
    create(@CurrentUser() user: any, @Body() dto: CreateIssueDto) {
      return this.issues.create(user.id, dto)
    }

    @Get('project/:projectId')
    findByProject(@CurrentUser() user: any, @Param('projectId') projectId: string) {
      return this.issues.findByProject(user.id, projectId)
    }

    @Get(':id')
    findOne(@CurrentUser() user: any, @Param('id') id: string) {
      return this.issues.findOne(user.id, id)
    }
  }
  ```

- [ ] **Step 4: Create issues module**

  Create `backend/src/issues/issues.module.ts`:
  ```typescript
  import { Module } from '@nestjs/common'
  import { IssuesService } from './issues.service'
  import { IssuesController } from './issues.controller'

  @Module({
    providers: [IssuesService],
    controllers: [IssuesController],
    exports: [IssuesService],
  })
  export class IssuesModule {}
  ```

- [ ] **Step 5: Register in app.module.ts**

  Update `backend/src/app.module.ts`:
  ```typescript
  import { Module } from '@nestjs/common'
  import { ConfigModule } from '@nestjs/config'
  import { SupabaseModule } from './supabase/supabase.module'
  import { WorkspacesModule } from './workspaces/workspaces.module'
  import { ProjectsModule } from './projects/projects.module'
  import { IssuesModule } from './issues/issues.module'

  @Module({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      SupabaseModule,
      WorkspacesModule,
      ProjectsModule,
      IssuesModule,
    ],
  })
  export class AppModule {}
  ```

- [ ] **Step 6: Validate with curl**

  ```bash
  curl -X POST http://localhost:4000/api/issues \
    -H "Authorization: Bearer <access_token>" \
    -H "Content-Type: application/json" \
    -d '{
      "project_id": "<project-id-from-task-3>",
      "description": "Button not working on checkout",
      "url": "https://example.com/checkout",
      "route": "/checkout",
      "browser_info": { "name": "Chrome", "version": "120" },
      "element_info": { "tag": "button", "text": "Pay Now" }
    }'
  ```

  Expected: JSON with `id`, `sync_status: "pending"`, etc.

  Verify in Supabase MCP `execute_sql`:
  ```sql
  select id, description, sync_status from issues order by created_at desc limit 5;
  ```

- [ ] **Step 7: Commit**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3"
  git add backend/
  git commit -m "feat: add issues module to NestJS with screenshot upload"
  ```

---

## Task 5: Next.js Frontend

**Files:**
- Create: `platform/` (full Next.js app)
- Create: `platform/lib/types.ts`
- Create: `platform/lib/supabase/client.ts`
- Create: `platform/lib/api/client.ts`
- Create: `platform/middleware.ts`
- Create: `platform/app/layout.tsx`
- Create: `platform/app/page.tsx`
- Create: `platform/app/(auth)/login/page.tsx`
- Create: `platform/app/(auth)/signup/page.tsx`
- Create: `platform/app/(dashboard)/layout.tsx`
- Create: `platform/app/(dashboard)/projects/page.tsx`
- Create: `platform/app/(dashboard)/projects/[id]/page.tsx`
- Create: `platform/app/(dashboard)/projects/[id]/issues/[issueId]/page.tsx`
- Create: `platform/app/(dashboard)/settings/integrations/page.tsx`
- Create: `platform/components/ProjectCard.tsx`
- Create: `platform/components/IssueRow.tsx`
- Create: `platform/components/SyncButton.tsx`
- Create: `platform/components/AzureSetupForm.tsx`

**✅ Validation checkpoint:** After this task the full dashboard works — you can sign up, create projects, view issues, and the sync button is wired up.

- [ ] **Step 1: Scaffold Next.js**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3"
  npx create-next-app@14 platform --typescript --tailwind --app --no-src-dir --import-alias "@/*"
  cd platform
  npm install @supabase/supabase-js @supabase/ssr @tanstack/react-query
  ```

- [ ] **Step 2: Create .env.local**

  Create `platform/.env.local`:
  ```
  NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
  NEXT_PUBLIC_API_URL=http://localhost:4000
  ```

- [ ] **Step 3: Create shared types**

  Create `platform/lib/types.ts`:
  ```typescript
  export type SyncStatus = 'pending' | 'synced' | 'failed'
  export type SyncMode = 'auto' | 'manual'

  export interface Workspace { id: string; name: string; owner_id: string; created_at: string }
  export interface Project { id: string; workspace_id: string; name: string; sync_mode: SyncMode; created_at: string }
  export interface Issue {
    id: string; project_id: string; reporter_id: string
    description: string; url: string | null; route: string | null
    browser_info: Record<string, string> | null
    element_info: Record<string, string> | null
    screenshot_url: string | null; element_screenshot_url: string | null
    sync_status: SyncStatus; external_ticket_id: string | null
    external_ticket_url: string | null; created_at: string
  }
  ```

- [ ] **Step 4: Create Supabase browser client (auth only)**

  Create `platform/lib/supabase/client.ts`:
  ```typescript
  import { createBrowserClient } from '@supabase/ssr'

  export function createClient() {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
  }
  ```

- [ ] **Step 5: Create NestJS API client**

  Create `platform/lib/api/client.ts`:
  ```typescript
  import { createClient } from '@/lib/supabase/client'

  const API_URL = process.env.NEXT_PUBLIC_API_URL!

  async function getToken(): Promise<string> {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')
    return session.access_token
  }

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await getToken()
    const res = await fetch(`${API_URL}/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.message ?? `Request failed: ${res.status}`)
    }
    return res.json()
  }

  export const api = {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body: unknown) =>
      request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  }
  ```

- [ ] **Step 6: Create middleware**

  Create `platform/middleware.ts`:
  ```typescript
  import { createServerClient } from '@supabase/ssr'
  import { NextResponse, type NextRequest } from 'next/server'

  export async function middleware(request: NextRequest) {
    let supabaseResponse = NextResponse.next({ request })
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
            supabaseResponse = NextResponse.next({ request })
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options),
            )
          },
        },
      },
    )
    const { data: { user } } = await supabase.auth.getUser()
    const isAuthRoute = /^\/(login|signup)/.test(request.nextUrl.pathname)
    if (!user && !isAuthRoute) return NextResponse.redirect(new URL('/login', request.url))
    if (user && isAuthRoute) return NextResponse.redirect(new URL('/projects', request.url))
    return supabaseResponse
  }

  export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
  ```

- [ ] **Step 7: Create root layout with QueryClientProvider**

  Replace `platform/app/layout.tsx`:
  ```tsx
  'use client'
  import './globals.css'
  import { Inter } from 'next/font/google'
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
  import { useState } from 'react'

  const inter = Inter({ subsets: ['latin'] })

  export default function RootLayout({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(() => new QueryClient())
    return (
      <html lang="en">
        <body className={inter.className}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </body>
      </html>
    )
  }
  ```

- [ ] **Step 8: Create redirect root page**

  Replace `platform/app/page.tsx`:
  ```tsx
  import { redirect } from 'next/navigation'
  export default function Home() { redirect('/projects') }
  ```

- [ ] **Step 9: Create login page**

  Create `platform/app/(auth)/login/page.tsx`:
  ```tsx
  'use client'
  import { useState } from 'react'
  import { useRouter } from 'next/navigation'
  import Link from 'next/link'
  import { createClient } from '@/lib/supabase/client'

  export default function LoginPage() {
    const router = useRouter()
    const supabase = createClient()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    async function handleSubmit(e: React.FormEvent) {
      e.preventDefault()
      setLoading(true)
      setError('')
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) { setError(error.message); setLoading(false) }
      else { router.push('/projects'); router.refresh() }
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm bg-white rounded-xl shadow p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Sign in to QA Reporter</h1>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
          <p className="mt-4 text-sm text-gray-600 text-center">
            No account? <Link href="/signup" className="text-blue-600 hover:underline">Sign up</Link>
          </p>
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 10: Create signup page**

  Create `platform/app/(auth)/signup/page.tsx`:
  ```tsx
  'use client'
  import { useState } from 'react'
  import { useRouter } from 'next/navigation'
  import Link from 'next/link'
  import { createClient } from '@/lib/supabase/client'
  import { api } from '@/lib/api/client'

  export default function SignupPage() {
    const router = useRouter()
    const supabase = createClient()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [workspaceName, setWorkspaceName] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    async function handleSubmit(e: React.FormEvent) {
      e.preventDefault()
      setLoading(true)
      setError('')
      const { error: signUpError } = await supabase.auth.signUp({ email, password })
      if (signUpError) { setError(signUpError.message); setLoading(false); return }

      try {
        await api.post('/workspaces', { name: workspaceName })
        router.push('/projects')
        router.refresh()
      } catch (err: any) {
        setError(err.message)
        setLoading(false)
      }
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm bg-white rounded-xl shadow p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Create your account</h1>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Workspace name</label>
              <input type="text" required value={workspaceName} onChange={e => setWorkspaceName(e.target.value)}
                placeholder="Acme Corp"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {loading ? 'Creating account...' : 'Create account'}
            </button>
          </form>
          <p className="mt-4 text-sm text-gray-600 text-center">
            Already have an account? <Link href="/login" className="text-blue-600 hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 11: Create dashboard layout**

  Create `platform/app/(dashboard)/layout.tsx`:
  ```tsx
  'use client'
  import Link from 'next/link'
  import { usePathname, useRouter } from 'next/navigation'
  import { useEffect, useState } from 'react'
  import { createClient } from '@/lib/supabase/client'
  import { api } from '@/lib/api/client'

  export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter()
    const pathname = usePathname()
    const [workspaceName, setWorkspaceName] = useState('')
    const supabase = createClient()

    useEffect(() => {
      api.get<{ name: string }>('/workspaces/me')
        .then(w => setWorkspaceName(w.name))
        .catch(() => {})
    }, [])

    async function handleSignOut() {
      await supabase.auth.signOut()
      router.push('/login')
    }

    return (
      <div className="min-h-screen bg-gray-50 flex">
        <aside className="w-56 bg-white border-r border-gray-200 flex flex-col p-4 gap-1">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-2 mb-3">
            {workspaceName || '…'}
          </div>
          <Link href="/projects"
            className={`px-3 py-2 rounded-lg text-sm ${pathname.startsWith('/projects') ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-100'}`}>
            Projects
          </Link>
          <Link href="/settings/integrations"
            className={`px-3 py-2 rounded-lg text-sm ${pathname.startsWith('/settings') ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-100'}`}>
            Integrations
          </Link>
          <button onClick={handleSignOut}
            className="mt-auto px-3 py-2 rounded-lg text-sm text-left text-gray-500 hover:bg-gray-100">
            Sign out
          </button>
        </aside>
        <main className="flex-1 p-8">{children}</main>
      </div>
    )
  }
  ```

- [ ] **Step 12: Create projects page**

  Create `platform/app/(dashboard)/projects/page.tsx`:
  ```tsx
  'use client'
  import { useState } from 'react'
  import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
  import Link from 'next/link'
  import { api } from '@/lib/api/client'
  import type { Project } from '@/lib/types'

  export default function ProjectsPage() {
    const qc = useQueryClient()
    const [name, setName] = useState('')
    const [creating, setCreating] = useState(false)

    const { data: projects = [], isLoading } = useQuery<Project[]>({
      queryKey: ['projects'],
      queryFn: () => api.get<Project[]>('/projects'),
    })

    const createProject = useMutation({
      mutationFn: (name: string) => api.post('/projects', { name, sync_mode: 'manual' }),
      onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); setName(''); setCreating(false) },
    })

    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <button onClick={() => setCreating(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
            + New Project
          </button>
        </div>
        {creating && (
          <div className="mb-6 flex gap-3">
            <input autoFocus type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Project name"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={e => e.key === 'Enter' && name && createProject.mutate(name)} />
            <button onClick={() => name && createProject.mutate(name)}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">Create</button>
            <button onClick={() => setCreating(false)}
              className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
          </div>
        )}
        {isLoading && <p className="text-gray-500 text-sm">Loading...</p>}
        {!isLoading && projects.length === 0 && <p className="text-gray-500 text-sm">No projects yet.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(p => (
            <Link key={p.id} href={`/projects/${p.id}`}
              className="block bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-400 hover:shadow-sm transition-all">
              <h3 className="font-semibold text-gray-900">{p.name}</h3>
              <p className="text-xs text-gray-500 mt-1 capitalize">Sync: {p.sync_mode}</p>
            </Link>
          ))}
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 13: Create issue list page**

  Create `platform/app/(dashboard)/projects/[id]/page.tsx`:
  ```tsx
  'use client'
  import { useQuery } from '@tanstack/react-query'
  import Link from 'next/link'
  import { api } from '@/lib/api/client'
  import type { Issue, Project } from '@/lib/types'

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    synced: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  }

  export default function ProjectPage({ params }: { params: { id: string } }) {
    const { data: project } = useQuery<Project>({
      queryKey: ['project', params.id],
      queryFn: () => api.get<Project>(`/projects/${params.id}`),
    })
    const { data: issues = [], isLoading } = useQuery<Issue[]>({
      queryKey: ['issues', params.id],
      queryFn: () => api.get<Issue[]>(`/issues/project/${params.id}`),
    })

    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">{project?.name ?? '…'}</h1>
        {isLoading && <p className="text-gray-500 text-sm">Loading...</p>}
        {!isLoading && issues.length === 0 && (
          <p className="text-gray-500 text-sm">No issues yet. Report one from the Chrome extension.</p>
        )}
        {issues.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {issues.map(issue => (
              <Link key={issue.id} href={`/projects/${params.id}/issues/${issue.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 truncate">{issue.description}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{issue.route ?? issue.url ?? '—'}</p>
                </div>
                <span className={`ml-4 text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[issue.sync_status]}`}>
                  {issue.sync_status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    )
  }
  ```

- [ ] **Step 14: Create SyncButton component**

  Create `platform/components/SyncButton.tsx`:
  ```tsx
  'use client'
  import { useState } from 'react'
  import { useQueryClient } from '@tanstack/react-query'
  import { api } from '@/lib/api/client'

  export function SyncButton({ issueId, projectId, currentStatus }: {
    issueId: string; projectId: string; currentStatus: string
  }) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const qc = useQueryClient()

    async function handleSync() {
      setLoading(true)
      setError('')
      try {
        await api.post(`/integrations/azure/sync/${issueId}`, {})
        qc.invalidateQueries({ queryKey: ['issue', issueId] })
        qc.invalidateQueries({ queryKey: ['issues', projectId] })
      } catch (err: any) {
        setError(err.message)
      }
      setLoading(false)
    }

    if (currentStatus === 'synced') {
      return <span className="text-sm text-green-600 font-medium">✓ Synced to Azure</span>
    }

    return (
      <div>
        <button onClick={handleSync} disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Syncing...' : 'Sync to Azure'}
        </button>
        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
      </div>
    )
  }
  ```

- [ ] **Step 15: Create issue detail page**

  Create `platform/app/(dashboard)/projects/[id]/issues/[issueId]/page.tsx`:
  ```tsx
  'use client'
  import { useQuery } from '@tanstack/react-query'
  import { api } from '@/lib/api/client'
  import { SyncButton } from '@/components/SyncButton'
  import type { Issue } from '@/lib/types'

  export default function IssueDetailPage({ params }: { params: { id: string; issueId: string } }) {
    const { data: issue, isLoading } = useQuery<Issue>({
      queryKey: ['issue', params.issueId],
      queryFn: () => api.get<Issue>(`/issues/${params.issueId}`),
    })

    if (isLoading) return <div className="text-gray-500 text-sm">Loading...</div>
    if (!issue) return <div className="text-red-500 text-sm">Issue not found</div>

    return (
      <div className="max-w-3xl">
        <div className="flex items-start justify-between mb-6">
          <h1 className="text-xl font-bold text-gray-900 flex-1 mr-4">{issue.description}</h1>
          <SyncButton issueId={issue.id} projectId={params.id} currentStatus={issue.sync_status} />
        </div>
        {issue.external_ticket_url && (
          <a href={issue.external_ticket_url} target="_blank" rel="noopener noreferrer"
            className="inline-block mb-4 text-sm text-blue-600 hover:underline">
            View in Azure DevOps →
          </a>
        )}
        <div className="space-y-4">
          {issue.screenshot_url && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2 border-b border-gray-100 text-xs font-medium text-gray-500 uppercase tracking-wide">Screenshot</div>
              <img src={issue.screenshot_url} alt="Screenshot" className="w-full" />
            </div>
          )}
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            {issue.url && <Row label="URL" value={issue.url} />}
            {issue.route && <Row label="Route" value={issue.route} />}
            <Row label="Status" value={issue.sync_status} />
            {issue.browser_info && <Row label="Browser" value={JSON.stringify(issue.browser_info)} />}
            {issue.element_info && <Row label="Element" value={JSON.stringify(issue.element_info)} />}
          </div>
        </div>
      </div>
    )
  }

  function Row({ label, value }: { label: string; value: string }) {
    return (
      <div>
        <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</dt>
        <dd className="text-sm text-gray-700 mt-0.5 break-all">{value}</dd>
      </div>
    )
  }
  ```

- [ ] **Step 16: Validate full frontend**

  Run both servers:
  ```bash
  # Terminal 1
  cd "/Users/rahulsarawagi/Desktop/project 3/backend" && npm run start:dev
  # Terminal 2
  cd "/Users/rahulsarawagi/Desktop/project 3/platform" && npm run dev
  ```

  - Open http://localhost:3000
  - Sign up, create workspace → redirects to /projects
  - Create a project, click into it → empty issue list
  - POST an issue via curl (from Task 4 Step 6) → refresh — issue appears

- [ ] **Step 17: Commit**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3"
  git add platform/
  git commit -m "feat: build Next.js frontend — auth, projects, issues, dashboard"
  ```

---

## Task 6: Extension Auth + Issue Submission

**Files:**
- Create: `src/lib/supabase.js` (download Supabase UMD)
- Create: `src/lib/supabase-client.js`
- Create: `src/popup/auth.js`
- Create: `src/popup/api.js`
- Modify: `src/popup/popup.html`
- Modify: `src/popup/popup.js`
- Modify: `src/manifest.json`

**✅ Validation checkpoint:** After this task you can log in from the extension popup, select a project, report a bug from any page, and see it appear in the dashboard.

- [ ] **Step 1: Download Supabase UMD bundle**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3/src"
  mkdir -p lib
  curl -L "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js" -o lib/supabase.js
  ```

- [ ] **Step 2: Create extension Supabase client**

  Create `src/lib/supabase-client.js`:
  ```javascript
  const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co'
  const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY'

  function getSupabaseClient() {
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: {
          getItem: (key) => new Promise(r => chrome.storage.local.get([key], d => r(d[key] ?? null))),
          setItem: (key, value) => new Promise(r => chrome.storage.local.set({ [key]: value }, r)),
          removeItem: (key) => new Promise(r => chrome.storage.local.remove([key], r)),
        },
      },
    })
  }
  ```

- [ ] **Step 3: Create auth module**

  Create `src/popup/auth.js`:
  ```javascript
  async function getSession() {
    const { data: { session } } = await getSupabaseClient().auth.getSession()
    return session
  }

  async function signIn(email, password) {
    const { data, error } = await getSupabaseClient().auth.signInWithPassword({ email, password })
    return { session: data?.session ?? null, error }
  }

  async function signOut() {
    await getSupabaseClient().auth.signOut()
    await chrome.storage.local.remove(['qa_selected_project'])
  }
  ```

- [ ] **Step 4: Create API module**

  Create `src/popup/api.js`:
  ```javascript
  const BACKEND_URL = 'http://localhost:4000'

  async function fetchProjects(token) {
    const res = await fetch(`${BACKEND_URL}/api/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.json()
  }

  async function submitIssue(token, payload) {
    const res = await fetch(`${BACKEND_URL}/api/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json()
      throw new Error(body.message ?? 'Failed to submit issue')
    }
    return res.json()
  }
  ```

- [ ] **Step 5: Add login form to popup.html**

  Open `src/popup/popup.html` and add these two divs just after `<body>` (before existing content):
  ```html
  <!-- LOGIN VIEW -->
  <div id="login-view" style="display:none;padding:16px">
    <h2 style="margin:0 0 12px;font-size:15px;font-weight:600">Sign in to QA Reporter</h2>
    <div style="margin-bottom:10px">
      <label style="display:block;font-size:12px;color:#374151;margin-bottom:4px">Email</label>
      <input id="login-email" type="email" placeholder="you@example.com"
        style="width:100%;border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;font-size:13px;box-sizing:border-box">
    </div>
    <div style="margin-bottom:12px">
      <label style="display:block;font-size:12px;color:#374151;margin-bottom:4px">Password</label>
      <input id="login-password" type="password" placeholder="••••••"
        style="width:100%;border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;font-size:13px;box-sizing:border-box">
    </div>
    <p id="login-error" style="color:#dc2626;font-size:12px;display:none;margin-bottom:8px"></p>
    <button id="login-btn"
      style="width:100%;background:#2563eb;color:white;border:none;border-radius:6px;padding:8px;font-size:13px;cursor:pointer">
      Sign in
    </button>
  </div>

  <!-- PROJECT SELECTOR BAR (shown when logged in) -->
  <div id="project-bar" style="display:none;padding:8px 16px;border-bottom:1px solid #f3f4f6;background:#f9fafb">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
      <span id="workspace-label" style="font-size:11px;color:#6b7280;font-weight:500"></span>
      <button id="logout-btn" style="font-size:11px;background:none;border:none;color:#9ca3af;cursor:pointer">Sign out</button>
    </div>
    <select id="project-select"
      style="width:100%;border:1px solid #d1d5db;border-radius:6px;padding:5px 8px;font-size:13px"></select>
  </div>
  ```

  Wrap the existing reporter content in:
  ```html
  <div id="reporter-content" style="display:none">
    <!-- existing content -->
  </div>
  ```

  Add script tags before `</body>`:
  ```html
  <script src="../lib/supabase.js"></script>
  <script src="../lib/supabase-client.js"></script>
  <script src="auth.js"></script>
  <script src="api.js"></script>
  ```

- [ ] **Step 6: Add auth init to popup.js**

  Add the following to the **top** of `src/popup/popup.js`:
  ```javascript
  async function initPopup() {
    const session = await getSession()
    if (!session) {
      document.getElementById('login-view').style.display = 'block'
      setupLogin()
      return
    }
    await showLoggedIn(session)
  }

  function setupLogin() {
    document.getElementById('login-btn').addEventListener('click', async () => {
      const email = document.getElementById('login-email').value
      const password = document.getElementById('login-password').value
      const errEl = document.getElementById('login-error')
      errEl.style.display = 'none'
      const { session, error } = await signIn(email, password)
      if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return }
      document.getElementById('login-view').style.display = 'none'
      await showLoggedIn(session)
    })
  }

  async function showLoggedIn(session) {
    const projects = await fetchProjects(session.access_token)
    const select = document.getElementById('project-select')
    select.innerHTML = projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('')

    const stored = await chrome.storage.local.get(['qa_selected_project'])
    if (stored.qa_selected_project) select.value = stored.qa_selected_project
    select.addEventListener('change', () => chrome.storage.local.set({ qa_selected_project: select.value }))

    document.getElementById('project-bar').style.display = 'block'
    document.getElementById('reporter-content').style.display = 'block'
  }

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await signOut()
    document.getElementById('project-bar').style.display = 'none'
    document.getElementById('reporter-content').style.display = 'none'
    document.getElementById('login-view').style.display = 'block'
    setupLogin()
  })

  document.addEventListener('DOMContentLoaded', initPopup)
  ```

- [ ] **Step 7: Replace JSON export in popup.js with API call**

  Find the section in `popup.js` where the issue is exported (look for `JSON.stringify`, `download`, or similar export logic). Replace it with:

  ```javascript
  // Read the existing variables for description, screenshots, element data from popup.js context
  const session = await getSession()
  const stored = await chrome.storage.local.get(['qa_selected_project'])
  const projectId = stored.qa_selected_project
  if (!projectId) { alert('Please select a project first'); return }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const pageUrl = tab?.url ?? ''

  try {
    await submitIssue(session.access_token, {
      project_id: projectId,
      description: /* existing description variable */,
      url: pageUrl,
      route: pageUrl ? new URL(pageUrl).pathname : '',
      browser_info: { name: navigator.userAgent },
      element_info: /* existing element data variable */,
      screenshot: /* existing screenshot base64 variable */,
      element_screenshot: /* existing element screenshot base64 variable */,
    })
    // Show success feedback in existing UI
    alert('Issue reported successfully!')
  } catch (err) {
    alert('Error: ' + err.message)
  }
  ```

  > **Note:** Read the existing `popup.js` to find the actual variable names for description, element data, and screenshots before editing. Replace the comments above with those real variable names.

- [ ] **Step 8: Update manifest.json**

  Add `"storage"` to permissions if not already present, and add web_accessible_resources:
  ```json
  {
    "permissions": ["activeTab", "scripting", "storage"],
    "web_accessible_resources": [{
      "resources": ["lib/supabase.js"],
      "matches": ["<all_urls>"]
    }]
  }
  ```

- [ ] **Step 9: Validate**

  - Open `chrome://extensions`, reload the extension
  - Click the extension icon — login form should appear
  - Sign in → project dropdown appears
  - Navigate to any page, select an element, submit
  - Check dashboard /projects/[id] — issue appears with screenshot

- [ ] **Step 10: Commit**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3"
  git add src/
  git commit -m "feat: add auth and API submission to Chrome extension"
  ```

---

## Task 7: Azure DevOps Integration (NestJS)

**Files:**
- Create: `backend/src/encryption/encryption.service.ts`
- Create: `backend/src/encryption/encryption.module.ts`
- Create: `backend/src/integrations/azure/azure.adapter.ts`
- Create: `backend/src/integrations/dto/save-integration.dto.ts`
- Create: `backend/src/integrations/integrations.service.ts`
- Create: `backend/src/integrations/integrations.controller.ts`
- Create: `backend/src/integrations/integrations.module.ts`

**✅ Validation checkpoint:** After this task you can paste your Azure PAT in the dashboard settings and click "Sync to Azure" on any issue.

- [ ] **Step 1: Create encryption service**

  Create `backend/src/encryption/encryption.service.ts`:
  ```typescript
  import { Injectable } from '@nestjs/common'
  import { ConfigService } from '@nestjs/config'
  import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

  @Injectable()
  export class EncryptionService {
    private readonly algorithm = 'aes-256-gcm'

    constructor(private config: ConfigService) {}

    private getKey(): Buffer {
      const secret = this.config.get<string>('ENCRYPTION_SECRET')!
      return Buffer.from(secret.padEnd(32, '0').slice(0, 32))
    }

    encrypt(text: string): string {
      const iv = randomBytes(12)
      const cipher = createCipheriv(this.algorithm, this.getKey(), iv)
      const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag()
      return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':')
    }

    decrypt(data: string): string {
      const [ivHex, tagHex, encHex] = data.split(':')
      const decipher = createDecipheriv(this.algorithm, this.getKey(), Buffer.from(ivHex, 'hex'))
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
      return decipher.update(Buffer.from(encHex, 'hex')).toString('utf8') + decipher.final('utf8')
    }
  }
  ```

- [ ] **Step 2: Create encryption module**

  Create `backend/src/encryption/encryption.module.ts`:
  ```typescript
  import { Global, Module } from '@nestjs/common'
  import { EncryptionService } from './encryption.service'

  @Global()
  @Module({ providers: [EncryptionService], exports: [EncryptionService] })
  export class EncryptionModule {}
  ```

- [ ] **Step 3: Create Azure adapter**

  Create `backend/src/integrations/azure/azure.adapter.ts`:
  ```typescript
  export interface AzureConfig {
    orgUrl: string
    projectName: string
    pat: string
  }

  function basicAuth(pat: string) {
    return `Basic ${Buffer.from(`:${pat}`).toString('base64')}`
  }

  export async function testAzureConnection(config: AzureConfig): Promise<void> {
    const res = await fetch(`${config.orgUrl}/_apis/projects?api-version=7.0`, {
      headers: { Authorization: basicAuth(config.pat) },
    })
    if (!res.ok) throw new Error(`Azure connection failed: HTTP ${res.status}`)
  }

  export async function createAzureBug(
    config: AzureConfig,
    bug: { title: string; description: string; reproSteps: string },
  ): Promise<{ id: number; url: string }> {
    const url = `${config.orgUrl}/${config.projectName}/_apis/wit/workitems/$Bug?api-version=7.0`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(config.pat),
        'Content-Type': 'application/json-patch+json',
      },
      body: JSON.stringify([
        { op: 'add', path: '/fields/System.Title', value: bug.title },
        { op: 'add', path: '/fields/System.Description', value: bug.description },
        { op: 'add', path: '/fields/Microsoft.VSTS.TCM.ReproSteps', value: bug.reproSteps },
      ]),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Azure API error ${res.status}: ${text}`)
    }
    const data = await res.json()
    return {
      id: data.id,
      url: data._links?.html?.href ??
        `${config.orgUrl}/${config.projectName}/_workitems/edit/${data.id}`,
    }
  }
  ```

- [ ] **Step 4: Create integration DTO**

  Create `backend/src/integrations/dto/save-integration.dto.ts`:
  ```typescript
  import { IsString, IsUrl } from 'class-validator'

  export class SaveIntegrationDto {
    @IsUrl()
    orgUrl: string

    @IsString()
    projectName: string

    @IsString()
    pat: string
  }
  ```

- [ ] **Step 5: Create integrations service**

  Create `backend/src/integrations/integrations.service.ts`:
  ```typescript
  import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
  import { SupabaseService } from '../supabase/supabase.service'
  import { WorkspacesService } from '../workspaces/workspaces.service'
  import { IssuesService } from '../issues/issues.service'
  import { EncryptionService } from '../encryption/encryption.service'
  import { SaveIntegrationDto } from './dto/save-integration.dto'
  import { testAzureConnection, createAzureBug } from './azure/azure.adapter'

  @Injectable()
  export class IntegrationsService {
    constructor(
      private supabase: SupabaseService,
      private workspaces: WorkspacesService,
      private issues: IssuesService,
      private encryption: EncryptionService,
    ) {}

    async saveAzureIntegration(userId: string, dto: SaveIntegrationDto) {
      // Validate PAT before saving
      await testAzureConnection({ orgUrl: dto.orgUrl, projectName: dto.projectName, pat: dto.pat })
        .catch(() => { throw new BadRequestException('Could not connect to Azure DevOps. Check your PAT and org URL.') })

      const workspace = await this.workspaces.findByOwner(userId)
      const { error } = await this.supabase.db.from('integrations').upsert({
        workspace_id: workspace.id,
        provider: 'azure_devops',
        pat_encrypted: this.encryption.encrypt(dto.pat),
        config: { org_url: dto.orgUrl, project_name: dto.projectName },
      }, { onConflict: 'workspace_id,provider' })

      if (error) throw new Error(error.message)
      return { ok: true }
    }

    async getIntegration(userId: string) {
      const workspace = await this.workspaces.findByOwner(userId)
      const { data } = await this.supabase.db
        .from('integrations')
        .select('provider, config')
        .eq('workspace_id', workspace.id)
        .eq('provider', 'azure_devops')
        .single()
      return data ?? null
    }

    async syncIssueToAzure(userId: string, issueId: string) {
      const workspace = await this.workspaces.findByOwner(userId)

      const { data: integration } = await this.supabase.db
        .from('integrations')
        .select('pat_encrypted, config')
        .eq('workspace_id', workspace.id)
        .eq('provider', 'azure_devops')
        .single()

      if (!integration) {
        throw new NotFoundException('No Azure DevOps integration configured. Go to Settings → Integrations.')
      }

      const issue = await this.issues.findOne(userId, issueId)
      const pat = this.encryption.decrypt(integration.pat_encrypted)
      const config = integration.config as { org_url: string; project_name: string }

      const reproSteps = [
        `<b>URL:</b> ${issue.url ?? '—'}`,
        `<b>Route:</b> ${issue.route ?? '—'}`,
        `<b>Browser:</b> ${JSON.stringify(issue.browser_info ?? {})}`,
        `<b>Element:</b> ${JSON.stringify(issue.element_info ?? {})}`,
        issue.screenshot_url ? `<b>Screenshot:</b> <a href="${issue.screenshot_url}">View</a>` : '',
      ].filter(Boolean).join('<br/>')

      try {
        const result = await createAzureBug(
          { orgUrl: config.org_url, projectName: config.project_name, pat },
          { title: issue.description.slice(0, 120), description: issue.description, reproSteps },
        )

        await this.issues.updateSyncStatus(issueId, 'synced', String(result.id), result.url)
        await this.supabase.db.from('issue_sync_logs').insert({
          issue_id: issueId, provider: 'azure_devops', status: 'success',
        })

        return { ok: true, ticketUrl: result.url }
      } catch (err: any) {
        await this.issues.updateSyncStatus(issueId, 'failed')
        await this.supabase.db.from('issue_sync_logs').insert({
          issue_id: issueId, provider: 'azure_devops', status: 'failed', error: err.message,
        })
        throw err
      }
    }
  }
  ```

- [ ] **Step 6: Create integrations controller**

  Create `backend/src/integrations/integrations.controller.ts`:
  ```typescript
  import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
  import { SupabaseAuthGuard } from '../common/guards/supabase-auth.guard'
  import { CurrentUser } from '../common/decorators/user.decorator'
  import { IntegrationsService } from './integrations.service'
  import { SaveIntegrationDto } from './dto/save-integration.dto'

  @Controller('integrations')
  @UseGuards(SupabaseAuthGuard)
  export class IntegrationsController {
    constructor(private integrations: IntegrationsService) {}

    @Post('azure')
    saveAzure(@CurrentUser() user: any, @Body() dto: SaveIntegrationDto) {
      return this.integrations.saveAzureIntegration(user.id, dto)
    }

    @Get('azure')
    getAzure(@CurrentUser() user: any) {
      return this.integrations.getIntegration(user.id)
    }

    @Post('azure/sync/:issueId')
    sync(@CurrentUser() user: any, @Param('issueId') issueId: string) {
      return this.integrations.syncIssueToAzure(user.id, issueId)
    }
  }
  ```

- [ ] **Step 7: Create integrations module**

  Create `backend/src/integrations/integrations.module.ts`:
  ```typescript
  import { Module } from '@nestjs/common'
  import { IntegrationsService } from './integrations.service'
  import { IntegrationsController } from './integrations.controller'
  import { WorkspacesModule } from '../workspaces/workspaces.module'
  import { IssuesModule } from '../issues/issues.module'

  @Module({
    imports: [WorkspacesModule, IssuesModule],
    providers: [IntegrationsService],
    controllers: [IntegrationsController],
  })
  export class IntegrationsModule {}
  ```

- [ ] **Step 8: Register all modules in app.module.ts**

  Update `backend/src/app.module.ts`:
  ```typescript
  import { Module } from '@nestjs/common'
  import { ConfigModule } from '@nestjs/config'
  import { SupabaseModule } from './supabase/supabase.module'
  import { EncryptionModule } from './encryption/encryption.module'
  import { WorkspacesModule } from './workspaces/workspaces.module'
  import { ProjectsModule } from './projects/projects.module'
  import { IssuesModule } from './issues/issues.module'
  import { IntegrationsModule } from './integrations/integrations.module'

  @Module({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      SupabaseModule,
      EncryptionModule,
      WorkspacesModule,
      ProjectsModule,
      IssuesModule,
      IntegrationsModule,
    ],
  })
  export class AppModule {}
  ```

- [ ] **Step 9: Add AzureSetupForm to frontend**

  Create `platform/components/AzureSetupForm.tsx`:
  ```tsx
  'use client'
  import { useState } from 'react'
  import { api } from '@/lib/api/client'

  export function AzureSetupForm({ existing }: { existing?: { org_url?: string; project_name?: string } }) {
    const [orgUrl, setOrgUrl] = useState(existing?.org_url ?? '')
    const [projectName, setProjectName] = useState(existing?.project_name ?? '')
    const [pat, setPat] = useState('')
    const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
    const [error, setError] = useState('')

    async function handleSave() {
      setStatus('saving')
      setError('')
      try {
        await api.post('/integrations/azure', { orgUrl, projectName, pat })
        setStatus('success')
      } catch (err: any) {
        setStatus('error')
        setError(err.message)
      }
    }

    return (
      <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-lg">
        <h2 className="font-semibold text-gray-900 mb-4">Azure DevOps</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Organization URL</label>
            <input type="url" value={orgUrl} onChange={e => setOrgUrl(e.target.value)}
              placeholder="https://dev.azure.com/yourorg"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Project name</label>
            <input type="text" value={projectName} onChange={e => setProjectName(e.target.value)}
              placeholder="MyProject"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Personal Access Token</label>
            <input type="password" value={pat} onChange={e => setPat(e.target.value)}
              placeholder="Paste your PAT here"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-gray-400 mt-1">
              Generate at Azure DevOps → User Settings → Personal Access Tokens. Needs Work Items (Read & Write) scope.
            </p>
          </div>
          <button onClick={handleSave} disabled={!orgUrl || !projectName || !pat || status === 'saving'}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {status === 'saving' ? 'Testing & Saving...' : 'Test Connection & Save'}
          </button>
          {status === 'success' && <p className="text-green-600 text-sm">✓ Connected and saved</p>}
          {status === 'error' && <p className="text-red-600 text-sm">{error}</p>}
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 10: Add integrations settings page**

  Create `platform/app/(dashboard)/settings/integrations/page.tsx`:
  ```tsx
  'use client'
  import { useQuery } from '@tanstack/react-query'
  import { api } from '@/lib/api/client'
  import { AzureSetupForm } from '@/components/AzureSetupForm'

  export default function IntegrationsPage() {
    const { data: integration } = useQuery({
      queryKey: ['integration', 'azure'],
      queryFn: () => api.get<{ config: any } | null>('/integrations/azure').catch(() => null),
    })

    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Integrations</h1>
        <AzureSetupForm existing={integration?.config} />
      </div>
    )
  }
  ```

- [ ] **Step 11: Validate end-to-end**

  - Go to /settings/integrations → paste Azure PAT, org URL, project name → "Test Connection & Save" → success
  - Report a bug from the extension
  - Open the issue in the dashboard → click "Sync to Azure"
  - Bug appears in Azure DevOps with correct title and repro steps
  - Issue badge in list shows "synced"

- [ ] **Step 12: Commit**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3"
  git add backend/ platform/
  git commit -m "feat: complete Azure DevOps integration in NestJS — save PAT, test connection, sync issues"
  ```

---

## End-to-End Validation Checklist

Run through this after Task 7 is complete:

- [ ] Sign up → workspace created in Supabase
- [ ] Create a project in the dashboard
- [ ] Sign in from extension popup, select the project
- [ ] Report a bug from any webpage — appears in dashboard with screenshot
- [ ] Settings → Integrations → Azure PAT test succeeds
- [ ] Open issue detail → click "Sync to Azure" → bug created in ADO
- [ ] ADO bug has correct title, repro steps (URL, browser info, element)
- [ ] Issue list badge shows "synced" (green) with link to ADO ticket
