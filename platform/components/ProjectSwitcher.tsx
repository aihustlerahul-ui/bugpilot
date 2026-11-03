'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Project } from '@/lib/types';
import {
  FolderIcon,
  ChevronDownIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  LayersIcon,
} from '@/components/Icons';


export function ProjectSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [createError, setCreateError] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Extract project ID from URL if on /projects/[id]
  const projectRouteMatch = pathname.match(/^\/projects\/([a-zA-Z0-9_-]+)/);
  const currentUrlProjectId = projectRouteMatch ? projectRouteMatch[1] : null;

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => api.get<Project[]>('/projects'),
  });

  // Keep track of active project
  const activeProject =
    projects.find((p) => p.id === currentUrlProjectId) ||
    (typeof window !== 'undefined'
      ? projects.find((p) => p.id === localStorage.getItem('last_active_project_id'))
      : null) ||
    projects[0];

  useEffect(() => {
    if (activeProject && typeof window !== 'undefined') {
      localStorage.setItem('last_active_project_id', activeProject.id);
    }
  }, [activeProject]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsCreating(false);
        setSearch('');
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const createProjectMutation = useMutation({
    mutationFn: (name: string) => api.post<Project>('/projects', { name, sync_mode: 'manual' }),
    onSuccess: (newProj) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setNewProjectName('');
      setIsCreating(false);
      setIsOpen(false);
      if (typeof window !== 'undefined') {
        localStorage.setItem('last_active_project_id', newProj.id);
      }
      router.push(`/projects/${newProj.id}`);
    },
    onError: (err: Error) => setCreateError(err.message),
  });

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-gray-200/80 bg-white hover:bg-gray-50 text-left transition-all group max-w-[240px] shadow-2xs"
        title="Switch Project"
      >
        <FolderIcon className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
        <span className="text-xs font-semibold text-gray-800 truncate">
          {isLoading ? 'Loading…' : activeProject?.name || 'Select Project'}
        </span>
        <ChevronDownIcon
          className={`w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600 transition-transform duration-150 shrink-0 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1.5 w-72 rounded-xl bg-white border border-gray-200 shadow-xl ring-1 ring-black/5 z-50 py-1 divide-y divide-gray-100 animate-in fade-in-50 duration-100">
          {/* Header & Search */}
          <div className="p-2 space-y-1.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Projects
              </span>
              <span className="text-[10px] text-gray-400 font-mono">
                {projects.length} total
              </span>
            </div>

            {projects.length > 2 && (
              <div className="relative">
                <SearchIcon className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Filter projects…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                />
              </div>
            )}
          </div>

          {/* Project List */}
          <div className="max-h-56 overflow-y-auto p-1 space-y-0.5">
            {isLoading ? (
              <div className="px-3 py-2 text-xs text-gray-400">Loading projects…</div>
            ) : filteredProjects.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400 italic">No matching projects</div>
            ) : (
              filteredProjects.map((p) => {
                const isSelected = activeProject?.id === p.id;
                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between group rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                      isSelected
                        ? 'bg-indigo-50/80 text-indigo-900 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <Link
                      href={`/projects/${p.id}`}
                      onClick={() => {
                        if (typeof window !== 'undefined') {
                          localStorage.setItem('last_active_project_id', p.id);
                        }
                        setIsOpen(false);
                      }}
                      className="flex items-center gap-2 flex-1 min-w-0"
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          isSelected ? 'bg-indigo-600' : 'bg-gray-300'
                        }`}
                      />
                      <span className="truncate">{p.name}</span>
                    </Link>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Link
                        href={`/projects/${p.id}?tab=settings`}
                        onClick={() => setIsOpen(false)}
                        className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-200/50 rounded"
                        title="Project Settings"
                      >
                        <SettingsIcon className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Inline Project Creation */}
          {isCreating ? (
            <div className="p-2 space-y-2 bg-gray-50/50">
              <input
                autoFocus
                type="text"
                placeholder="New project name…"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newProjectName.trim()) {
                    createProjectMutation.mutate(newProjectName.trim());
                  } else if (e.key === 'Escape') {
                    setIsCreating(false);
                  }
                }}
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              {createError && <p className="text-[11px] text-red-600">{createError}</p>}
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-2 py-1 text-xs text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (newProjectName.trim()) {
                      createProjectMutation.mutate(newProjectName.trim());
                    }
                  }}
                  disabled={!newProjectName.trim() || createProjectMutation.isPending}
                  className="px-2.5 py-1 text-xs bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-md shadow-2xs"
                >
                  {createProjectMutation.isPending ? 'Creating…' : 'Create'}
                </button>
              </div>
            </div>
          ) : (
            <div className="p-1 space-y-0.5">
              <button
                type="button"
                onClick={() => setIsCreating(true)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-indigo-600 hover:bg-indigo-50 font-medium rounded-lg transition-colors"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                <span>New Project</span>
              </button>
              <Link
                href="/projects?all=true"
                onClick={() => setIsOpen(false)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
              >
                <LayersIcon className="w-3.5 h-3.5 text-gray-400" />
                <span>View All Projects</span>
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
