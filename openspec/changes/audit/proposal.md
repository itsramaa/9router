# OpenSpec Proposal: Provider Toggle, Pause/Cooldown & Test Connection Fixes

**Feature:** provider-toggle-test-fixes  
**Date:** 2026-06-23  
**Priority:** HIGH  
**Updated:** 2026-06-23 (expanded dengan temuan baru dari full trace)

---

## Background

Inspeksi mendalam pada seluruh alur provider management — mulai dari toggle UI, AccountLifecycle, markAccountUnavailable, ModelLockStore, QuotaMonitor, hingga test connection — menemukan **7 bug** yang saling berkaitan.

Ringkasan area yang diinspeksi:
- `providers/page.js` — handleToggleProvider
- `providers/[id]/page.js` — handleRunOneByOneTest, handleBulkActivate/Deactivate
- `accountLifecycle.js` — activate, deactivate, pause, resumeExpiredPauses
- `auth.js` — getProviderCredentials, markAccountUnavailable, clearAccountError
- `cooldownPolicy.js` — classifyError, resolveCooldown
- `modelLockStore.js` — isLockActive, buildClearLocks, getActiveLockKeys
- `quotaMonitor.js` — runQuotaMonitorTick, analyzeQuota, isQuotaRecovered
- `testUtils.js` + `[id]/test/route.js` — testSingleConnection
- `connectionsRepo.js` — getProviderConnections filter

---

## Scope

| ID      | Severity | Description                                                                                          | File(s)                                                   |
| ------- | -------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| BUG-T01 | HIGH     | Provider toggle activate mengaktifkan SEMUA koneksi, termasuk yang di-disable manual                | `providers/page.js`, `accountLifecycle.js`                |
| BUG-T02 | MEDIUM   | `deactivate()` tidak menyimpan pre-deactivate state — tidak bisa restore selektif                   | `accountLifecycle.js`                                     |
| BUG-T03 | HIGH     | Test connection tidak mencerminkan quota/lock/pause state — false positive untuk exhausted accounts  | `testUtils.js`, `[id]/test/route.js`                      |
| BUG-T04 | HIGH     | Akun yang di-pause atau punya modelLock MASIH bisa dipakai chat jika `isActive=true`                | `auth.js` → `getProviderCredentials`                      |
| BUG-T05 | MEDIUM   | `markAccountUnavailable` fetch `getProviderConnections({ provider })` tapi `conn` bisa `undefined`  | `auth.js` → `markAccountUnavailable`                      |
| BUG-T06 | MEDIUM   | `activate()` selalu reset `testStatus="active"` tanpa verifikasi — akun invalid jadi terlihat OK    | `accountLifecycle.js` → `activate`                        |
| BUG-T07 | LOW      | QuotaMonitor hanya monitor `QUOTA_SUPPORTED_PROVIDERS` — provider lain tidak pernah dapat warning   | `quotaMonitor.js`                                         |

---

## Detail Temuan & Requirements

---

### BUG-T01 — Selective Restore on Provider Toggle Activate

**Root cause:**
`handleToggleProvider` di `providers/page.js` mengirim `{ isActive: newActive }` ke SEMUA koneksi provider tanpa melihat state sebelumnya. Ketika `newActive=true`, koneksi yang sengaja di-disable manual (bukan via toggle) ikut ter-aktifkan.

```js
// Saat ini — salah:
providerConns.map((c) => fetch(`/api/providers/${c.id}`, {
  body: JSON.stringify({ isActive: newActive }),  // semua ikut aktif
}))
```

**Requirements:**
- SHALL menambah field `disabledByProviderToggle: boolean | null` pada skema koneksi
- SHALL `handleToggleProvider` (deactivate path) set `disabledByProviderToggle: true` HANYA pada koneksi yang `isActive !== false` saat toggle dijalankan
- SHALL `handleToggleProvider` (activate path) HANYA mengaktifkan koneksi dengan `disabledByProviderToggle: true`
- SHALL setelah restore, `disabledByProviderToggle` di-clear ke `null`
- SHALL `PUT /api/providers/[id]` route menerima dan persist `disabledByProviderToggle`
- SHALL berlaku juga untuk `handleBulkActivate` / `handleBulkDeactivate` di `providers/[id]/page.js`

**Acceptance Criteria:**
1. User punya 3 akun: A (active), B (active), C (disabled manual, `disabledByProviderToggle=null`)
2. Toggle-off provider → A dan B set `isActive=false, disabledByProviderToggle=true`; C tidak berubah
3. Toggle-on provider → hanya A dan B kembali `isActive=true, disabledByProviderToggle=null`; C tetap inactive

---

### BUG-T02 — AccountLifecycle deactivate: Preserve Reason

**Root cause:**
`deactivate()` menghapus semua state (`testStatus: null, lastError: null`) tanpa menyimpan konteks kenapa di-deactivate. Ini membuat tracking susah dan mendukung BUG-T01.

**Requirements:**
- SHALL `deactivate(connectionId, reason?)` menerima optional `reason: "manual" | "provider-toggle" | "ban"`
- SHALL field `deactivateReason` disimpan ke DB
- SHALL `activate()` clear `deactivateReason` saat restore
- SHALL caller di `PUT /api/providers/[id]` pass `reason: "manual"` saat user toggle individual
- SHALL caller di `handleToggleProvider` pass `reason: "provider-toggle"`

