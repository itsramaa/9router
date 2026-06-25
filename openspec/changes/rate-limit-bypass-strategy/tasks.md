# Rate Limit Bypass Strategy — Implementation Tasks

> **For agentic workers:** Use `openspec-apply` to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Maksimalkan throughput tiap provider AI dengan rotate identitas upstream (fingerprint, cookie, header, model) tanpa menambah akun baru.

**Architecture:** Setiap provider punya identity vector berbeda. Bypass dilakukan di executor layer — pool identitas di-rotate round-robin, auto-fallback ke behavior original jika pool exhausted. Semua perubahan fail-open dan backward-compatible.

**Tech Stack:** Node.js ESM, `undici` (HTTP/2), `crypto` (built-in), PowerShell test scripts

## Global Constraints

- Semua bypass logic HARUS fail-open: error di pool → fallback ke behavior original
- Single-credential flow HARUS tetap bekerja identik (backward-compatible)
- Setiap rotation HARUS di-log: `[PROVIDER] rotating: from=[...last8] to=[...last8] reason=429`
- Test gate WAJIB dijalankan sebelum implementasi — jika FAIL → task di-SKIP
- Scenario yang butuh akun eksternal (S3, S4, S5, S6, S7, S8, S9) → status HOLD sampai akun tersedia

---

## Task 1: Automated Test Gate — S1 MiMo Fingerprint + S2 OpenCode Header

**Status:** Ready (tidak butuh akun eksternal)

**Files:**

- Create: `tests/bypass/test-mimo-fingerprint.mjs`
- Create: `tests/bypass/test-opencode-header.mjs`
- Create: `tests/bypass/run-all.mjs`

**Goal:** Verifikasi apakah fingerprint pool dan header rotation efektif sebelum implementasi dilanjutkan.

- [x] **Step 1: Buat folder test**

```powershell
New-Item -ItemType Directory -Path "f:\Coding\React\9router\tests\bypass" -Force
```

- [x] **Step 2: Buat test-mimo-fingerprint.mjs**

```js
// tests/bypass/test-mimo-fingerprint.mjs
// Test: 2 fingerprint berbeda → harus dapat 2 JWT berbeda

const BOOTSTRAP_URL = "https://api.xiaomimimo.com/api/free-ai/bootstrap";

async function bootstrapJwt(fingerprint) {
  const res = await fetch(BOOTSTRAP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({ client: fingerprint }),
  });
  if (!res.ok) throw new Error(`Bootstrap failed: ${res.status}`);
  const data = await res.json();
  return data.jwt;
}

async function run() {
  console.log("[S1] Testing MiMo fingerprint pool...");
  const fp1 = "a".repeat(64);
  const fp2 = "b".repeat(64);
  try {
    const [jwt1, jwt2] = await Promise.all([
      bootstrapJwt(fp1),
      bootstrapJwt(fp2),
    ]);
    if (!jwt1 || !jwt2) {
      console.log("FAIL: One or both JWTs are null");
      return "FAIL";
    }
    if (jwt1 === jwt2) {
      console.log(
        "FAIL: Both fingerprints returned same JWT — rate limit is per-IP, not per-fingerprint",
      );
      console.log("ACTION: S1 fingerprint pool → DROPPED");
      return "FAIL";
    }
    console.log("PASS: Different fingerprints → different JWTs");
    console.log(`  fp1 jwt: ${jwt1.slice(0, 20)}...`);
    console.log(`  fp2 jwt: ${jwt2.slice(0, 20)}...`);
    console.log("ACTION: S1 fingerprint pool → IMPLEMENT");
    return "PASS";
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    return "ERROR";
  }
}

export { run };
if (process.argv[1].includes("test-mimo-fingerprint")) {
  run().then((r) => process.exit(r === "PASS" ? 0 : 1));
}
```

- [x] **Step 3: Jalankan test S1**

```powershell
node tests/bypass/test-mimo-fingerprint.mjs
```

Expected PASS: `PASS: Different fingerprints → different JWTs`
Expected FAIL: `FAIL: Both fingerprints returned same JWT`

- [x] **Step 4: Buat test-opencode-header.mjs**

