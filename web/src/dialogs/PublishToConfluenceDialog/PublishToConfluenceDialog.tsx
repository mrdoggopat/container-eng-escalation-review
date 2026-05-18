import { useEffect, useRef, useState } from "react";
import type { Credentials } from "../../lib/credentials";
import type {
  CreatePageResult,
  PublishOptions,
  PublishProgress,
} from "../../lib/confluence";
import {
  ConfluenceError,
  PublishCancelledError,
  publishReport,
} from "../../lib/confluence";
import {
  ActivityLog,
  type ActivityLogEntry,
} from "../../components/ActivityLog/ActivityLog";
import "./PublishToConfluenceDialog.css";

type Phase =
  | { kind: "form" }
  | { kind: "publishing"; progress: PublishProgress | null }
  | { kind: "success"; result: CreatePageResult }
  | { kind: "error"; message: string };

export function PublishToConfluenceDialog({
  credentials,
  defaultTitle,
  defaultSpace,
  defaultParent,
  storageBody,
  onClose,
}: {
  credentials: Credentials;
  defaultTitle: string;
  defaultSpace: string;
  defaultParent: string;
  storageBody: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [space, setSpace] = useState(defaultSpace);
  const [parent, setParent] = useState(defaultParent);
  const [status, setStatus] = useState<"current" | "draft">("draft");
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const nextIdRef = useRef(0);
  const startedAtRef = useRef<number>(0);
  const cancelledRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  function pushActivity(message: string, detail?: string) {
    setActivity((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.message === message && last.detail === detail) return prev;
      return [
        ...prev,
        {
          id: nextIdRef.current++,
          ts: Date.now(),
          message,
          detail,
          tone: "confluence",
        },
      ];
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (phase.kind === "publishing") {
        // First Esc during an in-flight publish aborts the request;
        // a second Esc (after we're back at the form / success / error) closes.
        handleCancel();
      } else {
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, phase.kind]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      abortRef.current?.abort();
    };
  }, []);

  function handleCancel() {
    if (abortRef.current && !abortRef.current.signal.aborted) {
      abortRef.current.abort();
    }
  }

  function handleClose() {
    // X / backdrop / explicit close. If a publish is in flight, abort it first
    // so the underlying fetch doesn't keep running in the background.
    if (phase.kind === "publishing") {
      handleCancel();
      // Don't dismiss yet — let the catch-block in handleSubmit flip the phase
      // to "form" or "error". The user can then dismiss normally.
      return;
    }
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (phase.kind === "publishing") return;
    const opts: PublishOptions = {
      spaceQuery: space.trim(),
      parentPageTitle: parent.trim() || null,
      title: title.trim(),
      status,
      storageBody,
    };
    if (!opts.title || !opts.spaceQuery) return;
    setActivity([]);
    nextIdRef.current = 0;
    startedAtRef.current = Date.now();
    setPhase({ kind: "publishing", progress: null });
    pushActivity(
      `Starting Confluence publish for "${opts.title}"`,
      `Target space: "${opts.spaceQuery}"${opts.parentPageTitle ? ` · under "${opts.parentPageTitle}"` : " · at space root"} · ${opts.status === "draft" ? "draft" : "current"}`,
    );
    // Fresh AbortController per attempt so prior aborts don't poison a retry.
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    try {
      const result = await publishReport(
        credentials,
        opts,
        (p) => {
          if (cancelledRef.current || signal.aborted) return;
          pushActivity(p.message, p.detail);
          setPhase({ kind: "publishing", progress: p });
        },
        signal,
      );
      if (cancelledRef.current) return;
      pushActivity(
        `Done — page created in Confluence`,
        `Status: ${result.status} · Open: ${result.webUrl}`,
      );
      setPhase({ kind: "success", result });
    } catch (err) {
      if (cancelledRef.current) return;
      // User-cancelled (abort button / Esc / dialog close): go back to form
      // silently rather than showing a red error callout.
      if (err instanceof PublishCancelledError || signal.aborted) {
        pushActivity(
          "Publish cancelled",
          "Aborted by user — no Confluence page was created.",
        );
        setPhase({ kind: "form" });
        return;
      }
      const message =
        err instanceof ConfluenceError
          ? err.message + formatDetail(err.detail)
          : err instanceof Error
            ? err.message
            : String(err);
      pushActivity(`Publish failed`, message);
      setPhase({ kind: "error", message });
    }
  }

  return (
    <div
      className="modal-backdrop publish-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-dialog-title"
      onClick={(e) => {
        // Backdrop click: same semantics as the X — abort if publishing,
        // dismiss otherwise.
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="modal-panel publish-panel" ref={dialogRef}>
        <header className="publish-header">
          <h2 id="publish-dialog-title">Publish to Confluence</h2>
          <button
            type="button"
            className="callout-dismiss"
            onClick={handleClose}
            aria-label={
              phase.kind === "publishing" ? "Cancel publish" : "Close"
            }
            title={
              phase.kind === "publishing"
                ? "Cancel publish (Esc)"
                : "Close (Esc)"
            }
          >
            ✕
          </button>
        </header>

        {phase.kind === "form" ? (
          <form className="publish-form" onSubmit={handleSubmit}>
            <p className="muted small">
              The report will be created as a new Confluence page using your Atlassian
              credentials. Defaults come from settings — you can override them here.
            </p>

            <label className="field">
              <span>Page title</span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </label>

            <label className="field">
              <span>Space (name or key)</span>
              <input
                type="text"
                value={space}
                onChange={(e) => setSpace(e.target.value)}
                placeholder="Containers TEE Team"
              />
            </label>

            <label className="field">
              <span>Under page (parent — exact title, optional)</span>
              <input
                type="text"
                value={parent}
                onChange={(e) => setParent(e.target.value)}
                placeholder="Containers Escalation to Engineering Review"
              />
            </label>

            <fieldset className="field publish-status-fieldset">
              <legend>Publish as</legend>
              <label className="publish-status-option">
                <input
                  type="radio"
                  name="publish-status"
                  value="draft"
                  checked={status === "draft"}
                  onChange={() => setStatus("draft")}
                />
                <span>
                  <strong>Draft</strong>
                  <span className="muted small">
                    Page is created but not visible to others — recommended for review.
                  </span>
                </span>
              </label>
              <label className="publish-status-option">
                <input
                  type="radio"
                  name="publish-status"
                  value="current"
                  checked={status === "current"}
                  onChange={() => setStatus("current")}
                />
                <span>
                  <strong>Published</strong>
                  <span className="muted small">
                    Immediately visible to anyone with access to the space.
                  </span>
                </span>
              </label>
            </fieldset>

            <footer className="publish-actions">
              <button type="button" className="ghost-button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={!title.trim() || !space.trim()}
              >
                {status === "draft"
                  ? "Create draft →"
                  : "Publish to Confluence →"}
              </button>
            </footer>
          </form>
        ) : null}

        {phase.kind === "publishing" ? (
          <div className="publish-progress">
            <div className="phase-row active">
              <span className="phase-bullet" aria-hidden>
                <PublishSpinner />
              </span>
              <span>{phase.progress?.message ?? "Working…"}</span>
            </div>
            {phase.progress?.detail ? (
              <p className="publish-progress-detail">{phase.progress.detail}</p>
            ) : null}
            <ActivityLog
              entries={activity}
              startedAt={startedAtRef.current}
              title="Confluence activity"
              emptyHint="Waiting for first response from Confluence…"
              maxHeight={200}
            />
            <footer className="publish-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={handleCancel}
                disabled={!!abortRef.current?.signal.aborted}
              >
                {abortRef.current?.signal.aborted ? "Cancelling…" : "Cancel"}
              </button>
            </footer>
          </div>
        ) : null}

        {phase.kind === "success" ? (
          <div className="publish-success">
            <div className="callout tone-success">
              <strong>Published</strong>
              <p>
                Confluence page <em>{phase.result.title}</em> created as{" "}
                <strong>{phase.result.status}</strong>.
              </p>
            </div>
            {activity.length > 0 ? (
              <ActivityLog
                entries={activity}
                startedAt={startedAtRef.current}
                title="Publish trace"
                maxHeight={180}
              />
            ) : null}
            <footer className="publish-actions">
              <a
                className="primary-button"
                href={phase.result.webUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open in Confluence ↗
              </a>
              <button type="button" className="ghost-button" onClick={onClose}>
                Close
              </button>
            </footer>
          </div>
        ) : null}

        {phase.kind === "error" ? (
          <div className="publish-error">
            <div className="callout tone-danger">
              <strong>Publish failed</strong>
              <p>{phase.message}</p>
            </div>
            {activity.length > 0 ? (
              <ActivityLog
                entries={activity}
                startedAt={startedAtRef.current}
                title="Publish trace (failed)"
                maxHeight={180}
              />
            ) : null}
            <footer className="publish-actions">
              <button type="button" className="ghost-button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => setPhase({ kind: "form" })}
              >
                Back to form
              </button>
            </footer>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PublishSpinner() {
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

function formatDetail(detail: unknown): string {
  if (!detail) return "";
  if (typeof detail === "string") return ` — ${detail}`;
  if (typeof detail === "object") {
    const obj = detail as Record<string, unknown>;
    if (typeof obj.message === "string") return ` — ${obj.message}`;
    if (
      typeof obj.detail === "string" ||
      typeof obj.detail === "number"
    ) {
      return ` — ${String(obj.detail)}`;
    }
  }
  return "";
}
