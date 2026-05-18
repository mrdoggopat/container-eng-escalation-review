import type { EscalationCard, ReportPeriod } from "./data";
import { fmtDate, type Timeframe } from "./timeframe";

export type ConfluenceRenderContext = {
  timeframe: Timeframe;
  cards: EscalationCard[];
  report: ReportPeriod;
  includeDenominator: boolean;
  includeImprovements: boolean;
  projectKey: string;
  jiraDomain: string;
};

const ENTITY_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ENTITY_MAP[c]);
}

function jiraUrl(domain: string, key: string): string {
  return `https://${domain}/browse/${encodeURIComponent(key)}`;
}

/**
 * Card-id "smart link" — Confluence's renderer detects Jira issue URLs and
 * renders them as inline card chips when the link sits on its own.
 */
function jiraLink(domain: string, key: string): string {
  const href = jiraUrl(domain, key);
  return `<a href="${escapeXml(href)}">${escapeXml(key)}</a>`;
}

function metaPanel(rows: Array<[string, string]>): string {
  const cells = rows
    .map(
      ([label, value]) =>
        `<tr><th>${escapeXml(label)}</th><td>${value}</td></tr>`,
    )
    .join("");
  return `<table><tbody>${cells}</tbody></table>`;
}

function paragraph(text: string): string {
  return `<p>${escapeXml(text)}</p>`;
}

function infoPanel(title: string, bodyHtml: string): string {
  return (
    `<ac:structured-macro ac:name="info">` +
    `<ac:parameter ac:name="title">${escapeXml(title)}</ac:parameter>` +
    `<ac:rich-text-body>${bodyHtml}</ac:rich-text-body>` +
    `</ac:structured-macro>`
  );
}

function warningPanel(title: string, bodyHtml: string): string {
  return (
    `<ac:structured-macro ac:name="warning">` +
    `<ac:parameter ac:name="title">${escapeXml(title)}</ac:parameter>` +
    `<ac:rich-text-body>${bodyHtml}</ac:rich-text-body>` +
    `</ac:structured-macro>`
  );
}

function statusLozenge(text: string, color: string): string {
  return (
    `<ac:structured-macro ac:name="status">` +
    `<ac:parameter ac:name="colour">${escapeXml(color)}</ac:parameter>` +
    `<ac:parameter ac:name="title">${escapeXml(text)}</ac:parameter>` +
    `</ac:structured-macro>`
  );
}

