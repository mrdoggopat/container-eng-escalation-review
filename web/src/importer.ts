import type { EscalationCard, ReportPeriod, SolutionCategory } from "./data";
import type { Timeframe, TimeframePreset } from "./timeframe";

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

export type ImportedReport = {
  timeframe: Timeframe;
  report: ReportPeriod;
};

const VALID_PRESETS: TimeframePreset[] = [
  "week",
  "month",
  "3months",
  "year",
  "custom",
];

const VALID_SOLUTION_CATEGORIES: SolutionCategory[] = [
  "PR fix",
  "Customer environment specific issue",
  "Suggestion without PR or code fixes",
  "Other",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a file the user previously downloaded from this app and reconstruct
 * a viewable report. Format is detected from the file extension.
 */
export async function importFromFile(file: File): Promise<ImportedReport> {
  const text = await file.text();
  const lowered = file.name.toLowerCase();
  if (lowered.endsWith(".json")) return parseJsonReport(text, file.name);
  if (lowered.endsWith(".csv")) return parseCsvReport(text, file.name);
  if (lowered.endsWith(".md") || lowered.endsWith(".markdown")) {
    return parseMarkdownReport(text, file.name);
  }
  throw new ImportError(
    `Unsupported file type: "${file.name}". Use a .json, .csv, or .md report exported from this app.`,
  );
}

// ---- JSON --------------------------------------------------------------

function parseJsonReport(text: string, filename: string): ImportedReport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new ImportError(
      `${filename}: not valid JSON (${err instanceof Error ? err.message : String(err)}).`,
    );
  }
  if (!data || typeof data !== "object") {
    throw new ImportError(`${filename}: top-level JSON must be an object.`);
  }
  const obj = data as Record<string, unknown>;
  const timeframe = parseTimeframe(obj.timeframe, filename);

  const cardsRaw = obj.cards;
  if (!Array.isArray(cardsRaw)) {
    throw new ImportError(`${filename}: missing "cards" array.`);
  }
  const cards = cardsRaw.map((c, i) => parseJsonCard(c, i, filename));

  const summary = (obj.summary ?? {}) as Record<string, unknown>;
  const totalCardsCreated = parseNumberOrZero(
    summary.totalCardsCreatedInPeriod,
  );

  const improvementsRaw = obj.improvements;
  const improvements: ReportPeriod["improvements"] = Array.isArray(improvementsRaw)
    ? improvementsRaw.map((it, i) => parseImprovement(it, i, filename))
    : [];

  const report: ReportPeriod = {
    label: timeframe.label,
    rangeStart: timeframe.start,
    rangeEnd: timeframe.end,
    totalCardsCreated,
    cards,
    improvements,
  };
  return { timeframe, report };
}

function parseTimeframe(value: unknown, filename: string): Timeframe {
  if (!value || typeof value !== "object") {
    throw new ImportError(`${filename}: missing "timeframe" object.`);
  }
  const obj = value as Record<string, unknown>;
  const start = String(obj.start ?? "");
  const end = String(obj.end ?? "");
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
    throw new ImportError(
      `${filename}: timeframe.start and timeframe.end must be YYYY-MM-DD strings (got "${start}", "${end}").`,
    );
  }
  const preset = VALID_PRESETS.includes(obj.preset as TimeframePreset)
    ? (obj.preset as TimeframePreset)
    : "custom";
  const label =
    typeof obj.label === "string" && obj.label ? obj.label : `${start} – ${end}`;
  return { preset, label, start, end };
}

