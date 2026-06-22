---
alwaysApply: false
description: GitHub issue, branch, pull request, and merge workflow for tasks that must stay traceable to an issue or PR. Use when creating issues, branching, opening PRs, reviewing code, or merging changes.
---

# GitHub Workflow

Use this file when creating issues, branching work, opening PRs, or closing tracked tasks.

## Core Principle

Keep every meaningful change traceable to an issue, branch, and reviewable PR when the repository workflow supports it.

## Preferred Tools

- use GitHub MCP when available
- otherwise use `gh`
- avoid ad-hoc browser-only workflows when traceability matters

## Pre-Work Checklist

```bash
gh auth status
gh issue create --title "Epic: <feature>" --body "<scope>"
```

Create sub-task issues when one large effort needs backend, frontend, QA, or DevOps workstreams.

## Branch Naming

Use descriptive branches:

- `feature/<issue-number>-short-description`
- `bugfix/<issue-number>-short-description`
- `refactor/<issue-number>-short-description`
- `docs/<issue-number>-short-description`

## Pull Request Rules

- Link the related issue.
- Summarize what changed and why.
- List tests or verification performed.
- Attach evidence when UI, API, or deployment behavior matters.

## Git Safety

- Never push directly to `main` or `master` unless explicitly instructed.
- Do not force-push shared branches without explicit approval.
- Do not use `--no-verify` unless the user explicitly accepts the risk.
- Do not amend published commits unless requested.

## Closing Issues

Close an issue only when:

- the acceptance criteria are met
- the change is merged or otherwise accepted
- evidence of completion exists

## Minimal DoD For GitHub-Tracked Work

- issue linked
- code or docs updated
- verification recorded
- PR or merge path clear
