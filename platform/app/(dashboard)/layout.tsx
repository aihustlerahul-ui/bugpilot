'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { CollapsibleProjects } from '@/components/CollapsibleProjects';
import { ProjectSwitcher } from '@/components/ProjectSwitcher';
import {
  LayoutDashboardIcon,
  UsersIcon,
  Link2Icon,
  PuzzleIcon,
  SparklesIcon,
  SmartphoneIcon,
  LogOutIcon,
} from '@/components/Icons';
import { useWorkspaceAccess } from '@/components/useWorkspaceAccess';
import { ProductTourButton } from '@/components/ProductTourButton';
import { UserMenu } from '@/components/UserMenu';
import '../driver.css';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();
  // Invited testers have no workspace of their own: hide owner-only navigation.
  const { isMemberOnly } = useWorkspaceAccess();

  async function handleSignOut() {
    await supabase.auth.signOut();
    try {
      sessionStorage.removeItem('qa_token');
    } catch {
      /* storage can be unavailable */
    }
    router.push('/login');
  }

  const isDashboardActive = pathname === '/dashboard' || pathname === '/';
  const isTeamActive = pathname.startsWith('/team');
  const isConnectorsActive = pathname.startsWith('/connectors');
  const isExtensionActive = pathname.startsWith('/extension');
  const isAiToolsActive = pathname.startsWith('/ai-tools');
  const isMobileActive = pathname.startsWith('/mobile');

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col p-4 sticky top-0 h-screen z-30 shrink-0">
        {/* Workspace Switcher Header */}
        <div className="mb-4">
          <WorkspaceSwitcher />
        </div>

        {/* Navigation Sections */}
        <nav className="flex-1 space-y-1 overflow-y-auto pr-1">
          {/* Dashboard / Overview */}
          <Link
            href="/dashboard"
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              isDashboardActive
                ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 font-medium'
            }`}
          >
            <LayoutDashboardIcon
              className={`w-4 h-4 ${isDashboardActive ? 'text-blue-600' : 'text-gray-400'}`}
            />
            <span>Dashboard</span>
          </Link>

          {/* Collapsible Projects Tree */}
          <CollapsibleProjects />

          {/* AI tools (visible to members too: developers connect their IDE here) */}
          <Link
            href="/ai-tools"
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              isAiToolsActive
                ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 font-medium'
            }`}
          >
            <SparklesIcon
              className={`w-4 h-4 ${isAiToolsActive ? 'text-blue-600' : 'text-gray-400'}`}
            />
            <span>AI Tools</span>
          </Link>

          {!isMemberOnly && (
            <>
          {/* Team */}
          <Link
            href="/team"
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              isTeamActive
                ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 font-medium'
            }`}
          >
            <UsersIcon className={`w-4 h-4 ${isTeamActive ? 'text-blue-600' : 'text-gray-400'}`} />
            <span>Team</span>
          </Link>

          {/* Connectors / Integrations */}
          <Link
            href="/connectors"
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              isConnectorsActive
                ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 font-medium'
            }`}
          >
            <Link2Icon
              className={`w-4 h-4 ${isConnectorsActive ? 'text-blue-600' : 'text-gray-400'}`}
            />
            <span>Connectors</span>
          </Link>

          {/* Extension Settings & Download */}
          <Link
            href="/extension"
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              isExtensionActive
                ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 font-medium'
            }`}
          >
            <PuzzleIcon
              className={`w-4 h-4 ${isExtensionActive ? 'text-blue-600' : 'text-gray-400'}`}
            />
            <span>Extension</span>
          </Link>

          {/* Mobile bug reporter guide */}
          <Link
            href="/mobile"
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              isMobileActive
                ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 font-medium'
            }`}
          >
            <SmartphoneIcon
              className={`w-4 h-4 ${isMobileActive ? 'text-blue-600' : 'text-gray-400'}`}
            />
            <span>Mobile</span>
          </Link>
            </>
          )}
        </nav>

        {/* Footer / User Sign Out */}
        <div className="pt-3 border-t border-gray-100 mt-auto">
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <LogOutIcon className="w-4 h-4 text-gray-400" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Top Header Bar */}
        <header className="h-14 bg-white border-b border-gray-200 px-8 flex items-center justify-between shrink-0 sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">BugPilot</span>
            <span className="text-gray-300">/</span>
            <ProjectSwitcher />
          </div>
          <div className="flex items-center gap-3">
            <ProductTourButton />
            <UserMenu />
          </div>
        </header>

        <main className="flex-1 p-8 min-w-0">{children}</main>
      </div>
    </div>
  );
}

