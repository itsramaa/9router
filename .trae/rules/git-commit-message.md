---
alwaysApply: false
scene: git_message
---

# Git Commit Message Rules

Rules for generating Git commit messages in this project.

## Format

`<type>[scope]: <description> (#<issue-number>)`

## Allowed Types

`feat | fix | docs | style | refactor | perf | test | build | ci | chore`

## Rules

- Use imperative mood in the description (e.g. `add`, `fix`, `update`, not `added`, `fixed`, `updated`)
- Keep the subject line under 72 characters
- Reference a tracked issue number when one exists
- Use a scope that maps to the affected module or domain
- For breaking changes, add `!` after the type or scope and include a `BREAKING CHANGE:` footer
- Do not end the subject line with a period

## Scope Guidance

Prefer scopes such as:

- `auth`
- `api`
- `db`
- `ui`
- `docker`
- `ci`
- `migrations`
- `steering`

## Good Examples

- `feat(auth): add OAuth2 support (#42)`
- `fix(payments): validate Xendit webhook signature (#43)`
- `perf(db): add index on users.email (#44)`
- `docs(steering): update companion file front matter (#45)`
- `feat(api)!: remove legacy session endpoint (#46)`
- `chore(ci): update GitHub Actions runner to ubuntu-24.04 (#47)`

## Avoid

- vague descriptions like `update code` or `fix bug`
- missing issue references when one exists
- mixing unrelated changes into one commit
- past tense or noun-form descriptions
