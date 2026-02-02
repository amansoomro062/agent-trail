import { useMemo, useState } from 'react';
import type { SessionSummary } from '../types';
import { durationText, relativeTime } from '../format';

interface Props {
  sessions: SessionSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Left panel: the session list, sorted by recency. */
export default function Sidebar({ sessions, selectedId, onSelect }: Props) {
  const [filter, setFilter] = useState('');

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.projectName.toLowerCase().includes(q) ||
        (s.firstUserMessage ?? '').toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q),
    );
  }, [sessions, filter]);

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-r border-hairline bg-surface-1">
      <div className="border-b border-hairline px-3 py-3">
        <div className="mb-2 flex items-baseline justify-between px-0.5">
          <span className="eyebrow">Sessions</span>
          <span className="num text-[12px] text-ink-tertiary">{visible.length}</span>
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter sessions"
          aria-label="Filter sessions"
          className="w-full rounded-md border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-ink placeholder-ink-tertiary outline-none transition-colors duration-150 ease-out focus:border-hairline-strong focus:bg-surface-3"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 && (
          <p className="px-3.5 py-4 text-[13px] text-ink-tertiary">No sessions match.</p>
        )}
        {visible.map((s) => {
          const active = s.id === selectedId;
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              aria-current={active ? 'true' : undefined}
              className={`relative block w-full border-b border-hairline px-3.5 py-2.5 text-left transition-colors duration-150 ease-out ${
                active ? 'bg-surface-3' : 'hover:bg-surface-2'
              }`}
            >
              {/* the selection rail - one of the four accent slots */}
              {active && (
                <span className="absolute inset-y-0 left-0 w-[2px] bg-accent" aria-hidden="true" />
              )}
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={`truncate text-[14px] font-medium ${
                    active ? 'text-ink' : 'text-ink-muted'
                  }`}
                  style={{ letterSpacing: '-0.2px' }}
                >
                  {s.projectName}
                </span>
                <span className="num shrink-0 text-[11px] text-ink-tertiary">
                  {relativeTime(s.endTime ?? s.startTime)}
                </span>
              </div>

              {s.firstUserMessage && (
                <p className="mt-1 truncate text-[12px] leading-snug text-ink-subtle">
                  {s.firstUserMessage}
                </p>
              )}

              <div className="num mono mt-1.5 flex items-center gap-2 text-[11px] text-ink-tertiary">
                <span>{s.messageCount} msg</span>
                <span aria-hidden="true">·</span>
                <span>{durationText(s.startTime, s.endTime)}</span>
                {s.filesTouched.length > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{s.filesTouched.length} files</span>
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
