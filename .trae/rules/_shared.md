---
alwaysApply: false
description:
---

# Shared Steering Baseline

This file is the always-on baseline for all AI interactions in this workspace. Keep it short, stable, and broadly applicable.

## Purpose

This file defines shared operating rules that influence every AI interaction in this workspace:

- follow safe execution practices
- keep agent responsibilities clear
- apply project-specific standards consistently
- prefer focused companion files for specialized workflows

## Companion Files

Use these focused files when the task matches their domain:

| File                       | Purpose                                           |
| -------------------------- | ------------------------------------------------- |
| `_commits.md`              | Conventional commit messages and commit hygiene   |
| `_debugging.md`            | Root-cause debugging and plan structure           |
| `_github.md`               | GitHub issue, branch, and PR workflow             |
| `_handoff.md`              | Multi-agent completion and blocker handoff format |
| `_hitl.md`                 | Human approval gates for staged delivery          |
| `_openspec.md`             | Spec-first workflow before implementation         |
| `_verification.md`         | Verification checklist before saying work is done |
| `backend-orchestrator.md`  | Backend/API/database implementation guidance      |
| `frontend-implementer.md`  | Frontend/UI implementation guidance               |
| `qa-tester.md`             | QA, security review, and release-readiness checks |
| `devops-engineer.md`       | Infra, CI/CD, and deployment guidance             |
| `task-coordinator.md`      | Planning, orchestration, and HITL enforcement     |
| `superpowers-bootstrap.md` | Manual reference for structured workflow skills   |

## Core Operating Rules

- Start with the smallest action that can confirm direction safely.
- Ask for clarification immediately when requirements are ambiguous or scope changes.
- Do not silently expand scope beyond the user's request.
- Verify outcomes before declaring success.
- Prefer focused companion files over putting every rule into one giant document.
- Keep one domain per file so the AI loads only relevant context.
- Use relative paths based on the project root directory for file references.

## Safety Rules

Always stop and ask for explicit approval before:

- destructive database operations
- deleting files or directories in bulk
- force-pushing or rewriting shared git history
- production deployments or production env var changes
- commands that can remove containers, volumes, or persisted data
- any irreversible or destructive action

## Tooling Expectations

- Prefer native tools over ad-hoc shell commands when equivalent tooling exists.
- Parallelize independent reads/searches; keep dependent actions sequential.
- Read an MCP tool schema before calling that MCP tool.
- Use browser, test, and diagnostics evidence when the task requires verification.
- Verify command compatibility with the target operating system before execution.

## Communication Style

For end users:

- write in direct, natural Bahasa Indonesia
- be concise and outcome-oriented
- state blockers clearly with reason and next step

For agent-facing artifacts:

- use structured English
- prefer bullets, checklists, short tables, and explicit next actions

## Agent Scope Guard

| Agent                  | Primary scope                                     | Out of scope                              |
| ---------------------- | ------------------------------------------------- | ----------------------------------------- |
| `backend-orchestrator` | Go/Fiber, APIs, PostgreSQL, Redis, migrations     | Frontend UI, infra, QA ownership          |
| `frontend-implementer` | Next.js, React, TSX, Tailwind, UX                 | Backend logic, database migrations, infra |
| `qa-tester`            | E2E, regression, security checks, bug reports     | Feature implementation                    |
| `devops-engineer`      | Docker, CI/CD, deployment, runtime ops            | Feature implementation                    |
| `task-coordinator`     | planning, orchestration, gates, progress tracking | Writing feature code                      |
| `search-agent`         | codebase discovery and pattern finding            | Shipping implementation                   |

## Maintenance Notes

- Review rule files when architecture, tooling, or team workflow changes.
- After creating or modifying a rule, start a new chat before using it to avoid context conflicts.
- Do not store secrets, tokens, or private credentials in rule files.
- Control the granularity of each rule to keep it clear, focused, and easy to understand.
- Ensure rules do not conflict with or override each other.
