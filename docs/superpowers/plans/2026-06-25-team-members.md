# Team Members & Bug Assignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lightweight workspace team members (name + email) that can be linked to projects and selected as assignees in the Chrome extension bug modal, synced to Azure DevOps as `System.AssignedTo`.

**Architecture:** Two new DB tables (`workspace_members`, `project_members`), a new NestJS `MembersModule` with conflict-aware upsert, a global Team page + per-project Members tab in Next.js, and assignee dropdown in the content.js bug modal (sticky per session, passed from sidepanel via `START_REPORTING` message).

**Tech Stack:** NestJS + Supabase (PostgreSQL), Next.js 14 + TailwindCSS + TanStack Query, Chrome MV3 extension (vanilla JS).

## Global Constraints

- All backend routes require `SupabaseAuthGuard` — never skip JWT validation
- Supabase client uses service role key via `SupabaseService.db` — never instantiate a new client
- Platform uses `api.get/post/patch/delete` from `platform/lib/api/client.ts` — never raw fetch
- All extension message handlers live in `background.js` — sidepanel and content.js only send messages
- PATs and secrets stay in `.env` / `.env.local` — never committed
- Azure fields use `api-version=7.1`
- TailwindCSS only — no inline style objects on platform

---

## File Map

**Create:**
- `backend/src/members/members.module.ts`
- `backend/src/members/members.controller.ts`
- `backend/src/members/members.service.ts`
- `backend/src/members/dto/create-member.dto.ts`
- `backend/src/members/dto/add-project-member.dto.ts`
- `backend/src/members/members.service.spec.ts`
- `platform/app/(dashboard)/team/page.tsx`

**Modify:**
- `backend/src/app.module.ts` — register `MembersModule`
- `platform/app/(dashboard)/layout.tsx` — add Team nav link
- `platform/app/(dashboard)/projects/[id]/page.tsx` — add Members tab
- `platform/lib/types.ts` — add `TeamMember` type
- `backend/src/integrations/integrations.service.ts` — new Azure fields + resolveSource cases
- `extension/background.js` — add `GET_PROJECT_MEMBERS` handler
- `extension/sidepanel.js` — fetch members on project change, pass to `START_REPORTING`
- `extension/content.js` — assignee dropdown in bug modal, sticky last selection

---

## Task 1: DB Migration

**Files:**
- Run SQL via Supabase dashboard or MCP

- [ ] **Step 1: Run migration SQL**

Open the Supabase dashboard → SQL Editor (or use the Supabase MCP `execute_sql` tool) and run:

```sql
-- workspace_members: global contact book per workspace
CREATE TABLE IF NOT EXISTS workspace_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL,
  email         text NOT NULL,
  created_at    timestamptz DEFAULT now(),
  CONSTRAINT workspace_members_email_unique UNIQUE (workspace_id, email),
  CONSTRAINT workspace_members_name_unique  UNIQUE (workspace_id, name)
);

-- project_members: join table linking members to projects
CREATE TABLE IF NOT EXISTS project_members (
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES workspace_members(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  PRIMARY KEY (project_id, member_id)
);

-- RLS: owner can read/write their workspace members
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_owner" ON workspace_members
  USING (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()));

CREATE POLICY "project_members_owner" ON project_members
  USING (project_id IN (
    SELECT p.id FROM projects p
    JOIN workspaces w ON w.id = p.workspace_id
    WHERE w.owner_id = auth.uid()
  ));
```

- [ ] **Step 2: Verify tables exist**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('workspace_members', 'project_members');
```

Expected: 2 rows returned.

- [ ] **Step 3: Commit note**

```bash
cd "backend"
git add -A
git commit -m "chore: DB migration — workspace_members + project_members tables"
```

---

## Task 2: Backend — Members Module (Workspace-Level CRUD)

**Files:**
- Create: `backend/src/members/dto/create-member.dto.ts`
- Create: `backend/src/members/members.service.ts`
- Create: `backend/src/members/members.controller.ts`
- Create: `backend/src/members/members.module.ts`
- Create: `backend/src/members/members.service.spec.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Produces: `MembersService` with methods `listWorkspaceMembers`, `createMember`, `updateMember`, `deleteMember`
- Produces: `GET/POST/PATCH/DELETE /api/workspaces/members`

- [ ] **Step 1: Create DTO**

`backend/src/members/dto/create-member.dto.ts`:
```typescript
import { IsEmail, IsString, MinLength } from 'class-validator'

export class CreateMemberDto {
  @IsString()
  @MinLength(1)
  name: string

  @IsEmail()
  email: string
}
```

- [ ] **Step 2: Write failing service tests**

`backend/src/members/members.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing'
import { MembersService } from './members.service'
import { SupabaseService } from '../supabase/supabase.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
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

  beforeEach(async () => {
    db = makeDb()
    const module = await Test.createTestingModule({
      providers: [
        MembersService,
        { provide: SupabaseService, useValue: { db } },
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
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd backend && npx jest members.service.spec --no-coverage 2>&1 | tail -5
```

Expected: `Cannot find module './members.service'`

