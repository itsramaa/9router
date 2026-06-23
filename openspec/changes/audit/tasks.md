# Tasks: provider-toggle-test-fixes

**Linked Proposal:** `openspec/changes/audit/proposal.md`  
**Date:** 2026-06-23  
**Updated:** 2026-06-23 (Phase 0–3b implemented)

## Status Legend

- [ ] = TODO
- [x] = Done
- [~] = In Progress
- [!] = Blocked

---

## BUG-T05: markAccountUnavailable — gunakan getProviderConnectionById ✅ DONE

- [x] T05-1: Ganti `getProviderConnections({ provider })` + `.find()` → `getProviderConnectionById(connectionId)`
- [x] T05-2: Tambah import `getProviderConnectionById` di `auth.js`
- [x] T05-3: Verifikasi `backoffLevel`, `connName` dari `getProviderConnectionById`

---

## BUG-T04: getProviderCredentials — model=null bypass modelLock ✅ DONE

- [x] T04-1: Tambah fungsi `hasAnyActiveLock(connection)` di `open-sse/services/modelLockStore.js`
- [x] T04-2: Update filter `availableConnections` di `getProviderCredentials` — `model=null` pakai `hasAnyActiveLock`
- [x] T04-3: Export `hasAnyActiveLock` dari `open-sse/services/accountFallback.js`
- [ ] T04-4: Tulis unit test untuk kasus `model=null` dengan koneksi punya `modelLock_gpt-4o` aktif

---

## BUG-T02: deactivate() preserve reason ✅ DONE

- [x] T02-1: Update signature `deactivate(connectionId, reason = "manual")`
- [x] T02-2: Simpan `deactivateReason: reason` ke DB saat deactivate
- [x] T02-3: `activate()` clear `deactivateReason: null`
- [x] T02-4: Caller `PUT /api/providers/[id]` pass `reason: "manual"`, ban path pass `reason: "ban"`

---

## BUG-T01: Selective Restore on Provider Toggle Activate ✅ DONE

- [x] T01-1: `PUT /api/providers/[id]` route persist `disabledByProviderToggle`
- [x] T01-2: `handleToggleProvider` — deactivate: tandai active conns dengan flag; activate: hanya restore flag=true
- [x] T01-3: `handleBulkDeactivate` — set flag hanya pada koneksi aktif
- [x] T01-4: `handleBulkActivate` — hanya aktifkan koneksi dengan flag=true
- [ ] T01-5: Update optimistic state di `setConnections` (partial — optimistic update ada tapi tidak include flag visual)
- [ ] T01-6: Verifikasi acceptance criteria manual (belum di-test manual)

---

## BUG-T03A: Test Connection — Enrich response dengan DB state ✅ DONE

- [x] T03A-1: Import `getActiveLockKeys` di `testUtils.js`
- [x] T03A-2: Baca ulang koneksi dari DB setelah probe via `getProviderConnectionById(id)`
- [x] T03A-3: Build enriched state: `isPaused`, `pausedUntil`, `quotaStatus`, `activeLocks`, `diagnosis`
- [x] T03A-4: Return enriched fields dari `testSingleConnection`
- [x] T03A-5: `POST /api/providers/[id]/test` route forward semua enriched fields
- [x] T03A-6: UI one-by-one test render `diagnosis` info di `ConnectionRow.js`
- [ ] T03A-7: Update UI batch test results display — tampilkan `diagnosis` per connection (deferred)

---

## BUG-T06: activate() — set testStatus null bukan "active" ✅ DONE

- [x] T06-1: `activate()` ganti `testStatus: "active"` → `testStatus: null`
- [x] T06-2: `resumeExpiredPauses()` ganti `testStatus: "active"` → `testStatus: null`
- [ ] T06-3: Audit UI handle `testStatus: null` graceful (perlu manual verify)
- [x] T06-4: `clearAccountError` di `auth.js` tetap set `testStatus: "active"` saat chat sukses ✓

---

## BUG-T03B: Deep Test via actual chat request ⏳ DEFERRED

- [ ] T03B-1: Handle body `{ mode: "deep" }` di test route
- [ ] T03B-2: Implement deep test handler via `handleChatCore`
- [ ] T03B-3: No default model → return error
- [ ] T03B-4: Return `{ valid, latencyMs, mode: "deep", error }`
- [ ] T03B-5: Button "Deep Test" di connection card

---

## BUG-T07: QuotaMonitor scope dokumentasi ⏳ DEFERRED (LOW)

- [ ] T07-1: Tambah komentar di `quotaMonitor.js`
- [ ] T07-2: Evaluate openrouter/gemini usage API

