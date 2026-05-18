import type { Credentials } from "./credentials";
import type { EscalationCard, ReportPeriod, SolutionCategory } from "./data";
import type { Timeframe } from "./timeframe";
import { anthropicMessages, extractText } from "./api";

/**
 * A single period the user has added to the comparison (either imported from
 * a file or freshly generated from Jira).
 */
export type CompareEntry = {
  origin: "imported" | "live";
  filename?: string;
  timeframe: Timeframe;
  report: ReportPeriod;
};

export type PeriodStats = {
  label: string;
  rangeStart: string;
  rangeEnd: string;
  totalEscalated: number;
  totalCardsCreated: number;
  escalationRatePct: number | null;
  preventableCount: number;
  preventableRatePct: number;
  avgDurationDays: number;
  solutionCategoryCounts: Record<SolutionCategory, number>;
};

export type ClaudeComparison = {
  overview: string;
  metricChanges: { metric: string; interpretation: string }[];
  patternShifts: { title: string; description: string }[];
  improvementsMade: string[];
  newGaps: string[];
  recommendations: string[];
};

export type ComparisonResult = {
  entries: CompareEntry[];
  stats: PeriodStats[];
  analysis: ClaudeComparison | null;
  analysisError: string | null;
};

const SOLUTION_CATEGORIES: SolutionCategory[] = [
  "PR fix",
  "Customer environment specific issue",
  "Suggestion without PR or code fixes",
  "Other",
];

export function computePeriodStats(entry: CompareEntry): PeriodStats {
  const { report, timeframe } = entry;
  // Imported / live entries: report.cards is already the period set.
  const cards = report.cards;
  const total = cards.length;
  const preventable = cards.filter((c) => c.preventable).length;
  const avg =
    total === 0
      ? 0
      : Math.round(
          (cards.reduce((sum, c) => sum + c.durationDays, 0) / total) * 10,
        ) / 10;
  const escalationRate =
    report.totalCardsCreated > 0 ? (total / report.totalCardsCreated) * 100 : null;
  const solutionCategoryCounts = Object.fromEntries(
    SOLUTION_CATEGORIES.map((cat) => [
      cat,
      cards.filter((c) => c.solutionCategory === cat).length,
    ]),
  ) as Record<SolutionCategory, number>;
  return {
    label: timeframe.label,
    rangeStart: timeframe.start,
    rangeEnd: timeframe.end,
    totalEscalated: total,
    totalCardsCreated: report.totalCardsCreated,
    escalationRatePct: escalationRate,
    preventableCount: preventable,
    preventableRatePct: total === 0 ? 0 : (preventable / total) * 100,
    avgDurationDays: avg,
    solutionCategoryCounts,
  };
}

const SYSTEM_PROMPT = `You compare engineering escalation reports across multiple non-overlapping time periods and produce structured insights about how things changed over time.

For each period you receive:
- A label and date range.
- Summary statistics (cards escalated, escalation rate, preventable rate, avg duration, solution-category mix).
- A condensed list of cards with their escalation reason, preventability, solution category, and improvement note.

Compare the periods and return a single JSON object — no prose, no markdown fences, no surrounding text. Schema:
{
  "overview": string,                                       // 2-3 sentence summary of how the periods differ
  "metricChanges": [                                        // 3-6 entries on key metric movements
    { "metric": string, "interpretation": string }
  ],
  "patternShifts": [                                        // 2-5 entries on recurring escalation themes that appeared / disappeared / grew
    { "title": string, "description": string }
  ],
  "improvementsMade": [string],                             // things that visibly improved between periods (or [] if none)
  "newGaps": [string],                                      // new problem areas that appeared in later periods
  "recommendations": [string]                               // 2-5 concrete next steps
}
Be specific. Quote card ids when they illustrate a pattern. If only two periods are supplied, frame the analysis as "Period A → Period B". Order recommendations from highest-leverage to lowest.`;

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

function formatCardForPrompt(card: EscalationCard): string {
  const flag = card.preventable ? "PREVENTABLE" : "not preventable";
  const reason = clip(card.escalationReason || "—", 220);
  const improvement = clip(card.improvement || "—", 180);
  return `  - ${card.id} [${card.solutionCategory}, ${flag}, ${card.durationDays}d]: ${reason} :: improvement="${improvement}"`;
}

