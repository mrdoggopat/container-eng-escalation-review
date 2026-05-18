import type { EscalationCard, ReportPeriod } from "./data";
import { fmtDate, type Timeframe } from "./timeframe";

export type ExportFormat = "markdown" | "csv" | "json";

export type ExportContext = {
  timeframe: Timeframe;
  cards: EscalationCard[];
  report: ReportPeriod;
  /** Whether `report.totalCardsCreated` is a meaningful denominator. */
  includeDenominator: boolean;
  /** Whether to append the curated improvement-recommendations section. */
  includeImprovements: boolean;
};

export function fileBaseName(timeframe: Timeframe): string {
  return `cons-escalation-review-${timeframe.start}-to-${timeframe.end}`;
}

export function exportContent(ctx: ExportContext, format: ExportFormat): {
  filename: string;
  mimeType: string;
  body: string;
} {
  const base = fileBaseName(ctx.timeframe);
  switch (format) {
    case "markdown":
      return {
        filename: `${base}.md`,
        mimeType: "text/markdown;charset=utf-8",
        body: generateMarkdown(ctx),
      };
    case "csv":
      return {
        filename: `${base}.csv`,
        mimeType: "text/csv;charset=utf-8",
        body: generateCSV(ctx),
      };
    case "json":
      return {
        filename: `${base}.json`,
        mimeType: "application/json;charset=utf-8",
        body: generateJSON(ctx),
      };
  }
}