---

### BUG-T03 — Test Connection: False Positive untuk Paused/Exhausted Accounts

**Root cause:**
`testSingleConnection` hanya probe endpoint (cek key valid/token exists), sama sekali tidak membaca state DB: `pausedUntil`, `quotaStatus`, `modelLock_*`. Akun yang sudah di-pause oleh chat router masih bisa return `valid: true` di test.

Jalur test (`/api/providers/[id]/test`) dan jalur chat (`getProviderCredentials` + `markAccountUnavailable`) adalah **dua jalur terpisah yang tidak saling berkomunikasi**.

**Sub-feature A: Enrich test response dengan DB state**
- SHALL `testSingleConnection` setelah probe, baca ulang koneksi dari DB dan extract:
  - `isPaused: boolean` — `isActive===false && pausedUntil && pausedUntil > now`
  - `pausedUntil: string | null`
  - `quotaStatus: string | null` — dari field `quotaStatus`
  - `activeLocks: string[]` — dari `getActiveLockKeys(conn)`, strip prefix `modelLock_`
  - `diagnosis: { type: "paused"|"quota_warning"|"model_locked"|"ok", message: string }`
- SHALL `valid` tetap mencerminkan hasil probe endpoint (key/token validity)
- SHALL response `/api/providers/[id]/test` forward semua field tambahan ini
- SHALL UI one-by-one test render `activeLocks` dan `diagnosis` di samping status
- SHALL UI batch test results juga menampilkan `diagnosis` per connection

**Sub-feature B: Deep test via actual chat request**
- SHALL ada mode `POST /api/providers/[id]/test` dengan body `{ mode: "deep" }`
- SHALL deep test call `handleChatCore` dengan `max_tokens: 1` menggunakan `getDefaultModel(provider)`
- SHALL deep test hanya tersedia via explicit request, tidak dijalankan otomatis di one-by-one
- SHALL response deep test: `{ valid, latencyMs, mode: "deep", error }`
- SHALL jika provider tidak punya default model, return `{ valid: false, error: "No default model" }`

---

### BUG-T04 — Akun Paused/Locked Masih Bisa Dipakai Chat

**Root cause:**
Di `getProviderCredentials`, filter yang digunakan adalah:

```js
const connections = await getProviderConnections({ provider: providerId, isActive: true });
```

Ini benar untuk INACTIVE (`isActive=false`). Namun untuk akun yang **di-pause** (`isActive=false, pausedUntil > now`) — mereka sudah di-filter oleh `isActive: true`.

Yang bermasalah adalah akun dengan **modelLock aktif** — mereka `isActive=true`, jadi lolos filter awal. Selanjutnya:

```js
const availableConnections = connections.filter((c) => {
  if (excludeSet.has(c.id)) return false;
  if (isModelLockActive(c, model)) return false;  // <-- ini sudah benar
  return true;
});
```

`isModelLockActive` sudah dicek. **Tapi ada edge case**: ketika `model=null` (tidak ada model spesifik), `isModelLockActive(conn, null)` hanya cek `modelLock___all`, tidak cek lock per-model. Akun dengan `modelLock_gpt-4o` aktif tapi `model=null` → lolos filter → masih bisa dipakai.

**Requirements:**
- SHALL `isModelLockActive(conn, null)` juga cek apakah ada ANY active modelLock field, bukan hanya `modelLock___all`
- SHALL jika ada active lock untuk model apapun saat `model=null`, koneksi dianggap terkunci
- ATAU: sediakan fungsi `hasAnyActiveLock(conn)` di `modelLockStore.js` dan panggil dari `getProviderCredentials` ketika `model=null`

**Acceptance Criteria:**
1. Akun punya `modelLock_gpt-4o` aktif, `model=null` saat credential selection
2. Sebelum fix: akun lolos dan dipakai
3. Setelah fix: akun di-skip, fallback ke akun lain

---

### BUG-T05 — markAccountUnavailable: conn bisa undefined

**Root cause:**
Di `markAccountUnavailable`:

```js
const connections = await getProviderConnections({ provider });
const conn = connections.find((c) => c.id === connectionId);
const backoffLevel = conn?.backoffLevel || 0;
```

`getProviderConnections({ provider })` filter by provider — tapi jika `provider=null` (caller tidak pass provider), query return SEMUA connections. Jika provider salah atau koneksi sudah dihapus, `conn` jadi `undefined`. Ini sudah di-guard dengan `conn?.backoffLevel || 0`, tapi `connName` di bawahnya:

```js
const connName = conn?.displayName || conn?.name || conn?.email || connectionId.slice(0, 8);
```

juga sudah di-guard. **Masalah nyata**: `getProviderConnections({ provider })` tanpa `isActive` filter return SEMUA koneksi termasuk inactive — ini tidak perlu. Tapi lebih penting: kalau `provider=null`, semua koneksi di-load tanpa perlu.

**Requirements:**
- SHALL `markAccountUnavailable` gunakan `getProviderConnectionById(connectionId)` langsung, bukan `getProviderConnections({ provider })`
- Ini lebih efisien (O(1) vs O(n)) dan tidak bergantung pada `provider` yang bisa null
- SHALL `backoffLevel` diambil dari hasil `getProviderConnectionById`