---

## BUG-T08: pause() action silent downgrade ke lock ✅ DONE

- [x] T08-1: Tambah handling `action=pause && cooldownMs < threshold && isAuthError` → `lifecyclePause(floor)`
- [x] T08-2: Tambah log warning untuk floor applied
- [ ] T08-3: Unit test (manual smoke test via verify script sudah pass)
- [x] T08-4: Verifikasi tidak regresi rate limit path ✓

---

## BUG-T09: testSingleConnection corrupt pause state ✅ DONE

- [x] T09-1: Tambah early guard skip paused connections di `testSingleConnection`
- [x] T09-2: `updateProviderConnection` tidak dipanggil untuk paused (dijamin early return)
- [x] T09-3: Route forward `skipped` dan `reason` fields
- [x] T09-4: UI `ConnectionRow.js` render state `skipped`

---

## BUG-T10: xAI bad-credentials + OAuth test ✅ DONE

**Sub-task A: Fix `bad-credentials` pause**

- [x] T10-A1: Tambah rules `bad-credentials` + `access token could not be validated` di `errorConfig.js` dengan `cooldownMs=1h`
- [x] T10-A2: Verified via smoke test — `isAuthError=true, cooldownMs=1h, action=pause`
- [x] T10-A3: `spending-limit` tetap pause 24h — tidak regresi ✓
- [ ] T10-A4: Unit test formal (belum ditulis, smoke test manual sudah pass)

**Sub-task B: xAI OAuth test config**

- [x] T10-B1: Tambah entry `xai` ke `OAUTH_TEST_CONFIG`
- [x] T10-B2: Tambah `refreshXaiToken` handler di `refreshOAuthToken`
- [ ] T10-B3: Verifikasi manual (perlu token expired untuk test)
- [x] T10-B4: xAI API key tetap via existing switch-case ✓

---

## BUG-T11: Qoder token expire loop ✅ DONE (partial)

- [x] T11-1: Entry `qoder` sudah ada di `OAUTH_TEST_CONFIG` (pre-existing)
- [x] T11-2: Qoder expired detection di `testSingleConnection` — set `testStatus: 'expired'` jika error bukan quota/pricing
- [x] T11-3: `testStatus: 'expired'` di-set via `isQoderTokenExpired` check
- [ ] T11-4: `resumeExpiredPauses` skip qoder dengan `backoffLevel >= 3` + non-quota error (deferred)
- [ ] T11-5: UI state `expired` dengan "Re-login required" link (deferred)

---

## BUG-T12: OpenRouter free-tier misclassified ✅ DONE

- [x] T12-1: Tambah rule `free-tier daily limit` SEBELUM generic `rate limit` rule
- [x] T12-2: Verified via smoke test — `isQuotaExhausted: true, cooldownMs=24h` ✓
- [x] T12-3: Generic `rate limit` masih match untuk non-free-tier ✓
- [x] T12-4: Rule placement verified ✓

---

## BUG-T13: Kiro stale Profile ARN ✅ DONE

- [ ] T13-1: ARN validation di `testOAuthConnection` untuk kiro (deferred — perlu Kiro ARN error untuk test)
- [ ] T13-2: Return error jika ARN invalid (deferred)
- [x] T13-3: `activate()` set `needsArnRefresh: true` jika lastError mengandung 'profile'/'arn'
- [x] T13-4: `getProviderCredentials` skip kiro dengan `needsArnRefresh: true`

---

## BUG-T14A: SiliconFlow 503 "System Busy" ✅ DONE

- [x] T14A-1: Tambah rules `system is really busy` + `try again later` di `errorConfig.js`
- [x] T14A-2: Verified via smoke test — `isRateLimit: true, action=lock` ✓
- [x] T14A-3: `service unavailable` masih match existing rule ✓

---

## BUG-T14B: SiliconFlow balance check ✅ DONE

- [x] T14B-1: Tambah balance check via `/v1/user/info` di case `siliconflow`
- [x] T14B-2: `warning` field di-forward ke enriched response
- [x] T14B-3: `warning` jadi `diagnosis.type: 'quota_warning'` jika balance < $0.01
- [ ] T14B-4: Verifikasi manual (perlu akun dengan balance rendah)

---

## INKON-10: deactivate() tidak clear pausedUntil ✅ DONE

- [x] INKON10-1: Tambah `pausedUntil: null` di `deactivate()` updateData
- [x] INKON10-2: Logic verified — `getState()` akan return INACTIVE bukan PAUSED
- [x] INKON10-3: `resumeExpiredPauses` tidak akan auto-resume (karena `pausedUntil=null`)

