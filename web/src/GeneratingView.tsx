import { StepProgress } from "./StepProgress";
import { fmtDate, type Timeframe } from "./timeframe";
import type { ProgressUpdate } from "./reportGenerator";

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
  onUseBundled,
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
  onUseBundled?: () => void;
  onRetry: () => void;
}) {
  const activePhaseIndex = progress
    ? PHASE_ORDER.indexOf(progress.phase)
    : 0;

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
          <p className="phase-status muted small">{progress.message}</p>
        ) : null}
      </div>

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
            <div style={{ display: "inline-flex", gap: 8 }}>
              {onUseBundled ? (
                <button type="button" className="ghost-button" onClick={onUseBundled}>
                  Use bundled report instead
                </button>
              ) : null}
              <button type="button" className="primary-button" onClick={onRetry}>
                Retry
              </button>
            </div>
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
