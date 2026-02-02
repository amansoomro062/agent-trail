interface Props {
  className?: string;
}

/**
 * The brand mark: a trail of three dots resolving into a solid head.
 * One of the four places the accent is allowed to appear (see DESIGN.md).
 */
export default function TrailMark({ className = 'h-4 w-4' }: Props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="4" cy="18" r="1.6" fill="currentColor" opacity="0.35" />
      <circle cx="9.2" cy="14.2" r="1.9" fill="currentColor" opacity="0.6" />
      <circle cx="14.8" cy="9.8" r="2.2" fill="currentColor" opacity="0.8" />
      <circle cx="20" cy="5" r="2.6" fill="currentColor" />
    </svg>
  );
}
