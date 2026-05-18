import type { Credentials } from "./credentials";

export class ConfluenceError extends Error {
  status: number;
  detail: unknown;
  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.name = "ConfluenceError";
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Thrown when the caller's `signal` aborts (cancel button or unmount). Kept
 * distinct from `ConfluenceError` so the dialog can handle it differently
 * (suppress the red error callout, just return to the form).
 */
export class PublishCancelledError extends Error {
  constructor() {
    super("Publish cancelled by user.");
    this.name = "PublishCancelledError";
  }
}

/**
 * Per-request timeout for Confluence proxy calls. Kept short on purpose: any
 * single Confluence API call should complete in well under 10s under normal
 * conditions (space lookup, page-by-title search, page create). If it takes
 * longer than this, something upstream is wrong (dev proxy not running,
 * Confluence throttling, network) and we'd rather surface that fast than let
 * the user stare at a hung spinner.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

/**
 * Combines an optional caller-supplied AbortSignal with a per-request timeout
 * signal so a single hung fetch can't tie up the dialog forever. `AbortSignal.any`
 * is supported in Chrome 116+, Firefox 124+, Safari 17.4+ — i.e. anywhere this
 * app is run in 2026.
 */
function compositeSignal(
  userSignal?: AbortSignal,
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!userSignal) return timeoutSignal;
  return AbortSignal.any([userSignal, timeoutSignal]);
}

async function postJson<T>(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: compositeSignal(signal),
    });
  } catch (err) {
    // Distinguish user cancellation from timeouts vs. transport errors.
    if (signal?.aborted) throw new PublishCancelledError();
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ConfluenceError(
        `Confluence request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS / 1000}s. The proxy or Confluence may be slow or unreachable.`,
        408,
        { url },
      );
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new PublishCancelledError();
    }
    throw err;
  }
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const detail =
      parsed && typeof parsed === "object" && "detail" in parsed
        ? (parsed as { detail: unknown }).detail
        : parsed;
    throw new ConfluenceError(
      `Confluence request failed (${res.status})`,
      res.status,
      detail,
    );
  }
  return parsed as T;
}

function atlassianAuth(creds: Credentials) {
  return {
    jiraEmail: creds.jiraEmail,
    jiraToken: creds.jiraToken,
    jiraDomain: creds.jiraDomain,
  };
}

export type ConfluenceSpace = { key: string; id: string; name: string };

export async function findSpace(
  creds: Credentials,
  query: string,
  signal?: AbortSignal,
): Promise<ConfluenceSpace> {
  const res = await postJson<{
    matched: string;
    space: ConfluenceSpace;
  }>("/api/confluence/space", { ...atlassianAuth(creds), query }, signal);
  return res.space;
}

export async function findPageByTitle(
  creds: Credentials,
  spaceKey: string,
  title: string,
  signal?: AbortSignal,
): Promise<{ id: string; title: string } | null> {
  const res = await postJson<{ page: { id: string; title: string } | null }>(
    "/api/confluence/page-by-title",
    { ...atlassianAuth(creds), spaceKey, title },
    signal,
  );
  return res.page;
}

/**
 * Look up a Confluence folder by title within a space. Folders are a separate
 * content type from pages; the proxy uses CQL (`type=folder`) under the hood.
 */
export async function findFolderByTitle(
  creds: Credentials,
  spaceKey: string,
  title: string,
  signal?: AbortSignal,
): Promise<{ id: string; title: string } | null> {
  const res = await postJson<{ folder: { id: string; title: string } | null }>(
    "/api/confluence/folder-by-title",
    { ...atlassianAuth(creds), spaceKey, title },
    signal,
  );
  return res.folder;
}

/**
 * Resolve a parent ancestor by title — checks pages first (most common case),
 * then folders. Confluence accepts either as an `ancestors` entry on create,
 * so the resulting `id` can be passed straight to `createPage`.
 */
export type ParentAncestor = {
  id: string;
  title: string;
  type: "page" | "folder";
};

export async function findParentByTitle(
  creds: Credentials,
  space: { key: string; id: string },
  title: string,
  signal?: AbortSignal,
): Promise<ParentAncestor | null> {
  const page = await findPageByTitle(creds, space.key, title, signal);
  if (page) return { id: page.id, title: page.title, type: "page" };
  try {
    const folder = await findFolderByTitle(creds, space.key, title, signal);
    if (folder) return { id: folder.id, title: folder.title, type: "folder" };
  } catch (err) {
    // CQL-based folder search is well-supported on Confluence Cloud, but
    // don't fail the whole publish if a permissions edge-case trips it.
    if (err instanceof PublishCancelledError) throw err;
    console.warn("[confluence] folder lookup failed:", err);
  }
  return null;
}

