import { useMemo } from 'react';
import type { SessionSummary } from '../types';
import { formatTokens, relativeTime, shortPath } from '../format';
import { emptyTally, categoryColor } from '../viz';
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

export default function HomeDashboard({
  sessions,
  onSelect,
}: {
  sessions: SessionSummary[];
  onSelect: (id: string) => void;
}) {
  const stats = useMemo(() => {
    const tally = emptyTally();
    let messages = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    let tokensCached = 0;
    const fileCounts = new Map<string, number>();
    const projects = new Map<string, number>();
    const byDay = new Map<string, number>();

    for (const s of sessions) {
      messages += s.messageCount;
      tally.edit += s.tools.edit;
      tally.command += s.tools.command;
      tally.read += s.tools.read;
      tally.search += s.tools.search;
      tally.task += s.tools.task;
      tally.errors += s.tools.errors;
      tally.total += s.tools.total;

      if (s.tokens) {
        // Cache reads dwarf everything else and are billed at a fraction of the
        // rate, so folding them into a headline "tokens" figure reads as wildly
        // inflated. They get their own line instead.
        tokensIn += s.tokens.input;
        tokensOut += s.tokens.output;
        tokensCached += s.tokens.cacheRead + s.tokens.cacheCreation;
      }

      for (const f of s.filesTouched) {
        if (f.operation === 'read') continue; // rank by what actually changed
        fileCounts.set(f.path, (fileCounts.get(f.path) ?? 0) + f.count);
      }

      projects.set(s.projectName, (projects.get(s.projectName) ?? 0) + 1);

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
    }

    const topFiles: BarItem[] = [...fileCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([path, count]) => ({
        label: shortPath(path),
        sub: path,
        value: count,
        color: categoryColor('edit'),
      }));

    const topProjects: BarItem[] = [...projects.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ label: name, value: count, color: categoryColor('task') }));

    const filesChanged = fileCounts.size;

    return {
      tally, messages, tokensIn, tokensOut, tokensCached,
      topFiles, topProjects, byDay, filesChanged,
    };
  }, [sessions]);

  const recent = sessions.slice(0, 5);

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-5">
        <h1 className="text-[22px] font-semibold text-ink" style={{ letterSpacing: '-0.5px' }}>
          Overview
        </h1>
        <p className="mt-0.5 text-[13px] text-ink-3">
          Everything your agents have done across {sessions.length}{' '}
          {sessions.length === 1 ? 'session' : 'sessions'}.
        </p>
      </div>

      <div className="card mb-4 overflow-hidden">
        <StatRow>
          <StatTile value={sessions.length} label="Sessions" />
          <StatTile value={stats.messages.toLocaleString()} label="Messages" />
          <StatTile value={stats.tally.total.toLocaleString()} label="Tool calls" />
          <StatTile value={stats.filesChanged.toLocaleString()} label="Files changed" />
          <StatTile
            value={formatTokens(stats.tokensIn + stats.tokensOut)}
            label="Tokens"
            hint={`${stats.tokensIn.toLocaleString()} in · ${stats.tokensOut.toLocaleString()} out\n${stats.tokensCached.toLocaleString()} cached (read + creation), excluded from this total`}
          />
          <StatTile
            value={stats.tally.errors.toLocaleString()}
            label="Failed calls"
            tone={stats.tally.errors > 0 ? 'danger' : 'default'}
          />
        </StatRow>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Activity" subtitle="Sessions per day" className="lg:col-span-2">
          <Heatmap cells={stats.byDay} weeks={18} />
        </Panel>
        <Panel title="What the agents did" subtitle="Tool calls by type">
          <ToolMixBar tally={stats.tally} height={12} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Most-changed files" subtitle="Writes and edits only">
          <BarList items={stats.topFiles} unit="changes" />
        </Panel>
        <Panel title="Busiest projects" subtitle="By session count">
          <BarList items={stats.topProjects} unit="sessions" />
        </Panel>
        <Panel title="Recent sessions">
          <div className="flex flex-col gap-2.5">
            {recent.map((s) => (
              <button
                key={s.id}
                onClick={() => onSelect(s.id)}
                className="card-interactive rounded-lg border border-line bg-card px-3 py-2 text-left hover:bg-card-2"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-medium text-ink">
                    {s.projectName}
                  </span>
                  <span className="num shrink-0 text-[11px] text-ink-3">
                    {relativeTime(s.endTime ?? s.startTime)}
                  </span>
                </div>
                {s.firstUserMessage && (
                  <p className="mt-0.5 truncate text-[12px] text-ink-3">{s.firstUserMessage}</p>
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
