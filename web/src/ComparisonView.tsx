import { fmtDate } from "./timeframe";
import type {
  ClaudeComparison,
  ComparisonResult,
  PeriodStats,
} from "./comparator";
import type { SolutionCategory } from "./data";

const SOLUTION_CATEGORIES: SolutionCategory[] = [
  "PR fix",
  "Customer environment specific issue",
  "Suggestion without PR or code fixes",
  "Other",
];

function formatPct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function deltaTone(values: Array<number | null>, lowerIsBetter: boolean): string {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (nums.length < 2) return "neutral";
  const first = nums[0];
  const last = nums[nums.length - 1];
  const delta = last - first;
  if (Math.abs(delta) < 0.5) return "neutral";
  const better = lowerIsBetter ? delta < 0 : delta > 0;
  return better ? "success" : "warning";
}

function MetricRow({
  label,
  values,
  tone = "neutral",
}: {
  label: string;
  values: string[];
  tone?: string;
}) {
  return (
    <tr>
      <th className="metric-row-label">{label}</th>
      {values.map((v, i) => (
        <td key={i} className={`metric-row-value tone-${tone}`}>
          {v}
        </td>
      ))}
    </tr>
  );
}

export function ComparisonView({
  result,
  onBack,
}: {
  result: ComparisonResult;
  onBack: () => void;
}) {
  const { stats, analysis, analysisError } = result;
  const labels = stats.map((s) => s.label);

  const escalatedDeltaTone = deltaTone(
    stats.map((s) => s.totalEscalated),
    true,
  );
  const escalationRateTone = deltaTone(
    stats.map((s) => s.escalationRatePct),
    true,
  );
  const preventableRateTone = deltaTone(
    stats.map((s) => s.preventableRatePct),
    true,
  );
  const avgDurationTone = deltaTone(
    stats.map((s) => s.avgDurationDays),
    true,
  );

  return (
    <div className="page comparison-page">
      <header className="page-header">
        <div className="header-row">
          <h1>Comparison · {labels.length} periods</h1>
          <div className="header-actions">
            <button type="button" className="ghost-button" onClick={onBack}>
              ← Back to home
            </button>
          </div>
        </div>
        <div className="page-subtitle">
          {stats.map((s, i) => (
            <span key={i} className="comparison-period-chip">
              <strong>{s.label}</strong>{" "}
              <span className="muted small">
                {fmtDate(s.rangeStart)} – {fmtDate(s.rangeEnd)}
              </span>
            </span>
          ))}
        </div>
      </header>

      {analysis ? <AnalysisOverview analysis={analysis} /> : null}

      {analysisError ? (
        <div className="callout tone-warning">
          <strong>Claude analysis unavailable</strong>
          <p>
            The side-by-side metrics below are still accurate. Claude failed to produce
            a written comparison: {analysisError}
          </p>
        </div>
      ) : null}

      <section>
        <h2>Side-by-side metrics</h2>
        <div className="comparison-table-wrap">
          <table className="data-table comparison-table">
            <thead>
              <tr>
                <th>Metric</th>
                {labels.map((l, i) => (
                  <th key={i}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <MetricRow
                label="Total cards created in period"
                values={stats.map((s) =>
                  s.totalCardsCreated > 0 ? String(s.totalCardsCreated) : "—",
                )}
              />
              <MetricRow
                label="Escalated cards"
                values={stats.map((s) => String(s.totalEscalated))}
                tone={escalatedDeltaTone}
              />
              <MetricRow
                label="Escalation rate"
                values={stats.map((s) => formatPct(s.escalationRatePct))}
                tone={escalationRateTone}
              />
              <MetricRow
                label="Avg resolution time"
                values={stats.map((s) => `${s.avgDurationDays}d`)}
                tone={avgDurationTone}
              />
              <MetricRow
                label="Preventable"
                values={stats.map(
                  (s) => `${s.preventableCount} / ${s.totalEscalated}`,
                )}
                tone={preventableRateTone}
              />
              <MetricRow
                label="Preventable rate"
                values={stats.map((s) => formatPct(s.preventableRatePct))}
                tone={preventableRateTone}
              />
              <tr className="metric-section-row">
                <th colSpan={1 + labels.length}>By solution category</th>
              </tr>
              {SOLUTION_CATEGORIES.map((cat) => (
                <MetricRow
                  key={cat}
                  label={cat}
                  values={stats.map((s) =>
                    String(s.solutionCategoryCounts[cat] ?? 0),
                  )}
                />
              ))}
            </tbody>
          </table>
        </div>
        <p className="caption muted small">
          Tones reflect direction of change between the earliest and latest period
          (green = improvement, amber = regression). Periods are sorted chronologically.
        </p>
      </section>

      <ComparisonBars stats={stats} />

      {analysis ? <AnalysisDetails analysis={analysis} /> : null}
    </div>
  );
}

function AnalysisOverview({ analysis }: { analysis: ClaudeComparison }) {
  if (!analysis.overview) return null;
  return (
    <div className="callout comparison-overview">
      <strong>Claude's read</strong>
      <p>{analysis.overview}</p>
    </div>
  );
}

function AnalysisDetails({ analysis }: { analysis: ClaudeComparison }) {
  return (
    <>
      {analysis.metricChanges.length > 0 ? (
        <section>
          <h2>Metric changes</h2>
          <ul className="analysis-list">
            {analysis.metricChanges.map((m, i) => (
              <li key={i}>
                <strong>{m.metric}</strong>
                <p>{m.interpretation}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {analysis.patternShifts.length > 0 ? (
        <section>
          <h2>Pattern shifts</h2>
          <ul className="analysis-list">
            {analysis.patternShifts.map((p, i) => (
              <li key={i}>
                <strong>{p.title}</strong>
                <p>{p.description}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {(analysis.improvementsMade.length > 0 || analysis.newGaps.length > 0) ? (
        <section>
          <div className="analysis-grid">
            {analysis.improvementsMade.length > 0 ? (
              <div>
                <h3>Improvements made</h3>
                <ul className="analysis-bullets tone-success">
                  {analysis.improvementsMade.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {analysis.newGaps.length > 0 ? (
              <div>
                <h3>New gaps</h3>
                <ul className="analysis-bullets tone-warning">
                  {analysis.newGaps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {analysis.recommendations.length > 0 ? (
        <section>
          <h2>Recommendations</h2>
          <ol className="analysis-numbered">
            {analysis.recommendations.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}

function ComparisonBars({ stats }: { stats: PeriodStats[] }) {
  const maxEscalated = Math.max(...stats.map((s) => s.totalEscalated), 1);
  const maxRate = Math.max(
    ...stats.map((s) => s.escalationRatePct ?? 0),
    1,
  );
  const maxPreventableRate = Math.max(
    ...stats.map((s) => s.preventableRatePct),
    1,
  );

  return (
    <section>
      <h2>Period-over-period bars</h2>
      <div className="comparison-bars-grid">
        <BarGroup
          title="Escalated cards"
          stats={stats}
          getValue={(s) => s.totalEscalated}
          format={(v) => String(v)}
          max={maxEscalated}
          tone="info"
        />
        <BarGroup
          title="Escalation rate"
          stats={stats}
          getValue={(s) => s.escalationRatePct ?? 0}
          format={(v) => `${v.toFixed(1)}%`}
          max={maxRate}
          tone="warning"
        />
        <BarGroup
          title="Preventable rate"
          stats={stats}
          getValue={(s) => s.preventableRatePct}
          format={(v) => `${v.toFixed(1)}%`}
          max={maxPreventableRate}
          tone="danger"
        />
      </div>
    </section>
  );
}

function BarGroup({
  title,
  stats,
  getValue,
  format,
  max,
  tone,
}: {
  title: string;
  stats: PeriodStats[];
  getValue: (s: PeriodStats) => number;
  format: (v: number) => string;
  max: number;
  tone: "info" | "warning" | "danger";
}) {
  return (
    <div className="comparison-bargroup">
      <div className="comparison-bargroup-title">{title}</div>
      <div className="bar-chart">
        {stats.map((s, i) => {
          const value = getValue(s);
          const pct = max > 0 ? (value / max) * 100 : 0;
          return (
            <div key={i} className="bar-row">
              <span className="bar-label">{s.label}</span>
              <div className="bar-track">
                <div
                  className={`bar-fill tone-${tone}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="bar-value">{format(value)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
