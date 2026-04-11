/**
 * parser.ts - discovers and parses Claude Code session transcripts.
 *
 * Transcripts live at `<sessionsDir>/<slugified-cwd>/<session-uuid>.jsonl`,
 * one JSON object per line. Observed event schema (Claude Code 2.x):
 *
 *   user:      { type, timestamp, sessionId, uuid, parentUuid, cwd, gitBranch,
 *                version, userType, isMeta?, isSidechain?,
 *                message: { role: "user",
 *                           content: string | Array<text | tool_result> } }
 *   assistant: { type, timestamp, sessionId, uuid, parentUuid, cwd, requestId,
 *                isSidechain?,
 *                message: { id, role: "assistant", model, stop_reason,
 *                           usage: { input_tokens, output_tokens,
 *                                    cache_read_input_tokens,
 *                                    cache_creation_input_tokens, ... },
 *                           content: Array<thinking | text | tool_use> } }
 *
 * tool_use blocks:  { type: "tool_use", id: "toolu_...", name, input }
 *   - Edit:      input { file_path, old_string, new_string, replace_all }
 *   - MultiEdit: input { file_path, edits: [...] }
 *   - Write:     input { file_path, content }
 *   - Read:      input { file_path, ... }
 *   - Bash:      input { command, description }
 * tool_result blocks (in user events): { type: "tool_result", tool_use_id,
 *   is_error?, content: string | Array<{ type: "text", text } | ...> }
 *
 * Other top-level types exist (system, file-history-snapshot, attachment,
 * queue-operation, permission-mode, mode, ai-title, ...) and are ignored.
 *
 * Notes:
 *  - Assistant events are streamed: several lines can share one message.id,
 *    each carrying part of the content array and the SAME usage object.
 *    We merge content by message.id and count usage once per message.id.
 *  - Lines can be huge (embedded file contents) and occasionally malformed -
 *    we stream line-by-line and skip anything that doesn't parse.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as readline from 'node:readline';
import type {
  EditDiff,
  FileEdit,
  Message,
  SearchIndexEntry,
  SessionDetail,
  SessionSummary,
  TokenUsage,
  ToolCategory,
  ToolEvent,
  ToolResult,
  ToolTally,
} from './types.js';

/** Max chars kept for a tool_result preview. */
const TOOL_RESULT_PREVIEW = 2000;
/** Max chars kept per text block in the detail view. */
const TEXT_BLOCK_CAP = 100_000;
/** Max chars per message kept in the search index. */
const INDEX_TEXT_CAP = 4000;
/** Max chars for a tool call summary. */
const TOOL_SUMMARY_CAP = 200;
/** Max chars kept per side of an Edit/MultiEdit diff. */
const EDIT_DIFF_CAP = 50_000;

export function defaultSessionsDir(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

/** Recursively find *.jsonl transcript files under the sessions dir (depth 2). */
export async function discoverTranscripts(sessionsDir: string): Promise<string[]> {
  const out: string[] = [];
  let projectDirs: fs.Dirent[];
  try {
    projectDirs = await fs.promises.readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const dir of projectDirs) {
    if (!dir.isDirectory()) continue;
    const sub = path.join(sessionsDir, dir.name);
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(sub, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        out.push(path.join(sub, e.name));
      }
    }
  }
  return out;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Extract plain text from a tool_result `content` field (string or blocks). */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (isRecord(block) && typeof block.text === 'string') parts.push(block.text);
      else if (typeof block === 'string') parts.push(block);
    }
    return parts.join('\n');
  }
  return '';
}

/** Short human-readable one-liner for a tool call. */
function summarizeTool(name: string, input: Record<string, unknown>): string | undefined {
  const s = (v: unknown) => (typeof v === 'string' ? truncate(v.replace(/\s+/g, ' ').trim(), TOOL_SUMMARY_CAP) : undefined);
  switch (name) {
    case 'Bash':
      return s(input.command);
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return s(input.file_path);
    case 'WebFetch':
      return s(input.url);
    case 'WebSearch':
      return s(input.query);
    case 'Grep':
    case 'Glob':
      return s(input.pattern);
    case 'Task':
    case 'Agent':
      return s(input.description) ?? s(input.prompt);
    case 'Skill':
      return s(input.skill);
    default: {
      try {
        return truncate(JSON.stringify(input), 120);
      } catch {
        return undefined;
      }
    }
  }
}

/**
 * Old/new string pairs from Edit and MultiEdit inputs, for the diff view.
 * Tolerates partial input (truncated transcripts): pairs with a missing or
 * non-string side are dropped. Returns undefined for every other tool so
 * they carry no extra payload.
 */
