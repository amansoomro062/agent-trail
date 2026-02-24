import { useMemo } from 'react';
import type { SessionDetail, SessionSummary } from '../types';
import { clockTime, dirname, previewText, relativeToRoot, shortPath } from '../format';
import { categoryColor } from '../viz';
import { BarList } from './charts';
import type { BarItem } from './charts';
import ToolIcon from './ToolIcon';

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
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[12px] text-ink-3">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * "What actually happened here" - the session reduced to the four things worth
 * knowing without reading it: what changed, what you asked for, what broke, and
 * which files took the most work. All derived from the transcript.
 */
export default function SessionDigest({
  summary,
  detail,
  onJump,
}: {
  summary: SessionSummary;
  detail: SessionDetail | null;
  onJump: (uuid: string) => void;
}) {
  const changedByDir = useMemo(() => {
    const dirs = new Map<string, number>();
    for (const f of summary.filesTouched) {
      if (f.operation === 'read') continue;
      const d = dirname(f.path) || '/';
      dirs.set(d, (dirs.get(d) ?? 0) + 1);
    }
    return [...dirs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([dir, n]): BarItem => ({
        label: relativeToRoot(dir, summary.projectPath),
        sub: dir,
        value: n,
        color: categoryColor('edit'),
      }));
  }, [summary.filesTouched, summary.projectPath]);

  const busiestFiles = useMemo(
    () =>
      summary.filesTouched
        .slice()
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .map((f): BarItem => ({
          label: shortPath(f.path),
          sub: f.path,
          value: f.count,
          color: f.operation === 'read' ? categoryColor('read') : categoryColor('edit'),
        })),
    [summary.filesTouched],
  );

  const instructions = useMemo(() => {
    if (!detail) return [];
    return detail.messages
      .filter((m) => m.role === 'user' && m.texts.join('').trim().length > 0)
      .map((m) => ({
        uuid: m.uuid,
        time: clockTime(m.timestamp),
        text: previewText(m.texts.join(' '), 200),
      }));
  }, [detail]);

  const failures = useMemo(() => {
    if (!detail) return [];
    const out: Array<{ uuid: string; time: string; name: string; target: string; why: string }> = [];
    for (const m of detail.messages) {
      for (const t of m.toolUses) {
        if (!t.isError) continue;
        out.push({
          uuid: m.uuid,
          time: clockTime(m.timestamp),
          name: t.name,
          target: t.filePath ? shortPath(t.filePath) : (t.summary ?? ''),
          why: previewText(t.resultPreview ?? '', 120),
        });
      }
    }
    return out;
  }, [detail]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Panel title="What changed" subtitle="Directories touched by writes and edits">
        {changedByDir.length > 0 ? (
          <BarList items={changedByDir} unit="files" />
        ) : (
          <p className="text-[13px] text-ink-3">Nothing was written or edited in this session.</p>
        )}
      </Panel>

      <Panel title="Busiest files" subtitle="By number of tool calls">
        <BarList items={busiestFiles} unit="touches" />
      </Panel>

      <Panel
        title={`Your instructions${instructions.length ? ` · ${instructions.length}` : ''}`}
        subtitle="Every turn you took - click to jump to it"
      >
        {instructions.length === 0 ? (
          <p className="text-[13px] text-ink-3">No prompts recorded.</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {instructions.map((ins) => (
              <li key={ins.uuid}>
                <button
                  onClick={() => onJump(ins.uuid)}
                  className="flex w-full gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-sunken"
                >
                  <span className="num mono shrink-0 pt-px text-[11px] text-ink-3">{ins.time}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{ins.text}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel
        title={`What failed${failures.length ? ` · ${failures.length}` : ''}`}
        subtitle="Tool calls that returned an error"
      >
        {failures.length === 0 ? (
          <p className="text-[13px] text-ink-3">Nothing failed in this session.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {failures.map((f, i) => (
              <button
                key={`${f.uuid}-${i}`}
                onClick={() => onJump(f.uuid)}
                className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-sunken"
              >
                <span className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-danger text-white">
                  <ToolIcon name={f.name} className="h-2.5 w-2.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="shrink-0 text-[12px] font-medium text-danger">{f.name}</span>
                    <span className="mono truncate text-[12px] text-ink-2">{f.target}</span>
                  </span>
                  {f.why && (
                    <span className="mono mt-0.5 block truncate text-[11px] text-ink-3">
                      {f.why}
                    </span>
                  )}
                </span>
                <span className="num mono shrink-0 pt-px text-[11px] text-ink-3">{f.time}</span>
              </button>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
