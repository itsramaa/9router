---
alwaysApply: false
description: Conventional commit message rules for creating commits, squashing changes, preparing PR titles, or summarizing implementation work.
scene: git_message
---

# Commit Conventions

Use this file when preparing a commit, proposing a commit message, or normalizing PR titles.

## Standard Format

`<type>[scope]: <description> (#<issue-number>)`

## Allowed Types

`feat | fix | docs | style | refactor | perf | test | build | ci | chore`

## Rules

- Every commit references a tracked issue when one exists.
- Keep the description imperative and concise.
- Use a scope that maps to the affected module or domain.
- For breaking changes, add `!` after the type or scope and include a `BREAKING CHANGE:` footer.

## Good Examples

- `feat(auth): add OAuth2 support (#42)`
- `fix(payments): validate Xendit webhook signature (#43)`
- `perf(db): add index on users.email (#44)`
- `docs(steering): migrate front matter to Kiro inclusion modes (#45)`
- `feat(api)!: remove legacy session endpoint (#46)`

## Scope Guidance

Prefer scopes such as:

- `auth`
- `api`
- `db`
- `ui`
- `docker`
- `ci`
- `steering`

## Avoid

- vague descriptions like `update code`
- missing issue references when the workflow requires them
- mixing unrelated changes into one commit message