function formatPeriodForPrompt(entry: CompareEntry, stats: PeriodStats): string {
  const lines: string[] = [];
  lines.push(`Period: ${stats.label} (${stats.rangeStart} → ${stats.rangeEnd})`);
  lines.push(`Origin: ${entry.origin === "imported" ? "imported file" : "live from Jira"}`);
  if (stats.totalCardsCreated > 0) {
    lines.push(`Total cards created in period: ${stats.totalCardsCreated}`);
  }
  lines.push(
    `Escalated: ${stats.totalEscalated}${
      stats.escalationRatePct !== null
        ? ` (${stats.escalationRatePct.toFixed(1)}% escalation rate)`
        : ""
    }`,
  );
  lines.push(
    `Preventable: ${stats.preventableCount} / ${stats.totalEscalated} (${stats.preventableRatePct.toFixed(1)}%)`,
  );
  lines.push(`Average resolution time: ${stats.avgDurationDays} days`);
  lines.push(
    `Solution category mix: ` +
      SOLUTION_CATEGORIES.map(
        (c) => `${c}=${stats.solutionCategoryCounts[c]}`,
      ).join(", "),
  );
  lines.push("Cards:");
  for (const card of entry.report.cards) {
    lines.push(formatCardForPrompt(card));
  }
  return lines.join("\n");
}

function parseClaudeJson(text: string): ClaudeComparison {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      raw = JSON.parse(trimmed.slice(first, last + 1));
    } else {
      throw new Error("Claude response was not valid JSON.");
    }
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("Claude response was not a JSON object.");
  }
  const obj = raw as Record<string, unknown>;
  return {
    overview: String(obj.overview ?? ""),
    metricChanges: Array.isArray(obj.metricChanges)
      ? (obj.metricChanges as Array<Record<string, unknown>>).map((m) => ({
          metric: String(m.metric ?? ""),
          interpretation: String(m.interpretation ?? ""),
        }))
      : [],
    patternShifts: Array.isArray(obj.patternShifts)
      ? (obj.patternShifts as Array<Record<string, unknown>>).map((p) => ({
          title: String(p.title ?? ""),
          description: String(p.description ?? ""),
        }))
      : [],
    improvementsMade: Array.isArray(obj.improvementsMade)
      ? (obj.improvementsMade as unknown[]).map((s) => String(s))
      : [],
    newGaps: Array.isArray(obj.newGaps)
      ? (obj.newGaps as unknown[]).map((s) => String(s))
      : [],
    recommendations: Array.isArray(obj.recommendations)
      ? (obj.recommendations as unknown[]).map((s) => String(s))
      : [],
  };
}

export async function runComparison(
  creds: Credentials,
  entries: CompareEntry[],
  onProgress: (message: string) => void,
): Promise<ComparisonResult> {
  const stats = entries.map((e) => computePeriodStats(e));

  // Sort entries chronologically for the prompt so Claude sees them in order.
  const ordered = entries
    .map((entry, i) => ({ entry, stats: stats[i] }))
    .sort((a, b) => a.entry.timeframe.start.localeCompare(b.entry.timeframe.start));

  onProgress("Assembling comparison prompt…");
  const userMessage = [
    `You are comparing ${ordered.length} non-overlapping period(s).`,
    "",
    ...ordered.map(({ entry, stats: s }) => formatPeriodForPrompt(entry, s)),
    "",
    "Return ONLY the JSON object as specified.",
  ].join("\n\n");

  let analysis: ClaudeComparison | null = null;
  let analysisError: string | null = null;
  try {
    onProgress("Asking Claude to compare the periods…");
    const resp = await anthropicMessages(creds, {
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      max_tokens: 1800,
    });
    onProgress("Parsing comparison…");
    analysis = parseClaudeJson(extractText(resp));
  } catch (err) {
    analysisError = err instanceof Error ? err.message : String(err);
  }

  return {
    entries: ordered.map((o) => o.entry),
    stats: ordered.map((o) => o.stats),
    analysis,
    analysisError,
  };
}
