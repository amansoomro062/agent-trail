/**
 * codex.ts - ingests OpenAI Codex CLI rollout transcripts.
 *
 * Sessions live at `<root>/<yyyy>/<mm>/<dd>/rollout-<ts>-<uuid>.jsonl`,
 * one JSON object per line. Observed schema (Codex CLI 0.x):
 *
 *   { timestamp, type, payload }
 *
 *   type 'session_meta':  payload { id, cwd, cli_version, model_provider, ... }
 *   type 'turn_context':  payload { model, cwd, ... } (repeats every turn)
 *   type 'event_msg':     payload.type 'user_message' { message }
 *                                  'agent_message' { message }
 *                                  'token_count' { info: { total_token_usage:
 *                                    { input_tokens, cached_input_tokens,
 *                                      output_tokens, ... } } | null }
 *   type 'response_item': payload.type 'message' { role, content:
 *                                    [{ type: 'input_text'|'output_text', text }] }
 *                                  'function_call' { name, arguments, call_id }
 *                                  'function_call_output' { call_id, output }
 *                                  'custom_tool_call' { name: 'apply_patch',
 *                                    input, call_id }
 *                                  'custom_tool_call_output' { call_id, output }
 *                                  'reasoning' | 'web_search_call' | ...
 *
 * Notes:
 *  - Assistant text appears BOTH as response_item message (role assistant)
 *    and as event_msg agent_message. We use the response_item and ignore
 *    agent_message, so nothing is double counted.
 *  - Real user turns arrive as event_msg user_message. response_item user
 *    messages carry environment_context/instructions wrappers and are skipped.
 *  - token_count is cumulative: the last record with non-null info wins.
 *    OpenAI's input_tokens includes cached tokens, so cacheRead is split out
 *    to keep the headline figure comparable with Claude sessions.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { summarizeTool, toolCategory } from './parser.js';
import type {
  FileEdit,
  Message,
  SearchIndexEntry,
  SessionDetail,
  SessionSummary,
  TokenUsage,
  ToolEvent,
  ToolTally,
} from './types.js';

/** Max chars kept for a tool result preview. */
const TOOL_RESULT_PREVIEW = 2000;
/** Max chars kept per text block. */
const TEXT_BLOCK_CAP = 100_000;
/** Max chars per message kept in the search index. */
const INDEX_TEXT_CAP = 4000;

export function defaultCodexDir(): string {
  return path.join(process.env.HOME ?? '', '.codex', 'sessions');
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Recursively find rollout *.jsonl files (sessions sit 3 levels down). */
export async function discoverCodexTranscripts(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 3) await walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
    }
  }
  await walk(root, 0);
  return out;
}

/** Session id from the rollout filename when session_meta is missing. */
function idFromFilename(file: string): string {
  const base = path.basename(file, '.jsonl');
  const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(base);
  return m ? m[1] : base;
}

/** File ops inside an apply_patch body: Add File, Update File, Delete File. */
function patchFiles(input: string): Array<{ path: string; op: 'created' | 'edited' }> {
  const out: Array<{ path: string; op: 'created' | 'edited' }> = [];
  const re = /^\*\*\* (Add|Update|Delete) File: (.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    // the model has no 'deleted' operation; a deletion counts as an edit
    out.push({ path: m[2].trim(), op: m[1] === 'Add' ? 'created' : 'edited' });
  }
  return out;
}

/** Exit code embedded in exec tool output, e.g. "Process exited with code 1". */
function execFailed(output: string): boolean {
  const m = /exited with code (\d+)/.exec(output);
  return m !== null && m[1] !== '0';
}

/** custom_tool_call_output wraps its text in a JSON {output: ...} string. */
function unwrapCustomOutput(output: string): string {
  try {
    const parsed: unknown = JSON.parse(output);
    if (isRecord(parsed) && typeof parsed.output === 'string') return parsed.output;
  } catch {
    // plain text output; use as-is
  }
  return output;
}

interface FileTouch {
  created: number;
  edited: number;
  read: number;
  tools: Set<string>;
}

class CodexSessionBuilder {
  id: string;
  file: string;
  projectPath = '';
  startTime: string | null = null;
  endTime: string | null = null;
  messageCount = 0;
  models = new Set<string>();
  tools: ToolTally = { edit: 0, command: 0, read: 0, search: 0, task: 0, errors: 0, total: 0 };
  firstUserMessage: string | null = null;
  private tokens: TokenUsage | null = null;
  private files = new Map<string, FileTouch>();
  private toolUseById = new Map<string, ToolEvent>();
  messages: Message[] = [];
  indexEntries: SearchIndexEntry[] = [];
  private seq = 0;