---

### BUG-T06 — activate() Langsung Set testStatus="active" Tanpa Verifikasi

**Root cause:**
`activate()` di `accountLifecycle.js`:

```js
await updateProviderConnection(connectionId, {
  isActive: true,
  testStatus: "active",  // <-- langsung active tanpa test
  lastError: null,
  ...
});
```

Ketika akun di-activate (baik manual maupun via toggle restore), `testStatus` langsung di-set `"active"` — padahal koneksi belum tentu valid. Ini menyebabkan UI menampilkan akun sebagai "connected" padahal mungkin sudah expired/revoked.

Ini juga berinteraksi dengan QuotaMonitor: setelah `lifecycleActivate` di Phase 2 recovery, koneksi langsung terlihat active di UI, tapi tidak ada verifikasi real.

**Requirements:**
- SHALL `activate()` set `testStatus: "untested"` (atau `null`) bukan `"active"`
- SHALL UI dashboard menampilkan `untested` state berbeda dari `active` — misalnya warna abu-abu bukan hijau
- SHALL QuotaMonitor Phase 2 setelah `lifecycleActivate`, trigger `testSingleConnection` sebagai background task (non-blocking) untuk memverifikasi sebelum set active
- ATAU: set `testStatus: null` dan biarkan next chat request yang clear via `clearAccountError`

**Note:** Opsi kedua (set null, clear on chat success) lebih konsisten dengan existing design philosophy.

---

### BUG-T07 — QuotaMonitor Hanya Monitor QUOTA_SUPPORTED_PROVIDERS

**Root cause:**
```js
export const QUOTA_SUPPORTED_PROVIDERS = new Set([
  'claude', 'github', 'codex', 'kiro', 'gemini-cli', 'antigravity', 'qoder',
]);
```

Provider seperti `openai`, `anthropic`, `deepseek`, `openrouter`, `gemini` (API key), dan semua compatible providers tidak masuk monitoring. Mereka tidak mendapat `quotaStatus` warning, tidak ada auto-recovery path via QuotaMonitor.

Untuk provider ini, satu-satunya recovery path adalah:
1. Chat error → `markAccountUnavailable` → pause
2. `resumeExpiredPauses` (time-based, setiap 5 menit)

Ini sebenarnya OK sebagai design (chat-first policy), tapi `testSingleConnection` tidak mengecek `quotaStatus` sehingga user tidak tahu akun sedang di-warning state.

**Requirements (LOW — informatif):**
- SHALL BUG-T03 Sub-feature A sudah cukup untuk expose `quotaStatus` di test result
- SHALL dokumentasikan bahwa non-QUOTA_SUPPORTED providers tidak punya proactive quota check — recovery murni time-based
- NICE TO HAVE: Extend `QUOTA_SUPPORTED_PROVIDERS` dengan provider yang punya usage API (openrouter, gemini)

---

---

### BUG-T08 — pause() dipanggil tapi cooldownMs < LOCK_VS_PAUSE_THRESHOLD_MS: Silent Skip

**Root cause:**
Di `markAccountUnavailable` di `auth.js`:

```js
if (action === 'pause' && cooldownMs >= LOCK_VS_PAUSE_THRESHOLD_MS) {
  await lifecyclePause(connectionId, cooldownMs);
  return { shouldFallback: true, cooldownMs };
}
// Default: per-model lock
```

Jika `classifyError` return `action='pause'` tapi `cooldownMs < LOCK_VS_PAUSE_THRESHOLD_MS` (1 jam), code **jatuh ke default lock path** tanpa ada log atau warning. Ini terjadi untuk:
- Auth errors (`isAuthError: true`) dengan `cooldownMs: COOLDOWN.long = 2min` → action=pause tapi 2min < 1jam → jatuh ke lock, bukan pause
- Kasus Kiro/Qoder yang `action=pause` tapi quota error dengan cooldown pendek

Artinya **auth error (401/403) tidak selalu trigger pause** — hanya jika cooldown cukup lama. Akun dengan auth error bisa terus dipakai di next request setelah 2 menit lock expired.

**Requirements:**
- SHALL jika `action === 'pause'` dan `cooldownMs < LOCK_VS_PAUSE_THRESHOLD_MS`, tetap trigger `lifecyclePause` dengan minimum `LOCK_VS_PAUSE_THRESHOLD_MS` sebagai floor
- ATAU: pisahkan logic — `isAuthError` selalu trigger pause (duration = max(cooldownMs, MIN_AUTH_PAUSE_MS)), `isRateLimit` tetap lock
- SHALL tambah log warning ketika `action=pause` di-downgrade ke lock karena cooldown terlalu pendek

**Acceptance Criteria:**
1. Provider return 401 → `classifyError` → `action=pause, cooldownMs=2min`
2. Sebelum fix: akun di-lock 2 menit, bukan di-pause
3. Setelah fix: akun di-pause minimum 1 jam (atau sesuai policy)

---

### BUG-T09 — testSingleConnection Tidak Skip Inactive/Paused Connections

