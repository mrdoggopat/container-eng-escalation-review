export type Credentials = {
  // Auth
  jiraEmail: string;
  jiraToken: string;
  jiraDomain: string;
  anthropicKey: string;
  anthropicModel: string;
  // Team configuration (defaults are the Datadog Containers / CONS values)
  projectKey: string;
  escalationColumns: string[];
  /**
   * Specific status names that count as "fully resolved". When non-empty, the
   * escalation JQL filters to `status IN (...)`. When empty (default), it falls
   * back to Jira's `statusCategory = Done` taxonomy, which catches every
   * terminal status across any workflow (Done, Closed, Resolved, Archive,
   * "Done (ZD Automation)", etc.). Override only if you need to exclude some
   * resolved statuses (e.g. count Done but not Archive).
   */
  resolvedStatuses: string[];
  teeMembers: string[];
  /**
   * Names of Jira custom fields whose contents should be included alongside
   * the description when summarizing a card. Matched case-insensitively.
   */
  investigationFieldNames: string[];
  /**
   * Confluence space / page URLs that define the broader team context.
   * Passed to Claude as a reference for who's "internal" beyond the strict
   * roster when judging preventability.
   */
  teamContextUrls: string[];
  /**
   * Confluence space name OR space key. Used as the default target when
   * publishing a report to Confluence. Examples: "Containers TEE Team" or
   * "CONT".
   */
  confluenceSpace: string;
  /**
   * Exact title of the Confluence page that new reports should be nested under
   * (i.e. their parent). Optional — leave blank to create at the space root.
   */
  confluenceParentPage: string;
};

const STORAGE_KEY = "cons-review.credentials";

export const DEFAULT_CREDENTIALS: Credentials = {
  jiraEmail: "",
  jiraToken: "",
  jiraDomain: "datadoghq.atlassian.net",
  anthropicKey: "",
  anthropicModel: "claude-sonnet-4-5",
  projectKey: "CONS",
  escalationColumns: [
    "Engineering Triage",
    "Engineering - In Progress",
    "PM Triage",
    "PM - In Progress",
  ],
  resolvedStatuses: [],
  teeMembers: [
    "Patrick Liang",
    "Jack Davenport",
    "Mathieu Colin",
    "Akira Hiiro",
    "Jan Lazaro",
  ],
  investigationFieldNames: ["Pre-Investigation Notes", "Investigation Notes"],
  teamContextUrls: [
    "https://datadoghq.atlassian.net/wiki/spaces/CONT/overview",
    "https://datadoghq.atlassian.net/wiki/spaces/CONTP/overview",
    "https://datadoghq.atlassian.net/wiki/spaces/TON/pages/6187287156/Team+Overview",
    "https://datadoghq.atlassian.net/wiki/spaces/CAUT/overview",
    "https://datadoghq.atlassian.net/wiki/spaces/CAP/overview",
    "https://datadoghq.atlassian.net/wiki/spaces/EXP/overview",
    "https://datadoghq.atlassian.net/wiki/spaces/cxg/overview",
  ],
  confluenceSpace: "Containers TEE Team",
  confluenceParentPage: "Containers Escalation to Engineering Review",
};

export function loadCredentials(): Credentials {
  if (typeof window === "undefined") return DEFAULT_CREDENTIALS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CREDENTIALS;
    const parsed = JSON.parse(raw) as Partial<Credentials>;
    return {
      ...DEFAULT_CREDENTIALS,
      ...parsed,
      escalationColumns:
        Array.isArray(parsed.escalationColumns) && parsed.escalationColumns.length > 0
          ? parsed.escalationColumns
          : DEFAULT_CREDENTIALS.escalationColumns,
      resolvedStatuses: migrateResolvedStatuses(parsed.resolvedStatuses),
      teeMembers: Array.isArray(parsed.teeMembers)
        ? parsed.teeMembers
        : DEFAULT_CREDENTIALS.teeMembers,
      investigationFieldNames: Array.isArray(parsed.investigationFieldNames)
        ? parsed.investigationFieldNames
        : DEFAULT_CREDENTIALS.investigationFieldNames,
      teamContextUrls: Array.isArray(parsed.teamContextUrls)
        ? parsed.teamContextUrls
        : DEFAULT_CREDENTIALS.teamContextUrls,
      confluenceSpace:
        typeof parsed.confluenceSpace === "string"
          ? parsed.confluenceSpace
          : DEFAULT_CREDENTIALS.confluenceSpace,
      confluenceParentPage:
        typeof parsed.confluenceParentPage === "string"
          ? parsed.confluenceParentPage
          : DEFAULT_CREDENTIALS.confluenceParentPage,
    };
  } catch {
    return DEFAULT_CREDENTIALS;
  }
}

export function saveCredentials(creds: Credentials): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
}

export function clearCredentials(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function hasCompleteCredentials(creds: Credentials): boolean {
  return Boolean(
    creds.jiraEmail &&
      creds.jiraToken &&
      creds.jiraDomain &&
      creds.anthropicKey &&
      creds.anthropicModel &&
      creds.projectKey &&
      creds.escalationColumns.length > 0,
  );
}

/**
 * Whether the team-configuration fields match the bundled Datadog/CONS defaults.
 * Used to decide whether to surface the team override section by default.
 */
export function hasDefaultTeamConfig(creds: Credentials): boolean {
  return (
    creds.projectKey === DEFAULT_CREDENTIALS.projectKey &&
    arrayEquals(creds.escalationColumns, DEFAULT_CREDENTIALS.escalationColumns) &&
    arrayEquals(creds.resolvedStatuses, DEFAULT_CREDENTIALS.resolvedStatuses) &&
    arrayEquals(creds.teeMembers, DEFAULT_CREDENTIALS.teeMembers) &&
    arrayEquals(
      creds.investigationFieldNames,
      DEFAULT_CREDENTIALS.investigationFieldNames,
    ) &&
    arrayEquals(creds.teamContextUrls, DEFAULT_CREDENTIALS.teamContextUrls) &&
    creds.confluenceSpace === DEFAULT_CREDENTIALS.confluenceSpace &&
    creds.confluenceParentPage === DEFAULT_CREDENTIALS.confluenceParentPage
  );
}

function arrayEquals(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Earlier versions defaulted `resolvedStatuses` to `["Done", "Archived"]`, but
 * those literal names don't match many real Jira workflows (e.g. CONS uses
 * "Done (ZD Automation)" and "Archive"). Silently migrate that exact stale
 * default to `[]` so the JQL falls back to `statusCategory = Done`, which is
 * workflow-agnostic. Any explicit user-edited value is preserved as-is.
 */
const STALE_RESOLVED_STATUSES_DEFAULT = ["Done", "Archived"];
function migrateResolvedStatuses(raw: unknown): string[] {
  if (!Array.isArray(raw)) return DEFAULT_CREDENTIALS.resolvedStatuses;
  if (arrayEquals(raw as string[], STALE_RESOLVED_STATUSES_DEFAULT)) return [];
  return raw as string[];
}

export function maskSecret(value: string): string {
  if (!value) return "—";
  if (value.length <= 8) return "•".repeat(value.length);
  return value.slice(0, 4) + "•".repeat(8) + value.slice(-4);
}