export type CreatePageResult = {
  id: string;
  title: string;
  status: string;
  webUrl: string;
};

export async function createPage(
  creds: Credentials,
  args: {
    spaceKey: string;
    title: string;
    parentId?: string | null;
    status?: "current" | "draft";
    storageBody: string;
  },
  signal?: AbortSignal,
): Promise<CreatePageResult> {
  type ConfluenceCreateResponse = {
    id: string;
    title: string;
    status: string;
    _links?: { base?: string; webui?: string; tinyui?: string };
  };
  const data = await postJson<ConfluenceCreateResponse>(
    "/api/confluence/create-page",
    { ...atlassianAuth(creds), ...args },
    signal,
  );
  const base = data._links?.base ?? `https://${creds.jiraDomain}/wiki`;
  const path = data._links?.webui ?? "";
  return {
    id: data.id,
    title: data.title,
    status: data.status,
    webUrl: path ? `${base}${path}` : base,
  };
}

export type PublishStep =
  | "resolve-space"
  | "resolve-parent"
  | "check-duplicate"
  | "create-page"
  | "done";

export type PublishProgress = {
  step: PublishStep;
  message: string;
  /** Optional secondary detail line — e.g. resolved space key, page URL. */
  detail?: string;
};

export type PublishOptions = {
  spaceQuery: string; // user-provided space name or key
  parentPageTitle: string | null; // optional parent page exact title
  title: string; // page title
  status: "current" | "draft";
  storageBody: string;
};

export async function publishReport(
  creds: Credentials,
  opts: PublishOptions,
  onProgress: (p: PublishProgress) => void,
  signal?: AbortSignal,
): Promise<CreatePageResult> {
  function checkCancel() {
    if (signal?.aborted) throw new PublishCancelledError();
  }

  onProgress({
    step: "resolve-space",
    message: `Looking up Confluence space "${opts.spaceQuery}"…`,
    detail:
      "Matches by exact key first, then by name across spaces you have access to.",
  });
  checkCancel();
  const space = await findSpace(creds, opts.spaceQuery, signal);
  onProgress({
    step: "resolve-space",
    message: `Found space ${space.name}`,
    detail: `key: ${space.key} · id: ${space.id}`,
  });

  let parentId: string | null = null;
  if (opts.parentPageTitle) {
    onProgress({
      step: "resolve-parent",
      message: `Finding parent "${opts.parentPageTitle}"`,
      detail: `Searching pages then folders within space ${space.name} (${space.key})…`,
    });
    checkCancel();
    const parent = await findParentByTitle(
      creds,
      { key: space.key, id: space.id },
      opts.parentPageTitle,
      signal,
    );
    if (!parent) {
      throw new ConfluenceError(
        `Couldn't find parent "${opts.parentPageTitle}" (as page or folder) in space "${space.name}".`,
        404,
        { spaceKey: space.key, title: opts.parentPageTitle },
      );
    }
    parentId = parent.id;
    onProgress({
      step: "resolve-parent",
      message: `Parent ${parent.type} resolved`,
      detail: `"${parent.title}" · ${parent.type} · id: ${parent.id}`,
    });
  } else {
    onProgress({
      step: "resolve-parent",
      message: "No parent page specified",
      detail: "Page will be created at the space root.",
    });
  }

  onProgress({
    step: "check-duplicate",
    message: `Checking for an existing page named "${opts.title}"…`,
    detail: "Confluence rejects duplicate titles in the same space.",
  });
  checkCancel();
  const existing = await findPageByTitle(creds, space.key, opts.title, signal);
  if (existing) {
    throw new ConfluenceError(
      `A page titled "${opts.title}" already exists in ${space.name}. Pick a different title.`,
      409,
      { spaceKey: space.key, existingId: existing.id },
    );
  }
  onProgress({
    step: "check-duplicate",
    message: "Title is available",
    detail: "No existing page conflict.",
  });

  onProgress({
    step: "create-page",
    message:
      opts.status === "draft"
        ? `Creating draft page "${opts.title}" in ${space.name}…`
        : `Publishing page "${opts.title}" to ${space.name}…`,
    detail: `${(opts.storageBody.length / 1024).toFixed(1)} KiB of Confluence storage XML being POSTed.`,
  });
  checkCancel();
  const result = await createPage(
    creds,
    {
      spaceKey: space.key,
      title: opts.title,
      parentId,
      status: opts.status,
      storageBody: opts.storageBody,
    },
    signal,
  );
  onProgress({
    step: "done",
    message: `Page ${result.status === "draft" ? "drafted" : "published"}`,
    detail: result.webUrl,
  });
  return result;
}
