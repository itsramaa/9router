---
alwaysApply: false
description: Root-cause debugging workflow for runtime errors, failing builds, flaky tests, broken integrations, and situations where the agent needs a structured fix-and-verify loop. Use when debugging, investigating errors, troubleshooting failures, or fixing broken behavior.
---

# Debugging Protocol

Use this file when something is broken, unclear, or failing repeatedly.

## Four-Phase Flow

1. **Understand**: capture the exact error, trigger, environment, and failing file or endpoint.
2. **Hypothesize**: list at least two plausible causes backed by evidence.
3. **Test**: run the smallest experiment that confirms or rejects a hypothesis.
4. **Fix and Verify**: apply the fix, confirm the original failure is gone, then check for regressions.

## Circuit Breaker

- Stop after three failed build or test attempts on the same path.
- Do not keep retrying without new evidence.
- If blocked, summarize the current evidence, competing hypotheses, and the safest next step.

## Evidence Rules

- Prefer logs, diagnostics, test output, screenshots, and network traces over guesswork.
- Add temporary instrumentation only when it helps distinguish hypotheses.
- Remove debug-only code before finishing unless it is intentionally kept as observability.

## Plan Format For Major Work

Before substantial implementation, summarize:

1. **Goal**: what success looks like.
2. **Approach**: the chosen path and why.
3. **Steps**: ordered, verifiable actions.
4. **Risks**: what can fail and how to mitigate it.
5. **Definition of Done**: the exact verification method.

For infrastructure or deployment work, also add:

6. **Rollback Plan**: the exact steps or commands to recover safely.
