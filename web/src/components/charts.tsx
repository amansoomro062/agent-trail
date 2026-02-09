/**
 * Chart components. Color roles come from viz.ts; nothing here picks a hex.
 *
 * Shared rules (see DESIGN.md § Charts):
 *  - stacked segments carry a 2px surface gap so adjacent fills never touch
 *  - every series has a legend entry with a visible label AND its value, which
 *    is what satisfies the relief rule for the light slots under 3:1
 *  - values are read on hover, never estimated off an axis
 */

import type { ReactNode } from 'react';
import type { ToolCategory, ToolTally } from '../types';
import { CATEGORY, categoryColor, heatStep, segments } from '../viz';
import { Swatch, Tooltip, useTooltip } from './Tooltip';

/* ---------------------------------------------------------------- stat tile */

export function StatTile({
  value,
  label,
  tone = 'default',
  hint,
}: {
  value: string | number;
  label: string;
  tone?: 'default' | 'danger' | 'brand';
  hint?: string;
}) {
  const color =
    tone === 'danger' ? 'text-danger' : tone === 'brand' ? 'text-brand-text' : 'text-ink';
  return (
    <div className="min-w-0 flex-1 px-4 py-3" title={hint}>
      {/* standalone figures use proportional numerals, not tabular */}
      <div className={`text-[26px] font-semibold leading-none ${color}`} style={{ letterSpacing: '-0.8px' }}>
        {value}
      </div>
      <div className="eyebrow mt-1.5 truncate">{label}</div>
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <div className="flex divide-x divide-line">{children}</div>;
}

/* ------------------------------------------------------------- tool mix bar */

/**
 * Horizontal stacked bar of tool activity, with a labelled legend beneath.
 * Used for the whole-corpus mix on the dashboard and per-session summaries.
 */
export function ToolMixBar({ tally, height = 10 }: { tally: ToolTally; height?: number }) {
  const { tip, show, hide } = useTooltip();
  const segs = segments(tally);
  const total = segs.reduce((a, s) => a + s.value, 0);

  if (total === 0) {
    return <p className="text-[13px] text-ink-3">No tool calls recorded.</p>;
  }

  return (
    <div>
      <div
        className="flex w-full overflow-hidden rounded-full"
        style={{ height, background: 'var(--sunken)' }}
      >
        {segs.map((s, i) => {
          const pct = (s.value / total) * 100;
          return (
            <div
              key={s.key}
              className="grow-x h-full transition-opacity duration-150 hover:opacity-80"
              style={{
                width: `${pct}%`,
                background: categoryColor(s.key),
                animationDelay: `${i * 55}ms`,
                // 2px surface gap between adjacent fills
                marginLeft: i === 0 ? 0 : 2,
              }}
              onMouseMove={(e) =>
                show(
                  e,
                  <span className="flex items-center gap-1.5">
                    <Swatch color={categoryColor(s.key)} />
                    {s.value.toLocaleString()} {s.value === 1 ? CATEGORY[s.key].one : CATEGORY[s.key].label}
                    <span className="text-ink-3">· {pct.toFixed(0)}%</span>
                  </span>,
                )
              }
              onMouseLeave={hide}
            />
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {segs.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[12px]">
            <Swatch color={categoryColor(s.key)} />
            <span className="text-ink-2">{CATEGORY[s.key].label}</span>
            <span className="num font-medium text-ink">{s.value.toLocaleString()}</span>
          </span>
        ))}
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

/** Compact fingerprint bar - no legend, used inside dense list rows. */
export function MixSpark({ tally, className = '' }: { tally: ToolTally; className?: string }) {
  const segs = segments(tally);
  const total = segs.reduce((a, s) => a + s.value, 0);
  if (total === 0) {
    return <div className={`h-1 rounded-full bg-sunken ${className}`} />;
  }
  return (
    <div className={`flex h-1 overflow-hidden rounded-full bg-sunken ${className}`}>
      {segs.map((s, i) => (
        <div
          key={s.key}
          className="h-full"
          style={{
            width: `${(s.value / total) * 100}%`,
            background: categoryColor(s.key),
            marginLeft: i === 0 ? 0 : 1.5,
          }}
        />
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- bar list */

export interface BarItem {
  label: string;
  sub?: string;
  value: number;
  color?: string;
  onClick?: () => void;
}

/** Ranked horizontal bars - the right form for "which of these is biggest". */
export function BarList({ items, unit = '' }: { items: BarItem[]; unit?: string }) {
  const { tip, show, hide } = useTooltip();
  const max = Math.max(...items.map((i) => i.value), 1);

  if (items.length === 0) {
    return <p className="text-[13px] text-ink-3">Nothing to show yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <button
          key={`${item.label}-${i}`}
          onClick={item.onClick}
          // NOT `disabled` - Chrome suppresses mouse events on disabled
          // controls, which would kill the hover tooltip on non-clickable rows.
          className={`group -mx-2 block w-full rounded-md px-2 py-1 text-left transition-colors duration-150 hover:bg-sunken ${
            item.onClick ? '' : 'cursor-default'
          }`}
          onMouseMove={(e) =>
            show(
              e,
              <span>
                <span className="font-medium">{item.label}</span>
                {item.sub && <span className="text-ink-3"> · {item.sub}</span>}
                <span className="text-ink-3">
                  {' '}
                  - {item.value.toLocaleString()} {unit}
                </span>
              </span>,
            )
          }
          onMouseLeave={hide}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="mono truncate text-[12px] text-ink-2 group-hover:text-ink">
              {item.label}
            </span>
            <span className="num shrink-0 text-[12px] font-medium text-ink">
              {item.value.toLocaleString()}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
            <div
              className="grow-x h-full rounded-full"
              style={{
                width: `${(item.value / max) * 100}%`,
                background: item.color ?? 'var(--cat-edit)',
                animationDelay: `${i * 40}ms`,
              }}
            />
          </div>
        </button>
      ))}
      <Tooltip tip={tip} />
    </div>
  );
}

/* ------------------------------------------------------------------ heatmap */

export interface HeatCell {
  date: Date;
  key: string;
  value: number;
}

/**
 * Calendar heatmap of sessions per day. Sequential encoding: one hue,
 * light → dark, with the zero step receding into the page.
 */
export function Heatmap({ cells, weeks }: { cells: Map<string, number>; weeks: number }) {
  const { tip, show, hide } = useTooltip();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // wind back to the most recent Sunday so columns are whole weeks
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - end.getDay()));
  const start = new Date(end);
  start.setDate(start.getDate() - (weeks * 7 - 1));

  const max = Math.max(...cells.values(), 1);
  const columns: Date[][] = [];
  const cursor = new Date(start);
  for (let w = 0; w < weeks; w++) {
    const col: Date[] = [];
    for (let d = 0; d < 7; d++) {
      col.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    columns.push(col);
  }

  const keyOf = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  return (
    <div>
      <div className="flex gap-[3px] overflow-x-auto pb-1">
        {columns.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-[3px]">
            {col.map((d) => {
              const future = d > today;
              const value = cells.get(keyOf(d)) ?? 0;
              return (
                <div
                  key={d.toISOString()}
                  className="h-[11px] w-[11px] rounded-[3px] transition-transform duration-100 hover:scale-[1.35] hover:ring-1 hover:ring-ink-3"
                  style={{
                    background: future ? 'transparent' : heatStep(value, max),
                    opacity: future ? 0 : 1,
                  }}
                  onMouseMove={(e) =>
                    !future &&
                    show(
                      e,
                      <span>
                        <span className="font-medium">
                          {value} {value === 1 ? 'session' : 'sessions'}
                        </span>
                        <span className="text-ink-3">
                          {' '}
                          · {d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                      </span>,
                    )
                  }
                  onMouseLeave={hide}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex items-center gap-1.5">
        <span className="text-[11px] text-ink-3">Less</span>
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="h-[11px] w-[11px] rounded-[3px]"
            style={{ background: `var(--heat-${i})` }}
          />
        ))}
        <span className="text-[11px] text-ink-3">More</span>
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

/* ----------------------------------------------------------- activity strip */

export interface StripBand {
  category: ToolCategory | 'message';
  isError: boolean;
  /** 0-1 position across the session's duration. */
  at: number;
  uuid: string;
  label: string;
}

/**
 * The shape of a session over time: one tick per event, positioned by
 * timestamp, colored by tool category. Clicking scrolls the transcript.
 */
export function ActivityStrip({
  bands,
  onJump,
}: {
  bands: StripBand[];
  onJump: (uuid: string) => void;
}) {
  const { tip, show, hide } = useTooltip();
  if (bands.length === 0) return null;

  return (
    <div>
      <div className="relative h-12 w-full overflow-hidden rounded-lg bg-sunken">
        {bands.map((b, i) => (
          <button
            key={`${b.uuid}-${i}`}
            onClick={() => onJump(b.uuid)}
            aria-label={b.label}
            className="absolute top-0 h-full transition-opacity duration-100 hover:opacity-70"
            style={{
              left: `${b.at * 100}%`,
              width: 3,
              background:
                b.category === 'message'
                  ? 'var(--ink-3)'
                  : b.isError
                    ? 'var(--danger)'
                    : categoryColor(b.category),
              // errors and your own turns run full height; tool calls sit lower
              height: b.category === 'message' || b.isError ? '100%' : '58%',
              top: b.category === 'message' || b.isError ? 0 : '42%',
            }}
            onMouseMove={(e) => show(e, b.label)}
            onMouseLeave={hide}
          />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-ink-3">
        Session timeline - click any mark to jump to it.
      </p>
      <Tooltip tip={tip} />
    </div>
  );
}
