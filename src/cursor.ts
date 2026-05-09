/**
 * cursor.ts - ingests Cursor workspace chat state.
 *
 * Cursor stores per-workspace state in SQLite at
 * `<root>/<workspace-hash>/state.vscdb` (root is the editor's workspaceStorage
 * dir). Node has no sqlite bindings here and the CLI stays dependency-free,
 * so reads shell out to the sqlite3 CLI with the database opened read-only.
 *
 * Observed schema (Cursor 1.x):
 *   ItemTable(key, value):
 *     'composer.composerData' → { allComposers: [{ composerId, name?,
 *         createdAt, lastUpdatedAt?, unifiedMode, ... }] }
 *   cursorDiskKV(key, value):
 *     'bubbleId:<composerId>:<bubbleId>' → one chat turn. Empty on every
 *     workspace inspected for this reader (newer Cursor versions moved chat
 *     content out), so turns are extracted defensively and simply stay empty
 *     when the keys are absent. Token usage and tool calls are not stored
 *     here at all, so those fields stay empty too.
 *   sibling workspace.json → { folder: 'file:///abs/path' } for project path.
 *
 * Failure policy: missing sqlite3 binary, locked or malformed databases and
 * unparseable values all degrade to "skip this workspace", never a crash.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  Message,
  SearchIndexEntry,
  SessionDetail,
  SessionSummary,
} from './types.js';

const execFileAsync = promisify(execFile);

/** sqlite3 can emit large values; allow plenty of headroom. */
const MAX_SQLITE_OUTPUT = 64 * 1024 * 1024;
/** A wedged database must not hang the scan. */
const SQLITE_TIMEOUT_MS = 10_000;
/** Max chars per message kept in the search index. */
const INDEX_TEXT_CAP = 4000;

export function defaultCursorDir(): string {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Cursor', 'User', 'workspaceStorage');
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'Cursor', 'User', 'workspaceStorage');
}