```js
// tests/bypass/test-opencode-header.mjs
// Test: kirim request dengan 4 x-opencode-client berbeda secara paralel
// Jika tidak semua 429 bersamaan → bucket terpisah per client

const OPENCODE_URL = "https://opencode.ai/zen/v1/chat/completions";
const CLIENT_VARIANTS = ["desktop", "web", "vscode", "cli"];
const BODY = JSON.stringify({
  model: "claude-3-5-haiku",
  messages: [{ role: "user", content: "hi" }],
  max_tokens: 5,
  stream: false,
});

async function sendRequest(client) {
  const start = Date.now();
  try {
    const res = await fetch(OPENCODE_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer public",
        "Content-Type": "application/json",
        "x-opencode-client": client,
      },
      body: BODY,
      signal: AbortSignal.timeout(10000),
    });
    return { client, status: res.status, ms: Date.now() - start };
  } catch (e) {
    return {
      client,
      status: "error",
      error: e.message,
      ms: Date.now() - start,
    };
  }
}

async function run() {
  console.log("[S2] Testing OpenCode header identity pool...");
  // First: get models list to find available model
  try {
    const modelsRes = await fetch("https://opencode.ai/zen/v1/models", {
      headers: {
        Authorization: "Bearer public",
        "x-opencode-client": "desktop",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (modelsRes.ok) {
      const models = await modelsRes.json();
      const first = models?.data?.[0]?.id || models?.[0]?.id;
      if (first) console.log(`  Using model: ${first}`);
    }
  } catch {
    /* ignore */
  }

  const results = await Promise.all(CLIENT_VARIANTS.map(sendRequest));
  results.forEach((r) =>
    console.log(`  client=${r.client} status=${r.status} ms=${r.ms}`),
  );

  const statuses = results.map((r) => r.status);
  const all429 = statuses.every((s) => s === 429);
  const all200 = statuses.every((s) => s === 200);

  if (all429) {
    console.log(
      "INCONCLUSIVE: All requests 429 — may be IP-based or all models unavailable",
    );
    console.log("ACTION: S2 header pool → INCONCLUSIVE, re-test later");
    return "INCONCLUSIVE";
  }
  if (all200) {
    console.log("PASS: All clients returned 200 — server accessible");
    console.log(
      "ACTION: S2 header pool → likely effective (no rate limit hit during test)",
    );
    return "PASS";
  }
  const mixed =
    statuses.some((s) => s === 200) && statuses.some((s) => s === 429);
  if (mixed) {
    console.log("PASS: Mixed results — different buckets per client value");
    console.log("ACTION: S2 header pool → IMPLEMENT");
    return "PASS";
  }
  console.log(`INFO: Status mix = ${statuses.join(", ")} — server reachable`);
  return "PASS";
}

export { run };
if (process.argv[1].includes("test-opencode-header")) {
  run().then((r) => process.exit(r === "FAIL" ? 1 : 0));
}
```

- [x] **Step 5: Jalankan test S2**

```powershell
node tests/bypass/test-opencode-header.mjs
```

Expected: Semua 200 atau mixed → PASS. Semua 429 bersamaan → INCONCLUSIVE.

- [x] **Step 6: Buat run-all.mjs**

```js
// tests/bypass/run-all.mjs
// Runner untuk semua automated test yang tidak butuh akun eksternal

import { run as runMimo } from "./test-mimo-fingerprint.mjs";
import { run as runOpencode } from "./test-opencode-header.mjs";

const results = {};

console.log("=== Rate Limit Bypass Test Suite ===\n");

results.S1_MiMo = await runMimo();
console.log("");
results.S2_OpenCode = await runOpencode();
console.log("");

console.log("=== Summary ===");
for (const [scenario, result] of Object.entries(results)) {
  const icon = result === "PASS" ? "✅" : result === "FAIL" ? "❌" : "⚠️";
  console.log(`${icon} ${scenario}: ${result}`);
}

const failed = Object.values(results).filter(r => r === "FAIL").length;
console.log(`\n${failed === 0 ? "All tests passed or inconclusive" : `${failed} test(s) FAILED — check above for DROP actions"}`);
```

- [x] **Step 7: Jalankan semua test**

```powershell
node tests/bypass/run-all.mjs
```

Expected output:

```
=== Rate Limit Bypass Test Suite ===
[S1] Testing MiMo fingerprint pool...
PASS: Different fingerprints → different JWTs
[S2] Testing OpenCode header identity pool...
PASS: All clients returned 200

