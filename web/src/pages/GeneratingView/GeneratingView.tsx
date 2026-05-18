import { useEffect, useRef, useState } from "react";
import { StepProgress } from "../../components/StepProgress/StepProgress";
import {
  ActivityLog,
  type ActivityLogEntry,
  type ActivityTone,
} from "../../components/ActivityLog/ActivityLog";
import { fmtDate, type Timeframe } from "../../lib/timeframe";
import type { ProgressUpdate } from "../../lib/reportGenerator";
import "./GeneratingView.css";

type CardChip = NonNullable<ProgressUpdate["cardResult"]>;

const PHASE_TONE: Record<ProgressUpdate["phase"], ActivityTone> = {
  "querying-escalated": "jira",
  "querying-total": "jira",
  "fetching-changelogs": "jira",
  analyzing: "claude",
  assembling: "final",
};

const PHASE_LABELS: Record<ProgressUpdate["phase"], string> = {
  "querying-escalated": "Searching for escalated cards",
  "querying-total": "Counting total CONS cards in period",
  "fetching-changelogs": "Fetching card details + changelogs",
  analyzing: "Analyzing cards with Claude",
  assembling: "Assembling report",
};

const PHASE_ORDER: ProgressUpdate["phase"][] = [
  "querying-escalated",
  "querying-total",
  "fetching-changelogs",
  "analyzing",
  "assembling",
];

export function GeneratingView({
  timeframe,
  progress,
  error,
  showStepProgress = true,
  batch,
  onCancel,
  onRetry,
}: {
  timeframe: Timeframe;
  progress: ProgressUpdate | null;
  error: string | null;
  showStepProgress?: boolean;
  /** Optional batch context when this is one of N reports being generated. */
  batch?: {
    index: number;
    total: number;
    completedLabels: string[];
    upcomingLabels: string[];
  };
  onCancel: () => void;
  onRetry: () => void;
}) {
  const activePhaseIndex = progress
    ? PHASE_ORDER.indexOf(progress.phase)
    : 0;

  // Accumulate every progress update into a scrolling activity log so the user
  // sees the trail of what Claude / Jira did rather than just the latest line.
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [chips, setChips] = useState<CardChip[]>([]);
  const nextIdRef = useRef(0);
  const startedAtRef = useRef<number>(Date.now());

  // Reset state when the timeframe changes (e.g. retry / batch advances).
  useEffect(() => {
    setActivity([]);
    setChips([]);
    nextIdRef.current = 0;
    startedAtRef.current = Date.now();
  }, [timeframe.start, timeframe.end]);

  useEffect(() => {
    if (!progress) return;
    setActivity((prev) => {
      const last = prev[prev.length - 1];
      // Suppress consecutive duplicates (same message + detail).
      if (
        last &&
        last.message === progress.message &&
        last.detail === progress.detail
      ) {
        return prev;
      }
      const next: ActivityLogEntry = {
        id: nextIdRef.current++,
        ts: Date.now(),
        message: progress.message,
        detail: progress.detail,
        tone: PHASE_TONE[progress.phase],
      };
      // Cap the log so very large runs don't unbounded grow the DOM.
      const trimmed = prev.length >= 200 ? prev.slice(prev.length - 199) : prev;
      return [...trimmed, next];
    });
    if (progress.cardResult) {
      const result = progress.cardResult;
      setChips((prev) =>
        prev.some((c) => c.key === result.key) ? prev : [...prev, result],
      );
    }
  }, [progress]);

  return (
    <div className="prepare-page">
      {showStepProgress ? <StepProgress current={3} /> : null}

      <header className="prepare-header">
        <h1>
          {error
            ? "Report generation failed"
            : batch
              ? `Generating report ${batch.index + 1} of ${batch.total}…`
              : "Generating report…"}
        </h1>
        <p className="selector-intro">
          {error
            ? "The pipeline stopped before the report could be assembled."
            : `Running the CLAUDE.md workflow against Jira for ${timeframe.label} (${fmtDate(timeframe.start)} – ${fmtDate(timeframe.end)}).`}
        </p>
      </header>

      {batch ? (
        <div className="batch-progress">
          <div className="batch-progress-track">
            <div
              className="batch-progress-fill"
              style={{
                width: `${(batch.index / batch.total) * 100}%`,
              }}
            />
          </div>
          <ol className="batch-progress-list">
            {batch.completedLabels.map((l, i) => (
              <li key={`done-${i}`} className="batch-step done">
                <span className="batch-step-bullet" aria-hidden>
                  ✓
                </span>
                <span>{l}</span>
              </li>
            ))}
            <li className="batch-step active">
              <span className="batch-step-bullet" aria-hidden>
                ●
              </span>
              <span>{timeframe.label}</span>
            </li>
            {batch.upcomingLabels.map((l, i) => (
              <li key={`up-${i}`} className="batch-step">
                <span className="batch-step-bullet" aria-hidden>
                  ○
                </span>
                <span>{l}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="generating-card">
        <ol className="phase-list">
          {PHASE_ORDER.map((phase, i) => {
            const isActive = !error && i === activePhaseIndex;
            const isDone = !error && i < activePhaseIndex;
            const cls =
              "phase-row" +
              (isActive ? " active" : "") +
              (isDone ? " done" : "");
            return (
              <li key={phase} className={cls}>
                <span className="phase-bullet" aria-hidden>
                  {isDone ? "✓" : isActive ? <Spinner /> : ""}
                </span>
                <span className="phase-label">{PHASE_LABELS[phase]}</span>
                {isActive && progress?.total ? (
                  <span className="phase-count">
                    {progress.current ?? 0} / {progress.total}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
        {progress?.message ? (
          <div className="phase-status">
            <div className="phase-status-message">{progress.message}</div>
            {progress.detail ? (
              <div className="phase-status-detail">{progress.detail}</div>
            ) : null}
          </div>
        ) : null}
      </div>

      {chips.length > 0 ? (
        <section className="generating-chips" aria-label="Cards analyzed so far">
          <div className="generating-chips-header">
            <span className="generating-chips-title">Cards analyzed</span>
            <span className="generating-chips-tally">
              {chips.length}
              {progress?.total ? ` / ${progress.total}` : ""}
              {" · "}
              {chips.filter((c) => c.preventable).length} preventable
            </span>
          </div>
          <ul className="generating-chips-list">
            {chips.map((c) => (
              <li
                key={c.key}
                className={
                  "generating-chip" + (c.preventable ? " preventable" : "")
                }
                title={`${c.key} — ${c.title}\n${c.preventable ? "Preventable" : "Not preventable"} · ${c.solutionCategory}`}
              >
                <span className="generating-chip-key">{c.key}</span>
                <span className="generating-chip-cat">{c.solutionCategory}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {activity.length > 0 ? (
        <ActivityLog
          entries={activity}
          startedAt={startedAtRef.current}
          title="Live activity"
          isLive={!error}
        />
      ) : null}

      {error ? (
        <div className="callout tone-danger">
          <strong>Error</strong>
          <p>{error}</p>
        </div>
      ) : null}

      <div className="prepare-actions">
        {error ? (
          <>
            <button type="button" className="ghost-button" onClick={onCancel}>
              ← Back
            </button>
            <button type="button" className="primary-button" onClick={onRetry}>
              Retry
            </button>
          </>
        ) : (
          <button type="button" className="ghost-button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span className="spinner" aria-hidden>
      <svg width="14" height="14" viewBox="0 0 14 14">
        <circle
          cx="7"
          cy="7"
          r="5"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="2"
        />
        <path
          d="M 7 2 A 5 5 0 0 1 12 7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
