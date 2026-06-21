# Tasks: audit-phase4-5-fixes

## Phase 4 — Backend

- [ ] AUDIT-006: Bounded WS queue in `srv/ws.py`
- [ ] AUDIT-017: Proxy file cleanup race in `srv/handlers.py`
- [ ] AUDIT-019: Rate limiting on start/stop in `srv/handlers.py`
- [ ] AUDIT-020: WebSocket origin validation in `srv/ws.py`
- [ ] AUDIT-021: Interact action validation in `core/interact.py`
- [ ] AUDIT-023: Bulk delete bounds validation in `srv/handlers.py`

## Phase 5 — Frontend

- [ ] AUDIT-007: API key sanitization in `automation/page.js`
- [ ] AUDIT-008: Clipboard content validation in `core/interact.py`
- [ ] AUDIT-009: Clear failedAccounts on stop/reset in `automation/page.js`
- [ ] AUDIT-010: Remove dead handleRetrySlot in `automation/page.js`
- [ ] AUDIT-016: Session restore always idle in `automation/page.js`
- [ ] AUDIT-022: Mask API keys in `ResultsPanel.js`

## QA

- [ ] Write `tests/test_phase4_5_fixes.py`
- [ ] All tests pass
- [ ] Commit + push
