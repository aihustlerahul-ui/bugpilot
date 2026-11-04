'use client';

import type { Issue, IssueEvent } from '@/lib/types';

type Entry = { key: string; at: string; actor: string; text: string; ai: boolean };

function describe(e: IssueEvent): string {
  if (e.event_type === 'status') {
    return `changed status from ${e.from_value ?? '—'} to ${e.to_value ?? '—'}`;
  }
  const was = e.from_value ? ` (was ${e.from_value})` : '';
  return e.to_value ? `assigned to ${e.to_value}${was}` : `removed the assignee${was}`;
}

export function IssueHistory({ issue }: { issue: Issue }) {
  const reporter = issue.reporter?.name || issue.reporter?.email || 'Unknown reporter';
  const entries: Entry[] = [
    { key: 'created', at: issue.created_at, actor: reporter, text: 'reported this issue', ai: false },
    ...(issue.history ?? []).map((e) => ({
      key: e.id,
      at: e.created_at,
      actor: e.actor_name,
      text: describe(e),
      ai: e.source === 'mcp',
    })),
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
        History ({entries.length})
      </h3>
      <ol className="mt-3 space-y-3">
        {[...entries].reverse().map((e) => (
          <li key={e.key} className="flex gap-3 text-xs">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-400" />
            <div className="min-w-0">
              <p className="text-slate-800 [overflow-wrap:anywhere]">
                <span className="font-semibold">{e.actor}</span>
                {e.ai && (
                  <span className="ml-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">
                    AI
                  </span>
                )}{' '}
                {e.text}
              </p>
              <p className="text-slate-400">{new Date(e.at).toLocaleString()}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