function extractEditDiffs(name: string, input: Record<string, unknown>): EditDiff[] | undefined {
  if (name === 'Edit') {
    if (typeof input.old_string !== 'string' || typeof input.new_string !== 'string') {
      return undefined;
    }
    return [
      {
        oldText: truncate(input.old_string, EDIT_DIFF_CAP),
        newText: truncate(input.new_string, EDIT_DIFF_CAP),
      },
    ];
  }
  if (name === 'MultiEdit') {
    if (!Array.isArray(input.edits)) return undefined;
    const diffs: EditDiff[] = [];
    for (const e of input.edits) {
      if (isRecord(e) && typeof e.old_string === 'string' && typeof e.new_string === 'string') {
        diffs.push({
          oldText: truncate(e.old_string, EDIT_DIFF_CAP),
          newText: truncate(e.new_string, EDIT_DIFF_CAP),
        });
      }
    }
    return diffs.length > 0 ? diffs : undefined;
  }
  return undefined;
}

/** Map a tool name to the file operation it implies, if any. */
function fileOperation(name: string): FileEdit['operation'] | null {
  switch (name) {
    case 'Write':
      return 'created';
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'edited';
    case 'Read':
      return 'read';
    default:
      return null;
  }
}

/**
 * Bucket a tool name into one of the five dashboard categories.
 * Anything unrecognized falls into 'task' rather than growing a sixth slot -
 * see TOOL_CATEGORIES in types.ts for why the set stays small.
 */
export function toolCategory(name: string): ToolCategory {
  switch (name) {
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'edit';
    case 'Bash':
    case 'BashOutput':
    case 'KillShell':
      return 'command';
    case 'Read':
      return 'read';
    case 'Grep':
    case 'Glob':
    case 'WebSearch':
    case 'WebFetch':
      return 'search';
    default:
      return 'task';
  }
}

interface FileTouch {
  created: number;
  edited: number;
  read: number;
  tools: Set<string>;
}

/** Mutable accumulator used while streaming one transcript file. */
class SessionBuilder {
  id: string;
  file: string;
  projectPath = '';
  startTime: string | null = null;
  endTime: string | null = null;
  messageCount = 0;
  models = new Set<string>();
  files = new Map<string, FileTouch>();
  tools: ToolTally = { edit: 0, command: 0, read: 0, search: 0, task: 0, errors: 0, total: 0 };
  firstUserMessage: string | null = null;
  /** usage per unique assistant message.id (dedup of streaming chunks). */
  private usageByMessageId = new Map<string, TokenUsage>();
  /** assistant messages keyed by message.id, in insertion order. */
  private assistantById = new Map<string, Message>();
  /** tool_use id -> ToolEvent, for folding results back in. */
  private toolUseById = new Map<string, ToolEvent>();
  /** tool_use ids that received a matching tool_result. */
  private matchedResults = new Set<string>();
  messages: Message[] = [];
  indexEntries: SearchIndexEntry[] = [];

  constructor(id: string, file: string) {
    this.id = id;
    this.file = file;
  }

  private touchTime(ts: unknown): void {
    if (typeof ts !== 'string') return;
    if (this.startTime === null || ts < this.startTime) this.startTime = ts;
    if (this.endTime === null || ts > this.endTime) this.endTime = ts;
  }

  private touchFile(filePath: string, name: string): void {
    const op = fileOperation(name);
    if (!op) return;
    let t = this.files.get(filePath);
    if (!t) {
      t = { created: 0, edited: 0, read: 0, tools: new Set() };
      this.files.set(filePath, t);
    }
    t[op] += 1;
    t.tools.add(name);
  }

  private addIndexEntry(msg: Message): void {
    const text = msg.texts.join('\n').trim();
    if (!text) return;
    this.indexEntries.push({
      sessionId: this.id,
      projectPath: this.projectPath,
      projectName: path.basename(this.projectPath || '') || this.projectPath,
      messageUuid: msg.uuid,
      role: msg.role,
      timestamp: msg.timestamp,
      text: truncate(text, INDEX_TEXT_CAP),
    });
  }

