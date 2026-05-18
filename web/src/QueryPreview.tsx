import { Fragment, useState, type ReactNode } from "react";
import {
  buildEscalationJql,
  buildTotalCardsJql,
  fmtDate,
  type JqlConfig,
  type Timeframe,
} from "./timeframe";
import { StepProgress } from "./StepProgress";
import { Tooltip } from "./Tooltip";

const JQL_KEYWORDS = new Set([
  "AND",
  "OR",
  "NOT",
  "IN",
  "IS",
  "EMPTY",
  "NULL",
  "DURING",
  "status",
  "changed",
  "to",
  "project",
  "created",
]);

const TOKENIZER = /(".*?"|>=|<=|!=|=|\bAND\b|\bOR\b|\bNOT\b|\bIN\b|\bIS\b|\bEMPTY\b|\bNULL\b|\bDURING\b|\bstatus\b|\bchanged\b|\bto\b|\bproject\b|\bcreated\b)/g;

function HighlightedJql({ jql }: { jql: string }) {
  const nodes: ReactNode[] = [];
  const parts = jql.split(TOKENIZER);
  parts.forEach((part, i) => {
    if (!part) return;
    if (part.startsWith('"') && part.endsWith('"')) {
      nodes.push(
        <span key={i} className="jql-string">
          {part}
        </span>,
      );
    } else if (JQL_KEYWORDS.has(part)) {
      nodes.push(
        <span key={i} className="jql-keyword">
          {part}
        </span>,
      );
    } else if (part === ">=" || part === "<=" || part === "=" || part === "!=") {
      nodes.push(
        <span key={i} className="jql-operator">
          {part}
        </span>,
      );
    } else {
      nodes.push(<Fragment key={i}>{part}</Fragment>);
    }
  });
  return <pre className="query-code">{nodes}</pre>;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may be unavailable on insecure origins; ignore silently.
    }
  }

  return (
    <button
      type="button"
      className={`copy-button${copied ? " copied" : ""}`}
      onClick={onClick}
    >
      {copied ? "Copied" : "Copy JQL"}
    </button>
  );
}

function QueryBlock({
  index,
  title,
  description,
  jql,
}: {
  index: number;
  title: string;
  description: string;
  jql: string;
}) {
  return (
    <div className="query-block">
      <div className="query-block-header">
        <div className="query-block-title">
          <span className="query-index" aria-hidden>
            {index}
          </span>
          <div>
            <div className="query-title-text">{title}</div>
            <div className="query-description">{description}</div>
          </div>
        </div>
        <CopyButton value={jql} />
      </div>
      <HighlightedJql jql={jql} />
    </div>
  );
}

export function QueryPreview({
  timeframe,
  jqlConfig,
  onBack,
  onContinue,
  onGenerate,
  canGenerate,
}: {
  timeframe: Timeframe;
  jqlConfig: JqlConfig;
  onBack: () => void;
  onContinue: () => void;
  onGenerate: () => void;
  canGenerate: boolean;
}) {
  const escalationJql = buildEscalationJql(timeframe, jqlConfig);
  const totalJql = buildTotalCardsJql(timeframe, jqlConfig);

  return (
    <div className="prepare-page">
      <StepProgress current={2} />

      <header className="prepare-header">
        <h1>Query Jira</h1>
        <p className="selector-intro">
          The workflow runs two JQL queries against the CONS project for the selected
          window — one for escalated cards, one for the total card volume used as the
          escalation-rate denominator.
        </p>
      </header>

      <div className="timeframe-card">
        <div className="timeframe-card-label">Selected timeframe</div>
        <div className="timeframe-card-row">
          <div className="timeframe-card-period">{timeframe.label}</div>
          <div className="timeframe-card-range">
            {fmtDate(timeframe.start)} – {fmtDate(timeframe.end)}
          </div>
        </div>
      </div>

      <section className="query-list">
        <QueryBlock
          index={1}
          title="Escalated cards"
          description={`Cards whose status history transitions into ${jqlConfig.escalationColumns.map((c) => `"${c}"`).join(", ")} during the window — regardless of current status.`}
          jql={escalationJql}
        />
        <QueryBlock
          index={2}
          title={`Total ${jqlConfig.projectKey} cards created in period`}
          description="Used as the denominator for the escalation rate (escalated cards / total cards created)."
          jql={totalJql}
        />
      </section>

      <div className="callout tone-info">
        <strong>What happens next</strong>
        <p>
          <strong>Generate fresh report</strong> runs the queries above against Jira and
          uses Claude to analyze each card (preventability, solution category, status
          flow). <strong>Use bundled data</strong> falls back to the static March 2026
          dataset filtered to this window — useful for previewing without credentials.
        </p>
      </div>

      <div className="prepare-actions">
        <button type="button" className="ghost-button" onClick={onBack}>
          ← Back
        </button>
        <div className="action-group">
          <button type="button" className="ghost-button" onClick={onContinue}>
            Use bundled data
          </button>
          <Tooltip
            show={!canGenerate}
            content={
              <>
                Set Jira &amp; Anthropic credentials first
                <span className="tooltip-hint">
                  Open the <strong>Set credentials</strong> button in the top-right
                </span>
              </>
            }
          >
            <button
              type="button"
              className="primary-button"
              onClick={onGenerate}
              disabled={!canGenerate}
            >
              Generate fresh report →
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
