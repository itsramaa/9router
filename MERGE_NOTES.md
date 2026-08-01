# Merge Notes — Account Lifecycle / Auto-Deactivate / Pause / OAuth Import / Proxy Fleet

This fork (`9router`) carries a custom **account lifecycle** layer ported from
`9router-custom`: auto-deactivate on ban, temporary pause on cooldown
escalation, model-level locking, daily health checks, and UI badges for
paused/banned states. It also adds **OAuth import routes** for the
`9router-bridge` orchestrator (grok-web / trae), a customized OpenCode Free
system prompt, and a **proxy fleet aggregator** (`proxyFleetSync.js`) that
syncs fleet-owned proxies into local proxy pools with one batch request per
pool and reports exhausted proxies back (configurable via env and dashboard
UI).

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

## Section A2 — OAuth import routes (new files, zero conflict)

Added for `9router-bridge` (external orchestrator) to push credentials into
9Router. Upstream has no equivalent routes.

| File | Purpose |
|---|---|
| `src/app/api/oauth/trae/import/route.js` | POST `/api/oauth/trae/import` — ingest Trae `refreshToken` (+optional `loginHost`) from AAR; best-effort JWT decode for email/displayName; creates `provider: "trae"`, `authType: "oauth"` connection with the marscode/US-East `providerSpecificData` shape that `refreshTraeToken` consumes. |
| `src/app/api/oauth/grok-web/import/route.js` | POST `/api/oauth/grok-web/import` — ingest grok.com `sso` cookie token (+optional `ssoRw`, `name`); strips `sso=` prefix; creates `provider: "grok-web"`, `authType: "cookie"` connection storing the token as `apiKey` (what `GrokWebExecutor` sends as `Cookie: sso=...`). |
| `tests/unit/trae-import.test.js` | Import-shape smoke test for the trae route. |
| `tests/unit/grok-web-import.test.js` | Import-shape smoke test for the grok-web route. |

**If a conflict appears here**: upstream added a route at the same path. If
it's unrelated, keep ours. If upstream ships a competing oauth-import design,
merge manually.

**Caller contract** (bridge side): `9router-bridge` posts to these endpoints
during its push phase. Keep the body shape stable: `{ refreshToken, loginHost? }`
for trae, `{ sso, ssoRw?, name? }` for grok-web.

---

## Section A3 — Proxy fleet aggregator (new files, zero conflict)

Added a proxy-fleet sync loop: on each tick (30–60s) it requests
`GET /api/v1/proxy/batch?pool_id=...&limit=...` from the fleet aggregator
(Go service, port 8080, `X-API-Key` auth), upserts the assigned proxies into
local proxy pools named `fleet:<host>`, and reports locally-exhausted proxies
back via `POST /api/v1/proxy/report-exhausted/batch`. The single-proxy
endpoints still work (backward compat). Upstream has no equivalent feature.

| File | Purpose |
|---|---|
| `src/shared/services/proxyFleetSync.js` | `cfg()` (runtime overrides from settings, env as defaults) / `isFleetEnabled()` / `syncFleetProxies()` (loop over `FLEET_POOLS`) / `syncFleetPool(poolId)` / `markFleetProxyExhausted(proxyUrl, reason)` (in-memory queue) / `flushExhaustedReports()` / `maybeReportFleetExhaustion({provider, connection, status, errorText})` (429/quota hook, fail-open) / `reconfigureProxyFleetSync()` (restart scheduler after settings change) / `startProxyFleetSync()` / `stopProxyFleetSync()` |
| `src/app/api/fleet/sync-now/route.js` | POST `/api/fleet/sync-now` — manual trigger of `syncFleetProxies()` (used by the dashboard Sync Now button) |
| `tests/unit/proxyFleetSync.test.js` | Unit test for batch sync + exhaustion report (6 cases) |

