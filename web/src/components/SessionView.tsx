import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionDetail, SessionSummary } from '../types';
import { durationText, formatTokens, shortModel, clockTime, relativeTime } from '../format';
import { toolCategory } from '../viz';
import { ActivityStrip, StatRow, StatTile, ToolMixBar } from './charts';
import type { StripBand } from './charts';
import FilesPanel from './FilesPanel';
import SessionDigest from './SessionDigest';
import Timeline from './Timeline';

/** How long the Live pill stays up after the last update for the session. */
const LIVE_PILL_MS = 5000;

/** Derive the strip from the message timeline: one mark per event. */
function buildBands(detail: SessionDetail): StripBand[] {
  const times = detail.messages
    .map((m) => new Date(m.timestamp).getTime())
    .filter((t) => !Number.isNaN(t));
  if (times.length === 0) return [];
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = Math.max(max - min, 1);

  const bands: StripBand[] = [];
  for (const m of detail.messages) {
    const t = new Date(m.timestamp).getTime();
    const at = Number.isNaN(t) ? 0 : (t - min) / span;
    const time = clockTime(m.timestamp);

    if (m.texts.join('').trim()) {
      bands.push({
        category: 'message',
        isError: false,
        at,
        uuid: m.uuid,
        label: `${time} · ${m.role === 'user' ? 'You' : shortModel(m.model ?? 'assistant')}`,
      });
    }
    for (const tool of m.toolUses) {
      bands.push({
        category: toolCategory(tool.name),
        isError: tool.isError === true,
        at,
        uuid: m.uuid,
        label: `${time} · ${tool.name}${tool.isError ? ' - failed' : ''}`,
      });
    }
  }
  return bands;
}

type Tab = 'summary' | 'transcript';

export default function SessionView({
  summary,
  detail,
  loading,
  lastChange,
  onProject,
  onHome,
}: {
  summary: SessionSummary;
  detail: SessionDetail | null;
  loading: boolean;
  /** ms epoch of the last live update for this session, 0 if none. */
  lastChange: number;
  onProject: (path: string) => void;
  onHome: () => void;
}) {
  const [tab, setTab] = useState<Tab>('summary');
  const bands = useMemo(() => (detail ? buildBands(detail) : []), [detail]);

  // The Live pill only shows while updates are actually arriving, then
  // fades out after a quiet stretch. No polling, no blinking.
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!lastChange) {
      setLive(false);
      return;
    }
    setLive(true);
    const t = setTimeout(() => setLive(false), LIVE_PILL_MS);
    return () => clearTimeout(t);
  }, [lastChange]);

  const scrollTo = (uuid: string) => {
    document.getElementById(`ev-${uuid}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  /** From the strip or the digest: switch to the transcript, then scroll. */
  const jump = useCallback((uuid: string) => {
    setTab('transcript');
    // wait for the transcript to mount before looking for the anchor
    requestAnimationFrame(() => requestAnimationFrame(() => scrollTo(uuid)));
  }, []);

  // Cache reads are excluded from the headline figure - see HomeDashboard.
  const tokensIn = summary.tokens?.input ?? 0;
  const tokensOut = summary.tokens?.output ?? 0;
  const tokensCached = summary.tokens
    ? summary.tokens.cacheRead + summary.tokens.cacheCreation
    : 0;
  const tokenHint = `${tokensIn.toLocaleString()} in · ${tokensOut.toLocaleString()} out\n${tokensCached.toLocaleString()} cached (read + creation), excluded from this total`;

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <nav className="mb-3 flex items-center gap-1.5 text-[12px] text-ink-3">
        <button onClick={onHome} className="transition-colors duration-150 hover:text-ink">
          Overview
        </button>
        <span aria-hidden="true">/</span>
        <button
          onClick={() => onProject(summary.projectPath)}
          className="transition-colors duration-150 hover:text-ink"
        >
          {summary.projectName}
        </button>
        <span aria-hidden="true">/</span>
        <span className="mono text-ink-2">{summary.id.slice(0, 8)}</span>
      </nav>

      {/* header card */}
      <div className="card mb-4 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1
                className="truncate text-[19px] font-semibold text-ink"
                style={{ letterSpacing: '-0.4px' }}
              >
                {summary.projectName}
              </h1>
              {live && (
                <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand-wash px-2 py-0.5 text-[11px] font-medium text-brand-text">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
                  Live
                </span>
              )}
            </div>
            {/* everything the old 8-cell strip carried, now one quiet line */}
            <p
              className="mono mt-1 truncate text-[12px] text-ink-3"
              title={`${summary.projectPath}\n${clockTime(summary.startTime)} → ${clockTime(
                summary.endTime,
              )}\n${tokenHint}`}
            >
              {summary.projectPath}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-0.5 text-[12px] text-ink-3">
            <span>{relativeTime(summary.endTime ?? summary.startTime)}</span>
            <span className="mono">{summary.models.map(shortModel).join(' · ') || '—'}</span>
          </div>
        </div>

        {summary.firstUserMessage && (
          <p className="mt-2.5 line-clamp-2 px-4 text-[14px] leading-relaxed text-ink-2">
            {summary.firstUserMessage}
          </p>
        )}

        <div className="px-4 pb-4 pt-4">
          {bands.length > 0 ? (
            <ActivityStrip bands={bands} onJump={jump} />
          ) : (
            <div className="h-12 w-full rounded-lg bg-sunken" />
          )}
        </div>

        <div className="border-t border-line">
          <StatRow>
            <StatTile value={summary.messageCount} label="Messages" />
            <StatTile value={summary.tools.total} label="Tool calls" />
            <StatTile value={summary.filesTouched.length} label="Files" />
            <StatTile value={durationText(summary.startTime, summary.endTime)} label="Duration" />
            <StatTile
              value={formatTokens(tokensIn + tokensOut)}
              label="Tokens"
              hint={tokenHint}
            />
            <StatTile
              value={summary.tools.errors}
              label="Failed"
              tone={summary.tools.errors > 0 ? 'danger' : 'default'}
            />
          </StatRow>
        </div>
      </div>

      {/* tabs */}
      <div className="mb-4 flex items-center gap-1 border-b border-line">
        {(['summary', 'transcript'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-current={tab === t ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium capitalize transition-colors duration-150 ${
              tab === t
                ? 'border-brand text-brand-text'
                : 'border-transparent text-ink-3 hover:text-ink'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
        <div className="flex flex-col gap-4">
          {summary.tools.total > 0 && (
            <div className="card p-4">
              <h2 className="mb-3.5 text-[13px] font-semibold text-ink">Tool activity</h2>
              <ToolMixBar tally={summary.tools} height={12} />
            </div>
          )}
          {loading && <p className="px-1 text-[13px] text-ink-3">Loading…</p>}
          <SessionDigest summary={summary} detail={detail} onJump={jump} />
          <FilesPanel files={summary.filesTouched} />
        </div>
      )}

      {tab === 'transcript' && (
        <div className="card overflow-hidden">
          {loading && <p className="px-4 py-5 text-[13px] text-ink-3">Loading…</p>}
          {!loading && detail && <Timeline key={detail.id} messages={detail.messages} />}
        </div>
      )}
    </div>
  );
}
