/**
 * corpus.ts - provider-agnostic corpus assembly.
 *
 * Each provider (claude / codex / cursor) has its own discovery and parsing,
 * but everything normalizes into the same Corpus shape, so the HTTP API and
 * the dashboard treat sessions uniformly. Provider detection is by location:
 * each provider owns its default root, and --dir keeps the Claude layout.
 */

import * as fs from 'node:fs';
import type { Corpus } from './parser.js';
import { defaultSessionsDir, discoverTranscripts, parseSessionDetail, parseTranscript } from './parser.js';
import { defaultCodexDir, discoverCodexTranscripts, parseCodexSessionDetail, parseCodexTranscript } from './codex.js';
import { defaultCursorDir, discoverCursorDbs, parseCursorSessionDetail, parseCursorWorkspace } from './cursor.js';
import type { SearchIndexEntry, SessionDetail, SessionSummary } from './types.js';
import type { WatchedRoot } from './watch.js';

export interface CorpusRoots {
  claude?: string;
  codex?: string;
  cursor?: string;
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Default transcript roots for every provider, filtered to those that exist. */
export async function defaultRoots(): Promise<CorpusRoots> {
  const roots: CorpusRoots = {};
  const claude = defaultSessionsDir();
  const codex = defaultCodexDir();
  const cursor = defaultCursorDir();
  if (await isDir(claude)) roots.claude = claude;
  if (await isDir(codex)) roots.codex = codex;
  if (await isDir(cursor)) roots.cursor = cursor;
  return roots;
}

function byRecency(a: SessionSummary, b: SessionSummary): number {
  const ta = a.endTime ?? '';
  const tb = b.endTime ?? '';
  if (ta !== tb) return ta < tb ? 1 : -1;
  return b.mtime - a.mtime;
}

/** Parse every configured provider root into one merged corpus. */
export async function parseCorpusMulti(roots: CorpusRoots): Promise<Corpus> {
  const sessions: SessionSummary[] = [];
  const filesById = new Map<string, string>();
  const index: SearchIndexEntry[] = [];

  const fold = (parsed: Array<{ summary: SessionSummary; indexEntries: SearchIndexEntry[] }>) => {
    for (const p of parsed) {
      if (filesById.has(p.summary.id)) continue; // first provider wins on id collision
      filesById.set(p.summary.id, p.summary.file);
      sessions.push(p.summary);
      index.push(...p.indexEntries);
    }
  };

  if (roots.claude) {
    for (const file of await discoverTranscripts(roots.claude)) {
      try {
        fold([await parseTranscript(file, { withMessages: false })]);
      } catch {
        // a single bad transcript must not sink the whole scan
      }
    }
  }
  if (roots.codex) {
    for (const file of await discoverCodexTranscripts(roots.codex)) {
      try {
        fold([await parseCodexTranscript(file, { withMessages: false })]);
      } catch {
        // same per-file isolation as above
      }
    }
  }
  if (roots.cursor) {
    for (const { db, workspaceDir } of await discoverCursorDbs(roots.cursor)) {
      try {
        fold(await parseCursorWorkspace(db, { workspaceDir }));
      } catch {
        // unreadable workspace db: skip, keep scanning
      }
    }
  }

  sessions.sort(byRecency);
  return { sessions, filesById, index };
}

/** Parse one session in full, dispatching on the provider of the summary. */
export async function parseSessionDetailFor(corpus: Corpus, id: string): Promise<SessionDetail | null> {
  const summary = corpus.sessions.find((s) => s.id === id);
  const file = corpus.filesById.get(id);
  if (!summary || !file) return null;
  switch (summary.provider) {
    case 'claude':
      return parseSessionDetail(file);
    case 'codex':
      return parseCodexSessionDetail(file);
    case 'cursor':
      return parseCursorSessionDetail(file, id);
  }
}

/** Live tail roots: one per configured provider, with its parse function. */
export function watchedRoots(roots: CorpusRoots): WatchedRoot[] {
  const out: WatchedRoot[] = [];
  if (roots.claude) {
    const dir = roots.claude;
    out.push({
      dir,
      depth: 2,
      suffix: '.jsonl',
      parse: async (file) => [await parseTranscript(file, { withMessages: false })],
    });
  }
  if (roots.codex) {
    const dir = roots.codex;
    out.push({
      dir,
      depth: 4,
      suffix: '.jsonl',
      parse: async (file) => [await parseCodexTranscript(file, { withMessages: false })],
    });
  }
  if (roots.cursor) {
    const dir = roots.cursor;
    out.push({
      dir,
      depth: 2,
      suffix: '.vscdb',
      parse: (file) => parseCursorWorkspace(file),
    });
  }
  return out;
}
