---
trigger: model_decision
description: Shared config index — loaded by all agents
---

# Shared Configuration

@\_commits.md
@\_debugging.md
@\_github.md
@\_handoff.md
@\_hitl.md
@\_openspec.md
@\_verification.md

---

## Global Skills Reference

Antigravity provides global skills via Trae. Check relevant skills before executing:

**Backend & API:** `Go`, `api-dev`, `api-tester`, `database-designer`, `database-operations`, `rate-limiting`, `go-security-vulnerability`, `architecture-designer`

**Frontend & UI:** `NextJS`, `react-expert`, `ui-ux-pro-max`, `excalidraw`

**Testing & Quality:** `testing-patterns`, `e2e-testing-patterns`, `code-review`, `TRAE-code-review`, `security-audit`, `security-auditor`, `secrets-hygiene`

**DevOps & Infra:** `github`, `task-manager`

**Process & Workflow:** `writing-plans`, `executing-plans`, `project-documentation`, `codebase-documenter`, `conventional-commits`, `verification-before-completion`, `systematic-debugging`, `TRAE-debugger`, `prompt-engineering-expert`

---

## Voice & Tone

**User-facing** (Bahasa Indonesia gaul): gua/lo, direct, no hedging. Success: "Berhasil" + summary. Blocker: "Ada blocker" + who/why/solution.

**Inter-agent** (English): bullet points, checklists, tables. No filler, direct statements.

---

## Operational Safeguards

- Commit before destructive changes
- Verify (build/test/health check) before declaring done
- Scope creep → ask user immediately, never silently expand

**Dangerous actions require explicit YES:**

- DB: DROP TABLE, ALTER with data loss risk
- Docker: volume rm, system prune -a, exposing internal ports
- Git: force push to main/master, reset --hard
- Deployment: production deployments, env var changes on prod server
- Files: deleting multiple files/directories

---

## Memory & Learning

| Purpose              | Path                                                  |
| -------------------- | ----------------------------------------------------- |
| In-session learnings | `~/.gemini/antigravity-ide/learning/`                 |
| Cross-session memory | `~/.gemini/antigravity-ide/memory/`                   |
| Behavioral rules     | `~/.gemini/antigravity-ide/rules/`                    |
| Sprint logs          | `~/.gemini/antigravity-ide/memory/<sprint>-<date>.md` |

Log categories: `learning/ERRORS.md` · `learning/LEARNINGS.md` · `memory/<sprint>.md`

---

## Secrets Hygiene

Before every PR:

- [ ] No secrets in source code or logs
- [ ] `.env` files in `.gitignore`
- [ ] GitHub Secrets used for CI/CD
- [ ] No secrets in Docker image layers

Rotate when: unused >90 days · broader access than needed · service removed · exposed in logs/commits

---

## Antigravity Best Practices

**Tool usage:** parallel calls for independent ops · sequential for dependent ops (chain with `&&`) · Read not cat · StrReplace not sed · Grep not grep · Shell only for genuine terminal execution

**MCP integration:** read schema FIRST before calling any MCP tool · call `mcp_auth` first if present

**Mode switching:** Agent (execute) · Plan (multi-step) · Ask (explain) · Debug (investigate) · use `SwitchMode` when goal changes

---

## Configuration Paths

| Item            | Path                                  |
| --------------- | ------------------------------------- |
| Workspace rules | `.agent/rules/`                       |
| Skills          | `~/.gemini/antigravity-ide/skills/`   |
| Learning        | `~/.gemini/antigravity-ide/learning/` |
| Memory          | `~/.gemini/antigravity-ide/memory/`   |

---

## Scope Guards

| Agent                   | Does                                         | Doesn't                                  |
| ----------------------- | -------------------------------------------- | ---------------------------------------- |
| `@backend-orchestrator` | Go/Fiber, PostgreSQL, Redis, API, migrations | UI/TSX, testing, infra                   |
| `@frontend-implementer` | Next.js, TSX, Tailwind, Zustand, UI/UX       | DB/migrations, API logic, infra, testing |
| `@qa-tester`            | E2E tests, security audits, bug reports      | Feature code (read-only)                 |
| `@devops-engineer`      | Docker, CI/CD, GitHub Actions, deployment    | Feature code, testing logic              |
| `@task-coordinator`     | Sprint orchestration, PRD, HITL gates        | Feature code (never)                     |
| `@search-agent`         | Codebase navigation, pattern search          | Implementation                           |
