import { useState } from 'react';
import type { FileEdit } from '../types';
import { basename, dirname } from '../format';
import { categoryColor } from '../viz';

/**
 * Operations reuse the categorical slots they correspond to - writes and edits
 * are the 'edit' hue, reads the 'read' hue - so a file row and a tool row for
 * the same action agree on color.
 */
const OP: Record<FileEdit['operation'], { label: string; color: string }> = {
  created: { label: 'New', color: categoryColor('edit') },
  edited: { label: 'Edit', color: categoryColor('edit') },
  read: { label: 'Read', color: categoryColor('read') },
};

export default function FilesPanel({ files }: { files: FileEdit[] }) {
  const [open, setOpen] = useState(false);
  if (files.length === 0) return null;

  const created = files.filter((f) => f.operation === 'created').length;
  const edited = files.filter((f) => f.operation === 'edited').length;
  const read = files.filter((f) => f.operation === 'read').length;
  const maxCount = Math.max(...files.map((f) => f.count), 1);

  const counts = [
    created > 0 && `${created} new`,
    edited > 0 && `${edited} edited`,
    read > 0 && `${read} read`,
  ].filter(Boolean) as string[];

  return (
    <section className="card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors duration-150 hover:bg-card-2"
      >
        <svg
          viewBox="0 0 12 12"
          fill="none"
          className={`h-2.5 w-2.5 shrink-0 text-ink-3 transition-transform duration-150 ${
            open ? 'rotate-90' : ''
          }`}
          aria-hidden="true"
        >
          <path d="m4 2 4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h2 className="text-[13px] font-semibold text-ink">Files touched</h2>
        <span className="num rounded-full bg-sunken px-2 py-0.5 text-[11px] font-medium text-ink-2">
          {files.length}
        </span>
        <span className="num text-[12px] text-ink-3">{counts.join(' · ')}</span>
      </button>

      {open && (
        <div className="max-h-80 overflow-y-auto border-t border-line">
          {files.map((f) => {
            const op = OP[f.operation];
            return (
              <div
                key={f.path}
                className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-b-0 hover:bg-card-2"
                title={f.path}
              >
                <span
                  className="w-11 shrink-0 rounded px-1.5 py-px text-center text-[10px] font-semibold text-white"
                  style={{ background: op.color }}
                >
                  {op.label}
                </span>
                <span className="mono min-w-0 flex-1 truncate text-[12px] text-ink-2">
                  <span className="text-ink-3">{dirname(f.path)}</span>
                  {basename(f.path)}
                </span>
                {/* touch count as a small bar, so hot files stand out */}
                <span className="flex w-24 shrink-0 items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${(f.count / maxCount) * 100}%`, background: op.color }}
                    />
                  </span>
                  <span className="num w-5 text-right text-[11px] text-ink-3">{f.count}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
