---
trigger: model_decision
description: Inter-agent handoff format for all agents
---

# Inter-Agent Handoff Format

## Completion Format

```
[AGENT COMPLETE] Task: <name>
Actions Taken: <summary>
Files Changed: <list with paths>
Issue URL: <github-url>
Verification: <how to verify - commands/URLs>
Known Issues: <if any>
Next: @<next-agent> <clear action>
```

Requirements:

- ALWAYS include GitHub Issue URL
- ALWAYS specify verification method
- ALWAYS state next agent + specific action
- Be explicit about incomplete work or risks

**Bad:** "Done, check files"
**Good:** "Auth at `api/auth/`. Run `go test ./auth/...` to verify. Known: rate limiting missing. Next: @frontend-implementer build login consuming POST /auth/login. Issue: #42"

## Escalation Format

```
[BLOCKER] Agent: <agent>
Issue: <description>
Impact: <what's blocked>
Proposed: <solution options>
```

Steps:

1. Read blocker message fully
2. Classify: (a) unblock now, (b) needs user input, (c) deprioritize
3. Respond same turn — no silent failures
4. Log to memory: `~/.gemini/antigravity-ide/memory/`
