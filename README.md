# Escalation Review

A small web app for reviewing engineering escalations from Jira. Cards are pulled
straight from your Jira project, summarized per-card by Claude, and rendered as a
report you can read in the browser or export to Markdown / CSV / JSON.

Defaults are wired for the Datadog Containers (CONS) workflow described in
[`CLAUDE.md`](./CLAUDE.md). Any team can override the project key, escalation
columns, and roster from the credentials screen.

## Features

- Query escalated cards from Jira via JQL for any timeframe (past week / month /
  quarter / year or a custom range).
- Auto-summarize each card with Claude — preventability flag, root-cause
  category, external-engineering involvement, and an improvement recommendation.
- Browse the report with filters, per-card drill-down, and a duration bar chart.
- **Export** to Markdown, CSV, or JSON.
- **Import** a previously exported `.json` / `.csv` / `.md` file back into the
  app to visualize it again — useful for sharing reports with teammates who
  don't have Jira/Anthropic credentials set up.
- Light and dark mode (system preference is respected on first load).
- Configurable for non-Datadog teams: project key, escalation columns, internal
  team roster, custom field names to read (e.g. "Pre-Investigation Notes"), and
  Confluence team-context URLs.

## Prerequisites

- **Node.js** 20 or newer (24+ recommended) and **npm**
- **Atlassian** account in the Jira instance you want to review, plus a
  personal API token: <https://id.atlassian.com/manage-profile/security/api-tokens>
- **Anthropic** API key: <https://console.anthropic.com/settings/keys>

## Quick start

```bash
# 1. Clone
git clone <repo-url> container-eng-escalation-review
cd container-eng-escalation-review/web

# 2. Install dependencies
npm install

# 3. Start the dev server
npm run dev
```

Vite prints a local URL (defaults to <http://localhost:5173>). Open it in a
browser.

### First-time setup in the app

1. On the landing page, click **Get started →**.
2. Fill in the credentials form:
   - **Atlassian email** — the email tied to your Atlassian account.
   - **API token** — the Atlassian token from the link above.
   - **Atlassian domain** — e.g. `datadoghq.atlassian.net`.
   - **Anthropic API key** — `sk-ant-…`.
   - **Model** — defaults to `claude-sonnet-4-5`; change if you have access to a
     different model name.
3. (Optional — only if you're **not** on the Datadog Containers team)
   Expand **Team configuration** and override:
   - **Jira project key** (default `CONS`).
   - **Escalation columns** — the workflow columns that count as "escalated
     beyond the team" (one per line).
   - **Internal team roster** — names whose comments don't count as "external"
     for the preventability rule.
   - **Additional Jira fields** — custom field names to include alongside the
     description when summarizing each card (defaults to `Pre-Investigation
     Notes`, `Investigation Notes`).
   - **Team context URLs** — Confluence team spaces passed to Claude as broader
     team context for the preventability judgment.
4. Click **Continue to timeframe →**, pick a window, preview the JQL, and
   click **Generate fresh report →**.

Credentials live only in your browser's `localStorage`. Each request is
proxied to Jira / Anthropic through the local dev server — nothing is written
to disk on the server side.

## Try without credentials

The landing page also offers two no-credentials options:

- **See a sample report** — opens the bundled March 2026 CONS report so you can
  see what a finished report looks like.
- **Import a saved report** — pick a `.json`, `.csv`, or `.md` file that was
  previously exported from the app to view it again. Malformed files produce an
  inline error explaining what failed.

## Build for production

```bash
cd web
npm run build      # type-checks + bundles into web/dist
npm run preview    # serves the built bundle locally for a smoke test
```

Note: production deployment is not wired up. The Jira/Anthropic proxy lives in
Vite's dev-server middleware (`web/api-plugin.ts`); a production deployment
would need to replicate that proxy in your hosting environment so the browser
never sees raw upstream URLs.

## Repository layout

```
container-eng-escalation-review/
├── CLAUDE.md                       # underlying workflow specification
├── 2026-03-01-2026-03-31.md        # canonical example report (March 2026)
├── README.md                       # ← this file
└── web/                            # the standalone Vite + React + TS app
    ├── api-plugin.ts               # dev-server proxy for Jira + Anthropic
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── App.tsx                 # router + report rendering
        ├── LandingPage.tsx
        ├── CredentialsPage.tsx
        ├── TimeframeSelector.tsx
        ├── QueryPreview.tsx
        ├── GeneratingView.tsx
        ├── reportGenerator.ts      # Jira + Claude orchestration
        ├── importer.ts             # JSON / CSV / MD import
        ├── export.ts               # JSON / CSV / MD export
        ├── credentials.ts          # localStorage + team config
        ├── ThemeToggle.tsx
        ├── data.ts                 # bundled sample report data
        └── styles.css
```

## Troubleshooting

- **`401`/`403` from Jira** — double-check the Atlassian email, the API token,
  and the domain (no `https://`, just `your-tenant.atlassian.net`).
- **`429` or slow Claude analysis** — the app analyzes cards sequentially and
  is capped at 60 escalated cards per run. For larger windows, narrow the
  timeframe or raise `MAX_ESCALATED_CARDS` in `web/src/reportGenerator.ts`.
- **`Couldn't import that file`** on the landing page — the importer expects the
  same schema the **Export** menu produces. The error message identifies the
  missing field or column.
- **`prefers-color-scheme` not respected** — once you click the sun/moon toggle,
  the choice is saved to `localStorage` and overrides the system preference on
  subsequent visits. Clear `cons-review.theme` from devtools to reset.
# container-eng-escalation-review
