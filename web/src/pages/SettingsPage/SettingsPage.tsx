import { useState } from "react";
import {
  DEFAULT_CREDENTIALS,
  hasCompleteCredentials,
  hasDefaultTeamConfig,
  type Credentials,
} from "../../lib/credentials";
import "./SettingsPage.css";

function listToText(list: string[]): string {
  return list.join("\n");
}

function textToList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

type ModelOption = { id: string; label: string; hint: string };

const MODEL_OPTIONS: ModelOption[] = [
  {
    id: "claude-opus-4-5",
    label: "Opus 4.5",
    hint: "Most capable, slowest, highest cost",
  },
  {
    id: "claude-sonnet-4-5",
    label: "Sonnet 4.5",
    hint: "Balanced quality and speed — recommended",
  },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    hint: "Fastest, lowest cost",
  },
];

const CUSTOM_MODEL_VALUE = "__custom__";

type Tab = "credentials" | "team";

export function SettingsPage({
  initial,
  isOnboarding,
  initialTab = "credentials",
  onSave,
  onCancel,
}: {
  initial: Credentials;
  /** True when the user has no working credentials yet (first-launch flow). */
  isOnboarding: boolean;
  /** Which tab to open first when this page mounts. */
  initialTab?: Tab;
  onSave: (creds: Credentials) => void;
  /** Only shown when the user is editing existing settings, not onboarding. */
  onCancel?: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [creds, setCreds] = useState<Credentials>(initial);
  const [columnsText, setColumnsText] = useState<string>(
    listToText(initial.escalationColumns),
  );
  const [resolvedStatusesText, setResolvedStatusesText] = useState<string>(
    listToText(initial.resolvedStatuses),
  );
  const [teeMembersText, setTeeMembersText] = useState<string>(
    listToText(initial.teeMembers),
  );
  const [teamContextUrlsText, setTeamContextUrlsText] = useState<string>(
    listToText(initial.teamContextUrls),
  );
  const isKnownModel = (id: string) => MODEL_OPTIONS.some((o) => o.id === id);
  const [useCustomModel, setUseCustomModel] = useState<boolean>(
    () => !!initial.anthropicModel && !isKnownModel(initial.anthropicModel),
  );
  const teamOverridden = !hasDefaultTeamConfig(initial);

  function update<K extends keyof Credentials>(key: K, value: Credentials[K]) {
    setCreds((c) => ({ ...c, [key]: value }));
  }

  function buildSaved(): Credentials {
    return {
      ...creds,
      escalationColumns: textToList(columnsText),
      resolvedStatuses: textToList(resolvedStatusesText),
      teeMembers: textToList(teeMembersText),
      teamContextUrls: textToList(teamContextUrlsText),
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!complete) return;
    onSave(buildSaved());
  }

  function resetTeamDefaults() {
    update("projectKey", DEFAULT_CREDENTIALS.projectKey);
    setColumnsText(listToText(DEFAULT_CREDENTIALS.escalationColumns));
    setResolvedStatusesText(listToText(DEFAULT_CREDENTIALS.resolvedStatuses));
    setTeeMembersText(listToText(DEFAULT_CREDENTIALS.teeMembers));
    setCreds((c) => ({
      ...c,
      investigationFieldNames: DEFAULT_CREDENTIALS.investigationFieldNames,
      confluenceSpace: DEFAULT_CREDENTIALS.confluenceSpace,
      confluenceParentPage: DEFAULT_CREDENTIALS.confluenceParentPage,
    }));
    setTeamContextUrlsText(listToText(DEFAULT_CREDENTIALS.teamContextUrls));
  }

  const complete = hasCompleteCredentials(buildSaved());

  return (
    <form className="credentials-page settings-page" onSubmit={handleSubmit}>
      <header className="credentials-header">
        <h1>{isOnboarding ? "Connect Jira and Anthropic" : "Settings"}</h1>
        <p className="credentials-intro">
          {isOnboarding
            ? "We need two credentials to fetch escalations and analyze them. They stay in your browser's localStorage — each request is proxied to Jira and Anthropic locally; nothing is written to disk."
            : "All settings stay in your browser's localStorage. Each request forwards them to Jira and Anthropic through the local dev proxy — nothing is written to disk on the server."}
        </p>
      </header>

      <div className="settings-tabs" role="tablist" aria-label="Settings tabs">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "credentials"}
          className={`settings-tab${tab === "credentials" ? " active" : ""}`}
          onClick={() => setTab("credentials")}
        >
          Credentials
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "team"}
          className={`settings-tab${tab === "team" ? " active" : ""}`}
          onClick={() => setTab("team")}
        >
          Team configuration
          {teamOverridden ? (
            <span className="settings-tab-badge" aria-label="overridden">
              ●
            </span>
          ) : null}
        </button>
      </div>

      {tab === "credentials" ? (
        <CredentialsTab
          creds={creds}
          update={update}
          useCustomModel={useCustomModel}
          setUseCustomModel={setUseCustomModel}
          isKnownModel={isKnownModel}
        />
      ) : (
        <TeamConfigTab
          creds={creds}
          update={update}
          columnsText={columnsText}
          setColumnsText={setColumnsText}
          resolvedStatusesText={resolvedStatusesText}
          setResolvedStatusesText={setResolvedStatusesText}
          teeMembersText={teeMembersText}
          setTeeMembersText={setTeeMembersText}
          teamContextUrlsText={teamContextUrlsText}
          setTeamContextUrlsText={setTeamContextUrlsText}
          resetTeamDefaults={resetTeamDefaults}
          teamOverridden={teamOverridden}
          isOnboarding={isOnboarding}
        />
      )}

      <footer className="credentials-actions">
        {onCancel && !isOnboarding ? (
          <button type="button" className="ghost-button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button type="submit" className="primary-button" disabled={!complete}>
          {isOnboarding ? "Continue →" : "Save"}
        </button>
      </footer>
    </form>
  );
}

function CredentialsTab({
  creds,
  update,
  useCustomModel,
  setUseCustomModel,
  isKnownModel,
}: {
  creds: Credentials;
  update: <K extends keyof Credentials>(key: K, value: Credentials[K]) => void;
  useCustomModel: boolean;
  setUseCustomModel: (v: boolean) => void;
  isKnownModel: (id: string) => boolean;
}) {
  return (
    <>
      <section className="credentials-section">
        <h3 className="section-title">Jira</h3>
        <div className="field-grid">
          <label className="field">
            <span>Atlassian email</span>
            <input
              type="email"
              autoComplete="username"
              value={creds.jiraEmail}
              onChange={(e) => update("jiraEmail", e.target.value)}
              placeholder="name@example.com"
            />
          </label>
          <label className="field">
            <span>
              API token{" "}
              <a
                href="https://id.atlassian.com/manage-profile/security/api-tokens"
                target="_blank"
                rel="noreferrer"
              >
                (create one)
              </a>
            </span>
            <input
              type="password"
              autoComplete="current-password"
              value={creds.jiraToken}
              onChange={(e) => update("jiraToken", e.target.value)}
              placeholder="ATATT3xFfGF0..."
            />
          </label>
          <label className="field full-row">
            <span>Atlassian domain</span>
            <input
              type="text"
              value={creds.jiraDomain}
              onChange={(e) => update("jiraDomain", e.target.value.trim())}
              placeholder="datadoghq.atlassian.net"
            />
          </label>
        </div>
      </section>

      <section className="credentials-section">
        <h3 className="section-title">Anthropic</h3>
        <div className="field-grid">
          <label className="field">
            <span>
              API key{" "}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noreferrer"
              >
                (get one)
              </a>
            </span>
            <input
              type="password"
              autoComplete="off"
              value={creds.anthropicKey}
              onChange={(e) => update("anthropicKey", e.target.value)}
              placeholder="sk-ant-..."
            />
          </label>
          <label className="field">
            <span>Model</span>
            <select
              value={useCustomModel ? CUSTOM_MODEL_VALUE : creds.anthropicModel}
              onChange={(e) => {
                const v = e.target.value;
                if (v === CUSTOM_MODEL_VALUE) {
                  setUseCustomModel(true);
                  if (isKnownModel(creds.anthropicModel)) {
                    update("anthropicModel", "");
                  }
                } else {
                  setUseCustomModel(false);
                  update("anthropicModel", v);
                }
              }}
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label} — {opt.hint}
                </option>
              ))}
              <option value={CUSTOM_MODEL_VALUE}>Custom model ID…</option>
            </select>
            {useCustomModel ? (
              <input
                type="text"
                className="field-secondary-input"
                value={creds.anthropicModel}
                onChange={(e) => update("anthropicModel", e.target.value.trim())}
                placeholder={DEFAULT_CREDENTIALS.anthropicModel}
                aria-label="Custom Anthropic model id"
                autoFocus
              />
            ) : null}
          </label>
        </div>
      </section>
    </>
  );
}

