/**
 * watch.ts - live tail of in-progress transcripts.
 *
 * Watches the sessions dir for .jsonl changes with fs.watch(recursive),
 * debounces the write bursts Claude Code produces while streaming, re-parses
 * the changed transcript once writes go quiet, and folds the fresh summary
 * back into the shared corpus. Subscribers get a SessionChange only when the
 * served data actually changed, not on every write.
 *
 * Recursive watch needs macOS, Windows or Node 20+ on Linux. Where it is
 * unavailable the watcher simply never becomes active and the dashboard
 * keeps working as a static snapshot.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Corpus } from './parser.js';
import { parseTranscript } from './parser.js';
import type { SessionSummary } from './types.js';

export interface SessionChange {
  sessionId: string;
  /** Transcript file that changed (absolute path). */
  file: string;
  /** 'added' for a newly discovered transcript, 'updated' otherwise. */
  kind: 'added' | 'updated';
}

export type ChangeListener = (change: SessionChange) => void;

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
  sessionsDir: string;
  corpus: Corpus;
  /** Quiet period after the last write before re-parsing (default 300ms). */
  debounceMs?: number;
}

export class TranscriptWatcher {
  private watcher: fs.FSWatcher | null = null;
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

  /** True while fs.watch is running; false on platforms without support. */
  get active(): boolean {
    return this.watcher !== null;
  }

  subscribe(fn: ChangeListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  start(): void {
    if (this.watcher) return;
    try {
      this.watcher = fs.watch(this.opts.sessionsDir, { recursive: true }, (_event, filename) => {
        if (typeof filename !== 'string') return;
        // transcripts live exactly one level down: <project>/<session>.jsonl
        const parts = filename.split(path.sep);
        if (parts.length !== 2 || !parts[1].endsWith('.jsonl')) return;
        const file = path.join(this.opts.sessionsDir, filename);
        this.debouncer.schedule(file, () => void this.refresh(file));
      });
      this.watcher.on('error', () => this.stop());
    } catch {
      // recursive watch unsupported (or the dir vanished): static mode
      this.watcher = null;
    }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    this.debouncer.dispose();
  }

  /** Re-parse one transcript and fold it into the corpus if it changed. */
  private async refresh(file: string): Promise<void> {
    try {
      await fs.promises.stat(file);
    } catch {
      // deleted mid-flight; keep serving the last good parse
      return;
    }
    let parsed: Awaited<ReturnType<typeof parseTranscript>>;
    try {
      parsed = await parseTranscript(file, { withMessages: false });
    } catch {
      // unreadable right now; the next write triggers another attempt
      return;
    }
    const { summary, indexEntries } = parsed;
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
