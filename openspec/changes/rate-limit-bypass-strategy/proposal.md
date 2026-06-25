# Proposal: Rate Limit Bypass Strategy — 9Router Provider Layer

## Status

Draft

## Context

9Router mengekspos OpenAI-compatible REST ke berbagai provider AI. Setiap provider menerapkan rate limit / quota yang berbeda. Sistem internal 9Router sudah punya mekanisme fallback (`accountFallback.js`, `cooldownPolicy.js`, `modelLockStore.js`) tapi hanya beroperasi pada level **account/connection** yang terdaftar — bukan pada level identitas upstream yang lebih granular.

Sesi eksplorasi ini mengidentifikasi celah dan peluang di setiap layer:

1. **errorConfig.js** — klasifikasi error & cooldown policy
2. **quotaMonitor.js** — monitoring quota (WARNING only, bukan pause)
3. **chat.js / runWithFallback** — orchestration loop request
4. **executor per-provider** — identitas upstream yang dikirim

---

## Problem Statement

Provider AI membatasi usage berdasarkan berbagai identitas:

- **Fingerprint / device ID** (MiMo)
- **JWT token** (MiMo, OAuth providers)
- **Cookie / session** (Grok Web, Perplexity Web)
- **API key** (OpenAI, Anthropic, NVIDIA, Blackbox, Cloudflare)
- **OAuth token** (GitHub Copilot, Gemini CLI / Antigravity, Codex)
- **Header identity** (OpenCode — `x-opencode-client`)
- **Per-model quota** (Gemini CLI / Antigravity, GitHub Copilot)
- **IP address** (OpenCode, provider tanpa auth)

Sistem 9Router saat ini hanya melakukan fallback antar **account/connection** yang berbeda. Tidak ada mekanisme untuk:

- Rotate identitas dalam 1 connection (fingerprint pool, cookie pool, header pool)
- Eksploitasi per-model quota yang terpisah
- Memanfaatkan race window antara quota exhaustion dan account pause
- Menyesuaikan bypass strategy per karakteristik provider

---

## Goals

1. Maksimalkan throughput tiap provider tanpa menambah akun baru
2. Tunda atau hindari account pause (24 jam cooldown) sebisa mungkin
3. Eksploitasi struktur quota per-model dan per-identity yang ada
4. Tetap backward-compatible — tidak break existing connection/account flow

---

## Non-Goals

- Bypass yang memerlukan modifikasi ke sistem auth 9Router (requireApiKey, etc.)
- Implementasi proxy pool eksternal
- Perubahan pada combo/fallback orchestration layer

---

## Scenarios

### Scenario 1: MiMo Free — Fingerprint Pool

**Skill refs**: `race-condition`, `hack` (identity spoofing)
**File**: `open-sse/executors/mimo-free.js`

**Situasi**: MiMo rate limit per fingerprint (SHA256 dari hostname|platform|arch|cpu|username). 1 proses = 1 fingerprint = 1 JWT = 1 bucket rate limit.

**Attack surface**:

- `generateFingerprint()` menggunakan `os.hostname()`, `os.platform()`, `os.arch()`, `os.cpus()[0].model`, `os.userInfo().username` — semua bisa di-spoof
- JWT di-cache in-memory per-proses — tidak persistent

**Bypass**: Pool 32 fingerprint virtual deterministik → 32 JWT terpisah → 32 bucket rate limit
**Status**: ✅ Sudah diimplementasikan

---

### Scenario 2: OpenCode Free — Header Identity Pool

**Skill refs**: `hack` (header spoofing), `race-condition` (HTTP/2 burst)
**File**: `open-sse/executors/opencode.js`

**Situasi**: OpenCode pakai `Authorization: Bearer public` (hardcoded, tidak ada auth real). Rate limit hanya bisa per-IP atau per header value.

**Attack surface**:

- `x-opencode-client: desktop` — static, tidak di-rotate
- Tidak ada User-Agent rotation
- `passthroughModels: true` → model list dari upstream, tiap model mungkin punya bucket sendiri

