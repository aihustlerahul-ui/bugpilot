'use client';

import { useState } from 'react';

const COLLAPSE_CHARS = 300;
const COLLAPSE_LINES = 5;

/** Long text (pasted logs, recorded steps) wraps inside its card and starts collapsed. */
export function CollapsibleText({ text, className = '' }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const isLong = text.length > COLLAPSE_CHARS || text.split('\n').length > COLLAPSE_LINES;

  return (
    <div>
      <p
        className={`whitespace-pre-wrap [overflow-wrap:anywhere] ${className} ${
          isLong ? (open ? 'max-h-96 overflow-y-auto' : 'max-h-24 overflow-hidden') : ''
        }`}
      >
        {text}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
