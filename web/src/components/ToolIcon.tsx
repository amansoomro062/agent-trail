/** Category icons for tool calls. Monochrome by design - see DESIGN.md. */

const P = {
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  stroke: 'currentColor',
};

const PATHS: Record<string, JSX.Element> = {
  // pencil - Edit / MultiEdit / NotebookEdit
  edit: <path d="M9.5 2.5 11.5 4.5 5 11H3V9l6.5-6.5Z" fill="none" {...P} />,
  // plus square - Write
  write: (
    <>
      <rect x="2.5" y="2.5" width="9" height="9" rx="2" fill="none" {...P} />
      <path d="M7 5v4M5 7h4" {...P} />
    </>
  ),
  // document - Read
  read: (
    <>
      <path d="M3.5 2.5h4l3 3v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z" fill="none" {...P} />
      <path d="M7.5 2.5v3h3" {...P} />
    </>
  ),
  // prompt chevron - Bash
  bash: (
    <>
      <path d="M3 4.5 5.5 7 3 9.5" {...P} />
      <path d="M7 10h4" {...P} />
    </>
  ),
  // magnifier - Grep / Glob / WebSearch
  search: (
    <>
      <circle cx="6.3" cy="6.3" r="3.3" fill="none" {...P} />
      <path d="m8.9 8.9 2.3 2.3" {...P} />
    </>
  ),
  // globe - WebFetch
  web: (
    <>
      <circle cx="7" cy="7" r="4.5" fill="none" {...P} />
      <path d="M2.5 7h9M7 2.5c1.2 1.3 1.8 2.9 1.8 4.5S8.2 10.2 7 11.5c-1.2-1.3-1.8-2.9-1.8-4.5S5.8 3.8 7 2.5Z" fill="none" {...P} />
    </>
  ),
  // stacked panes - Task / Agent / Skill
  task: (
    <>
      <rect x="2.5" y="2.5" width="6" height="6" rx="1.5" fill="none" {...P} />
      <path d="M5.5 11.5h4a2 2 0 0 0 2-2v-4" fill="none" {...P} />
    </>
  ),
  // gear-ish dot - anything else
  other: (
    <>
      <circle cx="7" cy="7" r="4.5" fill="none" {...P} />
      <circle cx="7" cy="7" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
};

export type ToolKind = keyof typeof PATHS;

export function toolKind(name: string): ToolKind {
  if (name === 'Write') return 'write';
  if (['Edit', 'MultiEdit', 'NotebookEdit'].includes(name)) return 'edit';
  if (name === 'Read') return 'read';
  if (name === 'Bash') return 'bash';
  if (['Grep', 'Glob', 'WebSearch'].includes(name)) return 'search';
  if (name === 'WebFetch') return 'web';
  if (['Task', 'Agent', 'Skill'].includes(name)) return 'task';
  return 'other';
}

export default function ToolIcon({ kind, className = 'h-3.5 w-3.5' }: { kind: ToolKind; className?: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" className={className} aria-hidden="true">
      {PATHS[kind]}
    </svg>
  );
}