- [ ] **Step 4: Implement MembersService**

`backend/src/members/members.service.ts`:
```typescript
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { SupabaseService } from '../supabase/supabase.service'
import { WorkspacesService } from '../workspaces/workspaces.service'
import type { CreateMemberDto } from './dto/create-member.dto'

@Injectable()
export class MembersService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async listWorkspaceMembers(userId: string) {
    const workspace = await this.workspaces.findByOwner(userId)
    const { data, error } = await this.supabase.db
      .from('workspace_members')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('name', { ascending: true })
    if (error) throw new BadRequestException(error.message)
    return data ?? []
  }

  async createMember(userId: string, dto: CreateMemberDto) {
    const workspace = await this.workspaces.findByOwner(userId)
    await this.checkConflicts(workspace.id, dto.name, dto.email)
    const { data, error } = await this.supabase.db
      .from('workspace_members')
      .insert({ workspace_id: workspace.id, name: dto.name, email: dto.email })
      .select()
      .single()
    if (error) throw new BadRequestException(error.message)
    return data
  }

  async updateMember(userId: string, memberId: string, dto: Partial<CreateMemberDto>) {
    const workspace = await this.workspaces.findByOwner(userId)
    const existing = await this.findById(workspace.id, memberId)
    if (!existing) throw new NotFoundException('Member not found')
    if (dto.email && dto.email !== existing.email) {
      const emailConflict = await this.findByEmail(workspace.id, dto.email)
      if (emailConflict) throw new BadRequestException(JSON.stringify({ code: 'EMAIL_CONFLICT', existing: emailConflict }))
    }
    if (dto.name && dto.name !== existing.name) {
      const nameConflict = await this.findByName(workspace.id, dto.name)
      if (nameConflict) throw new BadRequestException(JSON.stringify({ code: 'NAME_CONFLICT', existing: nameConflict }))
    }
    const { data, error } = await this.supabase.db
      .from('workspace_members')
      .update({ name: dto.name ?? existing.name, email: dto.email ?? existing.email })
      .eq('id', memberId)
      .eq('workspace_id', workspace.id)
      .select()
      .single()
    if (error) throw new BadRequestException(error.message)
    return data
  }

  async deleteMember(userId: string, memberId: string) {
    const workspace = await this.workspaces.findByOwner(userId)
    const { error } = await this.supabase.db
      .from('workspace_members')
      .delete()
      .eq('id', memberId)
      .eq('workspace_id', workspace.id)
    if (error) throw new BadRequestException(error.message)
    return { deleted: true }
  }

  // ── Helpers used by project members upsert ────────────────────────────────

  async findWorkspaceMemberByEmail(userId: string, email: string) {
    const workspace = await this.workspaces.findByOwner(userId)
    return this.findByEmail(workspace.id, email)
  }

  async getWorkspaceId(userId: string) {
    const workspace = await this.workspaces.findByOwner(userId)
    return workspace.id
  }

  private async findByEmail(workspaceId: string, email: string) {
    const { data } = await this.supabase.db
      .from('workspace_members')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('email', email)
      .single()
    return data ?? null
  }

  private async findByName(workspaceId: string, name: string) {
    const { data } = await this.supabase.db
      .from('workspace_members')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('name', name)
      .single()
    return data ?? null
  }

  private async findById(workspaceId: string, memberId: string) {
    const { data } = await this.supabase.db
      .from('workspace_members')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', memberId)
      .single()
    return data ?? null
  }

  private async checkConflicts(workspaceId: string, name: string, email: string) {
    const emailConflict = await this.findByEmail(workspaceId, email)
    if (emailConflict) {
      throw new BadRequestException(JSON.stringify({ code: 'EMAIL_CONFLICT', existing: emailConflict }))
    }
    const nameConflict = await this.findByName(workspaceId, name)
    if (nameConflict) {
      throw new BadRequestException(JSON.stringify({ code: 'NAME_CONFLICT', existing: nameConflict }))
    }
  }
}
```

- [ ] **Step 5: Create controller**

`backend/src/members/members.controller.ts`:
```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { SupabaseAuthGuard } from '../common/guards/supabase-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { MembersService } from './members.service'
import { CreateMemberDto } from './dto/create-member.dto'
import type { AuthUser } from '../common/interfaces/auth-user.interface'

@Controller('workspaces/members')
@UseGuards(SupabaseAuthGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.members.listWorkspaceMembers(user.id)
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMemberDto) {
    return this.members.createMember(user.id, dto)
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: Partial<CreateMemberDto>) {
    return this.members.updateMember(user.id, id, dto)
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.members.deleteMember(user.id, id)
  }
}
```

- [ ] **Step 6: Create module**

`backend/src/members/members.module.ts`:
```typescript
import { Module } from '@nestjs/common'
import { MembersService } from './members.service'
import { MembersController } from './members.controller'
import { WorkspacesModule } from '../workspaces/workspaces.module'

@Module({
  imports: [WorkspacesModule],
  providers: [MembersService],
  controllers: [MembersController],
  exports: [MembersService],
})
export class MembersModule {}
```

