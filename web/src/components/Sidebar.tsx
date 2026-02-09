import { useMemo, useState } from 'react';
import type { SessionSummary } from '../types';
import { relativeTime } from '../format';
import { MixSpark } from './charts';

interface Props {
  sessions: SessionSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onHome: () => void;
}

export default function Sidebar({ sessions, selectedId, onSelect, onHome }: Props) {
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
    <aside className="flex h-full w-[288px] shrink-0 flex-col border-r border-line bg-card">
      <div className="border-b border-line p-3">
        <button
          onClick={onHome}
          className={`mb-2.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors duration-150 ${
            selectedId === null
              ? 'bg-brand-wash text-brand-text'
              : 'text-ink-2 hover:bg-sunken hover:text-ink active:scale-[0.99]'
          }`}
        >
          <svg viewBox="0 0 14 14" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
            <rect x="1.5" y="1.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
            <rect x="8" y="1.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
            <rect x="1.5" y="8" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
            <rect x="8" y="8" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          Overview
        </button>

        <div className="mb-2 flex items-baseline justify-between px-0.5">
          <span className="eyebrow">Sessions</span>
          <span className="num text-[12px] text-ink-3">{visible.length}</span>
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter sessions"
          aria-label="Filter sessions"
          className="w-full rounded-lg border border-line bg-sunken px-2.5 py-1.5 text-[13px] text-ink placeholder-ink-3 outline-none transition-colors duration-150 focus:border-line-strong focus:bg-card"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {visible.length === 0 && (
          <p className="px-2 py-4 text-[13px] text-ink-3">No sessions match.</p>
        )}
        <div className="flex flex-col gap-1">
          {visible.map((s) => {
            const active = s.id === selectedId;
            return (
              <button
                key={s.id}
                onClick={() => onSelect(s.id)}
                aria-current={active ? 'true' : undefined}
                className={`relative rounded-lg border px-2.5 py-2 text-left transition-all duration-150 ${
                  active
                    ? 'is-selected'
                    : 'border-transparent hover:border-line hover:bg-sunken'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`truncate text-[13px] font-medium ${active ? 'text-brand-text' : 'text-ink'}`}
                  >
                    {s.projectName}
                  </span>
                  <span className="num shrink-0 text-[11px] text-ink-3">
                    {relativeTime(s.endTime ?? s.startTime)}
                  </span>
                </div>

                {s.firstUserMessage && (
                  <p className="mt-0.5 truncate text-[12px] leading-snug text-ink-3">
                    {s.firstUserMessage}
                  </p>
                )}

                {/* the fingerprint - each session gets a recognisable shape */}
                <MixSpark tally={s.tools} className="mt-2" />

                <div className="num mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-3">
                  <span>{s.messageCount} msg</span>
                  {s.filesTouched.length > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{s.filesTouched.length} files</span>
                    </>
                  )}
                  {s.tools.errors > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-danger">{s.tools.errors} failed</span>
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
