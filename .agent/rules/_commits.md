---
trigger: model_decision
description: Conventional Commits standard for all agents
---

# Conventional Commits

Format: `<type>[scope]: <description> (#<issue>)`

Types: `feat | fix | docs | style | refactor | perf | test | build | ci | chore`

Examples:

- `feat(auth): add OAuth2 support (#42)`
- `fix(payments): resolve Xendit webhook signature validation (#43)`
- `perf(db): add index on users.email for faster lookups (#44)`
- `feat!: migrate to new API — BREAKING CHANGE` (add footer for breaking changes)
- `chore(docker): add multi-stage build for Go backend (#42)`
- `ci(github-actions): add staging deploy workflow (#43)`
- `style(ui): update glassmorphism card component (#44)`

Rules:

- Every commit MUST reference a GitHub Issue: `(#issue-number)`
- Breaking changes: append `!` after type/scope + add `BREAKING CHANGE:` footer
- Scope = affected module (auth, db, ui, docker, etc.)
