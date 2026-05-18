import type { ReactNode } from "react";

/**
 * Lightweight CSS tooltip. Wrap any inline trigger; the bubble appears on hover.
 *
 * Designed to work even when the inner element is `disabled` — hover detection
 * lives on the wrapper, and the disabled child has `pointer-events: none` so
 * mouse events bubble normally.
 */
export function Tooltip({
  content,
  show = true,
  side = "top",
  children,
}: {
  content: ReactNode;
  /** Render the tooltip at all. Defaults to true. */
  show?: boolean;
  side?: "top" | "bottom";
  children: ReactNode;
}) {
  if (!show) return <>{children}</>;
  return (
    <span className="tooltip-wrap">
      {children}
      <span className={`tooltip-bubble tooltip-${side}`} role="tooltip">
        {content}
      </span>
    </span>
  );
}
