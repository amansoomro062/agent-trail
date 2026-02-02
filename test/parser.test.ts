import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  discoverTranscripts,
  parseCorpus,
  parseSessionDetail,
  parseTranscript,
} from '../src/parser.js';
import {
  assistantEvent,
  CWD,
  tempDir,
  textBlock,
  toolResult,
  toolUse,
  usage,
  userEvent,
  writeTranscript,
} from './helpers.js';

describe('streaming assistant chunks', () => {
  it('merges content by message.id and counts usage exactly once', async () => {
    const dir = tempDir();
    // Claude Code splits one API message across several JSONL lines. Each line
    // repeats the SAME usage object - naively summing them inflates the total.
    const file = writeTranscript(dir, 'session-1', [
      userEvent({ content: 'go' }),
      assistantEvent({
        id: 'msg_stream',
        content: [textBlock('First half. ')],
        usage: usage(100, 50, 4000, 200),
      }),
      assistantEvent({
        id: 'msg_stream',
        content: [textBlock('Second half.')],
        usage: usage(100, 50, 4000, 200),
      }),
      assistantEvent({
        id: 'msg_stream',
        content: [toolUse('toolu_1', 'Read', { file_path: '/a/b.ts' })],
        usage: usage(100, 50, 4000, 200),
      }),
    ]);

    const { summary, messages } = await parseTranscript(file, { withMessages: true });

    const assistants = messages.filter((m) => m.role === 'assistant');
    assert.equal(assistants.length, 1, 'three chunks collapse into one message');
    assert.deepEqual(assistants[0].texts, ['First half. ', 'Second half.']);
    assert.equal(assistants[0].toolUses.length, 1);

    assert.deepEqual(summary.tokens, {
      input: 100,
      output: 50,
      cacheRead: 4000,
      cacheCreation: 200,
    });
  });

  it('sums usage across distinct message ids', async () => {
    const dir = tempDir();
    const file = writeTranscript(dir, 'session-1', [
      assistantEvent({ id: 'msg_a', content: [textBlock('a')], usage: usage(10, 1, 5, 2) }),
      assistantEvent({ id: 'msg_b', content: [textBlock('b')], usage: usage(20, 2, 7, 3) }),
    ]);
    const { summary } = await parseTranscript(file, { withMessages: false });
    assert.deepEqual(summary.tokens, { input: 30, output: 3, cacheRead: 12, cacheCreation: 5 });
  });

  it('reports null tokens when no usage data is present', async () => {
    const dir = tempDir();
    const file = writeTranscript(dir, 'session-1', [
      assistantEvent({ id: 'msg_a', content: [textBlock('a')] }),
    ]);
    const { summary } = await parseTranscript(file, { withMessages: false });
    assert.equal(summary.tokens, null);
  });
});