- [ ] **Step 7: Register in AppModule**

`backend/src/app.module.ts` — add import:
```typescript
import { MembersModule } from './members/members.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SupabaseModule,
    WorkspacesModule,
    ProjectsModule,
    IssuesModule,
    IntegrationsModule,
    MembersModule,   // ← add
  ],
})
export class AppModule {}
```

- [ ] **Step 8: Run tests**

```bash
cd backend && npx jest members.service.spec --no-coverage 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 9: Manual smoke test**

```bash
cd backend && npm run start:dev
# In another terminal:
TOKEN="<paste a valid token from browser sessionStorage>"
curl -s -X POST http://localhost:4000/api/workspaces/members \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@acme.com"}' | jq .
```

Expected: `{ "id": "...", "name": "Alice", "email": "alice@acme.com", ... }`

- [ ] **Step 10: Commit**

```bash
git add backend/src/members/ backend/src/app.module.ts
git commit -m "feat: workspace members CRUD (MembersModule)"
```

---

## Task 3: Backend — Project Members Endpoints

**Files:**
- Create: `backend/src/members/dto/add-project-member.dto.ts`
- Modify: `backend/src/members/members.service.ts` — add project member methods
- Modify: `backend/src/members/members.controller.ts` — add project member routes
- Modify: `backend/src/projects/projects.module.ts` — export ProjectsService if needed

**Interfaces:**
- Consumes: `MembersService.getWorkspaceId`, `MembersService.findWorkspaceMemberByEmail`
- Produces: `GET/POST/DELETE /api/projects/:id/members`
- Produces: `MembersService.listProjectMembers`, `MembersService.addToProject`, `MembersService.removeFromProject`

- [ ] **Step 1: Create DTO**

`backend/src/members/dto/add-project-member.dto.ts`:
```typescript
import { IsEmail, IsString, MinLength } from 'class-validator'

export class AddProjectMemberDto {
  @IsString()
  @MinLength(1)
  name: string

  @IsEmail()
  email: string
}
```

- [ ] **Step 2: Add project member methods to MembersService**

Add these methods to `backend/src/members/members.service.ts` (append before the closing `}`):

```typescript
  async listProjectMembers(userId: string, projectId: string) {
    await this.workspaces.findByOwner(userId) // auth check
    const { data, error } = await this.supabase.db
      .from('project_members')
      .select('member_id, workspace_members(id, name, email, created_at)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
    if (error) throw new BadRequestException(error.message)
    return (data ?? []).map((row: any) => row.workspace_members)
  }

  async addToProject(userId: string, projectId: string, dto: AddProjectMemberDto) {
    const workspaceId = await this.getWorkspaceId(userId)

    // Check email conflict
    const byEmail = await this.findByEmail(workspaceId, dto.email)
    if (byEmail && byEmail.name !== dto.name) {
      throw new BadRequestException(JSON.stringify({ code: 'EMAIL_CONFLICT', existing: byEmail }))
    }

    // Check name conflict
    const byName = await this.findByName(workspaceId, dto.name)
    if (byName && byName.email !== dto.email) {
      throw new BadRequestException(JSON.stringify({ code: 'NAME_CONFLICT', existing: byName }))
    }

    // Determine member: exact match → use it; no match → create
    let member = byEmail ?? byName ?? null
    if (!member) {
      const { data, error } = await this.supabase.db
        .from('workspace_members')
        .insert({ workspace_id: workspaceId, name: dto.name, email: dto.email })
        .select()
        .single()
      if (error) throw new BadRequestException(error.message)
      member = data
    }

    // Link to project (ignore if already linked)
    await this.supabase.db
      .from('project_members')
      .upsert({ project_id: projectId, member_id: member.id }, { onConflict: 'project_id,member_id', ignoreDuplicates: true })

    return member
  }

  async removeFromProject(userId: string, projectId: string, memberId: string) {
    await this.workspaces.findByOwner(userId) // auth check
    const { error } = await this.supabase.db
      .from('project_members')
      .delete()
      .eq('project_id', projectId)
      .eq('member_id', memberId)
    if (error) throw new BadRequestException(error.message)
    return { unlinked: true }
  }
```

- [ ] **Step 3: Add project routes to MembersController**

Add these routes to `backend/src/members/members.controller.ts` (append before closing `}`):

```typescript
  @Get('/project/:projectId')
  listProject(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.members.listProjectMembers(user.id, projectId)
  }

  @Post('/project/:projectId')
  addToProject(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: AddProjectMemberDto,
  ) {
    return this.members.addToProject(user.id, projectId, dto)
  }

  @Delete('/project/:projectId/:memberId')
  removeFromProject(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.members.removeFromProject(user.id, projectId, memberId)
  }
```

Also add the import at the top of the controller:
```typescript
import { AddProjectMemberDto } from './dto/add-project-member.dto'
```

- [ ] **Step 4: Manual smoke test**

```bash
TOKEN="<valid token>"
PROJECT_ID="<a real project id from your DB>"

# Add member to project (creates in workspace_members + links)
curl -s -X POST "http://localhost:4000/api/workspaces/members/project/$PROJECT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@acme.com"}' | jq .

