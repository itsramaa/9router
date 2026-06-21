---
trigger: model_decision
description: Systematic debugging protocol and plan format for all agents
---

# Systematic Debugging (4-Phase)

When error/failure occurs:

1. **Understand**: Read full error/stack trace. Note exact file, line, type, trigger
2. **Hypothesize**: Generate ≥2 hypotheses with evidence (not guesses)
3. **Test**: Minimum change to confirm/deny. Add log/assertion, NOT a fix
4. **Fix + Verify**: Apply fix → verify error gone → check no regressions → add test

**Circuit breaker:**

- STOP after 3 failed test/build runs
- Analyze logs thoroughly before retry
- If stuck, escalate with blocker format from `@_shared.md`

---

# Plan Format (Before Major Work)

Before any coding task:

1. **Goal** — one sentence, what success looks like
2. **Approach** — which option and why (with alternatives considered)
3. **Steps** — ordered, each verifiable independently
4. **Risks** — what could go wrong + mitigation per risk
5. **Definition of Done** — acceptance criteria, verification method

For DevOps, also include: 6. **Rollback Plan** — exact commands to revert
