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
import { defaultSessionsDir, parseCorpus } from './parser.js';
import { defaultWebDist, startServer } from './server.js';

interface CliOptions {
  dir: string;
  port: number;
  open: boolean;
  help: boolean;
}

const DEFAULT_PORT = 4820;

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { dir: defaultSessionsDir(), port: DEFAULT_PORT, open: true, help: false };
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
  -d, --dir <path>   session transcripts dir (default: ~/.claude/projects)
  -p, --port <n>     port to serve on (default: ${DEFAULT_PORT}, falls back to a free port)
      --no-open      don't open the browser automatically
  -h, --help         show this help
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

  process.stderr.write(`agenttrail: scanning ${opts.dir} …\n`);
  const t0 = Date.now();
  const corpus = await parseCorpus(opts.dir);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `agenttrail: found ${corpus.sessions.length} session${corpus.sessions.length === 1 ? '' : 's'} in ${elapsed}s`,
  );
  if (corpus.sessions.length === 0) {
    console.log('agenttrail: no transcripts found - run some Claude Code sessions first,');
    console.log('            or point --dir at a directory containing <project>/<session>.jsonl files.');
  }

  const server = await startServer({
    corpus,
    webDist: defaultWebDist(),
    port: opts.port,
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  const url = `http://localhost:${port}`;
  console.log(`agenttrail: dashboard ready at ${url}`);
  console.log('agenttrail: press Ctrl+C to stop');

  if (opts.open) openBrowser(url);

  const shutdown = () => {
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
