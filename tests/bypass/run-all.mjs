// tests/bypass/run-all.mjs
// Runner untuk semua automated test yang tidak butuh akun eksternal

import { run as runMimo } from "./test-mimo-fingerprint.mjs";
import { run as runOpencode } from "./test-opencode-header.mjs";
import { run as runHttp2 } from "./test-http2-burst.mjs";

const results = {};

console.log("=== Rate Limit Bypass Test Suite ===\n");

results.S1_MiMo = await runMimo();
console.log("");
results.S2_OpenCode = await runOpencode();
console.log("");
results.S10_HTTP2 = await runHttp2();
console.log("");

console.log("=== Summary ===");
for (const [scenario, result] of Object.entries(results)) {
  const icon = result === "PASS" ? "✅" : result === "FAIL" ? "❌" : "⚠️";
  console.log(`${icon} ${scenario}: ${result}`);
}

const failed = Object.values(results).filter(r => r === "FAIL").length;
console.log(`\n${failed === 0 ? "All tests passed or inconclusive — proceed with implementation" : `${failed} test(s) FAILED — check above for DROP actions`}`);
