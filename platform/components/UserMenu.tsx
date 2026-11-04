'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { LogOutIcon } from '@/components/Icons';

/** Header account menu: shows who is signed in and offers Sign out. */
export function UserMenu() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function signOut() {
    await supabase.auth.signOut();
    try {
      sessionStorage.removeItem('qa_token');
    } catch {
      /* storage can be unavailable */
    }
    router.push('/login');
  }

  const initial = (email ?? '?').charAt(0).toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 hover:bg-indigo-200 transition-colors"
      >
        {initial}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-10 z-50 w-60 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg"
        >
          <div className="px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Signed in as</p>
            <p className="truncate text-sm font-medium text-gray-900" title={email ?? undefined}>
              {email ?? '…'}
            </p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            <LogOutIcon className="h-4 w-4 text-gray-400" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