  constructor(file: string) {
    this.file = file;
    this.id = idFromFilename(file);
  }

  private nextUuid(): string {
    return `cx-${++this.seq}`;
  }

  private touchTime(ts: unknown): void {
    if (typeof ts !== 'string') return;
    if (this.startTime === null || ts < this.startTime) this.startTime = ts;
    if (this.endTime === null || ts > this.endTime) this.endTime = ts;
  }

  private touchFile(filePath: string, op: 'created' | 'edited', tool: string): void {
    let t = this.files.get(filePath);
    if (!t) {
      t = { created: 0, edited: 0, read: 0, tools: new Set() };
      this.files.set(filePath, t);
    }
    t[op] += 1;
    t.tools.add(tool);
  }

  private pushMessage(msg: Message): void {
    this.messageCount += 1;
    this.messages.push(msg);
    const text = msg.texts.join('\n').trim();
    if (text) {
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
  }

  private addToolCall(name: string, input: Record<string, unknown>, callId: string, timestamp: string): void {
    const tool: ToolEvent = {
      id: callId,
      name,
      filePath: typeof input.file_path === 'string' ? input.file_path : undefined,
      summary: summarizeTool(name, input),
    };
    if (callId) this.toolUseById.set(callId, tool);
    this.tools[toolCategory(name)] += 1;
    this.tools.total += 1;
    this.pushMessage({
      uuid: this.nextUuid(),
      role: 'assistant',
      timestamp,
      texts: [],
      toolUses: [tool],
      toolResults: [],
    });
  }

  private foldToolOutput(callId: string, output: string, isError: boolean): void {
    const tool = this.toolUseById.get(callId);
    if (!tool) return; // output without its call (truncated rollout): drop
    tool.resultPreview = truncate(output, TOOL_RESULT_PREVIEW);
    tool.isError = isError;
    if (isError) this.tools.errors += 1;
  }

  private addPatchCall(payload: Record<string, unknown>, timestamp: string): void {
    const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
    const input = typeof payload.input === 'string' ? payload.input : '';
    const touched = patchFiles(input);
    const tool: ToolEvent = {
      id: callId,
      name: 'apply_patch',
      filePath: touched[0]?.path,
      summary: touched[0]?.path ?? 'apply_patch',
    };
    if (callId) this.toolUseById.set(callId, tool);
    this.tools.edit += 1;
    this.tools.total += 1;
    for (const f of touched) this.touchFile(f.path, f.op, 'apply_patch');
    this.pushMessage({
      uuid: this.nextUuid(),
      role: 'assistant',
      timestamp,
      texts: [],
      toolUses: [tool],
      toolResults: [],
    });
  }

  /** Feed one parsed JSONL line. Unknown shapes are ignored. */
  addLine(ev: Record<string, unknown>): void {
    const timestamp = typeof ev.timestamp === 'string' ? ev.timestamp : '';
    this.touchTime(ev.timestamp);
    const payload = ev.payload;
    if (!isRecord(payload)) return;

    if (ev.type === 'session_meta') {
      if (typeof payload.id === 'string' && payload.id) this.id = payload.id;
      if (typeof payload.cwd === 'string' && payload.cwd) this.projectPath = payload.cwd;
      return;
    }

    if (ev.type === 'turn_context') {
      if (typeof payload.model === 'string' && payload.model) this.models.add(payload.model);
      if (!this.projectPath && typeof payload.cwd === 'string') this.projectPath = payload.cwd;
      return;
    }

    if (ev.type === 'event_msg') {
      if (payload.type === 'user_message' && typeof payload.message === 'string') {
        const text = truncate(payload.message, TEXT_BLOCK_CAP);
        if (this.firstUserMessage === null) {
          const t = text.replace(/\s+/g, ' ').trim();
          if (t && !t.startsWith('<')) this.firstUserMessage = truncate(t, 200);
        }
        this.pushMessage({
          uuid: this.nextUuid(),
          role: 'user',
          timestamp,
          texts: [text],
          toolUses: [],
          toolResults: [],
        });
      } else if (payload.type === 'token_count' && isRecord(payload.info)) {
        const u = payload.info.total_token_usage;
        if (isRecord(u)) {
          const input = typeof u.input_tokens === 'number' ? u.input_tokens : 0;
          const cached = typeof u.cached_input_tokens === 'number' ? u.cached_input_tokens : 0;
          this.tokens = {
            input: Math.max(0, input - cached),
            output: typeof u.output_tokens === 'number' ? u.output_tokens : 0,
            cacheRead: cached,
            cacheCreation: 0,
          };
        }
      }
      // agent_message duplicates the response_item assistant message: skip
      return;
    }

    if (ev.type !== 'response_item') return;

    if (payload.type === 'message' && payload.role === 'assistant' && Array.isArray(payload.content)) {
      const texts: string[] = [];
      for (const block of payload.content) {
        if (isRecord(block) && block.type === 'output_text' && typeof block.text === 'string') {
          texts.push(truncate(block.text, TEXT_BLOCK_CAP));
        }
      }
      if (texts.length > 0) {
        this.pushMessage({
          uuid: this.nextUuid(),
          role: 'assistant',
          timestamp,
          texts,
          toolUses: [],
          toolResults: [],
        });
      }
      return;
    }

    if (payload.type === 'function_call' && typeof payload.name === 'string') {
      let input: Record<string, unknown> = {};
      if (typeof payload.arguments === 'string') {
        try {
          const parsed: unknown = JSON.parse(payload.arguments);
          if (isRecord(parsed)) input = parsed;
        } catch {
          // partial arguments in a truncated rollout: summary falls back
        }
      }
      this.addToolCall(
        payload.name,
        input,
        typeof payload.call_id === 'string' ? payload.call_id : '',
        timestamp,
      );
      return;
    }

    if (payload.type === 'function_call_output' && typeof payload.call_id === 'string') {
      const output = typeof payload.output === 'string' ? payload.output : '';
      this.foldToolOutput(payload.call_id, output, execFailed(output));
      return;
    }

    if (payload.type === 'custom_tool_call' && payload.name === 'apply_patch') {
      this.addPatchCall(payload, timestamp);
      return;
    }

    if (payload.type === 'custom_tool_call_output' && typeof payload.call_id === 'string') {
      const output = typeof payload.output === 'string' ? unwrapCustomOutput(payload.output) : '';
      this.foldToolOutput(payload.call_id, output, false);
      return;
    }

    if (payload.type === 'web_search_call') {
      this.addToolCall(
        'web_search_call',
        isRecord(payload.action) ? payload.action : {},
        typeof payload.call_id === 'string' ? payload.call_id : '',
        timestamp,
      );
      return;
    }
    // reasoning and everything else are intentionally skipped
  }

  filesTouched(): FileEdit[] {
    const out: FileEdit[] = [];
    for (const [p, t] of this.files) {
      out.push({
        path: p,
        operation: t.created > 0 ? 'created' : 'edited',
        tools: [...t.tools].sort(),
        count: t.created + t.edited + t.read,
      });
    }
    out.sort((a, b) => (a.operation === b.operation ? b.count - a.count : a.operation === 'created' ? -1 : 1));
    return out;
  }

  summary(mtime: number): SessionSummary {
    const projectName = path.basename(this.projectPath || '') || this.projectPath || 'unknown';
    return {
      id: this.id,
      provider: 'codex',
      projectPath: this.projectPath,
      projectName,
      file: this.file,
      startTime: this.startTime,
      endTime: this.endTime,
      messageCount: this.messageCount,
      models: [...this.models].sort(),
      tokens: this.tokens,
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
      if (!line || line[0] !== '{') continue;
      try {
        const obj: unknown = JSON.parse(line);
        if (isRecord(obj)) fn(obj);
      } catch {
        // malformed line (partial write) - skip, don't crash
      }
    }
  } finally {
    rl.close();
  }
}

/** Parse one Codex rollout file. */
export async function parseCodexTranscript(
  file: string,
  opts: { withMessages: boolean },
): Promise<{ summary: SessionSummary; messages: Message[]; indexEntries: SearchIndexEntry[] }> {
  const builder = new CodexSessionBuilder(file);
  let mtime = 0;
  try {
    mtime = (await fs.promises.stat(file)).mtimeMs;
  } catch {
    // unreadable file - mtime stays 0
  }
  try {
    await eachJsonLine(file, (obj) => builder.addLine(obj));
  } catch {
    // unreadable stream - return whatever we have
  }
  return {
    summary: builder.summary(mtime),
    messages: opts.withMessages ? builder.messages : [],
    indexEntries: builder.indexEntries,
  };
}

/** Parse one Codex session in full (summary + complete message timeline). */
export async function parseCodexSessionDetail(file: string): Promise<SessionDetail> {
  const { summary, messages } = await parseCodexTranscript(file, { withMessages: true });
  return { ...summary, messages };
}
