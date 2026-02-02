/** Fixture helpers: build Claude Code-shaped JSONL transcripts on disk. */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agenttrail-test-'));
}

/**
 * Write a transcript. Entries may be objects (serialized to JSON) or raw
 * strings, so tests can inject malformed lines verbatim.
 */
export function writeTranscript(dir: string, name: string, entries: unknown[]): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.jsonl`);
  const body = entries
    .map((e) => (typeof e === 'string' ? e : JSON.stringify(e)))
    .join('\n');
  fs.writeFileSync(file, body + '\n');
  return file;
}

let seq = 0;
export const nextUuid = (): string => `uuid-${++seq}`;

export const CWD = '/Users/dev/code/demo';

interface UserOpts {
  content: unknown;
  timestamp?: string;
  isMeta?: boolean;
  cwd?: string;
  uuid?: string;
}

export function userEvent(opts: UserOpts): Record<string, unknown> {
  return {
    type: 'user',
    timestamp: opts.timestamp ?? '2026-01-30T10:00:00.000Z',
    sessionId: 'session-1',
    uuid: opts.uuid ?? nextUuid(),
    cwd: opts.cwd ?? CWD,
    ...(opts.isMeta ? { isMeta: true } : {}),
    message: { role: 'user', content: opts.content },
  };
}

interface AssistantOpts {
  content: unknown[];
  id?: string;
  model?: string;
  timestamp?: string;
  usage?: Record<string, number>;
  cwd?: string;
  uuid?: string;
  isSidechain?: boolean;
}

export function assistantEvent(opts: AssistantOpts): Record<string, unknown> {
  return {
    type: 'assistant',
    timestamp: opts.timestamp ?? '2026-01-30T10:00:05.000Z',
    sessionId: 'session-1',
    uuid: opts.uuid ?? nextUuid(),
    cwd: opts.cwd ?? CWD,
    ...(opts.isSidechain ? { isSidechain: true } : {}),
    message: {
      id: opts.id ?? 'msg_default',
      role: 'assistant',
      model: opts.model ?? 'claude-opus-5',
      ...(opts.usage ? { usage: opts.usage } : {}),
      content: opts.content,
    },
  };
}

export const textBlock = (text: string) => ({ type: 'text', text });

export const toolUse = (id: string, name: string, input: Record<string, unknown> = {}) => ({
  type: 'tool_use',
  id,
  name,
  input,
});

export const toolResult = (toolUseId: string, content: unknown, isError = false) => ({
  type: 'tool_result',
  tool_use_id: toolUseId,
  ...(isError ? { is_error: true } : {}),
  content,
});

export const usage = (
  input: number,
  output: number,
  cacheRead = 0,
  cacheCreation = 0,
): Record<string, number> => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheCreation,
});
