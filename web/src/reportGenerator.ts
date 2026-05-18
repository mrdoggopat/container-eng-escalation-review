import type { Credentials } from "./credentials";
import type {
  EscalationCard,
  ReportPeriod,
  SolutionCategory,
} from "./data";
import {
  buildEscalationJql,
  buildTotalCardsJql,
  type JqlConfig,
  type Timeframe,
} from "./timeframe";
import {
  anthropicMessages,
  extractText,
  jiraIssue,
  jiraSearch,
  type JiraIssue,
} from "./api";

const MAX_ESCALATED_CARDS = 60;

export type ProgressUpdate = {
  phase:
    | "querying-escalated"
    | "querying-total"
    | "fetching-changelogs"
    | "analyzing"
    | "assembling";
  message: string;
  current?: number;
  total?: number;
};

export type ReportGenerationResult = {
  report: ReportPeriod;
  warnings: string[];
};

function adfToPlainText(node: unknown): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(adfToPlainText).join("");
  if (typeof node === "object") {
    const obj = node as { type?: string; text?: string; content?: unknown };
    if (obj.text) return obj.text;
    if (obj.content) {
      const inner = adfToPlainText(obj.content);
      if (obj.type === "paragraph" || obj.type === "heading") return inner + "\n";
      return inner;
    }
  }
  return "";
}

function extractStatusFlow(issue: JiraIssue): string[] {
  const histories = issue.changelog?.histories ?? [];
  const transitions: string[] = [];
  for (const h of [...histories].sort((a, b) => a.created.localeCompare(b.created))) {
    for (const item of h.items) {
      if (item.field === "status" && item.toString) {
        if (transitions.length === 0 && item.fromString) {
          transitions.push(item.fromString);
        }
        transitions.push(item.toString);
      }
    }
  }
  if (transitions.length === 0) {
    const current =
      (issue.fields.status as { name?: string } | undefined)?.name ?? "Unknown";
    return [current];
  }
  return transitions;
}

function firstTerminalDate(issue: JiraIssue): string | null {
  const histories = issue.changelog?.histories ?? [];
  for (const h of [...histories].sort((a, b) => a.created.localeCompare(b.created))) {
    for (const item of h.items) {
      if (
        item.field === "status" &&
        item.toString &&
        /^(done|archive)$/i.test(item.toString.trim())
      ) {
        return h.created.slice(0, 10);
      }
    }
  }
  const resolved = issue.fields.resolutiondate as string | undefined;
  if (resolved) return resolved.slice(0, 10);
  return null;
}

function classifyEscalationKind(
  statusFlow: string[],
  escalationColumns: string[],
): string {
  const touched = escalationColumns.filter((col) => statusFlow.includes(col));
  if (touched.length === 0) return escalationColumns[0] ?? "Unknown";
  return touched.join(" + ");
}

/**
 * Look up issue custom-field values whose display names match any of the
 * configured patterns (case-insensitive, substring match). Returns an array
 * of `{ name, text }` for each matching non-empty field.
 */
function extractNamedFieldContents(
  issue: JiraIssue,
  patterns: string[],
): { name: string; text: string }[] {
  if (patterns.length === 0) return [];
  const names = issue.names ?? {};
  const lowerPatterns = patterns.map((p) => p.toLowerCase());
  const out: { name: string; text: string }[] = [];
  for (const [fieldId, displayName] of Object.entries(names)) {
    if (typeof displayName !== "string") continue;
    const lower = displayName.toLowerCase();
    if (!lowerPatterns.some((p) => lower.includes(p))) continue;
    const value = (issue.fields as Record<string, unknown>)[fieldId];
    const text = adfToPlainText(value).trim();
    if (!text) continue;
    out.push({ name: displayName, text });
  }
  return out;
}