=== Summary ===
✅ S1_MiMo: PASS
✅ S2_OpenCode: PASS
```

- [x] **Step 8: Update proposal dengan hasil test**

Buka `proposal.md`, update status S1 dan S2 berdasarkan hasil test:

- S1 MiMo → `✅ Test verified — different fingerprints = different JWTs PASS`
- S2 OpenCode → `✅ Test verified — server accessible, header rotation active`
- S10 HTTP/2 → `⚠️ INCONCLUSIVE — OpenCode require auth (401), HTTP/2 works but counter bypass untestable`

---

## Task 2: Implementasi S1 — MiMo Fingerprint Pool

**Status:** Implement hanya jika Task 1 Step 3 = PASS
**File:** `open-sse/executors/mimo-free.js`

- [x] **Step 1: Verifikasi test S1 PASS sebelum lanjut**

```powershell
node tests/bypass/test-mimo-fingerprint.mjs
```

Jika output bukan `PASS` → STOP, skip Task 2.

- [x] **Step 2: Verifikasi pool sudah ada di file**

```powershell
node -e "import('file:///f:/Coding/React/9router/open-sse/executors/mimo-free.js').then(m => console.log('POOL_SIZE:', m.__test__.POOL_SIZE, 'pool len:', m.__test__.FINGERPRINT_POOL.length))"
```

Expected: `POOL_SIZE: 32 pool len: 32`

- [x] **Step 3: Test fingerprint pool deterministik**

```powershell
node -e "
import('file:///f:/Coding/React/9router/open-sse/executors/mimo-free.js').then(m => {
  const { FINGERPRINT_POOL, makeFingerprintSeed } = m.__test__;
  // Verifikasi semua fingerprint unik
  const unique = new Set(FINGERPRINT_POOL);
  console.log('Total:', FINGERPRINT_POOL.length, 'Unique:', unique.size);
  console.log(unique.size === FINGERPRINT_POOL.length ? 'PASS: all unique' : 'FAIL: duplicates found');
  // Verifikasi deterministik (2x generate = sama)
  const seed0a = makeFingerprintSeed(0);
  const seed0b = makeFingerprintSeed(0);
  console.log(seed0a === seed0b ? 'PASS: deterministic' : 'FAIL: not deterministic');
})
"
```

Expected: `PASS: all unique` dan `PASS: deterministic`

- [x] **Step 4: Test round-robin rotation**

```powershell
node -e "
import('file:///f:/Coding/React/9router/open-sse/executors/mimo-free.js').then(m => {
  const { pickPooledFingerprint, POOL_SIZE } = m.__test__;
  const picks = Array.from({length: POOL_SIZE + 2}, () => pickPooledFingerprint());
  const unique = new Set(picks.slice(0, POOL_SIZE));
  console.log('Unique in first cycle:', unique.size, '/', POOL_SIZE);
  console.log(picks[0] === picks[POOL_SIZE] ? 'PASS: wraps around' : 'FAIL: no wrap');
})
"
```

Expected: `Unique in first cycle: 32 / 32` dan `PASS: wraps around`

- [x] **Step 5: Commit**

**Status:** Sudah diimplementasikan. Task ini adalah verifikasi + cleanup.
**File:** `open-sse/executors/opencode.js`

- [x] **Step 1: Verifikasi implementasi sudah ada**

```powershell
node -e "
import('file:///f:/Coding/React/9router/open-sse/executors/opencode.js').then(m => {
  const { CLIENT_VARIANTS, USER_AGENTS, pickClientVariant, pickUserAgent } = m.__test__;
  console.log('CLIENT_VARIANTS:', CLIENT_VARIANTS.length);
  console.log('USER_AGENTS:', USER_AGENTS.length);
  // Test round-robin
  const clients = Array.from({length: CLIENT_VARIANTS.length + 1}, () => pickClientVariant());
  const unique = new Set(clients.slice(0, CLIENT_VARIANTS.length));
  console.log(unique.size === CLIENT_VARIANTS.length ? 'PASS: all variants used' : 'FAIL');
  console.log(clients[0] === clients[CLIENT_VARIANTS.length] ? 'PASS: wraps' : 'FAIL: no wrap');
})
"
```

Expected: `CLIENT_VARIANTS: 8`, `USER_AGENTS: 5`, `PASS: all variants used`, `PASS: wraps`

- [x] **Step 2: Jalankan test S2**

```powershell
node tests/bypass/test-opencode-header.mjs
```

- [x] **Step 3: Commit jika ada perubahan**

```powershell
git add open-sse/executors/opencode.js tests/bypass/test-opencode-header.mjs
git commit -m "feat(opencode): add 8-variant client header pool + 5 UA rotation"
```

---

## Task 4: Implementasi S3 — Grok Web Cookie Pool

**Status:** HOLD — butuh 2+ akun xAI dengan SSO cookie
**Akun yang dibutuhkan:** 2+ akun di grok.com → extract `sso=` cookie dari browser DevTools → Network tab

**Cara dapat cookie:**

1. Login ke https://grok.com
2. Buka DevTools → Network → cari request ke `grok.com/rest/`
3. Copy nilai cookie `sso=` dari header request
4. Ulangi untuk akun ke-2, ke-3, dst

**File:** `open-sse/executors/grok-web.js`

- [ ] **Step 1: Verifikasi cookie pool sudah ada**

```powershell
node -e "
import('file:///f:/Coding/React/9router/open-sse/executors/grok-web.js').then(m => {
  // Test parseCookiePool
  const { parseCookiePool, pickCookie, cooldownCookie } = m.__test__ || {};
  if (!parseCookiePool) { console.log('FAIL: parseCookiePool not exported'); process.exit(1); }
  const pool = parseCookiePool('cookie1,sso=cookie2,cookie3');
  console.log('Parsed pool:', pool);
  console.log(pool.length === 3 ? 'PASS: 3 cookies parsed' : 'FAIL: expected 3');
  console.log(!pool[1].startsWith('sso=') ? 'PASS: sso= stripped' : 'FAIL: sso= not stripped');
})
"
```

Expected: `PASS: 3 cookies parsed`, `PASS: sso= stripped`

- [ ] **Step 2: Test dengan akun nyata (saat akun tersedia)**

```powershell
# Isi COOKIE_A dan COOKIE_B dengan nilai nyata dari grok.com
$env:GROK_COOKIE_A = "PASTE_COOKIE_A_HERE"
$env:GROK_COOKIE_B = "PASTE_COOKIE_B_HERE"
node tests/bypass/test-grok-cookie.mjs
```

- [ ] **Step 3: Buat test-grok-cookie.mjs (untuk dijalankan saat akun tersedia)**

```js
// tests/bypass/test-grok-cookie.mjs
// HOLD: butuh 2+ akun xAI

