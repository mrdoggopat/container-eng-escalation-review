export type TimeframePreset =
  | "week"
  | "month"
  | "3months"
  | "year"
  | "custom";

export type Timeframe = {
  preset: TimeframePreset;
  label: string;
  /** ISO yyyy-mm-dd, inclusive. */
  start: string;
  /** ISO yyyy-mm-dd, inclusive. */
  end: string;
};

export function todayISO(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Returns the first and last day (YYYY-MM-DD, UTC) of the month containing
 * `now`. Used as the default value for the custom date range picker.
 */
export function currentMonthRange(now: Date = new Date()): {
  start: string;
  end: string;
} {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const monthStr = String(m + 1).padStart(2, "0");
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return {
    start: `${y}-${monthStr}-01`,
    end: `${y}-${monthStr}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Inclusive overlap check between two ISO date ranges. */
export function rangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function parseISO(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `iso` (UTC). */
export function startOfWeek(iso: string): string {
  const d = parseISO(iso);
  // getUTCDay: Sun=0, Mon=1, ..., Sat=6. Distance back to Monday:
  const daysFromMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysFromMonday);
  return toISO(d);
}

/** Sunday of the ISO week containing `iso` (UTC). */
export function endOfWeek(iso: string): string {
  return addDays(startOfWeek(iso), 6);
}

/** First day of the month containing `iso` (UTC). */
export function startOfMonth(iso: string): string {
  const d = parseISO(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Last day of the month containing `iso` (UTC). */
export function endOfMonth(iso: string): string {
  const d = parseISO(iso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

/** First day of (current month − `monthsBack`) (UTC). */
function startOfMonthOffset(iso: string, monthsBack: number): string {
  const d = parseISO(iso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() - monthsBack;
  const target = new Date(Date.UTC(y, m, 1));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Jan 1 of the year containing `iso` (UTC). */
export function startOfYear(iso: string): string {
  return `${parseISO(iso).getUTCFullYear()}-01-01`;
}

/** Dec 31 of the year containing `iso` (UTC). */
export function endOfYear(iso: string): string {
  return `${parseISO(iso).getUTCFullYear()}-12-31`;
}

export function presetTimeframe(preset: TimeframePreset, today: string): Timeframe {
  switch (preset) {
    case "week": {
      // Most recently completed ISO week (Mon–Sun before this week's Monday).
      const thisMonday = startOfWeek(today);
      const start = addDays(thisMonday, -7);
      const end = addDays(thisMonday, -1);
      return { preset, label: "Last week", start, end };
    }
    case "month": {
      // Previous calendar month, full range.
      const end = addDays(startOfMonth(today), -1);
      const start = startOfMonth(end);
      return { preset, label: "Last month", start, end };
    }
    case "3months": {
      // Three most recently completed calendar months (does not include the
      // current, in-progress month).
      const end = addDays(startOfMonth(today), -1);
      const start = startOfMonthOffset(end, 2);
      return { preset, label: "Last 3 months", start, end };
    }
    case "year": {
      // Previous calendar year.
      const year = parseISO(today).getUTCFullYear() - 1;
      return {
        preset,
        label: "Last year",
        start: `${year}-01-01`,
        end: `${year}-12-31`,
      };
    }
    case "custom":
      return { preset, label: "Custom range", start: today, end: today };
  }
}

export type JqlConfig = {
  projectKey: string;
  escalationColumns: string[];
  /**
   * Specific status names that count as fully resolved. When non-empty, the
   * escalation query filters to cards whose CURRENT status is in this list
   * (`status IN ("Done", "Archived", ...)`). When empty, the query falls back
   * to Jira's built-in `statusCategory = Done` taxonomy, which is workflow-
   * agnostic and catches every terminal status (Done, Closed, Resolved, Archive,
   * "Done (ZD Automation)", etc.) regardless of how the team named them.
   */
  resolvedStatuses?: string[];
};

/**
 * JQL for finding cards whose status history transitions into any of the
 * configured escalation columns during the timeframe AND whose current status
 * is resolved. By default uses `statusCategory = Done` so it works across any
 * workflow without listing specific status names. Pass `resolvedStatuses` to
 * lock to exact names instead.
 * Matches the pattern in CLAUDE.md.
 */
export function buildEscalationJql(timeframe: Timeframe, config: JqlConfig): string {
  const clauses = config.escalationColumns.map(
    (col) =>
      `status changed to "${col}" DURING ("${timeframe.start}", "${timeframe.end}")`,
  );
  const resolved = config.resolvedStatuses?.filter(Boolean) ?? [];
  const resolvedClause =
    resolved.length > 0
      ? ` AND status IN (${resolved.map((s) => `"${s}"`).join(", ")})`
      : ` AND statusCategory = Done`;
  return `project = ${config.projectKey}${resolvedClause} AND (\n  ${clauses.join("\n  OR ")}\n)`;
}

/**
 * JQL for counting the total number of cards created in the period. Used as
 * the denominator for escalation rate.
 */
export function buildTotalCardsJql(timeframe: Timeframe, config: JqlConfig): string {
  return `project = ${config.projectKey} AND created >= "${timeframe.start}" AND created <= "${timeframe.end}"`;
}
