/** Small formatting helpers shared across components. */

export function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function basename(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/**
 * Trailing path segments, e.g. "spec/index.ts". A bare basename is ambiguous -
 * every project has an index.ts - so lists that rank files across projects show
 * enough of the tail to tell them apart.
 */
export function shortPath(p: string, segments = 2): string {
  const parts = p.split('/').filter(Boolean);
  return parts.slice(-segments).join('/');
}

/**
 * Path relative to a project root, e.g. "./web/src/components/".
 * Paths outside the root (a temp dir, another repo) keep enough tail to stay
 * identifiable rather than being forced into a misleading relative form.
 */
export function relativeToRoot(p: string, root: string): string {
  if (root && p.startsWith(root)) {
    const rest = p.slice(root.length).replace(/^\/+/, '');
    return rest ? `./${rest}` : './';
  }
  return shortPath(p, 3);
}

/** Directory portion of a path, without the trailing basename. */
export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '' : p.slice(0, i + 1);
}

/** HH:mm for timeline rows. */
export function clockTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Compact calendar date: "3 Aug". */
export function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Human duration between two timestamps: "2h 14m", "43m", "6d 3h". */
export function durationText(start: string | null, end: string | null): string {
  if (!start || !end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (Number.isNaN(ms) || ms < 0) return '—';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return '<1m';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${min % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/**
 * One-line plain-text preview of a markdown blob - enough to tell whether a
 * collapsed reply is worth opening. Strips the syntax that would otherwise
 * render as noise (#, *, `, >, list bullets, link brackets).
 */
export function previewText(md: string, max = 160): string {
  const flat = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*|__|\*|_|~~/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() + '…' : flat;
}

/** Rough word count, for showing how much text a collapsed reply hides. */
export function wordCount(s: string): number {
  const m = s.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/** Drop the vendor prefix from a model id: "claude-opus-5[1m]" → "opus-5". */
export function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
}