describe('tool results', () => {
  it('folds a tool_result into its originating tool_use', async () => {
    const dir = tempDir();
    const file = writeTranscript(dir, 'session-1', [
      assistantEvent({
        id: 'msg_a',
        content: [toolUse('toolu_ok', 'Bash', { command: 'npm test' })],
      }),
      userEvent({ content: [toolResult('toolu_ok', 'All tests passed')] }),
    ]);

    const { messages } = await parseTranscript(file, { withMessages: true });
    const tool = messages[0].toolUses[0];
    assert.equal(tool.resultPreview, 'All tests passed');
    assert.equal(tool.isError, false);
    assert.equal(tool.summary, 'npm test');

    // the carrier user event collapses away entirely
    assert.equal(messages.length, 1, 'pure tool-result carrier is not its own message');
  });

  it('marks errored results', async () => {
    const dir = tempDir();
    const file = writeTranscript(dir, 'session-1', [
      assistantEvent({ id: 'msg_a', content: [toolUse('toolu_bad', 'Bash', { command: 'exit 1' })] }),
      userEvent({ content: [toolResult('toolu_bad', 'boom', true)] }),
    ]);
    const { messages } = await parseTranscript(file, { withMessages: true });
    assert.equal(messages[0].toolUses[0].isError, true);
    assert.equal(messages[0].toolUses[0].resultPreview, 'boom');
  });

  it('keeps an orphan tool_result whose tool_use never appeared', async () => {
    const dir = tempDir();
    // Happens when a transcript is truncated or resumed mid-flight.
    const file = writeTranscript(dir, 'session-1', [
      userEvent({ content: [toolResult('toolu_missing', 'dangling output')] }),
    ]);
    const { messages } = await parseTranscript(file, { withMessages: true });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].toolResults.length, 1);
    assert.equal(messages[0].toolResults[0].preview, 'dangling output');
  });

  it('extracts text from block-array result content', async () => {
    const dir = tempDir();
    const file = writeTranscript(dir, 'session-1', [
      assistantEvent({ id: 'msg_a', content: [toolUse('toolu_1', 'Read', { file_path: '/x.ts' })] }),
      userEvent({
        content: [
          toolResult('toolu_1', [
            { type: 'text', text: 'line one' },
            { type: 'text', text: 'line two' },
          ]),
        ],
      }),
    ]);
    const { messages } = await parseTranscript(file, { withMessages: true });
    assert.equal(messages[0].toolUses[0].resultPreview, 'line one\nline two');
  });

  it('truncates a very large result preview', async () => {
    const dir = tempDir();
    const huge = 'x'.repeat(5000);
    const file = writeTranscript(dir, 'session-1', [
      assistantEvent({ id: 'msg_a', content: [toolUse('toolu_1', 'Read', { file_path: '/x.ts' })] }),
      userEvent({ content: [toolResult('toolu_1', huge)] }),
    ]);
    const { messages } = await parseTranscript(file, { withMessages: true });
    const preview = messages[0].toolUses[0].resultPreview ?? '';
    assert.equal(preview.length, 2001, '2000 chars plus the ellipsis');
    assert.ok(preview.endsWith('…'));
  });
});

describe('malformed input', () => {
  it('skips unparseable lines without losing the rest of the file', async () => {
    const dir = tempDir();
    const file = writeTranscript(dir, 'session-1', [
      userEvent({ content: 'first' }),
      '{"type":"assistant","message":{ truncated write…',
      '',
      'not json at all',
      '[1,2,3]',
      userEvent({ content: 'second' }),
    ]);

    const { summary, messages } = await parseTranscript(file, { withMessages: true });
    assert.equal(messages.length, 2);
    assert.equal(summary.messageCount, 2);
    assert.equal(summary.firstUserMessage, 'first');
  });

  it('ignores event types it does not model', async () => {
    const dir = tempDir();
    const file = writeTranscript(dir, 'session-1', [
      { type: 'file-history-snapshot', snapshot: {} },
      { type: 'system', subtype: 'init' },
      { type: 'queue-operation' },
      userEvent({ content: 'only real message' }),
    ]);
    const { summary } = await parseTranscript(file, { withMessages: false });
    assert.equal(summary.messageCount, 1);
  });

  it('returns an empty summary for a missing file rather than throwing', async () => {
    const dir = tempDir();
    const summary = await parseSessionDetail(path.join(dir, 'does-not-exist.jsonl'));
    assert.equal(summary.messageCount, 0);
    assert.equal(summary.mtime, 0);
    assert.deepEqual(summary.messages, []);
  });
});

