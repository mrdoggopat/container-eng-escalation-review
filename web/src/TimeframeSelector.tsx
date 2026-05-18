import { useState } from "react";
import {
  currentMonthRange,
  fmtDate,
  presetTimeframe,
  todayISO,
  type Timeframe,
  type TimeframePreset,
} from "./timeframe";
import { StepProgress } from "./StepProgress";

type PresetEntry = {
  id: Exclude<TimeframePreset, "custom">;
};

const PRESETS: PresetEntry[] = [
  { id: "week" },
  { id: "month" },
  { id: "3months" },
  { id: "year" },
];

export function TimeframeSelector({
  onSelect,
}: {
  onSelect: (tf: Timeframe) => void;
}) {
  const today = todayISO();
  const defaultMonth = currentMonthRange();
  const [customStart, setCustomStart] = useState<string>(defaultMonth.start);
  const [customEnd, setCustomEnd] = useState<string>(defaultMonth.end);
  const customValid = customStart && customEnd && customStart <= customEnd;

  return (
    <div className="selector-page">
      <StepProgress current={1} />

      <header className="selector-header">
        <h1>Choose a timeframe</h1>
        <p className="selector-intro">
          Pick the window you want to review escalations for. The next step will show the
          JQL queries that would be run against the CONS Jira project for that window.
        </p>
      </header>

      <section>
        <h3 className="section-title">Quick presets</h3>
        <div className="preset-grid">
          {PRESETS.map((p) => {
            const tf = presetTimeframe(p.id, today);
            return (
              <button
                key={p.id}
                type="button"
                className="preset-card"
                onClick={() => onSelect(tf)}
              >
                <div className="preset-label">{tf.label}</div>
                <div className="preset-range">
                  {fmtDate(tf.start)} – {fmtDate(tf.end)}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="section-title">Custom date range</h3>
        <form
          className="custom-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!customValid) return;
            onSelect({
              preset: "custom",
              label: `${fmtDate(customStart)} – ${fmtDate(customEnd)}`,
              start: customStart,
              end: customEnd,
            });
          }}
        >
          <label className="date-input">
            <span className="date-input-label">Start</span>
            <input
              type="date"
              value={customStart}
              max={customEnd || undefined}
              onChange={(e) => setCustomStart(e.target.value)}
            />
          </label>
          <label className="date-input">
            <span className="date-input-label">End</span>
            <input
              type="date"
              value={customEnd}
              min={customStart || undefined}
              onChange={(e) => setCustomEnd(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className="primary-button"
            disabled={!customValid}
          >
            Continue →
          </button>
        </form>
      </section>

    </div>
  );
}
