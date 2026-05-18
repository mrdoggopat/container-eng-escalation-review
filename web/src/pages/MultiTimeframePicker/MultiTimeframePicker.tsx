import { useMemo, useState } from "react";
import {
  addDays,
  currentMonthRange,
  fmtDate,
  rangesOverlap,
  type Timeframe,
} from "../../lib/timeframe";
import type { CompareEntry } from "../../lib/comparator";
import "./MultiTimeframePicker.css";

type Draft = {
  label: string;
  start: string;
  end: string;
};

function previousMonthRange(): { start: string; end: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  // First day of this month → previous month.
  const firstOfThis = new Date(Date.UTC(y, m, 1));
  const lastPrev = addDays(firstOfThis.toISOString().slice(0, 10), -1);
  const py = new Date(lastPrev + "T00:00:00Z").getUTCFullYear();
  const pm = new Date(lastPrev + "T00:00:00Z").getUTCMonth();
  const firstPrev = `${py}-${String(pm + 1).padStart(2, "0")}-01`;
  return { start: firstPrev, end: lastPrev };
}

function defaultLabel(d: Draft, index: number): string {
  if (d.label.trim()) return d.label.trim();
  if (d.start && d.end) {
    return `${fmtDate(d.start)} – ${fmtDate(d.end)}`;
  }
  return `Period ${index + 1}`;
}

