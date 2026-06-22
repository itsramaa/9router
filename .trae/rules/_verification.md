---
alwaysApply: false
description: Final verification checklist for shipping work, reporting completion, or confirming that implementation satisfies acceptance criteria. Use before declaring any task complete, during release preparation, or when validating deliverables.
---

# Verification Protocol

Use this file before saying a task is done.

## Universal Checks

- [ ] the change behaves as intended
- [ ] relevant tests or validations were run
- [ ] known regressions were checked
- [ ] blockers, caveats, and skipped checks are stated explicitly

## Backend Checks

- [ ] endpoint or service behavior is verified
- [ ] failure cases are handled
- [ ] auth or permission behavior is confirmed where applicable
- [ ] no hardcoded secrets are introduced
- [ ] database access uses safe query patterns

## Frontend Checks

- [ ] UI was visually checked in the browser when relevant
- [ ] responsive behavior was reviewed on key breakpoints
- [ ] no console errors remain
- [ ] keyboard and accessibility basics are covered
- [ ] no secrets or sensitive runtime data leak to the client bundle

## DevOps Checks

- [ ] services start successfully
- [ ] health checks return expected results
- [ ] logs do not show unresolved runtime failures
- [ ] environment configuration is correct
- [ ] rollback steps are documented for risky changes

## QA Checks

- [ ] acceptance criteria are mapped to evidence
- [ ] security checks were performed where relevant
- [ ] no unresolved P0 or P1 issues remain
- [ ] the QA summary is written to the expected report location