function parseJsonCard(
  value: unknown,
  index: number,
  filename: string,
): EscalationCard {
  if (!value || typeof value !== "object") {
    throw new ImportError(`${filename}: cards[${index}] is not an object.`);
  }
  const c = value as Record<string, unknown>;
  const id = requireString(c.id, `cards[${index}].id`, filename);
  const createdAt = requireDate(c.createdAt, `cards[${index}].createdAt`, filename);
  const resolvedAt = requireDate(
    c.resolvedAt,
    `cards[${index}].resolvedAt`,
    filename,
  );
  const durationDays = parseNumberOrZero(c.durationDays);
  const solutionCategory = normalizeSolutionCategory(c.solutionCategory);
  return {
    id,
    title: stringOr(c.title, id),
    summary: stringOr(c.summary, "—"),
    escalationReason: stringOr(c.escalationReason, "—"),
    createdAt,
    resolvedAt,
    durationDays,
    assignee: stringOr(c.assignee, "—"),
    reporter: stringOr(c.reporter, "—"),
    statusFlow: stringOr(c.statusFlow, ""),
    preventable: Boolean(c.preventable),
    preventableReason: stringOr(c.preventableReason, ""),
    solutionCategory,
    escalationKind: stringOr(c.escalationKind, "Unknown"),
    nonTeeInvolvement: stringOr(c.nonTeeInvolvement, "None."),
    improvement: stringOr(c.improvement, ""),
  };
}

function parseImprovement(
  value: unknown,
  index: number,
  filename: string,
): { title: string; body: string } {
  if (!value || typeof value !== "object") {
    throw new ImportError(
      `${filename}: improvements[${index}] is not an object.`,
    );
  }
  const obj = value as Record<string, unknown>;
  return {
    title: stringOr(obj.title, `Improvement ${index + 1}`),
    body: stringOr(obj.body, ""),
  };
}

// ---- CSV ---------------------------------------------------------------

const EXPECTED_CSV_HEADERS = [
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
] as const;

function parseCsvReport(text: string, filename: string): ImportedReport {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    throw new ImportError(`${filename}: CSV is empty.`);
  }
  const headers = rows[0].map((h) => h.trim());
  const missing = EXPECTED_CSV_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    throw new ImportError(
      `${filename}: missing expected CSV columns: ${missing.join(", ")}.`,
    );
  }
  const colIndex = (name: string) => headers.indexOf(name);
  const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
  if (dataRows.length === 0) {
    throw new ImportError(`${filename}: CSV has a header row but no data rows.`);
  }

  const cards: EscalationCard[] = dataRows.map((row, i) => {
    const get = (col: string) => (row[colIndex(col)] ?? "").trim();
    const id = get("id");
    if (!id) {
      throw new ImportError(
        `${filename}: row ${i + 2} is missing required "id" value.`,
      );
    }
    const createdAt = get("created_at");
    const resolvedAt = get("resolved_at");
    if (!DATE_RE.test(createdAt) || !DATE_RE.test(resolvedAt)) {
      throw new ImportError(
        `${filename}: row ${i + 2} has invalid date(s): created_at="${createdAt}", resolved_at="${resolvedAt}". Expected YYYY-MM-DD.`,
      );
    }
    return {
      id,
      title: get("title") || id,
      summary: get("escalation_reason") || "—",
      escalationReason: get("escalation_reason") || "—",
      createdAt,
      resolvedAt,
      durationDays: parseNumberOrZero(get("duration_days")),
      assignee: get("assignee") || "—",
      reporter: get("reporter") || "—",
      statusFlow: get("status_flow"),
      preventable: /^yes|true|1$/i.test(get("preventable")),
      preventableReason: get("preventable_reason"),
      solutionCategory: normalizeSolutionCategory(get("solution_category")),
      escalationKind: get("escalation_kind") || "Unknown",
      nonTeeInvolvement: get("non_tee_involvement") || "None.",
      improvement: get("improvement"),
    };
  });

  const timeframe = timeframeFromFilenameOrCards(filename, cards);
  const report: ReportPeriod = {
    label: timeframe.label,
    rangeStart: timeframe.start,
    rangeEnd: timeframe.end,
    totalCardsCreated: 0,
    cards,
    improvements: [],
  };
  return { timeframe, report };
}

