import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Vite dev-server middleware that proxies requests to Jira Cloud, Confluence
 * Cloud, and the Anthropic Messages API. Credentials are supplied by the
 * browser per request and forwarded onward — no secrets are persisted on disk.
 *
 * Endpoints:
 *   POST /api/jira/search                 body: { jiraEmail, jiraToken, jiraDomain, jql, fields?, maxResults?, nextPageToken? }
 *   POST /api/jira/issue/:key             body: { jiraEmail, jiraToken, jiraDomain, fields?, expand? }
 *   POST /api/anthropic/messages          body: { anthropicKey, model, system?, messages, max_tokens }
 *   POST /api/confluence/space            body: { jiraEmail, jiraToken, jiraDomain, query }
 *   POST /api/confluence/page-by-title    body: { jiraEmail, jiraToken, jiraDomain, spaceKey, title }
 *   POST /api/confluence/folder-by-title  body: { jiraEmail, jiraToken, jiraDomain, spaceKey, title }
 *   POST /api/confluence/create-page      body: { jiraEmail, jiraToken, jiraDomain, spaceKey, title, parentId?, status?, storageBody }
 */

// ---------------------------------------------------------------------------
// Low-level HTTP helpers
// ---------------------------------------------------------------------------

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

/** Default per-call timeouts for upstream proxy fetches. */
const JIRA_TIMEOUT_MS = 30_000;
const CONFLUENCE_TIMEOUT_MS = 30_000;
const ANTHROPIC_TIMEOUT_MS = 120_000;

/**
 * Returns an AbortSignal that fires when either (a) the upstream call exceeds
 * `timeoutMs`, or (b) the browser disconnects mid-flight (so a user clicking
 * Cancel in the dialog tears down the upstream fetch too, instead of letting
 * Node hold the socket open after Atlassian/Anthropic stops responding).
 */
function upstreamSignal(req: IncomingMessage, timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const onClientGone = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  req.on("close", onClientGone);
  req.on("aborted", onClientGone);
  return AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
}

/**
 * Translate a thrown error from `fetch` into a HTTP status + JSON body. Timeout
 * → 504, client disconnect → 499 (nginx convention), everything else → 502.
 */
function classifyFetchError(err: unknown, timeoutMs: number): {
  status: number;
  body: { error: string; detail: string };
} {
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return {
      status: 504,
      body: {
        error: "upstream_timeout",
        detail: `Upstream did not respond within ${timeoutMs / 1000}s.`,
      },
    };
  }
  if (err instanceof DOMException && err.name === "AbortError") {
    return {
      status: 499,
      body: {
        error: "client_disconnected",
        detail: "Browser disconnected before upstream responded.",
      },
    };
  }
  return {
    status: 502,
    body: {
      error: "upstream_fetch_failed",
      detail: err instanceof Error ? err.message : String(err),
    },
  };
}

/**
 * Proxy a single upstream JSON request: forward the response body verbatim,
 * preserving the upstream status code. Used for endpoints where we just want
 * to be a transparent pass-through (Jira search, Jira issue, Anthropic, and
 * Confluence create-page).
 */
