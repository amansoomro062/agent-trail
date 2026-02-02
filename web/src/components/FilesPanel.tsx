import { useState } from 'react';
import type { FileEdit } from '../types';
import { basename, dirname } from '../format';

/**
 * Operations are ranked by ink weight, never by hue - mutations read
 * brightest, reads recede. See DESIGN.md § "Tool categories are NOT
 * color-coded".
 */
const OP: Record<FileEdit['operation'], { label: string; chip: string; path: string }> = {
  created: {
    label: 'New',
    chip: 'border-hairline-strong bg-surface-3 text-ink',
    path: 'text-ink-muted',
  },
  edited: {
    label: 'Edit',
    chip: 'border-hairline-strong bg-surface-2 text-ink-muted',
    path: 'text-ink-muted',
  },
  read: {
    label: 'Read',
    chip: 'border-hairline bg-surface-1 text-ink-tertiary',
    path: 'text-ink-subtle',
  },
};

interface Props {
  files: FileEdit[];
}

/** Collapsible list of every file the agent touched this session. */
export default function FilesPanel({ files }: Props) {
  const [open, setOpen] = useState(false);

  if (files.length === 0) return null;

  const created = files.filter((f) => f.operation === 'created').length;
  const edited = files.filter((f) => f.operation === 'edited').length;
  const read = files.filter((f) => f.operation === 'read').length;

  const counts = [
    created > 0 && `${created} new`,
    edited > 0 && `${edited} edited`,
    read > 0 && `${read} read`,
  ].filter(Boolean) as string[];

  return (
    <section className="border-b border-hairline bg-surface-1">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors duration-150 ease-out hover:bg-surface-2"
      >
        <svg
          viewBox="0 0 12 12"
          fill="none"
          className={`h-2.5 w-2.5 shrink-0 text-ink-tertiary transition-transform duration-150 ease-out ${
            open ? 'rotate-90' : ''
          }`}
          aria-hidden="true"
        >
          <path d="m4 2 4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="eyebrow">Files</span>
        <span className="num text-[13px] text-ink">{files.length}</span>
        <span className="num text-[12px] text-ink-tertiary">{counts.join(' · ')}</span>
      </button>

      {open && (
        /* capped so a 200-file session can't push the transcript off-screen */
        <div className="grid max-h-72 grid-cols-1 overflow-y-auto border-t border-hairline xl:grid-cols-2">
          {files.map((f) => {
            const op = OP[f.operation];
            const dir = dirname(f.path);
            return (
              <div
                key={f.path}
                className="flex items-center gap-2.5 border-b border-hairline px-4 py-1.5 transition-colors duration-150 ease-out hover:bg-surface-2 xl:odd:border-r"
                title={f.path}
              >
                <span
                  className={`shrink-0 rounded border px-1.5 py-px text-[10px] font-medium ${op.chip}`}
                >
                  {op.label}
                </span>
                <span className={`mono min-w-0 truncate text-[12px] ${op.path}`}>
                  <span className="text-ink-tertiary">{dir}</span>
                  {basename(f.path)}
                </span>
                {f.count > 1 && (
                  <span className="num mono ml-auto shrink-0 text-[11px] text-ink-tertiary">
                    ×{f.count}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
