# QA Reporter Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the QA Reporter SaaS platform — Supabase backend, Next.js dashboard, extension auth + issue submission, and Azure DevOps sync via PAT.

**Architecture:** Extension POSTs issues (with screenshots) to a Next.js API route, which stores them in Supabase Postgres and Storage. The web dashboard shows issues per project and lets users sync individual issues to Azure DevOps using a saved PAT.

**Tech Stack:** Next.js 14 (App Router), Tailwind CSS, TanStack Query, Supabase (Auth + Postgres + Storage), Chrome MV3 extension (vanilla JS)

---

## File Map

```
platform/                          ← New Next.js app
  app/
    layout.tsx                     ← Root layout, font, Tailwind
    page.tsx                       ← Redirect to /projects
    (auth)/
      login/page.tsx               ← Login form
      signup/page.tsx              ← Signup form (creates workspace)
    (dashboard)/
      layout.tsx                   ← Auth guard, sidebar nav
      projects/
        page.tsx                   ← Projects list
        [id]/
          page.tsx                 ← Issue list for project
          issues/
            [issueId]/page.tsx     ← Issue detail + sync button
      settings/
        integrations/page.tsx      ← Azure PAT setup
  api/
    issues/route.ts                ← POST: receive bug from extension
    integrations/
      azure/
        test/route.ts              ← POST: validate PAT connection
        sync/[issueId]/route.ts    ← POST: sync one issue to ADO
  lib/
    supabase/
      client.ts                    ← Browser Supabase client
      server.ts                    ← Server-side Supabase client
      middleware.ts                ← Session refresh middleware
    azure/
      adapter.ts                   ← Azure DevOps REST API calls
    encryption.ts                  ← AES-256 encrypt/decrypt PAT
    types.ts                       ← Shared TypeScript types
  middleware.ts                    ← Route protection
  components/
    ProjectCard.tsx
    IssueRow.tsx
    IssueDetail.tsx
    SyncButton.tsx
    AzureSetupForm.tsx
  next.config.js
  tailwind.config.ts
  tsconfig.json
  package.json

src/popup/
  auth.js                          ← New: Supabase auth for extension
  api.js                           ← New: POST issues to platform
  popup.html                       ← Modified: add login form + project selector
  popup.js                         ← Modified: auth flow + API call
```

---

## Task 1: Supabase Project Setup

**Files:** None (Supabase MCP + SQL migrations)

- [ ] **Step 1: Create Supabase project**

  Use the Supabase MCP to create a new project. Note the project URL and anon key — you'll need them in Task 2.

- [ ] **Step 2: Run schema migration**

  Run the following SQL via Supabase MCP `apply_migration`:

  ```sql
  -- Enable UUID extension
  create extension if not exists "pgcrypto";

  -- Workspaces
  create table workspaces (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    owner_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz default now()
  );

  -- Projects
  create type sync_mode_enum as enum ('auto', 'manual');

  create table projects (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces(id) on delete cascade,
    name text not null,
    sync_mode sync_mode_enum not null default 'manual',
    created_at timestamptz default now()
  );

  -- Issues
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

  -- Integrations
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

  -- Issue sync logs
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

- [ ] **Step 3: Enable Row Level Security**

  Run via Supabase MCP `apply_migration`:

  ```sql
  -- RLS on all tables
  alter table workspaces enable row level security;
  alter table projects enable row level security;
  alter table issues enable row level security;
  alter table integrations enable row level security;
  alter table issue_sync_logs enable row level security;

  -- Workspaces: owner can read/write their own
  create policy "workspace_owner" on workspaces
    for all using (owner_id = auth.uid());

  -- Projects: users whose workspace they own
  create policy "project_owner" on projects
    for all using (
      workspace_id in (select id from workspaces where owner_id = auth.uid())
    );

  -- Issues: users whose project workspace they own
  create policy "issue_owner" on issues
    for all using (
      project_id in (
        select p.id from projects p
        join workspaces w on w.id = p.workspace_id
        where w.owner_id = auth.uid()
      )
    );

  -- Integrations: workspace owner only
  create policy "integration_owner" on integrations
    for all using (
      workspace_id in (select id from workspaces where owner_id = auth.uid())
    );

  -- Issue sync logs: readable if issue is accessible
  create policy "sync_log_owner" on issue_sync_logs
    for all using (
      issue_id in (
        select i.id from issues i
        join projects p on p.id = i.project_id
        join workspaces w on w.id = p.workspace_id
        where w.owner_id = auth.uid()
      )
    );
  ```

- [ ] **Step 4: Create screenshots storage bucket**

  Run via Supabase MCP `apply_migration`:

  ```sql
  insert into storage.buckets (id, name, public)
  values ('screenshots', 'screenshots', false);

  create policy "screenshots_owner" on storage.objects
    for all using (
      bucket_id = 'screenshots' and auth.uid() is not null
    );
  ```

- [ ] **Step 5: Verify tables exist**

  Use Supabase MCP `list_tables` and confirm: `workspaces`, `projects`, `issues`, `integrations`, `issue_sync_logs` are present.

- [ ] **Step 6: Commit**

  ```bash
  git add docs/
  git commit -m "feat: add supabase schema migration notes"
  ```

---

## Task 2: Next.js App Scaffold

**Files:**
- Create: `platform/package.json`
- Create: `platform/next.config.js`
- Create: `platform/tailwind.config.ts`
- Create: `platform/tsconfig.json`
- Create: `platform/lib/types.ts`
- Create: `platform/lib/supabase/client.ts`
- Create: `platform/lib/supabase/server.ts`
- Create: `platform/middleware.ts`
- Create: `platform/app/layout.tsx`
- Create: `platform/app/page.tsx`

- [ ] **Step 1: Scaffold Next.js app**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3"
  npx create-next-app@14 platform --typescript --tailwind --app --no-src-dir --import-alias "@/*"
  ```

  When prompted, accept defaults.

