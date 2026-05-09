/**
 * watch.ts - live tail of in-progress transcripts.
 *
 * Watches every configured transcript root with fs.watch(recursive),
 * debounces the write bursts agents produce while streaming, re-parses the
 * changed file once writes go quiet (through the root's provider parse
 * function), and folds the fresh summaries back into the shared corpus.
 * Subscribers get a SessionChange only when the served data actually
 * changed, not on every write.
 *
 * Recursive watch needs macOS, Windows or Node 20+ on Linux. Where it is
 * unavailable the watcher simply never becomes active and the dashboard
 * keeps working as a static snapshot.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Corpus } from './parser.js';
import type { SearchIndexEntry, SessionSummary } from './types.js';

export interface SessionChange {
  sessionId: string;
  /** Transcript file that changed (absolute path). */
  file: string;
  /** 'added' for a newly discovered session, 'updated' otherwise. */
  kind: 'added' | 'updated';
}

export type ChangeListener = (change: SessionChange) => void;

/** One transcript root to watch, with the provider's re-parse function. */
export interface WatchedRoot {
  /** Directory to watch recursively. */
  dir: string;
  /** Path segments below dir that make a transcript (claude 2, codex 4, cursor 2). */
  depth: number;
  /** Transcript filename suffix ('.jsonl', '.vscdb'). */
  suffix: string;
  /** Re-parse one changed file into its session(s). */
  parse(file: string): Promise<Array<{ summary: SessionSummary; indexEntries: SearchIndexEntry[] }>>;
}

/** Trailing-edge debouncer keyed by caller-chosen ids (one timer per key). */
export class Debouncer {
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly ms: number) {}

  schedule(key: string, fn: () => void): void {
    const prev = this.timers.get(key);
    if (prev) clearTimeout(prev);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        fn();
      }, this.ms),
    );
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}

/**
 * Stable identity of what the API serves for a session. mtime is excluded:
 * it moves on every write and would fire an event for no visible change.
 */
function summaryFingerprint(s: SessionSummary): string {
  const { mtime, ...rest } = s;
  return JSON.stringify(rest);
}

function byRecency(a: SessionSummary, b: SessionSummary): number {
  const ta = a.endTime ?? '';
  const tb = b.endTime ?? '';
  if (ta !== tb) return ta < tb ? 1 : -1;
  return b.mtime - a.mtime;
}

export interface WatcherOptions {
  roots: WatchedRoot[];
  corpus: Corpus;
  /** Quiet period after the last write before re-parsing (default 300ms). */
  debounceMs?: number;
}

export class TranscriptWatcher {
  private watchers: fs.FSWatcher[] = [];
  private listeners = new Set<ChangeListener>();
  private debouncer: Debouncer;
  /** Fingerprint per session id of the data currently in the corpus. */
  private fingerprints = new Map<string, string>();

  constructor(private readonly opts: WatcherOptions) {
    this.debouncer = new Debouncer(opts.debounceMs ?? 300);
    for (const s of opts.corpus.sessions) {
      this.fingerprints.set(s.id, summaryFingerprint(s));
    }
  }

  /** True while at least one root is being watched. */
  get active(): boolean {
    return this.watchers.length > 0;
  }

  subscribe(fn: ChangeListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  start(): void {
    if (this.watchers.length > 0) return;
    for (const root of this.opts.roots) {
      try {
        const watcher = fs.watch(root.dir, { recursive: true }, (_event, filename) => {
          if (typeof filename !== 'string') return;
          const parts = filename.split(path.sep);
          if (parts.length !== root.depth || !parts[parts.length - 1].endsWith(root.suffix)) return;
          const file = path.join(root.dir, filename);
          this.debouncer.schedule(file, () => void this.refresh(root, file));
        });
        watcher.on('error', () => {
          watcher.close();
          this.watchers = this.watchers.filter((w) => w !== watcher);
        });
        this.watchers.push(watcher);
      } catch {
        // recursive watch unsupported for this root: skip it, keep the rest
      }
    }
  }

  stop(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    this.debouncer.dispose();
  }

  /** Re-parse one changed file and fold its sessions into the corpus. */
  private async refresh(root: WatchedRoot, file: string): Promise<void> {
    try {
      await fs.promises.stat(file);
    } catch {
      // deleted mid-flight; keep serving the last good parse
      return;
    }
    let parsed: Array<{ summary: SessionSummary; indexEntries: SearchIndexEntry[] }>;
    try {
      parsed = await root.parse(file);
    } catch {
      // unreadable right now; the next write triggers another attempt
      return;
    }
    for (const { summary, indexEntries } of parsed) {
      this.fold(summary, indexEntries, file);
    }
  }

  private fold(summary: SessionSummary, indexEntries: SearchIndexEntry[], file: string): void {
    const fp = summaryFingerprint(summary);
    if (this.fingerprints.get(summary.id) === fp) return;

    const corpus = this.opts.corpus;
    const at = corpus.sessions.findIndex((s) => s.id === summary.id);
    const kind: SessionChange['kind'] = at === -1 ? 'added' : 'updated';
    if (at === -1) {
      corpus.sessions.push(summary);
      corpus.filesById.set(summary.id, file);
    } else {
      corpus.sessions[at] = summary;
    }
    corpus.sessions.sort(byRecency);
    corpus.index = corpus.index.filter((e) => e.sessionId !== summary.id).concat(indexEntries);
    this.fingerprints.set(summary.id, fp);

    const change: SessionChange = { sessionId: summary.id, file, kind };
    for (const fn of this.listeners) fn(change);
  }
}