export function triggerDownload(filename: string, body: string, mimeType: string) {
  const blob = new Blob([body], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function jiraUrl(id: string): string {
  return `https://datadoghq.atlassian.net/browse/${id}`;
}

function computeStats(ctx: ExportContext) {
  const total = ctx.cards.length;
  const preventable = ctx.cards.filter((c) => c.preventable).length;
  const avgDuration =
    total === 0
      ? 0
      : Math.round(
          (ctx.cards.reduce((sum, c) => sum + c.durationDays, 0) / total) * 10,
        ) / 10;
  const escalationRate =
    ctx.includeDenominator && ctx.report.totalCardsCreated > 0
      ? (total / ctx.report.totalCardsCreated) * 100
      : null;
  const preventableRate = total === 0 ? 0 : (preventable / total) * 100;
  return { total, preventable, avgDuration, escalationRate, preventableRate };
}

function generateMarkdown(ctx: ExportContext): string {
  const { timeframe, cards, report, includeDenominator, includeImprovements } = ctx;
  const stats = computeStats(ctx);
  const lines: string[] = [];

  lines.push(`# CONS Escalation Review: ${timeframe.label}`);
  lines.push("");
  lines.push(
    `_Range: ${fmtDate(timeframe.start)} – ${fmtDate(timeframe.end)} · Generated: ${fmtDate(new Date().toISOString().slice(0, 10))}_`,
  );
  lines.push("");

  // Executive Summary
  lines.push("## Executive Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  if (includeDenominator) {
    lines.push(`| Total CONS cards created in period | ${report.totalCardsCreated} |`);
    lines.push(
      `| Cards escalated beyond TEE | ${stats.total}${stats.escalationRate !== null ? ` (${stats.escalationRate.toFixed(1)}%)` : ""} |`,
    );
    lines.push(
      `| Cards never escalated beyond TEE | ${Math.max(0, report.totalCardsCreated - stats.total)} |`,
    );
  } else {
    lines.push(`| Cards escalated beyond TEE in window | ${stats.total} |`);
  }
  lines.push(`| Average resolution time (escalated cards) | ${stats.avgDuration} days |`);
  lines.push(
    `| Preventable escalation rate | ${stats.preventable} of ${stats.total} (${stats.preventableRate.toFixed(1)}%) |`,
  );
  lines.push("");

  // Escalation Rate Analysis
  lines.push("## Escalation Rate Analysis");
  lines.push("");
  if (stats.total === 0) {
    lines.push(
      "_No escalated cards overlap the selected window. The bundled dataset only covers March 2026._",
    );
    lines.push("");
    return lines.join("\n");
  }
  lines.push("| Card | Escalation Column | Current Status |");
  lines.push("|------|-------------------|----------------|");
  for (const c of cards) {
    lines.push(`| ${c.id} | ${c.escalationKind} | Archive |`);
  }
  lines.push("");

  // Detailed Card Analysis
  lines.push("## Detailed Card Analysis");
  lines.push("");
  cards.forEach((c, idx) => {
    lines.push(`### ${idx + 1}. ${c.id} — ${c.title}`);
    lines.push(`- **Link:** [${c.id}](${jiraUrl(c.id)})`);
    lines.push(`- **Summary:** ${c.summary}`);
    lines.push(`- **Escalation Reason:** ${c.escalationReason}`);
    lines.push(
      `- **Duration:** ${c.durationDays} days (${fmtDate(c.createdAt)} → ${fmtDate(c.resolvedAt)})`,
    );
    lines.push(`- **Assignee:** ${c.assignee} | **Reporter:** ${c.reporter}`);
    lines.push(`- **Status Flow:** ${c.statusFlow}`);
    lines.push(
      `- **Preventable:** **${c.preventable ? "Yes" : "No"}** — ${c.preventableReason}`,
    );
    lines.push(`- **Solution Category:** ${c.solutionCategory}`);
    lines.push(`- **Non-TEE Engineering Involvement:** ${c.nonTeeInvolvement}`);
    lines.push(`- **Improvement Recommendations:** ${c.improvement}`);
    lines.push("");
  });

  // Preventable Summary
  const preventable = cards.filter((c) => c.preventable);
  if (preventable.length > 0) {
    lines.push("## Preventable Escalation Summary");
    lines.push("");
    lines.push(
      `**${preventable.length} of ${stats.total} escalations (${stats.preventableRate.toFixed(1)}%) were preventable:**`,
    );
    lines.push("");
    lines.push("| Card | Why Preventable |");
    lines.push("|------|-----------------|");
    for (const c of preventable) {
      lines.push(`| ${c.id} | ${c.preventableReason} |`);
    }
    lines.push("");
  }

  // Improvement Recommendations (only when curated improvements apply)
  if (includeImprovements) {
    lines.push("## Improvement Recommendations");
    lines.push("");
    report.improvements.forEach((item, idx) => {
      lines.push(`${idx + 1}. **${item.title}** — ${item.body}`);
    });
    lines.push("");
  }

  return lines.join("\n");
}

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function generateCSV(ctx: ExportContext): string {
  const headers = [
    "id",
    "title",
    "created_at",
    "resolved_at",
    "duration_days",
    "assignee",
    "reporter",
    "escalation_kind",
    "escalation_reason",
    "solution_category",
    "preventable",
    "preventable_reason",
    "status_flow",
    "non_tee_involvement",
    "improvement",
    "jira_url",
  ];
  const rows = ctx.cards.map((c) =>
    [
      c.id,
      c.title,
      c.createdAt,
      c.resolvedAt,
      String(c.durationDays),
      c.assignee,
      c.reporter,
      c.escalationKind,
      c.escalationReason,
      c.solutionCategory,
      c.preventable ? "yes" : "no",
      c.preventableReason,
      c.statusFlow,
      c.nonTeeInvolvement,
      c.improvement,
      jiraUrl(c.id),
    ]
      .map(escapeCsv)
      .join(","),
  );
  return [headers.join(","), ...rows].join("\n");
}

function generateJSON(ctx: ExportContext): string {
  const stats = computeStats(ctx);
  const payload = {
    timeframe: {
      label: ctx.timeframe.label,
      preset: ctx.timeframe.preset,
      start: ctx.timeframe.start,
      end: ctx.timeframe.end,
    },
    generatedAt: new Date().toISOString(),
    summary: {
      totalCardsCreatedInPeriod: ctx.includeDenominator
        ? ctx.report.totalCardsCreated
        : null,
      escalatedCount: stats.total,
      escalationRatePct: stats.escalationRate,
      avgResolutionDays: stats.avgDuration,
      preventableCount: stats.preventable,
      preventableRatePct: stats.preventableRate,
    },
    cards: ctx.cards.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      resolvedAt: c.resolvedAt,
      durationDays: c.durationDays,
      assignee: c.assignee,
      reporter: c.reporter,
      escalationKind: c.escalationKind,
      escalationReason: c.escalationReason,
      solutionCategory: c.solutionCategory,
      preventable: c.preventable,
      preventableReason: c.preventableReason,
      statusFlow: c.statusFlow,
      nonTeeInvolvement: c.nonTeeInvolvement,
      improvement: c.improvement,
      jiraUrl: jiraUrl(c.id),
    })),
    improvements: ctx.includeImprovements ? ctx.report.improvements : [],
  };
  return JSON.stringify(payload, null, 2);
}
