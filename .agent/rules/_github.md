---
trigger: model_decision
description: GitHub workflow for all agents
---

# GitHub Workflow

Always use **GitHub MCP** or `gh` CLI for all GitHub operations. Never bypass GitHub workflow — every change must be traceable to an issue.

## Pre-Coding Setup

```bash
gh auth status
gh repo create <name> --private
gh issue create --title "Epic: <feature>" --body "<scope>"
```

## Sub-Task Issues

```bash
gh issue create --title "feat(backend): <task>" --body "Epic: #<n>"
gh issue create --title "feat(frontend): <task>" --body "Epic: #<n>"
gh issue create --title "chore(devops): <task>" --body "Epic: #<n>"
```

## Branch Naming

```
feature/<issue-number>-description
bugfix/<issue-number>-description
refactor/<issue-number>-description
docs/<issue-number>-description
```

## Git Safety

- Always push to feature branch, not main/master
- Use `git push -u origin HEAD` for new branches
- PR creation: `gh pr create --title "<title>" --body "<body>"`
- NO force push, NO --no-verify, NO --amend (unless explicit request)

## Pull Requests

- Link the related Issue
- Include implementation summary
- Include testing performed
- Attach evidence (screenshot, recording, API response, test result)

## Closing Issues

Only close an Issue when:

- Acceptance Criteria are met
- Changes are merged
- Evidence of completion is attached

## Definition of Done

A task is complete only when:

- Acceptance Criteria are satisfied
- Tests pass
- Related Issue is closed
- Evidence is provided