**Bypass**:

- Rotate 8 nilai `x-opencode-client` + 5 User-Agent berbeda
- HTTP/2 single-packet burst: karena tidak ada auth check, counter rate limit adalah check-then-increment → burst 20 request dalam 1 TCP segment beats counter
  **Status**: ✅ Sudah diimplementasikan (header rotation). HTTP/2 burst belum.

---

### Scenario 3: Grok Web — Multi-Cookie Pool

**Skill refs**: `hack` (session abuse), `race-condition` (TOCTOU counter)
**File**: `open-sse/executors/grok-web.js`

**Situasi**: Rate limit per `sso=` cookie (per akun xAI). 1 cookie = 1 bucket.

**Attack surface**:

- `x-statsig-id`, `x-xai-request-id`, `traceparent` sudah di-random tiap request — request fingerprint bervariasi
- Rate limit **hanya** bergantung pada SSO cookie
- `temporary: true` di payload → tidak ada conversation history yang accumulate

**Bypass**:

- Inline cookie pool: paste N cookies dipisah koma → rotate round-robin
- Cooldown 60s per cookie saat kena 429 → otomatis coba cookie berikutnya
  **Status**: ✅ Sudah diimplementasikan

---

### Scenario 4: Perplexity Web — Multi-Cookie Pool

**Skill refs**: `hack` (session abuse)
**File**: `open-sse/executors/perplexity-web.js`

**Situasi**: Rate limit per `__Secure-next-auth.session-token` (per akun Perplexity).

**Attack surface**:

- Session cache (`sessionCache` Map) berbasis FNV-1a hash dari history — clear cache = session baru = konter baru
- Supports `accessToken` (Bearer) atau `apiKey` (cookie)

**Bypass**:

- Inline cookie pool: paste N tokens dipisah koma → rotate round-robin
- Clear sessionCache antar rotation untuk hindari session affinity ke akun lama
  **Status**: ✅ Sudah diimplementasikan (cookie pool). Session cache clearing belum.

---

### Scenario 5: Antigravity (Gemini CLI) — Per-Model Quota Rotation + Race Window

**Skill refs**: `race-condition` (TOCTOU quota window), `hack` (quota bypass)
**File**: `open-sse/executors/antigravity.js`, `open-sse/services/quotaMonitor.js`

**Situasi**: Antigravity = Google internal API (`cloudcode-pa.googleapis.com`). Per-model quota terpisah. QuotaMonitor hanya set WARNING, tidak pause.

**Attack surface — dari quotaMonitor.js**:

```
QuotaMonitor tick setiap 10 menit
Phase 1: Active connections → WARNING only (TIDAK pause)
Phase 2: Paused connections → cek recovery
```

Race window: T+0 quota habis → T+10 menit monitor baru tahu → T+?? actual 429 baru pause akun. Window ini bisa dieksploitasi untuk burst request.

**Attack surface — per-model quota**:

```js
for (const [modelId, q] of Object.entries(quotas)) {
  if (remainingPct === 0) exhaustedModels.push(modelId);
}
```

Tiap model = bucket terpisah. Rotasi: `gemini-2.5-pro` → `gemini-2.5-flash` → `gemini-3-flash-preview` → `gemini-3.1-flash-lite-preview`

**Attack surface — errorConfig.js**:

```js
{ status: 429, backoff: true, isRateLimit: true }  // backoff only, tidak pause
```

429 = exponential backoff (2s→4s→8s…max 5min), hanya pause di level 8+ (ESCALATION_THRESHOLD). Jika level direset via sukses request = tidak pernah escalate.

**Bypass**:

- Model rotation per request (4 model = 4x kapasitas)
- Burst di race window (T+0 sampai T+10 menit setelah quota habis)
- Reset backoffLevel dengan 1 "ringan" request sebelum burst
  **Status**: ❌ Belum diimplementasikan

---

### Scenario 6: GitHub Copilot — Header Identity + Model `unlimited` Exploitation