**Merge strategy**: `proxyFleetSync.js` imports `getProxyPoolById`,
`getProxyPools`, `updateProxyPool`, `createProxyPool`, `getSettings` from
`@/lib/localDb` and `PROXY_FLEET_CONFIG` from `@/shared/constants/config`.
If upstream restructures those, keep the import list working. Uses `undici`
`fetch` directly — never the patched `globalThis.fetch` from
`open-sse/utils/proxyFetch.js`.

**Env contract**: `FLEET_ENABLED`, `FLEET_URL`, `FLEET_API_KEY`,
`FLEET_POOLS` (comma-separated), `FLEET_PROVIDERS` (default
`opencode-go,xiaomi-mimo`), `FLEET_BATCH_LIMIT`, `FLEET_INTERVAL_MS`
(default 45000), `FLEET_TIMEOUT_MS`, `FLEET_REPORT_BATCH_SIZE`. Documented in
`.env.example`.

**If a conflict appears here**: keep ours. Upstream has no fleet code; any
same-named file would be unrelated.

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

Four hook insertions:

1. **Imports** (top of file):
   ```js
   import { resolveCooldown } from "open-sse/services/cooldownPolicy.js";
   import { deactivate as lifecycleDeactivate, pause as lifecyclePause, resumeExpiredPauses, clearQuotaWarning } from "@/shared/services/accountLifecycle.js";
   import { buildSetLock } from "open-sse/services/modelLockStore.js";
   import { maybeReportFleetExhaustion } from "@/shared/services/proxyFleetSync.js";
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

4. **Fleet exhaustion hook** — after the `shouldFallback` check in
   `markAccountUnavailable()`, right before the action dispatch:
   ```js
   maybeReportFleetExhaustion({ provider, connection: conn, status, errorText }).catch(() => {});
   ```
   Queues the used fleet proxy for the next batch exhaustion report when the
   failing provider is in `proxyFleet.providers` and the connection runs on a
   `fleet:` pool. Fail-open; never throws.

5. **`clearAccountError()`** — clears quota warning alongside locks:
   ```js
   if (conn.quotaStatus) {
     clearObj = { ...clearObj, quotaStatus: null, quotaWarningMessage: null, quotaWarningAt: null };
   }
   await clearQuotaWarning(connectionId);
   ```

**Re-apply**: If `markAccountUnavailable` or `clearAccountError` change
upstream, keep our lifecycle dispatch calls. The hook points are the
`resolveCooldown` call, the `lifecyclePause`/`lifecycleDeactivate` calls, and
the `maybeReportFleetExhaustion(...).catch(() => {})` call.

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

**Fleet scheduler** — inside the init function, after the `quotaAutoPing`
block:

```js
// Proxy fleet aggregator (env-gated). Fail-open: never blocks startup.
import("@/shared/services/proxyFleetSync")
  .then(({ startProxyFleetSync }) => startProxyFleetSync())
  .catch((e) => console.log("[FleetSync] scheduler start failed:", e.message));
```

`reconfigureProxyFleetSync()` reads settings at startup and again on every
tick, so UI changes to `settings.proxyFleet` take effect without a restart.

**Re-apply**: If upstream restructures the init function, keep the three
`start*()` calls (daily check, model-lock cleanup) and the dynamic
`proxyFleetSync` import together. They are idempotent and order-independent.

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

### C11. `open-sse/executors/opencode.js` — low conflict (local-only)

**Change**: `transformRequest` injects a custom system prompt into every
OpenCode Free request via `injectSystemPrompt` (the shared hook used by
`rtk/caveman.js` / `rtk/ponytail.js`), after `injectReasoningContent`:

```js
import { injectSystemPrompt } from "../rtk/systemInject.js";
import { FORMATS } from "../translator/formats.js";

const OPENCODE_SYSTEM_PROMPT = `...`; // production engineering mode prompt

