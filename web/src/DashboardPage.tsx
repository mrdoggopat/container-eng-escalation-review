import { useRef } from "react";

export function DashboardPage({
  projectKey,
  onGenerate,
  onImport,
  onCompare,
  onPreview,
  importError,
  dismissImportError,
}: {
  projectKey: string;
  onGenerate: () => void;
  onImport: (file: File) => void;
  onCompare: () => void;
  onPreview: () => void;
  importError: string | null;
  dismissImportError: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleImportClick() {
    dismissImportError();
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      onImport(file);
    }
    e.target.value = "";
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <span className="dashboard-tag">Working in {projectKey}</span>
        <h1 className="dashboard-title">What would you like to do?</h1>
        <p className="dashboard-tagline">
          Pick how you want to review escalations. Credentials are saved on this device
          and can be changed any time from the settings button.
        </p>
      </header>

      {importError ? (
        <div className="callout tone-danger" role="alert">
          <div className="callout-row">
            <strong>Couldn't import that file</strong>
            <button
              type="button"
              className="callout-dismiss"
              onClick={dismissImportError}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
          <p>{importError}</p>
          <p className="muted small">
            Tip: use a <code>.json</code>, <code>.csv</code>, or <code>.md</code> file
            previously exported from this app.
          </p>
        </div>
      ) : null}

      <section className="dashboard-actions-grid">
        <ActionCard
          eyebrow="Pull from Jira"
          title="Generate a fresh report"
          description="Choose a timeframe, preview the JQL, then have Claude analyze every escalated card."
          actionLabel="Choose timeframe →"
          actionClassName="primary-button"
          onClick={onGenerate}
        />
        <ActionCard
          eyebrow="From file"
          title="Import a saved report"
          description="Open a JSON, CSV, or Markdown file you previously exported from this app."
          actionLabel="Choose file"
          actionClassName="ghost-button"
          onClick={handleImportClick}
        />
        <ActionCard
          eyebrow="Trends"
          title="Compare timeframes"
          description="Bring together two or more non-overlapping periods — imported, freshly pulled, or both — and let Claude surface the deltas."
          actionLabel="Compare"
          actionClassName="ghost-button"
          onClick={onCompare}
        />
      </section>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.csv,.md,.markdown,application/json,text/csv,text/markdown"
        onChange={handleFileChange}
        style={{ display: "none" }}
      />

      <footer className="dashboard-footer">
        <button
          type="button"
          className="link-button"
          onClick={onPreview}
        >
          See a sample report
        </button>
      </footer>
    </div>
  );
}

function ActionCard({
  eyebrow,
  title,
  description,
  actionLabel,
  actionClassName,
  onClick,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actionLabel: string;
  actionClassName: string;
  onClick: () => void;
}) {
  return (
    <div className="dashboard-card">
      <span className="dashboard-card-eyebrow">{eyebrow}</span>
      <h3 className="dashboard-card-title">{title}</h3>
      <p className="dashboard-card-desc">{description}</p>
      <div className="dashboard-card-actions">
        <button type="button" className={actionClassName} onClick={onClick}>
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
