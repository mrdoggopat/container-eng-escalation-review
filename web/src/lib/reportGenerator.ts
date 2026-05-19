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
  GenerationCancelledError,
  jiraIssue,
  jiraSearch,
  type JiraIssue,
} from "./api";

// Re-export so consumers can `import { GenerationCancelledError } from "./reportGenerator"`
// without reaching into api.ts. Keeps the public surface consolidated.
export { GenerationCancelledError } from "./api";

const MAX_ESCALATED_CARDS = 60;

export type ProgressUpdate = {
  phase:
    | "querying-escalated"
    | "querying-total"
    | "fetching-changelogs"
    | "analyzing"
    | "assembling";
  message: string;
  /** Optional secondary line — e.g. a card title or sub-task descriptor. */
  detail?: string;
  current?: number;
  total?: number;
  /**
   * Emitted once a card finishes analyzing. The view component uses this to
   * append a chip with the classification result to its live timeline.
   */
  cardResult?: {
    key: string;
    title: string;
    preventable: boolean;
    solutionCategory: SolutionCategory;
  };
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

// ---------------------------------------------------------------------------
// Jira field accessors
// ---------------------------------------------------------------------------
// Jira's REST response is loosely typed (`fields: Record<string, unknown>`),
// so we narrow the common shapes in one place rather than repeating the casts
// at every callsite.

/** `fields[key].displayName` (e.g. `reporter`, `assignee`) or a fallback. */
function getDisplayName(
  fields: Record<string, unknown>,
  key: string,
  fallback = "—",
): string {
  const value = fields[key] as { displayName?: string } | undefined;
  return value?.displayName ?? fallback;
}

/** The card's summary string, or the issue key if no summary is present. */
function getIssueSummary(issue: JiraIssue): string {
  return (issue.fields.summary as string | undefined) ?? issue.key;
}

type ChangelogHistory = NonNullable<JiraIssue["changelog"]>["histories"][number];

/** Returns the issue's changelog histories sorted chronologically (oldest first). */
function sortedHistories(issue: JiraIssue): ChangelogHistory[] {
  const histories = issue.changelog?.histories ?? [];
  return [...histories].sort((a, b) => a.created.localeCompare(b.created));
}

function extractStatusFlow(issue: JiraIssue): string[] {
  const transitions: string[] = [];
  for (const h of sortedHistories(issue)) {
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
  for (const h of sortedHistories(issue)) {
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
    const value = issue.fields[fieldId];
    const text = adfToPlainText(value).trim();
    if (!text) continue;
    out.push({ name: displayName, text });
  }
  return out;
}

type ExternalComment = { name: string; text: string };

function commentersOutsideTeamAndReporter(
  issue: JiraIssue,
  teamMembers: Set<string>,
): ExternalComment[] {
  const comments =
    ((issue.fields.comment as { comments?: Array<unknown> } | undefined)?.comments as
      | Array<{ author?: { displayName?: string }; body?: unknown }>
      | undefined) ?? [];
  const reporter = getDisplayName(issue.fields, "reporter", "");
  const out: ExternalComment[] = [];
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

/**
 * Format a list of external comments as a prompt-ready block. Caps the number
 * of comments at 30 and the text per comment at 1500 chars to keep prompts
 * within a predictable token budget.
 */
function renderExternalComments(comments: ExternalComment[]): string {
  if (comments.length === 0) return "(none)";
  return comments
    .slice(0, 30)
    .map(
      (c, i) => `--- comment ${i + 1} by ${c.name} ---\n${c.text.slice(0, 1500)}`,
    )
    .join("\n\n");
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

PREVENTABILITY RULE (apply strictly — ALL THREE must be true):
A card is "preventable" if and only if ALL of the following hold:
  (1) EXTERNAL CONTRIBUTION — someone who is NOT on the internal escalation team AND NOT the card's Reporter provided a suggestion, solution, fix, or pointer in the comments that became the key to resolution.
  (2) INTERNALLY DISCOVERABLE — the resolution involved information the TEE could plausibly have found themselves, meaning ANY of:
       - it was already documented in Confluence, internal runbooks, or product docs;
       - a prior Jira card already covered the same root cause / behavior;
       - it represented a lapse in judgment by the TEE (standard escalation step skipped, wrong team consulted, ignored signal);
       - it was something the TEE may have forgotten or overlooked (a configuration option, a known limitation, a recent release note, a default behavior change).
  (3) NOT A PR FIX — the resolution did not require new engineering code to land (see hard override below).

If ANY of (1)(2)(3) is false, the card is NOT preventable.

Common NOT-preventable patterns (be strict — do not mark these preventable):
- An external commenter pointed to specialized knowledge that wasn't internally documented anywhere (e.g. a third-party vendor quirk, customer's idiosyncratic environment detail, deep kernel/OS behavior only that person knew).
- Resolution required novel engineering investigation / debugging that didn't exist as written knowledge yet.
- The "external" person was the only realistic source of the missing context, and there was no reasonable internal path for the TEE to obtain it.
- Customer-only context: the answer was in the customer's logs / config / setup, which the TEE could only get by asking.

Common preventable patterns (the signal we want):
- The answer was in Confluence the whole time and the TEE didn't search there.
- A prior Jira card already documented the same root cause and the TEE missed it.
- A standard runbook step was skipped.
- A peer engineer pointed out a configuration flag or known limitation that IS documented in our own docs.
- The team failed to check release notes / changelog when a customer reported a regression.

In the preventableReason, when marking preventable, name the specific internal resource (Confluence page, prior CONS card, runbook) or process step that would have caught it. If you cannot name one, the card is probably NOT preventable.

HARD OVERRIDE — PR fixes are NEVER preventable:
If the solutionCategory is "PR fix" (i.e. resolution required an engineering code change / PR landing in our codebase), preventable MUST be false regardless of any external comments. The premise is that a code bug had to be patched, so the escalation could not have been avoided by the team in advance; the engineering work was the resolution. In the preventableReason, explain that the fix required a code change so it is not classified as preventable by team-side action.

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
  signal?: AbortSignal,
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
  const fields = issue.fields;
  const summary = getIssueSummary(issue);
  const description = adfToPlainText(fields.description);
  const reporter = getDisplayName(fields, "reporter");
  const assignee = getDisplayName(fields, "assignee");
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
    renderExternalComments(externalComments),
  ].join("\n");

  const resp = await anthropicMessages(
    creds,
    {
      system: buildAnalysisSystemPrompt(creds.teeMembers, creds.teamContextUrls),
      messages: [{ role: "user", content: userMessage }],
      max_tokens: 1200,
    },
    signal,
  );

  const text = extractText(resp).trim();
  const json = parseJsonObject(text);
  const solutionCategory = normalizeSolutionCategory(json.solutionCategory);
  let preventable = Boolean(json.preventable);
  let preventableReason = String(json.preventableReason ?? "");
  // Hard override: PR fixes are never preventable. The premise is that a code
  // bug had to be patched, so the escalation could not have been avoided by
  // team-side action in advance. Mirrors the rule in the system prompt — this
  // post-hoc guard ensures it's enforced even if the model slips up.
  if (solutionCategory === "PR fix" && preventable) {
    preventable = false;
    preventableReason =
      "Solution category is PR fix — a code change was required, so this escalation is not classified as preventable by team-side action. " +
      (preventableReason
        ? `(Model's original reasoning, retained for context: ${preventableReason})`
        : "");
  }
  return {
    title: String(json.title ?? summary).slice(0, 200),
    summary: String(json.summary ?? "—"),
    escalationReason: String(json.escalationReason ?? "—"),
    preventable,
    preventableReason,
    solutionCategory,
    nonTeeInvolvement: String(json.nonTeeInvolvement ?? "None."),
    improvement: String(json.improvement ?? ""),
  };
}

/**
 * Asymmetric verification pass. The first-pass `analyzeCard` already enforces
 * the preventability rule, but it's possible to mark a card "not preventable"
 * even when an external commenter contributed a suggestion that was actually
 * the key to resolution. This second pass re-reads the external comments with
 * the model's first-pass reasoning in hand and gives it a chance to flip.
 *
 * Only triggered for cards that are (a) not a PR fix, (b) initially marked
 * not preventable, and (c) actually have external comments — so the cost is
 * bounded to the subset most likely to be misclassified false-negatives.
 *
 * Only `preventable` + `preventableReason` are updated; the solution category,
 * summary, and other fields are kept as-is.
 */
async function recheckPreventability(
  creds: Credentials,
  issue: JiraIssue,
  firstPass: {
    preventable: boolean;
    preventableReason: string;
    solutionCategory: SolutionCategory;
  },
  externalComments: ExternalComment[],
  signal?: AbortSignal,
): Promise<{
  preventable: boolean;
  preventableReason: string;
  changed: boolean;
  changeReason: string;
}> {
  const summary = getIssueSummary(issue);
  const reporter = getDisplayName(issue.fields, "reporter");
  const teamList =
    creds.teeMembers.length === 0
      ? "(no internal team configured)"
      : creds.teeMembers.map((m) => `- ${m}`).join("\n");

  const systemPrompt = `You are double-checking a Jira escalation card's preventability classification for an internal escalation review.

PREVENTABILITY RULE (apply strictly — ALL THREE must be true):
A card is "preventable" if and only if ALL of the following hold:
  (1) EXTERNAL CONTRIBUTION — a non-team, non-Reporter commenter provided the key to resolution.
  (2) INTERNALLY DISCOVERABLE — the resolution involved information the TEE could plausibly have found themselves: already documented in Confluence, in a prior Jira card, in a runbook, or a lapse in standard process / something the TEE forgot or overlooked.
  (3) NOT A PR FIX — the resolution did not require new engineering code to land.

If ANY of (1)(2)(3) is false, the card is NOT preventable.

Specifically: an external contribution that surfaced SPECIALIZED knowledge not documented anywhere internally (third-party vendor quirks, customer-only environment context, deep OS internals only that person knew) does NOT make a card preventable — the TEE had no reasonable way to find it.

The internal escalation team consists ONLY of:
${teamList}

A first-pass analysis judged this card NOT preventable, but external commenters (non-team, non-Reporter) DID participate. Re-read those external comments carefully and ask BOTH:
- Did any external suggestion actually drive the resolution? AND
- Was that suggestion something the TEE could have found themselves (Confluence, prior cards, runbook, standard process), or was it specialized knowledge only that commenter had?

If you AGREE with the first pass — either the external comments were tangential/requests-for-info, OR they provided real value but represented specialized knowledge the TEE couldn't have found internally — return preventable: false and explain briefly.

If you DISAGREE — an external contribution drove the resolution AND it was something internally discoverable (you can name the Confluence page, prior card, or process gap that the TEE missed) — return preventable: true, identify which commenter, what they contributed, AND what internal resource / process step the TEE should have used.

Respond with ONLY a valid JSON object — no prose, no markdown fences:
{
  "preventable": boolean,
  "preventableReason": string,   // 1-2 sentences justifying your final answer
  "changed": boolean,            // true ONLY if you flipped from the first pass
  "changeReason": string         // brief: why you flipped (or "" if unchanged)
}`;

  const userMessage = [
    `Card: ${issue.key} — ${summary}`,
    `Reporter: ${reporter}`,
    `Solution category (first pass): ${firstPass.solutionCategory}`,
    `First-pass preventability: NOT preventable`,
    `First-pass reason: ${firstPass.preventableReason}`,
    "",
    `External comments (NOT on the internal team, NOT the Reporter) — ${externalComments.length} total:`,
    renderExternalComments(externalComments),
  ].join("\n");

  const resp = await anthropicMessages(
    creds,
    {
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      max_tokens: 600,
    },
    signal,
  );
  const text = extractText(resp).trim();
  const json = parseJsonObject(text);
  const preventable = Boolean(json.preventable);
  return {
    preventable,
    preventableReason: String(
      json.preventableReason ?? firstPass.preventableReason,
    ),
    // Trust the model's "changed" flag, but also self-correct: if it claims
    // unchanged but the bool actually flipped, mark it changed.
    changed:
      Boolean(json.changed) || preventable !== firstPass.preventable,
    changeReason: String(json.changeReason ?? ""),
  };
}

/**
 * Cross-cutting synthesis pass. After every card has been individually
 * analyzed, ask Claude to look across them and identify 3–5 *patterns* and
 * concrete improvement recommendations that span multiple cards. The per-card
 * `improvement` field captures one-off suggestions; this step is what populates
 * the report's top-level "Improvement Recommendations" section.
 */
async function synthesizeImprovements(
  creds: Credentials,
  cards: EscalationCard[],
  signal?: AbortSignal,
): Promise<{ title: string; body: string }[]> {
  if (cards.length === 0) return [];

  const cardSummaries = cards
    .map((c) => {
      const flags = [
        c.preventable ? "PREVENTABLE" : "not-preventable",
        c.solutionCategory,
        c.escalationKind,
      ].join(" · ");
      return [
        `[${c.id}] ${c.title}`,
        `  Flags: ${flags}`,
        `  Summary: ${c.summary}`,
        `  Per-card improvement note: ${c.improvement || "—"}`,
      ].join("\n");
    })
    .join("\n\n");

  const preventableCount = cards.filter((c) => c.preventable).length;
  const prFixCount = cards.filter((c) => c.solutionCategory === "PR fix").length;
  const customerEnvCount = cards.filter(
    (c) => c.solutionCategory === "Customer environment specific issue",
  ).length;

  const systemPrompt = `You are synthesizing cross-cutting improvement recommendations for an internal Datadog Containers Escalation-to-Engineering review.

You will receive a list of all escalation cards from the review period, with per-card classification and individual improvement notes. Your job is to look ACROSS the cards and identify 3–5 patterns or systemic issues that, if addressed, would reduce escalations or shorten resolution time.

GUIDANCE:
- Look for recurring themes: same component, same release version, same customer environment, similar root causes, similar process gaps.
- Prefer SYSTEMIC recommendations (process changes, runbook updates, documentation gaps, test coverage) over one-off "fix this card" notes.
- For preventable cards specifically (the TEE could have found the answer internally), focus the recommendation on the missing discoverability — what knowledge base, runbook, or process step would have caught it.
- For PR-fix clusters, suggest engineering hygiene improvements (test coverage on a specific path, lint rule, design review gate, release-gate check).
- For customer-environment clusters, suggest pre-flight checklists, documentation, or onboarding improvements.
- Be specific. "Improve documentation" is too vague — say WHICH page in WHICH space needs WHAT updated.
- It's OK to return fewer than 5 recommendations if there aren't enough patterns. Quality over quantity.

OUTPUT: respond with ONLY a single valid JSON object — no prose, no markdown fences:
{
  "recommendations": [
    {
      "title": string,   // short, action-oriented (e.g. "Add OpenShift init-container runbook section")
      "body": string     // 2-4 sentences: the pattern, the affected cards (cite keys), the specific action
    },
    ...
  ]
}`;

  const userMessage = [
    `Review period totals:`,
    `- ${cards.length} escalation${cards.length === 1 ? "" : "s"} analyzed`,
    `- ${preventableCount} preventable`,
    `- ${prFixCount} resolved by PR fix`,
    `- ${customerEnvCount} customer-environment-specific`,
    "",
    "Cards:",
    cardSummaries,
  ].join("\n");

  const resp = await anthropicMessages(
    creds,
    {
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      max_tokens: 2000,
    },
    signal,
  );
  const text = extractText(resp).trim();
  const json = parseJsonObject(text);
  const raw = json.recommendations;
  if (!Array.isArray(raw)) return [];
  const out: { title: string; body: string }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const title = typeof obj.title === "string" ? obj.title.trim() : "";
    const body = typeof obj.body === "string" ? obj.body.trim() : "";
    if (!title || !body) continue;
    out.push({ title, body });
  }
  return out;
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
  signal?: AbortSignal,
): Promise<ReportGenerationResult> {
  function checkCancel() {
    if (signal?.aborted) throw new GenerationCancelledError();
  }
  const warnings: string[] = [];
  const jqlConfig: JqlConfig = {
    projectKey: creds.projectKey,
    escalationColumns: creds.escalationColumns,
    resolvedStatuses: creds.resolvedStatuses,
  };

  // 1. Page through the escalated-cards JQL.
  onProgress({
    phase: "querying-escalated",
    message: "Running escalation JQL against Jira…",
    detail: buildEscalationJql(timeframe, jqlConfig).replace(/\n\s*/g, " "),
  });
  const escalatedKeys: string[] = [];
  let nextPageToken: string | undefined;
  do {
    checkCancel();
    const page = await jiraSearch(
      creds,
      {
        jql: buildEscalationJql(timeframe, jqlConfig),
        fields: ["summary", "status", "created", "resolutiondate"],
        maxResults: 100,
        nextPageToken,
      },
      signal,
    );
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
  onProgress({
    phase: "querying-escalated",
    message: `Found ${escalatedKeys.length} escalated card${escalatedKeys.length === 1 ? "" : "s"}`,
    detail:
      escalatedKeys.length === 0
        ? "No cards match the JQL filter."
        : escalatedKeys.slice(0, 8).join(", ") +
          (escalatedKeys.length > 8 ? `, +${escalatedKeys.length - 8} more` : ""),
  });

  // 2. Total cards created in period (for escalation-rate denominator).
  onProgress({
    phase: "querying-total",
    message: `Counting total ${creds.projectKey} cards in period…`,
    detail: "Used as the denominator for the escalation rate.",
  });
  let totalCardsCreated = escalatedKeys.length;
  try {
    checkCancel();
    const totalQuery = await jiraSearch(
      creds,
      {
        jql: buildTotalCardsJql(timeframe, jqlConfig),
        fields: ["created"],
        maxResults: 1,
      },
      signal,
    );
    if (typeof totalQuery.total === "number") {
      totalCardsCreated = totalQuery.total;
    } else {
      let count = 0;
      let token: string | undefined;
      do {
        checkCancel();
        const page = await jiraSearch(
          creds,
          {
            jql: buildTotalCardsJql(timeframe, jqlConfig),
            fields: ["created"],
            maxResults: 100,
            nextPageToken: token,
          },
          signal,
        );
        count += page.issues.length;
        token = page.isLast ? undefined : page.nextPageToken;
      } while (token);
      totalCardsCreated = count;
    }
  } catch (err) {
    if (err instanceof GenerationCancelledError) throw err;
    warnings.push(
      `Could not count total ${creds.projectKey} cards (${err instanceof Error ? err.message : String(err)}); escalation rate will be approximate.`,
    );
  }

  // 3. Fetch each escalated card with its changelog + comments.
  onProgress({
    phase: "fetching-changelogs",
    message: `Fetching ${escalatedKeys.length} card${escalatedKeys.length === 1 ? "" : "s"} from Jira…`,
    current: 0,
    total: escalatedKeys.length,
  });
  const issues: JiraIssue[] = [];
  for (let i = 0; i < escalatedKeys.length; i++) {
    const key = escalatedKeys[i];
    onProgress({
      phase: "fetching-changelogs",
      message: `Fetching ${key}`,
      detail: "Pulling description, comments, changelog, and custom fields…",
      current: i,
      total: escalatedKeys.length,
    });
    checkCancel();
    // Request all fields so we can pick up custom fields like "Pre-Investigation
    // Notes" / "Investigation Notes". `expand=names` returns a fieldId → display
    // name map so we can locate them without hardcoding custom field IDs.
    const issue = await jiraIssue(
      creds,
      key,
      {
        fields: ["*all"],
        expand: "changelog,names",
      },
      signal,
    );
    issues.push(issue);
    onProgress({
      phase: "fetching-changelogs",
      message: `Fetched ${key}`,
      detail: getIssueSummary(issue),
      current: i + 1,
      total: escalatedKeys.length,
    });
  }

  // 4. Analyze each via Claude.
  onProgress({
    phase: "analyzing",
    message: `Sending ${issues.length} card${issues.length === 1 ? "" : "s"} to Claude (${creds.anthropicModel})…`,
    detail:
      "Per card: read description + custom fields + external comments, judge preventability, pick a solution category, suggest an improvement.",
    current: 0,
    total: issues.length,
  });
  const cards: EscalationCard[] = [];
  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    onProgress({
      phase: "analyzing",
      message: `Analyzing ${issue.key}`,
      detail: getIssueSummary(issue),
      current: i,
      total: issues.length,
    });
    const statusFlow = extractStatusFlow(issue);
    const createdAt = (issue.fields.created as string | undefined)?.slice(0, 10) ?? "";
    const resolvedAt = firstTerminalDate(issue) ?? createdAt;
    checkCancel();
    let analysis: Awaited<ReturnType<typeof analyzeCard>>;
    try {
      analysis = await analyzeCard(creds, issue, statusFlow, signal);
    } catch (err) {
      if (err instanceof GenerationCancelledError) throw err;
      warnings.push(
        `Analysis failed for ${issue.key} (${err instanceof Error ? err.message : String(err)}); using minimal fallback.`,
      );
      // Use the Jira summary if present (defaulting to the issue key for title,
      // but to a placeholder for the summary body so the UI clearly signals the
      // analysis failure rather than echoing the title twice).
      const rawSummary = issue.fields.summary as string | undefined;
      analysis = {
        title: rawSummary ?? issue.key,
        summary: rawSummary ?? "Analysis unavailable.",
        escalationReason: "Analysis unavailable.",
        preventable: false,
        preventableReason: "Could not be analyzed automatically.",
        solutionCategory: "Other",
        nonTeeInvolvement: "Analysis unavailable.",
        improvement: "—",
      };
    }

    // Second-pass verification: if Claude marked this NOT preventable but the
    // card has external commentary (and isn't a PR fix, which is always
    // overridden), do a focused re-check to catch missed contributions.
    const teamSet = new Set(creds.teeMembers);
    const externalComments = commentersOutsideTeamAndReporter(issue, teamSet);
    const eligibleForRecheck =
      analysis.solutionCategory !== "PR fix" &&
      !analysis.preventable &&
      externalComments.length > 0;
    if (eligibleForRecheck) {
      onProgress({
        phase: "analyzing",
        message: `Re-checking ${issue.key} for missed external contributions`,
        detail: `${externalComments.length} external commenter${externalComments.length === 1 ? "" : "s"} found — verifying first-pass "not preventable" classification.`,
        current: i,
        total: issues.length,
      });
      try {
        const recheck = await recheckPreventability(
          creds,
          issue,
          {
            preventable: analysis.preventable,
            preventableReason: analysis.preventableReason,
            solutionCategory: analysis.solutionCategory,
          },
          externalComments,
          signal,
        );
        if (recheck.changed) {
          analysis = {
            ...analysis,
            preventable: recheck.preventable,
            preventableReason: recheck.preventableReason,
          };
          onProgress({
            phase: "analyzing",
            message: `Re-check flipped ${issue.key} to ${recheck.preventable ? "preventable" : "not preventable"}`,
            detail: recheck.changeReason || recheck.preventableReason,
            current: i,
            total: issues.length,
          });
        } else {
          onProgress({
            phase: "analyzing",
            message: `Re-check confirmed ${issue.key} as not preventable`,
            detail: recheck.preventableReason,
            current: i,
            total: issues.length,
          });
        }
      } catch (err) {
        if (err instanceof GenerationCancelledError) throw err;
        warnings.push(
          `Re-check failed for ${issue.key} (${err instanceof Error ? err.message : String(err)}); keeping first-pass classification.`,
        );
      }
    }

    onProgress({
      phase: "analyzing",
      message: `Finished ${issue.key}`,
      detail: `${analysis.preventable ? "Preventable" : "Not preventable"} · ${analysis.solutionCategory}`,
      current: i + 1,
      total: issues.length,
      cardResult: {
        key: issue.key,
        title: analysis.title,
        preventable: analysis.preventable,
        solutionCategory: analysis.solutionCategory,
      },
    });
    cards.push({
      id: issue.key,
      title: analysis.title,
      summary: analysis.summary,
      escalationReason: analysis.escalationReason,
      createdAt,
      resolvedAt,
      durationDays: daysBetween(createdAt, resolvedAt),
      assignee: getDisplayName(issue.fields, "assignee"),
      reporter: getDisplayName(issue.fields, "reporter"),
      statusFlow: statusFlow.join(" → "),
      preventable: analysis.preventable,
      preventableReason: analysis.preventableReason,
      solutionCategory: analysis.solutionCategory,
      escalationKind: classifyEscalationKind(statusFlow, creds.escalationColumns),
      nonTeeInvolvement: analysis.nonTeeInvolvement,
      improvement: analysis.improvement,
    });
  }

  // 5. Cross-cutting improvement synthesis. One final Claude call that looks
  // across all analyzed cards and suggests systemic improvements / patterns.
  onProgress({
    phase: "assembling",
    message: "Synthesizing cross-cutting improvement recommendations…",
    detail: `Looking across ${cards.length} card${cards.length === 1 ? "" : "s"} for patterns, recurring themes, and systemic gaps.`,
  });
  let improvements: { title: string; body: string }[] = [];
  try {
    checkCancel();
    improvements = await synthesizeImprovements(creds, cards, signal);
    onProgress({
      phase: "assembling",
      message: `Produced ${improvements.length} improvement recommendation${improvements.length === 1 ? "" : "s"}`,
      detail:
        improvements.length === 0
          ? "Claude returned no cross-cutting patterns — too few cards or no recurring themes."
          : improvements.map((r) => r.title).join(" · "),
    });
  } catch (err) {
    if (err instanceof GenerationCancelledError) throw err;
    warnings.push(
      `Cross-cutting synthesis failed (${err instanceof Error ? err.message : String(err)}); per-card improvement notes are still available on each card.`,
    );
  }

  onProgress({
    phase: "assembling",
    message: "Assembling report…",
    detail: `${cards.length} card${cards.length === 1 ? "" : "s"} analyzed, ${cards.filter((c) => c.preventable).length} flagged preventable, ${improvements.length} cross-cutting recommendation${improvements.length === 1 ? "" : "s"}.`,
  });

  const report: ReportPeriod = {
    label: timeframe.label,
    rangeStart: timeframe.start,
    rangeEnd: timeframe.end,
    totalCardsCreated,
    cards,
    improvements,
  };

  return { report, warnings };
}