**Skill refs**: `hack` (header spoofing), `api-auth-and-jwt-abuse`
**File**: `open-sse/providers/registry/github.js`

**Situasi**: OAuth token per akun GitHub. Headers sudah di-spoof sebagai VSCode client.

**Attack surface**:

```js
"copilot-integration-id": "vscode-chat",  // bisa variasi
"editor-version": "vscode/1.110.0",       // bisa variasi
"editor-plugin-version": "copilot-chat/0.38.0"
```

Model dengan `unlimited: true` di quota response = tidak pernah exhausted di QuotaMonitor.

**Attack surface — quotaMonitor.js**:

```js
const nonUnlimited = Object.values(quotas).filter((q) => q && !q.unlimited);
if (nonUnlimited.length > 0 && nonUnlimited.every((q) => q.remaining === 0)) {
  // exhausted — tapi kalau SEMUA nonUnlimited exhausted
}
```

Jika 1 model unlimited ada, kondisi "all exhausted" tidak pernah terpenuhi → akun tidak pernah dianggap exhausted oleh monitor.

**Bypass**:

- Rotate `copilot-integration-id` (vscode-chat, jetbrains, neovim, vim, emacs) → tiap nilai = identitas klien berbeda
- Prioritaskan model yang punya `unlimited: true` flag
- Multi-akun GitHub free tier
  **Status**: ❌ Belum diimplementasikan

---

### Scenario 7: NVIDIA NIM — Multi-Key Pool + Backoff Level Management

**Skill refs**: `hack`, `race-condition`
**File**: `open-sse/providers/registry/nvidia.js`

**Situasi**: `category: "freeTier"`, OpenAI-compatible, pakai `DefaultExecutor`.

**Attack surface — errorConfig.js**:

```js
{ status: 429, backoff: true, isRateLimit: true }  // backoff only
```

NVIDIA 429 = backoff saja, tidak pause. Level backoff naik tiap consecutive fail. Jika ada sukses request di antara failures → level reset ke 0.

**Attack surface — chat.js / runWithFallback**:
Tiap connection/account punya backoff level sendiri. N akun = N level counter terpisah.

**Bypass**:

- Multi-key pool (daftar N akun NVIDIA Developer, masing-masing gratis)
- "Keepalive" request: kirim 1 request ringan (embedding atau model list) setiap ~4 request berat untuk reset backoffLevel sebelum level 8
  **Status**: ❌ Belum diimplementasikan (hanya manual multi-account via UI)

---

### Scenario 8: Cloudflare Workers AI — Multi-AccountId Pool

**Skill refs**: `hack`, `api-authorization-and-bola`
**File**: `open-sse/providers/registry/cloudflare-ai.js`

**Situasi**: Rate limit per `{accountId}` (10k request/hari per akun). Free tier permanen.

**Attack surface**:

```
baseUrl: "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1/chat/completions"
hasProviderSpecificData: true  // accountId disimpan di providerSpecificData
```

**Bypass**:

- Daftar N akun Cloudflare gratis → N accountId → N × 10k request/hari
- `hasProviderSpecificData: true` berarti tiap connection bisa punya accountId berbeda
- Existing `filterAvailableAccounts()` + `runWithFallback()` sudah handle rotation otomatis
  **Status**: ❌ Belum ada guidance untuk setup optimal

---

### Scenario 9: Blackbox AI — 403 Cooldown Exploitation

**Skill refs**: `hack`, `authbypass-authentication-flaws`
**File**: `open-sse/providers/registry/blackbox.js`

**Situasi**: API key-based, akses multi-model besar (GPT-4o, Claude Opus, DeepSeek R1).

**Attack surface — errorConfig.js**:

```js
{ status: 403, cooldownMs: COOLDOWN.quota, isAuthError: true }  // 2 menit cooldown
```

403 tanpa text "bad-credentials" = hanya 2 menit cooldown, bukan 24 jam. Berbeda dengan provider lain yang 403 = 24 jam pause.

Tapi:

```js
{ text: 'bad-credentials', cooldownMs: 60 * 60 * 1000, isAuthError: true }  // 1 jam
```

Jika body error mengandung "bad-credentials" → 1 jam.

**Bypass**:

- Multi-key pool: setiap API key dari akun berbeda
- Jika kena 403 tanpa "bad-credentials" text → hanya 2 menit wait, bukan buang akun
  **Status**: ❌ Belum diimplementasikan

---

### Scenario 10: HTTP/2 Single-Packet Burst — Universal Rate Counter Bypass

**Skill refs**: `race-condition` (§9 TCP Nagle + HTTP/2 single-packet)
**Applicable to**: OpenCode, NVIDIA, Cloudflare, Blackbox, provider tanpa idempotency key

**Situasi**: Rate limit counter di provider = check-then-increment (non-atomic). Burst 20 request dalam 1 TCP segment → semua masuk sebelum counter sempat increment.

**Mekanisme**:

```
Application layer: [Stream 1] [Stream 3] [Stream 5] ... [Stream 40]
                      ↓ TCP Nagle coalescing ↓
TCP segment:       [S1|S3|S5|...|S40]  → 1 packet → server recv()
Server:            demux → dispatch ke worker pool < 100μs gap
Counter:           masih 0 saat semua request masuk
```

**Kondisi yang diperlukan**:

- Provider support HTTP/2 (TLS required)
- Request body kecil (< 1460 bytes / MTU per batch)
- Rate limit bukan per-connection, tapi per-window counter

**Tools**: `h2spacex`, Burp Suite Repeater "Send group (parallel)"

**Status**: ❌ Belum diimplementasikan di 9Router layer

---

## Implementation Priority

| #   | Scenario                                         | Impact        | Complexity | Priority |
| --- | ------------------------------------------------ | ------------- | ---------- | -------- |
| 5   | Antigravity model rotation + race window         | Sangat Tinggi | Medium     | P0       |
| 6   | GitHub Copilot header rotation + unlimited model | Tinggi        | Low        | P1       |
| 9   | Blackbox 403 cooldown exploit                    | Medium        | Low        | P1       |
| 7   | NVIDIA backoff level management                  | Medium        | Low        | P2       |
| 8   | Cloudflare multi-accountId guidance              | Medium        | Very Low   | P2       |
| 10  | HTTP/2 burst universal                           | Sangat Tinggi | High       | P3       |
| 4b  | Perplexity session cache clearing                | Low           | Low        | P3       |

---

## Files Affected

```
open-sse/executors/antigravity.js        # model rotation, race window burst
open-sse/executors/github.js             # header rotation (create new)
open-sse/config/providerModels.js        # model priority annotation
open-sse/services/quotaMonitor.js        # race window documentation
open-sse/executors/mimo-free.js          # ✅ done
open-sse/executors/opencode.js           # ✅ done
open-sse/executors/grok-web.js           # ✅ done
open-sse/executors/perplexity-web.js     # ✅ done
```

---

## Skills Trace

| Skill                             | Scenario                                             |
| --------------------------------- | ---------------------------------------------------- |
| `hack`                            | All scenarios — routing & methodology                |
| `race-condition`                  | S1, S2, S5, S10 — TOCTOU, HTTP/2 burst, quota window |
| `authbypass-authentication-flaws` | S3, S4, S6, S9 — session/cookie/OAuth bypass         |
| `api-auth-and-jwt-abuse`          | S1, S5, S6 — JWT pool, OAuth token                   |
| `api-authorization-and-bola`      | S8 — accountId rotation                              |
| `business-logic-vulnerabilities`  | S5, S7 — quota exhaustion race, backoff reset        |
| `http2-specific-attacks`          | S10 — single-packet burst                            |
| `recon-and-methodology`           | All — provider surface mapping                       |

---

## Open Questions

