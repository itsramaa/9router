// tests/bypass/test-mimo-fingerprint.mjs
// Test: 2 fingerprint berbeda → harus dapat 2 JWT berbeda

const BOOTSTRAP_URL = "https://api.xiaomimimo.com/api/free-ai/bootstrap";

async function bootstrapJwt(fingerprint) {
  const res = await fetch(BOOTSTRAP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({ client: fingerprint }),
  });
  if (!res.ok) throw new Error(`Bootstrap failed: ${res.status}`);
  const data = await res.json();
  return data.jwt;
}

export async function run() {
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
      console.log("FAIL: Both fingerprints returned same JWT — rate limit is per-IP, not per-fingerprint");
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

if (process.argv[1].includes("test-mimo-fingerprint")) {
  run().then(r => process.exit(r === "PASS" ? 0 : 1));
}
