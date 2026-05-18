# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a CONS Jira board review workflow. Use the Atlassian MCP to query the CONS project and produce Markdown escalation-review reports. There is no code to build or test — the entire workflow is Claude + MCP tooling.

**Jira project key:** `CONS`

## Workflow

### Step 1 — Ask for the timeframe

Always prompt the user to specify a timeframe before doing anything:
- Past week, month, 3 months, or year
- Accept specific date ranges (e.g. "March 2026")

### Step 2 — Query cards

Find all CONS cards whose **status history** includes any of these columns (regardless of current status):
- Engineering Triage
- Engineering - In Progress
- PM Triage
- PM - In Progress

Cards in those columns during the timeframe provided are the subject of the report. Their current status should be Done or Archived.

Also query the total number of CONS cards created in the same period (to compute escalation rate).

**JQL patterns:**

```
# Escalated cards (status history includes engineering/PM columns, within timeframe)
project = CONS AND status changed to "Engineering Triage" DURING ("<start>", "<end>") OR status changed to "Engineering - In Progress" DURING ("<start>", "<end>") OR status changed to "PM Triage" DURING ("<start>", "<end>") OR status changed to "PM - In Progress" DURING ("<start>", "<end>")

# Total cards created in period (denominator for escalation rate)
project = CONS AND created >= "<start>" AND created <= "<end>"
```

Use `mcp__atlassian__searchJiraIssuesUsingJql` for these queries, then `mcp__atlassian__getJiraIssue` (with changelog) for per-card detail, comments, and status flow.

**Resolution time** = days from `created` to the date the card first transitioned to `Done` or `Archive` (from the issue changelog).

### Step 3 — Produce the report

Create a file named `<YYYY-MM-DD>-<YYYY-MM-DD>.md` in the project root (e.g. `2026-03-01-2026-03-31.md`). Use `2026-03-01-2026-03-31.md` as a format reference — it is the canonical example of a completed report.

#### Required report sections

1. **Executive Summary** — table with: total cards, escalation counts/rate, average resolution time, preventable escalation rate.

2. **Escalation Rate Analysis** — breakdown of cards escalated vs. resolved at TEE level only.

3. **Detailed Card Analysis** — one entry per card with:
   - Link to the card (e.g. `[CONS-XXXX](https://datadoghq.atlassian.net/browse/CONS-XXXX)`)
   - Summary of the issue. Look at the Summary, Pre-Investigation Notes and Investigation Notes tabs if these tabs exist in the Key Details.
   - **Escalation Reason** — from the card's `Escalation Reason` field; categorize it
   - **Duration** — time from creation to resolution
   - **Assignee / TEE Assignee**
   - **Status Flow** — the column history (e.g. TEE Triage → Engineering Triage → Done)
   - **Preventable** — Yes/No with explanation (see criteria below)
   - **Solution Category** — one of: PR fix | Customer environment specific issue | Suggestion without PR or code fixes | Other
   - **Non-TEE Engineering Involvement** — who outside TEE engaged and what they did

4. **Preventable Escalation Summary** — list preventable cards with reasoning.

5. **Improvement Recommendations** — patterns and actionable suggestions.

## Preventable Escalation Criteria

A card is **potentially preventable** if someone who is **not** on the TEE team and **not** the Reporter provided a suggestion, solution, fix, or PR in the comments.

**Hard override:** if the Solution Category is **"PR fix"**, the card is **never** preventable — a code change was required, so the escalation could not have been avoided by team-side action in advance. The engineering work itself was the resolution.

**TEE team members (not counted as external):**
- Patrick Liang, Jack Davenport, Mathieu Colin, Akira Hiiro, Jan Lazaro

When checking commenters/assignees for "external" involvement, cross-reference membership in these Confluence spaces:
- https://datadoghq.atlassian.net/wiki/spaces/CONT/overview
- https://datadoghq.atlassian.net/wiki/spaces/CONTP/overview
- https://datadoghq.atlassian.net/wiki/spaces/TON/pages/6187287156/Team+Overview
- https://datadoghq.atlassian.net/wiki/spaces/CAUT/overview
- https://datadoghq.atlassian.net/wiki/spaces/CAP/overview
- https://datadoghq.atlassian.net/wiki/spaces/EXP/overview
- https://datadoghq.atlassian.net/wiki/spaces/cxg/overview

## Guardrails

- **Never create, update, or delete Jira cards.** Read-only access only.
- Always confirm the timeframe with the user before starting the query.