/**
 * Minimal RFC4180-ish CSV tokenizer: supports quoted fields with escaped
 * double quotes (""), commas, and \r\n / \n line endings.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += ch;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---- Markdown ----------------------------------------------------------

function parseMarkdownReport(text: string, filename: string): ImportedReport {
  const titleMatch = text.match(/^#\s+(.+?)\s*$/m);
  if (!titleMatch) {
    throw new ImportError(
      `${filename}: missing top-level "# … Escalation Review: <label>" heading.`,
    );
  }
  // Pull "<label>" from "<anything>: <label>" if present, else use the whole line.
  const headerLabel = titleMatch[1].includes(":")
    ? titleMatch[1].split(":").slice(1).join(":").trim()
    : titleMatch[1].trim();

  const rangeMatch = text.match(
    /_Range:\s*([A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4})\s*[–-]\s*([A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4})/,
  );
  let start: string | null = null;
  let end: string | null = null;
  if (rangeMatch) {
    start = parsePrettyDate(rangeMatch[1]);
    end = parsePrettyDate(rangeMatch[2]);
  }

  const detailIdx = text.indexOf("## Detailed Card Analysis");
  if (detailIdx === -1) {
    throw new ImportError(
      `${filename}: missing "## Detailed Card Analysis" section.`,
    );
  }
  const afterDetail = text.slice(detailIdx);
  const cardBlocks = afterDetail.split(/^###\s+\d+\.\s+/m).slice(1);
  if (cardBlocks.length === 0) {
    throw new ImportError(
      `${filename}: no card entries found under "## Detailed Card Analysis".`,
    );
  }

  const cards: EscalationCard[] = cardBlocks.map((block, i) =>
    parseMarkdownCardBlock(block, i, filename),
  );

  if (!start || !end) {
    const dates = cards
      .flatMap((c) => [c.createdAt, c.resolvedAt])
      .filter((d) => DATE_RE.test(d))
      .sort();
    if (dates.length > 0) {
      start = dates[0];
      end = dates[dates.length - 1];
    }
  }
  if (!start || !end) {
    throw new ImportError(
      `${filename}: could not determine timeframe range (no "_Range: ..._" line and no parseable card dates).`,
    );
  }

  const timeframe: Timeframe = {
    preset: "custom",
    label: headerLabel || `${start} – ${end}`,
    start,
    end,
  };

  const improvementsIdx = text.indexOf("## Improvement Recommendations");
  const improvements: ReportPeriod["improvements"] = [];
  if (improvementsIdx !== -1) {
    const tail = text.slice(improvementsIdx);
    const itemRe = /^\d+\.\s+\*\*([^*]+)\*\*\s+—\s+(.+?)(?=\n\d+\.\s+\*\*|\n##\s|$)/gms;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(tail)) !== null) {
      improvements.push({ title: m[1].trim(), body: m[2].trim() });
    }
  }

  const totalMatch = text.match(/Total\s+[A-Za-z]+\s+cards\s+created\s+in\s+period\s*\|\s*(\d+)\s*\|/i);
  const totalCardsCreated = totalMatch ? Number(totalMatch[1]) : 0;

  const report: ReportPeriod = {
    label: timeframe.label,
    rangeStart: timeframe.start,
    rangeEnd: timeframe.end,
    totalCardsCreated,
    cards,
    improvements,
  };
  return { timeframe, report };
}

function parseMarkdownCardBlock(
  block: string,
  index: number,
  filename: string,
): EscalationCard {
  // First line: "<id> — <title>"
  const firstLineEnd = block.indexOf("\n");
  const head = (firstLineEnd === -1 ? block : block.slice(0, firstLineEnd)).trim();
  const dashIdx = head.indexOf(" — ");
  let id = head;
  let title = "";
  if (dashIdx !== -1) {
    id = head.slice(0, dashIdx).trim();
    title = head.slice(dashIdx + 3).trim();
  }
  if (!id) {
    throw new ImportError(
      `${filename}: card #${index + 1} is missing an id in its heading.`,
    );
  }
  const body = firstLineEnd === -1 ? "" : block.slice(firstLineEnd + 1);

  const field = (name: string) => {
    const re = new RegExp(
      `^-\\s+\\*\\*${escapeRegex(name)}:\\*\\*\\s+([\\s\\S]*?)(?=\\n-\\s+\\*\\*|\\n###\\s|$)`,
      "m",
    );
    const m = body.match(re);
    return m ? m[1].trim() : "";
  };

  const durationField = field("Duration");
  const durationDays = (() => {
    const m = durationField.match(/(\d+)\s+day/);
    return m ? Number(m[1]) : 0;
  })();
  const datesMatch = durationField.match(
    /\(([A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4})\s*[→-]\s*([A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4})\)/,
  );
  const createdAt = datesMatch ? parsePrettyDate(datesMatch[1]) ?? "" : "";
  const resolvedAt = datesMatch ? parsePrettyDate(datesMatch[2]) ?? "" : "";

  const assigneeReporterField = field("Assignee");
  let assignee = "—";
  let reporter = "—";
  if (assigneeReporterField) {
    const m = assigneeReporterField.match(
      /^(.+?)\s*\|\s*\*\*Reporter:\*\*\s*(.+?)$/,
    );
    if (m) {
      assignee = m[1].trim();
      reporter = m[2].trim();
    } else {
      assignee = assigneeReporterField;
    }
  }

  const preventableField = field("Preventable");
  const preventable = /\*\*Yes\*\*/i.test(preventableField);
  const preventableReason = preventableField.replace(/^\*\*(?:Yes|No)\*\*\s*—\s*/i, "");

  return {
    id,
    title: title || id,
    summary: field("Summary") || "—",
    escalationReason: field("Escalation Reason") || "—",
    createdAt: createdAt || "1970-01-01",
    resolvedAt: resolvedAt || createdAt || "1970-01-01",
    durationDays,
    assignee,
    reporter,
    statusFlow: field("Status Flow"),
    preventable,
    preventableReason,
    solutionCategory: normalizeSolutionCategory(field("Solution Category")),
    escalationKind: "Unknown",
    nonTeeInvolvement:
      field("Non-TEE Engineering Involvement") ||
      field("External engineering involvement") ||
      "None.",
    improvement: field("Improvement Recommendations") || field("Improvement"),
  };
}

