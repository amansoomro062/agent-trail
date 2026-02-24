import { useMemo } from 'react';
import type { SessionSummary } from '../types';
import { durationText, formatTokens, relativeTime, shortPath } from '../format';
import { categoryColor, emptyTally } from '../viz';
import { BarList, Heatmap, MixSpark, StatRow, StatTile, ToolMixBar } from './charts';
import type { BarItem } from './charts';

function Panel({
  title,
  subtitle,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card p-4 ${className}`}>
      <div className="mb-3.5">
        <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[12px] text-ink-3">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

/** Everything the agents have done in one project, across all its sessions. */
export default function ProjectDashboard({
  path,
  sessions,
  onSelect,
  onHome,
}: {
  path: string;
  sessions: SessionSummary[];
  onSelect: (id: string) => void;
  onHome: () => void;
}) {
  const mine = useMemo(
    () => sessions.filter((s) => s.projectPath === path),
    [sessions, path],
  );

  const stats = useMemo(() => {
    const tally = emptyTally();
    let messages = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    let tokensCached = 0;
    const byDay = new Map<string, number>();
    // how many distinct sessions touched each file - the "keeps coming back" signal
    const fileSessions = new Map<string, Set<string>>();
    const fileTouches = new Map<string, number>();

    for (const s of mine) {
      messages += s.messageCount;
      tally.edit += s.tools.edit;
      tally.command += s.tools.command;
      tally.read += s.tools.read;
      tally.search += s.tools.search;
      tally.task += s.tools.task;
      tally.errors += s.tools.errors;
      tally.total += s.tools.total;

      if (s.tokens) {
        tokensIn += s.tokens.input;
        tokensOut += s.tokens.output;
        tokensCached += s.tokens.cacheRead + s.tokens.cacheCreation;
      }

      const when = s.endTime ?? s.startTime;
      if (when) {
        const d = new Date(when);
        if (!Number.isNaN(d.getTime())) {
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
            d.getDate(),
          ).padStart(2, '0')}`;
          byDay.set(key, (byDay.get(key) ?? 0) + 1);
        }
      }

      for (const f of s.filesTouched) {
        if (f.operation === 'read') continue;
        if (!fileSessions.has(f.path)) fileSessions.set(f.path, new Set());
        fileSessions.get(f.path)!.add(s.id);
        fileTouches.set(f.path, (fileTouches.get(f.path) ?? 0) + f.count);
      }
    }

    const recurring: BarItem[] = [...fileSessions.entries()]
      .map(([p, set]) => ({ p, n: set.size }))
      .sort((a, b) => b.n - a.n || (fileTouches.get(b.p) ?? 0) - (fileTouches.get(a.p) ?? 0))
      .slice(0, 10)
      .map(({ p, n }) => ({
        label: shortPath(p),
        sub: p,
        value: n,
        color: categoryColor('edit'),
      }));

    const busiest: BarItem[] = [...fileTouches.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([p, n]) => ({
        label: shortPath(p),
        sub: p,
        value: n,
        color: categoryColor('task'),
      }));

    return {
      tally,
      messages,
      tokensIn,
      tokensOut,
      tokensCached,
      byDay,
      recurring,
      busiest,
      filesChanged: fileSessions.size,
    };
  }, [mine]);

  const name = mine[0]?.projectName ?? shortPath(path, 1);

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <nav className="mb-3 flex items-center gap-1.5 text-[12px] text-ink-3">
        <button onClick={onHome} className="transition-colors duration-150 hover:text-ink">
          Overview
        </button>
        <span aria-hidden="true">/</span>
        <span className="text-ink-2">{name}</span>
      </nav>

      <div className="mb-5">
        <h1 className="text-[22px] font-semibold text-ink" style={{ letterSpacing: '-0.5px' }}>
          {name}
        </h1>
        <p className="mono mt-0.5 truncate text-[12px] text-ink-3">{path}</p>
      </div>

      <div className="card mb-4 overflow-hidden">
        <StatRow>
          <StatTile value={mine.length} label="Sessions" />
          <StatTile value={stats.messages.toLocaleString()} label="Messages" />
          <StatTile value={stats.tally.total.toLocaleString()} label="Tool calls" />
          <StatTile value={stats.filesChanged.toLocaleString()} label="Files changed" />
          <StatTile
            value={formatTokens(stats.tokensIn + stats.tokensOut)}
            label="Tokens"
            hint={`${stats.tokensIn.toLocaleString()} in · ${stats.tokensOut.toLocaleString()} out\n${stats.tokensCached.toLocaleString()} cached, excluded from this total`}
          />
          <StatTile
            value={stats.tally.errors.toLocaleString()}
            label="Failed calls"
            tone={stats.tally.errors > 0 ? 'danger' : 'default'}
          />
        </StatRow>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Activity" subtitle="Sessions per day in this project" className="lg:col-span-2">
          <Heatmap cells={stats.byDay} weeks={18} />
        </Panel>
        <Panel title="What the agents did" subtitle="Tool calls by type">
          <ToolMixBar tally={stats.tally} height={12} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Files that keep coming back" subtitle="Sessions that changed each file">
          <BarList items={stats.recurring} unit="sessions" />
        </Panel>
        <Panel title="Most-changed files" subtitle="Total writes and edits">
          <BarList items={stats.busiest} unit="changes" />
        </Panel>
        <Panel title={`Sessions · ${mine.length}`}>
          <div className="flex max-h-[420px] flex-col gap-2.5 overflow-y-auto">
            {mine.map((s) => (
              <button
                key={s.id}
                onClick={() => onSelect(s.id)}
                className="card-interactive rounded-lg border border-line bg-card px-3 py-2 text-left hover:bg-card-2"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="num truncate text-[12px] text-ink-2">
                    {s.messageCount} msg · {durationText(s.startTime, s.endTime)}
                  </span>
                  <span className="num shrink-0 text-[11px] text-ink-3">
                    {relativeTime(s.endTime ?? s.startTime)}
                  </span>
                </div>
                {s.firstUserMessage && (
                  <p className="mt-0.5 truncate text-[13px] text-ink">{s.firstUserMessage}</p>
                )}
                <MixSpark tally={s.tools} className="mt-2" />
              </button>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
