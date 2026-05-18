import { useEffect, useRef, useState } from "react";
import type { Credentials } from "../../lib/credentials";
import type {
  CreatePageResult,
  PublishOptions,
  PublishProgress,
} from "../../lib/confluence";
import { ConfluenceError, publishReport } from "../../lib/confluence";
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
  const cancelledRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && phase.kind !== "publishing") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, phase.kind]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

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
    setPhase({ kind: "publishing", progress: null });
    try {
      const result = await publishReport(credentials, opts, (p) => {
        if (cancelledRef.current) return;
        setPhase({ kind: "publishing", progress: p });
      });
      if (cancelledRef.current) return;
      setPhase({ kind: "success", result });
    } catch (err) {
      if (cancelledRef.current) return;
      const message =
        err instanceof ConfluenceError
          ? err.message + formatDetail(err.detail)
          : err instanceof Error
            ? err.message
            : String(err);
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
        if (
          e.target === e.currentTarget &&
          phase.kind !== "publishing"
        ) {
          onClose();
        }
      }}
    >
      <div className="modal-panel publish-panel" ref={dialogRef}>
        <header className="publish-header">
          <h2 id="publish-dialog-title">Publish to Confluence</h2>
          <button
            type="button"
            className="callout-dismiss"
            onClick={onClose}
            disabled={phase.kind === "publishing"}
            aria-label="Close"
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
              </span>
              <span>{phase.progress?.message ?? "Working…"}</span>
            </div>
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
