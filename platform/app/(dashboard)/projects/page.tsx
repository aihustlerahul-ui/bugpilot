'use client';

import { useState, useEffect, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api/client';
import type { Project } from '@/lib/types';
import { PlusIcon, SettingsIcon, FolderIcon } from '@/components/Icons';

function ProjectsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const showAll = searchParams.get('all') === 'true';


  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [mutationError, setMutationError] = useState('');

  const { data: projects = [], isLoading, isError } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => api.get<Project[]>('/projects'),
  });

  // Auto-redirect to first or last active project if not explicitly viewing ?all=true
  useEffect(() => {
    if (!isLoading && !showAll && projects.length > 0) {
      const savedId = typeof window !== 'undefined' ? localStorage.getItem('last_active_project_id') : null;
      const targetProject = projects.find((p) => p.id === savedId) || projects[0];
      router.replace(`/projects/${targetProject.id}`);
    }
  }, [isLoading, showAll, projects, router]);

  const createProject = useMutation({
    mutationFn: (name: string) => api.post<Project>('/projects', { name, sync_mode: 'manual' }),
    onSuccess: (newProj) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      setName('');
      setCreating(false);
      if (typeof window !== 'undefined') {
        localStorage.setItem('last_active_project_id', newProj.id);
      }
      router.push(`/projects/${newProj.id}`);
    },
    onError: (err: Error) => setMutationError(err.message),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-gray-400 text-sm">Loading projects…</p>
      </div>
    );
  }

  // If redirecting, show lightweight placeholder while router redirects
  if (!showAll && projects.length > 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-gray-400 text-sm">Opening project…</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Projects</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage your QA projects, default views, and issue capture pipelines.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-xs"
        >
          <PlusIcon className="w-4 h-4" />
          <span>New Project</span>
        </button>
      </div>

      {creating && (
        <div className="bg-white border border-indigo-100 rounded-xl p-4 shadow-sm space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">Create New Project</h3>
          <div className="flex gap-3">
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Mobile iOS App, Marketing Portal"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              onKeyDown={(e) => e.key === 'Enter' && name.trim() && createProject.mutate(name.trim())}
            />
            <button
              onClick={() => name.trim() && createProject.mutate(name.trim())}
              disabled={!name.trim() || createProject.isPending}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {createProject.isPending ? 'Creating…' : 'Create Project'}
            </button>
            <button
              onClick={() => {
                setCreating(false);
                setMutationError('');
              }}
              className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
          {mutationError && <p className="text-red-600 text-xs">{mutationError}</p>}
        </div>
      )}

      {isError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          Failed to load projects. Please refresh.
        </div>
      )}

      {projects.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-gray-200 rounded-2xl bg-white space-y-3">
          <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
            <FolderIcon className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-gray-900">No projects yet</h3>
          <p className="text-sm text-gray-500 max-w-sm mx-auto">
            Create your first project to start reporting bugs directly from your browser extension.
          </p>
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 shadow-xs"
          >
            <PlusIcon className="w-4 h-4" />
            <span>Create First Project</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <div
              key={p.id}
              className="group bg-white border border-gray-200 rounded-xl p-5 hover:border-indigo-400 hover:shadow-md transition-all relative flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/projects/${p.id}`}
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        localStorage.setItem('last_active_project_id', p.id);
                      }
                    }}
                    className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors text-base"
                  >
                    {p.name}
                  </Link>

                  <Link
                    href={`/projects/${p.id}?tab=settings`}
                    className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Project Settings"
                  >
                    <SettingsIcon className="w-4 h-4" />
                  </Link>
                </div>

                {p.settings?.description && (
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{p.settings.description}</p>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
                <span className="capitalize">Sync: {p.sync_mode}</span>
                {p.settings?.default_view && (
                  <span className="capitalize bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-[11px]">
                    {p.settings.default_view}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><p className="text-gray-400 text-sm">Loading projects…</p></div>}>
      <ProjectsContent />
    </Suspense>
  );
}