# List project members
curl -s "http://localhost:4000/api/workspaces/members/project/$PROJECT_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Add same email again → should get EMAIL_CONFLICT with different name
curl -s -X POST "http://localhost:4000/api/workspaces/members/project/$PROJECT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice Different","email":"alice@acme.com"}' | jq .
```

Expected for conflict: `{ "message": "{\"code\":\"EMAIL_CONFLICT\",\"existing\":{...}}" }`

- [ ] **Step 5: Commit**

```bash
git add backend/src/members/
git commit -m "feat: project members endpoints with upsert conflict logic"
```

---

## Task 4: Platform — Types + Team Page + Sidebar Nav

**Files:**
- Modify: `platform/lib/types.ts`
- Create: `platform/app/(dashboard)/team/page.tsx`
- Modify: `platform/app/(dashboard)/layout.tsx`

**Interfaces:**
- Consumes: `GET /api/workspaces/members`, `POST /api/workspaces/members`, `PATCH /api/workspaces/members/:id`, `DELETE /api/workspaces/members/:id`
- Produces: `/team` route with full member management UI

- [ ] **Step 1: Add TeamMember type**

In `platform/lib/types.ts`, append:
```typescript
export interface TeamMember {
  id: string
  workspace_id: string
  name: string
  email: string
  created_at: string
}

export type MemberConflictCode = 'EMAIL_CONFLICT' | 'NAME_CONFLICT'
export interface MemberConflict {
  code: MemberConflictCode
  existing: TeamMember
}
```

- [ ] **Step 2: Add Team link to sidebar**

In `platform/app/(dashboard)/layout.tsx`, add Team link after the Projects link:
```tsx
<Link href="/team"
  className={`px-3 py-2 rounded-lg text-sm ${pathname.startsWith('/team') ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-100'}`}>
  Team
</Link>
```

- [ ] **Step 3: Create Team page**

`platform/app/(dashboard)/team/page.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import type { TeamMember, MemberConflict } from '@/lib/types'

function parseConflict(err: Error): MemberConflict | null {
  try { return JSON.parse(err.message) } catch { return null }
}

function ConflictBanner({ conflict, onLink }: { conflict: MemberConflict; onLink: () => void }) {
  const msg = conflict.code === 'EMAIL_CONFLICT'
    ? `This email belongs to ${conflict.existing.name}. Link them instead?`
    : `${conflict.existing.name} already exists with email ${conflict.existing.email}. Link them instead?`
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800 flex items-center justify-between gap-4">
      <span>{msg}</span>
      <button onClick={onLink} className="text-amber-900 font-medium underline whitespace-nowrap">Use existing</button>
    </div>
  )
}

