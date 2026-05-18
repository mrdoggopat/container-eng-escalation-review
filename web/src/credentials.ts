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
      teeMembers: Array.isArray(parsed.teeMembers)
        ? parsed.teeMembers
        : DEFAULT_CREDENTIALS.teeMembers,
      investigationFieldNames: Array.isArray(parsed.investigationFieldNames)
        ? parsed.investigationFieldNames
        : DEFAULT_CREDENTIALS.investigationFieldNames,
      teamContextUrls: Array.isArray(parsed.teamContextUrls)
        ? parsed.teamContextUrls
        : DEFAULT_CREDENTIALS.teamContextUrls,
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
    arrayEquals(creds.teeMembers, DEFAULT_CREDENTIALS.teeMembers) &&
    arrayEquals(
      creds.investigationFieldNames,
      DEFAULT_CREDENTIALS.investigationFieldNames,
    ) &&
    arrayEquals(creds.teamContextUrls, DEFAULT_CREDENTIALS.teamContextUrls)
  );
}

function arrayEquals(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export function maskSecret(value: string): string {
  if (!value) return "—";
  if (value.length <= 8) return "•".repeat(value.length);
  return value.slice(0, 4) + "•".repeat(8) + value.slice(-4);
}
