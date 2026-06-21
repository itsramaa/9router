---
trigger: model_decision
description: Human-In-The-Loop gates for all agents
---

# HITL Gates (Human-In-The-Loop)

Mandatory gates — NO bypass unless user explicitly says "skip gates" or "auto-approve".

| Gate      | When              | Action                                                      |
| --------- | ----------------- | ----------------------------------------------------------- |
| PRD Gate  | PRD draft done    | Send PRD + open questions → STOP → wait                     |
| Spec Gate | OpenSpec complete | Send compiled questions → STOP → wait explicit YES          |
| QA Gate   | QA complete       | Send sprint summary + test results → STOP → wait acceptance |

Rules:

- User says "gas" at sprint start ≠ auto-approve all gates
- NEVER mark sprint done if QA report shows BLOCKED or open P0/P1 bugs
- Each gate requires explicit user response before proceeding