// ---- helpers -----------------------------------------------------------

function normalizeSolutionCategory(value: unknown): SolutionCategory {
  const s = typeof value === "string" ? value.trim() : "";
  if (VALID_SOLUTION_CATEGORIES.includes(s as SolutionCategory)) {
    return s as SolutionCategory;
  }
  return "Other";
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function requireString(value: unknown, path: string, filename: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new ImportError(`${filename}: ${path} must be a non-empty string.`);
}

function requireDate(value: unknown, path: string, filename: string): string {
  if (typeof value === "string" && DATE_RE.test(value)) return value;
  throw new ImportError(
    `${filename}: ${path} must be a YYYY-MM-DD string (got ${JSON.stringify(value)}).`,
  );
}

function parseNumberOrZero(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  sept: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

/**
 * Convert e.g. "Mar 1, 2026" or "March 1, 2026" → "2026-03-01".
 */
function parsePrettyDate(input: string): string | null {
  const m = input.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (!month) return null;
  const day = m[2].padStart(2, "0");
  return `${m[3]}-${month}-${day}`;
}

function timeframeFromFilenameOrCards(
  filename: string,
  cards: EscalationCard[],
): Timeframe {
  const m = filename.match(/(\d{4}-\d{2}-\d{2}).*?(\d{4}-\d{2}-\d{2})/);
  if (m) {
    return {
      preset: "custom",
      label: `${m[1]} – ${m[2]}`,
      start: m[1],
      end: m[2],
    };
  }
  const dates = cards
    .flatMap((c) => [c.createdAt, c.resolvedAt])
    .filter((d) => DATE_RE.test(d))
    .sort();
  if (dates.length === 0) {
    throw new ImportError(
      `${filename}: could not determine timeframe (no date range in filename and no card dates).`,
    );
  }
  const start = dates[0];
  const end = dates[dates.length - 1];
  return {
    preset: "custom",
    label: `${start} – ${end}`,
    start,
    end,
  };
}
