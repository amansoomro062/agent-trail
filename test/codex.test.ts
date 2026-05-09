import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';

import { discoverCodexTranscripts, parseCodexTranscript } from '../src/codex.js';
import { parseCorpusMulti } from '../src/corpus.js';
import { tempDir, userEvent, writeTranscript } from './helpers.js';

/** Hand-built Codex rollout lines, shaped like the real schema. */

const TS = '2026-04-10T17:17:53.000Z';

function line(type: string, payload: Record<string, unknown>, timestamp = TS) {
  return { timestamp, type, payload };
}

const sessionMeta = (id = 'sess-codex-1', cwd = '/Users/dev/code/demo') =>
  line('session_meta', { id, timestamp: TS, cwd, cli_version: '0.118.0', model_provider: 'openai' });

const turnContext = (model = 'gpt-5.4', cwd = '/Users/dev/code/demo') =>
  line('turn_context', { turn_id: 'turn-1', cwd, model });

const userMessage = (message: string, timestamp = TS) =>
  line('event_msg', { type: 'user_message', message }, timestamp);

const agentMessageEvent = (message: string) => line('event_msg', { type: 'agent_message', message });

const assistantMessage = (text: string, timestamp = TS) =>
  line('response_item', {
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text }],
  }, timestamp);

const envUserWrapper = () =>
  line('response_item', {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text: '<environment_context>\n  <cwd>/x</cwd>\n</environment_context>' }],
  });

const developerMessage = () =>
  line('response_item', {
    type: 'message',
    role: 'developer',
    content: [{ type: 'input_text', text: '<permissions instructions>...' }],
  });

const functionCall = (name: string, args: Record<string, unknown>, callId: string, timestamp = TS) =>
  line('response_item', { type: 'function_call', name, arguments: JSON.stringify(args), call_id: callId }, timestamp);

const functionOutput = (callId: string, output: string) =>
  line('response_item', { type: 'function_call_output', call_id: callId, output });

const patchCall = (input: string, callId: string) =>
  line('response_item', { type: 'custom_tool_call', status: 'completed', call_id: callId, name: 'apply_patch', input });

const patchOutput = (callId: string, text: string) =>
  line('response_item', { type: 'custom_tool_call_output', call_id: callId, output: JSON.stringify({ output: text }) });

const tokenCount = (input: number, cached: number, output: number) =>
  line('event_msg', {
    type: 'token_count',
    info: {
      total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output },
      last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output },
      model_context_window: 258400,
    },
    rate_limits: null,
  });

function writeRollout(root: string, name: string, entries: unknown[]): string {
  return writeTranscript(path.join(root, '2026', '04', '10'), name, entries);
}