- [ ] **Step 2: Install dependencies**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3/platform"
  npm install @supabase/supabase-js @supabase/ssr @tanstack/react-query @tanstack/react-query-devtools
  ```

- [ ] **Step 3: Create environment file**

  Create `platform/.env.local`:
  ```
  NEXT_PUBLIC_SUPABASE_URL=<your-supabase-project-url>
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>
  SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
  ENCRYPTION_SECRET=<random-32-char-string>
  ```

  Get values from Supabase MCP `get_project_url` and `get_publishable_keys`.

- [ ] **Step 4: Create shared types**

  Create `platform/lib/types.ts`:
  ```typescript
  export type SyncStatus = 'pending' | 'synced' | 'failed'
  export type SyncMode = 'auto' | 'manual'
  export type Provider = 'azure_devops' | 'jira' | 'monday'

  export interface Workspace {
    id: string
    name: string
    owner_id: string
    created_at: string
  }

  export interface Project {
    id: string
    workspace_id: string
    name: string
    sync_mode: SyncMode
    created_at: string
  }

  export interface Issue {
    id: string
    project_id: string
    reporter_id: string
    description: string
    url: string | null
    route: string | null
    browser_info: Record<string, string> | null
    element_info: Record<string, string> | null
    screenshot_url: string | null
    element_screenshot_url: string | null
    sync_status: SyncStatus
    external_ticket_id: string | null
    external_ticket_url: string | null
    created_at: string
  }

  export interface Integration {
    id: string
    workspace_id: string
    provider: Provider
    config: {
      org_url?: string
      project_name?: string
    }
    created_at: string
  }
  ```

- [ ] **Step 5: Create browser Supabase client**

  Create `platform/lib/supabase/client.ts`:
  ```typescript
  import { createBrowserClient } from '@supabase/ssr'

  export function createClient() {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  ```

- [ ] **Step 6: Create server Supabase client**

  Create `platform/lib/supabase/server.ts`:
  ```typescript
  import { createServerClient } from '@supabase/ssr'
  import { cookies } from 'next/headers'

  export function createClient() {
    const cookieStore = cookies()
    return createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {}
          },
        },
      }
    )
  }
  ```

- [ ] **Step 7: Create middleware for session refresh + route protection**

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
          getAll() { return request.cookies.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
            supabaseResponse = NextResponse.next({ request })
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    const { data: { user } } = await supabase.auth.getUser()

    const isAuthRoute = request.nextUrl.pathname.startsWith('/login') ||
                        request.nextUrl.pathname.startsWith('/signup')

    if (!user && !isAuthRoute) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    if (user && isAuthRoute) {
      return NextResponse.redirect(new URL('/projects', request.url))
    }

    return supabaseResponse
  }

  export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
  }
  ```

- [ ] **Step 8: Create root layout**

  Replace `platform/app/layout.tsx`:
  ```tsx
  import type { Metadata } from 'next'
  import { Inter } from 'next/font/google'
  import './globals.css'

  const inter = Inter({ subsets: ['latin'] })

  export const metadata: Metadata = {
    title: 'QA Reporter',
    description: 'Bug reporting platform',
  }

  export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
      <html lang="en">
        <body className={inter.className}>{children}</body>
      </html>
    )
  }
  ```

- [ ] **Step 9: Create root redirect page**

  Replace `platform/app/page.tsx`:
  ```tsx
  import { redirect } from 'next/navigation'

  export default function Home() {
    redirect('/projects')
  }
  ```

- [ ] **Step 10: Verify app starts**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3/platform"
  npm run dev
  ```

  Open http://localhost:3001 — should redirect to `/login` (404 for now is fine, confirms redirect works).

  Stop the server with Ctrl+C.

- [ ] **Step 11: Commit**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3"
  git add platform/
  git commit -m "feat: scaffold Next.js platform with Supabase clients and middleware"
  ```

---

## Task 3: Auth Pages (Signup + Login)

**Files:**
- Create: `platform/app/(auth)/login/page.tsx`
- Create: `platform/app/(auth)/signup/page.tsx`

**✅ Validation checkpoint:** After this task you can sign up and log in via the web app.

- [ ] **Step 1: Create login page**

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
      if (error) {
        setError(error.message)
        setLoading(false)
      } else {
        router.push('/projects')
        router.refresh()
      }
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm bg-white rounded-xl shadow p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Sign in to QA Reporter</h1>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
          <p className="mt-4 text-sm text-gray-600 text-center">
            No account?{' '}
            <Link href="/signup" className="text-blue-600 hover:underline">Sign up</Link>
          </p>
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 2: Create signup page**

  Create `platform/app/(auth)/signup/page.tsx`:
  ```tsx
  'use client'
  import { useState } from 'react'
  import { useRouter } from 'next/navigation'
  import Link from 'next/link'
  import { createClient } from '@/lib/supabase/client'

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

      const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
      if (signUpError || !data.user) {
        setError(signUpError?.message ?? 'Signup failed')
        setLoading(false)
        return
      }

      const { error: wsError } = await supabase
        .from('workspaces')
        .insert({ name: workspaceName, owner_id: data.user.id })

      if (wsError) {
        setError(wsError.message)
        setLoading(false)
        return
      }

      router.push('/projects')
      router.refresh()
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm bg-white rounded-xl shadow p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Create your account</h1>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Workspace name</label>
              <input
                type="text"
                required
                value={workspaceName}
                onChange={e => setWorkspaceName(e.target.value)}
                placeholder="Acme Corp"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Creating account...' : 'Create account'}
            </button>
          </form>
          <p className="mt-4 text-sm text-gray-600 text-center">
            Already have an account?{' '}
            <Link href="/login" className="text-blue-600 hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 3: Start dev server and validate**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3/platform"
  npm run dev
  ```

  - Open http://localhost:3000/signup
  - Create an account with a workspace name
  - Confirm it redirects to /projects (404 is fine for now)
  - Open http://localhost:3000/login, sign in with the same credentials
  - Confirm it redirects to /projects

