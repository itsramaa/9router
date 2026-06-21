# bulk-accounts Integration Analysis

> Deep trace of all bugs and mismatches between `bulk-accounts/` and `src/` (automation layer).
> Date: 2026-06-20. **READ-ONLY — do not change code based on this file alone.**

---

## CRITICAL — System Cannot Start or Harvest

### BUG-01: `run.py` missing `--server` flag → immediate crash

**Symptom:** `run.py: error: unrecognized arguments: --server --port 8765`

**Root cause:** `processManager.js` spawns:

```js
spawn(python, ['run.py', '--server', '--port', String(resolvedPort)]);
```

The refactored `run.py` had `--server` removed entirely. The old `run.py` had:

```python
if args.server:
    import server
    web.run_app(server.create_app(), host="0.0.0.0", port=args.port)
```

This no longer exists.

**What needs to change:** Either:

- A) Change `processManager.js` to spawn `server.py` directly: `["server.py", "--port", String(resolvedPort)]`
- B) Restore `--server` flag in `run.py` that delegates to `server.py`

Option A is cleaner. `processManager.js` startup detection already checks for `[server] Dashboard` and `[server] WebSocket` which `server.py` does print.

**File:** `src/lib/automation/processManager.js` line ~`spawn(python, ["run.py", "--server", ...`

---

### BUG-02: Accounts sent from frontend have no passwords → harvest crashes

**Symptom:** Harvest subprocess starts but `account["password"]` raises KeyError or is empty.

**Root cause chain:**

1. `AccountsPanel` fetches `GET /api/automation/accounts` which returns `{ id, email, tags, createdAt }` — **passwords stripped intentionally**
2. `page.js` `handleStart()` sends `accounts: accounts` in body → handlers.py receives passwordless objects
3. `handlers.py` writes these to `temp-accounts.json`
4. `run.py` loads `temp-accounts.json` via `AccountLoader.from_json()` — no `password` field
5. `HarvestWorker(email=account["email"], password=account["password"])` → `KeyError: 'password'`

**Meanwhile:** `processManager.js` already syncs accounts WITH passwords from `getAutomationAccountsForSync()` to `accounts.json` before server starts. This is the correct source.

**What needs to change:**

- `page.js` `handleStart()`: remove `accounts: accounts` from body (stop sending passwordless data)
- `handlers.py`: remove the `custom_accounts` path entirely OR validate accounts have passwords before using them; fall back to `accounts.json` always
- The `accounts` state in `page.js` should only be used for the `accounts.length === 0` guard, never sent to the server

---

## HIGH — Functional but Broken

### BUG-03: `inject-key` rejects all harvest providers except `siliconflow` and `openrouter` — **FIXED** ✅

**Symptom:** Keys harvested but not saved to DB — silent 400 errors on inject calls.

**Root cause (fixed):** `inject-key/route.js` now validates against `AI_PROVIDERS` (all categories) and uses `authType` from the payload/registry instead of hardcoding "apikey". Also includes `PROVIDER_ID_MAP` for `kilocode` → `kilocode` mapping.

---

### BUG-04: `kilocode` Python id does not match registry id `kilocode` — **FIXED** ✅

**Symptom:** If kiro inject worked, `kilocode` key would still fail with "Unknown provider: kilocode".

**Root cause (fixed):** `inject-key/route.js` now includes `PROVIDER_ID_MAP` that maps `kilocode` → `kilocode` before validation.

---

### BUG-05: `handleStart` still sends `accounts` — should be removed

See BUG-02. Even after BUG-02 is fixed on the server side, the frontend should stop sending accounts to avoid confusion. The guard `accounts.length === 0` is valid but the data should never be sent.

---

## MEDIUM — Degraded Behavior

### BUG-06: `display_mode=virtual` on Windows silently becomes headed (False)

**Root cause:** `handlers.py` now sets `BATCHER_CAMOUFOX_HEADLESS=virtual`. `browser.py`:

```python
_headless_env = os.getenv("BATCHER_CAMOUFOX_HEADLESS", "true").lower()
if _headless_env == "true":
    _headless_val = True
else:
    if sys.platform.startswith("linux") and not os.environ.get("DISPLAY") ...:
        _headless_val = "virtual"
    else:
        _headless_val = False   # ← on Windows this is headed, not virtual
```

On Windows, `virtual` mode → headed browser opens. No error, just silently different behavior.

**What needs to change:** `browser.py` should check `_headless_env == "virtual"` explicitly and handle it. Or `handlers.py` should map `virtual` → `false` on Windows and only send `virtual` on Linux.

---

### BUG-07: `daemon.lock` not cleaned up when processManager kills server.py directly

**Root cause:** `run.py` registers `atexit` to remove `daemon.lock`. But `daemon.lock` is only created by `run.py` during harvest. When processManager kills `server.py`, `server.py` doesn't own the lock — it's the `run.py` harvest subprocess that does. If that subprocess is killed via SIGKILL (skipping atexit), the lock persists.

