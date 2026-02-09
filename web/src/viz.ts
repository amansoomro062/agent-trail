/**
 * Visualization parameters - the one place chart color is defined.
 *
 * The categorical slots are the validated reference palette, assigned to tool
 * categories in fixed order and never cycled. Both modes were checked with the
 * palette validator against this app's actual chart surfaces (#ffffff light,
 * #1c1d21 dark):
 *
 *   light  worst adjacent CVD ΔE 9.1 · normal-vision ΔE 19.6 · 3 slots <3:1
 *   dark   worst adjacent CVD ΔE 8.4 · normal-vision ΔE 19.3 · all ≥3:1
 *
 * The three light slots below 3:1 (read/search/task) trigger the relief rule:
 * every colored mark in this UI sits beside a visible text label with its
 * value, so identity is never carried by color alone.
 */

import type { ToolCategory, ToolTally } from './types';

export const TOOL_CATEGORIES: ToolCategory[] = ['edit', 'command', 'read', 'search', 'task'];

interface CategoryMeta {
  /** Plural label used in legends. */
  label: string;
  /** Singular, for counts of one. */
  one: string;
  /** CSS custom property holding the mode-appropriate hex. */
  varName: string;
}

export const CATEGORY: Record<ToolCategory, CategoryMeta> = {
  edit: { label: 'edits', one: 'edit', varName: '--cat-edit' },
  command: { label: 'commands', one: 'command', varName: '--cat-command' },
  read: { label: 'reads', one: 'read', varName: '--cat-read' },
  search: { label: 'searches', one: 'search', varName: '--cat-search' },
  task: { label: 'tasks', one: 'task', varName: '--cat-task' },
};

export const categoryColor = (c: ToolCategory): string => `var(${CATEGORY[c].varName})`;

/** Map a tool name to its category. Mirrors toolCategory() in src/parser.ts. */
export function toolCategory(name: string): ToolCategory {
  switch (name) {
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'edit';
    case 'Bash':
    case 'BashOutput':
    case 'KillShell':
      return 'command';
    case 'Read':
      return 'read';
    case 'Grep':
    case 'Glob':
    case 'WebSearch':
    case 'WebFetch':
      return 'search';
    default:
      return 'task';
  }
}

/** Non-zero category segments of a tally, in fixed slot order. */
export function segments(tally: ToolTally): Array<{ key: ToolCategory; value: number }> {
  return TOOL_CATEGORIES.map((key) => ({ key, value: tally[key] })).filter((s) => s.value > 0);
}

export const emptyTally = (): ToolTally => ({
  edit: 0,
  command: 0,
  read: 0,
  search: 0,
  task: 0,
  errors: 0,
  total: 0,
});

/** Sequential blue ramp for the activity heatmap (magnitude, light → dark). */
export const HEAT_STEPS = [
  'var(--heat-0)',
  'var(--heat-1)',
  'var(--heat-2)',
  'var(--heat-3)',
  'var(--heat-4)',
];

/** Bucket a value into a heat step. `max` is the scale ceiling. */
export function heatStep(value: number, max: number): string {
  if (value <= 0) return HEAT_STEPS[0];
  const ratio = value / Math.max(max, 1);
  if (ratio > 0.75) return HEAT_STEPS[4];
  if (ratio > 0.5) return HEAT_STEPS[3];
  if (ratio > 0.25) return HEAT_STEPS[2];
  return HEAT_STEPS[1];
}