function TeamConfigTab({
  creds,
  update,
  columnsText,
  setColumnsText,
  resolvedStatusesText,
  setResolvedStatusesText,
  teeMembersText,
  setTeeMembersText,
  teamContextUrlsText,
  setTeamContextUrlsText,
  resetTeamDefaults,
  teamOverridden,
  isOnboarding,
}: {
  creds: Credentials;
  update: <K extends keyof Credentials>(key: K, value: Credentials[K]) => void;
  columnsText: string;
  setColumnsText: (v: string) => void;
  resolvedStatusesText: string;
  setResolvedStatusesText: (v: string) => void;
  teeMembersText: string;
  setTeeMembersText: (v: string) => void;
  teamContextUrlsText: string;
  setTeamContextUrlsText: (v: string) => void;
  resetTeamDefaults: () => void;
  teamOverridden: boolean;
  isOnboarding: boolean;
}) {
  return (
    <section className="credentials-section settings-team-section">
      <p className="muted small">
        {isOnboarding
          ? "Defaults are wired for the Datadog Containers (CONS) workflow. You can keep these defaults and adjust them later, or override them now if you're running this for a different project."
          : `These values control how the app reads Jira data and judges preventability. ${teamOverridden ? "You've overridden the CONS defaults." : "Currently using the CONS defaults."}`}
      </p>

      <label className="field">
        <span>Jira project key</span>
        <input
          type="text"
          value={creds.projectKey}
          onChange={(e) => update("projectKey", e.target.value.trim())}
          placeholder={DEFAULT_CREDENTIALS.projectKey}
        />
      </label>

      <label className="field">
        <span>
          Escalation columns — one per line. A card counts as "escalated" when its
          status history transitions into any of these.
        </span>
        <textarea
          value={columnsText}
          onChange={(e) => setColumnsText(e.target.value)}
          rows={4}
          placeholder={DEFAULT_CREDENTIALS.escalationColumns.join("\n")}
          spellCheck={false}
        />
      </label>

      <label className="field">
        <span>
          Resolved statuses (optional override) — one per line. Leave empty (the
          default) to filter via Jira's <code>statusCategory = Done</code> taxonomy,
          which catches every terminal status (Done, Closed, Resolved, Archive,
          "Done (ZD Automation)", etc.) across any workflow. Add specific names
          only if you want to narrow further — e.g. include Done but not Archive.
        </span>
        <textarea
          value={resolvedStatusesText}
          onChange={(e) => setResolvedStatusesText(e.target.value)}
          rows={2}
          placeholder="(empty — uses statusCategory = Done)"
          spellCheck={false}
        />
      </label>

      <label className="field">
        <span>
          Internal team roster — one per line. Comments from these people (or the
          card's Reporter) do NOT count as external for the preventability rule.
        </span>
        <textarea
          value={teeMembersText}
          onChange={(e) => setTeeMembersText(e.target.value)}
          rows={5}
          placeholder={DEFAULT_CREDENTIALS.teeMembers.join("\n")}
          spellCheck={false}
        />
      </label>

      <label className="field">
        <span>
          Team context URLs — one per line. Passed to Claude as a reference for who's
          "internal" to the broader team (e.g. Confluence team spaces) when judging
          whether commenter involvement was external.
        </span>
        <textarea
          value={teamContextUrlsText}
          onChange={(e) => setTeamContextUrlsText(e.target.value)}
          rows={5}
          placeholder={DEFAULT_CREDENTIALS.teamContextUrls.join("\n")}
          spellCheck={false}
        />
      </label>

      <h4 className="settings-subheading">Confluence publishing defaults</h4>
      <p className="muted small">
        Used to prefill the "Publish to Confluence" dialog after generating a fresh
        report. You can override either of these on each publish.
      </p>

      <label className="field">
        <span>Default space (name or key)</span>
        <input
          type="text"
          value={creds.confluenceSpace}
          onChange={(e) => update("confluenceSpace", e.target.value)}
          placeholder={DEFAULT_CREDENTIALS.confluenceSpace}
        />
      </label>

      <label className="field">
        <span>Default parent page (exact title — optional)</span>
        <input
          type="text"
          value={creds.confluenceParentPage}
          onChange={(e) => update("confluenceParentPage", e.target.value)}
          placeholder={DEFAULT_CREDENTIALS.confluenceParentPage}
        />
      </label>

      <div className="disclosure-actions">
        <button
          type="button"
          className="ghost-button"
          onClick={resetTeamDefaults}
        >
          Reset to CONS defaults
        </button>
      </div>
    </section>
  );
}