transformRequest(model, body) {
  const next = injectReasoningContent({ provider: this.provider, model, body });
  injectSystemPrompt(next, FORMATS.OPENAI, OPENCODE_SYSTEM_PROMPT);
  return next;
}
```

**Re-apply**: Keep the `injectSystemPrompt(next, FORMATS.OPENAI,
OPENCODE_SYSTEM_PROMPT)` call after `injectReasoningContent`. If upstream
rewrites `transformRequest`, port the call into their version. `FORMATS.OPENAI`
is correct while every model routes to `/zen/v1/chat/completions`; switch to
`FORMATS.CLAUDE` if `MESSAGES_MODELS` is ever populated.

**Note**: the `OPENCODE_SYSTEM_PROMPT` string itself is periodically edited
locally (reasoning-discipline sections). If a conflict appears *inside the
prompt text*, keep ours (the prompt is the point of the customization) and
port upstream logic changes around it.

---

### C12. `src/shared/constants/config.js` — low conflict

**Change**: Added `PROXY_FLEET_CONFIG` (env-driven defaults for the fleet
sync): `enabled`, `baseUrl`, `apiKey`, `pools`, `batchLimit`,
`tickIntervalMs`, `requestTimeoutMs`, `reportBatchSize`, `providers`
(default `opencode-go,xiaomi-mimo`), `localPoolPrefix` (`"fleet:"`).

**Re-apply**: Additive export. Keep it after `CLIENT_STORE_TTL_MS`.

---

### C13. `src/lib/db/repos/settingsRepo.js` — medium conflict

**Change**:
1. `DEFAULT_SETTINGS` gained a nested `proxyFleet` object (env vars as
   startup defaults): `enabled`, `baseUrl`, `apiKey`, `pools`, `providers`,
   `batchLimit`, `tickIntervalMs`, `requestTimeoutMs`, `reportBatchSize`.
2. `updateSettings()` deep-merges nested `proxyFleet` so a partial PATCH
   (e.g. only `{ proxyFleet: { enabled: true } }`) does not wipe the other
   stored fleet fields:
   ```js
   if (mergedUpdates.proxyFleet && typeof mergedUpdates.proxyFleet === "object") {
     const prev = (current.proxyFleet && typeof current.proxyFleet === "object" ? current.proxyFleet : {});
     mergedUpdates.proxyFleet = { ...prev, ...mergedUpdates.proxyFleet };
     // UI cannot see the stored key; empty string means "leave unchanged".
     if (mergedUpdates.proxyFleet.apiKey === "") {
       delete mergedUpdates.proxyFleet.apiKey;
     }
   }
   ```

**Re-apply**: Keep the nested `proxyFleet` default and the deep-merge block
inside `updateSettings`. The `apiKey === ""` → delete rule is what lets the
UI show an empty API-key field without erasing the stored key.

---

### C14. `src/app/api/settings/route.js` — medium conflict

**Change**:
1. `safeSettingsForResponse(settings)` strips `proxyFleet.apiKey` and exposes
   `hasApiKey: boolean` instead (never leak the key to the browser; CWE-915):
   ```js
   const { apiKey, ...safeProxyFleet } = proxyFleet;
   safe.proxyFleet = { ...safeProxyFleet, hasApiKey: !!apiKey };
   ```
2. PATCH: when the body contains `proxyFleet`, reconfigure the fleet scheduler
   immediately:
   ```js
   if (Object.prototype.hasOwnProperty.call(body, "proxyFleet")) {
     import("@/shared/services/proxyFleetSync")
       .then(({ reconfigureProxyFleetSync }) => reconfigureProxyFleetSync())
       .catch((error) => console.warn("[FleetSync] settings update failed:", error.message));
   }
   ```

**Re-apply**: Keep `safeSettingsForResponse` used by both GET and PATCH
responses, and keep the `proxyFleet` reconfigure block with the other
immediate-apply blocks (`applyOutboundProxyEnv`, `resetComboRotation`,
`configureQuotaAutoPing`).

---

### C15. `src/app/(dashboard)/dashboard/proxy-pools/page.js` — low conflict

**Change**: Added a "Proxy Fleet" card above the proxy-pool list:
- Toggle enable, Base URL, API key (password field, empty = keep stored key),
  Pool IDs, Providers, Batch Limit, Sync Interval, Request Timeout,
  Report Batch Size.
- Reads via `GET /api/settings` (`data.proxyFleet`), saves via
  `PATCH /api/settings` with a nested `proxyFleet` object.
- Badge shows configured/running state; "Sync Now" button hits
  `POST /api/fleet/sync-now`.
- Every `proxyFleet` field in `.env.example` (FLEET_ENABLED/URL/API_KEY/POOLS/
  PROVIDERS/BATCH_LIMIT/INTERVAL_MS/TIMEOUT_MS/REPORT_BATCH_SIZE) maps to a
  form field; env values are the startup defaults, saved settings override them.

**Re-apply**: The card is self-contained — only depends on `Badge`, `Button`,
`Card`, `Input`, `Toggle`, `useNotificationStore` (all already imported).
If upstream restructures the page, re-insert the fleet card block before the
pool-list `<Card>`.

---

### C16. `open-sse/translator/request/openai-to-kiro.js` + `open-sse/translator/request/claude-to-kiro.js` — low conflict (local-only)

**Change**: The `systemPrompt` line is now **commented out** in both Kiro
request translators so the upstream `systemPrompt` field is NOT sent to
CodeWhisperer. The thinking prefix / agentic prompt / system instruction still
flow through the `contentPrefix` fallback injected into the conversation, which
is what makes it work on the direct-call surface.

In both files the payload block is:

```js
if (profileArn) payload.profileArn = profileArn;
// if (systemPrompt) payload.systemPrompt = systemPrompt;
if (additionalModelRequestFields) {
  payload.additionalModelRequestFields = additionalModelRequestFields;
}
```

**Re-apply**: On conflict, keep the `// if (systemPrompt) payload.systemPrompt = systemPrompt;` line **commented out** in both files. If upstream un-comments or rewrites the line, re-apply the comment. The `systemPrompt` variable must stay (still used for `contentPrefix` / session replay) — only the payload assignment is disabled.

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
# Backend (13 files)
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
node --check open-sse/executors/opencode.js

