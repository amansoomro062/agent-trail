import { useEffect, useRef, useState } from 'react';
import type { RootInfo } from '../api';
import { addRoot, fetchRoots, removeRoot } from '../api';

/**
 * Manage transcript sources: every active root, built-in and custom, with
 * add/remove for custom ones. A quiet popover, same pattern as the search
 * palette. Sessions refresh themselves over SSE after each change.
 */
export default function SourcesPanel() {
  const [open, setOpen] = useState(false);
  const [roots, setRoots] = useState<RootInfo[] | null>(null);
  const [newPath, setNewPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    fetchRoots()
      .then(setRoots)
      .catch(() => setRoots(null));
  }, [open]);

  const submit = async () => {
    const p = newPath.trim();
    if (!p || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addRoot(p);
      setNewPath('');
      setRoots(await fetchRoots());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (path: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await removeRoot(path);
      setRoots(await fetchRoots());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Manage transcript sources"
        title="Transcript sources"
        className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-2 transition-colors duration-150 ease-out hover:bg-sunken hover:text-ink"
      >
        <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
          <circle cx="8" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M8 1.5v1.7M8 12.8v1.7M14.5 8h-1.7M3.2 8H1.5M12.6 3.4l-1.2 1.2M4.6 11.4l-1.2 1.2M12.6 12.6l-1.2-1.2M4.6 4.6 3.4 3.4"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open && (
        <div className="pop-open absolute right-0 top-full z-30 mt-1.5 w-[24rem] overflow-hidden rounded-xl border border-line-strong bg-card shadow-[var(--shadow-lg)]">
          <div className="flex items-baseline justify-between border-b border-line px-3 py-1.5">
            <span className="eyebrow">Transcript sources</span>
            {roots && <span className="num text-[12px] text-ink-3">{roots.length}</span>}
          </div>

          <div className="max-h-72 overflow-y-auto">
            {roots === null && <p className="px-3 py-2.5 text-[13px] text-ink-3">Loading…</p>}
            {roots?.length === 0 && (
              <p className="px-3 py-2.5 text-[13px] text-ink-3">No sources configured.</p>
            )}
            {roots?.map((r) => (
              <div
                key={r.path}
                className="flex items-center gap-2 border-b border-line px-3 py-2 last:border-b-0"
              >
                <span className="shrink-0 rounded border border-line px-1.5 py-px text-[11px] text-ink-3">
                  {r.provider}
                </span>
                <span className="mono min-w-0 flex-1 truncate text-[12px] text-ink-2" title={r.path}>
                  {r.label ? `${r.label} · ${r.path}` : r.path}
                </span>
                <span className="num shrink-0 text-[11px] text-ink-3">{r.sessions}</span>
                {r.custom ? (
                  <button
                    onClick={() => void remove(r.path)}
                    disabled={busy}
                    className="shrink-0 text-[11px] text-ink-3 transition-colors duration-150 hover:text-danger"
                  >
                    Remove
                  </button>
                ) : (
                  <span className="shrink-0 text-[11px] text-ink-3">built-in</span>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-line px-3 py-2">
            <div className="flex items-stretch gap-1.5">
              <input
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit();
                }}
                placeholder="/path/to/transcripts"
                aria-label="Add a transcript source path"
                className="mono min-w-0 flex-1 rounded-lg border border-line bg-sunken px-2.5 py-1.5 text-[12px] text-ink placeholder-ink-3 outline-none transition-colors duration-150 focus:border-line-strong focus:bg-card"
              />
              <button
                onClick={() => void submit()}
                disabled={busy || !newPath.trim()}
                className="shrink-0 rounded-lg border border-line px-2.5 text-[12px] font-medium text-ink-2 transition-colors duration-150 hover:border-line-strong hover:bg-sunken hover:text-ink disabled:text-ink-3"
              >
                Add
              </button>
            </div>
            {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
            <p className="mt-1.5 text-[11px] leading-snug text-ink-3">
              Saved to ~/.agenttrail/config.json. Removal only edits the config, nothing on disk is
              touched.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