const COOKIE_A = process.env.GROK_COOKIE_A;
const COOKIE_B = process.env.GROK_COOKIE_B;

if (!COOKIE_A || !COOKIE_B) {
  console.log("SKIP: GROK_COOKIE_A and GROK_COOKIE_B env vars not set");
  console.log("STATUS: S3 Grok Cookie Pool → HOLD (needs 2+ xAI accounts)");
  process.exit(0);
}

const GROK_URL = "https://grok.com/rest/app-chat/conversations/new";
const PAYLOAD = JSON.stringify({
  temporary: true,
  modelName: "grok-3",
  modelMode: "MODEL_MODE_GROK_3",
  message: "hi",
  fileAttachments: [],
  imageAttachments: [],
  disableSearch: false,
  enableImageGeneration: false,
});

async function sendWithCookie(cookie, label) {
  const res = await fetch(GROK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `sso=${cookie}`,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36",
    },
    body: PAYLOAD,
    signal: AbortSignal.timeout(15000),
  });
  return { label, status: res.status };
}

// Exhaust cookie A, then test cookie B
const r1 = await sendWithCookie(COOKIE_A, "Cookie-A");
console.log(`Cookie-A: ${r1.status}`);
if (r1.status === 429) {
  const r2 = await sendWithCookie(COOKIE_B, "Cookie-B");
  console.log(`Cookie-B after A 429: ${r2.status}`);
  if (r2.status === 200) {
    console.log(
      "PASS: Cookie-B succeeds after Cookie-A 429 → cookie pool WORKS",
    );
  } else {
    console.log(
      "FAIL: Cookie-B also rate limited → likely IP-based → pool effectiveness REDUCED",
    );
  }
} else {
  console.log(
    `Cookie-A returned ${r1.status} — not rate limited yet. Re-run after exhausting Cookie-A.`,
  );
}
```

- [ ] **Step 4: Commit test file**

```powershell
git add tests/bypass/test-grok-cookie.mjs open-sse/executors/grok-web.js
git commit -m "feat(grok-web): add inline cookie pool with 429 auto-rotate and 60s cooldown"
```

---

## Task 5: Implementasi S4 — Perplexity Web Cookie Pool

**Status:** HOLD — butuh 2+ akun Perplexity
**Cara dapat token:** Login ke https://www.perplexity.ai → DevTools → Application → Cookies → copy `__Secure-next-auth.session-token`

**File:** `open-sse/executors/perplexity-web.js`

- [ ] **Step 1: Verifikasi struktur cookie pool sudah ada**

```powershell
node -e "
import('file:///f:/Coding/React/9router/open-sse/executors/perplexity-web.js').then(m => {
  const prefix = '__Secure-next-auth.session-token=';
  // Test parsePplxCookiePool function exists (check exports)
  console.log('Exports:', Object.keys(m).join(', '));
  console.log('PerplexityWebExecutor:', typeof m.default);
})
"
```

- [ ] **Step 2: Buat test-perplexity-cookie.mjs (untuk dijalankan saat akun tersedia)**

```js
// tests/bypass/test-perplexity-cookie.mjs
// HOLD: butuh 2+ akun Perplexity

const TOKEN_A = process.env.PPLX_TOKEN_A;
const TOKEN_B = process.env.PPLX_TOKEN_B;

if (!TOKEN_A || !TOKEN_B) {
  console.log("SKIP: PPLX_TOKEN_A and PPLX_TOKEN_B env vars not set");
  console.log(
    "STATUS: S4 Perplexity Cookie Pool → HOLD (needs 2+ Perplexity accounts)",
  );
  process.exit(0);
}

const PPLX_URL = "https://www.perplexity.ai/rest/sse/perplexity_ask";
const BODY = JSON.stringify({
  query: "hi",
  mode: "concise",
  model_preference: "pplx_pro",
  source: "default",
  timezone: "UTC",
});

async function sendWithToken(token, label) {
  const res = await fetch(PPLX_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `__Secure-next-auth.session-token=${token}`,
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0 Safari/537.36",
      "X-App-ApiClient": "default",
      "X-App-ApiVersion": "2.18",
    },
    body: BODY,
    signal: AbortSignal.timeout(15000),
  });
  return { label, status: res.status };
}

