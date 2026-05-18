import { useEffect, useRef } from "react";
import "./ActivityLog.css";

export type ActivityTone = "default" | "jira" | "claude" | "final" | "confluence";

export type ActivityLogEntry = {
  id: number;
  ts: number;
  message: string;
  detail?: string;
  tone?: ActivityTone;
};

const TONE_CLASS: Record<ActivityTone, string> = {
  default: "activity-dot-default",
  jira: "activity-dot-jira",
  claude: "activity-dot-claude",
  final: "activity-dot-final",
  confluence: "activity-dot-confluence",
};

/**
 * Live, scrolling timeline of activity events. The parent component owns the
 * `entries` array and `startedAt` timestamp; this component just renders.
 *
 * Used by `GeneratingView` (report generation) and `PublishToConfluenceDialog`
 * to give the user transparency into what's happening while a long-running
 * operation is in flight.
 */
export function ActivityLog({
  entries,
  startedAt,
  title = "Live activity",
  emptyHint,
  maxHeight = 260,
}: {
  entries: ActivityLogEntry[];
  /** Wall-clock ms at which the operation began; used for relative timestamps. */
  startedAt: number;
  title?: string;
  /** Shown when entries is empty (e.g. "Waiting for first event…"). */
  emptyHint?: string;
  /** Max scroll height in px. */
  maxHeight?: number;
}) {
  const listRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  const now = entries[entries.length - 1]?.ts ?? Date.now();

  return (
    <section className="activity-log" aria-label={title}>
      <div className="activity-log-header">
        <span className="activity-log-title">{title}</span>
        <span className="activity-log-meta">
          {entries.length} event{entries.length === 1 ? "" : "s"} ·{" "}
          {Math.floor((now - startedAt) / 1000)}s elapsed
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="activity-log-empty">{emptyHint ?? "Waiting…"}</p>
      ) : (
        <ol
          className="activity-log-list"
          ref={listRef}
          style={{ maxHeight }}
        >
          {entries.map((e) => (
            <li
              key={e.id}
              className={"activity-row " + TONE_CLASS[e.tone ?? "default"]}
            >
              <span className="activity-time">
                {formatRelativeTime(e.ts, startedAt)}
              </span>
              <span className="activity-dot" aria-hidden>
                ●
              </span>
              <span className="activity-body">
                <span className="activity-message">{e.message}</span>
                {e.detail ? (
                  <span className="activity-detail">{e.detail}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function formatRelativeTime(ts: number, startedAt: number): string {
  const seconds = Math.max(0, Math.floor((ts - startedAt) / 1000));
  if (seconds < 60) return `+${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  return `+${minutes}m${remSeconds.toString().padStart(2, "0")}s`;
}