describe('session metadata', () => {
  it('excludes the <synthetic> placeholder from the model list', async () => {
    const dir = tempDir();
    const file = writeTranscript(dir, 'session-1', [
      assistantEvent({ id: 'msg_a', content: [textBlock('hi')], model: 'claude-opus-5' }),
      assistantEvent({ id: 'msg_b', content: [textBlock('yo')], model: '<synthetic>' }),
    ]);
    const { summary } = await parseTranscript(file, { withMessages: false });
    assert.deepEqual(summary.models, ['claude-opus-5']);
  });

  it('excludes meta events from the message count and title', async () => {
    const dir = tempDir();
    const file = writeTranscript(dir, 'session-1', [
      userEvent({ content: 'system bookkeeping', isMeta: true }),
      userEvent({ content: 'the real first prompt' }),
    ]);
    const { summary } = await parseTranscript(file, { withMessages: false });
    assert.equal(summary.messageCount, 1);
    assert.equal(summary.firstUserMessage, 'the real first prompt');
  });

  it('skips markup-style payloads when picking a title', async () => {
    const dir = tempDir();
    const file = writeTranscript(dir, 'session-1', [
      userEvent({ content: '<command-name>/init</command-name>' }),
      userEvent({ content: 'actually do the thing' }),
    ]);
    const { summary } = await parseTranscript(file, { withMessages: false });
    assert.equal(summary.firstUserMessage, 'actually do the thing');
  });

  it('collapses whitespace in the title', async () => {
    const dir = tempDir();
    const file = writeTranscript(dir, 'session-1', [
      userEvent({ content: 'line one\n\n   line two\t\tline three' }),
    ]);
    const { summary } = await parseTranscript(file, { withMessages: false });
    assert.equal(summary.firstUserMessage, 'line one line two line three');
  });

  it('derives start/end times from the extremes, not the file order', async () => {
    const dir = tempDir();
    const file = writeTranscript(dir, 'session-1', [
      userEvent({ content: 'b', timestamp: '2026-01-30T12:00:00.000Z' }),
      userEvent({ content: 'a', timestamp: '2026-01-30T09:00:00.000Z' }),
      userEvent({ content: 'c', timestamp: '2026-01-30T15:00:00.000Z' }),
    ]);
    const { summary } = await parseTranscript(file, { withMessages: false });
    assert.equal(summary.startTime, '2026-01-30T09:00:00.000Z');
    assert.equal(summary.endTime, '2026-01-30T15:00:00.000Z');
  });

  it('takes the project path from cwd and derives the display name', async () => {
    const dir = tempDir();
    const file = writeTranscript(dir, 'session-1', [userEvent({ content: 'hi' })]);
    const { summary } = await parseTranscript(file, { withMessages: false });
    assert.equal(summary.projectPath, CWD);
    assert.equal(summary.projectName, 'demo');
    assert.equal(summary.id, 'session-1');
  });

  it('handles string-valued user content as well as block arrays', async () => {
    const dir = tempDir();
    const file = writeTranscript(dir, 'session-1', [
      userEvent({ content: 'plain string form' }),
      userEvent({ content: [{ type: 'text', text: 'block form' }] }),
    ]);
    const { messages } = await parseTranscript(file, { withMessages: true });
    assert.deepEqual(messages[0].texts, ['plain string form']);
    assert.deepEqual(messages[1].texts, ['block form']);
  });

  it('flags sidechain (subagent) messages', async () => {
    const dir = tempDir();
    const file = writeTranscript(dir, 'session-1', [
      assistantEvent({ id: 'msg_a', content: [textBlock('from a subagent')], isSidechain: true }),
    ]);
    const { messages } = await parseTranscript(file, { withMessages: true });
    assert.equal(messages[0].isSidechain, true);
  });

  it('omits messages when withMessages is false but still indexes them', async () => {
    const dir = tempDir();
    const file = writeTranscript(dir, 'session-1', [userEvent({ content: 'searchable text' })]);
    const { messages, indexEntries } = await parseTranscript(file, { withMessages: false });
    assert.deepEqual(messages, []);
    assert.equal(indexEntries.length, 1);
    assert.equal(indexEntries[0].text, 'searchable text');
  });
});

