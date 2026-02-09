/** Mirrors of the server-side types (src/types.ts) used by the API. */

export interface FileEdit {
  path: string;
  operation: 'created' | 'edited' | 'read';
  tools: string[];
  count: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export type ToolCategory = 'edit' | 'command' | 'read' | 'search' | 'task';

export interface ToolTally {
  edit: number;
  command: number;
  read: number;
  search: number;
  task: number;
  errors: number;
  total: number;
}

export interface SessionSummary {
  id: string;
  projectPath: string;
  projectName: string;
  file: string;
  startTime: string | null;
  endTime: string | null;
  messageCount: number;
  models: string[];
  tokens: TokenUsage | null;
  filesTouched: FileEdit[];
  tools: ToolTally;
  firstUserMessage: string | null;
  mtime: number;
}

export interface ToolEvent {
  id: string;
  name: string;
  filePath?: string;
  summary?: string;
  resultPreview?: string;
  isError?: boolean;
}

export interface ToolResult {
  toolUseId: string;
  isError: boolean;
  preview: string;
}

export interface Message {
  uuid: string;
  role: 'user' | 'assistant';
  timestamp: string;
  texts: string[];
  toolUses: ToolEvent[];
  toolResults: ToolResult[];
  model?: string;
  isSidechain?: boolean;
}

export interface SessionDetail extends SessionSummary {
  messages: Message[];
}

export interface SearchHit {
  sessionId: string;
  projectPath: string;
  projectName: string;
  messageUuid: string | null;
  role: 'user' | 'assistant' | 'file';
  timestamp: string | null;
  snippet: string;
}