**Root cause:**
`testSingleConnection(id)` di `testUtils.js` langsung load koneksi dan probe endpoint **tanpa cek** apakah koneksi `isActive`. Jika koneksi sedang di-pause (`isActive=false, pausedUntil > now`), test masih dijalankan dan bisa return `valid: true` — lalu `updateProviderConnection` dipanggil dengan `testStatus: 'active'`.

```js
export async function testSingleConnection(id) {
  const connection = await getProviderConnectionById(id);
  // Tidak ada guard isActive check!
  // ...
  await updateProviderConnection(id, {
    testStatus: result.valid ? 'active' : 'error',  // override state paused!
  });
}
```

Ini bisa **corrupt pause state**: akun yang di-pause oleh QuotaMonitor/chat-first → di-test → `testStatus` di-overwrite ke `'active'` → UI menampilkan akun sebagai connected padahal seharusnya paused.

**Requirements:**
- SHALL `testSingleConnection` cek `isActive` dan `pausedUntil` SEBELUM probe
- SHALL jika koneksi sedang paused (`isActive=false && pausedUntil > now`), skip probe endpoint dan return early dengan `{ valid: false, skipped: true, reason: 'paused', pausedUntil }`
- SHALL `updateProviderConnection` TIDAK dipanggil untuk paused connections (jangan corrupt pause state)
- SHALL response `/api/providers/[id]/test` forward `skipped` dan `reason` fields

---

### BUG-T10 — xAI (Grok): `bad-credentials` Tidak Di-pause, OAuth Test Tidak Ada Config

**Root cause A — `bad-credentials` hanya di-lock 2 menit (KRITIS):**
Dari error log nyata:
```
[403]: {"code":"unauthenticated:bad-credentials","error":"The OAuth2 access token could not be validated."}
```

Jalur penanganan saat ini:
1. `classifyError(403, 'The OAuth2 access token could not be validated.')` — tidak match text rule apapun
2. Jatuh ke status rule: `{ status: 403, cooldownMs: 2min, isAuthError: true, action='pause' }`
3. Di `markAccountUnavailable`: `action='pause'` tapi `cooldownMs=2min < LOCK_VS_PAUSE_THRESHOLD_MS=1jam` → **jatuh ke lock path** (BUG-T08)
4. Akun di-lock 2 menit per model, setelah 2 menit dicoba lagi → error lagi → loop

Note: Error kedua `personal-team-blocked:spending-limit` **sudah handled benar** — match rule `'run out of credits'` → pause 24 jam via `lifecyclePause`. Yang bermasalah hanya `bad-credentials`.

**Root cause B — xAI OAuth test tidak ada config:**
Di `OAUTH_TEST_CONFIG`, xAI tidak ada entry → `testOAuthConnection` return `{ valid: false, error: 'Provider test not supported' }`. Token xAI expire 1 jam, tidak bisa di-refresh via test.

**Requirements:**
- SHALL tambah text rule di `errorConfig.js` untuk `bad-credentials`:
  ```js
  { text: 'bad-credentials', cooldownMs: LOCK_VS_PAUSE_THRESHOLD_MS, isAuthError: true },
  { text: 'access token could not be validated', cooldownMs: LOCK_VS_PAUSE_THRESHOLD_MS, isAuthError: true },
  ```
  Dengan `cooldownMs = LOCK_VS_PAUSE_THRESHOLD_MS` (1 jam), ini akan trigger `lifecyclePause` langsung karena `cooldownMs >= threshold`
- SHALL tambah entry xAI ke `OAUTH_TEST_CONFIG`:
  ```js
  xai: {
    url: 'https://api.x.ai/v1/models',
    method: 'GET',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    refreshable: true,
  }
  ```
- SHALL `testOAuthConnection` untuk xAI refresh token jika expired sebelum probe
- SHALL tambah `refreshXaiToken` handler di `testUtils.js` `refreshOAuthToken` function

---

### BUG-T11 — Qoder: Token Expire Loop + QuotaMonitor Integration Gap

**Root cause:**
Qoder menggunakan device token flow dengan umur ~30 hari. Di `qoder.js` executor:
```js
async refreshCredentials() { return null; }  // device tokens tidak bisa refresh
needsRefresh() { return false; }
```

**Status penanganan Qoder saat ini (dari log `[QuotaMonitor] qoder/... WARNING: Quota exceeded`):**
- QuotaMonitor Phase 1 sudah berjalan: detect `isQuotaExceeded=true` → set `quotaStatus='exhausted'` → log warning — **ini benar by design (chat-first policy)**
- `quotaStatus` hanya untuk UI display, **tidak memblokir chat routing** di `getProviderCredentials`
- Ketika user chat: akun masih lolos filter `isActive=true` → request ke Qoder → error 403 `code:112` → `pricingurl` text rule match → pause 24 jam — **ini sudah handled**
- Setelah 24 jam: `resumeExpiredPauses` aktifkan ulang → QuotaMonitor check lagi → jika quota belum reset, warning lagi → user chat lagi → error lagi → pause lagi → **loop ini expected tapi user experience buruk**