async function forwardJson(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<void> {
  try {
    const upstream = await fetch(url, {
      ...init,
      signal: upstreamSignal(req, timeoutMs),
    });
    const text = await upstream.text();
    if (res.writableEnded) return;
    res.statusCode = upstream.status;
    res.setHeader("Content-Type", "application/json");
    res.end(text || "{}");
  } catch (err) {
    if (res.writableEnded) return;
    const { status, body } = classifyFetchError(err, timeoutMs);
    send(res, status, body);
  }
}

function basicAuth(email: string, token: string): string {
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

// ---------------------------------------------------------------------------
// Atlassian request validation
// ---------------------------------------------------------------------------

type AtlassianAuth = {
  jiraEmail: string;
  jiraToken: string;
  jiraDomain: string;
};

function requireAtlassian(body: Record<string, unknown>): AtlassianAuth | null {
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
 * Parse the JSON body and confirm Atlassian credentials are present. Sends a
 * 400 response and returns `null` on validation failure, so handlers can early
 * return without repeating the same boilerplate.
 */
async function readAtlassianRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<{ body: Record<string, unknown>; auth: AtlassianAuth } | null> {
  const body = JSON.parse((await readBody(req)) || "{}") as Record<string, unknown>;
  const auth = requireAtlassian(body);
  if (!auth) {
    send(res, 400, { error: "missing_jira_credentials" });
    return null;
  }
  return { body, auth };
}

// ---------------------------------------------------------------------------
// Confluence fetch helper
// ---------------------------------------------------------------------------

/**
 * Outcome of a `confluenceFetch` call:
 *  - `ok: true`  → upstream responded 2xx; parsed JSON in `data`.
 *  - `ok: false` → either upstream returned an HTTP error (status copied
 *                  through, body wraps `detail` with the raw text), or the
 *                  fetch itself failed (timeout / disconnect / transport).
 *
 * Either way, status codes 499 (client disconnected) and 504 (upstream
 * timeout) signal "don't bother retrying or falling back" — callers use those
 * to bail rather than try alternative lookups.
 */
type ConfluenceFetchOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; body: { error: string; detail: string } };

/**
 * Authenticated fetch against `https://<jiraDomain><path>` with Confluence's
 * standard JSON conventions baked in: basic auth, JSON content type when a
 * body is supplied, the shared upstream timeout signal, and parsed JSON or a
 * structured error on failure.
 */
async function confluenceFetch<T>(
  req: IncomingMessage,
  auth: AtlassianAuth,
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: string;
    errorTag: string;
  },
): Promise<ConfluenceFetchOutcome<T>> {
  try {
    const r = await fetch(`https://${auth.jiraDomain}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: basicAuth(auth.jiraEmail, auth.jiraToken),
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body,
      signal: upstreamSignal(req, CONFLUENCE_TIMEOUT_MS),
    });
    if (!r.ok) {
      return {
        ok: false,
        status: r.status,
        body: { error: options.errorTag, detail: await r.text() },
      };
    }
    return { ok: true, data: (await r.json()) as T };
  } catch (err) {
    const { status, body } = classifyFetchError(err, CONFLUENCE_TIMEOUT_MS);
    return { ok: false, status, body };
  }
}

// ---------------------------------------------------------------------------
// Jira handlers
// ---------------------------------------------------------------------------

async function handleJiraSearch(req: IncomingMessage, res: ServerResponse) {
  const body = JSON.parse((await readBody(req)) || "{}");
  const { jiraEmail, jiraToken, jiraDomain, jql, fields, maxResults, nextPageToken } =
    body;
  if (!jiraEmail || !jiraToken || !jiraDomain || !jql) {
    return send(res, 400, { error: "missing_jira_credentials_or_jql" });
  }
  await forwardJson(
    req,
    res,
    `https://${jiraDomain}/rest/api/3/search/jql`,
    {
      method: "POST",
      headers: {
        Authorization: basicAuth(jiraEmail, jiraToken),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jql,
        fields:
          fields ??
          ["summary", "status", "assignee", "reporter", "created", "resolutiondate"],
        maxResults: maxResults ?? 100,
        ...(nextPageToken ? { nextPageToken } : {}),
      }),
    },
    JIRA_TIMEOUT_MS,
  );
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
    req,
    res,
    `https://${jiraDomain}/rest/api/3/issue/${encodeURIComponent(key)}?${params.toString()}`,
    {
      method: "GET",
      headers: {
        Authorization: basicAuth(jiraEmail, jiraToken),
        Accept: "application/json",
      },
    },
    JIRA_TIMEOUT_MS,
  );
}

// ---------------------------------------------------------------------------
// Confluence handlers
// ---------------------------------------------------------------------------

/**
 * Look up a Confluence space by either its key (e.g. "CONT") or its display
 * name (e.g. "Containers TEE Team"). Strategy:
 *
 *   1. If the query looks like a key (uppercase letters / digits), try the
 *      direct `/space/{key}` endpoint — it's cheap, one round-trip.
 *   2. Otherwise, or if the key lookup didn't find anything, list all global
 *      spaces and filter client-side, preferring an exact name match before
 *      falling back to a case-insensitive substring match.
 *
 * Only bail out of the key-match step on timeout / client-disconnect — for
 * ordinary HTTP errors (e.g. 404), we fall through to the name lookup since
 * "key didn't match" is one of the expected outcomes.
 */
async function handleConfluenceSpace(req: IncomingMessage, res: ServerResponse) {
  const parsed = await readAtlassianRequest(req, res);
  if (!parsed) return;
  const { body, auth } = parsed;
  const query = String(body.query ?? "").trim();
  if (!query) return send(res, 400, { error: "missing_query" });

  // Step 1: direct key match (only if the query plausibly looks like a key).
  const looksLikeKey = /^[A-Z0-9~_]+$/i.test(query) && query.length <= 50;
  if (looksLikeKey) {
    const keyHit = await confluenceFetch<{
      key: string;
      id: number | string;
      name: string;
    }>(req, auth, `/wiki/rest/api/space/${encodeURIComponent(query.toUpperCase())}`, {
      errorTag: "confluence_space_key_lookup_failed",
    });
    if (keyHit.ok) {
      return send(res, 200, {
        matched: "key",
        space: {
          key: keyHit.data.key,
          id: String(keyHit.data.id),
          name: keyHit.data.name,
        },
      });
    }
    // Bail only when there's no point retrying (timeout / client disconnect).
    if (keyHit.status === 504 || keyHit.status === 499) {
      return send(res, keyHit.status, keyHit.body);
    }
    // Any other failure (404, transport glitch, etc.) → fall through to name lookup.
  }

  // Step 2: name lookup. `limit=250` is the maximum the v1 REST API allows.
  const listHit = await confluenceFetch<{
    results: Array<{ key: string; id: number | string; name: string }>;
  }>(req, auth, `/wiki/rest/api/space?type=global&limit=250`, {
    errorTag: "confluence_space_lookup_failed",
  });
  if (!listHit.ok) return send(res, listHit.status, listHit.body);

  const wanted = query.toLowerCase();
  const exact = listHit.data.results.find((s) => s.name.toLowerCase() === wanted);
  const fuzzy = exact
    ? null
    : listHit.data.results.find((s) => s.name.toLowerCase().includes(wanted));
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
}

