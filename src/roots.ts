/**
 * roots.ts - the source-path registry behind /api/roots.
 *
 * Tracks every active transcript root: built-in defaults (or --dir) plus
 * custom roots the user added, which persist to the config file. Adding a
 * root parses its sessions into the live corpus and starts watching it;
 * removing one evicts its sessions and stops the watch. Nothing on disk is
 * ever deleted here: removal only edits the config file.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Corpus } from './parser.js';
import { detectProvider, parseProviderRoot, watchedRootFor } from './corpus.js';
import type { CustomRoot } from './config.js';
import { saveConfig } from './config.js';
import type { ProviderName } from './types.js';
import type { TranscriptWatcher } from './watch.js';

export interface RootInfo {
  /** Resolved absolute path. */
  path: string;
  provider: ProviderName;
  label?: string;
  /** false for built-in defaults and --dir; those cannot be removed via the API. */
  custom: boolean;
  /** Sessions currently in the corpus from this root. */
  sessions: number;
}

/** Error carrying an HTTP status, mapped to a response by the server. */
export class RootError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Custom root with a concrete provider ('auto' resolved at add/startup). */
export type ResolvedCustomRoot = CustomRoot & { provider: ProviderName };

export interface RootManagerOptions {
  corpus: Corpus;
  watcher: TranscriptWatcher;
  /** Built-in roots (defaults or --dir), as resolved absolute paths. */
  builtin: Array<{ path: string; provider: ProviderName }>;
  /** Custom roots, providers already resolved. */
  custom: ResolvedCustomRoot[];
  /** Config file to persist custom roots to. */
  configFile?: string;
}

/** Expand a leading ~/ so users can type paths the way they think of them. */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

const PROVIDERS = new Set<ProviderName>(['claude', 'codex', 'cursor']);

export class RootManager {
  private readonly corpus: Corpus;
  private readonly watcher: TranscriptWatcher;
  private readonly builtin: Array<{ path: string; provider: ProviderName }>;
  private readonly custom: ResolvedCustomRoot[];
  private readonly configFile?: string;

  constructor(opts: RootManagerOptions) {
    this.corpus = opts.corpus;
    this.watcher = opts.watcher;
    this.builtin = opts.builtin;
    this.custom = opts.custom;
    this.configFile = opts.configFile;
  }

  private sessionsUnder(dir: string): number {
    const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
    return this.corpus.sessions.filter((s) => s.file === dir || s.file.startsWith(prefix)).length;
  }

  list(): RootInfo[] {
    const out: RootInfo[] = this.builtin.map((b) => ({
      path: b.path,
      provider: b.provider,
      custom: false,
      sessions: this.sessionsUnder(b.path),
    }));
    for (const c of this.custom) {
      out.push({
        path: c.path,
        provider: c.provider,
        ...(c.label ? { label: c.label } : {}),
        custom: true,
        sessions: this.sessionsUnder(c.path),
      });
    }
    return out;
  }

  private findRoot(resolved: string): RootInfo | undefined {
    return this.list().find((r) => r.path === resolved);
  }

  /** Add a custom root: validate, detect provider, parse, persist, watch. */
  async add(rawPath: string, provider?: string, label?: string): Promise<RootInfo> {
    const trimmed = rawPath.trim();
    if (!trimmed) throw new RootError(400, 'path is required');
    const resolved = path.resolve(expandHome(trimmed));

    let st: fs.Stats;
    try {
      st = await fs.promises.stat(resolved);
    } catch {
      throw new RootError(400, `path does not exist: ${resolved}`);
    }
    if (!st.isDirectory()) throw new RootError(400, `not a directory: ${resolved}`);

    if (this.findRoot(resolved)) {
      throw new RootError(409, `root already added: ${resolved}`);
    }

    let concrete: ProviderName;
    if (provider === undefined || provider === 'auto') {
      concrete = await detectProvider(resolved);
    } else if (PROVIDERS.has(provider as ProviderName)) {
      concrete = provider as ProviderName;
    } else {
      throw new RootError(400, `unknown provider: ${provider}`);
    }

    const parsed = await parseProviderRoot(resolved, concrete);
    this.watcher.ingest(parsed);
    this.watcher.addRoot(watchedRootFor(resolved, concrete));

    this.custom.push({ path: resolved, provider: concrete, ...(label?.trim() ? { label: label.trim() } : {}) });
    await this.persist();

    return {
      path: resolved,
      provider: concrete,
      ...(label?.trim() ? { label: label.trim() } : {}),
      custom: true,
      sessions: parsed.length,
    };
  }

  /** Remove a custom root: edit the config, stop watching, evict sessions. */
  async remove(rawPath: string): Promise<RootInfo> {
    const resolved = path.resolve(expandHome(rawPath.trim()));
    if (this.builtin.some((b) => b.path === resolved)) {
      throw new RootError(409, 'built-in roots cannot be removed');
    }
    const at = this.custom.findIndex((c) => c.path === resolved);
    if (at === -1) throw new RootError(404, `not a custom root: ${resolved}`);

    const [removed] = this.custom.splice(at, 1);
    await this.persist();
    this.watcher.removeRoot(resolved);
    this.watcher.evict(resolved);

    return {
      path: removed.path,
      provider: removed.provider,
      ...(removed.label ? { label: removed.label } : {}),
      custom: true,
      sessions: 0,
    };
  }

  private async persist(): Promise<void> {
    if (!this.configFile) return;
    await saveConfig({ roots: this.custom }, this.configFile);
  }
}
