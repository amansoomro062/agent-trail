import { useCallback, useEffect, useState } from 'react';
import type { SessionDetail, SessionSummary } from './types';
import { fetchSession, fetchSessions } from './api';
import { clockTime, durationText, formatTokens, shortModel } from './format';
import Sidebar from './components/Sidebar';
import SearchBar from './components/SearchBar';
import Timeline from './components/Timeline';
import FilesPanel from './components/FilesPanel';
import ThemeSwitcher from './components/ThemeSwitcher';
import TrailMark from './components/TrailMark';

/** One labeled cell of the session header strip. */
function MetaCell({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 border-r border-hairline px-4 py-2 last:border-r-0 ${className}`}>
      <div className="eyebrow">{label}</div>
      <div className="mt-0.5 truncate text-[13px] text-ink-muted">{children}</div>
    </div>
  );
}

/** A stat in the empty state. */
function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 border-r border-hairline px-8 py-4 last:border-r-0">
      <span className="num text-[24px] font-semibold leading-none text-ink" style={{ letterSpacing: '-0.6px' }}>
        {value.toLocaleString()}
      </span>
      <span className="eyebrow">{label}</span>
    </div>
  );
}

export default function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    fetchSessions()
      .then((s) => {
        setSessions(s);
        if (s.length > 0) setSelectedId((cur) => cur ?? s[0].id);
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setDetailLoading(true);
    fetchSession(selectedId)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  const jumpToSession = useCallback((id: string) => setSelectedId(id), []);

  const summary = sessions.find((s) => s.id === selectedId) ?? null;
  const totalMessages = sessions.reduce((acc, s) => acc + s.messageCount, 0);
  const totalFiles = sessions.reduce((acc, s) => acc + s.filesTouched.length, 0);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center gap-5 border-b border-hairline bg-surface-1 px-4 py-2">
        <div className="flex items-center gap-2">
          <TrailMark className="h-4 w-4 text-accent" />
          <span className="text-[14px] font-semibold text-ink" style={{ letterSpacing: '-0.2px' }}>
            agenttrail
          </span>
        </div>
        <div className="flex flex-1 justify-center">
          <SearchBar onJump={jumpToSession} />
        </div>
        <div className="flex items-center gap-3">
          {selectedId && (
            <span className="mono hidden text-[11px] text-ink-tertiary lg:inline" title={selectedId}>
              {selectedId.slice(0, 8)}
            </span>
          )}
          <ThemeSwitcher />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar sessions={sessions} selectedId={selectedId} onSelect={setSelectedId} />

        <main className="flex min-w-0 flex-1 flex-col">
          {loadError && (
            <div className="m-5 rounded-lg border border-[var(--error-line)] bg-[var(--error-bg)] px-4 py-3 text-[13px] text-error">
              Couldn’t load sessions: {loadError}
            </div>
          )}

          {!loadError && summary && (
            <>
              <div className="flex shrink-0 flex-wrap items-stretch border-b border-hairline bg-surface-1">
                <MetaCell label="Project" className="min-w-[150px]">
                  <span className="font-medium text-ink">{summary.projectName}</span>
                </MetaCell>
                <MetaCell label="Path" className="min-w-[200px] flex-1">
                  <span className="mono text-[12px]">{summary.projectPath}</span>
                </MetaCell>
                <MetaCell label="Started">
                  <span className="num mono text-[12px]">{clockTime(summary.startTime)}</span>
                </MetaCell>
                <MetaCell label="Ended">
                  <span className="num mono text-[12px]">{clockTime(summary.endTime)}</span>
                </MetaCell>
                <MetaCell label="Duration">
                  <span className="num mono text-[12px]">
                    {durationText(summary.startTime, summary.endTime)}
                  </span>
                </MetaCell>
                <MetaCell label="Messages">
                  <span className="num mono text-[12px]">{summary.messageCount}</span>
                </MetaCell>
                {summary.tokens && (
                  <MetaCell label="Tokens">
                    <span
                      className="num mono text-[12px]"
                      title="input + cache read + cache creation in / output out"
                    >
                      {formatTokens(
                        summary.tokens.input +
                          summary.tokens.cacheRead +
                          summary.tokens.cacheCreation,
                      )}
                      {' in · '}
                      {formatTokens(summary.tokens.output)} out
                    </span>
                  </MetaCell>
                )}
                <MetaCell label="Model">
                  <span className="mono text-[12px]">
                    {summary.models.map(shortModel).join(' · ') || '—'}
                  </span>
                </MetaCell>
              </div>
              <FilesPanel files={summary.filesTouched} />
            </>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!loadError && !summary && sessions.length > 0 && (
              <div className="flex h-full flex-col items-center justify-center px-6">
                <TrailMark className="h-9 w-9 text-accent" />
                <h1
                  className="mt-5 text-[28px] font-semibold leading-none text-ink"
                  style={{ letterSpacing: '-0.6px' }}
                >
                  agenttrail
                </h1>
                <p className="mt-2 text-[14px] text-ink-subtle">
                  See what your agents did.
                </p>
                <div className="mt-8 flex items-stretch rounded-lg border border-hairline bg-surface-1">
                  <Stat value={sessions.length} label="Sessions" />
                  <Stat value={totalMessages} label="Messages" />
                  <Stat value={totalFiles} label="Files" />
                </div>
                <p className="mt-6 text-[13px] text-ink-tertiary">
                  Select a session to read its transcript.
                </p>
              </div>
            )}

            {!loadError && sessions.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <TrailMark className="h-8 w-8 text-accent" />
                <p className="text-[14px] text-ink">No sessions found.</p>
                <p className="max-w-md text-[13px] leading-relaxed text-ink-subtle">
                  Run some Claude Code sessions and restart agenttrail, or point it at another
                  transcript directory with <span className="mono text-ink-muted">--dir</span>.
                </p>
              </div>
            )}

            {detailLoading && <p className="px-5 py-4 text-[13px] text-ink-tertiary">Loading…</p>}

            {!detailLoading && detail && detail.id === selectedId && (
              <Timeline messages={detail.messages} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
