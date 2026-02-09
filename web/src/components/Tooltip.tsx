import { useCallback, useState, type ReactNode } from 'react';

interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

/**
 * Shared hover layer. Every chart mark in the app ships one - an HTML chart is
 * interactive by default, so magnitude is always readable on hover rather than
 * estimated off an axis.
 */
export function useTooltip() {
  const [tip, setTip] = useState<TipState | null>(null);

  const show = useCallback((e: { clientX: number; clientY: number }, content: ReactNode) => {
    setTip({ x: e.clientX, y: e.clientY, content });
  }, []);

  const hide = useCallback(() => setTip(null), []);

  return { tip, show, hide };
}

export function Tooltip({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  // flip to the left of the cursor when close to the right edge
  const flip = tip.x > window.innerWidth - 220;
  return (
    <div
      className="tip"
      style={{
        left: tip.x,
        top: tip.y,
        transform: `translate(${flip ? 'calc(-100% - 14px)' : '14px'}, -50%)`,
      }}
      role="tooltip"
    >
      {tip.content}
    </div>
  );
}

/** A color chip used in tooltips and legends, so identity is never color-alone. */
export function Swatch({ color, className = '' }: { color: string; className?: string }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-[3px] ${className}`}
      style={{ background: color }}
      aria-hidden="true"
    />
  );
}