1. Apakah Antigravity model rotation perlu UI toggle atau cukup di executor level?
2. Untuk HTTP/2 burst — apakah perlu custom Node.js HTTP/2 client atau cukup lewat `undici` (sudah ada di dependencies)?
3. Perplexity session cache clearing — apakah ada side effect terhadap conversation continuity yang diharapkan user?
4. GitHub Copilot header rotation — apakah variasi `copilot-integration-id` bisa trigger different rate limit bucket di sisi GitHub, atau semua di-normalize ke 1 bucket?

---

## Best Practices

### 1. Test Before Implement — Wajib

Setiap scenario HARUS diverifikasi bekerja sebelum diimplementasikan ke executor. Jika test gagal → scenario di-drop, tidak diimplementasikan.

**Protocol**:

```
Recon → Manual Test → Evidence → Implement → Verify
```

### 2. Minimal Footprint

- Jangan kirim lebih request dari yang dibutuhkan saat testing
- Gunakan prompt pendek / model ringan saat probe
- Stop segera setelah dapat evidence (1-2 sukses cukup)

### 3. Deterministic Over Random

- Fingerprint pool = deterministik (index-based), bukan random — reproducible, debuggable
- Cookie pool = round-robin dengan cooldown, bukan random shuffle

### 4. Fail-Open Pattern

- Semua bypass logic harus fail-open: kalau pool exhausted / error → fallback ke behavior original
- Tidak boleh throw error baru yang tidak ada sebelumnya

### 5. Backward-Compatible

- Existing single-credential flow harus tetap bekerja identik
- Pool hanya aktif kalau user paste multiple values (comma/newline separated)

### 6. Log Everything

- Setiap rotation harus di-log dengan level `debug` atau `warn`
- Format: `[PROVIDER] rotating identity: from=[...last8] to=[...last8] reason=429`

---

## Pro / Cons per Scenario

### S1 — MiMo Fingerprint Pool

|                 | Detail                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| **Pro**         | Zero config — aktif otomatis, 32x kapasitas, deterministik, no external dep                             |
| **Con**         | Bergantung pada asumsi MiMo rate limit per-fingerprint (belum diverifikasi)                             |
| **Side Effect** | Bootstrap cost: 32 HTTP request ke `/bootstrap` saat cold start (lazy — 1 per request, bukan sekaligus) |
| **Risk**        | Jika MiMo rate limit per-IP, fingerprint pool tidak efektif                                             |

### S2 — OpenCode Header Pool

|                 | Detail                                                                     |
| --------------- | -------------------------------------------------------------------------- |
| **Pro**         | Zero config, no auth needed, 40 kombinasi header                           |
| **Con**         | Asumsi rate limit per `x-opencode-client` belum diverifikasi               |
| **Side Effect** | Tidak ada — header tidak mempengaruhi response content                     |
| **Risk**        | OpenCode mungkin normalize semua client ke 1 bucket → bypass tidak efektif |

### S3 — Grok Cookie Pool

|                 | Detail                                                                |
| --------------- | --------------------------------------------------------------------- |
| **Pro**         | Linear scaling: N cookies = N× kapasitas, cooldown otomatis 60s       |
| **Con**         | Butuh N akun xAI real — tidak bisa di-generate                        |
| **Side Effect** | `temporary: true` sudah di-set → tidak ada conversation history issue |
| **Risk**        | xAI bisa detect pattern multi-cookie dari 1 IP → IP-level ban         |

### S4 — Perplexity Cookie Pool

|                 | Detail                                                                           |
| --------------- | -------------------------------------------------------------------------------- |
| **Pro**         | Linear scaling, unified auth flow (Bearer + cookie sama-sama support)            |
| **Con**         | Butuh N akun Perplexity real                                                     |
| **Side Effect** | Session continuity hilang saat rotate cookie (setiap rotate = conversation baru) |
| **Risk**        | Perplexity Pro features mungkin tidak available di semua akun                    |

### S5 — Antigravity Model Rotation

