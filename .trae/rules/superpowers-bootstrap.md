---
alwaysApply: true
---

# Skill-First Workflow Discipline

This is a manual steering file. Include it via `#Rule` when you want to enforce that the AI checks and uses available process skills before acting, especially for multi-step or disciplined workflows.

## Why This Exists

Many tasks benefit from structured workflows such as brainstorming before building, debugging before patching, or planning before executing. This file reinforces that discipline so Kiro does not skip foundational steps.

## The Rule

Check whether a relevant process skill applies before starting implementation or investigation. If one does, follow it.

## Available Process Skills

| Skill                            | Purpose                                             |
| -------------------------------- | --------------------------------------------------- |
| `brainstorming`                  | interactive design refinement before implementation |
| `test-driven-development`        | red-green-refactor cycle                            |
| `systematic-debugging`           | 4-phase root-cause process                          |
| `writing-plans`                  | detailed implementation plans                       |
| `executing-plans`                | batch execution with checkpoints                    |
| `subagent-driven-development`    | fast iteration with two-stage review                |
| `dispatching-parallel-agents`    | concurrent subagent workflows                       |
| `requesting-code-review`         | pre-review checklist                                |
| `receiving-code-review`          | responding to feedback                              |
| `verification-before-completion` | ensure fixes actually work                          |
| `using-git-worktrees`            | parallel development branches                       |
| `finishing-a-development-branch` | merge or PR decision workflow                       |

## When To Check For Skills

Before any non-trivial task, ask whether a process skill could apply. Common triggers:

- building a new feature or module
- fixing a bug or investigating a failure
- planning multi-step work
- coordinating parallel or subagent tasks
- reviewing code or responding to feedback
- confirming that work is truly complete

## Skill Priority

When multiple skills could apply:

1. process skills first, because they determine the approach
2. implementation skills second, because they guide execution

Examples:

- `build feature X` leads to brainstorming first, then implementation skills
- `fix bug Y` leads to systematic-debugging first, then domain skills

## Skill Types

- rigid skills such as TDD or debugging should be followed exactly
- flexible pattern skills should be adapted to context

## Rationalization Red Flags

These thoughts usually mean a skill was skipped:

- `this is too simple for a skill`
- `I already know this skill`
- `let me explore the codebase first`
- `the skill is overkill`
- `I will just do this one thing first`

When any of these appear, that is usually a sign to pause and check the relevant skill instead.

## User Instructions

User instructions describe what to do, not how. Requests such as `add X` or `fix Y` do not override disciplined workflows.