# UI (4 files)
node --check "src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js"
node --check "src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.js"
node --check "src/app/(dashboard)/dashboard/providers/page.js"
node --check "src/app/api/providers/[id]/test/testUtils.js"

# OAuth import routes (2 files)
node --check "src/app/api/oauth/trae/import/route.js"
node --check "src/app/api/oauth/grok-web/import/route.js"

# Proxy fleet aggregator (6 files)
node --check src/shared/services/proxyFleetSync.js
node --check src/app/api/fleet/sync-now/route.js
node --check src/lib/db/repos/settingsRepo.js
node --check src/app/api/settings/route.js
node --check "src/app/(dashboard)/dashboard/proxy-pools/page.js"
node --check tests/unit/proxyFleetSync.test.js

# Proxy fleet tests (run from repo root)
npx vitest run --config tests/vitest.config.js tests/unit/proxyFleetSync.test.js
```

All should print no errors.

---

## Files NOT ported (deliberate exclusions)

- `open-sse/services/quotaMonitor.js` — excluded per user request
- `src/shared/services/claudeAutoPing.js` — Claude-specific, can add later
- `__unified__` proxy pool feature in ConnectionsCard — unrelated to lifecycle
- Qoder device-token-expiry detection in testUtils — divergent fix, not lifecycle-related
- `CHANGELOG.md` — has an `Unreleased` entry for the trae import route; keep
  our entries when upstream also edits it (merge both, don't drop ours)
- Fleet Go service (`proxy-fleet` repo) — separate project; 9Router is only the
  client side (batch sync + exhaustion reports). Keep the two repos in sync via
  the API contract documented in Section A3.