function commentersOutsideTeamAndReporter(
  issue: JiraIssue,
  teamMembers: Set<string>,
): { name: string; text: string }[] {
  const comments =
    ((issue.fields.comment as { comments?: Array<unknown> } | undefined)?.comments as
      | Array<{ author?: { displayName?: string }; body?: unknown }>
      | undefined) ?? [];
  const reporter =
    (issue.fields.reporter as { displayName?: string } | undefined)?.displayName ?? "";
  const out: { name: string; text: string }[] = [];
  for (const c of comments) {
    const name = c.author?.displayName ?? "Unknown";
    if (teamMembers.has(name)) continue;
    if (name === reporter) continue;
    const text = adfToPlainText(c.body).trim();
    if (!text) continue;
    out.push({ name, text });
  }
  return out;
}

function daysBetween(a: string, b: string): number {
  const aDate = new Date(`${a}T00:00:00Z`).getTime();
  const bDate = new Date(`${b}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((bDate - aDate) / 86_400_000));
}

function buildAnalysisSystemPrompt(
  teamMembers: string[],
  teamContextUrls: string[],
): string {
  const teamList =
    teamMembers.length === 0
      ? "(no internal team members configured)"
      : teamMembers.map((m) => `- ${m}`).join("\n");
  const teamContextBlock =
    teamContextUrls.length === 0
      ? ""
      : `

BROADER TEAM CONTEXT:
When deciding whether a commenter is truly "external" to the team for the preventability rule, also consider that members of the following team spaces are part of the broader team (not external — even if they aren't on the strict internal roster above):
${teamContextUrls.map((u) => `- ${u}`).join("\n")}
You cannot fetch these URLs, but if a commenter is plausibly a teammate (engineer on the same product area, etc.), prefer treating them as broader-team rather than external.`;

  return `You analyze a Jira escalation card and produce structured metadata for an internal escalation review.

The internal escalation team consists ONLY of these people:
${teamList}${teamContextBlock}

CARD SUMMARY GUIDANCE:
When summarizing the card, draw from the Summary field, the description, and any "Pre-Investigation Notes" / "Investigation Notes" content if provided. Prefer factual statements grounded in those notes over speculation.

PREVENTABILITY RULE (apply strictly):
A card is "preventable" if someone who is NOT on the internal escalation team AND NOT the card's Reporter provided a suggestion, solution, fix, or PR in the comments — AND that contribution was the key to resolution.
If no such external contribution exists, the card is NOT preventable.

SOLUTION CATEGORY — pick exactly one:
- "PR fix" — resolved by an engineering code change / PR.
- "Customer environment specific issue" — resolved by a config/infra change in the customer's environment.
- "Suggestion without PR or code fixes" — resolved by guidance / documentation pointer with no code change.
- "Other" — none of the above clearly applies (e.g. abandoned, duplicate, product-decision pending).

OUTPUT: respond with ONLY a single valid JSON object — no prose, no markdown fences. Schema:
{
  "title": string,              // short card title (under 100 chars)
  "summary": string,            // 1-2 sentence factual summary
  "escalationReason": string,   // 1 sentence: why was it escalated?
  "preventable": boolean,
  "preventableReason": string,  // 1-2 sentences justifying the preventable flag against the rule above
  "solutionCategory": "PR fix" | "Customer environment specific issue" | "Suggestion without PR or code fixes" | "Other",
  "nonTeeInvolvement": string,  // who outside the internal team engaged and what they did, or "None."
  "improvement": string         // one concrete improvement recommendation
}`;
}

async function analyzeCard(
  creds: Credentials,
  issue: JiraIssue,
  statusFlow: string[],
): Promise<{
  title: string;
  summary: string;
  escalationReason: string;
  preventable: boolean;
  preventableReason: string;
  solutionCategory: SolutionCategory;
  nonTeeInvolvement: string;
  improvement: string;
}> {
  const fields = issue.fields as Record<string, unknown>;
  const summary = (fields.summary as string | undefined) ?? issue.key;
  const description = adfToPlainText(fields.description);
  const reporter =
    (fields.reporter as { displayName?: string } | undefined)?.displayName ?? "—";
  const assignee =
    (fields.assignee as { displayName?: string } | undefined)?.displayName ?? "—";
  const teamSet = new Set(creds.teeMembers);
  const externalComments = commentersOutsideTeamAndReporter(issue, teamSet);
  const investigationNotes = extractNamedFieldContents(
    issue,
    creds.investigationFieldNames,
  );

  const userMessage = [
    `Card key: ${issue.key}`,
    `Title: ${summary}`,
    `Reporter: ${reporter}`,
    `Assignee: ${assignee}`,
    `Status flow: ${statusFlow.join(" -> ")}`,
    "",
    "Description:",
    description.slice(0, 4000) || "(empty)",
    "",
    investigationNotes.length === 0
      ? "Investigation notes: (no matching fields)"
      : [
          "Investigation notes (from configured Jira fields):",
          ...investigationNotes.map(
            (n) => `--- ${n.name} ---\n${n.text.slice(0, 2500)}`,
          ),
        ].join("\n"),
    "",
    "Comments from participants outside the internal team and not the Reporter:",
    externalComments.length === 0
      ? "(none)"
      : externalComments
          .slice(0, 30)
          .map((c, i) => `--- comment ${i + 1} by ${c.name} ---\n${c.text.slice(0, 1500)}`)
          .join("\n\n"),
  ].join("\n");

  const resp = await anthropicMessages(creds, {
    system: buildAnalysisSystemPrompt(creds.teeMembers, creds.teamContextUrls),
    messages: [{ role: "user", content: userMessage }],
    max_tokens: 1200,
  });

  const text = extractText(resp).trim();
  const json = parseJsonObject(text);
  return {
    title: String(json.title ?? summary).slice(0, 200),
    summary: String(json.summary ?? "—"),
    escalationReason: String(json.escalationReason ?? "—"),
    preventable: Boolean(json.preventable),
    preventableReason: String(json.preventableReason ?? ""),
    solutionCategory: normalizeSolutionCategory(json.solutionCategory),
    nonTeeInvolvement: String(json.nonTeeInvolvement ?? "None."),
    improvement: String(json.improvement ?? ""),
  };
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(trimmed.slice(first, last + 1)) as Record<string, unknown>;
      } catch {
        // fall through
      }
    }
    return {};
  }
}

function normalizeSolutionCategory(value: unknown): SolutionCategory {
  if (
    value === "PR fix" ||
    value === "Customer environment specific issue" ||
    value === "Suggestion without PR or code fixes" ||
    value === "Other"
  ) {
    return value;
  }
  return "Other";
}

export async function generateReport(
  creds: Credentials,
  timeframe: Timeframe,
  onProgress: (update: ProgressUpdate) => void,
): Promise<ReportGenerationResult> {
  const warnings: string[] = [];
  const jqlConfig: JqlConfig = {
    projectKey: creds.projectKey,
    escalationColumns: creds.escalationColumns,
  };

  // 1. Page through the escalated-cards JQL.
  onProgress({ phase: "querying-escalated", message: "Running escalation JQL…" });
  const escalatedKeys: string[] = [];
  let nextPageToken: string | undefined;
  do {
    const page = await jiraSearch(creds, {
      jql: buildEscalationJql(timeframe, jqlConfig),
      fields: ["summary", "status", "created", "resolutiondate"],
      maxResults: 100,
      nextPageToken,
    });
    for (const issue of page.issues) {
      escalatedKeys.push(issue.key);
      if (escalatedKeys.length >= MAX_ESCALATED_CARDS) break;
    }
    nextPageToken = page.isLast ? undefined : page.nextPageToken;
    if (escalatedKeys.length >= MAX_ESCALATED_CARDS) {
      warnings.push(
        `Capped at ${MAX_ESCALATED_CARDS} escalated cards — increase MAX_ESCALATED_CARDS to fetch more.`,
      );
      break;
    }
  } while (nextPageToken);

  // 2. Total cards created in period (for escalation-rate denominator).
  onProgress({
    phase: "querying-total",
    message: `Counting total ${creds.projectKey} cards…`,
  });
  let totalCardsCreated = escalatedKeys.length;
  try {
    const totalQuery = await jiraSearch(creds, {
      jql: buildTotalCardsJql(timeframe, jqlConfig),
      fields: ["created"],
      maxResults: 1,
    });
    if (typeof totalQuery.total === "number") {
      totalCardsCreated = totalQuery.total;
    } else {
      let count = 0;
      let token: string | undefined;
      do {
        const page = await jiraSearch(creds, {
          jql: buildTotalCardsJql(timeframe, jqlConfig),
          fields: ["created"],
          maxResults: 100,
          nextPageToken: token,
        });
        count += page.issues.length;
        token = page.isLast ? undefined : page.nextPageToken;
      } while (token);
      totalCardsCreated = count;
    }
  } catch (err) {
    warnings.push(
      `Could not count total ${creds.projectKey} cards (${err instanceof Error ? err.message : String(err)}); escalation rate will be approximate.`,
    );
  }

  // 3. Fetch each escalated card with its changelog + comments.
  onProgress({
    phase: "fetching-changelogs",
    message: "Fetching card details…",
    current: 0,
    total: escalatedKeys.length,
  });
  const issues: JiraIssue[] = [];
  for (let i = 0; i < escalatedKeys.length; i++) {
    const key = escalatedKeys[i];
    onProgress({
      phase: "fetching-changelogs",
      message: `Fetching ${key}…`,
      current: i,
      total: escalatedKeys.length,
    });
    // Request all fields so we can pick up custom fields like "Pre-Investigation
    // Notes" / "Investigation Notes". `expand=names` returns a fieldId → display
    // name map so we can locate them without hardcoding custom field IDs.
    const issue = await jiraIssue(creds, key, {
      fields: ["*all"],
      expand: "changelog,names",
    });
    issues.push(issue);
  }

  // 4. Analyze each via Claude.
  onProgress({
    phase: "analyzing",
    message: "Analyzing cards with Claude…",
    current: 0,
    total: issues.length,
  });
  const cards: EscalationCard[] = [];
  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    onProgress({
      phase: "analyzing",
      message: `Analyzing ${issue.key}…`,
      current: i,
      total: issues.length,
    });
    const statusFlow = extractStatusFlow(issue);
    const createdAt = (issue.fields.created as string | undefined)?.slice(0, 10) ?? "";
    const resolvedAt = firstTerminalDate(issue) ?? createdAt;
    let analysis: Awaited<ReturnType<typeof analyzeCard>>;
    try {
      analysis = await analyzeCard(creds, issue, statusFlow);
    } catch (err) {
      warnings.push(
        `Analysis failed for ${issue.key} (${err instanceof Error ? err.message : String(err)}); using minimal fallback.`,
      );
      analysis = {
        title: (issue.fields.summary as string | undefined) ?? issue.key,
        summary:
          (issue.fields.summary as string | undefined) ?? "Analysis unavailable.",
        escalationReason: "Analysis unavailable.",
        preventable: false,
        preventableReason: "Could not be analyzed automatically.",
        solutionCategory: "Other",
        nonTeeInvolvement: "Analysis unavailable.",
        improvement: "—",
      };
    }
    cards.push({
      id: issue.key,
      title: analysis.title,
      summary: analysis.summary,
      escalationReason: analysis.escalationReason,
      createdAt,
      resolvedAt,
      durationDays: daysBetween(createdAt, resolvedAt),
      assignee:
        (issue.fields.assignee as { displayName?: string } | undefined)?.displayName ??
        "—",
      reporter:
        (issue.fields.reporter as { displayName?: string } | undefined)?.displayName ??
        "—",
      statusFlow: statusFlow.join(" → "),
      preventable: analysis.preventable,
      preventableReason: analysis.preventableReason,
      solutionCategory: analysis.solutionCategory,
      escalationKind: classifyEscalationKind(statusFlow, creds.escalationColumns),
      nonTeeInvolvement: analysis.nonTeeInvolvement,
      improvement: analysis.improvement,
    });
  }

  onProgress({ phase: "assembling", message: "Assembling report…" });

  const report: ReportPeriod = {
    label: timeframe.label,
    rangeStart: timeframe.start,
    rangeEnd: timeframe.end,
    totalCardsCreated,
    cards,
    improvements: [],
  };

  return { report, warnings };
}
