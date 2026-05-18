import { useEffect, useMemo, useRef, useState } from "react";
import {
  MARCH_2026,
  type EscalationCard,
  type ReportPeriod,
  type SolutionCategory,
} from "../../lib/data";
import type { Credentials } from "../../lib/credentials";
import { fmtDate, rangesOverlap, type Timeframe } from "../../lib/timeframe";
import {
  exportContent,
  triggerDownload,
  type ExportFormat,
} from "../../lib/export";
import { renderStorageBody } from "../../lib/confluenceStorage";
import { Stat } from "../../components/Stat/Stat";
import { HorizontalBarChart } from "../../components/HorizontalBarChart/HorizontalBarChart";
import { StatusFlow } from "../../components/StatusFlow/StatusFlow";
import { StepProgress } from "../../components/StepProgress/StepProgress";
import { PublishToConfluenceDialog } from "../../dialogs/PublishToConfluenceDialog/PublishToConfluenceDialog";
import "./Report.css";

export type ReportSource = "bundled" | "live" | "imported";

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

function sourceBadge(source: ReportSource): { label: string; tone: string } {
  if (source === "live") return { label: "Live from Jira", tone: "info" };
  if (source === "imported") return { label: "Imported", tone: "neutral" };
  return { label: "Sample data", tone: "neutral" };
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

function ReportHeader({
  timeframe,
  source,
  projectKey,
  showStepProgress = true,
  backLabel = "← Change timeframe",
  onChange,
  onExport,
  onPublishToConfluence,
  exportDisabled,
}: {
  timeframe: Timeframe;
  source?: ReportSource;
  projectKey: string;
  showStepProgress?: boolean;
  backLabel?: string;
  onChange: () => void;
  onExport?: (format: ExportFormat) => void;
  onPublishToConfluence?: () => void;
  exportDisabled?: boolean;
}) {
  const badge = source ? sourceBadge(source) : null;
  return (
    <header className="page-header">
      {showStepProgress ? <StepProgress current={3} /> : null}
      <div className="header-row">
        <h1>{projectKey} Escalation Review</h1>
        <div className="header-actions">
          {onPublishToConfluence ? (
            <button
              type="button"
              className="primary-button"
              onClick={onPublishToConfluence}
            >
              Publish to Confluence
            </button>
          ) : null}
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
            The sample dataset only covers <strong>March 2026</strong> (
            {fmtDate(MARCH_2026.rangeStart)} – {fmtDate(MARCH_2026.rangeEnd)}). No cards
            from that period overlap {fmtDate(timeframe.start)} – {fmtDate(timeframe.end)}.
          </p>
        )}
        <button type="button" className="primary-button" onClick={onChange}>
          {backLabel === "← Back to home" ? "Back to home" : "Choose another timeframe"}
        </button>
      </div>
    </div>
  );
}

export function Report({
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
  const [showPublishDialog, setShowPublishDialog] = useState(false);

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

  const canPublish = source === "live";

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
        onPublishToConfluence={
          canPublish ? () => setShowPublishDialog(true) : undefined
        }
      />

      {showPublishDialog ? (
        <PublishToConfluenceDialog
          credentials={credentials}
          defaultTitle={`${credentials.projectKey} Escalation Review — ${timeframe.label} (${fmtDate(timeframe.start)} – ${fmtDate(timeframe.end)})`}
          defaultSpace={credentials.confluenceSpace}
          defaultParent={credentials.confluenceParentPage}
          storageBody={renderStorageBody({
            timeframe,
            cards: cardsInRange,
            report,
            includeDenominator,
            includeImprovements,
            projectKey: credentials.projectKey,
            jiraDomain: credentials.jiraDomain,
          })}
          onClose={() => setShowPublishDialog(false)}
        />
      ) : null}

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
              : `Sample dataset`}
        </span>
      </footer>
    </div>
  );
}
