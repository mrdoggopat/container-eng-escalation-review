import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Vite dev-server middleware that proxies requests to Jira Cloud, Confluence
 * Cloud, and the Anthropic Messages API. Credentials are supplied by the
 * browser per request and forwarded onward — no secrets are persisted on disk.
 *
 * Endpoints:
 *   POST /api/jira/search             body: { jiraEmail, jiraToken, jiraDomain, jql, fields?, maxResults?, nextPageToken? }
 *   POST /api/jira/issue/:key         body: { jiraEmail, jiraToken, jiraDomain, fields?, expand? }
 *   POST /api/anthropic/messages      body: { anthropicKey, model, system?, messages, max_tokens }
 *   POST /api/confluence/space        body: { jiraEmail, jiraToken, jiraDomain, query }
 *   POST /api/confluence/page-by-title  body: { jiraEmail, jiraToken, jiraDomain, spaceKey, title }
 *   POST /api/confluence/create-page  body: { jiraEmail, jiraToken, jiraDomain, spaceKey, title, parentId?, status?, storageBody }
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

// ---- Confluence -------------------------------------------------------

function requireAtlassian(body: Record<string, unknown>): {
  jiraEmail: string;
  jiraToken: string;
  jiraDomain: string;
} | null {
  const { jiraEmail, jiraToken, jiraDomain } = body;
  if (
    typeof jiraEmail !== "string" ||
    typeof jiraToken !== "string" ||
    typeof jiraDomain !== "string" ||
    !jiraEmail ||
    !jiraToken ||
    !jiraDomain
  ) {
    return null;
  }
  return { jiraEmail, jiraToken, jiraDomain };
}

/**
 * Look up a Confluence space by either its key (e.g. "CONT") or its display
 * name (e.g. "Containers TEE Team"). Key match wins; falls back to a
 * case-insensitive name match across the user's spaces.
 */
async function handleConfluenceSpace(req: IncomingMessage, res: ServerResponse) {
  const body = JSON.parse((await readBody(req)) || "{}");
  const auth = requireAtlassian(body);
  if (!auth) return send(res, 400, { error: "missing_jira_credentials" });
  const query = String(body.query ?? "").trim();
  if (!query) return send(res, 400, { error: "missing_query" });

  // Try direct key match first (cheap, single round-trip).
  const looksLikeKey = /^[A-Z0-9~_]+$/i.test(query) && query.length <= 50;
  if (looksLikeKey) {
    try {
      const url = `https://${auth.jiraDomain}/wiki/rest/api/space/${encodeURIComponent(query.toUpperCase())}`;
      const r = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: basicAuth(auth.jiraEmail, auth.jiraToken),
          Accept: "application/json",
        },
      });
      if (r.ok) {
        const data = (await r.json()) as {
          key: string;
          id: number | string;
          name: string;
        };
        return send(res, 200, {
          matched: "key",
          space: { key: data.key, id: String(data.id), name: data.name },
        });
      }
    } catch {
      // Fall through to name lookup.
    }
  }

  // Name lookup — pull spaces and filter client-side. limit=250 is the max.
  try {
    const url = `https://${auth.jiraDomain}/wiki/rest/api/space?type=global&limit=250`;
    const r = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: basicAuth(auth.jiraEmail, auth.jiraToken),
        Accept: "application/json",
      },
    });
    if (!r.ok) {
      const text = await r.text();
      return send(res, r.status, {
        error: "confluence_space_lookup_failed",
        detail: text,
      });
    }
    const data = (await r.json()) as {
      results: Array<{ key: string; id: number | string; name: string }>;
    };
    const wanted = query.toLowerCase();
    const exact = data.results.find((s) => s.name.toLowerCase() === wanted);
    const fuzzy = exact
      ? null
      : data.results.find((s) =>
          s.name.toLowerCase().includes(wanted),
        );
    const hit = exact ?? fuzzy;
    if (!hit) {
      return send(res, 404, {
        error: "confluence_space_not_found",
        detail: `No accessible Confluence space matches "${query}". Try the space key (e.g. CONT) instead.`,
      });
    }
    return send(res, 200, {
      matched: exact ? "name-exact" : "name-fuzzy",
      space: { key: hit.key, id: String(hit.id), name: hit.name },
    });
  } catch (err) {
    return send(res, 502, {
      error: "upstream_fetch_failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleConfluencePageByTitle(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const body = JSON.parse((await readBody(req)) || "{}");
  const auth = requireAtlassian(body);
  if (!auth) return send(res, 400, { error: "missing_jira_credentials" });
  const spaceKey = String(body.spaceKey ?? "").trim();
  const title = String(body.title ?? "").trim();
  if (!spaceKey || !title) {
    return send(res, 400, { error: "missing_space_or_title" });
  }
  const params = new URLSearchParams({
    spaceKey,
    title,
    type: "page",
    limit: "1",
  });
  try {
    const r = await fetch(
      `https://${auth.jiraDomain}/wiki/rest/api/content?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: basicAuth(auth.jiraEmail, auth.jiraToken),
          Accept: "application/json",
        },
      },
    );
    if (!r.ok) {
      const text = await r.text();
      return send(res, r.status, {
        error: "confluence_page_lookup_failed",
        detail: text,
      });
    }
    const data = (await r.json()) as {
      results: Array<{ id: string; title: string }>;
    };
    const hit = data.results[0];
    if (!hit) return send(res, 200, { page: null });
    return send(res, 200, { page: { id: hit.id, title: hit.title } });
  } catch (err) {
    return send(res, 502, {
      error: "upstream_fetch_failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleConfluenceCreatePage(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const body = JSON.parse((await readBody(req)) || "{}");
  const auth = requireAtlassian(body);
  if (!auth) return send(res, 400, { error: "missing_jira_credentials" });
  const spaceKey = String(body.spaceKey ?? "").trim();
  const title = String(body.title ?? "").trim();
  const storageBody = String(body.storageBody ?? "");
  const parentId =
    typeof body.parentId === "string" && body.parentId ? body.parentId : null;
  const status =
    body.status === "draft" || body.status === "current" ? body.status : "current";
  if (!spaceKey || !title || !storageBody) {
    return send(res, 400, {
      error: "missing_required_fields",
      detail: "spaceKey, title, and storageBody are required",
    });
  }

  const payload: Record<string, unknown> = {
    type: "page",
    title,
    space: { key: spaceKey },
    status,
    body: {
      storage: { value: storageBody, representation: "storage" },
    },
  };
  if (parentId) payload.ancestors = [{ id: parentId }];

  try {
    const r = await fetch(`https://${auth.jiraDomain}/wiki/rest/api/content`, {
      method: "POST",
      headers: {
        Authorization: basicAuth(auth.jiraEmail, auth.jiraToken),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    res.statusCode = r.status;
    res.setHeader("Content-Type", "application/json");
    res.end(text || "{}");
  } catch (err) {
    send(res, 502, {
      error: "upstream_fetch_failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
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
          if (req.method === "POST" && url === "/api/confluence/space") {
            return await handleConfluenceSpace(req, res);
          }
          if (req.method === "POST" && url === "/api/confluence/page-by-title") {
            return await handleConfluencePageByTitle(req, res);
          }
          if (req.method === "POST" && url === "/api/confluence/create-page") {
            return await handleConfluenceCreatePage(req, res);
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
