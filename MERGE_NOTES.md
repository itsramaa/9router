# Merge Notes — Account Lifecycle / Auto-Deactivate / Pause Port

This fork (`9router`) carries a custom **account lifecycle** layer ported from
`9router-custom`: auto-deactivate on ban, temporary pause on cooldown
escalation, model-level locking, daily health checks, and UI badges for
paused/banned states.

This document tells you **exactly what to re-apply** when merging an upstream
release so the custom behavior survives.

---

## TL;DR — Merge procedure

```bash
git fetch origin
git merge origin/main
```

Then:

1. **New files** (Section A) — never conflict. If upstream adds a file at the
   same path, keep ours (upstream won't have lifecycle logic).
2. **Overwritten files** (Section B) — will conflict. Re-apply the custom
   version from `9router-custom`, then manually integrate any upstream changes
   on top.
3. **Patched files** (Section C) — may conflict. For each, re-apply the small
   hook blocks listed below. Most patches are additive insertions (3–15 lines).
4. Run `node --check` on every touched file. See the verify command at the end.

---

## Section A — New files (zero conflict)

These files don't exist upstream. Upstream merges will never touch them.

| File | Purpose |
|---|---|
| `src/shared/services/accountLifecycle.js` | Core: `activate` / `deactivate` / `pause` / `resumeExpiredPauses` / `getState` / `setQuotaWarning` / `clearQuotaWarning` |
| `src/shared/services/dailyAccountCheck.js` | `startDailyAccountCheck` / `runDailyAccountCheckNow` / `classifyPingResult` / `pingConnection` |
| `src/shared/utils/connectionBanDetect.js` | `BAN_KEYWORDS` + `isBannedError(lastError)` — single source of truth for UI ban detection |
| `open-sse/services/cooldownPolicy.js` | `classifyError` / `resolveCooldown` / `BAN_PATTERNS` / `ESCALATION_THRESHOLD` / `LOCK_VS_PAUSE_THRESHOLD_MS` |
| `open-sse/services/modelLockStore.js` | `isLockActive` / `buildClearLocks` / `hasAnyActiveLock` / `getActiveLockKeys` / `getEarliestLock` / `buildSetLock` |
| `open-sse/services/modelLockCleanup.js` | `runModelLockCleanup` — GC expired locks (hourly) |
| `src/app/api/models/availability/route.js` | GET list unavailable models; POST clearCooldown |
| `src/app/(dashboard)/dashboard/providers/[id]/CooldownTimer.js` | Countdown component used by ConnectionRow |

**If a conflict appears here**: upstream created a same-named file. Inspect
upstream's version — if it's unrelated, keep ours. If it's a competing
implementation, merge manually. This is unlikely.

---

## Section B — Overwritten files (full replace — high conflict)

These files were replaced wholesale with the custom version. On conflict, start
from the custom version and cherry-pick upstream changes.

### `src/app/api/providers/[id]/route.js`

**Custom change**: PUT handler routes `isActive` toggle through
`accountLifecycle.activate()` / `deactivate()` instead of a raw DB update.
Also accepts `disabledByProviderToggle` and `proxyPoolId` fields.

**Merge strategy**: Diff upstream's `route.js` against ours. If upstream adds
new PUT fields or validation, port those into our lifecycle-routed version.
Don't revert to upstream's raw update — that bypasses the pause/deactivate
state machine.

---

## Section C — Patched in-place files (conflict zones)

These are the files most likely to conflict. Each subsection shows **what was
added** so you can re-apply after a conflict.

### C1. `src/sse/services/auth.js` — medium conflict

Three hook insertions:

1. **Imports** (top of file):
   ```js
   import { resolveCooldown } from "open-sse/services/cooldownPolicy.js";
   import { deactivate as lifecycleDeactivate, pause as lifecyclePause, resumeExpiredPauses, clearQuotaWarning } from "@/shared/services/accountLifecycle.js";
   import { buildSetLock } from "open-sse/services/modelLockStore.js";
   ```

2. **`getProviderCredentials()`** — auto-resume before credential selection:
   ```js
   await resumeExpiredPauses(providerId);
   ```

3. **`markAccountUnavailable()`** — replaced the "always lock" logic with a
   cooldown policy dispatcher:
   ```js
   const { action, cooldownMs } = resolveCooldown(status, errorText, backoffLevel, resetsAtMs);
   if (action === "deactivate") {
     await lifecycleDeactivate(connectionId, "ban");
   } else if (action === "pause") {
     await lifecyclePause(connectionId, cooldownMs);
   } else {
     // existing modelLock_* logic (buildSetLock)
   }
   ```

4. **`clearAccountError()`** — clears quota warning alongside locks:
   ```js
   if (conn.quotaStatus) {
     clearObj = { ...clearObj, quotaStatus: null, quotaWarningMessage: null, quotaWarningAt: null };
   }
   await clearQuotaWarning(connectionId);
   ```

**Re-apply**: If `markAccountUnavailable` or `clearAccountError` change
upstream, keep our lifecycle dispatch calls. The hook points are the
`resolveCooldown` call and the `lifecyclePause`/`lifecycleDeactivate` calls.

---

### C2. `src/lib/db/repos/connectionsRepo.js` — low conflict

**Change**: `rowToConn()` spreads parsed `extra` JSON **before** column
fields. New lifecycle keys round-trip through the `data` JSON column with no
schema migration:

```js
// In rowToConn():
const extra = row.data ? JSON.parse(row.data) : {};
return {
  ...extra,               // ← spreads first (pausedUntil, quotaStatus, backoffLevel, modelLock_*, etc.)
  id: row.id,
  provider: row.provider,
  // ...column fields override extra
};
```

Also added: `atomicUpdateBackoffLevel(id, computeFn)` — atomic
read-compute-write inside a transaction.

**Re-apply**: If upstream rewrites `rowToConn`, ensure the `...extra` spread
stays **before** the column fields so lifecycle keys persist but don't shadow
DB columns. Keep `atomicUpdateBackoffLevel` as a pure addition.

---

### C3. `src/lib/db/index.js` — low conflict

**Change**: Added export of `atomicUpdateBackoffLevel` from
`connectionsRepo`.

**Re-apply**: One-line re-export. Additive only.

---

### C4. `src/lib/localDb.js` — low conflict

**Change**: Re-export `atomicUpdateBackoffLevel` (backward-compat shim).

**Re-apply**: One-line re-export. Additive only.

---

### C5. `src/shared/services/initializeApp.js` — medium conflict

**Change**: After the existing `quotaAutoPing` block, registered two
schedulers:

```js
import { startDailyAccountCheck } from "@/shared/services/dailyAccountCheck.js";
import { startModelLockCleanup } from "open-sse/services/modelLockCleanup.js";

// ...in the init function:
startDailyAccountCheck();
startModelLockCleanup();
```

Also calls `resumeExpiredPauses` for all providers on startup.

**Re-apply**: If upstream restructures the init function, keep the three
`start*()` calls together. They are idempotent and order-independent.

---

### C6. `src/shared/utils/connectionStatus.js` — low conflict

**Change**: `getStatusVariant` now takes 5 args (was 2), with ban/pause
detection:

```js
export function getStatusVariant(
  isActive,
  effectiveStatus,
  pausedUntil = null,
  lastError = null,
) {
  if (isActive === false) {
    if (isBannedError(lastError)) return "destructive";
    if (pausedUntil && new Date(pausedUntil).getTime() > Date.now()) return "warning";
    return "default";
  }
  // ...existing active/error logic
}
```

**Re-apply**: Keep the 4-arg signature (extra args default to `null` so
existing 2-arg callers still work). Keep the `isBannedError` import from
`connectionBanDetect.js`.

---

### C7. `src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js` — medium conflict

**Changes**:
- Import `isBannedError` from `@/shared/utils/connectionBanDetect` and
  `CooldownTimer` from `./CooldownTimer`.
- `isPaused` state + `pausedUntil` from `connection.pausedUntil`.
- Pause useEffect (10s tick) checking `isActive === false && pausedUntil > now`.
- `isBanned` via `isBannedError(connection.lastError)`.
- `statusLabel`: `isPaused ? "paused" : isBanned ? "banned" : isActive===false ? "disabled" : effectiveStatus || "Unknown"`.
- `getStatusVariant()` calls 4-arg `getConnectionStatusVariant(isActive, effectiveStatus, pausedUntil, lastError)`.
- Pause countdown: `{isPaused && pausedUntil && <CooldownTimer until={pausedUntil} />}`.
- Orange error text for paused accounts.
- `getOneByOneLabel` / `getOneByOneVariant`: added `skipped` state and
  `diagnosis` enrichment (quota_warning / model_locked).

**Re-apply**: If upstream rewrites the badge section, keep `statusLabel`,
the 4-arg `getStatusVariant` call, and the pause countdown `<CooldownTimer>`.

---

### C8. `src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.js` — medium conflict

**Changes**: Same lifecycle logic as C7, applied to the inline `ConnectionRow`
inside this file:
- Import `isBannedError`.
- `isPaused` state + `pausedUntil`.
- Pause useEffect (10s tick).
- `isBanned`, `statusLabel`, 4-arg `getStatusVariant`.
- Pause countdown + orange error text in the badge row.

**Re-apply**: Mirror C7's changes. The inline `ConnectionRow` here is a
compact duplicate of the standalone one — keep them in sync.

---

### C9. `src/app/(dashboard)/dashboard/providers/page.js` — medium conflict

**Change**: `handleToggleProvider` now tracks `disabledByProviderToggle`:
- **Activate path**: only restores connections where
  `disabledByProviderToggle === true`. Sends `{ isActive: true, disabledByProviderToggle: null }`.
- **Deactivate path**: disables only currently-active connections, marks them
  with `{ isActive: false, disabledByProviderToggle: true }`.

This prevents provider-toggle from clobbering lifecycle-managed
pause/deactivate states.

**Re-apply**: Keep the if/else split. If upstream adds new fields to the PUT
body, add them to both branches.

---

### C10. `src/app/api/providers/[id]/test/testUtils.js` — medium conflict

**Changes**:
- Import `getActiveLockKeys` from `open-sse/services/modelLockStore.js`.
- New `buildDiagnosis(conn)` function — returns `{ type, message, isPaused, pausedUntil, activeLocks, quotaStatus }`
  where type ∈ `paused` / `quota_warning` / `model_locked` / `ok`.
- **Paused skip** at top of `testSingleConnection`: if connection is paused,
  returns `{ valid: false, skipped: true, reason: "paused", diagnosis }`
  without overwriting `testStatus` (preserves pause state).
- **Diagnosis enrichment** at bottom of `testSingleConnection`: re-reads
  connection from DB, calls `buildDiagnosis`, merges `result.warning` into
  diagnosis, returns `{ ..., skipped, isPaused, pausedUntil, quotaStatus, activeLocks, diagnosis }`.

**Re-apply**: Keep the `buildDiagnosis` function, the paused-skip block, and
the diagnosis enrichment. If upstream adds new test logic between the skip
and the return, insert it before the `buildDiagnosis` re-read.

---

## DB field compatibility

All new lifecycle fields are stored in the JSON `data` column of
`providerConnections` — **no SQL migration needed**:

| Field | Type | Set by |
|---|---|---|
| `pausedUntil` | ISO string \| null | `accountLifecycle.pause()` |
| `deactivateReason` | string \| null | `accountLifecycle.deactivate()` |
| `backoffLevel` | number | `cooldownPolicy` escalation |
| `quotaStatus` | string \| null | lifecycle / quota warning |
| `quotaWarningMessage` | string \| null | `setQuotaWarning()` |
| `quotaWarningAt` | ISO string \| null | `setQuotaWarning()` |
| `modelLock_<model>` | ISO string \| null | `markAccountUnavailable()` |
| `disabledByProviderToggle` | boolean \| null | `handleToggleProvider` |
| `needsArnRefresh` | boolean | lifecycle (future) |

`rowToConn()` spreads `data` before column fields, so these keys appear on the
connection object but never shadow real DB columns.

---

## Verify command

After resolving all conflicts:

```bash
# Backend (12 files)
node --check src/sse/services/auth.js
node --check src/lib/db/repos/connectionsRepo.js
node --check src/lib/db/index.js
node --check src/lib/localDb.js
node --check src/shared/services/initializeApp.js
node --check src/shared/utils/connectionStatus.js
node --check src/shared/utils/connectionBanDetect.js
node --check src/shared/services/accountLifecycle.js
node --check src/shared/services/dailyAccountCheck.js
node --check open-sse/services/cooldownPolicy.js
node --check open-sse/services/modelLockStore.js
node --check open-sse/services/modelLockCleanup.js

# UI (4 files)
node --check "src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js"
node --check "src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.js"
node --check "src/app/(dashboard)/dashboard/providers/page.js"
node --check "src/app/api/providers/[id]/test/testUtils.js"
```

All should print no errors.

---

## Files NOT ported (deliberate exclusions)

- `open-sse/services/quotaMonitor.js` — excluded per user request
- `src/shared/services/claudeAutoPing.js` — Claude-specific, can add later
- `__unified__` proxy pool feature in ConnectionsCard — unrelated to lifecycle
- Qoder device-token-expiry detection in testUtils — divergent fix, not lifecycle-related