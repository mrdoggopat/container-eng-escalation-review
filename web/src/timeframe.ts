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

export function presetTimeframe(preset: TimeframePreset, today: string): Timeframe {
  switch (preset) {
    case "week":
      return { preset, label: "Past week", start: addDays(today, -6), end: today };
    case "month":
      return { preset, label: "Past month", start: addDays(today, -29), end: today };
    case "3months":
      return { preset, label: "Past 3 months", start: addDays(today, -89), end: today };
    case "year":
      return { preset, label: "Past year", start: addDays(today, -364), end: today };
    case "custom":
      return { preset, label: "Custom range", start: today, end: today };
  }
}

export type JqlConfig = {
  projectKey: string;
  escalationColumns: string[];
};

/**
 * JQL for finding cards whose status history transitions into any of the
 * configured escalation columns during the timeframe. Matches the pattern in
 * CLAUDE.md.
 */
export function buildEscalationJql(timeframe: Timeframe, config: JqlConfig): string {
  const clauses = config.escalationColumns.map(
    (col) =>
      `status changed to "${col}" DURING ("${timeframe.start}", "${timeframe.end}")`,
  );
  return `project = ${config.projectKey} AND (\n  ${clauses.join("\n  OR ")}\n)`;
}

/**
 * JQL for counting the total number of cards created in the period. Used as
 * the denominator for escalation rate.
 */
export function buildTotalCardsJql(timeframe: Timeframe, config: JqlConfig): string {
  return `project = ${config.projectKey} AND created >= "${timeframe.start}" AND created <= "${timeframe.end}"`;
}