`handlers.py` `handle_stop()` does delete `daemon.lock` — this is correct. But if the harvest subprocess is killed from outside (e.g., processManager kills the whole server), `handle_stop()` never runs. The stale-PID check in `run.py` handles this case.

**Status:** Mostly handled. The stale-PID detection (OpenProcess on Windows) in `run.py` should auto-clear the lock on next start.

---

### BUG-08: `--headless` CLI arg in `run.py` is dead code

**Root cause:** `run.py` has `--headless, action="store_true", default=True` but:

1. `handlers.py` never passes `--headless` to the subprocess cmd
2. `run.py` `main()` sets `os.environ["BATCHER_CAMOUFOX_HEADLESS"] = os.environ.get("BATCHER_CAMOUFOX_HEADLESS", "true")` — this PRESERVES the env var set by `handlers.py`, ignoring `args.headless`
3. So `args.headless` is computed but never used

**What needs to change:** Remove `--headless` from `run.py` parser, remove `args.headless` reference. Headless mode is fully controlled via env var from `handlers.py`.

---

### BUG-09: processManager.js startup detection string mismatch (partial)

**What processManager.js looks for:**

```js
line.includes('[server] Dashboard') ||
  line.includes('[server] WebSocket') ||
  line.includes('[run.py] URL:') ||
  line.includes('[run.py] Starting dashboard') ||
  line.includes('Application startup complete');
```

**What `server.py` actually prints:**

```python
print(f"[server] Dashboard  -> http://{args.host}:{args.port}", flush=True)
print(f"[server] WebSocket  -> ws://{args.host}:{args.port}/ws", flush=True)
```

`[server] Dashboard` ✅ matches. `[server] WebSocket` ✅ matches. The `[run.py]` strings are dead (only triggered if run.py --server mode is kept).

**Status:** OK once BUG-01 is fixed by spawning `server.py` directly.

---

## LOW — Cosmetic / Minor

### BUG-10: `headless` field still sent from `page.js` but unused server-side

`page.js` sends both `headless: getHeadless(config.displayMode)` and `display_mode: config.displayMode`. `handlers.py` now reads `display_mode` and ignores `headless`. Harmless but messy.

### BUG-11: `DEFAULT_CONFIG.providers` includes `openrouter` but user may not have it enabled

Default config in `page.js`: `providers: ['kiro', 'openrouter']`. If user only wants kiro, they need to manually deselect. Minor UX issue.

### BUG-12: Double log entries in processManager logs

processManager.js logs buffer is flushed to the log stream on reconnect, causing old entries to appear twice. This is the `getLogs()` replay on SSE reconnect. Not a bug per se, visual noise.

---

## Fix Priority Order

| Priority | Bug                                          | File(s) to change                                                                    |
| -------- | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| P0       | BUG-01: `--server` removed from run.py       | `processManager.js` (spawn `server.py` directly)                                     |
| P0       | BUG-02: Accounts have no passwords           | `page.js` (remove `accounts` from body), `handlers.py` (remove custom_accounts path) |
| P1       | BUG-03: inject-key rejects kiro/deno         | `inject-key/route.js` (use AI_PROVIDERS or broader check)                            |
| P1       | BUG-04: `kilocode` vs `kilocode` id mismatch | `config.py` rename OR registry alias                                                 |
| P2       | BUG-06: virtual mode on Windows              | `browser.py` explicit virtual check                                                  |
| P3       | BUG-08: dead `--headless` arg                | `run.py` parser cleanup                                                              |
| P3       | BUG-10: redundant `headless` field           | `page.js` handleStart body                                                           |

---

## Architecture Summary (Current State)

```
Next.js (port 20128)
  └─ processManager.js
       ├─ syncs accounts (WITH passwords) → bulk-accounts/accounts.json
       └─ spawns: python run.py --server --port 8765  ← BUG-01: should be server.py

  bulk-accounts/server.py (port 8765)  ← aiohttp WS+HTTP server
    └─ POST /api/start → handlers.py
         ├─ reads custom_accounts from body (NO passwords) ← BUG-02
         └─ spawns: python run.py --accounts temp-accounts.json --providers kiro,...

  bulk-accounts/run.py  ← harvest subprocess
    └─ HarvestWorker → browser automation → Emit JSON → stdout
         └─ ws.py streams stdout → WS → page.js

  page.js result handler
    └─ POST /api/automation/inject-key {provider, key, email}
         └─ validates provider in APIKEY/FREE_TIER/WEB_COOKIE ← BUG-03: kiro/deno not in these
              └─ createProviderConnection(authType="apikey") ← wrong for kiro (token)
```

---

## What Was Already Fixed Correctly

