import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseCorpus } from '../src/parser.js';
import { Debouncer, TranscriptWatcher } from '../src/watch.js';
import type { SessionChange } from '../src/watch.js';
import { tempDir, userEvent, writeTranscript } from './helpers.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Debouncer', () => {
  it('fires once for a burst of schedules on one key', async () => {
    const d = new Debouncer(20);
    let n = 0;
    d.schedule('k', () => {
      n += 1;
    });
    d.schedule('k', () => {
      n += 1;
    });
    d.schedule('k', () => {
      n += 1;
    });
    await sleep(80);
    assert.equal(n, 1, 'only the last schedule runs');
    d.dispose();
  });

  it('keeps keys independent', async () => {
    const d = new Debouncer(20);
    const fired: string[] = [];
    d.schedule('a', () => fired.push('a'));
    d.schedule('b', () => fired.push('b'));
    await sleep(80);
    assert.deepEqual(fired.sort(), ['a', 'b']);
    d.dispose();
  });

  it('dispose cancels pending work', async () => {
    const d = new Debouncer(20);
    let n = 0;
    d.schedule('k', () => {
      n += 1;
    });
    d.dispose();
    await sleep(80);
    assert.equal(n, 0);
  });
});

/**
 * Wait for the next change matching want, while fn produces it. fs.watch
 * needs a beat to arm, so writes happen slightly after subscribing.
 */
async function nextChange(
  watcher: TranscriptWatcher,
  write: () => void,
): Promise<SessionChange> {
  return new Promise<SessionChange>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no change event within 5s')), 5000);
    watcher.subscribe((c) => {
      clearTimeout(timer);
      resolve(c);
    });
    setTimeout(write, 200);
  });
}

describe('TranscriptWatcher', () => {
  it('folds an appended line into the corpus and emits one update', async (t) => {
    const root = tempDir();
    const proj = path.join(root, 'proj');
    const file = writeTranscript(proj, 'sess-live', [
      userEvent({ content: 'start', timestamp: '2026-01-30T10:00:00.000Z' }),
    ]);
    const corpus = await parseCorpus(root);
    const watcher = new TranscriptWatcher({ sessionsDir: root, corpus, debounceMs: 30 });
    watcher.start();
    if (!watcher.active) {
      watcher.stop();
      t.skip('recursive fs.watch is unsupported on this platform');
      return;
    }
    try {
      const change = await nextChange(watcher, () => {
        fs.appendFileSync(
          file,
          JSON.stringify(
            userEvent({ content: 'more work', timestamp: '2026-01-30T10:01:00.000Z' }),
          ) + '\n',
        );
      });
      assert.equal(change.sessionId, 'sess-live');
      assert.equal(change.kind, 'updated');
      const summary = corpus.sessions.find((s) => s.id === 'sess-live');
      assert.equal(summary?.messageCount, 2, 'corpus summary updated in place');
      assert.ok(
        corpus.index.some((e) => e.sessionId === 'sess-live' && e.text === 'more work'),
        'search index picked up the new message',
      );
    } finally {
      watcher.stop();
    }
  });

  it('emits "added" when a brand new transcript appears', async (t) => {
    const root = tempDir();
    writeTranscript(path.join(root, 'proj'), 'sess-old', [userEvent({ content: 'old' })]);
    const corpus = await parseCorpus(root);
    const watcher = new TranscriptWatcher({ sessionsDir: root, corpus, debounceMs: 30 });
    watcher.start();
    if (!watcher.active) {
      watcher.stop();
      t.skip('recursive fs.watch is unsupported on this platform');
      return;
    }
    try {
      const change = await nextChange(watcher, () => {
        writeTranscript(path.join(root, 'proj'), 'sess-new', [userEvent({ content: 'brand new' })]);
      });
      assert.equal(change.sessionId, 'sess-new');
      assert.equal(change.kind, 'added');
      assert.ok(corpus.sessions.some((s) => s.id === 'sess-new'));
      assert.equal(corpus.filesById.get('sess-new'), path.join(root, 'proj', 'sess-new.jsonl'));
    } finally {
      watcher.stop();
    }
  });
});