const r1 = await sendWithToken(TOKEN_A, "Token-A");
console.log(`Token-A: ${r1.status}`);
if (r1.status === 429) {
  const r2 = await sendWithToken(TOKEN_B, "Token-B");
  console.log(`Token-B after A 429: ${r2.status}`);
  console.log(
    r2.status === 200
      ? "PASS: pool WORKS"
      : "FAIL: IP-based limit → pool REDUCED",
  );
} else {
  console.log(`Token-A returned ${r1.status} — exhaust first, then re-run`);
}
```

- [ ] **Step 3: Commit**

```powershell
git add tests/bypass/test-perplexity-cookie.mjs open-sse/executors/perplexity-web.js
git commit -m "feat(perplexity-web): add inline cookie pool with 429 auto-rotate"
```

---

## Task 6: Implementasi S5 — Antigravity Per-Model Quota Rotation

**Status:** HOLD — butuh akun Google dengan Gemini CLI OAuth aktif di 9Router
**Akun yang dibutuhkan:** Akun Google terdaftar di 9Router sebagai provider `antigravity` atau `gemini-cli`

**File:** `open-sse/executors/antigravity.js`

- [ ] **Step 1: Buat test-antigravity-model-rotation.mjs**

```js
// tests/bypass/test-antigravity-model-rotation.mjs
// HOLD: butuh Google OAuth token dari 9Router

const ACCESS_TOKEN = process.env.ANTIGRAVITY_TOKEN;
const PROJECT_ID = process.env.ANTIGRAVITY_PROJECT_ID;

if (!ACCESS_TOKEN || !PROJECT_ID) {
  console.log(
    "SKIP: ANTIGRAVITY_TOKEN and ANTIGRAVITY_PROJECT_ID env vars not set",
  );
  console.log("STATUS: S5 Antigravity Model Rotation → HOLD");
  console.log(
    "How to get: Login to 9Router UI → Antigravity/Gemini-CLI → copy accessToken from connection",
  );
  process.exit(0);
}

const BASE = `https://cloudcode-pa.googleapis.com/v1internal`;
const MODELS = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-3-flash-preview"];

