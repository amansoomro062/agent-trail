/**
 * Tool glyphs. Rendered in white on the category-colored chip, so the icon is
 * the secondary encoding that keeps identity from resting on hue alone.
 */

const P = {
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  stroke: 'currentColor',
  fill: 'none',
};

const GLYPHS: Record<string, JSX.Element> = {
  edit: <path d="M9.5 2.5 11.5 4.5 5 11H3V9l6.5-6.5Z" {...P} />,
  write: (
    <>
      <rect x="2.5" y="2.5" width="9" height="9" rx="2" {...P} />
      <path d="M7 5v4M5 7h4" {...P} />
    </>
  ),
  read: (
    <>
      <path d="M3.5 2.5h4l3 3v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z" {...P} />
      <path d="M7.5 2.5v3h3" {...P} />
    </>
  ),
  bash: (
    <>
      <path d="M3 4.5 5.5 7 3 9.5" {...P} />
      <path d="M7 10h4" {...P} />
    </>
  ),
  search: (
    <>
      <circle cx="6.3" cy="6.3" r="3.3" {...P} />
      <path d="m8.9 8.9 2.3 2.3" {...P} />
    </>
  ),
  web: (
    <>
      <circle cx="7" cy="7" r="4.5" {...P} />
      <path d="M2.5 7h9M7 2.5c1.2 1.3 1.8 2.9 1.8 4.5S8.2 10.2 7 11.5c-1.2-1.3-1.8-2.9-1.8-4.5S5.8 3.8 7 2.5Z" {...P} />
    </>
  ),
  task: (
    <>
      <rect x="2.5" y="2.5" width="6" height="6" rx="1.5" {...P} />
      <path d="M5.5 11.5h4a2 2 0 0 0 2-2v-4" {...P} />
    </>
  ),
  other: (
    <>
      <circle cx="7" cy="7" r="4.5" {...P} />
      <circle cx="7" cy="7" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
};

function glyphFor(name: string): JSX.Element {
  if (name === 'Write') return GLYPHS.write;
  if (['Edit', 'MultiEdit', 'NotebookEdit'].includes(name)) return GLYPHS.edit;
  if (name === 'Read') return GLYPHS.read;
  if (['Bash', 'BashOutput', 'KillShell'].includes(name)) return GLYPHS.bash;
  if (['Grep', 'Glob', 'WebSearch'].includes(name)) return GLYPHS.search;
  if (name === 'WebFetch') return GLYPHS.web;
  if (['Task', 'Agent', 'Skill'].includes(name)) return GLYPHS.task;
  return GLYPHS.other;
}

export default function ToolIcon({
  name,
  className = 'h-3 w-3',
}: {
  name: string;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 14 14" fill="none" className={className} aria-hidden="true">
      {glyphFor(name)}
    </svg>
  );
}