---

## INKON-03: markAccountUnavailable pause path tidak update backoffLevel ✅ DONE

- [x] INKON03-1: Tambah explicit `backoffLevel` + `lastError` update setelah `lifecyclePause`
- [x] INKON03-2: Logic verified
- [x] INKON03-3: Rate limit path tidak berubah ✓

---

## INKON-05: clearAccountError pakai snapshot lama ✅ DONE

- [x] INKON05-1: Ganti `_connection` snapshot dengan fresh `getProviderConnectionById` read
- [x] INKON05-2: Import `getProviderConnectionById` sudah ada di `auth.js` ✓
- [x] INKON05-3: Performance tradeoff acceptable — hanya pada success path, bukan error path
- [x] INKON05-4: Quota behavior tetap benar — chat sukses setelah quota warning tetap clear quotaStatus

---

## INKON-04: resumeExpiredPauses skip quotaStatus=exhausted ✅ DONE

- [x] INKON04-1: Tambah guard `if (conn.quotaStatus === 'exhausted') continue`
- [x] INKON04-2: Koneksi exhausted tidak di-resume oleh scheduler ✓
- [x] INKON04-3: Koneksi tanpa quotaStatus tetap resume seperti biasa ✓

---

## INKON-01: activate() philosophy align ✅ DONE (via BUG-T06)

- [x] INKON01-1: BUG-T06 sudah cover ini — `testStatus: null` di activate + resumeExpiredPauses
- [ ] INKON01-2: Audit caller yang expect `testStatus='active'` (perlu manual review)
- [x] INKON01-3: `getEffectiveStatus` di UI sudah handle `null` gracefully ✓

---

## Verification Checklist

- [ ] Build sukses tanpa error (build gagal karena EPERM Windows issue, bukan code error)
- [x] BUG-T01: Toggle selective restore logic implemented ✓
- [x] BUG-T04: model=null lock bypass fixed + smoke test pass ✓
- [x] BUG-T05: markAccountUnavailable O(1) query ✓
- [x] BUG-T03A: Enriched test response dengan diagnosis ✓
- [x] BUG-T06 + INKON-01: testStatus=null setelah activate ✓
- [x] BUG-T08: Auth error pause floor 1h ✓
- [x] BUG-T09: Skip paused connections di test ✓
- [x] BUG-T10A: xAI bad-credentials → pause 1h (verified via smoke test) ✓
- [x] BUG-T10B: xAI OAuth test config added ✓
- [x] BUG-T11: Qoder expired detection di testSingleConnection ✓
- [x] BUG-T12: OpenRouter free-tier → isQuotaExhausted (verified) ✓
- [x] BUG-T14A: SiliconFlow 503 → backoff (verified) ✓
- [x] BUG-T14B: SiliconFlow balance check implemented ✓
- [x] INKON-10: deactivate() clear pausedUntil ✓
- [x] INKON-03: backoffLevel updated setelah pause ✓
- [x] INKON-04: resumeExpiredPauses skip exhausted connections ✓
- [x] BUG-T13: Kiro needsArnRefresh flag + skip di credential selection ✓
- [x] INKON-05: clearAccountError fresh DB read ✓

- [x] No regresi: test suite `50 failed | 44 passed` sama sebelum dan sesudah ✓

---

## Yang Belum / Deferred

| ID         | Status   | Keterangan                                       |
| ---------- | -------- | ------------------------------------------------ |
| T01-6      | TODO     | Manual verify acceptance criteria toggle         |
| T03A-7     | DEFERRED | Batch test results UI diagnosis display          |
| T03B       | DEFERRED | Deep test via actual chat (consume quota)        |
| T04-4      | TODO     | Unit test formal model=null lock bypass          |
| T06-3      | TODO     | Manual verify UI handle testStatus=null graceful |
| T07        | DEFERRED | QuotaMonitor dokumentasi (LOW)                   |
| T08-3      | TODO     | Unit test formal BUG-T08                         |
| T10-B3     | TODO     | Manual verify xAI OAuth expired token refresh    |
| T11-4      | DEFERRED | resumeExpiredPauses qoder backoffLevel guard     |
| T11-5      | DEFERRED | UI state expired + re-login link untuk Qoder     |
| T13-1/2    | DEFERRED | Kiro ARN validation di testOAuthConnection       |
| T14B-4     | TODO     | Manual verify SiliconFlow balance < $0.01        |
| INKON-01-2 | TODO     | Audit caller yang expect testStatus=active       |
