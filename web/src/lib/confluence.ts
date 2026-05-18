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
): Promise<ConfluenceSpace> {
  const res = await postJson<{
    matched: string;
    space: ConfluenceSpace;
  }>("/api/confluence/space", { ...atlassianAuth(creds), query });
  return res.space;
}

export async function findPageByTitle(
  creds: Credentials,
  spaceKey: string,
  title: string,
): Promise<{ id: string; title: string } | null> {
  const res = await postJson<{ page: { id: string; title: string } | null }>(
    "/api/confluence/page-by-title",
    { ...atlassianAuth(creds), spaceKey, title },
  );
  return res.page;
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
  | "create-page";

export type PublishProgress = {
  step: PublishStep;
  message: string;
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
): Promise<CreatePageResult> {
  onProgress({
    step: "resolve-space",
    message: `Looking up Confluence space "${opts.spaceQuery}"…`,
  });
  const space = await findSpace(creds, opts.spaceQuery);

  let parentId: string | null = null;
  if (opts.parentPageTitle) {
    onProgress({
      step: "resolve-parent",
      message: `Finding parent page "${opts.parentPageTitle}" in ${space.name}…`,
    });
    const parent = await findPageByTitle(creds, space.key, opts.parentPageTitle);
    if (!parent) {
      throw new ConfluenceError(
        `Couldn't find parent page "${opts.parentPageTitle}" in space "${space.name}".`,
        404,
        { spaceKey: space.key, title: opts.parentPageTitle },
      );
    }
    parentId = parent.id;
  }

  onProgress({
    step: "check-duplicate",
    message: `Checking for an existing page named "${opts.title}"…`,
  });
  const existing = await findPageByTitle(creds, space.key, opts.title);
  if (existing) {
    throw new ConfluenceError(
      `A page titled "${opts.title}" already exists in ${space.name}. Pick a different title.`,
      409,
      { spaceKey: space.key, existingId: existing.id },
    );
  }

  onProgress({
    step: "create-page",
    message:
      opts.status === "draft"
        ? "Creating draft page in Confluence…"
        : "Publishing page in Confluence…",
  });
  return await createPage(creds, {
    spaceKey: space.key,
    title: opts.title,
    parentId,
    status: opts.status,
    storageBody: opts.storageBody,
  });
}
