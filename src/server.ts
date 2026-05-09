/**
 * server.ts - zero-dependency HTTP server.
 *
 *   GET /api/sessions      → SessionSummary[]  (sorted by recency)
 *   GET /api/sessions/:id  → SessionDetail     (full message timeline)
 *   GET /api/search?q=...  → SearchHit[]       (case-insensitive substring)
 *   GET /api/events        → SSE stream        (session change notifications)
 *   everything else        → static files from web/dist (SPA fallback)
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Corpus } from './parser.js';
import { parseSessionDetailFor } from './corpus.js';
import type { SearchHit } from './types.js';
import type { SessionChange } from './watch.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const MAX_SEARCH_RESULTS = 50;
/** chars of context shown around a search match */
const SNIPPET_RADIUS = 120;
/** default SSE keep-alive interval; browsers drop idle streams around 30-60s */
const SSE_HEARTBEAT_MS = 25_000;

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function makeSnippet(text: string, lowerText: string, lowerQuery: string): string {
  const i = lowerText.indexOf(lowerQuery);
  if (i === -1) return text.slice(0, SNIPPET_RADIUS * 2);
  const start = Math.max(0, i - SNIPPET_RADIUS);
  const end = Math.min(text.length, i + lowerQuery.length + SNIPPET_RADIUS);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

export function searchCorpus(corpus: Corpus, query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];

  for (const s of corpus.sessions) {
    if (hits.length >= MAX_SEARCH_RESULTS) break;
    // match files touched
    for (const f of s.filesTouched) {
      if (f.path.toLowerCase().includes(q)) {
        hits.push({
          sessionId: s.id,
          projectPath: s.projectPath,
          projectName: s.projectName,
          messageUuid: null,
          role: 'file',
          timestamp: s.endTime,
          snippet: `${f.operation}: ${f.path}`,
        });
        break; // one file hit per session is enough
      }
    }
  }

  for (const entry of corpus.index) {
    if (hits.length >= MAX_SEARCH_RESULTS) break;
    const lower = entry.text.toLowerCase();
    if (lower.includes(q)) {
      hits.push({
        sessionId: entry.sessionId,
        projectPath: entry.projectPath,
        projectName: entry.projectName,
        messageUuid: entry.messageUuid,
        role: entry.role,
        timestamp: entry.timestamp,
        snippet: makeSnippet(entry.text, lower, q),
      });
    }
  }
  return hits;
}

export interface ServerOptions {
  corpus: Corpus;
  webDist: string;
  port: number; // 0 → pick a free port
  host?: string;
  /** Live tail source; /api/events is served only when present. */
  live?: { subscribe(fn: (change: SessionChange) => void): () => void };
  /** SSE keep-alive interval in ms (tests shrink this). */
  sseHeartbeatMs?: number;
}

export function defaultWebDist(): string {
  // dist/server.js → <pkg>/web/dist
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', 'web', 'dist');
}

export function startServer(opts: ServerOptions): Promise<http.Server> {
  const { corpus, webDist } = opts;

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const pathname = url.pathname;

        if (pathname === '/api/sessions') {
          sendJson(res, 200, corpus.sessions);
          return;
        }

        const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(pathname);
        if (sessionMatch) {
          const id = decodeURIComponent(sessionMatch[1]);
          const detail = await parseSessionDetailFor(corpus, id);
          if (!detail) {
            sendJson(res, 404, { error: 'session not found' });
            return;
          }
          sendJson(res, 200, detail);
          return;
        }

        if (pathname === '/api/search') {
          const q = url.searchParams.get('q') ?? '';
          sendJson(res, 200, { query: q, results: searchCorpus(corpus, q) });
          return;
        }

        if (pathname === '/api/events') {
          if (!opts.live) {
            sendJson(res, 404, { error: 'not found' });
            return;
          }
          res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            // ask proxies not to buffer the stream
            'x-accel-buffering': 'no',
          });
          res.write(': connected\n\n');
          const live = opts.live;
          const send = (change: SessionChange) => {
            if (!res.destroyed) {
              res.write(`event: session\ndata: ${JSON.stringify(change)}\n\n`);
            }
          };
          const unsubscribe = live.subscribe(send);
          const heartbeat = setInterval(() => {
            if (!res.destroyed) res.write(': heartbeat\n\n');
          }, opts.sseHeartbeatMs ?? SSE_HEARTBEAT_MS);
          req.on('close', () => {
            clearInterval(heartbeat);
            unsubscribe();
          });
          return;
        }

        if (pathname.startsWith('/api/')) {
          sendJson(res, 404, { error: 'not found' });
          return;
        }

        // static files + SPA fallback
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { error: 'method not allowed' });
          return;
        }
        let rel = decodeURIComponent(pathname);
        if (rel === '/') rel = '/index.html';
        // prevent path traversal
        const filePath = path.join(webDist, path.normalize(rel).replace(/^([/\\])+/, ''));
        if (!filePath.startsWith(webDist)) {
          sendJson(res, 403, { error: 'forbidden' });
          return;
        }
        let target = filePath;
        if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
          target = path.join(webDist, 'index.html'); // SPA fallback
        }
        if (!fs.existsSync(target)) {
          sendJson(res, 503, {
            error: 'web dashboard not built',
            hint: 'run `npm run build` (or `npm run build:web`) first',
          });
          return;
        }
        const ext = path.extname(target).toLowerCase();
        res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
        fs.createReadStream(target).pipe(res);
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : 'internal error' });
      }
    })();
  });

  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && opts.port !== 0) {
        // requested port busy - fall back to a free one
        server.listen(0, opts.host);
      } else {
        reject(err);
      }
    };
    server.once('error', onError);
    server.listen(opts.port, opts.host, () => {
      server.removeListener('error', onError);
      resolve(server);
    });
  });
}
