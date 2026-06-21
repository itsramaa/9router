---
trigger: model_decision
description: Verification protocol for all agents before declaring task done
---

# Verification Protocol

Before declaring ANY task complete:

## All Agents

- [ ] Code runs without errors
- [ ] All tests pass (no skipping)
- [ ] No regressions in existing tests
- [ ] GitHub Issue URL linked
- [ ] Conventional commit format used

## Backend

- [ ] API endpoint responds correctly
- [ ] Error cases handled
- [ ] Auth works (if protected endpoint)
- [ ] OpenAPI docs updated (`docs/api/`)
- [ ] No hardcoded secrets
- [ ] Queries use parameterized statements / ORM

## Frontend

- [ ] Visual verification via browser
- [ ] Responsive: mobile 375px + desktop 1280px
- [ ] No console errors
- [ ] Keyboard nav + ARIA labels
- [ ] No secrets in client bundle

## DevOps

- [ ] All containers `Up (healthy)` in `docker ps`
- [ ] Health endpoint returns `200`
- [ ] No errors in `docker compose logs`
- [ ] Env vars correctly injected
- [ ] Rollback plan documented

## QA

- [ ] All acceptance criteria met
- [ ] Security checklist complete
- [ ] No P0/P1 bugs open
- [ ] QA report written to `docs/qa_report.md`
