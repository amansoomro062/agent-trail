import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';

import { loadConfig, saveConfig, defaultConfigPath } from '../src/config.js';
import { detectProvider, parseCorpusMulti, watchedRoots } from '../src/corpus.js';
import { RootManager } from '../src/roots.js';
import { startServer } from '../src/server.js';
import { TranscriptWatcher } from '../src/watch.js';
import type { SessionChange } from '../src/watch.js';
import type { SessionSummary } from '../src/types.js';
import { tempDir, userEvent, writeTranscript } from './helpers.js';

describe('config file', () => {
  it('round-trips roots through save and load', async () => {
    const file = path.join(tempDir(), 'cfg', 'config.json');
    await saveConfig({ roots: [{ path: '/x/transcripts', provider: 'codex', label: 'backup' }] }, file);
    const config = await loadConfig(file);
    assert.deepEqual(config, { roots: [{ path: '/x/transcripts', provider: 'codex', label: 'backup' }] });
    // the parent dir was created on first save
    assert.ok(fs.existsSync(path.dirname(file)));
  });

  it('treats a missing or corrupt config as no roots', async () => {
    const dir = tempDir();
    assert.deepEqual(await loadConfig(path.join(dir, 'nope.json')), { roots: [] });
    const corrupt = path.join(dir, 'config.json');
    fs.writeFileSync(corrupt, 'not json at all {{{');
    assert.deepEqual(await loadConfig(corrupt), { roots: [] });
    fs.writeFileSync(corrupt, '{"roots": "nope"}');
    assert.deepEqual(await loadConfig(corrupt), { roots: [] });
  });

  it('skips malformed root entries and defaults provider to auto', async () => {
    const file = path.join(tempDir(), 'config.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        roots: [
          { path: '/ok' },
          { path: '/bad-provider', provider: 'emacs' },
          { provider: 'claude' },
          'junk',
        ],
      }),
    );
    assert.deepEqual(await loadConfig(file), {
      roots: [
        { path: '/ok', provider: 'auto' },
        { path: '/bad-provider', provider: 'auto' },
      ],
    });
  });

  it('honors the AGENTTRAIL_CONFIG override', () => {
    const prev = process.env.AGENTTRAIL_CONFIG;
    process.env.AGENTTRAIL_CONFIG = '/tmp/agenttrail-test-config.json';
    try {
      assert.equal(defaultConfigPath(), '/tmp/agenttrail-test-config.json');
    } finally {
      if (prev === undefined) delete process.env.AGENTTRAIL_CONFIG;
      else process.env.AGENTTRAIL_CONFIG = prev;
    }
  });
});

describe('detectProvider', () => {
  it('sniffs the layout of each provider root', async () => {
    const root = tempDir();

    const claudeDir = path.join(root, 'claude');
    writeTranscript(path.join(claudeDir, 'proj'), 'sess', [userEvent({ content: 'x' })]);
    assert.equal(await detectProvider(claudeDir), 'claude');

    const codexDir = path.join(root, 'codex');
    fs.mkdirSync(path.join(codexDir, '2026', '04', '10'), { recursive: true });
    assert.equal(await detectProvider(codexDir), 'codex');

    const cursorDir = path.join(root, 'cursor');
    fs.mkdirSync(path.join(cursorDir, 'deadbeefhash'), { recursive: true });
    fs.writeFileSync(path.join(cursorDir, 'deadbeefhash', 'state.vscdb'), '');
    assert.equal(await detectProvider(cursorDir), 'cursor');
  });
});

interface ApiSetup {
  server: Awaited<ReturnType<typeof startServer>>;
  watcher: TranscriptWatcher;
  port: number;
  configFile: string;
  claudeRoot: string;
  tmp: string;
  changes: SessionChange[];
  close: () => Promise<void>;
}