  /** Feed one parsed JSONL event. Unknown shapes are ignored. */
  addEvent(ev: Record<string, unknown>): void {
    const type = ev.type;
    if (type !== 'user' && type !== 'assistant') return;
    if (!isRecord(ev.message)) return;
    const message = ev.message;
    const content = message.content;
    if (typeof ev.cwd === 'string' && ev.cwd) this.projectPath = ev.cwd;
    this.touchTime(ev.timestamp);

    const isMeta = ev.isMeta === true;
    const isSidechain = ev.isSidechain === true;
    const timestamp = typeof ev.timestamp === 'string' ? ev.timestamp : '';

    if (type === 'assistant') {
      const rawModel = typeof message.model === 'string' ? message.model : undefined;
      // '<synthetic>' is an internal placeholder, not a real model name
      const model = rawModel === '<synthetic>' ? undefined : rawModel;
      if (model) this.models.add(model);
      if (!isMeta) this.messageCount += 1;

      // usage: count once per unique message.id
      const msgId = typeof message.id === 'string' ? message.id : undefined;
      if (msgId && isRecord(message.usage)) {
        const u = message.usage;
        this.usageByMessageId.set(msgId, {
          input: typeof u.input_tokens === 'number' ? u.input_tokens : 0,
          output: typeof u.output_tokens === 'number' ? u.output_tokens : 0,
          cacheRead: typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : 0,
          cacheCreation:
            typeof u.cache_creation_input_tokens === 'number' ? u.cache_creation_input_tokens : 0,
        });
      }

      // content blocks (text + tool_use); merge streaming chunks by message.id
      const key = msgId ?? (typeof ev.uuid === 'string' ? ev.uuid : `unknown-${this.messages.length}`);
      let msg = this.assistantById.get(key);
      if (!msg) {
        msg = {
          uuid: typeof ev.uuid === 'string' ? ev.uuid : key,
          role: 'assistant',
          timestamp,
          texts: [],
          toolUses: [],
          toolResults: [],
          model,
          isSidechain: isSidechain || undefined,
        };
        this.assistantById.set(key, msg);
        this.messages.push(msg);
      }
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!isRecord(block)) continue;
          if (block.type === 'text' && typeof block.text === 'string') {
            msg.texts.push(truncate(block.text, TEXT_BLOCK_CAP));
          } else if (block.type === 'tool_use' && typeof block.name === 'string') {
            const input = isRecord(block.input) ? block.input : {};
            const tool: ToolEvent = {
              id: typeof block.id === 'string' ? block.id : '',
              name: block.name,
              filePath: typeof input.file_path === 'string' ? input.file_path : undefined,
              summary: summarizeTool(block.name, input),
              edits: extractEditDiffs(block.name, input),
            };
            if (tool.filePath) this.touchFile(tool.filePath, block.name);
            if (tool.id) this.toolUseById.set(tool.id, tool);
            this.tools[toolCategory(block.name)] += 1;
            this.tools.total += 1;
            msg.toolUses.push(tool);
          }
          // thinking blocks are intentionally skipped
        }
      }
      this.addIndexEntry(msg);
      return;
    }

    // type === 'user'
    const texts: string[] = [];
    const toolResults: ToolResult[] = [];
    if (typeof content === 'string') {
      texts.push(truncate(content, TEXT_BLOCK_CAP));
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === 'string') {
          texts.push(truncate(block, TEXT_BLOCK_CAP));
        } else if (isRecord(block)) {
          if (block.type === 'text' && typeof block.text === 'string') {
            texts.push(truncate(block.text, TEXT_BLOCK_CAP));
          } else if (block.type === 'tool_result') {
            const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';
            const preview = truncate(toolResultText(block.content), TOOL_RESULT_PREVIEW);
            const isError = block.is_error === true;
            toolResults.push({ toolUseId, isError, preview });
            if (isError) this.tools.errors += 1;
            // fold the result back into its tool_use for compact rendering
            const tool = this.toolUseById.get(toolUseId);
            if (tool) {
              tool.resultPreview = preview;
              tool.isError = isError;
              this.matchedResults.add(toolUseId);
            }
          }
        }
      }
    }

    if (isMeta) return;
    this.messageCount += 1;

    // first real user text → session title hint
    if (this.firstUserMessage === null) {
      const t = texts.join(' ').trim();
      // skip command invocations / system-reminder style payloads
      if (t && !t.startsWith('<')) {
        this.firstUserMessage = truncate(t.replace(/\s+/g, ' '), 200);
      }
    }

    const hasUnmatchedResults = toolResults.some((r) => !this.matchedResults.has(r.toolUseId));
    if (texts.length === 0 && !hasUnmatchedResults) return; // pure tool-result carrier, folded already

    const msg: Message = {
      uuid: typeof ev.uuid === 'string' ? ev.uuid : `user-${this.messages.length}`,
      role: 'user',
      timestamp,
      texts,
      toolUses: [],
      toolResults: toolResults.filter((r) => !this.matchedResults.has(r.toolUseId)),
      isSidechain: isSidechain || undefined,
    };
    this.messages.push(msg);
    this.addIndexEntry(msg);
  }

  filesTouched(): FileEdit[] {
    const out: FileEdit[] = [];
    for (const [p, t] of this.files) {
      const operation = t.created > 0 ? 'created' : t.edited > 0 ? 'edited' : 'read';
      out.push({
        path: p,
        operation,
        tools: [...t.tools].sort(),
        count: t.created + t.edited + t.read,
      });
    }
    // most-touched first, reads sink to the bottom
    const rank = { created: 0, edited: 1, read: 2 };
    out.sort((a, b) => rank[a.operation] - rank[b.operation] || b.count - a.count);
    return out;
  }

  totalTokens(): TokenUsage | null {
    if (this.usageByMessageId.size === 0) return null;
    const total: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    for (const u of this.usageByMessageId.values()) {
      total.input += u.input;
      total.output += u.output;
      total.cacheRead += u.cacheRead;
      total.cacheCreation += u.cacheCreation;
    }
    return total;
  }

  summary(mtime: number): SessionSummary {
    const projectName = path.basename(this.projectPath || '') || this.projectPath || 'unknown';
    return {
      id: this.id,
      projectPath: this.projectPath,
      projectName,
      file: this.file,
      startTime: this.startTime,
      endTime: this.endTime,
      messageCount: this.messageCount,
      models: [...this.models].sort(),
      tokens: this.totalTokens(),
      filesTouched: this.filesTouched(),
      tools: { ...this.tools },
      firstUserMessage: this.firstUserMessage,
      mtime,
    };
  }
}

