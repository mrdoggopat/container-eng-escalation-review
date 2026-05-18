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

/**
 * Thrown when the caller's `signal` aborts (cancel button or unmount). The
 * report generator catches this to short-circuit cleanly out of the loop
 * without surfacing a red error callout.
 */
export class GenerationCancelledError extends Error {
  constructor() {
    super("Report generation cancelled by user.");
    this.name = "GenerationCancelledError";
  }
}

/**
 * Per-request timeouts. Jira/proxy calls should be fast; Claude calls can take
 * a while for big prompts but still shouldn't hang forever. If any single call
 * exceeds these, something upstream is wrong and we surface it rather than
 * letting the spinner spin.
 */
const JIRA_TIMEOUT_MS = 30_000;
const ANTHROPIC_TIMEOUT_MS = 120_000;

function compositeSignal(
  userSignal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!userSignal) return timeoutSignal;
  return AbortSignal.any([userSignal, timeoutSignal]);
}

async function postJson<T>(
  url: string,
  body: unknown,
  opts: { signal?: AbortSignal; timeoutMs: number; kind: string },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: compositeSignal(opts.signal, opts.timeoutMs),
    });
  } catch (err) {
    if (opts.signal?.aborted) throw new GenerationCancelledError();
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ApiError(
        `${opts.kind} request timed out after ${opts.timeoutMs / 1000}s. The proxy may be down or the upstream is slow.`,
        408,
        { url, kind: opts.kind },
      );
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new GenerationCancelledError();
    }
    throw err;
  }
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
  signal?: AbortSignal,
): Promise<JiraSearchResponse> {
  return await postJson(
    "/api/jira/search",
    {
      jiraEmail: creds.jiraEmail,
      jiraToken: creds.jiraToken,
      jiraDomain: creds.jiraDomain,
      ...params,
    },
    { signal, timeoutMs: JIRA_TIMEOUT_MS, kind: "Jira search" },
  );
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
  signal?: AbortSignal,
): Promise<JiraIssue> {
  return await postJson(
    `/api/jira/issue/${encodeURIComponent(key)}`,
    {
      jiraEmail: creds.jiraEmail,
      jiraToken: creds.jiraToken,
      jiraDomain: creds.jiraDomain,
      fields: options.fields,
      expand: options.expand ?? "changelog",
    },
    { signal, timeoutMs: JIRA_TIMEOUT_MS, kind: `Jira issue ${key}` },
  );
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
  signal?: AbortSignal,
): Promise<AnthropicResponse> {
  return await postJson(
    "/api/anthropic/messages",
    {
      anthropicKey: creds.anthropicKey,
      model: args.model ?? creds.anthropicModel,
      system: args.system,
      messages: args.messages,
      max_tokens: args.max_tokens ?? 1500,
    },
    { signal, timeoutMs: ANTHROPIC_TIMEOUT_MS, kind: "Anthropic messages" },
  );
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