- [ ] **Step 4: Commit**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3"
  git add platform/
  git commit -m "feat: add signup and login pages"
  ```

---

## Task 4: Dashboard Layout + Projects Page

**Files:**
- Create: `platform/app/(dashboard)/layout.tsx`
- Create: `platform/app/(dashboard)/projects/page.tsx`
- Create: `platform/components/ProjectCard.tsx`

**✅ Validation checkpoint:** After this task you can see your workspace's project list and create a new project.

- [ ] **Step 1: Create dashboard layout with nav**

  Create `platform/app/(dashboard)/layout.tsx`:
  ```tsx
  import { redirect } from 'next/navigation'
  import Link from 'next/link'
  import { createClient } from '@/lib/supabase/server'

  export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/login')

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('name')
      .eq('owner_id', user.id)
      .single()

    return (
      <div className="min-h-screen bg-gray-50 flex">
        <aside className="w-56 bg-white border-r border-gray-200 flex flex-col p-4 gap-1">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-2 mb-3">
            {workspace?.name ?? 'My Workspace'}
          </div>
          <Link href="/projects" className="px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100">
            Projects
          </Link>
          <Link href="/settings/integrations" className="px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100">
            Integrations
          </Link>
        </aside>
        <main className="flex-1 p-8">{children}</main>
      </div>
    )
  }
  ```

- [ ] **Step 2: Create ProjectCard component**

  Create `platform/components/ProjectCard.tsx`:
  ```tsx
  import Link from 'next/link'
  import type { Project } from '@/lib/types'

  export function ProjectCard({ project }: { project: Project }) {
    return (
      <Link
        href={`/projects/${project.id}`}
        className="block bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-400 hover:shadow-sm transition-all"
      >
        <h3 className="font-semibold text-gray-900">{project.name}</h3>
        <p className="text-xs text-gray-500 mt-1 capitalize">Sync: {project.sync_mode}</p>
      </Link>
    )
  }
  ```

- [ ] **Step 3: Create projects page**

  Create `platform/app/(dashboard)/projects/page.tsx`:
  ```tsx
  'use client'
  import { useState } from 'react'
  import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
  import { createClient } from '@/lib/supabase/client'
  import { ProjectCard } from '@/components/ProjectCard'
  import type { Project } from '@/lib/types'

  export default function ProjectsPage() {
    const supabase = createClient()
    const qc = useQueryClient()
    const [name, setName] = useState('')
    const [creating, setCreating] = useState(false)

    const { data: projects = [], isLoading } = useQuery<Project[]>({
      queryKey: ['projects'],
      queryFn: async () => {
        const { data: workspace } = await supabase
          .from('workspaces')
          .select('id')
          .single()
        const { data } = await supabase
          .from('projects')
          .select('*')
          .eq('workspace_id', workspace!.id)
          .order('created_at', { ascending: false })
        return data ?? []
      },
    })

    const createProject = useMutation({
      mutationFn: async (projectName: string) => {
        const { data: workspace } = await supabase
          .from('workspaces')
          .select('id')
          .single()
        await supabase.from('projects').insert({
          name: projectName,
          workspace_id: workspace!.id,
          sync_mode: 'manual',
        })
      },
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['projects'] })
        setName('')
        setCreating(false)
      },
    })

    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <button
            onClick={() => setCreating(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            + New Project
          </button>
        </div>

        {creating && (
          <div className="mb-6 flex gap-3">
            <input
              autoFocus
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Project name"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={e => e.key === 'Enter' && name && createProject.mutate(name)}
            />
            <button
              onClick={() => name && createProject.mutate(name)}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              Create
            </button>
            <button
              onClick={() => setCreating(false)}
              className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        )}

        {isLoading && <p className="text-gray-500 text-sm">Loading...</p>}

        {!isLoading && projects.length === 0 && (
          <p className="text-gray-500 text-sm">No projects yet. Create your first one.</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(p => <ProjectCard key={p.id} project={p} />)}
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 4: Add TanStack Query provider to root layout**

  Update `platform/app/layout.tsx`:
  ```tsx
  'use client'
  import type { Metadata } from 'next'
  import { Inter } from 'next/font/google'
  import './globals.css'
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
  import { useState } from 'react'

  const inter = Inter({ subsets: ['latin'] })

  export default function RootLayout({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(() => new QueryClient())
    return (
      <html lang="en">
        <body className={inter.className}>
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        </body>
      </html>
    )
  }
  ```

  > Note: Remove `export const metadata` — it can't coexist with `'use client'` in a layout. Move metadata to individual page files if needed.

- [ ] **Step 5: Validate**

  - Run `npm run dev` in `platform/`
  - Sign in, navigate to /projects
  - Create a project — confirm it appears in the list
  - Click the project — you'll get a 404 (fine, next task)

- [ ] **Step 6: Commit**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3"
  git add platform/
  git commit -m "feat: add dashboard layout and projects page"
  ```

---

## Task 5: Issue List + Issue Detail Pages

**Files:**
- Create: `platform/app/(dashboard)/projects/[id]/page.tsx`
- Create: `platform/app/(dashboard)/projects/[id]/issues/[issueId]/page.tsx`
- Create: `platform/components/IssueRow.tsx`
- Create: `platform/components/IssueDetail.tsx`
- Create: `platform/components/SyncButton.tsx`

**✅ Validation checkpoint:** After this task you can see issues per project and view their detail page. (Issues will be empty until Task 7.)

- [ ] **Step 1: Create IssueRow component**

  Create `platform/components/IssueRow.tsx`:
  ```tsx
  import Link from 'next/link'
  import type { Issue } from '@/lib/types'

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    synced: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  }

  export function IssueRow({ issue, projectId }: { issue: Issue; projectId: string }) {
    return (
      <Link
        href={`/projects/${projectId}/issues/${issue.id}`}
        className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-0"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-900 truncate">{issue.description}</p>
          <p className="text-xs text-gray-400 mt-0.5">{issue.route ?? issue.url ?? '—'}</p>
        </div>
        <span className={`ml-4 text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[issue.sync_status]}`}>
          {issue.sync_status}
        </span>
      </Link>
    )
  }
  ```

- [ ] **Step 2: Create issue list page**

  Create `platform/app/(dashboard)/projects/[id]/page.tsx`:
  ```tsx
  'use client'
  import { useQuery } from '@tanstack/react-query'
  import { createClient } from '@/lib/supabase/client'
  import { IssueRow } from '@/components/IssueRow'
  import type { Issue, Project } from '@/lib/types'

  export default function ProjectPage({ params }: { params: { id: string } }) {
    const supabase = createClient()

    const { data: project } = useQuery<Project>({
      queryKey: ['project', params.id],
      queryFn: async () => {
        const { data } = await supabase.from('projects').select('*').eq('id', params.id).single()
        return data!
      },
    })

    const { data: issues = [], isLoading } = useQuery<Issue[]>({
      queryKey: ['issues', params.id],
      queryFn: async () => {
        const { data } = await supabase
          .from('issues')
          .select('*')
          .eq('project_id', params.id)
          .order('created_at', { ascending: false })
        return data ?? []
      },
    })

    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          {project?.name ?? 'Project'}
        </h1>

        {isLoading && <p className="text-gray-500 text-sm">Loading...</p>}

        {!isLoading && issues.length === 0 && (
          <p className="text-gray-500 text-sm">
            No issues yet. Report one from the Chrome extension.
          </p>
        )}

        {issues.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {issues.map(issue => (
              <IssueRow key={issue.id} issue={issue} projectId={params.id} />
            ))}
          </div>
        )}
      </div>
    )
  }
  ```

- [ ] **Step 3: Create SyncButton component**

  Create `platform/components/SyncButton.tsx`:
  ```tsx
  'use client'
  import { useState } from 'react'
  import { useQueryClient } from '@tanstack/react-query'

  export function SyncButton({ issueId, projectId, currentStatus }: {
    issueId: string
    projectId: string
    currentStatus: string
  }) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const qc = useQueryClient()

    async function handleSync() {
      setLoading(true)
      setError('')
      const res = await fetch(`/api/integrations/azure/sync/${issueId}`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? 'Sync failed')
      } else {
        qc.invalidateQueries({ queryKey: ['issue', issueId] })
        qc.invalidateQueries({ queryKey: ['issues', projectId] })
      }
      setLoading(false)
    }

    if (currentStatus === 'synced') {
      return <span className="text-sm text-green-600 font-medium">✓ Synced to Azure</span>
    }

    return (
      <div>
        <button
          onClick={handleSync}
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Syncing...' : 'Sync to Azure'}
        </button>
        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
      </div>
    )
  }
  ```

- [ ] **Step 4: Create issue detail page**

  Create `platform/app/(dashboard)/projects/[id]/issues/[issueId]/page.tsx`:
  ```tsx
  'use client'
  import { useQuery } from '@tanstack/react-query'
  import { createClient } from '@/lib/supabase/client'
  import { SyncButton } from '@/components/SyncButton'
  import type { Issue } from '@/lib/types'

  export default function IssueDetailPage({
    params,
  }: {
    params: { id: string; issueId: string }
  }) {
    const supabase = createClient()

    const { data: issue, isLoading } = useQuery<Issue>({
      queryKey: ['issue', params.issueId],
      queryFn: async () => {
        const { data } = await supabase
          .from('issues')
          .select('*')
          .eq('id', params.issueId)
          .single()
        return data!
      },
    })

    if (isLoading) return <div className="text-gray-500 text-sm">Loading...</div>
    if (!issue) return <div className="text-red-500 text-sm">Issue not found</div>

    return (
      <div className="max-w-3xl">
        <div className="flex items-start justify-between mb-6">
          <h1 className="text-xl font-bold text-gray-900 flex-1 mr-4">{issue.description}</h1>
          <SyncButton
            issueId={issue.id}
            projectId={params.id}
            currentStatus={issue.sync_status}
          />
        </div>

        {issue.external_ticket_url && (
          <a
            href={issue.external_ticket_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mb-4 text-sm text-blue-600 hover:underline"
          >
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
            <InfoRow label="URL" value={issue.url} />
            <InfoRow label="Route" value={issue.route} />
            <InfoRow label="Sync status" value={issue.sync_status} />
            {issue.browser_info && (
              <InfoRow label="Browser" value={JSON.stringify(issue.browser_info)} />
            )}
            {issue.element_info && (
              <InfoRow label="Element" value={JSON.stringify(issue.element_info)} />
            )}
          </div>
        </div>
      </div>
    )
  }

  function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
    if (!value) return null
    return (
      <div>
        <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</dt>
        <dd className="text-sm text-gray-700 mt-0.5 break-all">{value}</dd>
      </div>
    )
  }
  ```

- [ ] **Step 5: Validate**

  - Run the dev server, sign in, go to /projects
  - Click a project → see empty issue list with the message
  - The "Sync to Azure" button shows on issue detail (you'll test it fully in Task 9)

- [ ] **Step 6: Commit**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3"
  git add platform/
  git commit -m "feat: add issue list and issue detail pages"
  ```

---

## Task 6: POST /api/issues Endpoint

**Files:**
- Create: `platform/api/issues/route.ts`

**✅ Validation checkpoint:** After this task you can POST a bug payload via curl and see it appear in the dashboard.

- [ ] **Step 1: Create the issues API route**

  Create `platform/app/api/issues/route.ts`:
  ```typescript
  import { NextRequest, NextResponse } from 'next/server'
  import { createServerClient } from '@supabase/ssr'

  export async function POST(req: NextRequest) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => req.cookies.getAll(),
          setAll: () => {},
        },
      }
    )

    // Validate JWT from Authorization header
    const authHeader = req.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const {
      project_id,
      description,
      url,
      route,
      browser_info,
      element_info,
      screenshot,        // base64 string
      element_screenshot // base64 string
    } = body

    if (!project_id || !description) {
      return NextResponse.json({ error: 'project_id and description are required' }, { status: 400 })
    }

    // Use service role client for storage uploads (bypasses RLS on storage)
    const { createClient } = await import('@supabase/supabase-js')
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    let screenshot_url: string | null = null
    let element_screenshot_url: string | null = null

    if (screenshot) {
      const buffer = Buffer.from(screenshot.replace(/^data:image\/\w+;base64,/, ''), 'base64')
      const filename = `${user.id}/${project_id}/${Date.now()}-screenshot.png`
      const { error: uploadError } = await adminClient.storage
        .from('screenshots')
        .upload(filename, buffer, { contentType: 'image/png' })
      if (!uploadError) {
        const { data: { signedUrl } } = await adminClient.storage
          .from('screenshots')
          .createSignedUrl(filename, 60 * 60 * 24 * 365) // 1 year
        screenshot_url = signedUrl
      }
    }

    if (element_screenshot) {
      const buffer = Buffer.from(element_screenshot.replace(/^data:image\/\w+;base64,/, ''), 'base64')
      const filename = `${user.id}/${project_id}/${Date.now()}-element.png`
      const { error: uploadError } = await adminClient.storage
        .from('screenshots')
        .upload(filename, buffer, { contentType: 'image/png' })
      if (!uploadError) {
        const { data: { signedUrl } } = await adminClient.storage
          .from('screenshots')
          .createSignedUrl(filename, 60 * 60 * 24 * 365)
        element_screenshot_url = signedUrl
      }
    }

    // Insert issue using user's JWT (respects RLS)
    const userClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    )

    const { data: issue, error: insertError } = await userClient
      .from('issues')
      .insert({
        project_id,
        reporter_id: user.id,
        description,
        url: url ?? null,
        route: route ?? null,
        browser_info: browser_info ?? null,
        element_info: element_info ?? null,
        screenshot_url,
        element_screenshot_url,
        sync_status: 'pending',
      })
      .select()
      .single()

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ issue }, { status: 201 })
  }
  ```

- [ ] **Step 2: Test with curl**

  First get a real JWT — sign in via the web app and copy the access token from browser DevTools (Application → Local Storage → supabase session → `access_token`). Also get a real project_id from /projects in the dashboard URL.

  ```bash
  curl -X POST http://localhost:3000/api/issues \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <your-jwt-token>" \
    -d '{
      "project_id": "<your-project-id>",
      "description": "Test bug from curl",
      "url": "https://example.com/dashboard",
      "route": "/dashboard",
      "browser_info": { "name": "Chrome", "version": "120", "os": "macOS" },
      "element_info": { "tag": "button", "text": "Submit" }
    }'
  ```

  Expected: `{"issue": {...}}` with status 201.

  Refresh /projects/[id] in the browser — the issue should appear.

- [ ] **Step 3: Commit**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3"
  git add platform/
  git commit -m "feat: add POST /api/issues endpoint with screenshot upload"
  ```

---

## Task 7: Extension Auth Layer

**Files:**
- Create: `src/lib/supabase-client.js`
- Create: `src/popup/auth.js`
- Modify: `src/popup/popup.html`
- Modify: `src/popup/popup.js`

**✅ Validation checkpoint:** After this task the extension popup shows a login form, you can sign in, and it shows your workspace name + a project dropdown.

- [ ] **Step 1: Add Supabase JS to extension**

  Download the Supabase browser bundle:
  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3/src"
  mkdir -p lib
  curl -L "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js" -o lib/supabase.js
  ```

- [ ] **Step 2: Create Supabase client for extension**

  Create `src/lib/supabase-client.js`:
  ```javascript
  // Replace with your actual Supabase URL and anon key
  const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co'
  const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY'

  function getSupabaseClient() {
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: {
          getItem: (key) => new Promise(resolve =>
            chrome.storage.local.get([key], r => resolve(r[key] ?? null))
          ),
          setItem: (key, value) => new Promise(resolve =>
            chrome.storage.local.set({ [key]: value }, resolve)
          ),
          removeItem: (key) => new Promise(resolve =>
            chrome.storage.local.remove([key], resolve)
          ),
        },
      },
    })
  }
  ```

- [ ] **Step 3: Create auth module**

  Create `src/popup/auth.js`:
  ```javascript
  async function getSession() {
    const client = getSupabaseClient()
    const { data: { session } } = await client.auth.getSession()
    return session
  }

  async function signIn(email, password) {
    const client = getSupabaseClient()
    const { data, error } = await client.auth.signInWithPassword({ email, password })
    return { session: data?.session, error }
  }

  async function signOut() {
    const client = getSupabaseClient()
    await client.auth.signOut()
    await chrome.storage.local.remove(['qa_selected_project'])
  }

  async function getWorkspaceAndProjects(token) {
    const client = getSupabaseClient()
    const { data: workspace } = await client.from('workspaces').select('id, name').single()
    if (!workspace) return { workspace: null, projects: [] }
    const { data: projects } = await client
      .from('projects')
      .select('id, name')
      .eq('workspace_id', workspace.id)
      .order('name')
    return { workspace, projects: projects ?? [] }
  }
  ```

- [ ] **Step 4: Update popup.html to add login form and project selector**

  Replace the contents of `src/popup/popup.html` with:
  ```html
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QA Reporter</title>
    <link rel="stylesheet" href="popup.css">
  </head>
  <body>
    <!-- LOGIN VIEW -->
    <div id="login-view" style="display:none; padding:16px">
      <h2 style="margin:0 0 12px;font-size:15px;font-weight:600">Sign in to QA Reporter</h2>
      <div class="field">
        <label>Email</label>
        <input type="email" id="login-email" placeholder="you@example.com">
      </div>
      <div class="field">
        <label>Password</label>
        <input type="password" id="login-password" placeholder="••••••••">
      </div>
      <p id="login-error" style="color:#dc2626;font-size:12px;display:none"></p>
      <button id="login-btn" class="primary-btn">Sign in</button>
    </div>

    <!-- MAIN VIEW -->
    <div id="main-view" style="display:none">
      <div id="header-bar">
        <span id="workspace-name" style="font-size:12px;color:#6b7280"></span>
        <button id="logout-btn" style="font-size:11px;background:none;border:none;color:#9ca3af;cursor:pointer">Sign out</button>
      </div>

      <div id="project-selector" style="padding:8px 16px;border-bottom:1px solid #f3f4f6">
        <label style="font-size:11px;color:#6b7280;font-weight:500">Project</label>
        <select id="project-select" style="display:block;width:100%;margin-top:4px;border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;font-size:13px"></select>
      </div>

      <!-- existing popup content goes here, wrapped in this div -->
      <div id="reporter-content">
        <!-- The existing popup UI stays here -->
      </div>
    </div>

    <!-- LOADING VIEW -->
    <div id="loading-view" style="padding:24px;text-align:center;color:#9ca3af;font-size:13px">
      Loading...
    </div>

    <script src="../lib/supabase.js"></script>
    <script src="../lib/supabase-client.js"></script>
    <script src="auth.js"></script>
    <script src="api.js"></script>
    <script src="popup.js"></script>
  </body>
  </html>
  ```

- [ ] **Step 5: Update popup.js to handle auth flow**

  Add the following to the **top** of `src/popup/popup.js` (before existing code):
  ```javascript
  // Auth flow — runs on popup open
  async function initAuth() {
    const session = await getSession()

    if (!session) {
      showView('login')
      setupLoginForm()
      return
    }

    showView('main')
    await loadWorkspaceData(session)
  }

  function showView(view) {
    document.getElementById('login-view').style.display = view === 'login' ? 'block' : 'none'
    document.getElementById('main-view').style.display = view === 'main' ? 'block' : 'none'
    document.getElementById('loading-view').style.display = view === 'loading' ? 'block' : 'none'
  }

  function setupLoginForm() {
    document.getElementById('login-btn').addEventListener('click', async () => {
      const email = document.getElementById('login-email').value
      const password = document.getElementById('login-password').value
      const errEl = document.getElementById('login-error')
      errEl.style.display = 'none'

      const { session, error } = await signIn(email, password)
      if (error) {
        errEl.textContent = error.message
        errEl.style.display = 'block'
        return
      }

      showView('loading')
      await loadWorkspaceData(session)
      showView('main')
    })
  }

  async function loadWorkspaceData(session) {
    const { workspace, projects } = await getWorkspaceAndProjects(session.access_token)

    document.getElementById('workspace-name').textContent = workspace?.name ?? ''

    const select = document.getElementById('project-select')
    select.innerHTML = projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('')

    // Restore last selected project
    const stored = await chrome.storage.local.get(['qa_selected_project'])
    if (stored.qa_selected_project) select.value = stored.qa_selected_project

    select.addEventListener('change', () => {
      chrome.storage.local.set({ qa_selected_project: select.value })
    })
  }

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await signOut()
    showView('login')
    setupLoginForm()
  })

  // Init on load
  document.addEventListener('DOMContentLoaded', initAuth)
  ```

- [ ] **Step 6: Update manifest to include new scripts and permissions**

  Add to `src/manifest.json` under `"permissions"`:
  ```json
  "storage"
  ```

  Add to `web_accessible_resources` if present, or add:
  ```json
  "web_accessible_resources": [{
    "resources": ["lib/supabase.js"],
    "matches": ["<all_urls>"]
  }]
  ```

- [ ] **Step 7: Validate**

  - Open `chrome://extensions`, reload the QA Reporter extension
  - Click the extension icon — login form should appear
  - Sign in with your QA Reporter account
  - Workspace name + project dropdown should appear

- [ ] **Step 8: Commit**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3"
  git add src/
  git commit -m "feat: add auth layer to chrome extension"
  ```

---

## Task 8: Extension Issues Submission

**Files:**
- Create: `src/popup/api.js`
- Modify: `src/popup/popup.js` (replace JSON export with API call)
- Modify: `src/content/content.js` (send data to popup)

**✅ Validation checkpoint:** After this task you can report a bug from the extension, it appears in the dashboard.

- [ ] **Step 1: Create API module**

  Create `src/popup/api.js`:
  ```javascript
  const PLATFORM_URL = 'http://localhost:3000' // Change to production URL when deployed

  async function submitIssue({ projectId, description, url, route, browserInfo, elementInfo, screenshot, elementScreenshot }) {
    const session = await getSession()
    if (!session) throw new Error('Not authenticated')

    const res = await fetch(`${PLATFORM_URL}/api/issues`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        project_id: projectId,
        description,
        url,
        route,
        browser_info: browserInfo,
        element_info: elementInfo,
        screenshot,
        element_screenshot: elementScreenshot,
      }),
    })

    if (!res.ok) {
      const body = await res.json()
      throw new Error(body.error ?? 'Failed to submit issue')
    }

    return res.json()
  }
  ```

- [ ] **Step 2: Replace JSON export in popup.js with API call**

  Find the section in `src/popup/popup.js` where the issue is exported/downloaded as JSON. Replace that block with:
  ```javascript
  // Get selected project
  const stored = await chrome.storage.local.get(['qa_selected_project'])
  const projectId = stored.qa_selected_project
  if (!projectId) {
    showError('Please select a project first')
    return
  }

  // Get current tab URL
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const pageUrl = tab?.url ?? ''
  const route = pageUrl ? new URL(pageUrl).pathname : ''

  // Collect browser info
  const browserInfo = {
    name: navigator.userAgent.includes('Chrome') ? 'Chrome' : 'Other',
    userAgent: navigator.userAgent,
  }

  try {
    await submitIssue({
      projectId,
      description: descriptionValue, // use whatever variable holds the description
      url: pageUrl,
      route,
      browserInfo,
      elementInfo: selectedElementData, // use whatever variable holds element data
      screenshot: screenshotBase64,     // use whatever variable holds screenshot
      elementScreenshot: elementScreenshotBase64,
    })
    showSuccess('Issue reported successfully!')
  } catch (err) {
    showError(err.message)
  }
  ```

  > Note: Match the variable names (`descriptionValue`, `selectedElementData`, `screenshotBase64`, etc.) to whatever names the existing popup.js uses for those values. Read the existing popup.js first to find the correct variable names before editing.

- [ ] **Step 3: Validate**

  - Reload the extension in chrome://extensions
  - Navigate to any webpage
  - Open the extension, select an element, fill in a description, submit
  - Open the dashboard /projects/[id] — the issue should appear with a screenshot

- [ ] **Step 4: Commit**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3"
  git add src/
  git commit -m "feat: wire extension to submit issues to platform API"
  ```