describe('codex rollout parsing', () => {
  it('parses a rollout into a session summary', async () => {
    const root = tempDir();
    const file = writeRollout(root, 'rollout-2026-04-10T17-17-50-aaaa0000-1111-4222-8333-444455556666', [
      sessionMeta('aaaa0000-1111-4222-8333-444455556666'),
      turnContext(),
      envUserWrapper(),
      developerMessage(),
      userMessage('hi there'),
      assistantMessage('hello, what can I do'),
      tokenCount(3502, 3072, 33),
    ]);
    const { summary, messages } = await parseCodexTranscript(file, { withMessages: true });

    assert.equal(summary.provider, 'codex');
    assert.equal(summary.id, 'aaaa0000-1111-4222-8333-444455556666');
    assert.equal(summary.projectPath, '/Users/dev/code/demo');
    assert.equal(summary.projectName, 'demo');
    assert.deepEqual(summary.models, ['gpt-5.4']);
    assert.equal(summary.firstUserMessage, 'hi there');
    assert.equal(summary.messageCount, 2, 'user + assistant only');

    // OpenAI input_tokens includes cached tokens; cacheRead is split out
    assert.deepEqual(summary.tokens, { input: 430, output: 33, cacheRead: 3072, cacheCreation: 0 });

    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'user');
    assert.deepEqual(messages[0].texts, ['hi there']);
    assert.equal(messages[1].role, 'assistant');
  });

  it('ignores agent_message events that duplicate assistant response items', async () => {
    const root = tempDir();
    const file = writeRollout(root, 'rollout-dup', [
      sessionMeta(),
      agentMessageEvent('same text'),
      assistantMessage('same text'),
    ]);
    const { messages } = await parseCodexTranscript(file, { withMessages: true });
    const assistants = messages.filter((m) => m.role === 'assistant');
    assert.equal(assistants.length, 1, 'the event_msg copy is skipped');
    assert.deepEqual(assistants[0].texts, ['same text']);
  });

  it('folds exec function calls and marks non-zero exits as failures', async () => {
    const root = tempDir();
    const file = writeRollout(root, 'rollout-tools', [
      sessionMeta(),
      turnContext(),
      functionCall('exec_command', { cmd: 'pwd', workdir: '/x' }, 'call_1'),
      functionOutput('call_1', 'Command: /bin/zsh -lc pwd\nProcess exited with code 0\nOutput:\n/x\n'),
      functionCall('shell_command', { command: 'npm test' }, 'call_2'),
      functionOutput('call_2', 'Command: npm test\nProcess exited with code 1\nOutput:\nfailing\n'),
    ]);
    const { summary, messages } = await parseCodexTranscript(file, { withMessages: true });

    assert.equal(summary.tools.command, 2);
    assert.equal(summary.tools.errors, 1);
    assert.equal(summary.tools.total, 2);

    const tools = messages.flatMap((m) => m.toolUses);
    assert.equal(tools.length, 2);
    assert.equal(tools[0].name, 'exec_command');
    assert.equal(tools[0].summary, 'pwd');
    assert.equal(tools[0].isError, false);
    assert.ok(tools[0].resultPreview?.includes('/x'));
    assert.equal(tools[1].name, 'shell_command');
    assert.equal(tools[1].summary, 'npm test');
    assert.equal(tools[1].isError, true);
  });

  it('maps apply_patch to files touched and unwraps the custom output', async () => {
    const root = tempDir();
    const patch = [
      '*** Begin Patch',
      '*** Add File: /proj/new.ts',
      '+export const x = 1;',
      '*** Update File: /proj/old.ts',
      '@@',
      '-const a = 1;',
      '+const a = 2;',
      '*** End Patch',
    ].join('\n');
    const file = writeRollout(root, 'rollout-patch', [
      sessionMeta(),
      patchCall(patch, 'call_p'),
      patchOutput('call_p', 'Success. Updated the following files:\nA /proj/new.ts\nM /proj/old.ts'),
    ]);
    const { summary, messages } = await parseCodexTranscript(file, { withMessages: true });

    assert.equal(summary.tools.edit, 1);
    const byPath = Object.fromEntries(summary.filesTouched.map((f) => [f.path, f]));
    assert.equal(byPath['/proj/new.ts'].operation, 'created');
    assert.equal(byPath['/proj/old.ts'].operation, 'edited');

    const tool = messages.flatMap((m) => m.toolUses)[0];
    assert.equal(tool.name, 'apply_patch');
    assert.equal(tool.filePath, '/proj/new.ts');
    assert.ok(tool.resultPreview?.startsWith('Success.'));
    assert.equal(tool.isError, false);
  });

  it('falls back to the filename uuid and tolerates malformed lines', async () => {
    const root = tempDir();
    const file = writeRollout(root, 'rollout-2026-04-10T17-17-50-bbbb1111-2222-4333-8444-555566667777', [
      '{"type":"response_item","payload":{ truncated write…',
      'not json at all',
      userMessage('still works'),
    ]);
    const { summary, messages } = await parseCodexTranscript(file, { withMessages: true });
    assert.equal(summary.id, 'bbbb1111-2222-4333-8444-555566667777');
    assert.equal(messages.length, 1);
    assert.equal(summary.firstUserMessage, 'still works');
  });

  it('discovers rollout files nested in dated directories', async () => {
    const root = tempDir();
    writeRollout(root, 'rollout-a', [sessionMeta('a')]);
    writeTranscript(path.join(root, '2025', '12', '09'), 'rollout-b', [sessionMeta('b')]);
    const found = await discoverCodexTranscripts(root);
    assert.equal(found.length, 2);
    assert.ok(found.every((f) => f.endsWith('.jsonl')));
  });
});

describe('multi-provider corpus', () => {
  it('merges claude and codex roots into one sorted corpus', async () => {
    const root = tempDir();
    const claudeDir = path.join(root, 'claude');
    const codexDir = path.join(root, 'codex');
    writeTranscript(path.join(claudeDir, 'proj'), 'claude-sess', [
      userEvent({ content: 'claude session', timestamp: '2026-01-30T10:00:00.000Z' }),
    ]);
    writeRollout(codexDir, 'rollout-c', [
      sessionMeta('codex-sess'),
      userMessage('codex session', '2026-01-31T10:00:00.000Z'),
    ]);

    const corpus = await parseCorpusMulti({ claude: claudeDir, codex: codexDir });
    assert.equal(corpus.sessions.length, 2);
    assert.deepEqual(
      corpus.sessions.map((s) => s.provider),
      ['codex', 'claude'],
      'newer codex session sorts first',
    );
    assert.ok(corpus.filesById.has('claude-sess'));
    assert.ok(corpus.filesById.has('codex-sess'));
    assert.ok(corpus.index.some((e) => e.text === 'codex session'));
  });

  it('missing roots are skipped without failing the scan', async () => {
    const corpus = await parseCorpusMulti({
      claude: path.join(tempDir(), 'nope'),
      codex: path.join(tempDir(), 'nada'),
      cursor: path.join(tempDir(), 'nichts'),
    });
    assert.deepEqual(corpus.sessions, []);
  });
});
