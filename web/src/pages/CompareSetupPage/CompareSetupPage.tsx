import { useMemo, useRef } from "react";
import { fmtDate, rangesOverlap } from "../../lib/timeframe";
import { Tooltip } from "../../components/Tooltip/Tooltip";
import type { CompareEntry } from "../../lib/comparator";
import "./CompareSetupPage.css";

export function CompareSetupPage({
  entries,
  credentialsConfigured,
  importError,
  onAddFromFile,
  onAddFreshFromJira,
  onAddMultipleFromJira,
  onRemove,
  onCompare,
  onBack,
  dismissImportError,
}: {
  entries: CompareEntry[];
  credentialsConfigured: boolean;
  importError: string | null;
  onAddFromFile: (file: File) => void;
  onAddFreshFromJira: () => void;
  onAddMultipleFromJira: () => void;
  onRemove: (index: number) => void;
  onCompare: () => void;
  onBack: () => void;
  dismissImportError: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const overlapPairs = useMemo(() => {
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (
          rangesOverlap(
            entries[i].timeframe.start,
            entries[i].timeframe.end,
            entries[j].timeframe.start,
            entries[j].timeframe.end,
          )
        ) {
          pairs.push([i, j]);
        }
      }
    }
    return pairs;
  }, [entries]);

  const hasOverlap = overlapPairs.length > 0;
  const canCompare = entries.length >= 2 && !hasOverlap;

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onAddFromFile(file);
    e.target.value = "";
  }

  return (
    <div className="compare-page">
      <header className="compare-header">
        <h1>Compare timeframes</h1>
        <p className="muted">
          Add two or more non-overlapping periods. Each can be a report you previously
          exported from this app, or a fresh report generated from Jira. Claude will
          analyze how things changed across them.
        </p>
      </header>

      <section className="compare-list-section">
        <h3 className="section-title">
          Reports to compare ({entries.length})
        </h3>

        {entries.length === 0 ? (
          <div className="compare-empty">
            <p className="muted small">
              No reports added yet. Use the buttons below to add at least two.
            </p>
          </div>
        ) : (
          <ol className="compare-entries">
            {entries.map((entry, i) => {
              const overlaps = overlapPairs.some(
                ([a, b]) => a === i || b === i,
              );
              return (
                <li
                  key={`${entry.timeframe.start}-${entry.timeframe.end}-${i}`}
                  className={`compare-entry${overlaps ? " has-overlap" : ""}`}
                >
                  <span className="compare-entry-index">{i + 1}</span>
                  <div className="compare-entry-body">
                    <div className="compare-entry-title">
                      {entry.timeframe.label}
                      <span
                        className={`pill tone-${entry.origin === "live" ? "info" : "neutral"}`}
                      >
                        {entry.origin === "live" ? "Live from Jira" : "Imported"}
                      </span>
                    </div>
                    <div className="compare-entry-meta muted small">
                      <span>
                        {fmtDate(entry.timeframe.start)} –{" "}
                        {fmtDate(entry.timeframe.end)}
                      </span>
                      <span className="dot" aria-hidden>
                        ·
                      </span>
                      <span>{entry.report.cards.length} escalated cards</span>
                      {entry.filename ? (
                        <>
                          <span className="dot" aria-hidden>
                            ·
                          </span>
                          <span>{entry.filename}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ghost-button compare-entry-remove"
                    onClick={() => onRemove(i)}
                    aria-label="Remove this report"
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ol>
        )}

        {hasOverlap ? (
          <div className="callout tone-danger compare-overlap">
            <strong>Timeframes overlap</strong>
            <p>
              Comparison requires non-overlapping periods. Adjust or remove entries that
              cover the same dates:
            </p>
            <ul className="warning-list">
              {overlapPairs.map(([a, b]) => (
                <li key={`${a}-${b}`}>
                  #{a + 1} ({fmtDate(entries[a].timeframe.start)} –{" "}
                  {fmtDate(entries[a].timeframe.end)}) overlaps #{b + 1} (
                  {fmtDate(entries[b].timeframe.start)} –{" "}
                  {fmtDate(entries[b].timeframe.end)}).
                </li>
              ))}
            </ul>
          </div>
        ) : null}

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
          </div>
        ) : null}
      </section>

      <section className="compare-actions-section">
        <h3 className="section-title">Add another report</h3>
        <div className="compare-add-row">
          <button
            type="button"
            className="ghost-button"
            onClick={() => fileInputRef.current?.click()}
          >
            + From file (JSON / CSV / MD)
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.csv,.md,.markdown,application/json,text/csv,text/markdown"
            onChange={handleFile}
            style={{ display: "none" }}
          />
          {credentialsConfigured ? (
            <>
              <button
                type="button"
                className="ghost-button"
                onClick={onAddFreshFromJira}
              >
                + Fresh from Jira
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={onAddMultipleFromJira}
              >
                + Multiple fresh from Jira
              </button>
            </>
          ) : (
            <Tooltip content="Set your Jira and Anthropic credentials first to pull a fresh report.">
              <span style={{ display: "inline-flex", gap: 10 }}>
                <button
                  type="button"
                  className="ghost-button"
                  disabled
                  aria-disabled
                >
                  + Fresh from Jira
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled
                  aria-disabled
                >
                  + Multiple fresh from Jira
                </button>
              </span>
            </Tooltip>
          )}
        </div>
        <p className="muted small compare-add-hint">
          Tip: "Multiple fresh from Jira" lets you queue up several date ranges at once
          and generate them all in one batch.
        </p>
      </section>

      <footer className="compare-footer">
        <button type="button" className="ghost-button" onClick={onBack}>
          ← Back to home
        </button>
        <div className="compare-submit">
          {!canCompare && entries.length < 2 ? (
            <span className="muted small">Add at least 2 reports to enable.</span>
          ) : null}
          <button
            type="button"
            className="primary-button"
            disabled={!canCompare}
            onClick={onCompare}
          >
            Compare with Claude →
          </button>
        </div>
      </footer>
    </div>
  );
}
