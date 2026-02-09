import { useCallback, useEffect, useState } from 'react';
import type { SessionDetail, SessionSummary } from './types';
import { fetchSession, fetchSessions } from './api';
import Sidebar from './components/Sidebar';
import SearchBar from './components/SearchBar';
import HomeDashboard from './components/HomeDashboard';
import SessionView from './components/SessionView';
import ThemeSwitcher from './components/ThemeSwitcher';
import TrailMark from './components/TrailMark';

export default function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // null = the overview dashboard
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    fetchSessions()
      .then(setSessions)
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    fetchSession(selectedId)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    document.getElementById('main-scroll')?.scrollTo({ top: 0 });
  }, []);
  const goHome = useCallback(() => setSelectedId(null), []);

  const summary = sessions.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="flex h-screen flex-col bg-page">
      <header className="flex shrink-0 items-center gap-5 border-b border-line bg-card px-4 py-2.5">
        <button onClick={goHome} className="flex items-center gap-2" aria-label="Go to overview">
          <TrailMark className="h-5 w-5 text-brand" />
          <span className="text-[14px] font-semibold text-ink" style={{ letterSpacing: '-0.2px' }}>
            agenttrail
          </span>
        </button>
        <div className="flex flex-1 justify-center">
          <SearchBar onJump={select} />
        </div>
        <ThemeSwitcher />
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar
          sessions={sessions}
          selectedId={selectedId}
          onSelect={select}
          onHome={goHome}
        />

        <main id="main-scroll" className="min-w-0 flex-1 overflow-y-auto">
          {loadError && (
            <div className="m-6 rounded-lg border border-danger-line bg-danger-wash px-4 py-3 text-[13px] text-danger">
              Couldn’t load sessions: {loadError}
            </div>
          )}

          {!loadError && sessions.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <TrailMark className="h-9 w-9 text-brand" />
              <p className="text-[15px] font-medium text-ink">No sessions found.</p>
              <p className="max-w-md text-[13px] leading-relaxed text-ink-3">
                Run some Claude Code sessions and restart agenttrail, or point it at another
                transcript directory with <span className="mono text-ink-2">--dir</span>.
              </p>
            </div>
          )}

          {!loadError && sessions.length > 0 && !summary && (
            <HomeDashboard sessions={sessions} onSelect={select} />
          )}

          {!loadError && summary && (
            <SessionView
              key={summary.id}
              summary={summary}
              detail={detail && detail.id === summary.id ? detail : null}
              loading={detailLoading}
            />
          )}
        </main>
      </div>
    </div>
  );
}
