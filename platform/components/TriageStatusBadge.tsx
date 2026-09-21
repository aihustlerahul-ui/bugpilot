'use client';

import React, { useState, useRef, useEffect } from 'react';
import type { IssueTriageStatus } from '@/lib/types';
import { ISSUE_TRIAGE_STATUSES } from '@/lib/types';
import { ChevronDownIcon, CheckIcon } from '@/components/Icons';

export const TRIAGE_CONFIG: Record<
  IssueTriageStatus,
  { label: string; bg: string; text: string; ring: string; dot: string }
> = {
  Incoming: {
    label: 'Incoming',
    bg: 'bg-sky-50',
    text: 'text-sky-700',
    ring: 'ring-sky-200',
    dot: 'bg-sky-500',
  },
  'In Triage': {
    label: 'In Triage',
    bg: 'bg-purple-50',
    text: 'text-purple-700',
    ring: 'ring-purple-200',
    dot: 'bg-purple-500',
  },
  Confirmed: {
    label: 'Confirmed',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    ring: 'ring-amber-200',
    dot: 'bg-amber-500',
  },
  'In Dev': {
    label: 'In Dev',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    ring: 'ring-blue-200',
    dot: 'bg-blue-500',
  },
  Resolved: {
    label: 'Resolved',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    ring: 'ring-emerald-200',
    dot: 'bg-emerald-500',
  },
  Closed: {
    label: 'Closed',
    bg: 'bg-gray-100',
    text: 'text-gray-700',
    ring: 'ring-gray-300',
    dot: 'bg-gray-400',
  },
};

interface TriageStatusBadgeProps {
  status: IssueTriageStatus | string;
  onStatusChange?: (newStatus: IssueTriageStatus) => void;
  onChange?: (newStatus: IssueTriageStatus) => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
}

export function TriageStatusBadge({
  status,
  onStatusChange,
  onChange,
  size = 'md',
  disabled = false,
}: TriageStatusBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleStatusChange = (newStatus: IssueTriageStatus) => {
    onStatusChange?.(newStatus);
    onChange?.(newStatus);
    setIsOpen(false);
  };

  const currentStatus: IssueTriageStatus = (
    ISSUE_TRIAGE_STATUSES.includes(status as IssueTriageStatus)
      ? status
      : 'Incoming'
  ) as IssueTriageStatus;

  const config = TRIAGE_CONFIG[currentStatus] ?? TRIAGE_CONFIG.Incoming;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const isInteractive = Boolean(onStatusChange || onChange) && !disabled;

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        type="button"
        disabled={!isInteractive}
        onClick={(e) => {
          if (!isInteractive) return;
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={`inline-flex items-center gap-1.5 rounded-full font-medium ring-1 transition-all ${
          config.bg
        } ${config.text} ${config.ring} ${
          size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
        } ${isInteractive ? 'hover:opacity-90 cursor-pointer shadow-xs' : 'cursor-default'}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
        <span>{config.label}</span>
        {isInteractive && (
          <ChevronDownIcon className="w-3 h-3 ml-0.5 opacity-60 group-hover:opacity-100" />
        )}
      </button>

      {isOpen && isInteractive && (
        <div className="absolute left-0 mt-1 w-36 rounded-lg bg-white shadow-lg ring-1 ring-black/5 z-50 py-1 divide-y divide-gray-100 focus:outline-none">
          {ISSUE_TRIAGE_STATUSES.map((st) => {
            const itemCfg = TRIAGE_CONFIG[st];
            const isSelected = st === currentStatus;
            return (
              <button
                key={st}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleStatusChange(st);
                }}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-xs text-left transition-colors ${
                  isSelected
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${itemCfg.dot}`} />
                  {itemCfg.label}
                </span>
                {isSelected && <CheckIcon className="w-3 h-3 text-blue-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
