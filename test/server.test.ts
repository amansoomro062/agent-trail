import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';

import { parseCorpus } from '../src/parser.js';
import { searchCorpus, startServer } from '../src/server.js';
import type { SessionChange } from '../src/watch.js';
import { assistantEvent, tempDir, textBlock, toolUse, userEvent, writeTranscript } from './helpers.js';

async function corpusWith(entries: unknown[], name = 'sess-1') {
  const root = tempDir();
  writeTranscript(path.join(root, 'proj'), name, entries);
  return parseCorpus(root);
}

describe('searchCorpus', () => {
  it('returns nothing for an empty or whitespace query', async () => {
    const corpus = await corpusWith([userEvent({ content: 'anything at all' })]);
    assert.deepEqual(searchCorpus(corpus, ''), []);
    assert.deepEqual(searchCorpus(corpus, '   '), []);
  });

  it('matches message text case-insensitively', async () => {
    const corpus = await corpusWith([userEvent({ content: 'Fix the RateLimiter middleware' })]);
    const hits = searchCorpus(corpus, 'ratelimiter');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].role, 'user');
    assert.equal(hits[0].sessionId, 'sess-1');
    assert.ok(hits[0].snippet.includes('RateLimiter'));
  });

  it('searches assistant messages too', async () => {
    const corpus = await corpusWith([
      assistantEvent({ id: 'm1', content: [textBlock('I rewrote the sliding window log')] }),
    ]);
    const hits = searchCorpus(corpus, 'sliding window');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].role, 'assistant');
  });

  it('surrounds a match with context and ellipses', async () => {
    const filler = 'z'.repeat(400);
    const corpus = await corpusWith([userEvent({ content: `${filler} NEEDLE ${filler}` })]);
    const [hit] = searchCorpus(corpus, 'needle');
    assert.ok(hit.snippet.startsWith('…'), 'leading ellipsis when context is clipped');
    assert.ok(hit.snippet.endsWith('…'), 'trailing ellipsis when context is clipped');
    assert.ok(hit.snippet.includes('NEEDLE'));
    // 120 chars either side plus the match and two ellipses
    assert.ok(hit.snippet.length < 300);
  });

  it('matches touched file paths and reports them as file hits', async () => {
    const corpus = await corpusWith([
      assistantEvent({
        id: 'm1',
        content: [toolUse('t1', 'Edit', { file_path: '/proj/src/middleware/rateLimit.ts' })],
      }),
    ]);
    const hits = searchCorpus(corpus, 'middleware');
    const fileHits = hits.filter((h) => h.role === 'file');
    assert.equal(fileHits.length, 1);
    assert.equal(fileHits[0].messageUuid, null);
    assert.equal(fileHits[0].snippet, 'edited: /proj/src/middleware/rateLimit.ts');
  });

  it('reports at most one file hit per session', async () => {
    const corpus = await corpusWith([
      assistantEvent({
        id: 'm1',
        content: [
          toolUse('t1', 'Edit', { file_path: '/proj/src/alpha.ts' }),
          toolUse('t2', 'Edit', { file_path: '/proj/src/beta.ts' }),
          toolUse('t3', 'Edit', { file_path: '/proj/src/gamma.ts' }),
        ],
      }),
    ]);
    const fileHits = searchCorpus(corpus, '/proj/src').filter((h) => h.role === 'file');
    assert.equal(fileHits.length, 1);
  });

  it('caps results at 50', async () => {
    const entries = Array.from({ length: 80 }, (_, i) =>
      userEvent({ content: `needle occurrence number ${i}` }),
    );
    const corpus = await corpusWith(entries);
    assert.equal(searchCorpus(corpus, 'needle').length, 50);
  });

  it('carries project identity onto every hit', async () => {
    const corpus = await corpusWith([userEvent({ content: 'find me' })]);
    const [hit] = searchCorpus(corpus, 'find me');
    assert.equal(hit.projectName, 'demo');
    assert.equal(hit.projectPath, '/Users/dev/code/demo');
    assert.ok(hit.timestamp);
  });
});

describe('SSE /api/events', () => {
  it('streams injected changes with the right headers and a heartbeat', async () => {
    const corpus = await corpusWith([userEvent({ content: 'hi' })]);
    let emit: ((change: SessionChange) => void) | undefined;
    let unsubscribed = false;
    const live = {
      subscribe(fn: (change: SessionChange) => void) {
        emit = fn;
        return () => {
          unsubscribed = true;
        };
      },
    };
    const server = await startServer({
      corpus,
      webDist: path.join(tempDir(), 'no-dist'),
      port: 0,
      live,
      sseHeartbeatMs: 30,
    });
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/api/events`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
      assert.equal(res.headers.get('cache-control'), 'no-cache, no-transform');
      assert.ok(res.body, 'stream body present');

      // accumulate the stream in the background, then poll the buffer
      const decoder = new TextDecoder();
      let acc = '';
      const reader = res.body.getReader();
      const pump = (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            acc += decoder.decode(value, { stream: true });
          }
        } catch {
          // cancelled below; nothing to do
        }
      })();
      const readUntil = async (needle: string, timeoutMs = 2000) => {
        const deadline = Date.now() + timeoutMs;
        while (!acc.includes(needle)) {
          assert.ok(
            Date.now() < deadline,
            `timed out waiting for ${JSON.stringify(needle)} in ${JSON.stringify(acc)}`,
          );
          await new Promise((r) => setTimeout(r, 10));
        }
      };

      await readUntil(': connected');
      assert.ok(emit, 'client subscribed');
      emit({ sessionId: 'sess-1', file: '/tmp/sess-1.jsonl', kind: 'updated' });
      await readUntil('event: session');
      await readUntil('"sessionId":"sess-1"');
      await readUntil(': heartbeat');

      await reader.cancel();
      await pump;
      const deadline = Date.now() + 1000;
      while (!unsubscribed && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(unsubscribed, 'disconnect unsubscribes the live listener');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('returns 404 when no live source is configured', async () => {
    const corpus = await corpusWith([userEvent({ content: 'hi' })]);
    const server = await startServer({
      corpus,
      webDist: path.join(tempDir(), 'no-dist'),
      port: 0,
    });
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/api/events`);
      assert.equal(res.status, 404);
      await res.text();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
