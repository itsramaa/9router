// tests/bypass/test-http2-burst.mjs
// Test HTTP/2 single-packet burst ke OpenCode (no auth needed)
// Kirim 20 request paralel via HTTP/2, hitung berapa yang berhasil

import { Client } from "undici";

const HOST = "opencode.ai";
const PATH = "/zen/v1/chat/completions";
const N = 20;

// Free models dari OpenCode — probe sampai ada yang non-401
const FREE_MODELS = [
  "oc/deepseek-v4-flash-free",
  "oc/minimax-m2.5-free",
  "oc/qwen3.6-plus-free",
  "oc/ring-2.6-1t-free",
  "oc/trinity-large-preview-free",
  "oc/nemotron-3-super-free",
];

async function pickWorkingModel(client) {
  for (const model of FREE_MODELS) {
    try {
      const body = JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 5, stream: false });
      const res = await client.request({
        path: PATH, method: "POST",
        headers: { "authorization": "Bearer public", "content-type": "application/json", "x-opencode-client": "desktop" },
        body,
      });
      await res.body.dump().catch(() => { });
      if (res.statusCode !== 401) {
        console.log(`  Model probe: ${model} → ${res.statusCode} ✓`);
        return model;
      }
    } catch { /* try next */ }
  }
  return FREE_MODELS[0];
}

export async function run() {
  console.log(`[S10] Sending ${N} parallel HTTP/2 requests to OpenCode...`);

  const client = new Client(`https://${HOST}`, { allowH2: true });

  const model = await pickWorkingModel(client);
  console.log(`  Using model: ${model}`);

  const BODY = JSON.stringify({
    model,
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 5,
    stream: false,
  });

  const requests = Array.from({ length: N }, (_, i) =>
    client.request({
      path: PATH,
      method: "POST",
      headers: {
        "authorization": "Bearer public",
        "content-type": "application/json",
        "x-opencode-client": "desktop",
      },
      body: BODY,
    })
      .then(async r => {
        // drain body to avoid socket hang
        await r.body.dump().catch(() => { });
        return { i, status: r.statusCode };
      })
      .catch(e => ({ i, status: "error", error: e.message }))
  );

  const results = await Promise.all(requests);
  await client.close();

  const counts = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  console.log("  Status distribution:", JSON.stringify(counts));

  const success = counts[200] || 0;
  const rateLimit = counts[429] || 0;
  const unauthorized = counts[401] || 0;
  const errors = counts["error"] || 0;

  console.log(`  Successful: ${success}/${N} | Rate limited: ${rateLimit}/${N} | 401: ${unauthorized}/${N} | Errors: ${errors}/${N}`);

  if (errors === N) {
    console.log("ERROR: All requests failed — network issue or server down");
    return "ERROR";
  }
  if (rateLimit === N) {
    console.log("FAIL: All requests rate limited — OpenCode has atomic counter or IP limit");
    console.log("ACTION: S10 HTTP/2 burst → DROPPED for OpenCode");
    return "FAIL";
  }
  if (unauthorized > 0 && rateLimit === 0) {
    console.log("INFO: Server responds with 401 (auth required for this model) — HTTP/2 connection works");
    console.log("INFO: Rate limit counter behavior cannot be tested without auth on this endpoint");
    console.log("ACTION: S10 HTTP/2 burst → INCONCLUSIVE (needs auth endpoint to test counter bypass)");
    return "INCONCLUSIVE";
  }
  if (success > N / 2) {
    console.log("PASS: Majority of requests succeeded — HTTP/2 burst effective");
    console.log("ACTION: S10 HTTP/2 burst → IMPLEMENT for no-auth providers");
    return "PASS";
  }
  if (success > 0) {
    console.log("PASS: Some requests succeeded — HTTP/2 parallelism works");
    console.log("ACTION: S10 HTTP/2 burst → PARTIALLY EFFECTIVE");
    return "PASS";
  }

  console.log("INCONCLUSIVE: Unexpected status mix — re-test with different endpoint");
  return "INCONCLUSIVE";
}

if (process.argv[1].includes("test-http2-burst")) {
  run().then(r => process.exit(r === "FAIL" ? 1 : 0));
}
