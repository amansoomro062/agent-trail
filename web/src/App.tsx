import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionDetail, SessionSummary } from './types';
import { fetchSession, fetchSessions, subscribeSessionChanges } from './api';
import Sidebar from './components/Sidebar';
import SearchBar from './components/SearchBar';
import HomeDashboard from './components/HomeDashboard';
import ProjectDashboard from './components/ProjectDashboard';
import SessionView from './components/SessionView';
import SourcesPanel from './components/SourcesPanel';
import ThemeSwitcher from './components/ThemeSwitcher';
import TrailMark from './components/TrailMark';

type View =
  | { kind: 'home' }
  | { kind: 'project'; path: string }
  | { kind: 'session'; id: string };

export default function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'home' });
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  /** session id → ms epoch of its last live change, drives the Live pill. */
  const [lastChangeAt, setLastChangeAt] = useState<Record<string, number>>({});

  const selectedId = view.kind === 'session' ? view.id : null;
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

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

  // Live tail: refetch what a change touches. Bursts collapse into one
  // trailing refetch each for the list and the open session.
  useEffect(() => {
    let listTimer: ReturnType<typeof setTimeout> | null = null;
    let detailTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeSessionChanges((change) => {
      setLastChangeAt((m) => ({ ...m, [change.sessionId]: Date.now() }));
      if (listTimer) clearTimeout(listTimer);
      listTimer = setTimeout(() => {
        fetchSessions()
          .then(setSessions)
          .catch(() => {});
      }, 500);
      if (selectedIdRef.current === change.sessionId) {
        if (detailTimer) clearTimeout(detailTimer);
        detailTimer = setTimeout(() => {
          fetchSession(change.sessionId)
            .then((d) => {
              if (selectedIdRef.current === change.sessionId) setDetail(d);
            })
            .catch(() => {});
        }, 400);
      }
    });
    return () => {
      unsubscribe();
      if (listTimer) clearTimeout(listTimer);
      if (detailTimer) clearTimeout(detailTimer);
    };
  }, []);

  const toTop = () => document.getElementById('main-scroll')?.scrollTo({ top: 0 });

  const openSession = useCallback((id: string) => {
    setView({ kind: 'session', id });
    toTop();
  }, []);
  const openProject = useCallback((path: string) => {
    setView({ kind: 'project', path });
    toTop();
  }, []);
  const goHome = useCallback(() => {
    setView({ kind: 'home' });
    toTop();
  }, []);

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
          <SearchBar onJump={openSession} />
        </div>
        <div className="flex items-center gap-1.5">
          <SourcesPanel />
          <ThemeSwitcher />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar
          sessions={sessions}
          selectedId={selectedId}
          activeProject={view.kind === 'project' ? view.path : null}
          isHome={view.kind === 'home'}
          onSelect={openSession}
          onProject={openProject}
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

          {!loadError && sessions.length > 0 && view.kind === 'home' && (
            <HomeDashboard
              sessions={sessions}
              onSelect={openSession}
              onProject={openProject}
            />
          )}

          {!loadError && view.kind === 'project' && (
            <ProjectDashboard
              key={view.path}
              path={view.path}
              sessions={sessions}
              onSelect={openSession}
              onHome={goHome}
            />
          )}

          {!loadError && summary && (
            <SessionView
              key={summary.id}
              summary={summary}
              detail={detail && detail.id === summary.id ? detail : null}
              loading={detailLoading}
              lastChange={lastChangeAt[summary.id] ?? 0}
              onProject={openProject}
              onHome={goHome}
            />
          )}
        </main>
      </div>
    </div>
  );
}
