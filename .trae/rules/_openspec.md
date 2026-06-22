---
alwaysApply: false
description: Spec-first workflow for planning features, writing requirements, refining design, and getting approval before implementation begins. Use when the project follows proposal-spec-apply flow or when requirements need review before coding.
---

# OpenSpec Workflow

Use this file when the workspace follows a proposal/spec/task flow before coding.

## Standard Sequence

`proposal -> review -> refine -> apply -> verify -> archive`

## Typical Commands

| Step | Example command | Purpose |
| ---- | --------------- | ------- |
| Draft | `/openspec:proposal <name>` | scaffold proposal, tasks, and spec deltas |
| Review | `openspec validate/show <name>` | inspect and validate |
| Refine | edit `openspec/changes/<name>/specs/` | iterate with the user |
| Apply | `/openspec:apply <name>` | implement the approved task list |
| Verify | `/openspec:verify <name>` | confirm implementation matches the spec |
| Archive | `/openspec:archive <name>` | merge the approved change into the main spec set |

## Structure

```text
openspec/
├── specs/
└── changes/<feature>/
    ├── proposal.md
    ├── tasks.md
    ├── design.md
    └── specs/
```

## Authoring Rules

- mark changes explicitly as `ADDED`, `MODIFIED`, or `REMOVED`
- write requirements with `SHALL` or `MUST`
- include at least one scenario per requirement
- do not begin implementation before approval when the process requires a gate

## Why This Exists

This keeps requirements reviewable, reduces premature coding, and gives Kiro clearer project context before implementation.