**Gap yang perlu diperbaiki:**
1. `testOAuthConnection` untuk qoder: tidak ada entry → return `'Provider test not supported'`
2. Tidak ada mekanisme deteksi token expire (beda dari quota exhausted) — keduanya return 403 tapi penyebab berbeda
3. Setelah token expire (~30 hari), Qoder API return 403 tapi bukan karena quota — `pricingurl` rule tidak akan match untuk auth error ini, jatuh ke status rule 403 → pause 2 menit lock (BUG-T08)

**Requirements:**
- SHALL tambah entry qoder ke `OAUTH_TEST_CONFIG`:
  ```js
  qoder: {
    url: 'https://openapi.qoder.sh/api/v1/userinfo',
    method: 'GET',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    refreshable: false,
  }
  ```
- SHALL jika test qoder return 401/403 dari userinfo endpoint (bukan dari quota error), set `testStatus: 'expired'` dan `lastError: 'Device token expired — please re-login to Qoder'`
- SHALL `pause loop` guard: setelah `backoffLevel >= 3` saat resume dengan last error terkait auth (bukan quota), set `testStatus: 'expired'` dan skip auto-resume
- SHALL UI tampilkan state `expired` dengan pesan re-login jelas

---

### BUG-T12 — OpenRouter: Free Tier Rate Limit Salah Diklasifikasikan sebagai Quota Exhaustion

**Root cause:**
OpenRouter free tier punya limit **200 req/day** tanpa credits. Ketika limit tercapai, OpenRouter return:
- Status: `429`
- Body: `{ error: { code: 429, message: 'Rate limit exceeded: free-tier daily limit' } }`

Di `errorConfig.js`, rule untuk text `'rate limit'` adalah:
```js
{ text: 'rate limit', backoff: true, isRateLimit: true }
```

Tapi OpenRouter juga bisa return untuk kredit habis:
- Status: `402`
- Body: `{ error: { code: 402, message: 'Insufficient credits' } }`

Masalah:
1. **Free tier daily limit (429 + 'rate limit' text)** → diklasifikasikan sebagai `isRateLimit` → backoff, TIDAK pause → akun terus di-retry sepanjang hari wasting time
2. **Credit exhausted (402)** → diklasifikasikan sebagai `isQuotaExhausted` → pause 24 jam → ini BENAR
3. OpenRouter tidak termasuk `QUOTA_SUPPORTED_PROVIDERS` → tidak ada QuotaMonitor recovery verification
4. Test connection OpenRouter hanya hit `/auth/key` → tidak cek apakah daily limit tercapai

**Requirements:**
- SHALL tambah rule khusus di `errorConfig.js` untuk OpenRouter daily free limit:
  ```js
  { text: 'free-tier daily limit', cooldownMs: COOLDOWN.quota, isQuotaExhausted: true }
  ```
  (checked before generic 'rate limit' rule)
- SHALL rule baru ditempatkan SEBELUM generic `rate limit` rule agar tidak ter-override
- SHALL test connection OpenRouter include credit balance check jika tersedia via `/api/v1/auth/key` response body

---

### BUG-T13 — Kiro: Profile ARN Bisa Stale Setelah Token Refresh

**Root cause:**
Kiro (AWS CodeWhisperer) menggunakan `profileArn` yang disimpan di `providerSpecificData`. Saat token refresh:

```js
return {
  accessToken: tokens.accessToken,
  refreshToken: tokens.refreshToken || refreshToken,
  expiresIn: tokens.expiresIn,
  ...(await resolveKiroProfileArnPatch(providerSpecificData, tokens.accessToken, tokens.profileArn)),
};
```

`resolveKiroProfileArnPatch` mencoba resolve profile ARN dari token baru. Tapi jika ARN resolution gagal (network error, timeout), ARN lama digunakan. Jika ARN lama sudah tidak valid (user ganti subscription tier), semua request ke Kiro akan fail dengan:
- Status: `403`
- Body: auth error terkait profile ARN

Ini diklasifikasikan sebagai `isAuthError` → pause 24 jam → setelah resume, problem berulang karena ARN masih stale.

Tambahan: `testOAuthConnection` untuk Kiro menggunakan `checkExpiry: true` — hanya cek token expiry, tidak validasi ARN. Akun Kiro dengan stale ARN akan test sebagai "valid" tapi gagal saat chat.

**Requirements:**
- SHALL `testOAuthConnection` untuk Kiro tambah ARN validation: setelah token expiry check, hit Kiro API dengan profile ARN dan verifikasi 200 response
- SHALL jika ARN validation gagal, coba re-resolve ARN via `resolveKiroProfileArnPatch`
- SHALL jika re-resolve gagal, set `testStatus: 'error'` dengan pesan `'Profile ARN invalid — token may need re-login'`
- SHALL pada resume dari pause (jika `lastError` contain 'profile' atau 'arn'), force ARN re-resolution sebelum set `isActive: true`

---

### BUG-T14A — SiliconFlow: 503 "System Busy" Tidak Ada Text Rule Spesifik

**Root cause:**
Dari error log nyata:
```
[503]: {"code":50603,"message":"System is really busy. Please try again later.","data":null}
```

Jalur penanganan saat ini:
1. `classifyError(503, 'System is really busy. Please try again later.')` 
2. Check text rules: tidak match `'service unavailable'`, `'capacity'`, `'overloaded'` — tidak ada rule untuk `'really busy'` atau `'try again later'`
3. Tidak ada status rule untuk `503`
4. Jatuh ke default: `{ cooldownMs: TRANSIENT_COOLDOWN_MS=30s, action='lock' }` — akun di-lock 30 detik

