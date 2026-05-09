import { useMemo, useState } from 'react';
import type { SessionSummary } from '../types';
import { relativeTime } from '../format';
import { MixSpark } from './charts';

interface Props {
  sessions: SessionSummary[];
  selectedId: string | null;
  activeProject: string | null;
  isHome: boolean;
  onSelect: (id: string) => void;
  onProject: (path: string) => void;
  onHome: () => void;
}

export default function Sidebar({
  sessions,
  selectedId,
  activeProject,
  isHome,
  onSelect,
  onProject,
  onHome,
}: Props) {
  const [filter, setFilter] = useState('');
  const [showProjects, setShowProjects] = useState(true);

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

  /** Distinct projects, keyed by path - two projects can share a basename. */
  const projects = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>();
    for (const s of sessions) {
      const cur = m.get(s.projectPath);
      if (cur) cur.count += 1;
      else m.set(s.projectPath, { name: s.projectName, count: 1 });
    }
    return [...m.entries()]
      .map(([path, v]) => ({ path, ...v }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [sessions]);

  return (
    <aside className="flex h-full w-[288px] shrink-0 flex-col border-r border-line bg-card">
      <div className="border-b border-line p-3">
        <button
          onClick={onHome}
          className={`mb-2.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors duration-150 ${
            isHome
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

        {/* projects - a way into the per-project dashboards */}
        <div className="mb-2.5">
          <button
            onClick={() => setShowProjects((v) => !v)}
            aria-expanded={showProjects}
            className="mb-1 flex w-full items-center gap-1.5 px-0.5 text-left"
          >
            <svg
              viewBox="0 0 12 12"
              fill="none"
              className={`h-2 w-2 shrink-0 text-ink-3 transition-transform duration-150 ${
                showProjects ? 'rotate-90' : ''
              }`}
              aria-hidden="true"
            >
              <path d="m4 2 4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="eyebrow">Projects</span>
            <span className="num ml-auto text-[12px] text-ink-3">{projects.length}</span>
          </button>
          {showProjects && (
            <div className="flex max-h-44 flex-col gap-px overflow-y-auto">
              {projects.map((p) => {
                const active = p.path === activeProject;
                return (
                  <button
                    key={p.path}
                    onClick={() => onProject(p.path)}
                    title={p.path}
                    className={`flex items-center gap-2 rounded-md px-2 py-1 text-left transition-colors duration-150 ${
                      active
                        ? 'bg-brand-wash text-brand-text'
                        : 'text-ink-2 hover:bg-sunken hover:text-ink'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[12px]">{p.name}</span>
                    <span className="num shrink-0 text-[11px] text-ink-3">{p.count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

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
                  {s.provider !== 'claude' && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{s.provider}</span>
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
