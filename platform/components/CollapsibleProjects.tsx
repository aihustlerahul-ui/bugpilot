'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Project } from '@/lib/types';
import { useWorkspaceAccess } from '@/components/useWorkspaceAccess';
import { FolderIcon, ChevronRightIcon, PlusIcon } from '@/components/Icons';

export function CollapsibleProjects() {
  const pathname = usePathname();
  const isProjectsRoute = pathname.startsWith('/projects');
  const [isOpen, setIsOpen] = useState(true);

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => api.get<Project[]>('/projects'),
  });

  const { isMemberOnly } = useWorkspaceAccess();

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between group px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100 transition-colors">
        <Link
          href="/projects"
          className="flex items-center gap-2.5 flex-1 font-medium text-gray-700 group-hover:text-gray-900"
        >
          <FolderIcon className={`w-4 h-4 ${isProjectsRoute ? 'text-blue-600' : 'text-gray-400'}`} />
          <span>Projects</span>
          <span className="ml-auto text-xs text-gray-400 font-normal mr-1 tabular-nums">
            {isLoading ? '…' : projects.length}
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200/60 transition-colors"
          title={isOpen ? 'Collapse projects' : 'Expand projects'}
        >
          <ChevronRightIcon
            className={`w-3.5 h-3.5 transition-transform duration-200 ${
              isOpen ? 'rotate-90' : ''
            }`}
          />
        </button>
      </div>

      {isOpen && (
        <div className="pl-6 space-y-0.5 animate-in fade-in-50 duration-150 border-l border-gray-200/70 ml-5 my-1">
          {isLoading ? (
            <div className="px-3 py-1.5 text-xs text-gray-400">Loading projects…</div>
          ) : projects.length === 0 ? (
            <div className="px-3 py-1.5 text-xs text-gray-400 italic">No projects yet</div>
          ) : (
            projects.map((proj) => {
              const isActive = pathname.startsWith(`/projects/${proj.id}`);
              return (
                <Link
                  key={proj.id}
                  href={`/projects/${proj.id}`}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-blue-700 font-semibold'
                      : 'text-gray-600 hover:bg-gray-100/80 hover:text-gray-900'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      isActive ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                  />
                  <span className="truncate">{proj.name}</span>
                </Link>
              );
            })
          )}

          {!isMemberOnly && (
            <Link
              href="/projects"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors mt-1"
            >
              <PlusIcon className="w-3 h-3" />
              <span>New Project</span>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
