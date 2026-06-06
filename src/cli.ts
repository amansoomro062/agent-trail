#!/usr/bin/env node
/**
 * cli.ts - `agenttrail` entry point.
 *
 * Usage:
 *   agenttrail [--dir <path>] [--port <n>] [--no-open] [--help]
 *
 * Scans Claude Code transcripts, then serves the dashboard locally.
 */

import * as path from 'node:path';
import { exec } from 'node:child_process';
import { defaultRoots, detectProvider, parseCorpusMulti, watchedRoots, type CorpusRoots } from './corpus.js';
import { cursorSqliteAvailable } from './cursor.js';
import { defaultConfigPath, loadConfig } from './config.js';
import { expandHome, RootManager, type ResolvedCustomRoot } from './roots.js';
import { defaultWebDist, startServer } from './server.js';
import { TranscriptWatcher } from './watch.js';
import * as fs from 'node:fs';

interface CliOptions {
  /** Explicit Claude transcripts dir from --dir; null means scan defaults. */
  dir: string | null;
  port: number;
  open: boolean;
  help: boolean;
}

const DEFAULT_PORT = 4820;

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { dir: null, port: DEFAULT_PORT, open: true, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--dir':
      case '-d':
        opts.dir = path.resolve(argv[++i] ?? '');
        break;
      case '--port':
      case '-p': {
        const n = Number(argv[++i]);
        if (Number.isInteger(n) && n >= 0 && n <= 65535) opts.port = n;
        else {
          console.error(`agenttrail: invalid port "${argv[i]}"`);
          process.exit(1);
        }
        break;
      }
      case '--no-open':
        opts.open = false;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        if (arg.startsWith('--port=')) {
          const n = Number(arg.slice('--port='.length));
          if (Number.isInteger(n) && n >= 0 && n <= 65535) opts.port = n;
        } else if (arg.startsWith('--dir=')) {
          opts.dir = path.resolve(arg.slice('--dir='.length));
        } else {
          console.error(`agenttrail: unknown option "${arg}" (see --help)`);
          process.exit(1);
        }
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`agenttrail - see what your Claude Code agents did.

Usage:
  agenttrail [options]

Options:
  -d, --dir <path>   Claude Code transcripts dir (default: scan the Claude,
                     Codex and Cursor default roots, whichever exist)
  -p, --port <n>     port to serve on (default: ${DEFAULT_PORT}, falls back to a free port)
      --no-open      don't open the browser automatically
  -h, --help         show this help

Custom roots from ~/.agenttrail/config.json (AGENTTRAIL_CONFIG override) are
always merged in, with or without --dir.
`);
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {
    /* best-effort; ignore failures (headless envs etc.) */
  });
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  // --dir points at one Claude-layout transcripts dir and overrides the
  // default roots; custom roots from the config always merge on top.
  const roots: CorpusRoots = opts.dir !== null ? { claude: opts.dir } : await defaultRoots();
  if (roots.cursor && !(await cursorSqliteAvailable())) {
    console.log('agenttrail: sqlite3 not found, skipping Cursor workspaces');
    delete roots.cursor;
  }

  // custom roots from ~/.agenttrail/config.json (or AGENTTRAIL_CONFIG)
  const config = await loadConfig();
  const customRoots: ResolvedCustomRoot[] = [];
  const builtinPaths = new Set(
    [roots.claude, roots.codex, roots.cursor]
      .filter((p): p is string => typeof p === 'string')
      .map((p) => path.resolve(p)),
  );
  for (const c of config.roots) {
    const resolved = path.resolve(expandHome(c.path));
    if (builtinPaths.has(resolved) || customRoots.some((x) => x.path === resolved)) continue;
    try {
      if (!(await fs.promises.stat(resolved)).isDirectory()) throw new Error('not a directory');
    } catch {
      console.log(`agenttrail: skipping source ${c.path} (not a directory)`);
      continue;
    }
    const provider = c.provider === 'auto' ? await detectProvider(resolved) : c.provider;
    customRoots.push({ path: resolved, provider, ...(c.label ? { label: c.label } : {}) });
    console.log(`agenttrail: added source ${resolved} (${provider})`);
  }
  roots.custom = customRoots;

  process.stderr.write('agenttrail: scanning transcripts …\n');
  const t0 = Date.now();
  const corpus = await parseCorpusMulti(roots);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `agenttrail: found ${corpus.sessions.length} session${corpus.sessions.length === 1 ? '' : 's'} in ${elapsed}s`,
  );
  if (corpus.sessions.length === 0) {
    console.log('agenttrail: no transcripts found - run some agent sessions first,');
    console.log('            or point --dir at a directory containing <project>/<session>.jsonl files.');
  }

  const watcher = new TranscriptWatcher({ roots: watchedRoots(roots), corpus });
  watcher.start();
  if (!watcher.active) {
    console.log('agenttrail: live tail unavailable on this platform, serving a static snapshot');
  }

  const builtin = [
    ...(roots.claude ? [{ path: path.resolve(roots.claude), provider: 'claude' as const }] : []),
    ...(roots.codex ? [{ path: path.resolve(roots.codex), provider: 'codex' as const }] : []),
    ...(roots.cursor ? [{ path: path.resolve(roots.cursor), provider: 'cursor' as const }] : []),
  ];
  const rootManager = new RootManager({
    corpus,
    watcher,
    builtin,
    custom: customRoots,
    configFile: defaultConfigPath(),
  });

  const server = await startServer({
    corpus,
    webDist: defaultWebDist(),
    port: opts.port,
    live: watcher,
    roots: rootManager,
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  const url = `http://localhost:${port}`;
  console.log(`agenttrail: dashboard ready at ${url}`);
  console.log('agenttrail: press Ctrl+C to stop');

  if (opts.open) openBrowser(url);

  const shutdown = () => {
    watcher.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(`agenttrail: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
