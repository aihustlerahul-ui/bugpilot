'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { IssueComment } from '@/lib/types';

const MAX_LEN = 5000;

export function IssueComments({ issueId }: { issueId: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const key = ['issue-comments', issueId];

  const { data: comments, isLoading, isError } = useQuery<IssueComment[]>({
    queryKey: key,
    queryFn: () => api.get<IssueComment[]>(`/issues/${issueId}/comments`),
  });

  const post = useMutation({
    mutationFn: (body: string) => api.post<IssueComment>(`/issues/${issueId}/comments`, { body }),
    onSuccess: (created) => {
      qc.setQueryData<IssueComment[]>(key, (old) => [...(old ?? []), created]);
      setText('');
    },
  });

  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0 && text.length <= MAX_LEN && !post.isPending;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-4" aria-label="Comments">
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
        Comments{comments ? ` (${comments.length})` : ''}
      </h3>

      {isLoading && <p className="text-sm text-slate-400">Loading comments…</p>}
      {isError && <p className="text-sm text-red-600">Could not load comments.</p>}
      {comments && comments.length === 0 && (
        <p className="text-sm text-slate-400">No comments yet.</p>
      )}

      {comments && comments.length > 0 && (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg bg-slate-50 p-3">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="font-semibold text-slate-700">{c.author_name}</span>
                {c.source === 'mcp' && (
                  <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">AI</span>
                )}
                <span>{new Date(c.created_at).toLocaleString()}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) post.mutate(trimmed);
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_LEN}
          rows={3}
          placeholder="Add a comment…"
          aria-label="Add a comment"
          className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-400">{text.length}/{MAX_LEN}</span>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {post.isPending ? 'Posting…' : 'Comment'}
          </button>
        </div>
        {post.isError && (
          <p className="text-xs text-red-600">{(post.error as Error).message || 'Failed to post comment.'}</p>
        )}
      </form>
    </section>
  );
}