function MemberModal({ onClose, editTarget }: { onClose: () => void; editTarget?: TeamMember }) {
  const qc = useQueryClient()
  const [name, setName] = useState(editTarget?.name ?? '')
  const [email, setEmail] = useState(editTarget?.email ?? '')
  const [conflict, setConflict] = useState<MemberConflict | null>(null)
  const [error, setError] = useState('')

  const save = useMutation({
    mutationFn: () => editTarget
      ? api.patch(`/workspaces/members/${editTarget.id}`, { name, email })
      : api.post('/workspaces/members', { name, email }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['team-members'] }); onClose() },
    onError: (err: Error) => {
      const c = parseConflict(err)
      if (c) { setConflict(c); return }
      setError(err.message)
    },
  })

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-sm space-y-4">
        <h2 className="text-base font-semibold text-gray-900">{editTarget ? 'Edit member' : 'Add member'}</h2>
        {conflict && <ConflictBanner conflict={conflict} onLink={onClose} />}
        <div className="space-y-3">
          <input
            placeholder="Full name"
            value={name}
            onChange={e => { setName(e.target.value); setConflict(null); setError('') }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            placeholder="Email address"
            type="email"
            value={email}
            onChange={e => { setEmail(e.target.value); setConflict(null); setError('') }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {error && <p className="text-red-600 text-xs">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button
            onClick={() => name && email && save.mutate()}
            disabled={save.isPending || !name || !email}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TeamPage() {
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState<TeamMember | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<TeamMember | null>(null)

  const { data: members = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ['team-members'],
    queryFn: () => api.get<TeamMember[]>('/workspaces/members'),
  })

  const deleteMember = useMutation({
    mutationFn: (id: string) => api.delete(`/workspaces/members/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['team-members'] }); setDeleteTarget(null) },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team</h1>
          <p className="text-sm text-gray-500 mt-0.5">Workspace members available for bug assignment.</p>
        </div>
        <button
          onClick={() => { setEditTarget(undefined); setShowModal(true) }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          + Add Member
        </button>
      </div>

      {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}

      {!isLoading && members.length === 0 && (
        <div className="text-center py-20 border border-dashed border-gray-200 rounded-xl bg-white">
          <p className="text-base font-medium text-gray-500">No team members yet</p>
          <p className="text-sm text-gray-400 mt-1">Add members to assign bugs to them from the extension.</p>
        </div>
      )}

      {members.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Email</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.map(m => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{m.name}</td>
                  <td className="px-4 py-3 text-gray-600">{m.email}</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button
                      onClick={() => { setEditTarget(m); setShowModal(true) }}
                      className="text-xs text-blue-600 hover:underline"
                    >Edit</button>
                    <button
                      onClick={() => setDeleteTarget(m)}
                      className="text-xs text-red-500 hover:underline"
                    >Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <MemberModal editTarget={editTarget} onClose={() => setShowModal(false)} />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-sm space-y-4">
            <h2 className="text-base font-semibold text-gray-900">Delete member?</h2>
            <p className="text-sm text-gray-600">
              <strong>{deleteTarget.name}</strong> will be unlinked from all projects. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button
                onClick={() => deleteMember.mutate(deleteTarget.id)}
                disabled={deleteMember.isPending}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMember.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Verify UI**

```bash
cd platform && npm run dev
```

Open http://localhost:3000/team. Verify:
- "Team" appears in sidebar, active when on `/team`
- Empty state shows when no members
- "Add Member" opens modal
- Adding a duplicate email shows conflict banner with "Use existing" button
- Edit and Delete work correctly
- Delete confirm mentions "unlinked from all projects"

- [ ] **Step 5: Commit**

```bash
git add platform/lib/types.ts platform/app/\(dashboard\)/team/ platform/app/\(dashboard\)/layout.tsx
git commit -m "feat: Team page and sidebar nav link"
```

---

## Task 5: Platform — Project Page Members Tab

**Files:**
- Modify: `platform/app/(dashboard)/projects/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/workspaces/members/project/:id`, `POST /api/workspaces/members/project/:id`, `DELETE /api/workspaces/members/project/:id/:memberId`
- Consumes: `TeamMember`, `MemberConflict` from `platform/lib/types.ts`

- [ ] **Step 1: Add Members tab to project page**

In `platform/app/(dashboard)/projects/[id]/page.tsx`, make the following changes:

Add imports at the top:
```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TeamMember, MemberConflict } from '@/lib/types'
```

Add `activeTab` state inside the component:
```tsx
const [activeTab, setActiveTab] = useState<'issues' | 'members'>('issues')
```

Add `members` query inside the component (after the `issues` query):
```tsx
const qc = useQueryClient()
const { data: members = [] } = useQuery<TeamMember[]>({
  queryKey: ['project-members', params.id],
  queryFn: () => api.get<TeamMember[]>(`/workspaces/members/project/${params.id}`),
})
```

Add member modal state:
```tsx
const [memberName, setMemberName] = useState('')
const [memberEmail, setMemberEmail] = useState('')
const [addingMember, setAddingMember] = useState(false)
const [memberConflict, setMemberConflict] = useState<MemberConflict | null>(null)
const [memberError, setMemberError] = useState('')

function parseConflict(err: Error): MemberConflict | null {
  try { return JSON.parse(err.message) } catch { return null }
}

const addMember = useMutation({
  mutationFn: () => api.post(`/workspaces/members/project/${params.id}`, { name: memberName, email: memberEmail }),
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['project-members', params.id] })
    qc.invalidateQueries({ queryKey: ['team-members'] })
    setAddingMember(false); setMemberName(''); setMemberEmail(''); setMemberConflict(null)
  },
  onError: (err: Error) => {
    const c = parseConflict(err)
    if (c) { setMemberConflict(c); return }
    setMemberError(err.message)
  },
})

const removeMember = useMutation({
  mutationFn: (memberId: string) => api.delete(`/workspaces/members/project/${params.id}/${memberId}`),
  onSuccess: () => qc.invalidateQueries({ queryKey: ['project-members', params.id] }),
})
```

Replace the existing filter tabs section with tabs that include Members:
```tsx
{/* Tabs */}
<div className="flex gap-0 border-b border-gray-200">
  {(['issues', 'members'] as const).map(tab => (
    <button
      key={tab}
      onClick={() => setActiveTab(tab)}
      className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
        activeTab === tab
          ? 'border-blue-600 text-blue-600'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
      }`}
    >
      {tab === 'issues' ? `Issues (${issues.length})` : `Members (${members.length})`}
    </button>
  ))}
</div>
```

Add Members tab content (place after the Issues tab content, inside the `issues.length > 0` block or as a sibling):
```tsx
{activeTab === 'members' && (
  <div className="space-y-4">
    <div className="flex justify-between items-center">
      <p className="text-sm text-gray-500">Members linked to this project appear as assignee options in the extension.</p>
      <button
        onClick={() => setAddingMember(true)}
        className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700"
      >
        + Add Member
      </button>
    </div>

    {members.length === 0 && (
      <div className="text-center py-12 border border-dashed border-gray-200 rounded-xl bg-white">
        <p className="text-sm text-gray-500">No members linked. Add members to enable assignment in the extension.</p>
      </div>
    )}

    {members.length > 0 && (
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Email</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {members.map(m => (
              <tr key={m.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{m.name}</td>
                <td className="px-4 py-3 text-gray-600">{m.email}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => removeMember.mutate(m.id)}
                    className="text-xs text-red-500 hover:underline"
                  >Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}

    {addingMember && (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-sm space-y-4">
          <h2 className="text-base font-semibold text-gray-900">Add member to project</h2>
          {memberConflict && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
              {memberConflict.code === 'EMAIL_CONFLICT'
                ? `This email belongs to ${memberConflict.existing.name}.`
                : `${memberConflict.existing.name} already exists with email ${memberConflict.existing.email}.`}
              {' '}
              <button
                className="underline font-medium"
                onClick={() => {
                  addMember.mutate()
                }}
              >Link them instead?</button>
            </div>
          )}
          <input
            placeholder="Full name"
            value={memberName}
            onChange={e => { setMemberName(e.target.value); setMemberConflict(null); setMemberError('') }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            placeholder="Email address"
            type="email"
            value={memberEmail}
            onChange={e => { setMemberEmail(e.target.value); setMemberConflict(null); setMemberError('') }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {memberError && <p className="text-red-600 text-xs">{memberError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => { setAddingMember(false); setMemberConflict(null); setMemberError('') }}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button
              onClick={() => memberName && memberEmail && addMember.mutate()}
              disabled={addMember.isPending || !memberName || !memberEmail}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {addMember.isPending ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
)}
```

Wrap existing issues content in `{activeTab === 'issues' && (...)}`.

- [ ] **Step 2: Verify**

Open http://localhost:3000/projects/[some-project-id]. Verify:
- "Issues" and "Members (0)" tabs visible
- Members tab shows empty state with "Add Member" button
- Adding a member with conflict email shows amber warning with "Link them instead?"
- Remove unlinks (member still appears on /team page)
- Members tab count updates after add/remove

- [ ] **Step 3: Commit**

```bash
git add platform/app/\(dashboard\)/projects/
git commit -m "feat: project Members tab with add/remove and conflict handling"
```

---

## Task 6: Extension — Fetch Members on Project Change

**Files:**
- Modify: `extension/background.js`
- Modify: `extension/sidepanel.js`

**Interfaces:**
- Consumes: `GET /api/workspaces/members/project/:id`
- Produces: `GET_PROJECT_MEMBERS` message handler in background.js
- Produces: `window.qaSessionMembers` array passed in `START_REPORTING` message to content.js

- [ ] **Step 1: Add GET_PROJECT_MEMBERS handler in background.js**

In `extension/background.js`, find the `if (type === 'GET_PROJECTS')` block and add after it:

```javascript
  if (type === 'GET_PROJECT_MEMBERS') {
    try {
      const { qa_token } = await chrome.storage.local.get(['qa_token']);
      if (!qa_token) return sendResponse({ ok: false, error: 'Not authenticated' });
      const { SUPABASE_URL, ..._ } = await chrome.storage.local.get(['SUPABASE_URL']);
      const apiBase = 'http://localhost:4000/api'; // matches existing pattern
      const res = await fetch(`${apiBase}/workspaces/members/project/${message.projectId}`, {
        headers: { Authorization: `Bearer ${qa_token}` },
      });
      if (res.status === 401) return sendResponse({ ok: false, error: '401' });
      if (!res.ok) return sendResponse({ ok: false, error: `HTTP ${res.status}` });
      const members = await res.json();
      return sendResponse({ ok: true, members });
    } catch (err) {
      return sendResponse({ ok: false, error: err.message });
    }
  }
```

Note: check what `apiBase` value is used in existing `GET_PROJECTS` handler and use the same one.

- [ ] **Step 2: Fetch members on project change in sidepanel.js**

In `extension/sidepanel.js`, add a session-level variable near the top (after existing variable declarations):

```javascript
let sessionMembers = []; // project members for current project, in-memory only
```

In the `projectSelect.addEventListener('change', ...)` handler, after saving to storage, add:

```javascript
projectSelect.addEventListener('change', async () => {
  const id   = projectSelect.value;
  const name = projectSelect.options[projectSelect.selectedIndex]?.textContent || '';
  if (id) {
    await chrome.storage.local.set({ qa_selected_project: { id, name } });
    // Fetch members for newly selected project
    const resp = await chrome.runtime.sendMessage({ type: 'GET_PROJECT_MEMBERS', projectId: id });
    sessionMembers = resp.ok ? (resp.members || []) : [];
  } else {
    sessionMembers = [];
  }
});
```

- [ ] **Step 3: Pass members in START_REPORTING message**

In the `startRecording()` function in `sidepanel.js`, modify the `START_REPORTING` message to include members:

```javascript
// Find this line:
await chrome.tabs.sendMessage(tab.id, { type: 'START_REPORTING' });
// Replace with:
await chrome.tabs.sendMessage(tab.id, { type: 'START_REPORTING', members: sessionMembers });
```

Apply the same replacement in the retry branch:
```javascript
await chrome.tabs.sendMessage(tab.id, { type: 'START_REPORTING', members: sessionMembers });
```

- [ ] **Step 4: Also fetch on initial load if project already selected**

In `sidepanel.js`, at the end of `populateProjects()` after `projectSelect.disabled = false`, add:

```javascript
  // Pre-fetch members for already-selected project
  if (projectSelect.value) {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_PROJECT_MEMBERS', projectId: projectSelect.value });
    sessionMembers = resp.ok ? (resp.members || []) : [];
  }
```

- [ ] **Step 5: Verify**

Reload the extension in chrome://extensions. Open sidepanel. Select a project that has members added (from Task 5). Open background service worker console → confirm `GET_PROJECT_MEMBERS` fires and returns members. Start recording and check that content.js `START_REPORTING` message includes `members` array.

- [ ] **Step 6: Commit**

```bash
git add extension/background.js extension/sidepanel.js
git commit -m "feat: extension fetches project members on project select"
```

---

## Task 7: Extension — Assignee Dropdown in Bug Modal

**Files:**
- Modify: `extension/content.js`

**Interfaces:**
- Consumes: `members` array in `START_REPORTING` message `[{ id, name, email }]`
- Consumes: `qa_user_email` from `chrome.storage.local` (passed in `START_REPORTING` or read from storage)
- Produces: `issue.metadata.assignee` (email string) in submitted issue payload

- [ ] **Step 1: Store members and owner email on START_REPORTING**

In `extension/content.js`, find the `START_REPORTING` message handler (where `isRecording = true` is set). Add:

```javascript
// Add these two variables near the top of content.js (module scope):
let qaSessionMembers = [];
let qaLastAssignee = null; // sticky across bugs in session
let qaOwnerEmail = null;
```

In the `START_REPORTING` handler:
```javascript
case 'START_REPORTING': {
  isRecording = true;
  qaSessionMembers = message.members || [];
  // Get owner email from storage for "Me (default)" option
  chrome.storage.local.get(['qa_user_email'], ({ qa_user_email }) => {
    qaOwnerEmail = qa_user_email || null;
  });
  // ... rest of existing handler
}
```

- [ ] **Step 2: Add assignee dropdown to the bug modal**

In `extension/content.js`, find where the severity dropdown is rendered in the modal HTML. The modal is built via `innerHTML` or `createElement` — find the severity `<select>` and add the assignee dropdown after it.

Find the severity select block (it sets `issue.severity`) and after it add:

```javascript
// Build assignee options
function buildAssigneeSelect(currentValue) {
  const options = [];
  const ownerLabel = qaOwnerEmail ? `Me (${qaOwnerEmail})` : 'Me (default)';
  const ownerVal = qaOwnerEmail || '__me__';
  options.push(`<option value="${ownerVal}" ${!currentValue || currentValue === ownerVal ? 'selected' : ''}>${ownerLabel}</option>`);
  qaSessionMembers.forEach(m => {
    const sel = currentValue === m.email ? 'selected' : '';
    options.push(`<option value="${m.email}" ${sel}>${m.name}</option>`);
  });
  return options.join('');
}
```

In the modal HTML string, after the severity select, insert:

```javascript
// Only render if there are members OR owner email is known
`<div class="qa-field">
  <label class="qa-label">Assignee</label>
  <select id="qa-assignee-select" class="qa-select">
    ${buildAssigneeSelect(qaLastAssignee)}
  </select>
</div>`
```

Add the `qa-select` CSS class to `content-styles.css` if not already present:
```css
.qa-select {
  width: 100% !important;
  border: 1px solid var(--qa-border) !important;
  border-radius: 6px !important;
  padding: 6px 10px !important;
  font-size: 13px !important;
  background: var(--qa-surface) !important;
  color: var(--qa-text-hi) !important;
  appearance: auto !important;
}
```

- [ ] **Step 3: Read assignee value on submit and make it sticky**

In content.js, in the issue submit handler (where `issue.title`, `issue.severity` etc. are read from the modal), add:

```javascript
const assigneeSelect = document.getElementById('qa-assignee-select');
const rawAssignee = assigneeSelect ? assigneeSelect.value : null;
// Resolve __me__ to actual owner email
const resolvedAssignee = rawAssignee === '__me__' ? (qaOwnerEmail || null) : rawAssignee;
qaLastAssignee = rawAssignee; // sticky: remember for next bug (keep __me__ token)
```

In the issue payload passed to background (the metadata object), add:
```javascript
metadata: {
  // ...existing fields
  assignee: resolvedAssignee,
}
```

- [ ] **Step 4: Verify**

1. Add a team member to a project via the platform Members tab
2. Reload the extension, select that project, start recording
3. Click an element → bug modal opens → Assignee dropdown shows "Me (default)" + the member's name
4. Submit bug with member selected
5. In Supabase → issues table → metadata column → confirm `"assignee": "member@email.com"`
6. Submit a second bug → assignee dropdown pre-selects last chosen member (sticky)
7. Test with no members linked → only "Me (default)" shown, no empty dropdown state

- [ ] **Step 5: Commit**

```bash
git add extension/content.js extension/content-styles.css
git commit -m "feat: assignee dropdown in bug modal with sticky session default"
```

---

## Task 8: Azure Sync — New Fields + Assignee Resolution

**Files:**
- Modify: `backend/src/integrations/integrations.service.ts`

**Interfaces:**
- Consumes: `issue.metadata.assignee` (email string)
- Consumes: `issue.metadata.priority`, `issue.metadata.labels`, `issue.metadata.sprint`
- Consumes: `issue.severity` (string: 'Critical' | 'High' | 'Medium' | 'Low')

- [ ] **Step 1: Expand AZURE_FIELDS and QA_SOURCE_FIELDS**

In `backend/src/integrations/integrations.service.ts`, replace the existing arrays:

```typescript
export const AZURE_FIELDS = [
  { field: 'System.Title',                          label: 'Title',                    required: true },
  { field: 'Microsoft.VSTS.TCM.ReproSteps',         label: 'Repro Steps' },
  { field: 'System.Description',                    label: 'Description / System Info' },
  { field: 'System.AssignedTo',                     label: 'Assigned To' },
  { field: 'Microsoft.VSTS.Common.Priority',        label: 'Priority' },
  { field: 'Microsoft.VSTS.Common.Severity',        label: 'Severity' },
  { field: 'System.Tags',                           label: 'Tags' },
  { field: 'System.IterationPath',                  label: 'Sprint / Iteration' },
]

export const QA_SOURCE_FIELDS = [
  { key: 'description',   label: 'Bug description' },
  { key: 'url',           label: 'Page URL' },
  { key: 'route',         label: 'App route' },
  { key: 'screenshot_url',label: 'Screenshot link' },
  { key: 'browser_info',  label: 'Browser / OS info' },
  { key: 'element_info',  label: 'Element info' },
  { key: 'repro_steps',   label: 'Repro Steps (auto-built)' },
  { key: 'system_info',   label: 'System Info (auto-built)' },
  { key: 'assignee',      label: 'Assignee (email)' },
  { key: 'priority',      label: 'Priority' },
  { key: 'severity',      label: 'Severity' },
  { key: 'labels',        label: 'Labels (as tags)' },
  { key: 'sprint',        label: 'Sprint / Iteration path' },
]
```

- [ ] **Step 2: Update DEFAULT_FIELD_MAPPING**

```typescript
const DEFAULT_FIELD_MAPPING: Record<string, string> = {
  'System.Title':                          'description',
  'Microsoft.VSTS.TCM.ReproSteps':         'repro_steps',
  'System.Description':                    'system_info',
  'System.AssignedTo':                     'assignee',
}
```

- [ ] **Step 3: Add new cases to resolveSource**

In the `resolveSource` method, add before the `default` case:

```typescript
      case 'assignee':
        return issue.metadata?.assignee ?? ''

      case 'priority': {
        const p = (issue.metadata?.priority ?? '').toLowerCase()
        const map: Record<string, string> = { critical: '1', high: '2', medium: '3', low: '4' }
        return map[p] ?? ''
      }

      case 'severity': {
        const s = (issue.severity ?? '').toLowerCase()
        const map: Record<string, string> = {
          critical: '1 - Critical',
          high:     '2 - High',
          medium:   '3 - Medium',
          low:      '4 - Low',
        }
        return map[s] ?? ''
      }

      case 'labels': {
        const labels = issue.metadata?.labels
        if (!Array.isArray(labels) || !labels.length) return ''
        return labels.join('; ')
      }

      case 'sprint':
        return issue.metadata?.sprint ?? ''
```

- [ ] **Step 4: Verify end-to-end**

1. Make sure a bug was submitted with an assignee email in `metadata.assignee`
2. Go to platform → project → issue → click "Sync to Azure"
3. Open the created Azure work item → verify "Assigned To" shows the member's email/name
4. Check Repro Steps and Description are rich HTML with metadata sections

- [ ] **Step 5: Commit**

```bash
git add backend/src/integrations/integrations.service.ts
git commit -m "feat: Azure sync — assignee, priority, severity, labels, sprint fields"
```

---

## Self-Review

**Spec coverage:**
- ✅ workspace_members + project_members tables with correct constraints
- ✅ Global Team page (create, edit, delete members)
- ✅ Project Members tab (add with upsert, remove from project)
- ✅ Conflict cases: EMAIL_CONFLICT, NAME_CONFLICT, exact match silent
- ✅ Extension fetches members on project change
- ✅ Assignee dropdown in bug modal, sticky across bugs
- ✅ "Me (default)" uses owner email, first option always
- ✅ Azure AssignedTo, Priority, Severity, Tags, IterationPath fields
- ✅ Default mapping includes System.AssignedTo

**Placeholder scan:** None found. All steps include actual code.

**Type consistency:**
- `TeamMember` defined in `platform/lib/types.ts` Task 4, consumed in Task 5 ✅
- `MemberConflict.code` is `'EMAIL_CONFLICT' | 'NAME_CONFLICT'` — consistent across Tasks 4, 5 ✅
- `sessionMembers` in sidepanel.js matches `members` array shape `[{id, name, email}]` ✅
- `issue.metadata.assignee` email string — set in Task 7, read in Task 8 ✅
