/**
 * Normalized data model for agenttrail.
 *
 * These types are produced by the parser from Claude Code `.jsonl` transcripts
 * and consumed by both the HTTP API and the web dashboard.
 */

/** A file touched by the agent during a session. */
export interface FileEdit {
  /** Absolute file path as it appeared in the tool call. */
  path: string;
  /** Dominant operation: created (Write) > edited (Edit/MultiEdit) > read (Read). */
  operation: 'created' | 'edited' | 'read';
  /** Which tool(s) touched the file, e.g. ["Edit", "Read"]. */
  tools: string[];
  /** Total number of tool calls touching this file. */
  count: number;
}

/** Aggregate token usage for a session (summed over unique API messages). */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

/**
 * Tool categories. These drive both the tally below and the categorical color
 * slots in the dashboard, so the set is deliberately small - five is the most
 * a stacked bar can carry while staying readable.
 */
export type ToolCategory = 'edit' | 'command' | 'read' | 'search' | 'task';

export const TOOL_CATEGORIES: ToolCategory[] = ['edit', 'command', 'read', 'search', 'task'];

/** Per-session count of tool calls by category. */
export interface ToolTally {
  edit: number;
  command: number;
  read: number;
  search: number;
  task: number;
  /** Calls whose result carried is_error. */
  errors: number;
  /** Sum of the five categories. */
  total: number;
}

/** Lightweight session metadata, shown in the sidebar list. */
export interface SessionSummary {
  /** Session UUID (filename without .jsonl). */
  id: string;
  /** Working directory of the session (from event `cwd` fields). */
  projectPath: string;
  /** Basename of projectPath, for display. */
  projectName: string;
  /** Absolute path of the source .jsonl file. */
  file: string;
  /** ISO timestamps of first/last parsed event. */
  startTime: string | null;
  endTime: string | null;
  /** Count of user + assistant events (excluding meta events). */
  messageCount: number;
  /** Distinct model ids seen in assistant messages. */
  models: string[];
  /** Summed token usage, null if no usage data was present. */
  tokens: TokenUsage | null;
  /** Files touched via Edit/Write/MultiEdit/Read tools. */
  filesTouched: FileEdit[];
  /** Tool calls bucketed by category - drives the activity visualizations. */
  tools: ToolTally;
  /** First real user text message, used as a session title hint. */
  firstUserMessage: string | null;
  /** File modification time of the transcript (ms epoch) - used for recency sort. */
  mtime: number;
}

/** One old/new string pair from an Edit or MultiEdit tool call. */
export interface EditDiff {
  /** Text being replaced (input old_string). */
  oldText: string;
  /** Replacement text (input new_string). */
  newText: string;
}

/** A single tool invocation inside an assistant message. */
export interface ToolEvent {
  /** tool_use block id (toolu_...). */
  id: string;
  /** Tool name, e.g. Edit, Write, Bash, WebFetch. */
  name: string;
  /** File path for file-oriented tools (Edit/Write/Read/MultiEdit/NotebookEdit). */
  filePath?: string;
  /** Short human-readable summary (command, url, prompt, etc.). */
  summary?: string;
  /**
   * Old/new string pairs, populated only for Edit (one pair) and MultiEdit
   * (one per edit). Absent for every other tool so the model stays small.
   */
  edits?: EditDiff[];
  /** Preview of the matching tool_result (truncated), filled in post-pass. */
  resultPreview?: string;
  /** True if the matching tool_result had is_error set. */
  isError?: boolean;
}

/** A tool_result block carried by a user-role event. */
export interface ToolResult {
  toolUseId: string;
  isError: boolean;
  /** Truncated text preview of the result. */
  preview: string;
}

/** One message in the conversation timeline. */
export interface Message {
  uuid: string;
  role: 'user' | 'assistant';
  timestamp: string;
  /** Text blocks (user prompts, assistant replies). */
  texts: string[];
  /** Tool calls made in this message (assistant only). */
  toolUses: ToolEvent[];
  /** Tool results carried by this event (user role only). */
  toolResults: ToolResult[];
  /** Model id (assistant only). */
  model?: string;
  /** True for sidechain (subagent/Task) messages. */
  isSidechain?: boolean;
}

/** Full session detail: summary + message timeline. */
export interface SessionDetail extends SessionSummary {
  messages: Message[];
}

/** One search hit returned by GET /api/search. */
export interface SearchHit {
  sessionId: string;
  projectPath: string;
  projectName: string;
  messageUuid: string | null;
  role: 'user' | 'assistant' | 'file';
  timestamp: string | null;
  /** Matched text with surrounding context. */
  snippet: string;
}

/** A message stub kept in memory for cross-session full-text search. */
export interface SearchIndexEntry {
  sessionId: string;
  projectPath: string;
  projectName: string;
  messageUuid: string;
  role: 'user' | 'assistant';
  timestamp: string;
  /** Concatenated text of the message, truncated for indexing. */
  text: string;
}