---

## Task 9: Azure DevOps Integration Setup

**Files:**
- Create: `platform/lib/encryption.ts`
- Create: `platform/lib/azure/adapter.ts`
- Create: `platform/app/api/integrations/azure/test/route.ts`
- Create: `platform/app/(dashboard)/settings/integrations/page.tsx`
- Create: `platform/components/AzureSetupForm.tsx`

**✅ Validation checkpoint:** After this task you can paste your Azure PAT in Settings → Integrations, click "Test Connection", and see a success message.

- [ ] **Step 1: Create encryption utility**

  Create `platform/lib/encryption.ts`:
  ```typescript
  import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

  const ALGORITHM = 'aes-256-gcm'
  const SECRET = process.env.ENCRYPTION_SECRET!

  // Secret must be exactly 32 bytes
  function getKey() {
    return Buffer.from(SECRET.padEnd(32, '0').slice(0, 32))
  }

  export function encrypt(text: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv(ALGORITHM, getKey(), iv)
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':')
  }

  export function decrypt(data: string): string {
    const [ivHex, tagHex, encryptedHex] = data.split(':')
    const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    return decipher.update(Buffer.from(encryptedHex, 'hex')) + decipher.final('utf8')
  }
  ```

- [ ] **Step 2: Create Azure DevOps adapter**

  Create `platform/lib/azure/adapter.ts`:
  ```typescript
  export interface AzureConfig {
    orgUrl: string      // e.g. https://dev.azure.com/myorg
    projectName: string // e.g. MyProject
    pat: string         // plaintext PAT (decrypted before passing in)
  }

  function authHeader(pat: string) {
    const encoded = Buffer.from(`:${pat}`).toString('base64')
    return { Authorization: `Basic ${encoded}` }
  }

  export async function testConnection(config: AzureConfig): Promise<{ ok: boolean; error?: string }> {
    try {
      const url = `${config.orgUrl}/_apis/projects?api-version=7.0`
      const res = await fetch(url, { headers: authHeader(config.pat) })
      if (!res.ok) return { ok: false, error: `Azure returned ${res.status}` }
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  }

  export async function createBug(config: AzureConfig, bug: {
    title: string
    description: string
    reproSteps: string
  }): Promise<{ id: number; url: string }> {
    const apiUrl = `${config.orgUrl}/${config.projectName}/_apis/wit/workitems/$Bug?api-version=7.0`

    const body = [
      { op: 'add', path: '/fields/System.Title', value: bug.title },
      { op: 'add', path: '/fields/System.Description', value: bug.description },
      { op: 'add', path: '/fields/Microsoft.VSTS.TCM.ReproSteps', value: bug.reproSteps },
    ]

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        ...authHeader(config.pat),
        'Content-Type': 'application/json-patch+json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Azure API error ${res.status}: ${text}`)
    }

    const data = await res.json()
    return {
      id: data.id,
      url: data._links?.html?.href ?? `${config.orgUrl}/${config.projectName}/_workitems/edit/${data.id}`,
    }
  }
  ```

- [ ] **Step 3: Create test connection API route**

  Create `platform/app/api/integrations/azure/test/route.ts`:
  ```typescript
  import { NextRequest, NextResponse } from 'next/server'
  import { createServerClient } from '@supabase/ssr'
  import { testConnection } from '@/lib/azure/adapter'
  import { encrypt } from '@/lib/encryption'

  export async function POST(req: NextRequest) {
    const authHeader = req.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { createClient } = await import('@supabase/supabase-js')
    const userClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    )

    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { orgUrl, projectName, pat } = await req.json()

    if (!orgUrl || !projectName || !pat) {
      return NextResponse.json({ error: 'orgUrl, projectName and pat are required' }, { status: 400 })
    }

    const result = await testConnection({ orgUrl, projectName, pat })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    // Save integration with encrypted PAT
    const { data: workspace } = await userClient.from('workspaces').select('id').single()
    if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    await userClient.from('integrations').upsert({
      workspace_id: workspace.id,
      provider: 'azure_devops',
      pat_encrypted: encrypt(pat),
      config: { org_url: orgUrl, project_name: projectName },
    }, { onConflict: 'workspace_id,provider' })

    return NextResponse.json({ ok: true })
  }
  ```

- [ ] **Step 4: Create AzureSetupForm component**

  Create `platform/components/AzureSetupForm.tsx`:
  ```tsx
  'use client'
  import { useState } from 'react'
  import { createClient } from '@/lib/supabase/client'

  export function AzureSetupForm({ existing }: { existing?: { org_url: string; project_name: string } }) {
    const supabase = createClient()
    const [orgUrl, setOrgUrl] = useState(existing?.org_url ?? '')
    const [projectName, setProjectName] = useState(existing?.project_name ?? '')
    const [pat, setPat] = useState('')
    const [status, setStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
    const [error, setError] = useState('')

    async function handleTest() {
      setStatus('testing')
      setError('')
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/integrations/azure/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ orgUrl, projectName, pat }),
      })
      const body = await res.json()
      if (!res.ok) {
        setStatus('error')
        setError(body.error ?? 'Connection failed')
      } else {
        setStatus('success')
      }
    }

    return (
      <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-lg">
        <h2 className="font-semibold text-gray-900 mb-4">Azure DevOps</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Organization URL</label>
            <input
              type="url"
              value={orgUrl}
              onChange={e => setOrgUrl(e.target.value)}
              placeholder="https://dev.azure.com/yourorg"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Project name</label>
            <input
              type="text"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              placeholder="MyProject"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Personal Access Token</label>
            <input
              type="password"
              value={pat}
              onChange={e => setPat(e.target.value)}
              placeholder="Paste your PAT here"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              Generate at Azure DevOps → User Settings → Personal Access Tokens. Needs Work Items (Read & Write) scope.
            </p>
          </div>
          <button
            onClick={handleTest}
            disabled={!orgUrl || !projectName || !pat || status === 'testing'}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {status === 'testing' ? 'Testing...' : 'Test Connection & Save'}
          </button>
          {status === 'success' && (
            <p className="text-green-600 text-sm">✓ Connected and saved successfully</p>
          )}
          {status === 'error' && (
            <p className="text-red-600 text-sm">{error}</p>
          )}
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 5: Create integrations settings page**

  Create `platform/app/(dashboard)/settings/integrations/page.tsx`:
  ```tsx
  import { createClient } from '@/lib/supabase/server'
  import { AzureSetupForm } from '@/components/AzureSetupForm'

  export default async function IntegrationsPage() {
    const supabase = createClient()
    const { data: workspace } = await supabase.from('workspaces').select('id').single()

    const { data: integration } = workspace
      ? await supabase
          .from('integrations')
          .select('config')
          .eq('workspace_id', workspace.id)
          .eq('provider', 'azure_devops')
          .single()
      : { data: null }

    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Integrations</h1>
        <AzureSetupForm existing={integration?.config as any} />
      </div>
    )
  }
  ```

- [ ] **Step 6: Validate**

  - Go to /settings/integrations in the dashboard
  - Paste your Azure DevOps org URL, project name, and a PAT with Work Items Read+Write scope
  - Click "Test Connection & Save" — should show "✓ Connected and saved successfully"
  - Verify in Supabase MCP `execute_sql`: `select provider, config from integrations;` — should show a row

- [ ] **Step 7: Commit**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3"
  git add platform/
  git commit -m "feat: add Azure DevOps integration setup with PAT and test connection"
  ```

---

## Task 10: Azure DevOps Sync

**Files:**
- Create: `platform/app/api/integrations/azure/sync/[issueId]/route.ts`

**✅ Validation checkpoint:** After this task you can click "Sync to Azure" on any issue and it creates a Bug in Azure DevOps. The issue detail page shows a link to the ADO ticket.

- [ ] **Step 1: Create sync API route**

  Create `platform/app/api/integrations/azure/sync/[issueId]/route.ts`:
  ```typescript
  import { NextRequest, NextResponse } from 'next/server'
  import { createClient } from '@supabase/supabase-js'
  import { createBug } from '@/lib/azure/adapter'
  import { decrypt } from '@/lib/encryption'

  export async function POST(
    req: NextRequest,
    { params }: { params: { issueId: string } }
  ) {
    const token = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const userClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    )

    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Fetch the issue
    const { data: issue, error: issueError } = await userClient
      .from('issues')
      .select('*, projects(workspace_id)')
      .eq('id', params.issueId)
      .single()

    if (issueError || !issue) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 })
    }

    const workspaceId = (issue.projects as any)?.workspace_id
    if (!workspaceId) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Fetch integration (use service role to read encrypted PAT)
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: integration } = await adminClient
      .from('integrations')
      .select('pat_encrypted, config')
      .eq('workspace_id', workspaceId)
      .eq('provider', 'azure_devops')
      .single()

    if (!integration) {
      return NextResponse.json({ error: 'No Azure DevOps integration configured. Go to Settings → Integrations.' }, { status: 400 })
    }

    const pat = decrypt(integration.pat_encrypted)
    const config = integration.config as { org_url: string; project_name: string }

    // Build bug content
    const reproSteps = [
      `<b>URL:</b> ${issue.url ?? '—'}`,
      `<b>Route:</b> ${issue.route ?? '—'}`,
      `<b>Browser:</b> ${JSON.stringify(issue.browser_info ?? {})}`,
      `<b>Element:</b> ${JSON.stringify(issue.element_info ?? {})}`,
      issue.screenshot_url ? `<b>Screenshot:</b> <a href="${issue.screenshot_url}">View screenshot</a>` : '',
    ].filter(Boolean).join('<br/>')

    try {
      const result = await createBug(
        { orgUrl: config.org_url, projectName: config.project_name, pat },
        {
          title: issue.description.slice(0, 120),
          description: issue.description,
          reproSteps,
        }
      )

      // Update issue with sync result
      await userClient.from('issues').update({
        sync_status: 'synced',
        external_ticket_id: String(result.id),
        external_ticket_url: result.url,
      }).eq('id', params.issueId)

      // Log success
      await adminClient.from('issue_sync_logs').insert({
        issue_id: params.issueId,
        provider: 'azure_devops',
        status: 'success',
      })

      return NextResponse.json({ ok: true, ticketUrl: result.url })
    } catch (err: any) {
      // Log failure
      await adminClient.from('issue_sync_logs').insert({
        issue_id: params.issueId,
        provider: 'azure_devops',
        status: 'failed',
        error: err.message,
      })

      // Update issue sync status
      await userClient.from('issues').update({ sync_status: 'failed' }).eq('id', params.issueId)

      return NextResponse.json({ error: err.message }, { status: 500 })
    }
  }
  ```

- [ ] **Step 2: Update SyncButton to pass JWT**

  Update `platform/components/SyncButton.tsx` — replace the `handleSync` function:
  ```typescript
  async function handleSync() {
    setLoading(true)
    setError('')
    const supabase = (await import('@/lib/supabase/client')).createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/integrations/azure/sync/${issueId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session?.access_token}`,
      },
    })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error ?? 'Sync failed')
    } else {
      qc.invalidateQueries({ queryKey: ['issue', issueId] })
      qc.invalidateQueries({ queryKey: ['issues', projectId] })
    }
    setLoading(false)
  }
  ```

- [ ] **Step 3: Validate end-to-end**

  - Report a bug from the extension — confirm it appears in the dashboard
  - Click the issue → go to issue detail
  - Click "Sync to Azure"
  - Confirm the button changes to "✓ Synced to Azure" with a link
  - Open the link — confirm the Bug exists in Azure DevOps with the correct title, description, and repro steps
  - Check the issue list — the status badge should show "synced" (green)

- [ ] **Step 4: Commit**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3"
  git add platform/ src/
  git commit -m "feat: complete Azure DevOps sync — full end-to-end flow"
  ```

---

## Task 11: Auto-Sync Edge Function (Optional — for projects with sync_mode = 'auto')

**Files:**
- Create: `platform/supabase/functions/auto-sync/index.ts`

**✅ Validation checkpoint:** After this task, issues submitted to a project with `sync_mode = 'auto'` are automatically pushed to Azure without any manual button click.

- [ ] **Step 1: Create the Edge Function**

  Create `platform/supabase/functions/auto-sync/index.ts`:
  ```typescript
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const ENCRYPTION_SECRET = Deno.env.get('ENCRYPTION_SECRET')!

  function getKey() {
    const enc = new TextEncoder()
    return enc.encode(ENCRYPTION_SECRET.padEnd(32, '0').slice(0, 32))
  }

  async function decrypt(data: string): Promise<string> {
    const [ivHex, tagHex, encHex] = data.split(':')
    const iv = hexToBytes(ivHex)
    const tag = hexToBytes(tagHex)
    const encrypted = hexToBytes(encHex)
    const key = await crypto.subtle.importKey('raw', getKey(), { name: 'AES-GCM' }, false, ['decrypt'])
    const combined = new Uint8Array([...encrypted, ...tag])
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined)
    return new TextDecoder().decode(decrypted)
  }

  function hexToBytes(hex: string) {
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
    return bytes
  }

  Deno.serve(async (req) => {
    const payload = await req.json()
    // Supabase DB webhook sends { type, table, record, old_record }
    const issue = payload.record

    if (!issue || payload.type !== 'INSERT') {
      return new Response('ok', { status: 200 })
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // Check project sync_mode
    const { data: project } = await admin
      .from('projects')
      .select('sync_mode, workspace_id')
      .eq('id', issue.project_id)
      .single()

    if (project?.sync_mode !== 'auto') return new Response('ok', { status: 200 })

    // Get integration
    const { data: integration } = await admin
      .from('integrations')
      .select('pat_encrypted, config')
      .eq('workspace_id', project.workspace_id)
      .eq('provider', 'azure_devops')
      .single()

    if (!integration) return new Response('no integration', { status: 200 })

    const pat = await decrypt(integration.pat_encrypted)
    const config = integration.config as { org_url: string; project_name: string }

    const reproSteps = [
      `<b>URL:</b> ${issue.url ?? '—'}`,
      `<b>Route:</b> ${issue.route ?? '—'}`,
      `<b>Browser:</b> ${JSON.stringify(issue.browser_info ?? {})}`,
      `<b>Element:</b> ${JSON.stringify(issue.element_info ?? {})}`,
      issue.screenshot_url ? `<b>Screenshot:</b> <a href="${issue.screenshot_url}">View</a>` : '',
    ].filter(Boolean).join('<br/>')

    const apiUrl = `${config.org_url}/${config.project_name}/_apis/wit/workitems/$Bug?api-version=7.0`
    const encoded = btoa(`:${pat}`)

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${encoded}`,
          'Content-Type': 'application/json-patch+json',
        },
        body: JSON.stringify([
          { op: 'add', path: '/fields/System.Title', value: issue.description.slice(0, 120) },
          { op: 'add', path: '/fields/System.Description', value: issue.description },
          { op: 'add', path: '/fields/Microsoft.VSTS.TCM.ReproSteps', value: reproSteps },
        ]),
      })

      const data = await res.json()
      const ticketUrl = data._links?.html?.href ?? `${config.org_url}/${config.project_name}/_workitems/edit/${data.id}`

      await admin.from('issues').update({
        sync_status: 'synced',
        external_ticket_id: String(data.id),
        external_ticket_url: ticketUrl,
      }).eq('id', issue.id)

      await admin.from('issue_sync_logs').insert({
        issue_id: issue.id,
        provider: 'azure_devops',
        status: 'success',
      })
    } catch (err: any) {
      await admin.from('issues').update({ sync_status: 'failed' }).eq('id', issue.id)
      await admin.from('issue_sync_logs').insert({
        issue_id: issue.id,
        provider: 'azure_devops',
        status: 'failed',
        error: err.message,
      })
    }

    return new Response('ok', { status: 200 })
  })
  ```

- [ ] **Step 2: Deploy the Edge Function**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3/platform"
  npx supabase functions deploy auto-sync --project-ref <your-project-ref>
  ```

  Set the required secrets:
  ```bash
  npx supabase secrets set ENCRYPTION_SECRET=<your-32-char-secret> --project-ref <your-project-ref>
  ```

- [ ] **Step 3: Create a Database Webhook in Supabase**

  In the Supabase dashboard → Database → Webhooks → Create a new webhook:
  - Name: `auto-sync-on-insert`
  - Table: `issues`
  - Events: `INSERT`
  - Webhook URL: `https://<your-project-ref>.supabase.co/functions/v1/auto-sync`
  - HTTP Headers: `Authorization: Bearer <your-service-role-key>`

- [ ] **Step 4: Validate**

  - Change a project's `sync_mode` to `'auto'` via Supabase MCP `execute_sql`:
    ```sql
    update projects set sync_mode = 'auto' where name = 'Your Project Name';
    ```
  - Submit a bug from the extension
  - Within a few seconds, check the issue in the dashboard — it should show "synced" with an ADO link, with no button click needed

- [ ] **Step 5: Commit**

  ```bash
  cd "/Users/rahulsarawagi/Desktop/project 3"
  git add platform/supabase/
  git commit -m "feat: add auto-sync edge function for projects with sync_mode=auto"
  ```

---

## End-to-End Validation Checklist

Run through this after Task 10 is complete:

- [ ] Sign up with a new account — workspace is created
- [ ] Create a project in the dashboard
- [ ] Open extension, sign in, select the project
- [ ] Navigate to any web page, select an element, add description, submit
- [ ] Issue appears in dashboard with screenshot
- [ ] Go to Settings → Integrations, configure Azure PAT, test connection succeeds
- [ ] Open the issue, click "Sync to Azure" — bug created in ADO
- [ ] ADO bug has correct title, repro steps with URL and browser info
- [ ] Issue badge in list shows "synced" with link to ADO