async function handleConfluencePageByTitle(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const parsed = await readAtlassianRequest(req, res);
  if (!parsed) return;
  const { body, auth } = parsed;
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
  const result = await confluenceFetch<{
    results: Array<{ id: string; title: string }>;
  }>(req, auth, `/wiki/rest/api/content?${params.toString()}`, {
    errorTag: "confluence_page_lookup_failed",
  });
  if (!result.ok) return send(res, result.status, result.body);
  const hit = result.data.results[0];
  return send(res, 200, hit ? { page: { id: hit.id, title: hit.title } } : { page: null });
}

/**
 * Look up a Confluence folder by title within a given space. Folders are a
 * separate content type from pages in Confluence Cloud, and the v2 REST API
 * doesn't expose a list-by-space endpoint for them. We instead use the v1
 * CQL search endpoint, which explicitly supports `type=folder`. CQL also
 * matches case-insensitively on title, so the lookup is robust to casing.
 *
 * Folders are valid `ancestors` when creating a page, so the resulting id can
 * be passed straight to `createPage`.
 */
async function handleConfluenceFolderByTitle(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const parsed = await readAtlassianRequest(req, res);
  if (!parsed) return;
  const { body, auth } = parsed;
  const spaceKey = String(body.spaceKey ?? "").trim();
  const title = String(body.title ?? "").trim();
  if (!spaceKey || !title) {
    return send(res, 400, {
      error: "missing_space_key_or_title",
      detail: "spaceKey and title are required.",
    });
  }
  // CQL string literals use double quotes; escape any quotes in the title.
  const escapedTitle = title.replace(/"/g, '\\"');
  const cql = `space = "${spaceKey}" AND type = "folder" AND title = "${escapedTitle}"`;
  const params = new URLSearchParams({ cql, limit: "5" });
  const result = await confluenceFetch<{
    results: Array<{ id: string; title: string; type?: string }>;
  }>(req, auth, `/wiki/rest/api/content/search?${params.toString()}`, {
    errorTag: "confluence_folder_lookup_failed",
  });
  if (!result.ok) return send(res, result.status, result.body);
  // Prefer an exact-case match if multiple folders share the title (rare).
  const exact = result.data.results.find((f) => f.title === title);
  const hit = exact ?? result.data.results[0];
  return send(
    res,
    200,
    hit ? { folder: { id: String(hit.id), title: hit.title } } : { folder: null },
  );
}

async function handleConfluenceCreatePage(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const parsed = await readAtlassianRequest(req, res);
  if (!parsed) return;
  const { body, auth } = parsed;
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

  await forwardJson(
    req,
    res,
    `https://${auth.jiraDomain}/wiki/rest/api/content`,
    {
      method: "POST",
      headers: {
        Authorization: basicAuth(auth.jiraEmail, auth.jiraToken),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    CONFLUENCE_TIMEOUT_MS,
  );
}

// ---------------------------------------------------------------------------
// Anthropic handler
// ---------------------------------------------------------------------------

async function handleAnthropic(req: IncomingMessage, res: ServerResponse) {
  const body = JSON.parse((await readBody(req)) || "{}");
  const { anthropicKey, ...payload } = body;
  if (!anthropicKey) {
    return send(res, 400, { error: "missing_anthropic_key" });
  }
  await forwardJson(
    req,
    res,
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    },
    ANTHROPIC_TIMEOUT_MS,
  );
}

// ---------------------------------------------------------------------------
// Plugin / route dispatch
// ---------------------------------------------------------------------------

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/** Static POST routes — exact-match URL → handler. */
const POST_ROUTES: Record<string, RouteHandler> = {
  "/api/jira/search": handleJiraSearch,
  "/api/anthropic/messages": handleAnthropic,
  "/api/confluence/space": handleConfluenceSpace,
  "/api/confluence/page-by-title": handleConfluencePageByTitle,
  "/api/confluence/folder-by-title": handleConfluenceFolderByTitle,
  "/api/confluence/create-page": handleConfluenceCreatePage,
};

/** Parameterized POST route: `/api/jira/issue/:key`. */
const ISSUE_ROUTE = /^\/api\/jira\/issue\/([^/?]+)$/;

export function apiPlugin(): Plugin {
  return {
    name: "cons-review-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        if (req.method !== "POST") return next();
        try {
          const exactHandler = POST_ROUTES[url];
          if (exactHandler) return await exactHandler(req, res);

          const issueMatch = url.match(ISSUE_ROUTE);
          if (issueMatch) {
            return await handleJiraIssue(req, res, decodeURIComponent(issueMatch[1]));
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
