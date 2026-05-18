# Escalation Review — Web App

Vite + React + TypeScript single-page app for reviewing engineering escalations
from Jira, summarized per-card by Claude.

For project overview, prerequisites, and the recommended setup flow, see the
[root README](../README.md).

## Scripts

```bash
npm install        # one-time install
npm run dev        # dev server (default: http://localhost:5173)
npm run build      # type-check + bundle into ./dist
npm run preview    # serve the built bundle locally
```

## How the data flows

1. The credentials form (`src/CredentialsPage.tsx`) writes auth + team config to
   `localStorage` only.
2. The timeframe selector (`src/TimeframeSelector.tsx`) lets the user pick a
   range.
3. `src/QueryPreview.tsx` renders the JQL that would be run.
4. `src/reportGenerator.ts` orchestrates the run:
   - Paginates `POST /api/jira/search` for the escalation JQL and a denominator
     JQL.
   - Fetches each card with `POST /api/jira/issue/:key?expand=changelog,names`
     so we get the changelog + custom-field display names.
   - Pulls Pre-Investigation Notes / Investigation Notes content from matching
     custom fields and passes them alongside the description to
     `POST /api/anthropic/messages` for structured per-card analysis.
5. `src/App.tsx` renders the assembled report.

## Proxy / API plugin

`api-plugin.ts` is a Vite dev-server plugin that exposes three endpoints which
forward to Jira Cloud and the Anthropic Messages API:

- `POST /api/jira/search`         — body forwarded to `POST /rest/api/3/search/jql`
- `POST /api/jira/issue/:key`     — body forwarded to `GET /rest/api/3/issue/:key`
- `POST /api/anthropic/messages`  — body forwarded to `POST /v1/messages`

Credentials are supplied per request by the browser — nothing is persisted on
the dev server.

## Importing / exporting reports

- **Export** lives in `src/export.ts` and writes `.md`, `.csv`, or `.json` via
  `triggerDownload`.
- **Import** lives in `src/importer.ts` and accepts the same three formats. It
  throws `ImportError` with a field-level message on malformed input. The
  landing page wires it up so users can drag-and-drop a previously exported file
  back into the app.

## Bundled sample data

`src/data.ts` ships a hand-curated March 2026 CONS report used for the
**See a sample report** entry point on the landing page. Add new sample periods
by appending `ReportPeriod` objects to `REPORTS`.

## Layout

```
web/
├── api-plugin.ts       # dev-server proxy
├── index.html          # Vite entry
├── vite.config.ts
└── src/
    ├── main.tsx        # React root
    ├── App.tsx         # view router + report
    ├── LandingPage.tsx
    ├── CredentialsPage.tsx
    ├── TimeframeSelector.tsx
    ├── QueryPreview.tsx
    ├── GeneratingView.tsx
    ├── reportGenerator.ts
    ├── importer.ts
    ├── export.ts
    ├── credentials.ts
    ├── api.ts          # frontend client for /api/*
    ├── timeframe.ts    # JQL builders + date helpers
    ├── ThemeToggle.tsx
    ├── StepProgress.tsx
    ├── Tooltip.tsx
    ├── data.ts
    └── styles.css
```