function computeStats(ctx: ConfluenceRenderContext) {
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

export function renderStorageBody(ctx: ConfluenceRenderContext): string {
  const { timeframe, cards, report, includeDenominator, includeImprovements } = ctx;
  const stats = computeStats(ctx);
  const out: string[] = [];

  // ---- Intro panel
  out.push(
    infoPanel(
      `${ctx.projectKey} Escalation Review · ${timeframe.label}`,
      `<p><strong>Range:</strong> ${escapeXml(fmtDate(timeframe.start))} – ${escapeXml(fmtDate(timeframe.end))}<br/>` +
        `<strong>Generated:</strong> ${escapeXml(fmtDate(new Date().toISOString().slice(0, 10)))}</p>`,
    ),
  );

  // ---- Executive summary
  out.push(`<h2>Executive summary</h2>`);
  const summaryRows: Array<[string, string]> = [];
  if (includeDenominator) {
    summaryRows.push([
      `Total ${ctx.projectKey} cards created in period`,
      escapeXml(String(report.totalCardsCreated)),
    ]);
    summaryRows.push([
      "Cards escalated beyond the internal team",
      escapeXml(
        `${stats.total}${stats.escalationRate !== null ? ` (${stats.escalationRate.toFixed(1)}%)` : ""}`,
      ),
    ]);
    summaryRows.push([
      "Cards never escalated",
      escapeXml(String(Math.max(0, report.totalCardsCreated - stats.total))),
    ]);
  } else {
    summaryRows.push([
      "Cards escalated in window",
      escapeXml(String(stats.total)),
    ]);
  }
  summaryRows.push([
    "Avg resolution time (escalated)",
    escapeXml(`${stats.avgDuration} days`),
  ]);
  summaryRows.push([
    "Preventable escalation rate",
    `${stats.preventable} of ${stats.total} ` +
      statusLozenge(`${stats.preventableRate.toFixed(1)}%`, "Yellow"),
  ]);
  out.push(metaPanel(summaryRows));

  if (stats.total === 0) {
    out.push(paragraph(`No escalated cards in this window.`));
    return out.join("");
  }

  // ---- Escalation rate table
  out.push(`<h2>Escalation rate analysis</h2>`);
  out.push(
    `<table><thead><tr><th>Card</th><th>Escalation column</th><th>Duration</th></tr></thead><tbody>` +
      cards
        .map(
          (c) =>
            `<tr><td>${jiraLink(ctx.jiraDomain, c.id)}</td>` +
            `<td>${escapeXml(c.escalationKind)}</td>` +
            `<td>${escapeXml(`${c.durationDays} days`)}</td></tr>`,
        )
        .join("") +
      `</tbody></table>`,
  );

  // ---- Detailed card analysis
  out.push(`<h2>Detailed card analysis</h2>`);
  cards.forEach((c, idx) => {
    out.push(
      `<h3>${idx + 1}. ${jiraLink(ctx.jiraDomain, c.id)} — ${escapeXml(c.title)}</h3>`,
    );
    const flag = c.preventable
      ? statusLozenge("Preventable", "Yellow")
      : statusLozenge("Not preventable", "Grey");
    out.push(
      metaPanel([
        ["Card", jiraLink(ctx.jiraDomain, c.id)],
        ["Created", escapeXml(fmtDate(c.createdAt))],
        ["Resolved", escapeXml(fmtDate(c.resolvedAt))],
        ["Duration", escapeXml(`${c.durationDays} days`)],
        ["Assignee", escapeXml(c.assignee)],
        ["Reporter", escapeXml(c.reporter)],
        ["Escalation column", escapeXml(c.escalationKind)],
        ["Solution category", escapeXml(c.solutionCategory)],
        ["Preventable", flag],
      ]),
    );
    out.push(`<p><strong>Summary.</strong> ${escapeXml(c.summary)}</p>`);
    out.push(
      `<p><strong>Escalation reason.</strong> ${escapeXml(c.escalationReason)}</p>`,
    );
    out.push(
      `<p><strong>Status flow.</strong> ${escapeXml(c.statusFlow)}</p>`,
    );
    out.push(
      `<p><strong>${c.preventable ? "Why preventable" : "Why not preventable"}.</strong> ${escapeXml(c.preventableReason)}</p>`,
    );
    out.push(
      `<p><strong>External engineering involvement.</strong> ${escapeXml(c.nonTeeInvolvement)}</p>`,
    );
    out.push(
      `<p><strong>Improvement recommendation.</strong> ${escapeXml(c.improvement)}</p>`,
    );
  });

  // ---- Preventable summary
  const preventable = cards.filter((c) => c.preventable);
  if (preventable.length > 0) {
    out.push(`<h2>Preventable escalations</h2>`);
    out.push(
      warningPanel(
        `${preventable.length} of ${stats.total} (${stats.preventableRate.toFixed(1)}%) were preventable`,
        `<p>These are cases where the escalation produced engineering input from outside the internal team that the team could have provided directly — via Slack, runbook, or an existing investigation.</p>`,
      ),
    );
    out.push(
      `<table><thead><tr><th>Card</th><th>Why preventable</th></tr></thead><tbody>` +
        preventable
          .map(
            (c) =>
              `<tr><td>${jiraLink(ctx.jiraDomain, c.id)}</td>` +
              `<td>${escapeXml(c.preventableReason)}</td></tr>`,
          )
          .join("") +
        `</tbody></table>`,
    );
  }

  // ---- Improvement recommendations
  if (includeImprovements && report.improvements.length > 0) {
    out.push(`<h2>Improvement recommendations</h2>`);
    out.push(
      `<ol>` +
        report.improvements
          .map(
            (it) =>
              `<li><strong>${escapeXml(it.title)}.</strong> ${escapeXml(it.body)}</li>`,
          )
          .join("") +
        `</ol>`,
    );
  }

  return out.join("");
}