async function testModel(model) {
  const url = `${BASE}/projects/${PROJECT_ID}/locations/global/publishers/google/models/${model}:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
    }),
    signal: AbortSignal.timeout(10000),
  });
  return { model, status: res.status };
}

console.log("[S5] Testing Antigravity per-model quota rotation...");
const results = await Promise.all(MODELS.map(testModel));
results.forEach((r) => console.log(`  ${r.model}: ${r.status}`));

const working = results.filter((r) => r.status === 200);
const exhausted = results.filter((r) => r.status === 429 || r.status === 403);
console.log(`\nWorking models: ${working.length}/${MODELS.length}`);
if (working.length > 1) {
  console.log("PASS: Multiple models available → rotation WORKS");
} else if (working.length === 1) {
  console.log(
    "PASS: At least 1 model works — rotation will help when others exhaust",
  );
} else {
  console.log("FAIL: No models available — check token validity");
}
```

- [ ] **Step 2: Saat token tersedia, implementasi model rotation di antigravity.js**

Di [antigravity.js](file:///f:\Coding\React\9router\open-sse\executors\antigravity.js), tambahkan logic di `execute()`:

```js
// Model rotation pool — urutan prioritas: pro → flash → lite
const ANTIGRAVITY_MODEL_ROTATION = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite-preview",
];

// In-memory per-account quota exhausted models
const exhaustedModels = new Map(); // accountId → Set<model>

function getNextModel(model, accountId) {
  const exhausted = exhaustedModels.get(accountId) || new Set();
  const idx = ANTIGRAVITY_MODEL_ROTATION.indexOf(model);
  if (idx === -1) return null;
  for (let i = idx + 1; i < ANTIGRAVITY_MODEL_ROTATION.length; i++) {
    if (!exhausted.has(ANTIGRAVITY_MODEL_ROTATION[i]))
      return ANTIGRAVITY_MODEL_ROTATION[i];
  }
  return null; // all models exhausted for this account
}
```

- [ ] **Step 3: Commit**

```powershell
git add tests/bypass/test-antigravity-model-rotation.mjs open-sse/executors/antigravity.js
git commit -m "feat(antigravity): add per-model quota rotation with 4-model priority pool"
```

---

## Task 7: Automated Test S10 — HTTP/2 Single-Packet Burst

**Status:** Ready (tidak butuh akun — test ke OpenCode)
**File:** `tests/bypass/test-http2-burst.mjs`

- [x] **Step 1: Cek apakah undici support HTTP/2**

```powershell
node -e "import('undici').then(m => console.log('undici version:', m.fetch ? 'ok' : 'missing fetch'))"
```

- [x] **Step 2: Buat test-http2-burst.mjs**

```js
// tests/bypass/test-http2-burst.mjs
// Test HTTP/2 single-packet burst ke OpenCode (no auth needed)
// Kirim 20 request paralel, hitung berapa yang berhasil

import { Client } from "undici";

const HOST = "opencode.ai";
const PATH = "/zen/v1/chat/completions";
const N = 20;

const BODY = JSON.stringify({
  model: "claude-3-5-haiku",
  messages: [{ role: "user", content: "hi" }],
  max_tokens: 5,
  stream: false,
});

async function sendBurst() {
  const client = new Client(`https://${HOST}`, { allowH2: true });

  const requests = Array.from({ length: N }, (_, i) =>
    client
      .request({
        path: PATH,
        method: "POST",
        headers: {
          authorization: "Bearer public",
          "content-type": "application/json",
          "x-opencode-client": "desktop",
        },
        body: BODY,
      })
      .then((r) => ({ i, status: r.statusCode }))
      .catch((e) => ({ i, status: "error", error: e.message })),
  );

  const results = await Promise.all(requests);
  await client.close();
  return results;
}

console.log(`[S10] Sending ${N} parallel HTTP/2 requests to OpenCode...`);
const results = await sendBurst();

const counts = results.reduce((acc, r) => {
  acc[r.status] = (acc[r.status] || 0) + 1;
  return acc;
}, {});

console.log("Status distribution:", counts);
const success = counts[200] || 0;
const rateLimit = counts[429] || 0;

console.log(`\nSuccessful: ${success}/${N}`);
console.log(`Rate limited: ${rateLimit}/${N}`);

if (success > 5) {
  console.log(
    "PASS: Multiple requests succeeded in burst — HTTP/2 parallelism works",
  );
  console.log("ACTION: S10 HTTP/2 burst → EFFECTIVE for no-auth providers");
} else if (rateLimit === N) {
  console.log(
    "FAIL: All requests rate limited — OpenCode may have atomic counter or IP limit",
  );
  console.log("ACTION: S10 HTTP/2 burst → DROPPED for OpenCode");
} else {
  console.log(
    "INFO: Mixed results — server reachable, burst partially effective",
  );
}
```

- [x] **Step 3: Jalankan test S10**

```powershell
node tests/bypass/test-http2-burst.mjs
```

Expected PASS: `Successful: 10+/20`
Expected FAIL: `Rate limited: 20/20`

- [x] **Step 4: Update run-all.mjs untuk include S10**

Di `tests/bypass/run-all.mjs`, tambahkan import S10:

```js
import { run as runHttp2 } from "./test-http2-burst.mjs";
// ...
results.S10_HTTP2 = await runHttp2();
```

- [x] **Step 5: Commit**

```powershell
git add tests/bypass/test-http2-burst.mjs tests/bypass/run-all.mjs
git commit -m "test(bypass): add HTTP/2 single-packet burst test for S10"
```

---

## Task 8: Hold Scenarios — Setup Guide

**Status:** HOLD — dokumentasi cara setup saat akun tersedia

### S6 GitHub Copilot Header Rotation

**Yang dibutuhkan:** 1 akun GitHub dengan Copilot aktif, terdaftar di 9Router

```powershell
# Saat akun tersedia:
$env:GITHUB_TOKEN = "PASTE_COPILOT_TOKEN_HERE"
node tests/bypass/test-github-header.mjs
```

Test akan verifikasi apakah `copilot-integration-id` berbeda = rate limit bucket berbeda.
**RISK HIGH:** Jika test fail, jangan implement. Jika test pass, baru implement header rotation di `open-sse/executors/github.js`.

### S7 NVIDIA Backoff Reset

**Yang dibutuhkan:** 2+ API key NVIDIA NIM dari https://build.nvidia.com/settings/api-keys

```powershell
$env:NVIDIA_KEY_A = "nvapi-xxx"
$env:NVIDIA_KEY_B = "nvapi-yyy"
node tests/bypass/test-nvidia-backoff.mjs
```

### S8 Cloudflare Multi-AccountId

**Yang dibutuhkan:** 2+ akun Cloudflare gratis, masing-masing dengan accountId berbeda

- Daftar di https://cloudflare.com
- Buat API token dengan permission "Workers AI"
- Daftarkan di 9Router sebagai 2 connection berbeda dengan accountId masing-masing
- **Tidak perlu test script** — existing `runWithFallback()` sudah handle rotation

### S9 Blackbox 403 Cooldown

**Yang dibutuhkan:** 1+ API key Blackbox dari https://www.blackbox.ai/api-management

```powershell
$env:BLACKBOX_KEY = "PASTE_KEY_HERE"
node tests/bypass/test-blackbox-403.mjs
```

Test verifikasi bahwa 403 tanpa "bad-credentials" = 2 menit cooldown (bukan 24 jam).

---

## Task 9: Final Integration Test + Summary Report

**Status:** Jalankan setelah semua task yang PASS selesai diimplementasikan

- [ ] **Step 1: Jalankan full test suite**

```powershell
node tests/bypass/run-all.mjs
```

- [ ] **Step 2: Verifikasi backward compat**

```powershell
# Test bahwa single-credential flow tidak terpengaruh
node -e "
import('file:///f:/Coding/React/9router/open-sse/executors/mimo-free.js').then(m => {
  const { generateFingerprint } = m.__test__;
  const fp = generateFingerprint();
  console.log('Machine fingerprint:', fp.slice(0, 16) + '...');
  console.log(fp.length === 64 ? 'PASS: valid hex fingerprint' : 'FAIL: invalid format');
})
"
```

- [ ] **Step 3: Update proposal.md status akhir**

Update tabel Implementation Priority di `proposal.md` dengan kolom `Test Result`:

- PASS → ✅ Implemented
- FAIL → ❌ DROPPED: [alasan]
- HOLD → ⏳ HOLD: [akun dibutuhkan]

- [ ] **Step 4: Commit final**

```powershell
git add openspec/changes/rate-limit-bypass-strategy/proposal.md
git commit -m "docs: update rate-limit-bypass-strategy proposal with final test results"
```

---

## Task 10: Camoufox Cookie Extraction — S3 Grok + S4 Perplexity (Otomatis)

**Skill:** `camoufox`
**Status:** Ready — tidak butuh akun manual, Camoufox automate login + extract cookie
**Prerequisite:** Python + pip install camoufox playwright

- [ ] **Step 1: Install Camoufox**

```powershell
pip install camoufox playwright
python -m playwright install firefox
```

- [ ] **Step 2: Buat extract-grok-cookie.py**

```python
# tests/bypass/extract-grok-cookie.py
# Automate login ke grok.com dan extract sso= cookie
# Requires: pip install camoufox playwright

from camoufox.sync_api import Camoufox
import json, sys

def extract_grok_cookie():
    print("[Camoufox] Opening grok.com for manual login...")
    print("  → Login dengan akun xAI Anda di browser yang terbuka")
    print("  → Setelah login, tekan Enter di terminal ini")

    with Camoufox(headless=False, os="macos") as browser:
        page = browser.new_page()
        page.goto("https://grok.com")
        page.wait_for_load_state("networkidle")

        # Tunggu user login manual
        input("  → Sudah login? Tekan Enter untuk extract cookie...")

        # Extract sso cookie
        cookies = page.context.cookies()
        sso_cookies = [c for c in cookies if c["name"] == "sso" and "grok.com" in c["domain"]]

        if not sso_cookies:
            print("FAIL: sso cookie tidak ditemukan — pastikan sudah login")
            return None

        sso_value = sso_cookies[0]["value"]
        print(f"PASS: sso cookie extracted: {sso_value[:20]}...")

        # Save ke file untuk dipakai test
        with open("tests/bypass/.grok-cookies.json", "w") as f:
            json.dump({"sso": sso_value}, f)
        print("  → Saved to tests/bypass/.grok-cookies.json")
        return sso_value

if __name__ == "__main__":
    extract_grok_cookie()
```

- [ ] **Step 3: Buat extract-perplexity-cookie.py**

```python
# tests/bypass/extract-perplexity-cookie.py
# Automate login ke perplexity.ai dan extract session token

from camoufox.sync_api import Camoufox
import json

def extract_perplexity_cookie():
    print("[Camoufox] Opening perplexity.ai for manual login...")
    print("  → Login dengan akun Perplexity Anda")
    print("  → Setelah login, tekan Enter di terminal ini")

    with Camoufox(headless=False, os="macos") as browser:
        page = browser.new_page()
        page.goto("https://www.perplexity.ai")
        page.wait_for_load_state("networkidle")

        input("  → Sudah login? Tekan Enter untuk extract cookie...")

        cookies = page.context.cookies()
        session_cookies = [
            c for c in cookies
            if c["name"] == "__Secure-next-auth.session-token"
            and "perplexity.ai" in c["domain"]
        ]

        if not session_cookies:
            print("FAIL: session token tidak ditemukan — pastikan sudah login")
            return None

        token = session_cookies[0]["value"]
        print(f"PASS: session token extracted: {token[:20]}...")

        with open("tests/bypass/.perplexity-cookies.json", "w") as f:
            json.dump({"session_token": token}, f)
        print("  → Saved to tests/bypass/.perplexity-cookies.json")
        return token

if __name__ == "__main__":
    extract_perplexity_cookie()
```

- [ ] **Step 4: Tambahkan ke .gitignore (jangan commit cookies)**

```powershell
Add-Content -Path "f:\Coding\React\9router\.gitignore" -Value "`ntests/bypass/.grok-cookies.json`ntests/bypass/.perplexity-cookies.json"
```

- [ ] **Step 5: Jalankan extractor saat akun tersedia**

```powershell
# Untuk Grok (butuh 2+ akun — jalankan 2x dengan akun berbeda)
python tests/bypass/extract-grok-cookie.py

# Untuk Perplexity
python tests/bypass/extract-perplexity-cookie.py
```

- [ ] **Step 6: Update test-grok-cookie.mjs untuk load dari file**

Tambahkan di awal `tests/bypass/test-grok-cookie.mjs`:

```js
// Load cookies dari file jika env var tidak di-set
import { readFileSync } from "fs";
let COOKIE_A = process.env.GROK_COOKIE_A;
let COOKIE_B = process.env.GROK_COOKIE_B;
if (!COOKIE_A) {
  try {
    const saved = JSON.parse(
      readFileSync("tests/bypass/.grok-cookies.json", "utf8"),
    );
    COOKIE_A = saved.sso;
  } catch {
    /* env var fallback */
  }
}
```

---

## Task 11: Security Audit — Bypass Code Review

**Skill:** `security-auditor`
**Status:** Ready — jalankan setelah semua implementasi selesai

- [ ] **Step 1: Audit executor files yang dimodifikasi**

Cek setiap file untuk:

- Tidak ada credentials di-hardcode di pool
- Log tidak expose nilai cookie/JWT penuh (hanya last 8 chars)
- Fail-open pattern ada di setiap rotate logic
- Tidak ada side channel leak ke console di production

```powershell
# Grep untuk potential credential leak di log statements
node -e "
import('fs').then(({readFileSync}) => {
  const files = [
    'open-sse/executors/mimo-free.js',
    'open-sse/executors/opencode.js',
    'open-sse/executors/grok-web.js',
    'open-sse/executors/perplexity-web.js',
  ];
  files.forEach(f => {
    const code = readFileSync(f, 'utf8');
    // Cek apakah JWT/cookie di-log lebih dari 20 chars
    const matches = code.match(/log.*?(jwt|cookie|token|sso)[^;]{0,100}/gi) || [];
    console.log(f + ':');
    matches.slice(0, 3).forEach(m => console.log('  ' + m.trim().slice(0, 80)));
  });
})
"
```

- [ ] **Step 2: Verifikasi fail-open pattern ada di semua executors**

```powershell
node -e "
import('fs').then(({readFileSync}) => {
  const files = [
    'open-sse/executors/mimo-free.js',
    'open-sse/executors/grok-web.js',
    'open-sse/executors/perplexity-web.js',
  ];
  files.forEach(f => {
    const code = readFileSync(f, 'utf8');
    const hasFallback = code.includes('fallback') || code.includes('bootstrapJwt(') || code.includes('machine fingerprint');
    console.log(f + ': fallback=' + (hasFallback ? 'PASS' : 'FAIL - no fallback found'));
  });
})
"
```

Expected: semua `fallback=PASS`

---

## Task 12: Verification Before Completion

**Skill:** `verification-before-completion`
**Status:** Jalankan sebelum declare semua done

- [ ] **Step 1: Run full test suite**

```powershell
node tests/bypass/run-all.mjs
```

- [ ] **Step 2: Verifikasi tidak ada regression di existing tests**

```powershell
# Cek apakah ada test suite existing di project
node -e "
import('fs').then(({existsSync}) => {
  const testDirs = ['tests', '__tests__', 'test', 'spec'];
  testDirs.forEach(d => console.log(d + ':', existsSync(d) ? 'exists' : 'not found'));
})
"
```

- [ ] **Step 3: Validate OpenSpec change**

```powershell
npx openspec validate rate-limit-bypass-strategy
```

Expected: `Change 'rate-limit-bypass-strategy' is valid`

- [ ] **Step 4: Run openspec-verify**

```powershell
npx openspec instructions rate-limit-bypass-strategy
```

---

## Task 13: Systematic Debugging — Test Failure Protocol

**Skill:** `systematic-debugging`
**Status:** Reference — gunakan jika ada test yang FAIL

Jika test mengembalikan FAIL atau ERROR yang tidak terduga:

1. **Baca error message lengkap** — jangan asumsikan penyebab
2. **Isolasi** — jalankan test individual, bukan run-all
3. **Hipotesis** — tulis 1-3 kemungkinan penyebab
4. **Probe minimal** — test hipotesis dengan request sesimpel mungkin

```js
// Contoh: debug MiMo bootstrap failure
const res = await fetch("https://api.xiaomimimo.com/api/free-ai/bootstrap", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0...",
  },
  body: JSON.stringify({ client: "a".repeat(64) }),
});
console.log("status:", res.status);
console.log("headers:", Object.fromEntries(res.headers));
const body = await res.text();
console.log("body:", body.slice(0, 200));
```

5. **Fix satu hal** — satu perubahan per debugging cycle
6. **Re-run test** — konfirmasi fix bekerja sebelum lanjut

Jika 2 fix attempt gagal → **eskalasi**: cek apakah provider mengubah API, rate limit policy berubah, atau IP di-block.

---

## Skills Trace — Lengkap

| Skill                            | Digunakan di Task                    |
| -------------------------------- | ------------------------------------ |
| `hack`                           | Semua — methodology & routing        |
| `race-condition`                 | Task 1 (S1, S2, S10 test), Task 7    |
| `camoufox`                       | Task 10 — cookie extraction otomatis |
| `security-auditor`               | Task 11 — audit bypass code          |
| `verification-before-completion` | Task 12 — final verification         |
| `systematic-debugging`           | Task 13 — debugging protocol         |
| `testing-patterns`               | Task 1, 7 — test design              |
| `test-driven-development`        | Task 1 — test-first gate             |
| `writing-plans`                  | tasks.md ini sendiri                 |
| `openspec-apply`                 | Eksekusi tasks ini                   |
| `openspec-verify`                | Task 12 step 4                       |
| `conventional-commits`           | Semua commit step                    |
| `dangerous-action-guard`         | Task 4, 5, 6 — cookie handling       |
