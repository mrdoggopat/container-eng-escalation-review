import { useEffect, useMemo, useRef, useState } from "react";
import {
  MARCH_2026,
  type EscalationCard,
  type ReportPeriod,
  type SolutionCategory,
} from "./data";
import { LandingPage } from "./LandingPage";
import { DashboardPage } from "./DashboardPage";
import { TimeframeSelector } from "./TimeframeSelector";
import { QueryPreview } from "./QueryPreview";
import { StepProgress } from "./StepProgress";
import { GeneratingView } from "./GeneratingView";
import { SettingsPage } from "./SettingsPage";
import {
  ThemeToggle,
  applyTheme,
  loadTheme,
  saveTheme,
  type Theme,
} from "./ThemeToggle";
import { importFromFile, ImportError } from "./importer";
import {
  hasCompleteCredentials,
  loadCredentials,
  saveCredentials,
  type Credentials,
} from "./credentials";
import {
  generateReport,
  type ProgressUpdate,
} from "./reportGenerator";
import { fmtDate, rangesOverlap, type Timeframe } from "./timeframe";
import { exportContent, triggerDownload, type ExportFormat } from "./export";
import { CompareSetupPage } from "./CompareSetupPage";
import { ComparisonView } from "./ComparisonView";
import { MultiTimeframePicker } from "./MultiTimeframePicker";
import {
  runComparison,
  type CompareEntry,
  type ComparisonResult,
} from "./comparator";

type FilterKey =
  | "all"
  | "preventable"
  | "PR fix"
  | "Customer environment specific issue"
  | "Suggestion without PR or code fixes"
  | "Other";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "preventable", label: "Preventable" },
  { key: "PR fix", label: "PR fix" },
  { key: "Customer environment specific issue", label: "Customer env" },
  { key: "Suggestion without PR or code fixes", label: "Suggestion only" },
  { key: "Other", label: "Other" },
];

function solutionShortLabel(category: SolutionCategory) {
  if (category === "PR fix") return "PR fix";
  if (category === "Customer environment specific issue") return "Customer env";
  if (category === "Other") return "Other";
  return "Suggestion";
}

function solutionPillTone(category: SolutionCategory): string {
  if (category === "PR fix") return "info";
  if (category === "Customer environment specific issue") return "warning";
  if (category === "Other") return "neutral";
  return "neutral";
}

function matchesCategoryFilter(card: EscalationCard, filter: FilterKey) {
  if (filter === "all") return true;
  if (filter === "preventable") return card.preventable;
  return card.solutionCategory === filter;
}