Ini **lumayan handled** (fallback ke akun lain setelah 30 detik) tapi tidak optimal. SiliconFlow 503 adalah server overload yang bisa berlangsung lebih lama.

**Requirements:**
- SHALL tambah text rule di `errorConfig.js`:
  ```js
  { text: 'system is really busy', backoff: true, isRateLimit: true },
  { text: 'try again later', backoff: true, isRateLimit: true },
  ```
  Dengan `backoff: true`, cooldown akan exponential (bukan flat 30 detik) dan tidak trigger pause
- Note: `isRateLimit: true` agar tidak trigger pause, karena ini transient server issue bukan quota exhaustion

---

### BUG-T14B — SiliconFlow: Test Hanya Cek `/models` tapi Tidak Cek Balance

**Root cause:**
SiliconFlow test:
```js
case 'siliconflow': {
  const res = await fetchWithConnectionProxy(
    'https://api.siliconflow.com/v1/models',
    { headers: { Authorization: `Bearer ${connection.apiKey}` } },
    effectiveProxy
  );
  return { valid: res.ok, error: res.ok ? null : 'Invalid API key' };
}
```

SiliconFlow adalah pay-per-use API. Ketika kredit habis:
- `/v1/models` tetap return `200 OK` (key valid)
- Chat requests return `402 Payment Required` + `{ error: 'Insufficient credits' }`

Sehingga test connection SiliconFlow selalu return `valid: true` meski kredit sudah 0. Tidak ada path untuk mendeteksi exhausted credits sebelum chat attempt.

SiliconFlow juga tidak ada di `QUOTA_SUPPORTED_PROVIDERS` → tidak ada proactive monitoring.

**Requirements:**
- SHALL test SiliconFlow tambah balance check via `GET https://api.siliconflow.com/v1/user/info` (atau equivalent)
- SHALL jika balance < threshold (misal < $0.01), return `valid: true` tapi `diagnosis: { type: 'quota_warning', message: 'Credits nearly exhausted' }`
- SHALL ini consistent dengan BUG-T03A enriched response format

---

### INKON-03 — `markAccountUnavailable` Pause Path Tidak Update `backoffLevel`

**Root cause:**
Di `markAccountUnavailable`, lock path update `backoffLevel`:
```js
await updateProviderConnection(connectionId, {
  ...lockUpdate,
  backoffLevel: newBackoffLevel ?? backoffLevel,  // ✅ update
});
```

Tapi pause path melalui `lifecyclePause()` **tidak update `backoffLevel`**:
```js
// pause() di accountLifecycle.js
await updateProviderConnection(connectionId, {
  isActive: false,
  pausedUntil,
  testStatus: 'unavailable',
  // backoffLevel TIDAK di-update
});
```

`newBackoffLevel` dari `resolveCooldown` tidak di-pass ke `lifecyclePause`. Setelah akun di-pause dan di-resume, `backoffLevel` masih nilai lama (tidak incremented). Escalation logic di `classifyError` (`newLevel >= ESCALATION_THRESHOLD=8`) akan under-count karena basis backoffLevel yang stale.

**Requirements:**
- SHALL `markAccountUnavailable` update `backoffLevel` pada DB **sebelum atau sesudah** call `lifecyclePause`, terpisah dari lifecycle call
- SHALL `pause()` di `accountLifecycle.js` terima optional `backoffLevel` parameter atau caller update sendiri
- ATAU: `markAccountUnavailable` langsung call `updateProviderConnection` untuk `backoffLevel` setelah `lifecyclePause`

---

### INKON-10 — `deactivate()` Tidak Clear `pausedUntil` — Auto-Resume Bahaya

**Root cause:**
```js
// deactivate() — TIDAK clear pausedUntil
await updateProviderConnection(connectionId, {
  isActive: false,
  testStatus: null,
  lastError: null,
  lastErrorAt: null,
  errorCode: null,
  backoffLevel: 0,
  // pausedUntil TIDAK di-clear!
});
```

Jika koneksi pernah di-pause lalu di-deactivate manual, `pausedUntil` masih tersimpan. Di `getState()`:
```js
if (conn.isActive === false) {
  if (conn.pausedUntil && new Date(conn.pausedUntil).getTime() > Date.now()) {
    return ACCOUNT_STATE.PAUSED;  // ← salah! harusnya INACTIVE
  }
  return ACCOUNT_STATE.INACTIVE;
}
```

Koneksi manual-deactivated dengan `pausedUntil` future akan:
1. Terlihat sebagai **PAUSED** bukan **INACTIVE** di `getState()`
2. **Otomatis di-resume** oleh `resumeExpiredPauses` scheduler setelah `pausedUntil` expired
3. User yang sengaja disable akun → akun aktif kembali tanpa sepengetahuannya

Ini berinteraksi dengan BUG-T01: jika user toggle-off provider card, semua akun di-deactivate tapi `pausedUntil` tidak di-clear. Scheduler 5 menit bisa auto-resume beberapa akun sebelum user toggle-on kembali.