/** Stream a file line-by-line, invoking fn for each successfully parsed object. */
async function eachJsonLine(file: string, fn: (obj: Record<string, unknown>) => void): Promise<void> {
  const rl = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of rl) {
      if (!line || line[0] !== '{') continue; // fast path: every event is a JSON object
      try {
        const obj: unknown = JSON.parse(line);
        if (isRecord(obj)) fn(obj);
      } catch {
        // malformed line (partial write, etc.) - skip, don't crash
      }
    }
  } finally {
    rl.close();
  }
}

/**
 * Parse one transcript file. Always produces summary + search-index entries;
 * messages are included when `withMessages` is true.
 */
export async function parseTranscript(
  file: string,
  opts: { withMessages: boolean },
): Promise<{ summary: SessionSummary; messages: Message[]; indexEntries: SearchIndexEntry[] }> {
  const id = path.basename(file, '.jsonl');
  const builder = new SessionBuilder(id, file);
  let mtime = 0;
  try {
    mtime = (await fs.promises.stat(file)).mtimeMs;
  } catch {
    // unreadable file - mtime stays 0
  }
  try {
    await eachJsonLine(file, (obj) => builder.addEvent(obj));
  } catch {
    // unreadable stream - return whatever we have
  }
  const summary = builder.summary(mtime);
  return {
    summary,
    messages: opts.withMessages ? builder.messages : [],
    indexEntries: builder.indexEntries,
  };
}

export interface Corpus {
  sessions: SessionSummary[];
  /** session id -> transcript file path */
  filesById: Map<string, string>;
  /** in-memory full-text search index */
  index: SearchIndexEntry[];
}

/** Parse every transcript under sessionsDir into summaries + search index. */
export async function parseCorpus(sessionsDir: string): Promise<Corpus> {
  const files = await discoverTranscripts(sessionsDir);
  const sessions: SessionSummary[] = [];
  const filesById = new Map<string, string>();
  const index: SearchIndexEntry[] = [];
  for (const file of files) {
    try {
      const { summary, indexEntries } = await parseTranscript(file, { withMessages: false });
      if (!filesById.has(summary.id)) {
        filesById.set(summary.id, file);
        sessions.push(summary);
        index.push(...indexEntries);
      }
    } catch {
      // a single bad transcript must not sink the whole scan
    }
  }
  sessions.sort((a, b) => {
    const ta = a.endTime ?? '';
    const tb = b.endTime ?? '';
    if (ta !== tb) return ta < tb ? 1 : -1;
    return b.mtime - a.mtime;
  });
  return { sessions, filesById, index };
}

/** Parse one session in full (summary + complete message timeline). */
export async function parseSessionDetail(file: string): Promise<SessionDetail> {
  const { summary, messages } = await parseTranscript(file, { withMessages: true });
  return { ...summary, messages };
}