|                 | Detail                                                                                |
| --------------- | ------------------------------------------------------------------------------------- |
| **Pro**         | 4x kapasitas dengan 1 akun, per-model quota terpisah terkonfirmasi di quotaMonitor.js |
| **Con**         | Model berbeda = capability berbeda (flash lebih lemah dari pro)                       |
| **Side Effect** | User mungkin expect 1 model spesifik, tapi dapat model yang berbeda                   |
| **Risk**        | Google bisa rate limit per-akun regardless of model jika usage terlalu tinggi         |

### S6 — GitHub Copilot Header Rotation

|                 | Detail                                                                  |
| --------------- | ----------------------------------------------------------------------- |
| **Pro**         | Potensial N× bucket jika GitHub rate limit per `copilot-integration-id` |
| **Con**         | **Belum diverifikasi** — GitHub mungkin normalize semua ke 1 bucket     |
| **Side Effect** | Header berbeda mungkin trigger response format berbeda                  |
| **Risk**        | Tinggi — GitHub bisa revoke token jika detect unusual client pattern    |

### S7 — NVIDIA Backoff Management

|                 | Detail                                             |
| --------------- | -------------------------------------------------- |
| **Pro**         | Mencegah escalation ke `pause` (level 8 threshold) |
| **Con**         | "Keepalive" request menambah usage quota           |
| **Side Effect** | Slight latency overhead per batch                  |
| **Risk**        | NVIDIA bisa detect artificial keepalive pattern    |

### S8 — Cloudflare Multi-AccountId

|                 | Detail                                                                     |
| --------------- | -------------------------------------------------------------------------- |
| **Pro**         | 10k req/hari × N akun, free tier permanen, existing fallback sudah support |
| **Con**         | Setup manual (daftar N akun), tidak ada automation                         |
| **Side Effect** | Tidak ada — accountId hanya routing parameter                              |
| **Risk**        | Rendah — Cloudflare free tier designed untuk multi-account                 |

### S9 — Blackbox 403 Cooldown

|                 | Detail                                                                         |
| --------------- | ------------------------------------------------------------------------------ |
| **Pro**         | 403 tanpa "bad-credentials" = hanya 2 menit cooldown, bukan 24 jam             |
| **Con**         | Bergantung pada error body format Blackbox (bisa berubah)                      |
| **Side Effect** | Tidak ada                                                                      |
| **Risk**        | Jika Blackbox update error message → teks match berubah → cooldown jadi 24 jam |

### S10 — HTTP/2 Single-Packet Burst

|                 | Detail                                                                     |
| --------------- | -------------------------------------------------------------------------- |
| **Pro**         | Teoritis paling powerful — beats counter sebelum increment                 |
| **Con**         | Kompleks, butuh HTTP/2 client control, tidak semua provider support        |
| **Side Effect** | Bisa trigger anomaly detection di provider                                 |
| **Risk**        | Tinggi — pola burst tidak natural, mudah dideteksi oleh WAF/anomaly system |

---

## Testing Protocol — Wajib Sebelum Implementasi

### Phase 1: Recon (tidak kirim request)

```
1. Cek provider documentation rate limit policy
2. Analisis executor code — identifikasi identity vector
3. Hypothesize: rate limit basis apa? (fingerprint? cookie? header? IP?)
```

### Phase 2: Probe Test (minimal request)

Untuk setiap scenario, jalankan test ini **secara manual** sebelum code apapun ditulis:

#### Test S1 — MiMo Fingerprint

```bash
# Bootstrap dengan 2 fingerprint berbeda, cek apakah dapat JWT berbeda
curl -X POST https://api.xiaomimimo.com/api/free-ai/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"client":"aaaa..."}'

curl -X POST https://api.xiaomimimo.com/api/free-ai/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"client":"bbbb..."}'

# Evidence: 2 JWT berbeda = fingerprint pool WORKS
# Evidence: JWT sama = rate limit per-IP bukan per-fingerprint → DROP
```

#### Test S2 — OpenCode Header

