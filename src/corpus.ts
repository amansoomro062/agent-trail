/**
 * corpus.ts - provider-agnostic corpus assembly.
 *
 * Each provider (claude / codex / cursor) has its own discovery and parsing,
 * but everything normalizes into the same Corpus shape, so the HTTP API and
 * the dashboard treat sessions uniformly. Provider detection is by location:
 * each provider owns its default root, --dir keeps the Claude layout, and
 * custom roots carry an explicit provider (or get sniffed, see detectProvider).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Corpus } from './parser.js';
import { defaultSessionsDir, discoverTranscripts, parseSessionDetail, parseTranscript } from './parser.js';
import { defaultCodexDir, discoverCodexTranscripts, parseCodexSessionDetail, parseCodexTranscript } from './codex.js';
import { defaultCursorDir, discoverCursorDbs, parseCursorSessionDetail, parseCursorWorkspace } from './cursor.js';
import type { ProviderName, SearchIndexEntry, SessionDetail, SessionSummary } from './types.js';
import type { WatchedRoot } from './watch.js';

export interface CorpusRoots {
  claude?: string;
  codex?: string;
  cursor?: string;
  /** Extra user-configured roots, each with its own provider. */
  custom?: Array<{ path: string; provider: ProviderName }>;
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

/** Sniff which provider layout a directory holds, best effort. */
export async function detectProvider(dir: string): Promise<ProviderName> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return 'claude';
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const sub = path.join(dir, e.name);
    // cursor: <workspace-hash>/state.vscdb
    try {
      if ((await fs.promises.stat(path.join(sub, 'state.vscdb'))).isFile()) return 'cursor';
    } catch {
      // not this child
    }
    // codex: <yyyy>/<mm>/<dd>/rollout-*.jsonl
    if (/^\d{4}$/.test(e.name)) {
      try {
        const months = await fs.promises.readdir(sub, { withFileTypes: true });
        if (months.some((m) => m.isDirectory() && /^\d{2}$/.test(m.name))) return 'codex';
      } catch {
        // not this child
      }
    }
  }
  // default: the Claude layout, any <project>/<session>.jsonl tree fits it
  return 'claude';
}

interface ParsedSessions {
  summary: SessionSummary;
  indexEntries: SearchIndexEntry[];
}

/** Parse every transcript under one provider root. Bad files are skipped. */
export async function parseProviderRoot(dir: string, provider: ProviderName): Promise<ParsedSessions[]> {
  const out: ParsedSessions[] = [];
  if (provider === 'claude') {
    for (const file of await discoverTranscripts(dir)) {
      try {
        out.push(await parseTranscript(file, { withMessages: false }));
      } catch {
        // a single bad transcript must not sink the scan
      }
    }
  } else if (provider === 'codex') {
    for (const file of await discoverCodexTranscripts(dir)) {
      try {
        out.push(await parseCodexTranscript(file, { withMessages: false }));
      } catch {
        // same per-file isolation
      }
    }
  } else {
    for (const { db, workspaceDir } of await discoverCursorDbs(dir)) {
      try {
        out.push(...(await parseCursorWorkspace(db, { workspaceDir })));
      } catch {
        // unreadable workspace db: skip, keep scanning
      }
    }
  }
  return out;
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

  const fold = (parsed: ParsedSessions[]) => {
    for (const p of parsed) {
      if (filesById.has(p.summary.id)) continue; // first root wins on id collision
      filesById.set(p.summary.id, p.summary.file);
      sessions.push(p.summary);
      index.push(...p.indexEntries);
    }
  };

  if (roots.claude) fold(await parseProviderRoot(roots.claude, 'claude'));
  if (roots.codex) fold(await parseProviderRoot(roots.codex, 'codex'));
  if (roots.cursor) fold(await parseProviderRoot(roots.cursor, 'cursor'));
  for (const c of roots.custom ?? []) {
    try {
      fold(await parseProviderRoot(c.path, c.provider));
    } catch {
      // an unreadable custom root must not sink the scan
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

/** The live tail watch spec for one provider root. */
export function watchedRootFor(dir: string, provider: ProviderName): WatchedRoot {
  if (provider === 'claude') {
    return {
      dir,
      depth: 2,
      suffix: '.jsonl',
      parse: async (file) => [await parseTranscript(file, { withMessages: false })],
    };
  }
  if (provider === 'codex') {
    return {
      dir,
      depth: 4,
      suffix: '.jsonl',
      parse: async (file) => [await parseCodexTranscript(file, { withMessages: false })],
    };
  }
  return {
    dir,
    depth: 2,
    suffix: '.vscdb',
    parse: (file) => parseCursorWorkspace(file),
  };
}

/** Live tail roots: one per configured provider root. */
export function watchedRoots(roots: CorpusRoots): WatchedRoot[] {
  const out: WatchedRoot[] = [];
  if (roots.claude) out.push(watchedRootFor(roots.claude, 'claude'));
  if (roots.codex) out.push(watchedRootFor(roots.codex, 'codex'));
  if (roots.cursor) out.push(watchedRootFor(roots.cursor, 'cursor'));
  for (const c of roots.custom ?? []) out.push(watchedRootFor(c.path, c.provider));
  return out;
}
