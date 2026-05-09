import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  discoverCursorDbs,
  parseCursorSessionDetail,
  parseCursorWorkspace,
} from '../src/cursor.js';
import { tempDir } from './helpers.js';

const execFileAsync = promisify(execFile);
const SQLITE3 = 'sqlite3';

/** Escape a JS string for embedding in a single-quoted SQL literal. */
const sql = (s: string) => s.replace(/'/g, "''");

async function run(db: string, ...statements: string[]): Promise<void> {
  await execFileAsync(SQLITE3, [db, ...statements]);
}

const COMPOSER_DATA = JSON.stringify({
  allComposers: [
    {
      type: 'head',
      composerId: 'comp-1',
      name: 'Refactor the parser',
      createdAt: 1751457615336,
      lastUpdatedAt: 1751488402903,
      unifiedMode: 'agent',
    },
    { type: 'head', composerId: 'comp-2', createdAt: 1751400225509, unifiedMode: 'chat' },
  ],
  selectedComposerIds: ['comp-1'],
});

const BUBBLES: Array<[string, string]> = [
  ['bubbleId:comp-1:b1', JSON.stringify({ type: 'user', text: 'make it faster', createdAt: 1751457620000 })],
  ['bubbleId:comp-1:b2', JSON.stringify({ type: 'ai', text: 'done, it is faster', createdAt: 1751457630000 })],
  ['bubbleId:comp-1:b3', JSON.stringify({ type: 'user', text: 'thanks' })],
  ['bubbleId:comp-1:b4', JSON.stringify({ type: 'tool', text: 'not a chat turn' })],
  ['bubbleId:comp-1:b5', JSON.stringify({ type: 'user', text: '   ' })],
];

/** Build a tiny workspaceStorage-shaped fixture: <root>/<hash>/state.vscdb. */
async function makeWorkspace(root: string, opts: { bubbles?: boolean } = {}): Promise<string> {
  const workspaceDir = path.join(root, 'abc123hash');
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, 'workspace.json'),
    JSON.stringify({ folder: 'file:///Users/dev/code/demo' }),
  );
  const db = path.join(workspaceDir, 'state.vscdb');
  await run(
    db,
    'CREATE TABLE ItemTable(key TEXT PRIMARY KEY, value TEXT);',
    'CREATE TABLE cursorDiskKV(key TEXT PRIMARY KEY, value TEXT);',
    `INSERT INTO ItemTable VALUES('composer.composerData', '${sql(COMPOSER_DATA)}');`,
  );
  if (opts.bubbles) {
    for (const [key, value] of BUBBLES) {
      await run(db, `INSERT INTO cursorDiskKV VALUES('${sql(key)}', '${sql(value)}');`);
    }
  }
  return db;
}

describe('cursor workspace parsing', () => {
  it('maps composers to sessions with titles and times', async () => {
    const root = tempDir();
    const db = await makeWorkspace(root);
    const sessions = await parseCursorWorkspace(db);

    assert.equal(sessions.length, 2);
    const [named, unnamed] = sessions;
    assert.equal(named.summary.provider, 'cursor');
    assert.equal(named.summary.id, 'comp-1');
    assert.equal(named.summary.projectPath, '/Users/dev/code/demo');
    assert.equal(named.summary.projectName, 'demo');
    assert.equal(named.summary.firstUserMessage, 'Refactor the parser');
    assert.equal(named.summary.startTime, new Date(1751457615336).toISOString());
    assert.equal(named.summary.endTime, new Date(1751488402903).toISOString());
    assert.equal(named.summary.tokens, null, 'Cursor stores no token usage');
    assert.equal(named.summary.tools.total, 0, 'Cursor stores no tool calls');
    assert.deepEqual(named.summary.filesTouched, []);

    assert.equal(unnamed.summary.id, 'comp-2');
    assert.equal(unnamed.summary.firstUserMessage, null, 'no name, no turns, no fabrication');
  });

  it('extracts chat turns from bubble rows when present', async () => {
    const root = tempDir();
    const db = await makeWorkspace(root, { bubbles: true });
    const sessions = await parseCursorWorkspace(db);
    const named = sessions.find((s) => s.summary.id === 'comp-1');

    assert.ok(named);
    assert.equal(named.summary.messageCount, 3, 'non-chat and empty bubbles are skipped');
    assert.deepEqual(
      named.messages.map((m) => [m.role, m.texts[0]]),
      [
        ['user', 'make it faster'],
        ['assistant', 'done, it is faster'],
        ['user', 'thanks'],
      ],
    );
    assert.equal(named.messages[0].timestamp, new Date(1751457620000).toISOString());
    assert.equal(named.indexEntries.length, 3);
  });

  it('parses one chat in full by session id', async () => {
    const root = tempDir();
    const db = await makeWorkspace(root, { bubbles: true });
    const detail = await parseCursorSessionDetail(db, 'comp-1');
    assert.ok(detail);
    assert.equal(detail.id, 'comp-1');
    assert.equal(detail.messages.length, 3);
    assert.equal(await parseCursorSessionDetail(db, 'no-such-chat'), null);
  });

  it('returns no sessions when composerData is absent', async () => {
    const root = tempDir();
    const workspaceDir = path.join(root, 'emptyhash');
    fs.mkdirSync(workspaceDir, { recursive: true });
    const db = path.join(workspaceDir, 'state.vscdb');
    await run(db, 'CREATE TABLE ItemTable(key TEXT PRIMARY KEY, value TEXT);');
    assert.deepEqual(await parseCursorWorkspace(db), []);
  });

  it('skips a corrupt database without throwing', async () => {
    const root = tempDir();
    const workspaceDir = path.join(root, 'brokenhash');
    fs.mkdirSync(workspaceDir, { recursive: true });
    const db = path.join(workspaceDir, 'state.vscdb');
    fs.writeFileSync(db, 'this is not a sqlite database at all');
    assert.deepEqual(await parseCursorWorkspace(db), []);
  });

  it('skips when the sqlite3 binary is missing', async () => {
    const root = tempDir();
    const db = await makeWorkspace(root);
    assert.deepEqual(await parseCursorWorkspace(db, { sqlite3: '/no/such/sqlite3' }), []);
  });

  it('discovers state.vscdb files one level down', async () => {
    const root = tempDir();
    await makeWorkspace(root);
    const found = await discoverCursorDbs(root);
    assert.equal(found.length, 1);
    assert.ok(found[0].db.endsWith('state.vscdb'));
  });
});