export function MultiTimeframePicker({
  existingEntries,
  onCancel,
  onSubmit,
}: {
  existingEntries: CompareEntry[];
  onCancel: () => void;
  onSubmit: (timeframes: Timeframe[]) => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() => {
    const current = currentMonthRange();
    const prev = previousMonthRange();
    return [
      { label: "", start: prev.start, end: prev.end },
      { label: "", start: current.start, end: current.end },
    ];
  });

  function updateDraft(i: number, patch: Partial<Draft>) {
    setDrafts((cur) => cur.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }
  function removeDraft(i: number) {
    setDrafts((cur) => cur.filter((_, idx) => idx !== i));
  }
  function addDraft() {
    const cur = currentMonthRange();
    setDrafts((c) => [...c, { label: "", start: cur.start, end: cur.end }]);
  }

  const issues = useMemo(() => {
    const rowErrors: Record<number, string> = {};
    drafts.forEach((d, i) => {
      if (!d.start || !d.end) {
        rowErrors[i] = "Pick a start and end date.";
        return;
      }
      if (d.start > d.end) {
        rowErrors[i] = "Start date must be on or before end date.";
        return;
      }
    });
    // Internal overlaps between drafts.
    const internalOverlaps: Array<[number, number]> = [];
    for (let i = 0; i < drafts.length; i++) {
      if (rowErrors[i]) continue;
      for (let j = i + 1; j < drafts.length; j++) {
        if (rowErrors[j]) continue;
        if (
          rangesOverlap(drafts[i].start, drafts[i].end, drafts[j].start, drafts[j].end)
        ) {
          internalOverlaps.push([i, j]);
        }
      }
    }
    // External overlaps with existing entries.
    const externalOverlaps: Array<{ row: number; entry: CompareEntry }> = [];
    drafts.forEach((d, i) => {
      if (rowErrors[i]) return;
      for (const e of existingEntries) {
        if (rangesOverlap(d.start, d.end, e.timeframe.start, e.timeframe.end)) {
          externalOverlaps.push({ row: i, entry: e });
        }
      }
    });
    return { rowErrors, internalOverlaps, externalOverlaps };
  }, [drafts, existingEntries]);

  const hasErrors =
    Object.keys(issues.rowErrors).length > 0 ||
    issues.internalOverlaps.length > 0 ||
    issues.externalOverlaps.length > 0;
  const canSubmit = drafts.length >= 2 && !hasErrors;

  function handleSubmit() {
    const timeframes: Timeframe[] = drafts.map((d, i) => ({
      preset: "custom",
      label: defaultLabel(d, i),
      start: d.start,
      end: d.end,
    }));
    onSubmit(timeframes);
  }

  return (
    <div className="prepare-page multi-timeframe-page">
      <header className="prepare-header">
        <h1>Add multiple timeframes</h1>
        <p className="selector-intro">
          Pull two or more reports straight from Jira and compare them in one go. The
          app will generate each report sequentially, then run the Claude comparison.
        </p>
      </header>

      <section className="multi-timeframe-list-section">
        <h3 className="section-title">Timeframes ({drafts.length})</h3>
        <div className="multi-timeframe-list" role="list">
          {drafts.map((d, i) => {
            const overlaps =
              issues.internalOverlaps.some(([a, b]) => a === i || b === i) ||
              issues.externalOverlaps.some((o) => o.row === i);
            const rowErr = issues.rowErrors[i];
            return (
              <div
                key={i}
                role="listitem"
                className={`multi-timeframe-row${rowErr || overlaps ? " has-error" : ""}`}
              >
                <span className="multi-timeframe-index">{i + 1}</span>
                <input
                  type="text"
                  className="multi-timeframe-label"
                  placeholder={`Label (optional) — e.g. "Q1 2026"`}
                  value={d.label}
                  onChange={(e) => updateDraft(i, { label: e.target.value })}
                />
                <input
                  type="date"
                  className="multi-timeframe-date"
                  value={d.start}
                  onChange={(e) => updateDraft(i, { start: e.target.value })}
                  aria-label={`Row ${i + 1} start date`}
                />
                <span className="multi-timeframe-sep muted" aria-hidden>
                  →
                </span>
                <input
                  type="date"
                  className="multi-timeframe-date"
                  value={d.end}
                  onChange={(e) => updateDraft(i, { end: e.target.value })}
                  aria-label={`Row ${i + 1} end date`}
                />
                <button
                  type="button"
                  className="ghost-button multi-timeframe-remove"
                  onClick={() => removeDraft(i)}
                  disabled={drafts.length <= 1}
                  aria-label={`Remove row ${i + 1}`}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>

        <button type="button" className="ghost-button" onClick={addDraft}>
          + Add another timeframe
        </button>
      </section>

      {hasErrors ? (
        <div className="callout tone-danger">
          <strong>Fix these before continuing</strong>
          <ul className="warning-list">
            {Object.entries(issues.rowErrors).map(([row, msg]) => (
              <li key={`row-${row}`}>
                Row {Number(row) + 1}: {msg}
              </li>
            ))}
            {issues.internalOverlaps.map(([a, b]) => (
              <li key={`overlap-${a}-${b}`}>
                Row {a + 1} ({fmtDate(drafts[a].start)} – {fmtDate(drafts[a].end)}) overlaps
                row {b + 1} ({fmtDate(drafts[b].start)} – {fmtDate(drafts[b].end)}).
              </li>
            ))}
            {issues.externalOverlaps.map((o, i) => (
              <li key={`ext-${i}`}>
                Row {o.row + 1} overlaps an already-added report (
                {o.entry.timeframe.label}, {fmtDate(o.entry.timeframe.start)} –{" "}
                {fmtDate(o.entry.timeframe.end)}).
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {existingEntries.length > 0 ? (
        <p className="muted small">
          {existingEntries.length} report{existingEntries.length === 1 ? "" : "s"} already
          added to the comparison. New timeframes can't overlap them.
        </p>
      ) : null}

      <div className="prepare-actions">
        <button type="button" className="ghost-button" onClick={onCancel}>
          ← Back to comparison
        </button>
        <div className="compare-submit">
          {drafts.length < 2 ? (
            <span className="muted small">Add at least 2 timeframes.</span>
          ) : null}
          <button
            type="button"
            className="primary-button"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            Generate {drafts.length} reports →
          </button>
        </div>
      </div>
    </div>
  );
}
