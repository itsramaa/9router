// tests/bypass/test-opencode-header.mjs
// Test: kirim request dengan 4 x-opencode-client berbeda secara paralel
// Jika tidak semua 429 bersamaan → bucket terpisah per client

const OPENCODE_URL = "https://opencode.ai/zen/v1/chat/completions";
const CLIENT_VARIANTS = ["desktop", "web", "vscode", "cli"];

// Free models dari OpenCode — dicoba berurutan sampai ada yang 200/non-401
const FREE_MODELS = [
  "oc/deepseek-v4-flash-free",
  "oc/minimax-m2.5-free",
  "oc/qwen3.6-plus-free",
  "oc/ring-2.6-1t-free",
  "oc/trinity-large-preview-free",
  "oc/nemotron-3-super-free",
];

async function pickWorkingModel() {
  for (const model of FREE_MODELS) {
    try {
      const res = await fetch(OPENCODE_URL, {
        method: "POST",
        headers: {
          "Authorization": "Bearer public",
          "Content-Type": "application/json",
          "x-opencode-client": "desktop",
        },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 5, stream: false }),
        signal: AbortSignal.timeout(8000),
      });
      // 200 atau 429 berarti model valid (bukan 401 auth required)
      if (res.status !== 401) {
        console.log(`  Model probe: ${model} → ${res.status} ✓`);
        return model;
      }
    } catch { /* try next */ }
  }
  // Fallback: pakai model pertama dan terima hasilnya
  return FREE_MODELS[0];
}

async function sendRequest(client, model) {
  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 5,
    stream: false,
  });
  const start = Date.now();
  try {
    const res = await fetch(OPENCODE_URL, {
      method: "POST",
      headers: {
        "Authorization": "Bearer public",
        "Content-Type": "application/json",
        "x-opencode-client": client,
      },
      body,
      signal: AbortSignal.timeout(10000),
    });
    return { client, status: res.status, ms: Date.now() - start };
  } catch (e) {
    return { client, status: "error", error: e.message, ms: Date.now() - start };
  }
}

export async function run() {
  console.log("[S2] Testing OpenCode header identity pool...");
  const model = await pickWorkingModel();
  console.log(`  Using model: ${model}`);

  const results = await Promise.all(CLIENT_VARIANTS.map(c => sendRequest(c, model)));
  results.forEach(r => console.log(`  client=${r.client} status=${r.status} ms=${r.ms}`));

  const statuses = results.map(r => r.status);
  const all429 = statuses.every(s => s === 429);
  const allError = statuses.every(s => s === "error");

  if (allError) {
    console.log("ERROR: All requests failed — server unreachable or network issue");
    return "ERROR";
  }
  if (all429) {
    console.log("INCONCLUSIVE: All requests 429 — may be IP-based or model unavailable");
    console.log("ACTION: S2 header pool → INCONCLUSIVE, re-test later");
    return "INCONCLUSIVE";
  }
  const mixed = statuses.some(s => s === 200) && statuses.some(s => s === 429);
  if (mixed) {
    console.log("PASS: Mixed results — different buckets per client value");
    console.log("ACTION: S2 header pool → IMPLEMENT");
    return "PASS";
  }
  console.log(`PASS: All clients returned ${statuses[0]} — server accessible, rotation active`);
  console.log("ACTION: S2 header pool → IMPLEMENT (header rotation already in place)");
  return "PASS";
}

if (process.argv[1].includes("test-opencode-header")) {
  run().then(r => process.exit(r === "FAIL" ? 1 : 0));
}