**Requirements:**
- SHALL `deactivate()` selalu clear `pausedUntil: null`
- SHALL `getState()` tidak perlu diubah setelah fix ini (behavior akan konsisten sendiri)
- SHALL unit test: deactivate koneksi yang punya `pausedUntil` future → `pausedUntil` ter-clear → `getState()` return INACTIVE bukan PAUSED

---

### INKON-05 — `clearAccountError()` Pakai Snapshot Lama `_connection` — Race dengan QuotaMonitor

**Root cause:**
```js
export async function clearAccountError(connectionId, currentConnection, model = null) {
  const conn = currentConnection._connection || currentConnection;
  // conn adalah snapshot dari saat credentials dipilih
```

`_connection` adalah data koneksi pada saat `getProviderCredentials()` dipanggil. Antara saat itu dan saat `clearAccountError` dipanggil (setelah chat sukses), QuotaMonitor bisa sudah set `quotaStatus='exhausted'`. `clearAccountError` akan clear `quotaStatus` berdasarkan snapshot lama yang belum aware ada update QuotaMonitor.

**Impact:** QuotaMonitor warning di-clear oleh successful chat, padahal quota masih exhausted. QuotaMonitor akan set warning lagi di tick berikutnya (10 menit), tapi window ini menyebabkan akun yang quota-exhausted bisa kena request tambahan.

**Requirements:**
- SHALL `clearAccountError` baca fresh data dari DB sebelum decide apa yang perlu di-clear, bukan pakai snapshot `_connection`
- ATAU: gunakan `getProviderConnectionById(connectionId)` untuk fresh read sebelum build `clearObj`
- Note: ini bisa menambah 1 DB read per successful request — perlu evaluate performance tradeoff

---

### INKON-04 — `resumeExpiredPauses` Dipanggil 2 Tempat — Koneksi Baru Resume Bisa Langsung Dipilih

**Root cause:**
Di `getProviderCredentials`:
```js
try {
  await resumeExpiredPauses(providerId);
} catch (e) {
  log.warn('AUTH', `Failed to resume expired pauses for ${providerId}: ${e.message}`);
}
// Langsung dilanjutkan ke credential selection
```

Urutan eksekusi:
1. Resume expired pauses untuk provider X
2. Koneksi yang baru di-resume langsung masuk ke pool `connections` (query berikutnya)
3. Koneksi ini bisa langsung dipilih untuk request yang sedang berjalan

Koneksi yang baru di-resume **belum di-verify** (testStatus='active' tanpa test) dan belum tentu quota-nya sudah recover. Ini berinteraksi dengan INKON-01/BUG-T06.

**Requirements:**
- SHALL `resumeExpiredPauses` dalam `getProviderCredentials` tidak auto-resume koneksi yang `quotaStatus='exhausted'` — biarkan QuotaMonitor Phase 2 yang handle
- ATAU: setelah resume, koneksi diberi `testStatus=null` bukan `'active'` sehingga `getEffectiveStatus` di UI tidak menampilkan sebagai connected
- Note: ini terkait dengan BUG-T06 fix (activate testStatus)

---

### INKON-01 — `activate()` vs `deactivate()` Philosophy Tidak Konsisten

**Root cause:**
```js
// activate() — langsung set active
testStatus: "active"

// deactivate() — defensive clear
testStatus: null
```

`deactivate()` tidak assume state (set null), tapi `activate()` langsung claim state valid (set 'active'). Ini inkonsisten. Seharusnya keduanya menggunakan pendekatan yang sama.

**Note:** Ini sudah partial di-capture oleh BUG-T06. INKON-01 menambahkan konteks bahwa ini bukan hanya bug tapi filosofi design yang perlu di-align.

**Requirements:**
- SHALL `activate()` set `testStatus: null` (align dengan BUG-T06 fix)
- SHALL `resumeExpiredPauses()` juga set `testStatus: null` (align dengan BUG-T06 fix)
- SHALL semua caller yang expect `testStatus='active'` setelah activate harus di-audit

---

## Interaction Map

```
BUG-T01 (toggle) → depends on → BUG-T02 (deactivate reason)
BUG-T01 (toggle) → worsened by → INKON-10 (deactivate tidak clear pausedUntil)
BUG-T03 (test accuracy) → exposes → BUG-T04 (paused still used in chat)
BUG-T04 (model=null lock bypass) → fixed in → modelLockStore.js
BUG-T05 (markAccountUnavailable inefficiency) → independent fix
BUG-T06 (activate testStatus) → same as → INKON-01 (philosophy alignment)
BUG-T06 → affects → INKON-04 (resumed koneksi langsung dipilih)
BUG-T07 (quota monitor scope) → partially fixed by → BUG-T03 Sub-feature A
BUG-T08 (pause action silent downgrade) → affects → xAI bad-credentials, Qoder, Kiro
BUG-T08 → worsens → INKON-03 (backoffLevel stale setelah pause)
BUG-T09 (testSingleConnection corrupt pause state) → related to → BUG-T03, BUG-T06
BUG-T10 (xAI bad-credentials + OAuth test) → partial fix in → errorConfig.js + OAUTH_TEST_CONFIG
BUG-T11 (Qoder token expire loop) → related to → BUG-T08, INKON-03
BUG-T12 (OpenRouter free tier misclassified) → fixed in → errorConfig.js rule order
BUG-T13 (Kiro stale ARN) → related to → BUG-T06, BUG-T09
BUG-T14A (SiliconFlow 503 no rule) → fixed in → errorConfig.js
BUG-T14B (SiliconFlow balance) → fixed by → BUG-T03A + balance API call
INKON-03 (backoffLevel tidak update saat pause) → affects → escalation accuracy
INKON-04 (resumed koneksi langsung dipilih) → related to → BUG-T06, INKON-05
INKON-05 (clearAccountError snapshot lama) → race with → QuotaMonitor
INKON-10 (deactivate tidak clear pausedUntil) → causes → auto-resume bahaya
```

