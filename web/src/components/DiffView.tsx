import { useMemo, useState } from 'react';
import type { EditDiff } from '../types';
import { collapseContext, diffLines, type DiffLine } from '../diff';

/**
 * One diff line. Removed/added rows carry a +/- marker next to the status
 * color, never color alone (see DESIGN.md).
 */
function DiffLineRow({ line }: { line: DiffLine }) {
  const rowClass =
    line.kind === 'add' ? 'bg-good-wash' : line.kind === 'del' ? 'bg-danger-wash' : '';
  const markerClass =
    line.kind === 'add'
      ? 'text-good'
      : line.kind === 'del'
        ? 'text-danger'
        : 'text-transparent';
  const marker = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ';
  return (
    <div className={`flex ${rowClass}`}>
      <span className={`w-4 shrink-0 select-none text-center font-medium ${markerClass}`}>
        {marker}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">
        {line.text === '' ? ' ' : line.text}
      </span>
    </div>
  );
}

/** The diff of one old/new pair, with long unchanged runs collapsed. */
function EditBlock({ edit }: { edit: EditDiff }) {
  const rows = useMemo(() => collapseContext(diffLines(edit.oldText, edit.newText)), [edit]);
  const [openGaps, setOpenGaps] = useState<ReadonlySet<number>>(new Set());

  const toggleGap = (i: number) =>
    setOpenGaps((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <div className="mono max-h-96 overflow-auto px-3 py-2 text-[11px] leading-relaxed text-ink-2">
      {rows.map((row, i) => {
        if (row.kind === 'collapsed') {
          if (openGaps.has(i)) {
            return row.lines.map((line, k) => <DiffLineRow key={`${i}-${k}`} line={line} />);
          }
          const n = row.lines.length;
          return (
            <button
              key={i}
              onClick={() => toggleGap(i)}
              className="flex w-full items-center py-0.5 text-left text-ink-3 transition-colors duration-150 hover:text-ink-2"
            >
              <span className="w-4 shrink-0 select-none text-center">···</span>
              <span>
                {n} unchanged {n === 1 ? 'line' : 'lines'}
              </span>
            </button>
          );
        }
        return <DiffLineRow key={i} line={row} />;
      })}
    </div>
  );
}

/** Expandable diff for an Edit/MultiEdit tool call: one block per edit. */
export default function DiffView({ edits }: { edits: EditDiff[] }) {
  return (
    <div className="pop-open border-t border-line bg-sunken">
      {edits.map((edit, i) => (
        <div key={i} className="border-b border-line last:border-b-0">
          {edits.length > 1 && (
            <div className="border-b border-line px-3 py-1 text-[11px] font-medium text-ink-3">
              Edit {i + 1} of {edits.length}
            </div>
          )}
          <EditBlock edit={edit} />
        </div>
      ))}
    </div>
  );
}
