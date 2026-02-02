import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, ToolEvent, ToolResult } from '../types';
import { basename, clockTime, dirname, shortModel } from '../format';
import ToolIcon, { toolKind } from './ToolIcon';

/* ------------------------------------------------------------------
   Tool rows. Hierarchy comes from surface level + ink weight, never
   from hue - the single exception is an errored call. See DESIGN.md.
   ------------------------------------------------------------------ */

type Tier = 'mutate' | 'run' | 'inspect' | 'error';

function tierOf(tool: ToolEvent): Tier {
  if (tool.isError) return 'error';
  const kind = toolKind(tool.name);
  if (kind === 'write' || kind === 'edit') return 'mutate';
  if (kind === 'bash' || kind === 'task') return 'run';
  return 'inspect';
}

const TIER: Record<Tier, { chip: string; name: string; target: string }> = {
  mutate: {
    chip: 'border-hairline-strong bg-surface-3 text-ink',
    name: 'text-ink',
    target: 'text-ink-muted',
  },
  run: {
    chip: 'border-hairline bg-surface-2 text-ink-muted',
    name: 'text-ink-muted',
    target: 'text-ink-subtle',
  },
  inspect: {
    chip: 'border-hairline bg-surface-1 text-ink-tertiary',
    name: 'text-ink-subtle',
    target: 'text-ink-tertiary',
  },
  error: {
    chip: 'border-[var(--error-line)] bg-[var(--error-bg)] text-error',
    name: 'text-error',
    target: 'text-ink-muted',
  },
};

function Chevron({ open, className = '' }: { open: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      className={`h-2.5 w-2.5 shrink-0 transition-transform duration-150 ease-out ${
        open ? 'rotate-90' : ''
      } ${className}`}
      aria-hidden="true"
    >
      <path d="m4 2 4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** One tool call: icon · name · target, expandable to its result. */
function ToolCall({ tool }: { tool: ToolEvent }) {
  const [expanded, setExpanded] = useState(false);
  const target = tool.filePath ?? tool.summary ?? '';
  const hasResult = Boolean(tool.resultPreview);
  const t = TIER[tierOf(tool)];
  const isPath = Boolean(tool.filePath);

  return (
    <div className="border-b border-hairline last:border-b-0">
      <button
        onClick={() => hasResult && setExpanded((v) => !v)}
        aria-expanded={hasResult ? expanded : undefined}
        className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors duration-150 ease-out ${
          hasResult ? 'cursor-pointer hover:bg-surface-2' : 'cursor-default'
        }`}
      >
        <span
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border ${t.chip}`}
        >
          <ToolIcon kind={toolKind(tool.name)} />
        </span>
        <span className={`shrink-0 text-[12px] font-medium ${t.name}`}>{tool.name}</span>
        <span className={`mono min-w-0 truncate text-[12px] ${t.target}`}>
          {isPath ? (
            <>
              <span className="text-ink-tertiary">{dirname(target)}</span>
              {basename(target)}
            </>
          ) : (
            target
          )}
        </span>
        {hasResult && <Chevron open={expanded} className="ml-auto text-ink-tertiary" />}
      </button>
      {expanded && tool.resultPreview && (
        <pre className="mono pop-open max-h-64 overflow-auto whitespace-pre-wrap break-all border-t border-hairline bg-canvas px-3 py-2 text-[11px] leading-relaxed text-ink-subtle">
          {tool.resultPreview}
        </pre>
      )}
    </div>
  );
}

/** An orphaned tool_result - one whose tool_use never appeared in the transcript. */
function OrphanResult({ result }: { result: ToolResult }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border-b border-hairline last:border-b-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors duration-150 ease-out hover:bg-surface-2"
      >
        <Chevron open={expanded} className="text-ink-tertiary" />
        <span className={`text-[12px] ${result.isError ? 'text-error' : 'text-ink-subtle'}`}>
          {result.isError ? 'Tool error' : 'Tool result'}
        </span>
      </button>
      {expanded && (
        <pre className="mono pop-open max-h-64 overflow-auto whitespace-pre-wrap break-all border-t border-hairline bg-canvas px-3 py-2 text-[11px] leading-relaxed text-ink-subtle">
          {result.preview}
        </pre>
      )}
    </div>
  );
}