/** True when the sqlite3 CLI can be executed. */
export async function cursorSqliteAvailable(bin = 'sqlite3'): Promise<boolean> {
  try {
    await execFileAsync(bin, ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export interface CursorDb {
  /** Absolute path of state.vscdb. */
  db: string;
  /** Absolute path of the workspace dir containing it. */
  workspaceDir: string;
}

/** Find state.vscdb files exactly one level under the workspaceStorage root. */
export async function discoverCursorDbs(root: string): Promise<CursorDb[]> {
  const out: CursorDb[] = [];
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const db = path.join(root, e.name, 'state.vscdb');
    try {
      const st = await fs.promises.stat(db);
      if (st.isFile()) out.push({ db, workspaceDir: path.join(root, e.name) });
    } catch {
      // no state.vscdb here
    }
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** Run one read-only query in .mode json, returning the rows. Throws on failure. */
async function queryRows(db: string, sql: string, bin: string): Promise<Array<Record<string, unknown>>> {
  const uri = `file:${db.replace(/[?#]/g, (c) => encodeURIComponent(c))}?mode=ro`;
  const { stdout } = await execFileAsync(bin, [uri, '.mode json', sql], {
    timeout: SQLITE_TIMEOUT_MS,
    maxBuffer: MAX_SQLITE_OUTPUT,
  });
  const parsed: unknown = JSON.parse(stdout.trim() || '[]');
  return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
}

/** Project folder from the sibling workspace.json, if present. */
async function workspaceFolder(workspaceDir: string): Promise<string> {
  try {
    const raw = await fs.promises.readFile(path.join(workspaceDir, 'workspace.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && typeof parsed.folder === 'string') {
      const folder = parsed.folder;
      if (folder.startsWith('file://')) return decodeURIComponent(folder.slice('file://'.length));
      return folder;
    }
  } catch {
    // missing or malformed workspace.json
  }
  return '';
}

interface ComposerHead {
  id: string;
  name?: string;
  createdAt: number | null;
  updatedAt: number | null;
}

function parseComposerHeads(value: string): ComposerHead[] {
  const heads: ComposerHead[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return heads;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.allComposers)) return heads;
  for (const c of parsed.allComposers) {
    if (!isRecord(c) || typeof c.composerId !== 'string') continue;
    heads.push({
      id: c.composerId,
      name: typeof c.name === 'string' && c.name ? c.name : undefined,
      createdAt: typeof c.createdAt === 'number' ? c.createdAt : null,
      updatedAt: typeof c.lastUpdatedAt === 'number' ? c.lastUpdatedAt : null,
    });
  }
  return heads;
}

interface Bubble {
  composerId: string;
  role: 'user' | 'assistant';
  text: string;
  /** ms epoch, null when the bubble carries no timestamp. */
  at: number | null;
}

function bubbleRole(v: unknown): 'user' | 'assistant' | null {
  if (v === 'user' || v === 'human' || v === 1) return 'user';
  if (v === 'ai' || v === 'assistant' || v === 2) return 'assistant';
  return null;
}

/** One bubble row from cursorDiskKV: key bubbleId:<composerId>:<bubbleId>. */
function parseBubbleRow(key: string, value: string): Bubble | null {
  const parts = key.split(':');
  if (parts.length !== 3) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const role = bubbleRole(parsed.type);
  const text = typeof parsed.text === 'string' ? parsed.text : '';
  if (!role || !text.trim()) return null;
  const at =
    typeof parsed.createdAt === 'number'
      ? parsed.createdAt
      : typeof parsed.timestamp === 'number'
        ? parsed.timestamp
        : null;
  return { composerId: parts[1], role, text, at };
}

function isoFromMs(ms: number | null): string | null {
  if (ms === null || Number.isNaN(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface CursorSession {
  summary: SessionSummary;
  messages: Message[];
  indexEntries: SearchIndexEntry[];
}

/**
 * Parse one state.vscdb into one session per composer chat. Returns an empty
 * list when the database cannot be read (missing binary, lock, corruption).
 */
export async function parseCursorWorkspace(
  db: string,
  opts: { sqlite3?: string; workspaceDir?: string } = {},
): Promise<CursorSession[]> {
  const bin = opts.sqlite3 ?? 'sqlite3';
  const workspaceDir = opts.workspaceDir ?? path.dirname(db);
  let mtime = 0;
  try {
    mtime = (await fs.promises.stat(db)).mtimeMs;
  } catch {
    return [];
  }

  let composerRows: Array<Record<string, unknown>>;
  try {
    composerRows = await queryRows(
      db,
      "SELECT value FROM ItemTable WHERE key='composer.composerData';",
      bin,
    );
  } catch {
    return []; // locked, malformed, or sqlite3 missing: skip this workspace
  }
  const heads =
    typeof composerRows[0]?.value === 'string' ? parseComposerHeads(composerRows[0].value) : [];
  if (heads.length === 0) return [];

  // Turns are optional: the bubble store is empty on newer Cursor versions.
  let bubbles: Bubble[] = [];
  try {
    const rows = await queryRows(
      db,
      "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%';",
      bin,
    );
    for (const row of rows) {
      if (typeof row.key !== 'string' || typeof row.value !== 'string') continue;
      const bubble = parseBubbleRow(row.key, row.value);
      if (bubble) bubbles.push(bubble);
    }
  } catch {
    // no cursorDiskKV table or unreadable: sessions without turns
  }

  const projectPath = await workspaceFolder(workspaceDir);
  const projectName = projectPath ? path.basename(projectPath) : 'cursor-workspace';

  const sessions: CursorSession[] = [];
  for (const head of heads) {
    const start = isoFromMs(head.createdAt);
    const end = isoFromMs(head.updatedAt ?? head.createdAt);
    const own = bubbles
      .filter((b) => b.composerId === head.id)
      .sort((a, b) => (a.at ?? Number.MAX_SAFE_INTEGER) - (b.at ?? Number.MAX_SAFE_INTEGER));

    const messages: Message[] = [];
    const indexEntries: SearchIndexEntry[] = [];
    let firstUserMessage: string | null = head.name ?? null;
    own.forEach((b, i) => {
      const timestamp = isoFromMs(b.at) ?? start ?? '';
      messages.push({
        uuid: `cur-${head.id}-${i}`,
        role: b.role,
        timestamp,
        texts: [b.text],
        toolUses: [],
        toolResults: [],
      });
      indexEntries.push({
        sessionId: head.id,
        projectPath,
        projectName,
        messageUuid: `cur-${head.id}-${i}`,
        role: b.role,
        timestamp,
        text: truncate(b.text, INDEX_TEXT_CAP),
      });
      if (firstUserMessage === null && b.role === 'user') {
        firstUserMessage = truncate(b.text.replace(/\s+/g, ' ').trim(), 200) || null;
      }
    });

    sessions.push({
      summary: {
        id: head.id,
        provider: 'cursor',
        projectPath,
        projectName,
        file: db,
        startTime: start,
        endTime: end,
        messageCount: messages.length,
        models: [],
        tokens: null,
        filesTouched: [],
        tools: { edit: 0, command: 0, read: 0, search: 0, task: 0, errors: 0, total: 0 },
        firstUserMessage,
        mtime,
      },
      messages,
      indexEntries,
    });
  }
  return sessions;
}

/** Parse one Cursor chat in full (summary + turns) from its workspace db. */
export async function parseCursorSessionDetail(
  db: string,
  sessionId: string,
  opts: { sqlite3?: string } = {},
): Promise<SessionDetail | null> {
  const sessions = await parseCursorWorkspace(db, opts);
  const found = sessions.find((s) => s.summary.id === sessionId);
  if (!found) return null;
  return { ...found.summary, messages: found.messages };
}