describe('files touched', () => {
  it('ranks a file by its strongest operation and totals every touch', async () => {
    const dir = tempDir();
    const file = writeTranscript(dir, 'session-1', [
      assistantEvent({
        id: 'msg_a',
        content: [
          toolUse('t1', 'Read', { file_path: '/proj/a.ts' }),
          toolUse('t2', 'Edit', { file_path: '/proj/a.ts' }),
          toolUse('t3', 'Read', { file_path: '/proj/a.ts' }),
          toolUse('t4', 'Read', { file_path: '/proj/only-read.ts' }),
          toolUse('t5', 'Write', { file_path: '/proj/new.ts' }),
          toolUse('t6', 'Bash', { command: 'ls' }),
        ],
      }),
    ]);

    const { summary } = await parseTranscript(file, { withMessages: false });
    const byPath = Object.fromEntries(summary.filesTouched.map((f) => [f.path, f]));

    // Edit outranks the two Reads, but the count includes all three touches.
    assert.equal(byPath['/proj/a.ts'].operation, 'edited');
    assert.equal(byPath['/proj/a.ts'].count, 3);
    assert.deepEqual(byPath['/proj/a.ts'].tools, ['Edit', 'Read']);

    assert.equal(byPath['/proj/new.ts'].operation, 'created');
    assert.equal(byPath['/proj/only-read.ts'].operation, 'read');

    // Bash carries no file_path, so it contributes nothing here.
    assert.equal(summary.filesTouched.length, 3);

    // created first, edited next, reads last
    assert.deepEqual(
      summary.filesTouched.map((f) => f.operation),
      ['created', 'edited', 'read'],
    );
  });

  it('summarizes tool calls per tool type', async () => {
    const dir = tempDir();
    const file = writeTranscript(dir, 'session-1', [
      assistantEvent({
        id: 'msg_a',
        content: [
          toolUse('t1', 'Bash', { command: 'npm   run    build' }),
          toolUse('t2', 'WebFetch', { url: 'https://example.com' }),
          toolUse('t3', 'Grep', { pattern: 'TODO' }),
          toolUse('t4', 'Task', { description: 'audit deps', prompt: 'long prompt' }),
        ],
      }),
    ]);
    const { messages } = await parseTranscript(file, { withMessages: true });
    const summaries = messages[0].toolUses.map((t) => t.summary);
    assert.deepEqual(summaries, [
      'npm run build', // whitespace collapsed
      'https://example.com',
      'TODO',
      'audit deps', // description wins over prompt
    ]);
  });
});

describe('corpus discovery', () => {
  it('finds .jsonl files exactly one level deep', async () => {
    const root = tempDir();
    writeTranscript(path.join(root, 'proj-a'), 'sess-1', [userEvent({ content: 'a' })]);
    writeTranscript(path.join(root, 'proj-b'), 'sess-2', [userEvent({ content: 'b' })]);
    // decoys
    fs.writeFileSync(path.join(root, 'top-level.jsonl'), '{}\n');
    fs.writeFileSync(path.join(root, 'proj-a', 'notes.md'), 'ignore me\n');
    writeTranscript(path.join(root, 'proj-a', 'nested'), 'sess-3', [userEvent({ content: 'c' })]);

    const found = await discoverTranscripts(root);
    assert.deepEqual(
      found.map((f) => path.basename(f)).sort(),
      ['sess-1.jsonl', 'sess-2.jsonl'],
    );
  });

  it('returns an empty list for a directory that does not exist', async () => {
    assert.deepEqual(await discoverTranscripts('/no/such/place'), []);
  });

  it('sorts sessions by end time, newest first', async () => {
    const root = tempDir();
    writeTranscript(path.join(root, 'p'), 'old', [
      userEvent({ content: 'old', timestamp: '2026-01-28T10:00:00.000Z' }),
    ]);
    writeTranscript(path.join(root, 'p'), 'new', [
      userEvent({ content: 'new', timestamp: '2026-01-30T10:00:00.000Z' }),
    ]);
    writeTranscript(path.join(root, 'p'), 'mid', [
      userEvent({ content: 'mid', timestamp: '2026-01-29T10:00:00.000Z' }),
    ]);

    const corpus = await parseCorpus(root);
    assert.deepEqual(
      corpus.sessions.map((s) => s.id),
      ['new', 'mid', 'old'],
    );
    assert.equal(corpus.filesById.size, 3);
    assert.equal(corpus.index.length, 3);
  });

  it('survives one unreadable transcript among many', async () => {
    const root = tempDir();
    writeTranscript(path.join(root, 'p'), 'good', [userEvent({ content: 'fine' })]);
    fs.writeFileSync(path.join(root, 'p', 'broken.jsonl'), '{ this is not json\n');

    const corpus = await parseCorpus(root);
    assert.equal(corpus.sessions.length, 2, 'the broken file yields an empty session, not a crash');
    const good = corpus.sessions.find((s) => s.id === 'good');
    assert.equal(good?.firstUserMessage, 'fine');
  });
});
