---
trigger: model_decision
description: OpenSpec workflow for all agents
---

# OpenSpec Workflow

OpenSpec is mandatory before implementation. No coding without an approved spec.

| Step    | Command                               | Purpose                         |
| ------- | ------------------------------------- | ------------------------------- |
| Draft   | `/openspec:proposal <name>`           | Scaffold proposal, tasks, specs |
| Review  | `openspec validate/show <name>`       | Verify and review               |
| Refine  | Edit `openspec/changes/<name>/specs/` | Iterate with user               |
| Apply   | `/openspec:apply <name>`              | Implement tasks                 |
| Verify  | `/openspec:verify <name>`             | Check compliance                |
| Archive | `/openspec:archive <name>`            | Merge to main specs             |

## Directory Structure

```
openspec/
├── specs/           # source of truth
└── changes/<feature>/
    ├── proposal.md
    ├── tasks.md
    ├── design.md    (optional)
    └── specs/       (delta)
```

Rules:

- ADDED / MODIFIED / REMOVED must be explicit
- Requirements use SHALL / MUST
- Minimum 1 scenario per requirement
- Spec must be approved before coding
- Flow: `proposal → review → refine → apply → archive`