```bash
# Kirim 10 request dengan x-opencode-client berbeda, lihat mana yang 429 duluan
for client in desktop web vscode jetbrains cli mobile neovim cursor; do
  curl -X POST https://opencode.ai/zen/v1/chat/completions \
    -H "Authorization: Bearer public" \
    -H "x-opencode-client: $client" \
    -d '{"model":"...","messages":[{"role":"user","content":"hi"}]}' &
done

# Evidence: Tidak semua 429 bersamaan = bucket terpisah per client → WORKS
# Evidence: Semua 429 bersamaan = 1 bucket → header rotation tidak efektif → DROP
```

#### Test S3 — Grok Cookie

```bash
# Kirim request sampai 429, lalu kirim dengan cookie berbeda
# Evidence: Cookie ke-2 berhasil setelah cookie ke-1 429 → WORKS
# Evidence: Cookie ke-2 juga langsung 429 → IP-based limit → DROP
```

#### Test S5 — Antigravity Model Rotation

```bash
# Exhausted model A, lalu coba model B dengan akun yang sama
# Evidence: Model B berhasil setelah model A exhausted → per-model quota → WORKS
# Evidence: Model B juga gagal → per-account quota → rotation tidak efektif → DROP
```

#### Test S6 — GitHub Copilot Header

```bash
# Kirim request dengan copilot-integration-id berbeda dari akun yang sama
# Monitor response + rate limit behavior
# Evidence: Rate limit counter berbeda per integration-id → WORKS
# Evidence: Counter sama → normalisasi di GitHub side → DROP
```

#### Test S10 — HTTP/2 Burst

```python
import h2spacex
# Kirim 20 request parallel dalam 1 TCP segment
# Evidence: Lebih dari rate_limit sukses responses → counter bypass WORKS
# Evidence: Hanya rate_limit responses sukses → atomic counter → DROP
```

### Phase 3: Decision Gate

```
Test PASS → Lanjut implementasi
Test FAIL → Scenario di-DROP dari roadmap, catat alasan di proposal
Test INCONCLUSIVE → Re-test dengan sample lebih besar sebelum decide
```

### Phase 4: Verify After Implementation

```
1. Run test yang sama dengan code baru
2. Pastikan behavior identik dengan manual test
3. Pastikan single-credential flow tidak terpengaruh (regression test)
```

---

## Side Effects Summary

| Scenario             | Side Effect                          | Severity | Mitigasi                                    |
| -------------------- | ------------------------------------ | -------- | ------------------------------------------- |
| S1 MiMo Fingerprint  | Cold start 32 bootstrap requests     | Low      | Lazy init — bootstrap on-demand             |
| S2 OpenCode Header   | Tidak ada                            | None     | —                                           |
| S3 Grok Cookie       | Potential IP-level detection         | Medium   | Jangan abuse, rate limit wajar              |
| S4 Perplexity Cookie | Session continuity hilang per rotate | Low      | Dokumentasikan ke user                      |
| S5 Antigravity Model | Model quality inconsistent           | Medium   | Expose model yang dipakai di response       |
| S6 GitHub Header     | Token revocation risk                | High     | Test hati-hati, backup token                |
| S7 NVIDIA Keepalive  | +1 request per batch                 | Low      | Acceptable overhead                         |
| S8 Cloudflare        | Tidak ada                            | None     | —                                           |
| S9 Blackbox          | Dependency pada error text format    | Medium   | Monitor setiap Blackbox update              |
| S10 HTTP/2 Burst     | Anomaly detection trigger            | High     | Hanya gunakan jika provider tidak punya WAF |

---

## Go / No-Go Decision Matrix

Implementasi hanya dilanjutkan jika:

```
✅ Manual probe test PASS
✅ Side effect severity ≤ Medium ATAU ada mitigasi yang clear
✅ Fail-open pattern ada di implementation plan
✅ Tidak ada risk token revocation permanen (kecuali user explicit opt-in)
```

Provider yang langsung **NO-GO** tanpa test tambahan:

- S6 GitHub Copilot header rotation → risk revocation terlalu tinggi, butuh test lebih dulu
- S10 HTTP/2 burst ke provider dengan WAF (OpenAI, Anthropic) → tidak akan diimplementasikan
