---
alwaysApply: true
---

# Human-In-The-Loop Gates

Use this file for staged delivery where the agent should stop and wait for approval at key checkpoints.

## Default Gates

| Gate      | Trigger                                | Required action                                  |
| --------- | -------------------------------------- | ------------------------------------------------ |
| PRD Gate  | PRD draft is ready                     | present the draft and open questions, then pause |
| Spec Gate | implementation spec is ready           | present the spec and wait for explicit approval  |
| QA Gate   | QA or release verification is complete | present results and wait for acceptance          |

## Rules

- Do not assume blanket approval from casual phrases such as `gas` or `lanjut`.
- Require an explicit response before continuing past a gate.
- Do not mark work complete if QA is blocked or P0/P1 issues remain open.
- Surface unanswered questions instead of guessing through a gate.

## When To Use Stronger Gates

Add a mandatory pause for:

- production deployments
- destructive migrations
- scope changes that affect requirements
- acceptance decisions with known trade-offs
