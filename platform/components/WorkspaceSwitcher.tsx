'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useWorkspaceAccess } from '@/components/useWorkspaceAccess';
import { ChevronDownIcon, CheckIcon, SparklesIcon } from '@/components/Icons';

export function WorkspaceSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { workspace, isLoading, isMemberOnly } = useWorkspaceAccess();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const workspaceName = isMemberOnly ? 'Shared workspace' : workspace?.name || 'Workspace';
  const initial = workspaceName.charAt(0).toUpperCase();

  return (
    <div className="relative" ref={containerRef} id="tour-workspace-switcher">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-2 rounded-xl border border-gray-200/80 bg-gray-50/50 hover:bg-gray-100/80 hover:border-gray-300 transition-all text-left group"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-xs shrink-0">
            {isLoading ? '…' : initial}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-gray-900 truncate leading-tight">
              {isLoading ? 'Loading…' : workspaceName}
            </div>
            <div className="text-[10px] text-gray-500 flex items-center gap-1 leading-tight mt-0.5">
              {isMemberOnly ? (
                <span>Shared with you</span>
              ) : (
                <>
                  <span>Pro Plan</span>
                  <span className="text-gray-300">•</span>
                  <span className="text-emerald-600 font-medium">Active</span>
                </>
              )}
            </div>
          </div>
        </div>
        <ChevronDownIcon className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600 transition-transform duration-150 shrink-0" />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1.5 w-full min-w-[200px] rounded-xl bg-white border border-gray-200 shadow-lg ring-1 ring-black/5 z-50 py-1 divide-y divide-gray-100 animate-in fade-in-50 duration-100">
          <div className="px-3 py-2">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              Current Workspace
            </p>
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs font-medium text-gray-900 truncate">{workspaceName}</span>
              <CheckIcon className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            </div>
          </div>

          {!isMemberOnly && (
          <div className="p-1">
            <Link
              href="/settings/integrations"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <SparklesIcon className="w-3.5 h-3.5 text-gray-400" />
              <span>Workspace Settings</span>
            </Link>
            <Link
              href="/connectors"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <span className="text-gray-400 text-xs">⚡</span>
              <span>Manage Connectors</span>
            </Link>
          </div>
          )}
        </div>
      )}
    </div>
  );
}
