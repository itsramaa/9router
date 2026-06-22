# Trae Master Rules (PM-First Workflow)

---

## 1. FLOW

- Scope: problem, user, entity, API, deployment target
- PRD: priority, user story, acceptance criteria, out of scope, dependencies

**OpenSpec (wajib sebelum coding):**

- `/openspec:proposal`
- validate → apply → verify → archive

Execution:

- backend → frontend → QA → DevOps
- QA gate wajib sebelum lanjut

---

## 2. WORKFLOW RULES

- Wajib plan sebelum coding (Goal, Steps, Risk, DoD)
- PRD + OpenSpec wajib sebelum implementasi
- No scope creep tanpa approval

---

## 3. OPEN SPEC RULE (CORE)

[Root directory](openspec/)
[Source of truth](openspec/specs/)
[Proposal & Working changes](openspec/changes/<feature>/)

Inside change:

- `proposal.md`
- `tasks.md`
- `design.md` (optional)
- `specs/` (delta)

Rules:

- ADDED / MODIFIED / REMOVED wajib jelas
- Requirement pakai SHALL / MUST
- Minimal 1 scenario per requirement
- Spec harus disetujui sebelum coding

Flow:
`proposal → review → refine → apply → archive`

---

## 4. [EVIDENCE RULE](`../issues/evidence/`)

- Semua task wajib punya evidence file
- Evidence harus bisa diverifikasi
- Close issue wajib refer ke evidence

---

## 5. [ISSUE RULE](`../issues/<issue-id>.md`)

- Semua task wajib punya issue file
- PR wajib link issue + evidence

---

## 6. GIT RULE

- Feature branch only
- Conventional commit:
  `<type>[scope]: <description> (#issue)`

Types:
feat | fix | docs | refactor | perf | test | build | ci | chore

---

## 7. VERIFICATION RULE

Sebelum done:

- build success
- test pass
- no error logs
- API/UI valid
- no regression
- issue linked
- evidence attached

---

## 8. SCOPE CONTROL

- Backend = backend logic only
- Frontend = UI logic only
- DevOps = infra only
- Cross-domain wajib via OpenSpec planning

---

## 9. OPERATION RULES

- Always Use MCP Filesystem For Edit, ETC.
- No silent failure
- Stop scope expansion tanpa izin
- Commit sebelum destructive action
- Always verify before finish

---

## 10. DEBUG FLOW

1. Understand (trace error)
2. Hypothesize (min 2)
3. Test (minimal change)
4. Fix + verify

---

## 11. MEMORY PATHS

- [Learning](`~/.trae/learning`)
- [Memory](`~/.trae/memory`)
- [Rules](`~/.trae/rules`)

---

## CORE PRINCIPLE

Semua kerja harus bisa ditrack:

**issue → OpenSpec → evidence → project path → verification**
