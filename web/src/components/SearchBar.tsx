import { useEffect, useRef, useState } from 'react';
import type { SearchHit } from '../types';
import { searchAll } from '../api';
import { shortDate } from '../format';

interface Props {
  onJump: (sessionId: string) => void;
}

const ROLE_LABEL: Record<SearchHit['role'], string> = {
  user: 'You',
  assistant: 'Assistant',
  file: 'File',
};

/** Global search across every session. ⌘K / Ctrl+K focuses it. */
export default function SearchBar({ onJump }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      searchAll(query)
        .then((r) => {
          setResults(r);
          setCursor(0);
        })
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const jump = (hit: SearchHit) => {
    onJump(hit.sessionId);
    setOpen(false);
    inputRef.current?.blur();
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    } else if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault();
      setCursor((c) => (c + 1) % results.length);
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault();
      setCursor((c) => (c - 1 + results.length) % results.length);
    } else if (e.key === 'Enter' && results[cursor]) {
      e.preventDefault();
      jump(results[cursor]);
    }
  };

  const showPanel = open && q.trim().length >= 2;

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <svg
        viewBox="0 0 16 16"
        fill="none"
        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-tertiary"
        aria-hidden="true"
      >
        <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onInputKey}
        placeholder="Search all sessions"
        aria-label="Search all sessions"
        className="w-full rounded-md border border-hairline bg-surface-2 py-1.5 pl-8 pr-16 text-[13px] text-ink placeholder-ink-tertiary outline-none transition-colors duration-150 ease-out focus:border-hairline-strong focus:bg-surface-3"
      />
      <span className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
        <span className="kbd">⌘</span>
        <span className="kbd">K</span>
      </span>

      {showPanel && (
        <div
          role="listbox"
          className="pop pop-open absolute left-0 right-0 top-full z-30 mt-1.5 max-h-96 overflow-y-auto rounded-lg border border-hairline-strong bg-surface-2"
        >
          <div className="sticky top-0 border-b border-hairline bg-surface-2 px-3 py-1.5">
            <span className="eyebrow">
              {searching ? 'Searching…' : `${results.length} result${results.length === 1 ? '' : 's'}`}
            </span>
          </div>
          {!searching && results.length === 0 && (
            <p className="px-3 py-2.5 text-[13px] text-ink-tertiary">No matches.</p>
          )}
          {results.map((hit, i) => (
            <button
              key={`${hit.sessionId}-${hit.messageUuid ?? 'file'}-${i}`}
              role="option"
              aria-selected={i === cursor}
              onClick={() => jump(hit)}
              onMouseEnter={() => setCursor(i)}
              className={`relative block w-full border-b border-hairline px-3 py-2 text-left transition-colors duration-150 ease-out last:border-0 ${
                i === cursor ? 'bg-surface-3' : ''
              }`}
            >
              {/* the active row carries the same accent rail as a selected session */}
              {i === cursor && (
                <span className="absolute inset-y-0 left-0 w-[2px] bg-accent" aria-hidden="true" />
              )}
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span
                    className="truncate text-[13px] font-medium text-ink"
                    style={{ letterSpacing: '-0.2px' }}
                  >
                    {hit.projectName}
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-tertiary">
                    {ROLE_LABEL[hit.role]}
                  </span>
                </span>
                <span className="num shrink-0 text-[11px] text-ink-tertiary">
                  {shortDate(hit.timestamp)}
                </span>
              </div>
              <p className="mono mt-1 line-clamp-2 break-all text-[11px] leading-relaxed text-ink-subtle">
                {hit.snippet}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