---

## Out of Scope

- Tidak mengubah `pause()` dan `resumeExpiredPauses()` behavior (kecuali BUG-T08)
- Tidak mengubah fallback orchestrator
- Tidak mengubah UI cards tampilan di providers page (hanya state logic dan API response)
- Tidak extend `QUOTA_SUPPORTED_PROVIDERS` untuk semua provider (BUG-T07 LOW, BUG-T12 targeted fix saja)

---

## Dependencies

| File | Kebutuhan |
|------|-----------|
| `@/lib/localDb` | `updateProviderConnection`, `getProviderConnectionById` |
| `@/shared/services/accountLifecycle` | `activate`, `deactivate` — dimodifikasi |
| `open-sse/services/modelLockStore` | `getActiveLockKeys`, tambah `hasAnyActiveLock` |
| `src/sse/services/auth.js` | `getProviderCredentials`, `markAccountUnavailable` |
| `open-sse/services/cooldownPolicy.js` | `LOCK_VS_PAUSE_THRESHOLD_MS`, pause floor logic (BUG-T08) |
| `open-sse/config/errorConfig.js` | tambah OpenRouter free-tier rule (BUG-T12) |
| `src/app/api/providers/[id]/test/testUtils.js` | BUG-T03, T09, T10, T11, T13, T14 |
| `handleChatCore` | untuk BUG-T03 deep test mode |
| `providers/page.js` | `handleToggleProvider` |
| `providers/[id]/page.js` | `handleBulkActivate`, `handleBulkDeactivate` |
| `PUT /api/providers/[id]` route | persist `disabledByProviderToggle`, pass reason |

---

## Risk

| Risk | Mitigasi |
|------|----------|
| `disabledByProviderToggle` field baru: perlu default value handling di DB | SQLite dynamic columns — default `null`, tidak perlu migration |
| BUG-T04 fix di `isModelLockActive` bisa over-block koneksi | Hanya berlaku saat `model=null` — scope terbatas |
| BUG-T06 ubah `testStatus="active"` ke `null` — UI bisa terlihat berbeda | UI perlu handle `null` state dengan graceful fallback |
| Deep test (BUG-T03B) mengkonsumsi 1 token per koneksi | Hanya via explicit `mode=deep`, tidak otomatis |
| BUG-T05 `getProviderConnectionById` vs `getProviderConnections` — behavior slightly different | `getProviderConnectionById` tidak filter `isActive` — sudah correct karena kita perlu backoff dari koneksi manapun |
| BUG-T08 menaikkan floor pause untuk auth errors — bisa lock lebih lama dari sebelumnya | Hanya berlaku untuk `action=pause` yang sebelumnya di-downgrade ke lock; net effect lebih protective |
| BUG-T09 skip probe untuk paused connections — test UI mungkin tidak ada hasil untuk koneksi paused | UI perlu handle `skipped: true` response dengan info yang jelas |
| BUG-T11 Qoder pause loop detection — logic harus track jumlah pause cycles | Perlu tambah field `pauseCycleCount` atau baca dari `backoffLevel` yang sudah ada |
| BUG-T12 OpenRouter rule baru — harus ditempatkan SEBELUM generic 'rate limit' rule | Test dengan `errorConfig` unit test untuk verifikasi rule order |

---

## Priority Order Implementasi

**Fase 1 — Core routing correctness (tidak ada UI changes):**
1. **BUG-T05** — Quick fix, isolated
2. **BUG-T04** — Fix model=null lock bypass di credential selection
3. **BUG-T08** — Fix pause floor untuk auth errors
4. **BUG-T12** — Fix OpenRouter free-tier misclassification (1 rule di errorConfig)

**Fase 2 — Lifecycle & state correctness:**
5. **BUG-T02** — Foundation untuk BUG-T01
6. **BUG-T01** — Main user-facing toggle bug
7. **BUG-T06** — activate testStatus fix
8. **BUG-T09** — testSingleConnection skip paused connections

**Fase 3 — Test accuracy & provider-specific fixes:**
9. **BUG-T03A** — Enrich test response dengan DB state
10. **BUG-T10** — xAI OAuth test config
11. **BUG-T11** — Qoder expire loop detection
12. **BUG-T13** — Kiro stale ARN detection
13. **BUG-T14** — SiliconFlow balance check

**Fase 4 — Optional / deferred:**
14. **BUG-T03B** — Deep test via actual chat request
15. **BUG-T07** — Dokumentasi + nice-to-have

---

## Approval Gate

Spec ini HARUS disetujui sebelum implementasi dimulai.
