# OpenSpec Proposal: Audit Phase 4-5 Remaining Fixes

**Feature:** audit-phase4-5-fixes  
**Date:** 2026-06-22  
**Priority:** CRITICAL → HIGH  

---

## Background

12 audit items remain unfixed from the deep audit report (conversation 001b9b7f).
These span 3 domains: backend Python, frontend React/JS, and security hardening.

---

## Scope

### Phase 4 — Backend Security & Stability (CRITICAL)

| ID | Severity | Description | File |
|----|----------|-------------|------|
| AUDIT-006 | CRITICAL | Unbounded WebSocket message queue → OOM | `srv/ws.py` |
| AUDIT-017 | HIGH | Proxy file cleanup race with subprocess start | `srv/handlers.py` |
| AUDIT-019 | HIGH | No rate limiting on harvest start/stop | `srv/handlers.py` |
| AUDIT-020 | HIGH | WebSocket no auth/origin validation | `srv/ws.py` |
| AUDIT-021 | HIGH | Interact actions not validated (goto:javascript: XSS) | `core/interact.py` |
| AUDIT-023 | HIGH | Bulk delete 1-based index without bounds validation | `srv/handlers.py` |

### Phase 5 — Frontend Security & UX (CRITICAL + HIGH)

| ID | Severity | Description | File |
|----|----------|-------------|------|
| AUDIT-007 | CRITICAL | SQL injection via unsanitized API key injection | `automation/page.js` |
| AUDIT-008 | CRITICAL | Clipboard timing attack (reads unintended sensitive data) | `core/interact.py` |
| AUDIT-009 | HIGH | failedAccounts not cleared on stop/reset | `automation/page.js` |
| AUDIT-010 | HIGH | handleRetrySlot dead code / onRetry=null | `automation/page.js` |
| AUDIT-016 | HIGH | Session restore shows stale 'done' state on crash | `automation/page.js` |
| AUDIT-022 | HIGH | API keys shown unmasked in ResultsPanel | `automation/components/ResultsPanel.js` |

---

## Requirements

### Backend (Phase 4)

- AUDIT-006 SHALL implement bounded WS queue with `maxsize` + per-client send timeout
- AUDIT-017 SHALL move proxy temp file cleanup to after subprocess opens file (wait for proc read)
- AUDIT-019 SHALL implement in-memory rate limiter: max 5 start/stop requests per 60s per IP
- AUDIT-020 SHALL validate WebSocket `Origin` header against `localhost` allowlist
- AUDIT-021 SHALL validate interact actions: block `javascript:` URLs, validate coordinate ranges
- AUDIT-023 SHALL validate bulk delete IDs are within account list bounds

### Frontend (Phase 5)

- AUDIT-007 SHALL sanitize API key format (alphanum + `_-.:/`) before inject call, max 500 chars
- AUDIT-008 SHALL validate clipboard content looks like an API key before using it
- AUDIT-009 SHALL clear `failedAccounts` in `handleStop` and `msg.type === 'reset'`
- AUDIT-010 SHALL remove dead `handleRetrySlot` function and dead retry UI from `SlotDetail`
- AUDIT-016 SHALL always restore session to `'idle'` (not `'done'`) on page load
- AUDIT-022 SHALL mask API keys in ResultsPanel: show `sk-...xxxx` format with copy button

---

## Execution Order

1. Phase 4 backend → Phase 5 frontend → QA gate

---

## DoD

- All 12 items implemented and tested
- QA Gate 3: `tests/test_phase4_5_fixes.py` all pass
- Committed to `fix/audit-backend-security`
- PR updated