- `Config.INTERACTIVE_MODE = False` ✅
- `ConfigPanel` providers trimmed to active set ✅
- `display_mode` → `BATCHER_CAMOUFOX_HEADLESS` mapping in handlers.py ✅
- `InteractModal` viewport 1366×768 ✅
- `inject-key` localhost bypass ✅
- `AccountsPanel` self-managed (no accounts prop) ✅
- `key_preview` removed from results (uses full key from `result` event) ✅
- Stale lock file detection with OpenProcess on Windows ✅
- `core/interact_terminal.py` removed ✅
- `core/ui.py` slimmed to NullWriter ✅

---

## ADDITIONAL FINDINGS (post-initial-audit)

### BUG-13: Harvest subprocess orphaned on Windows when processManager kills server.py

**Symptom:** After stopping server from UI, camoufox browser processes and
un.py remain running.

**Root cause:** handlers.py spawns run.py via syncio.create_subprocess_exec with no creationflags. On Windows, child processes are NOT automatically killed when the parent dies (unlike Unix process groups). When processManager calls server.py.kill("SIGKILL"), it terminates server.py but the harvest run.py subprocess — and all camoufox browser children of run.py — become orphaned. They keep running until the machine is rebooted or manually killed.

**handle_stop does handle this correctly** (terminates proc, waits, force-kills) — but that only runs when Stop is clicked inside the UI BEFORE the server is killed. If processManager kills the server directly (e.g., user clicks Stop Server), run.py never gets the signal.

**What needs to change:**

- handlers.py: Use creationflags=subprocess.CREATE_NEW_PROCESS_GROUP (Windows) when spawning run.py, so killing the process group kills all children
- OR: processManager.js stopServer() should first call /api/stop on the Python server before killing it, giving it a chance to clean up the harvest subprocess

---

### BUG-14: kiro authType in registry — inject-key saves with wrong authType — **FIXED** ✅

**Symptom:** kiro connection saved to DB with authType: "apikey" but kiro executor expects a refresh token credential.

**Root cause (fixed):** inject-key/route.js now:

1. Uses `authType` from the payload (Python sends it from `Config.PROVIDER_REGISTRY`), falling back to `AI_PROVIDERS[provider].authType`, then "apikey"
2. For kiro specifically, calls `exchangeKiroToken()` to convert the harvested refreshToken into an accessToken + profileArn + expiresAt BEFORE saving
3. Saves `providerSpecificData: { authMethod: "imported", provider: "Imported", profileArn }` matching what `/api/oauth/kiro/import` stores

### BUG-14-OLD: kiro has no uthType in registry — inject-key saves it with wrong uthType: "apikey"

**Symptom:** kiro connection saved to DB with uthType: "apikey" but kiro executor expects a refresh token credential, not an API key. Using the saved kiro connection later would fail authentication.

**Root cause:** kiro.js registry entry has category: "free" and no uthType field. The kiro executor uses an AWS SSO/OIDC refresh token flow — the "key" harvested is a refresh token, not an API key. inject-key/route.js calls createProviderConnection({ authType: "apikey", ... }) for all providers unconditionally. For kiro, this is wrong.

**Note:** This bug only matters if BUG-03 is fixed (kiro injection currently rejected before reaching createProviderConnection).

**What needs to change:**

- inject-key/route.js: Look up uthType from the registry (AI_PROVIDERS[provider]?.authType) and use that instead of hardcoding "apikey"
- If uthType is missing from registry (like kiro), default to the appropriate type based on category (free → token/cookie, apikey → apikey)

---

### BUG-15: `email_in_connection_list` cross-provider false-positive skip — **FIXED** ✅

**Symptom:** Harvest for kiro is skipped with "Already connected" even when the email only exists for a different provider (e.g. gemini).

**Root cause:** `dashboard.py` `email_in_connection_list(email)` checked ALL connections regardless of provider. If the same email was already registered for gemini, the kiro harvest would be incorrectly skipped.

**Fix (dashboard.py):** Added `provider: str = ""` parameter. When given, filters `connections` list to only that provider before matching. Backward-compatible — existing callers without `provider` arg still check all connections.

**All harvest files updated:**

- `kiro.py` → `email_in_connection_list(email, provider="kiro")`
- `antigravity.py` → `provider="antigravity"`
- `xai.py` → `provider="xai"`
- `kilocode.py` → `provider="kilocode"` (registry id, not Python id)
- `qoder.py` → `provider="qoder"`
- `google_ai_studio.py` → `provider="gemini"` (registry id)

---

### CONFIRMED: getAutomationAccountsForSync includes passwords ✅

Verified in src/lib/db/repos/automationAccountsRepo.js:
`js
export async function getAutomationAccountsForSync() {
  const rows = db.all("SELECT email, password FROM automationAccounts ORDER BY createdAt ASC");
  return rows.map((r) => ({ email: r.email, password: r.password }));
}
`
So processManager.js sync to ccounts.json IS correct — passwords are present. BUG-02 description is accurate: the issue is only that page.js sends the passwordless frontend list instead of relying on the already-synced server-side ccounts.json.
