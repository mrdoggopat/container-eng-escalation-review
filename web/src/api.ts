import type { Credentials } from "./credentials";

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON response — pass through
  }
  if (!res.ok) {
    throw new ApiError(
      `Request to ${url} failed (${res.status})`,
      res.status,
      parsed ?? text,
    );
  }
  return parsed as T;
}

// ---- Jira ---------------------------------------------------------------

export type JiraIssueSummary = {
  id: string;
  key: string;
  fields: Record<string, unknown>;
};

export type JiraSearchResponse = {
  issues: JiraIssueSummary[];
  nextPageToken?: string;
  isLast?: boolean;
  /** Legacy field; some accounts still expose it. */
  total?: number;
};

export async function jiraSearch(
  creds: Credentials,
  params: {
    jql: string;
    fields?: string[];
    maxResults?: number;
    nextPageToken?: string;
  },
): Promise<JiraSearchResponse> {
  return await postJson("/api/jira/search", {
    jiraEmail: creds.jiraEmail,
    jiraToken: creds.jiraToken,
    jiraDomain: creds.jiraDomain,
    ...params,
  });
}

export type JiraIssue = {
  id: string;
  key: string;
  fields: Record<string, unknown>;
  /**
   * Mapping of field id (e.g. `customfield_10042`) → display name. Populated
   * when the request includes `expand=names`.
   */
  names?: Record<string, string>;
  changelog?: {
    histories: Array<{
      created: string;
      author?: { displayName?: string };
      items: Array<{
        field: string;
        fromString?: string | null;
        toString?: string | null;
      }>;
    }>;
  };
};

export async function jiraIssue(
  creds: Credentials,
  key: string,
  options: { fields?: string[]; expand?: string } = {},
): Promise<JiraIssue> {
  return await postJson(`/api/jira/issue/${encodeURIComponent(key)}`, {
    jiraEmail: creds.jiraEmail,
    jiraToken: creds.jiraToken,
    jiraDomain: creds.jiraDomain,
    fields: options.fields,
    expand: options.expand ?? "changelog",
  });
}

// ---- Anthropic ----------------------------------------------------------

export type AnthropicMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AnthropicResponse = {
  content?: Array<{ type: string; text?: string }>;
  error?: { type: string; message: string };
};

export async function anthropicMessages(
  creds: Credentials,
  args: {
    system?: string;
    messages: AnthropicMessage[];
    max_tokens?: number;
    model?: string;
  },
): Promise<AnthropicResponse> {
  return await postJson("/api/anthropic/messages", {
    anthropicKey: creds.anthropicKey,
    model: args.model ?? creds.anthropicModel,
    system: args.system,
    messages: args.messages,
    max_tokens: args.max_tokens ?? 1500,
  });
}

export function extractText(resp: AnthropicResponse): string {
  if (resp.error) {
    throw new ApiError(`Anthropic error: ${resp.error.message}`, 400, resp.error);
  }
  const parts = (resp.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string);
  return parts.join("");
}