function Stat({
  value,
  label,
  tone,
}: {
  value: React.ReactNode;
  label: string;
  tone?: "warning" | "danger" | "success" | "info";
}) {
  return (
    <div className="stat">
      <div className={`stat-value${tone ? ` tone-${tone}` : ""}`}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function HorizontalBarChart({ cards }: { cards: EscalationCard[] }) {
  const sorted = [...cards].sort((a, b) => b.durationDays - a.durationDays);
  const max = Math.max(...sorted.map((c) => c.durationDays), 1);
  return (
    <div className="bar-chart">
      {sorted.map((card) => {
        const pct = (card.durationDays / max) * 100;
        return (
          <div className="bar-row" key={card.id}>
            <a
              className="bar-label"
              href={`https://datadoghq.atlassian.net/browse/${card.id}`}
              target="_blank"
              rel="noreferrer"
            >
              {card.id}
            </a>
            <div className="bar-track">
              <div
                className={`bar-fill ${card.preventable ? "tone-warning" : "tone-info"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="bar-value">{card.durationDays}d</div>
          </div>
        );
      })}
      <div className="bar-legend">
        <span className="legend-item">
          <span className="legend-swatch tone-info" /> Not preventable
        </span>
        <span className="legend-item">
          <span className="legend-swatch tone-warning" /> Preventable
        </span>
      </div>
    </div>
  );
}

function StatusFlow({ flow }: { flow: string }) {
  const steps = flow.split("→").map((s) => s.trim());
  return (
    <div className="status-flow">
      {steps.map((step, idx) => (
        <span key={idx} className="status-step-wrap">
          <span className="status-step">{step}</span>
          {idx < steps.length - 1 ? (
            <span className="status-arrow" aria-hidden>
              →
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

function CardRow({ card }: { card: EscalationCard }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`card${open ? " open" : ""}`}>
      <button
        type="button"
        className="card-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="card-chevron" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="card-title">
          <span className="card-id">{card.id}</span>
          <span className="card-title-text">{card.title}</span>
        </span>
        <span className="card-meta">
          <span className={`pill tone-${card.preventable ? "warning" : "neutral"}`}>
            {card.preventable ? "Preventable" : "Not preventable"}
          </span>
          <span className={`pill tone-${solutionPillTone(card.solutionCategory)}`}>
            {solutionShortLabel(card.solutionCategory)}
          </span>
          <span className="duration">{card.durationDays}d</span>
        </span>
      </button>
      {open ? (
        <div className="card-body">
          <div className="card-meta-row">
            <span>
              <span className="meta-label">Assignee</span> {card.assignee}
            </span>
            <span>
              <span className="meta-label">Reporter</span> {card.reporter}
            </span>
            <span>
              <span className="meta-label">Escalation</span> {card.escalationKind}
            </span>
            <span>
              <span className="meta-label">Created</span> {fmtDate(card.createdAt)}
            </span>
            <span>
              <span className="meta-label">Resolved</span> {fmtDate(card.resolvedAt)}
            </span>
            <a
              className="jira-link"
              href={`https://datadoghq.atlassian.net/browse/${card.id}`}
              target="_blank"
              rel="noreferrer"
            >
              Open in Jira ↗
            </a>
          </div>

          <p className="card-summary">{card.summary}</p>

          <div className="card-section">
            <div className="section-label">Escalation reason</div>
            <p>{card.escalationReason}</p>
          </div>

          <div className="card-section">
            <div className="section-label">Status flow</div>
            <StatusFlow flow={card.statusFlow} />
          </div>

          <div className="card-section">
            <div className="section-label">
              {card.preventable ? "Why preventable" : "Why not preventable"}
            </div>
            <p>{card.preventableReason}</p>
          </div>

          <div className="card-section">
            <div className="section-label">External engineering involvement</div>
            <p>{card.nonTeeInvolvement}</p>
          </div>

          <div className="card-section">
            <div className="section-label">Improvement recommendation</div>
            <p className="muted">{card.improvement}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ExportMenu({
  onExport,
  disabled,
}: {
  onExport: (format: ExportFormat) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(format: ExportFormat) {
    setOpen(false);
    onExport(format);
  }

  return (
    <div className="export-menu" ref={ref}>
      <button
        type="button"
        className="ghost-button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Export ▾
      </button>
      {open ? (
        <div className="menu-popover" role="menu">
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => choose("markdown")}
          >
            <span className="menu-item-label">Markdown</span>
            <span className="menu-item-hint">.md — full narrative report</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => choose("csv")}
          >
            <span className="menu-item-label">CSV</span>
            <span className="menu-item-hint">.csv — one row per card</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => choose("json")}
          >
            <span className="menu-item-label">JSON</span>
            <span className="menu-item-hint">.json — structured data</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

type ReportSource = "bundled" | "live" | "imported";

function sourceBadge(source: ReportSource): { label: string; tone: string } {
  if (source === "live") return { label: "Live from Jira", tone: "info" };
  if (source === "imported") return { label: "Imported", tone: "neutral" };
  return { label: "Bundled dataset", tone: "neutral" };
}

function ReportHeader({
  timeframe,
  source,
  projectKey,
  showStepProgress = true,
  backLabel = "← Change timeframe",
  onChange,
  onExport,
  exportDisabled,
}: {
  timeframe: Timeframe;
  source?: ReportSource;
  projectKey: string;
  showStepProgress?: boolean;
  backLabel?: string;
  onChange: () => void;
  onExport?: (format: ExportFormat) => void;
  exportDisabled?: boolean;
}) {
  const badge = source ? sourceBadge(source) : null;
  return (
    <header className="page-header">
      {showStepProgress ? <StepProgress current={3} /> : null}
      <div className="header-row">
        <h1>{projectKey} Escalation Review</h1>
        <div className="header-actions">
          {onExport ? (
            <ExportMenu onExport={onExport} disabled={exportDisabled} />
          ) : null}
          <button type="button" className="ghost-button" onClick={onChange}>
            {backLabel}
          </button>
        </div>
      </div>
      <div className="page-subtitle">
        <span className="period">{timeframe.label}</span>
        <span className="dot" aria-hidden>
          ·
        </span>
        <span>
          Range: {fmtDate(timeframe.start)} – {fmtDate(timeframe.end)}
        </span>
        {badge ? (
          <>
            <span className="dot" aria-hidden>
              ·
            </span>
            <span
              className={`pill tone-${badge.tone}`}
              style={{ alignSelf: "center" }}
            >
              {badge.label}
            </span>
          </>
        ) : null}
      </div>
    </header>
  );
}

function EmptyState({
  timeframe,
  source,
  projectKey,
  backLabel,
  onChange,
}: {
  timeframe: Timeframe;
  source: ReportSource;
  projectKey: string;
  backLabel?: string;
  onChange: () => void;
}) {
  return (
    <div className="page">
      <ReportHeader
        timeframe={timeframe}
        source={source}
        projectKey={projectKey}
        backLabel={backLabel}
        onChange={onChange}
      />
      <div className="empty-state">
        <h2>No escalations found for this timeframe</h2>
        {source === "live" ? (
          <p className="muted">
            The JQL queries returned zero escalated cards for {fmtDate(timeframe.start)} –{" "}
            {fmtDate(timeframe.end)}.
          </p>
        ) : source === "imported" ? (
          <p className="muted">
            The imported report contained no cards for{" "}
            {fmtDate(timeframe.start)} – {fmtDate(timeframe.end)}.
          </p>
        ) : (
          <p className="muted">
            The currently bundled dataset only covers <strong>March 2026</strong> (
            {fmtDate(MARCH_2026.rangeStart)} – {fmtDate(MARCH_2026.rangeEnd)}). No cards from
            that period overlap {fmtDate(timeframe.start)} – {fmtDate(timeframe.end)}.
          </p>
        )}
        <button type="button" className="primary-button" onClick={onChange}>
          {backLabel === "← Back to home" ? "Back to home" : "Choose another timeframe"}
        </button>
      </div>
    </div>
  );
}

function Report({
  timeframe,
  report,
  source,
  warnings,
  credentials,
  backLabel,
  showStepProgress = true,
  onChangeTimeframe,
}: {
  timeframe: Timeframe;
  report: ReportPeriod;
  source: ReportSource;
  warnings: string[];
  credentials: Credentials;
  backLabel?: string;
  showStepProgress?: boolean;
  onChangeTimeframe: () => void;
}) {
  const [filter, setFilter] = useState<FilterKey>("all");

  const cardsInRange = useMemo(
    () =>
      source === "bundled"
        ? report.cards.filter((c) =>
            rangesOverlap(c.createdAt, c.resolvedAt, timeframe.start, timeframe.end),
          )
        : report.cards,
    [report.cards, source, timeframe.start, timeframe.end],
  );

  const isCanonicalMarch =
    source === "bundled" &&
    timeframe.start === report.rangeStart &&
    timeframe.end === report.rangeEnd;
  const includeDenominator =
    (source === "live" && report.totalCardsCreated > 0) ||
    (source === "imported" && report.totalCardsCreated > 0) ||
    isCanonicalMarch;
  const includeImprovements = isCanonicalMarch || report.improvements.length > 0;

  const visibleCards = useMemo(
    () => cardsInRange.filter((c) => matchesCategoryFilter(c, filter)),
    [cardsInRange, filter],
  );

  const columnCounts = useMemo(() => {
    return credentials.escalationColumns.map((column) => ({
      column,
      count: cardsInRange.filter((c) => c.statusFlow.includes(column)).length,
    }));
  }, [cardsInRange, credentials.escalationColumns]);

  const solutionCounts: Record<SolutionCategory, number> = useMemo(
    () => ({
      "PR fix": cardsInRange.filter((c) => c.solutionCategory === "PR fix").length,
      "Customer environment specific issue": cardsInRange.filter(
        (c) => c.solutionCategory === "Customer environment specific issue",
      ).length,
      "Suggestion without PR or code fixes": cardsInRange.filter(
        (c) => c.solutionCategory === "Suggestion without PR or code fixes",
      ).length,
      Other: cardsInRange.filter((c) => c.solutionCategory === "Other").length,
    }),
    [cardsInRange],
  );

  function handleExport(format: ExportFormat) {
    const { filename, mimeType, body } = exportContent(
      {
        timeframe,
        cards: cardsInRange,
        report,
        includeDenominator,
        includeImprovements,
      },
      format,
    );
    triggerDownload(filename, body, mimeType);
  }

  if (cardsInRange.length === 0) {
    return (
      <EmptyState
        timeframe={timeframe}
        source={source}
        projectKey={credentials.projectKey}
        backLabel={backLabel}
        onChange={onChangeTimeframe}
      />
    );
  }

  const totalEscalated = cardsInRange.length;
  const preventableCount = cardsInRange.filter((c) => c.preventable).length;
  const avgDuration =
    Math.round(
      (cardsInRange.reduce((sum, c) => sum + c.durationDays, 0) / cardsInRange.length) * 10,
    ) / 10;
  const preventableRate = (preventableCount / totalEscalated) * 100;

  const escalationRate =
    includeDenominator && report.totalCardsCreated > 0
      ? (totalEscalated / report.totalCardsCreated) * 100
      : null;

  return (
    <div className="page">
      <ReportHeader
        timeframe={timeframe}
        source={source}
        projectKey={credentials.projectKey}
        backLabel={backLabel}
        showStepProgress={showStepProgress}
        onChange={onChangeTimeframe}
        onExport={handleExport}
      />

      {warnings.length > 0 ? (
        <div className="callout tone-warning">
          <strong>Warnings during generation</strong>
          <ul className="warning-list">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="stats-grid">
        {includeDenominator ? (
          <Stat
            value={report.totalCardsCreated}
            label={`Total ${credentials.projectKey} cards`}
          />
        ) : null}
        <Stat value={totalEscalated} label="Escalated" tone="warning" />
        {escalationRate !== null ? (
          <Stat
            value={`${escalationRate.toFixed(1)}%`}
            label="Escalation rate"
            tone="warning"
          />
        ) : null}
        <Stat value={`${avgDuration}d`} label="Avg resolution (escalated)" />
        <Stat
          value={`${preventableCount} / ${totalEscalated}`}
          label={`Preventable (${preventableRate.toFixed(1)}%)`}
          tone="danger"
        />
      </section>

      <hr className="divider" />

      <section>
        <h2>Escalation breakdown</h2>
        <div className="breakdown-grid">
          <div>
            <h3>By escalation column</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Column</th>
                  <th className="num">Cards</th>
                </tr>
              </thead>
              <tbody>
                {columnCounts.map(({ column, count }) => (
                  <tr key={column}>
                    <td>{column}</td>
                    <td className="num">{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="caption">
              A card is counted once per column its status history touched, so totals
              may exceed {cardsInRange.length} for cards that escalated through multiple
              columns.
            </p>
          </div>

          <div>
            <h3>Resolution time by card (days)</h3>
            <HorizontalBarChart cards={cardsInRange} />
            <p className="caption">
              Each bar = days from card creation to first transition into Done / Archive.
            </p>
          </div>
        </div>
      </section>

      <hr className="divider" />

      <section>
        <h2>By solution category</h2>
        <div className="stats-grid four">
          <Stat
            value={solutionCounts["PR fix"]}
            label="PR fix (engineering code change)"
            tone="info"
          />
          <Stat
            value={solutionCounts["Customer environment specific issue"]}
            label="Customer environment specific"
            tone="warning"
          />
          <Stat
            value={solutionCounts["Suggestion without PR or code fixes"]}
            label="Suggestion (no code change)"
          />
          <Stat value={solutionCounts["Other"]} label="Other" />
        </div>
      </section>

      <hr className="divider" />

      <section>
        <div className="section-header">
          <h2>Escalated cards</h2>
          <span className="muted small">
            {visibleCards.length} of {cardsInRange.length} shown
          </span>
        </div>
        <div className="filter-row">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`pill clickable${filter === f.key ? " active" : ""}${
                f.key === "preventable" ? " tone-warning" : ""
              }`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="card-list">
          {visibleCards.map((card) => (
            <CardRow key={card.id} card={card} />
          ))}
        </div>
      </section>

      {preventableCount > 0 ? (
        <>
          <hr className="divider" />
          <section>
            <h2>Preventable escalations</h2>
            <div className="callout tone-warning">
              <strong>
                {preventableCount} of {totalEscalated} escalations (
                {preventableRate.toFixed(1)}%) were preventable
              </strong>
              <p>
                These are cases where the escalation produced engineering input from
                outside the internal team that the team could have provided directly —
                via Slack, runbook, or an existing investigation.
              </p>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Card</th>
                  <th>Why preventable</th>
                </tr>
              </thead>
              <tbody>
                {cardsInRange
                  .filter((c) => c.preventable)
                  .map((c) => (
                    <tr key={c.id} className="row-warning">
                      <td>
                        <a
                          className="link"
                          href={`https://datadoghq.atlassian.net/browse/${c.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {c.id}
                        </a>
                      </td>
                      <td>{c.preventableReason}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      {includeImprovements ? (
        <>
          <hr className="divider" />
          <section>
            <h2>Improvement recommendations</h2>
            <ol className="improvements">
              {report.improvements.map((item) => (
                <li key={item.title}>
                  <div className="improvement-content">
                    <div className="improvement-title">{item.title}</div>
                    <div className="improvement-body muted">{item.body}</div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : null}

      <footer className="page-footer">
        <span className="muted small">
          Data source:{" "}
          {source === "live"
            ? `Live from Jira (${credentials.projectKey})`
            : source === "imported"
              ? `Imported report`
              : `Bundled ${credentials.projectKey} dataset`}
        </span>
      </footer>
    </div>
  );
}

type View =
  | { kind: "landing" }
  | { kind: "dashboard" }
  | { kind: "preview" }
  | { kind: "imported"; timeframe: Timeframe; report: ReportPeriod; filename: string }
  | {
      kind: "settings";
      isOnboarding: boolean;
      initialTab?: "credentials" | "team";
    }
  | { kind: "selector" }
  | { kind: "prepare"; timeframe: Timeframe }
  | {
      kind: "generating";
      timeframe: Timeframe;
      progress: ProgressUpdate | null;
      error: string | null;
    }
  | {
      kind: "report";
      timeframe: Timeframe;
      report: ReportPeriod;
      source: "bundled" | "live";
      warnings: string[];
    }
  | { kind: "compare-setup" }
  | { kind: "compare-pick-timeframe" }
  | {
      kind: "compare-generating-fresh";
      timeframe: Timeframe;
      progress: ProgressUpdate | null;
      error: string | null;
    }
  | { kind: "compare-pick-multi" }
  | {
      kind: "compare-generating-batch";
      queue: Timeframe[];
      currentIndex: number;
      progress: ProgressUpdate | null;
      error: string | null;
      completed: CompareEntry[];
    }
  | { kind: "compare-analyzing"; message: string; error: string | null }
  | { kind: "compare-result"; result: ComparisonResult };

export default function App() {
  const [credentials, setCredentials] = useState<Credentials>(() => loadCredentials());
  const credentialsComplete = hasCompleteCredentials(credentials);
  const [view, setView] = useState<View>({ kind: "landing" });
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [importError, setImportError] = useState<string | null>(null);
  const [compareEntries, setCompareEntries] = useState<CompareEntry[]>([]);
  const [compareImportError, setCompareImportError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }

  function homeView(): View {
    return credentialsComplete ? { kind: "dashboard" } : { kind: "landing" };
  }

  function handleGetStarted() {
    if (credentialsComplete) {
      setView({ kind: "dashboard" });
    } else {
      setView({ kind: "settings", isOnboarding: true });
    }
  }

  function handlePreview() {
    setView({ kind: "preview" });
  }

  function handleGenerateFromDashboard() {
    setView({ kind: "selector" });
  }

  async function handleImport(file: File) {
    setImportError(null);
    try {
      const { timeframe, report } = await importFromFile(file);
      setView({ kind: "imported", timeframe, report, filename: file.name });
    } catch (err) {
      if (err instanceof ImportError) {
        setImportError(err.message);
      } else {
        setImportError(
          `Could not import ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  function openSettings(initialTab: "credentials" | "team" = "credentials") {
    setView({
      kind: "settings",
      isOnboarding: !credentialsComplete,
      initialTab,
    });
  }

  function handleSaveCredentials(creds: Credentials) {
    saveCredentials(creds);
    setCredentials(creds);
    setView({ kind: "dashboard" });
  }

  async function runGenerate(timeframe: Timeframe) {
    cancelledRef.current = false;
    setView({ kind: "generating", timeframe, progress: null, error: null });
    try {
      const result = await generateReport(credentials, timeframe, (update) => {
        if (cancelledRef.current) return;
        setView((v) =>
          v.kind === "generating" ? { ...v, progress: update } : v,
        );
      });
      if (cancelledRef.current) return;
      setView({
        kind: "report",
        timeframe,
        report: result.report,
        source: "live",
        warnings: result.warnings,
      });
    } catch (err) {
      if (cancelledRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
      setView((v) =>
        v.kind === "generating" ? { ...v, error: message } : v,
      );
    }
  }

  function handleStartCompare() {
    setCompareEntries([]);
    setCompareImportError(null);
    setView({ kind: "compare-setup" });
  }

  async function handleCompareAddFile(file: File) {
    setCompareImportError(null);
    try {
      const { timeframe, report } = await importFromFile(file);
      const next: CompareEntry = {
        origin: "imported",
        filename: file.name,
        timeframe,
        report,
      };
      setCompareEntries((cur) => [...cur, next]);
    } catch (err) {
      if (err instanceof ImportError) {
        setCompareImportError(err.message);
      } else {
        setCompareImportError(
          `Could not import ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  function handleCompareRemove(index: number) {
    setCompareEntries((cur) => cur.filter((_, i) => i !== index));
  }

  function handleCompareAddFresh() {
    if (!credentialsComplete) {
      setView({ kind: "settings", isOnboarding: true });
      return;
    }
    setView({ kind: "compare-pick-timeframe" });
  }

  function handleCompareAddMultiple() {
    if (!credentialsComplete) {
      setView({ kind: "settings", isOnboarding: true });
      return;
    }
    setView({ kind: "compare-pick-multi" });
  }

  async function runCompareBatch(
    queue: Timeframe[],
    startIndex: number,
    seedCompleted: CompareEntry[],
  ) {
    cancelledRef.current = false;
    const completed = [...seedCompleted];
    for (let i = startIndex; i < queue.length; i++) {
      const tf = queue[i];
      setView({
        kind: "compare-generating-batch",
        queue,
        currentIndex: i,
        progress: null,
        error: null,
        completed,
      });
      try {
        const result = await generateReport(credentials, tf, (update) => {
          if (cancelledRef.current) return;
          setView((v) =>
            v.kind === "compare-generating-batch"
              ? { ...v, progress: update }
              : v,
          );
        });
        if (cancelledRef.current) return;
        completed.push({ origin: "live", timeframe: tf, report: result.report });
      } catch (err) {
        if (cancelledRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        setView({
          kind: "compare-generating-batch",
          queue,
          currentIndex: i,
          progress: null,
          error: message,
          completed,
        });
        return;
      }
    }
    setCompareEntries((cur) => [...cur, ...completed]);
    setView({ kind: "compare-setup" });
  }

  async function runCompareGenerate(timeframe: Timeframe) {
    cancelledRef.current = false;
    setView({
      kind: "compare-generating-fresh",
      timeframe,
      progress: null,
      error: null,
    });
    try {
      const result = await generateReport(credentials, timeframe, (update) => {
        if (cancelledRef.current) return;
        setView((v) =>
          v.kind === "compare-generating-fresh"
            ? { ...v, progress: update }
            : v,
        );
      });
      if (cancelledRef.current) return;
      const entry: CompareEntry = {
        origin: "live",
        timeframe,
        report: result.report,
      };
      setCompareEntries((cur) => [...cur, entry]);
      setView({ kind: "compare-setup" });
    } catch (err) {
      if (cancelledRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
      setView((v) =>
        v.kind === "compare-generating-fresh"
          ? { ...v, error: message }
          : v,
      );
    }
  }

  async function handleRunComparison() {
    if (compareEntries.length < 2) return;
    setView({ kind: "compare-analyzing", message: "Starting…", error: null });
    try {
      const result = await runComparison(credentials, compareEntries, (msg) => {
        setView((v) =>
          v.kind === "compare-analyzing" ? { ...v, message: msg } : v,
        );
      });
      setView({ kind: "compare-result", result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setView((v) =>
        v.kind === "compare-analyzing" ? { ...v, error: message } : v,
      );
    }
  }

  return (
    <>
      <ThemeToggle theme={theme} onToggle={toggleTheme} />

      {view.kind !== "settings" &&
      view.kind !== "landing" &&
      view.kind !== "preview" &&
      view.kind !== "imported" &&
      view.kind !== "compare-result" ? (
        <SettingsButton
          onClick={() => openSettings("credentials")}
          configured={credentialsComplete}
        />
      ) : null}

      {view.kind === "landing" ? (
        <LandingPage
          onGetStarted={handleGetStarted}
          onPreview={handlePreview}
          credentialsConfigured={credentialsComplete}
          projectKey={credentials.projectKey}
        />
      ) : null}

      {view.kind === "dashboard" ? (
        <DashboardPage
          projectKey={credentials.projectKey}
          onGenerate={handleGenerateFromDashboard}
          onImport={(file) => {
            void handleImport(file);
          }}
          onCompare={handleStartCompare}
          onPreview={handlePreview}
          importError={importError}
          dismissImportError={() => setImportError(null)}
        />
      ) : null}

      {view.kind === "preview" ? (
        <Report
          timeframe={{
            preset: "custom",
            label: MARCH_2026.label,
            start: MARCH_2026.rangeStart,
            end: MARCH_2026.rangeEnd,
          }}
          report={MARCH_2026}
          source="bundled"
          warnings={[]}
          credentials={credentials}
          backLabel="← Back to home"
          showStepProgress={false}
          onChangeTimeframe={() => setView(homeView())}
        />
      ) : null}

      {view.kind === "imported" ? (
        <Report
          timeframe={view.timeframe}
          report={view.report}
          source="imported"
          warnings={[`Imported from ${view.filename}`]}
          credentials={credentials}
          backLabel="← Back to home"
          showStepProgress={false}
          onChangeTimeframe={() => setView(homeView())}
        />
      ) : null}

      {view.kind === "settings" ? (
        <SettingsPage
          initial={credentials}
          isOnboarding={view.isOnboarding}
          initialTab={view.initialTab ?? "credentials"}
          onSave={handleSaveCredentials}
          onCancel={
            credentialsComplete ? () => setView({ kind: "dashboard" }) : undefined
          }
        />
      ) : null}

      {view.kind === "selector" ? (
        <TimeframeSelector
          onSelect={(timeframe) => setView({ kind: "prepare", timeframe })}
        />
      ) : null}

      {view.kind === "prepare" ? (
        <QueryPreview
          timeframe={view.timeframe}
          jqlConfig={{
            projectKey: credentials.projectKey,
            escalationColumns: credentials.escalationColumns,
          }}
          canGenerate={credentialsComplete}
          onBack={() => setView({ kind: "selector" })}
          onContinue={() =>
            setView({
              kind: "report",
              timeframe: view.timeframe,
              report: MARCH_2026,
              source: "bundled",
              warnings: [],
            })
          }
          onGenerate={() => {
            if (!credentialsComplete) {
              openSettings("credentials");
              return;
            }
            void runGenerate(view.timeframe);
          }}
        />
      ) : null}

      {view.kind === "generating" ? (
        <GeneratingView
          timeframe={view.timeframe}
          progress={view.progress}
          error={view.error}
          onCancel={() => {
            cancelledRef.current = true;
            setView({ kind: "prepare", timeframe: view.timeframe });
          }}
          onUseBundled={() => {
            cancelledRef.current = true;
            setView({
              kind: "report",
              timeframe: view.timeframe,
              report: MARCH_2026,
              source: "bundled",
              warnings: [],
            });
          }}
          onRetry={() => void runGenerate(view.timeframe)}
        />
      ) : null}

      {view.kind === "report" ? (
        <Report
          timeframe={view.timeframe}
          report={view.report}
          source={view.source}
          warnings={view.warnings}
          credentials={credentials}
          onChangeTimeframe={() => setView({ kind: "selector" })}
        />
      ) : null}

      {view.kind === "compare-setup" ? (
        <CompareSetupPage
          entries={compareEntries}
          credentialsConfigured={credentialsComplete}
          importError={compareImportError}
          onAddFromFile={(file) => {
            void handleCompareAddFile(file);
          }}
          onAddFreshFromJira={handleCompareAddFresh}
          onAddMultipleFromJira={handleCompareAddMultiple}
          onRemove={handleCompareRemove}
          onCompare={() => {
            void handleRunComparison();
          }}
          onBack={() => setView(homeView())}
          dismissImportError={() => setCompareImportError(null)}
        />
      ) : null}

      {view.kind === "compare-pick-timeframe" ? (
        <div className="prepare-page">
          <header className="prepare-header">
            <h1>Pick a timeframe to add</h1>
            <p className="selector-intro">
              This timeframe will be generated fresh from Jira and appended to the
              comparison.
            </p>
          </header>
          <TimeframeSelector
            onSelect={(timeframe) => {
              void runCompareGenerate(timeframe);
            }}
          />
          <div className="prepare-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setView({ kind: "compare-setup" })}
            >
              ← Back to comparison
            </button>
          </div>
        </div>
      ) : null}

      {view.kind === "compare-generating-fresh" ? (
        <GeneratingView
          timeframe={view.timeframe}
          progress={view.progress}
          error={view.error}
          showStepProgress={false}
          onCancel={() => {
            cancelledRef.current = true;
            setView({ kind: "compare-setup" });
          }}
          onRetry={() => void runCompareGenerate(view.timeframe)}
        />
      ) : null}

      {view.kind === "compare-pick-multi" ? (
        <MultiTimeframePicker
          existingEntries={compareEntries}
          onCancel={() => setView({ kind: "compare-setup" })}
          onSubmit={(timeframes) => {
            void runCompareBatch(timeframes, 0, []);
          }}
        />
      ) : null}

      {view.kind === "compare-generating-batch" ? (
        <GeneratingView
          timeframe={view.queue[view.currentIndex]}
          progress={view.progress}
          error={view.error}
          showStepProgress={false}
          batch={{
            index: view.currentIndex,
            total: view.queue.length,
            completedLabels: view.queue
              .slice(0, view.currentIndex)
              .map((t) => t.label),
            upcomingLabels: view.queue
              .slice(view.currentIndex + 1)
              .map((t) => t.label),
          }}
          onCancel={() => {
            cancelledRef.current = true;
            // Keep any already-finished reports so the user doesn't lose work.
            if (view.completed.length > 0) {
              setCompareEntries((cur) => [...cur, ...view.completed]);
            }
            setView({ kind: "compare-setup" });
          }}
          onRetry={() =>
            void runCompareBatch(view.queue, view.currentIndex, view.completed)
          }
        />
      ) : null}

      {view.kind === "compare-analyzing" ? (
        <div className="prepare-page">
          <header className="prepare-header">
            <h1>{view.error ? "Comparison failed" : "Comparing periods…"}</h1>
            <p className="selector-intro">
              {view.error
                ? "Claude couldn't produce the comparison."
                : view.message}
            </p>
          </header>
          {view.error ? (
            <div className="callout tone-danger">
              <strong>Error</strong>
              <p>{view.error}</p>
            </div>
          ) : (
            <div className="generating-card">
              <p className="phase-status muted small">{view.message}</p>
            </div>
          )}
          <div className="prepare-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setView({ kind: "compare-setup" })}
            >
              ← Back to comparison
            </button>
            {view.error ? (
              <button
                type="button"
                className="primary-button"
                onClick={() => void handleRunComparison()}
              >
                Retry
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {view.kind === "compare-result" ? (
        <ComparisonView
          result={view.result}
          onBack={() => {
            setCompareEntries([]);
            setView(homeView());
          }}
        />
      ) : null}
    </>
  );
}

function SettingsButton({
  onClick,
  configured,
}: {
  onClick: () => void;
  configured: boolean;
}) {
  return (
    <button
      type="button"
      className={`settings-button${configured ? " configured" : " unconfigured"}`}
      onClick={onClick}
      aria-label={configured ? "Open settings" : "Set up credentials"}
    >
      <span
        className={`settings-dot${configured ? " on" : " off"}`}
        aria-hidden
      />
      <span className="settings-text">
        {configured ? "Settings" : "Set up"}
      </span>
    </button>
  );
}
