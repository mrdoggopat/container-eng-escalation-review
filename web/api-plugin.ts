import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Vite dev-server middleware that proxies requests to Jira Cloud and the
 * Anthropic Messages API. Credentials are supplied by the browser per request
 * and forwarded onward — no secrets are persisted on disk.
 *
 * Endpoints:
 *   POST /api/jira/search         body: { jiraEmail, jiraToken, jiraDomain, jql, fields?, maxResults?, nextPageToken? }
 *   POST /api/jira/issue/:key     body: { jiraEmail, jiraToken, jiraDomain, fields?, expand? }
 *   POST /api/anthropic/messages  body: { anthropicKey, model, system?, messages, max_tokens }
 */

async function readBody(req: IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function forwardJson(
  res: ServerResponse,
  url: string,
  init: RequestInit,
): Promise<void> {
  try {
    const upstream = await fetch(url, init);
    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader("Content-Type", "application/json");
    res.end(text || "{}");
  } catch (err) {
    send(res, 502, {
      error: "upstream_fetch_failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

function basicAuth(email: string, token: string): string {
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

async function handleJiraSearch(req: IncomingMessage, res: ServerResponse) {
  const body = JSON.parse((await readBody(req)) || "{}");
  const { jiraEmail, jiraToken, jiraDomain, jql, fields, maxResults, nextPageToken } =
    body;
  if (!jiraEmail || !jiraToken || !jiraDomain || !jql) {
    return send(res, 400, { error: "missing_jira_credentials_or_jql" });
  }
  await forwardJson(res, `https://${jiraDomain}/rest/api/3/search/jql`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(jiraEmail, jiraToken),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jql,
      fields: fields ?? ["summary", "status", "assignee", "reporter", "created", "resolutiondate"],
      maxResults: maxResults ?? 100,
      ...(nextPageToken ? { nextPageToken } : {}),
    }),
  });
}

async function handleJiraIssue(
  req: IncomingMessage,
  res: ServerResponse,
  key: string,
) {
  const body = JSON.parse((await readBody(req)) || "{}");
  const { jiraEmail, jiraToken, jiraDomain, fields, expand } = body;
  if (!jiraEmail || !jiraToken || !jiraDomain) {
    return send(res, 400, { error: "missing_jira_credentials" });
  }
  const params = new URLSearchParams();
  if (fields) params.set("fields", Array.isArray(fields) ? fields.join(",") : fields);
  if (expand) params.set("expand", expand);
  await forwardJson(
    res,
    `https://${jiraDomain}/rest/api/3/issue/${encodeURIComponent(key)}?${params.toString()}`,
    {
      method: "GET",
      headers: {
        Authorization: basicAuth(jiraEmail, jiraToken),
        Accept: "application/json",
      },
    },
  );
}

async function handleAnthropic(req: IncomingMessage, res: ServerResponse) {
  const body = JSON.parse((await readBody(req)) || "{}");
  const { anthropicKey, ...payload } = body;
  if (!anthropicKey) {
    return send(res, 400, { error: "missing_anthropic_key" });
  }
  await forwardJson(res, "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function apiPlugin(): Plugin {
  return {
    name: "cons-review-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        try {
          if (req.method === "POST" && url === "/api/jira/search") {
            return await handleJiraSearch(req, res);
          }
          const issueMatch = url.match(/^\/api\/jira\/issue\/([^/?]+)$/);
          if (req.method === "POST" && issueMatch) {
            return await handleJiraIssue(req, res, decodeURIComponent(issueMatch[1]));
          }
          if (req.method === "POST" && url === "/api/anthropic/messages") {
            return await handleAnthropic(req, res);
          }
          next();
        } catch (err) {
          send(res, 500, {
            error: "internal",
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      });
    },
  };
}