async function apiSetup(): Promise<ApiSetup> {
  const tmp = tempDir();
  const configFile = path.join(tmp, 'agenttrail', 'config.json');
  const claudeRoot = path.join(tmp, 'claude-default');
  writeTranscript(path.join(claudeRoot, 'proj'), 'sess-1', [userEvent({ content: 'default session' })]);

  const corpus = await parseCorpusMulti({ claude: claudeRoot });
  const watcher = new TranscriptWatcher({ roots: watchedRoots({ claude: claudeRoot }), corpus });
  const changes: SessionChange[] = [];
  watcher.subscribe((c) => changes.push(c));
  const manager = new RootManager({
    corpus,
    watcher,
    builtin: [{ path: path.resolve(claudeRoot), provider: 'claude' }],
    custom: [],
    configFile,
  });
  const server = await startServer({ corpus, webDist: path.join(tmp, 'no-dist'), port: 0, roots: manager });
  const { port } = server.address() as AddressInfo;
  return {
    server,
    watcher,
    port,
    configFile,
    claudeRoot,
    tmp,
    changes,
    close: () => {
      watcher.stop();
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const getJson = async (port: number, p: string): Promise<{ status: number; body: any }> => {
  const res = await fetch(`http://127.0.0.1:${port}${p}`);
  return { status: res.status, body: await res.json() };
};

const send = async (port: number, method: string, body: unknown): Promise<{ status: number; body: any }> => {
  const res = await fetch(`http://127.0.0.1:${port}/api/roots`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

describe('roots API', () => {
  it('lists built-in roots, adds a custom one, and its sessions appear', async () => {
    const s = await apiSetup();
    try {
      const listed = await getJson(s.port, '/api/roots');
      assert.equal(listed.status, 200);
      assert.equal(listed.body.roots.length, 1);
      assert.equal(listed.body.roots[0].custom, false);
      assert.equal(listed.body.roots[0].provider, 'claude');
      assert.equal(listed.body.roots[0].sessions, 1);

      // a second claude-layout dir the user "adds"
      const extra = path.join(s.tmp, 'extra');
      writeTranscript(path.join(extra, 'other-proj'), 'extra-sess', [
        userEvent({ content: 'session from the added root' }),
      ]);
      const added = await send(s.port, 'POST', { path: extra });
      assert.equal(added.status, 201);
      assert.equal(added.body.root.custom, true);
      assert.equal(added.body.root.provider, 'claude');
      assert.equal(added.body.root.sessions, 1);

      const sessions = await getJson(s.port, '/api/sessions');
      const ids = sessions.body.map((x: SessionSummary) => x.id);
      assert.ok(ids.includes('extra-sess'), 'added root sessions are in the corpus');

      // the live corpus notified subscribers, so dashboards refetch
      assert.ok(s.changes.some((c) => c.sessionId === 'extra-sess' && c.kind === 'added'));

      // persisted to the config file
      const config = await loadConfig(s.configFile);
      assert.deepEqual(config.roots, [{ path: path.resolve(extra), provider: 'claude' }]);
    } finally {
      await s.close();
    }
  });

  it('rejects duplicates, bad paths, non-directories and bad providers', async () => {
    const s = await apiSetup();
    try {
      const dup = await send(s.port, 'POST', { path: s.claudeRoot });
      assert.equal(dup.status, 409);
      assert.match(dup.body.error, /already added/);

      const missing = await send(s.port, 'POST', { path: path.join(s.tmp, 'does-not-exist') });
      assert.equal(missing.status, 400);
      assert.match(missing.body.error, /does not exist/);

      const filePath = path.join(s.tmp, 'a-file.txt');
      fs.writeFileSync(filePath, 'x');
      const notDir = await send(s.port, 'POST', { path: filePath });
      assert.equal(notDir.status, 400);
      assert.match(notDir.body.error, /not a directory/);

      const badProvider = await send(s.port, 'POST', { path: s.tmp, provider: 'emacs' });
      assert.equal(badProvider.status, 400);
      assert.match(badProvider.body.error, /unknown provider/);

      const noPath = await send(s.port, 'POST', { provider: 'claude' });
      assert.equal(noPath.status, 400);
    } finally {
      await s.close();
    }
  });

  it('sniffs the provider of an added codex-layout dir', async () => {
    const s = await apiSetup();
    try {
      const codexDir = path.join(s.tmp, 'codex-backup');
      writeTranscript(path.join(codexDir, '2026', '04', '10'), 'rollout-x', [
        {
          timestamp: '2026-04-10T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'codex-extra', timestamp: '2026-04-10T10:00:00.000Z', cwd: '/x' },
        },
      ]);
      const added = await send(s.port, 'POST', { path: codexDir });
      assert.equal(added.status, 201);
      assert.equal(added.body.root.provider, 'codex');
      assert.equal(added.body.root.sessions, 1);
    } finally {
      await s.close();
    }
  });

  it('removes custom roots, keeps built-ins, and evicts sessions', async () => {
    const s = await apiSetup();
    try {
      const extra = path.join(s.tmp, 'extra');
      writeTranscript(path.join(extra, 'other-proj'), 'extra-sess', [
        userEvent({ content: 'session from the added root' }),
      ]);
      await send(s.port, 'POST', { path: extra });

      // built-in removal is rejected
      const builtin = await send(s.port, 'DELETE', { path: s.claudeRoot });
      assert.equal(builtin.status, 409);
      assert.match(builtin.body.error, /built-in/);

      // unknown custom root 404s
      const unknown = await send(s.port, 'DELETE', { path: path.join(s.tmp, 'never-added') });
      assert.equal(unknown.status, 404);

      const removed = await send(s.port, 'DELETE', { path: extra });
      assert.equal(removed.status, 200);
      assert.equal(removed.body.removed.path, path.resolve(extra));

      const sessions = await getJson(s.port, '/api/sessions');
      const ids = sessions.body.map((x: SessionSummary) => x.id);
      assert.ok(!ids.includes('extra-sess'), 'evicted from the corpus');
      assert.ok(ids.includes('sess-1'), 'built-in root untouched');
      assert.ok(s.changes.some((c) => c.sessionId === 'extra-sess' && c.kind === 'removed'));

      // removal only edited the config: the transcript file is still on disk
      assert.ok(fs.existsSync(path.join(extra, 'other-proj', 'extra-sess.jsonl')));
      const config = await loadConfig(s.configFile);
      assert.deepEqual(config.roots, []);
    } finally {
      await s.close();
    }
  });

  it('returns 404 for /api/roots when no manager is configured', async () => {
    const tmp = tempDir();
    writeTranscript(path.join(tmp, 'proj'), 'sess-1', [userEvent({ content: 'x' })]);
    const corpus = await parseCorpusMulti({ claude: tmp });
    const server = await startServer({ corpus, webDist: path.join(tmp, 'no-dist'), port: 0 });
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/api/roots`);
      assert.equal(res.status, 404);
      await res.text();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
