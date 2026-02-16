import { useCallback, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, ToolEvent, ToolResult } from '../types';
import { basename, clockTime, dirname, previewText, shortModel, wordCount } from '../format';
import { CATEGORY, categoryColor, toolCategory } from '../viz';
import ToolIcon from './ToolIcon';

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

/* ------------------------------------------------------------------ tools */

/** One tool call. The icon chip carries the category color; text stays ink. */
function ToolCall({ tool }: { tool: ToolEvent }) {
  const [expanded, setExpanded] = useState(false);
  const target = tool.filePath ?? tool.summary ?? '';
  const hasResult = Boolean(tool.resultPreview);
  const cat = toolCategory(tool.name);
  const failed = tool.isError === true;

  return (
    <div className="border-b border-line last:border-b-0">
      <button
        onClick={() => hasResult && setExpanded((v) => !v)}
        aria-expanded={hasResult ? expanded : undefined}
        className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors duration-150 ${
          hasResult ? 'cursor-pointer hover:bg-card-2' : 'cursor-default'
        }`}
      >
        <span
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-white"
          style={{ background: failed ? 'var(--danger)' : categoryColor(cat) }}
        >
          <ToolIcon name={tool.name} />
        </span>
        <span className={`shrink-0 text-[12px] font-medium ${failed ? 'text-danger' : 'text-ink'}`}>
          {tool.name}
        </span>
        <span className="mono min-w-0 truncate text-[12px] text-ink-2">
          {tool.filePath ? (
            <>
              <span className="text-ink-3">{dirname(target)}</span>
              {basename(target)}
            </>
          ) : (
            target
          )}
        </span>
        {failed && (
          <span className="shrink-0 rounded border border-danger-line bg-danger-wash px-1.5 py-px text-[11px] font-medium text-danger">
            failed
          </span>
        )}
        {hasResult && <Chevron open={expanded} className="ml-auto text-ink-3" />}
      </button>
      {expanded && tool.resultPreview && (
        <pre className="mono pop-open max-h-64 overflow-auto whitespace-pre-wrap break-all border-t border-line bg-sunken px-3 py-2 text-[11px] leading-relaxed text-ink-2">
          {tool.resultPreview}
        </pre>
      )}
    </div>
  );
}

function OrphanResult({ result }: { result: ToolResult }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border-b border-line last:border-b-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors duration-150 hover:bg-card-2"
      >
        <Chevron open={expanded} className="text-ink-3" />
        <span className={`text-[12px] ${result.isError ? 'text-danger' : 'text-ink-2'}`}>
          {result.isError ? 'Tool error' : 'Tool result'}
        </span>
      </button>
      {expanded && (
        <pre className="mono pop-open max-h-64 overflow-auto whitespace-pre-wrap break-all border-t border-line bg-sunken px-3 py-2 text-[11px] leading-relaxed text-ink-2">
          {result.preview}
        </pre>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- grouping */

interface ToolRun {
  tools: ToolEvent[];
  results: ToolResult[];
  uuids: string[];
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
  let uuids: string[] = [];
  let first: Message | null = null;
  let last: Message | null = null;

  const flush = () => {
    if (!first) return;
    blocks.push({
      kind: 'run',
      run: {
        tools,
        results,
        uuids,
        start: first.timestamp,
        end: (last ?? first).timestamp,
        errors: tools.filter((t) => t.isError).length + results.filter((r) => r.isError).length,
      },
    });
    tools = [];
    results = [];
    uuids = [];
    first = null;
    last = null;
  };

  for (const m of messages) {
    if (isQuiet(m) && m.toolUses.length > 0) {
      first ??= m;
      last = m;
      uuids.push(m.uuid);
      tools.push(...m.toolUses);
      results.push(...m.toolResults);
    } else if (isQuiet(m) && m.toolResults.length > 0 && first) {
      last = m;
      uuids.push(m.uuid);
      results.push(...m.toolResults);
    } else {
      flush();
      blocks.push({ kind: 'message', msg: m });
    }
  }
  flush();
  return blocks;
}

/** Counts by category, e.g. "3 edits · 1 command". */
function describeRun(run: ToolRun): string {
  const counts = new Map<string, number>();
  for (const t of run.tools) {
    const c = toolCategory(t.name);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([c, n]) => `${n} ${n === 1 ? CATEGORY[c as keyof typeof CATEGORY].one : CATEGORY[c as keyof typeof CATEGORY].label}`)
    .join(' · ');
}

/* -------------------------------------------------------------- the spine */

/** A node on the rail. Everything in the timeline hangs off one of these. */
function SpineRow({
  time,
  node,
  children,
  anchors = [],
}: {
  time: string;
  node: React.ReactNode;
  children: React.ReactNode;
  anchors?: string[];
}) {
  return (
    <div className="relative flex gap-3 py-2.5">
      {anchors.map((id) => (
        <span key={id} id={`ev-${id}`} className="absolute -top-16" aria-hidden="true" />
      ))}
      {/* the rail itself */}
      <span
        className="absolute bottom-0 left-[43px] top-0 w-px bg-line"
        aria-hidden="true"
      />
      <span className="num mono w-9 shrink-0 pt-1 text-right text-[11px] text-ink-3">{time}</span>
      <span className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center pt-0">
        {node}
      </span>
      <div className="min-w-0 flex-1 pb-0.5">{children}</div>
    </div>
  );
}

function MessageRow({
  msg,
  expanded,
  onToggle,
}: {
  msg: Message;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isUser = msg.role === 'user';
  const text = msg.texts.join('\n\n').trim();
  const hasTools = msg.toolUses.length > 0 || msg.toolResults.length > 0;
  // Your own turns are short and are the anchors you scan for - never collapsed.
  // Assistant prose is what buries the transcript, so it folds by default.
  const collapsible = !isUser && text.length > 0;
  const showText = isUser || expanded || !collapsible;

  const node = isUser ? (
    <span className="h-2.5 w-2.5 rounded-full bg-brand ring-4 ring-card" aria-hidden="true" />
  ) : (
    <span
      className="h-2 w-2 rounded-full bg-ink-3 ring-4 ring-card"
      aria-hidden="true"
    />
  );

  return (
    <SpineRow time={clockTime(msg.timestamp)} node={node} anchors={[msg.uuid]}>
      <div className="mb-1 flex items-baseline gap-2">
        <span className={`text-[12px] font-semibold ${isUser ? 'text-brand-text' : 'text-ink-2'}`}>
          {isUser ? 'You' : msg.model ? shortModel(msg.model) : 'Assistant'}
        </span>
        {msg.isSidechain && (
          <span className="rounded border border-line px-1.5 py-px text-[11px] text-ink-3">
            subagent
          </span>
        )}
        {collapsible && expanded && (
          <button
            onClick={onToggle}
            className="ml-auto shrink-0 text-[11px] text-ink-3 transition-colors duration-150 hover:text-ink"
          >
            Collapse
          </button>
        )}
      </div>

      {isUser && text && (
        <div className="whitespace-pre-wrap break-words rounded-lg border border-brand/25 bg-brand-wash px-3 py-2 text-[14px] leading-[1.6] text-ink">
          {text}
        </div>
      )}

      {collapsible && !showText && (
        <button
          onClick={onToggle}
          aria-expanded={false}
          className="group flex w-full items-center gap-2 rounded-lg border border-line bg-card px-3 py-1.5 text-left transition-colors duration-150 hover:border-line-strong hover:bg-card-2"
        >
          <Chevron open={false} className="shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink-3 group-hover:text-ink-2">
            {previewText(text)}
          </span>
          <span className="num shrink-0 text-[11px] text-ink-3">{wordCount(text)} words</span>
        </button>
      )}

      {!isUser && showText && text && (
        <div className="md break-words text-[14px] leading-[1.6] text-ink-2">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
      )}

      {hasTools && (
        <div className={`overflow-hidden rounded-lg border border-line ${text ? 'mt-2' : ''}`}>
          {msg.toolUses.map((t, i) => (
            <ToolCall key={t.id || `${msg.uuid}-${i}`} tool={t} />
          ))}
          {msg.toolResults.map((r, i) => (
            <OrphanResult key={r.toolUseId || `o-${i}`} result={r} />
          ))}
        </div>
      )}
    </SpineRow>
  );
}

function ToolRunBlock({ run }: { run: ToolRun }) {
  const [expanded, setExpanded] = useState(false);
  const startFmt = clockTime(run.start);
  const endFmt = clockTime(run.end);

  // a cluster of category dots stands in for the run while collapsed
  const dots = run.tools.slice(0, 12);

  return (
    <SpineRow
      time={startFmt}
      anchors={run.uuids}
      node={
        <span
          className="flex h-4 w-4 items-center justify-center rounded-[5px] border border-line bg-card ring-4 ring-card"
          aria-hidden="true"
        >
          <span className="h-1.5 w-1.5 rounded-[2px] bg-ink-3" />
        </span>
      }
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={`flex w-full items-center gap-2.5 border border-line bg-card px-3 py-1.5 text-left transition-colors duration-150 hover:bg-card-2 ${
          expanded ? 'rounded-t-lg border-b-0' : 'rounded-lg'
        }`}
      >
        <Chevron open={expanded} className="text-ink-3" />
        <span className="flex shrink-0 items-center gap-[3px]" aria-hidden="true">
          {dots.map((t, i) => (
            <span
              key={i}
              className="h-3 w-[5px] rounded-[2px]"
              style={{
                background: t.isError ? 'var(--danger)' : categoryColor(toolCategory(t.name)),
              }}
            />
          ))}
          {run.tools.length > dots.length && (
            <span className="ml-0.5 text-[11px] text-ink-3">+{run.tools.length - dots.length}</span>
          )}
        </span>
        <span className="truncate text-[12px] text-ink-2">{describeRun(run)}</span>
        {run.errors > 0 && (
          <span className="num shrink-0 rounded border border-danger-line bg-danger-wash px-1.5 py-px text-[11px] font-medium text-danger">
            {run.errors} failed
          </span>
        )}
        {endFmt !== startFmt && (
          <span className="num mono ml-auto shrink-0 text-[11px] text-ink-3">→ {endFmt}</span>
        )}
      </button>
      {expanded && (
        <div className="pop-open overflow-hidden rounded-b-lg border border-line">
          {run.tools.map((t, i) => (
            <ToolCall key={t.id || `${i}`} tool={t} />
          ))}
          {run.results.map((r, i) => (
            <OrphanResult key={r.toolUseId || `o-${i}`} result={r} />
          ))}
        </div>
      )}
    </SpineRow>
  );
}

const STORAGE_KEY = 'agenttrail-expand-replies';

export default function Timeline({ messages }: { messages: Message[] }) {
  /** Header state: the default for every assistant reply. Collapsed wins. */
  const [allExpanded, setAllExpanded] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  /** Per-message departures from that default. */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const setMode = (next: boolean) => {
    setAllExpanded(next);
    setOverrides({}); // the header wins - individual choices reset
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      /* private mode - the preference lasts for this session only */
    }
  };

  const toggle = useCallback(
    (uuid: string) => {
      setOverrides((o) => ({ ...o, [uuid]: !(uuid in o ? o[uuid] : allExpanded) }));
    },
    [allExpanded],
  );

  const blocks = useMemo(() => groupMessages(messages), [messages]);
  const replyCount = useMemo(
    () =>
      messages.filter((m) => m.role === 'assistant' && m.texts.join('').trim().length > 0).length,
    [messages],
  );

  if (messages.length === 0) {
    return <p className="px-4 py-5 text-[13px] text-ink-3">No messages in this session.</p>;
  }

  return (
    <>
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-card px-4 py-3">
        <h2 className="text-[13px] font-semibold text-ink">Transcript</h2>
        <span className="num text-[12px] text-ink-3">
          {messages.length} {messages.length === 1 ? 'message' : 'messages'}
        </span>
        {replyCount > 0 && (
          <button
            onClick={() => setMode(!allExpanded)}
            className="ml-auto rounded-lg border border-line px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors duration-150 hover:border-line-strong hover:bg-sunken hover:text-ink"
          >
            {allExpanded ? 'Collapse' : 'Expand'} all replies
          </button>
        )}
      </div>
      <div className="px-4 py-2">
        {blocks.map((b, i) =>
          b.kind === 'message' ? (
            <MessageRow
              key={b.msg.uuid}
              msg={b.msg}
              expanded={b.msg.uuid in overrides ? overrides[b.msg.uuid] : allExpanded}
              onToggle={() => toggle(b.msg.uuid)}
            />
          ) : (
            <ToolRunBlock key={`run-${i}-${b.run.start}`} run={b.run} />
          ),
        )}
      </div>
    </>
  );
}