/** Bordered container that holds a run of tool rows. */
function ToolList({ tools, results }: { tools: ToolEvent[]; results: ToolResult[] }) {
  if (tools.length === 0 && results.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-surface-1">
      {tools.map((t, i) => (
        <ToolCall key={t.id || `${t.name}-${i}`} tool={t} />
      ))}
      {results.map((r, i) => (
        <OrphanResult key={r.toolUseId || `orphan-${i}`} result={r} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------
   Grouping: consecutive text-free tool messages collapse into one
   foldable run, so a 40-call stretch doesn't bury the conversation.
   ------------------------------------------------------------------ */

interface ToolRun {
  tools: ToolEvent[];
  results: ToolResult[];
  start: string;
  end: string;
  errors: number;
}
type Block = { kind: 'message'; msg: Message } | { kind: 'run'; run: ToolRun };

const isQuiet = (m: Message) => m.texts.join('').trim() === '';

function groupMessages(messages: Message[]): Block[] {
  const blocks: Block[] = [];
  let tools: ToolEvent[] = [];
  let results: ToolResult[] = [];
  let first: Message | null = null;
  let last: Message | null = null;

  const flush = () => {
    if (!first) return;
    blocks.push({
      kind: 'run',
      run: {
        tools,
        results,
        start: first.timestamp,
        end: (last ?? first).timestamp,
        errors:
          tools.filter((t) => t.isError).length + results.filter((r) => r.isError).length,
      },
    });
    tools = [];
    results = [];
    first = null;
    last = null;
  };

  for (const m of messages) {
    if (isQuiet(m) && m.toolUses.length > 0) {
      first ??= m;
      last = m;
      tools.push(...m.toolUses);
      results.push(...m.toolResults);
    } else if (isQuiet(m) && m.toolResults.length > 0 && first) {
      last = m;
      results.push(...m.toolResults);
    } else {
      flush();
      blocks.push({ kind: 'message', msg: m });
    }
  }
  flush();
  return blocks;
}

/** Summarize a run as plain counts: "6 edits · 3 commands · 12 reads". */
function describeRun(run: ToolRun): string {
  const n = (pred: (t: ToolEvent) => boolean) => run.tools.filter(pred).length;
  const mutations = n((t) => ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(t.name));
  const commands = n((t) => t.name === 'Bash');
  const searches = n((t) => ['Grep', 'Glob', 'WebSearch', 'WebFetch'].includes(t.name));
  const reads = n((t) => t.name === 'Read');
  const tasks = n((t) => ['Task', 'Agent', 'Skill'].includes(t.name));
  const other = run.tools.length - mutations - commands - searches - reads - tasks;

  const plural = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`;
  const parts = [
    mutations && plural(mutations, 'edit', 'edits'),
    commands && plural(commands, 'command', 'commands'),
    searches && plural(searches, 'search', 'searches'),
    reads && plural(reads, 'read', 'reads'),
    tasks && plural(tasks, 'task', 'tasks'),
    other && plural(other, 'call', 'calls'),
  ].filter(Boolean) as string[];

  return parts.join(' · ') || 'no calls';
}

/** A collapsed run of tool calls. */
function ToolRunBlock({ run }: { run: ToolRun }) {
  const [expanded, setExpanded] = useState(false);
  const startFmt = clockTime(run.start);
  const endFmt = clockTime(run.end);

  // A single call with no result is clearer shown outright than folded.
  if (run.tools.length === 1 && run.results.length === 0) {
    return (
      <div className="flex gap-3 py-1.5">
        <span className="num mono w-10 shrink-0 pt-1.5 text-right text-[11px] text-ink-tertiary">
          {startFmt}
        </span>
        <div className="min-w-0 max-w-3xl flex-1">
          <ToolList tools={run.tools} results={[]} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 py-1.5">
      <span className="num mono w-10 shrink-0 pt-2 text-right text-[11px] text-ink-tertiary">
        {startFmt}
      </span>
      <div className="min-w-0 max-w-3xl flex-1">
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className={`flex w-full items-center gap-2.5 border border-hairline bg-surface-1 px-2.5 py-1.5 text-left transition-colors duration-150 ease-out hover:bg-surface-2 ${
            expanded ? 'rounded-t-lg border-b-0' : 'rounded-lg'
          }`}
        >
          <Chevron open={expanded} className="text-ink-tertiary" />
          <span className="text-[12px] font-medium text-ink-muted">
            {run.tools.length} tool {run.tools.length === 1 ? 'call' : 'calls'}
          </span>
          <span className="num truncate text-[12px] text-ink-tertiary">{describeRun(run)}</span>
          {run.errors > 0 && (
            <span className="num shrink-0 rounded border border-[var(--error-line)] bg-[var(--error-bg)] px-1.5 py-px text-[11px] font-medium text-error">
              {run.errors} failed
            </span>
          )}
          {endFmt !== startFmt && (
            <span className="num mono ml-auto shrink-0 text-[11px] text-ink-tertiary">
              → {endFmt}
            </span>
          )}
        </button>
        {expanded && (
          <div className="pop-open overflow-hidden rounded-b-lg border border-hairline bg-surface-1">
            {run.tools.map((t, i) => (
              <ToolCall key={t.id || `${t.name}-${i}`} tool={t} />
            ))}
            {run.results.map((r, i) => (
              <OrphanResult key={r.toolUseId || `orphan-${i}`} result={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Message rows
   ------------------------------------------------------------------ */

function MessageRow({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  const text = msg.texts.join('\n\n').trim();
  const hasTools = msg.toolUses.length > 0 || msg.toolResults.length > 0;

  return (
    <div className="flex gap-3 py-2.5">
      <span className="num mono w-10 shrink-0 pt-0.5 text-right text-[11px] text-ink-tertiary">
        {clockTime(msg.timestamp)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline gap-2">
          <span className={`text-[12px] font-medium ${isUser ? 'text-ink' : 'text-ink-subtle'}`}>
            {isUser ? 'You' : msg.model ? shortModel(msg.model) : 'Assistant'}
          </span>
          {msg.isSidechain && (
            <span className="rounded border border-hairline px-1.5 py-px text-[11px] text-ink-tertiary">
              subagent
            </span>
          )}
        </div>

        {text &&
          (isUser ? (
            /* user turns are the anchors you scan for - lift them one step */
            <div className="max-w-3xl whitespace-pre-wrap break-words rounded-lg border border-hairline bg-surface-1 px-3 py-2 text-[14px] leading-[1.6] text-ink">
              {text}
            </div>
          ) : (
            <div className="md max-w-3xl break-words text-[14px] leading-[1.6] text-ink-muted">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
            </div>
          ))}

        {hasTools && (
          <div className={`max-w-3xl ${text ? 'mt-2' : ''}`}>
            <ToolList tools={msg.toolUses} results={msg.toolResults} />
          </div>
        )}
      </div>
    </div>
  );
}

interface Props {
  messages: Message[];
}

/** The conversation timeline for the selected session. */
export default function Timeline({ messages }: Props) {
  if (messages.length === 0) {
    return <p className="px-6 py-5 text-[13px] text-ink-tertiary">No messages in this session.</p>;
  }
  const blocks = groupMessages(messages);
  return (
    <div className="divide-y divide-hairline px-5 py-2">
      {blocks.map((b, i) =>
        b.kind === 'message' ? (
          <MessageRow key={b.msg.uuid} msg={b.msg} />
        ) : (
          <ToolRunBlock key={`run-${i}-${b.run.start}`} run={b.run} />
        ),
      )}
    </div>
  );
}
