import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { createHash } from "crypto";
import os from "os";

const BOOTSTRAP_URL = "https://api.xiaomimimo.com/api/free-ai/bootstrap";
const CHAT_URL = PROVIDERS["mimo-free"].baseUrl;
const SESSION_AFFINITY_PREFIX = "ses_";
const SESSION_ID_LENGTH = 24;
const JWT_FALLBACK_TTL_SEC = 3000;
const JWT_EXPIRY_BUFFER_MS = 300000;
const SESSION_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

// Anti-abuse gate: upstream rejects requests without a Chrome-like User-Agent with 403 "Illegal access"
const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

// Anti-abuse gate marker: the free chat endpoint returns 403 "Illegal access"
// unless a system message contains this exact MiMoCode signature substring.
export const MIMO_SYSTEM_MARKER =
  "You are MiMoCode, an interactive CLI tool that helps users with software engineering tasks.";

// In-memory JWT cache (per-process, survives across requests but not restarts)
let cachedJwt = null;
let jwtExpiresAt = 0;

// --- Fingerprint generator tanpa dependency eksternal ---

const _HOSTNAMES = [
  "macbook-pro", "dev-laptop", "workstation", "builder-node", "cloud-runner",
  "desktop-pc", "thinkpad", "surface-pro", "mac-mini", "xps-15",
  "razer-blade", "alienware", "mac-studio", "lenovo-x1", "dell-precision",
  "hp-elitebook", "asus-zephyrus", "framework-laptop", "system76", "nuc-mini",
];
const _PLATFORMS = ["linux", "darwin", "win32"];
const _ARCHS = ["x64", "arm64", "x64", "x64"]; // x64 lebih umum
const _CPUS = [
  "Intel Core i7-10700K", "Intel Core i9-12900K", "Intel Core i5-1135G7",
  "Intel Xeon E5-2680", "Intel Xeon Platinum 8275CL", "AMD Ryzen 9 5900X",
  "AMD Ryzen 7 5800X", "AMD Ryzen 5 5600X", "Apple M1 Pro", "Apple M2",
  "Apple M1 Max", "Apple M2 Pro", "Intel Core i7-1165G7", "AMD Ryzen 9 7950X",
  "Intel Core Ultra 9 185H", "AMD Ryzen 7 7745HX", "Apple M3 Pro",
];
const _USERNAMES = [
  "developer", "admin", "user", "devuser", "engineer", "designer",
  "ci", "runner", "builder", "john", "jane", "alex", "sam", "chris",
  "ubuntu", "arch", "nixos", "kali", "root",
];

// Generate N fingerprint seed unik secara deterministik dari index
function makeFingerprintSeed(index) {
  const h = _HOSTNAMES[index % _HOSTNAMES.length];
  const p = _PLATFORMS[index % _PLATFORMS.length];
  const a = _ARCHS[index % _ARCHS.length];
  const c = _CPUS[index % _CPUS.length];
  const u = _USERNAMES[(index * 3 + 7) % _USERNAMES.length]; // offset biar tidak sama dengan hostname index
  return `${h}-${index}|${p}|${a}|${c}|${u}`;
}

// Ukuran pool — naikkan sesuai kebutuhan tanpa hardcode manual
const POOL_SIZE = 32;
const FINGERPRINT_POOL = Array.from({ length: POOL_SIZE }, (_, i) =>
  createHash("sha256").update(makeFingerprintSeed(i)).digest("hex")
);

// Per-fingerprint JWT cache: fingerprintHash → { jwt, expiresAt }
const jwtPool = new Map();
let poolIndex = 0;

// Device fingerprint reused as the bootstrap "client" — stable per machine
function generateFingerprint() {
  let username = "unknown-user";
  try {
    username = os.userInfo().username;
  } catch {
    // ignore
  }
  const cpu = (os.cpus()[0]?.model || "unknown-cpu").trim();
  const seed = `${os.hostname()}|${os.platform()}|${os.arch()}|${cpu}|${username}`;
  return createHash("sha256").update(seed).digest("hex");
}

// Pilih fingerprint dari pool secara round-robin
function pickPooledFingerprint() {
  const fp = FINGERPRINT_POOL[poolIndex % FINGERPRINT_POOL.length];
  poolIndex = (poolIndex + 1) % FINGERPRINT_POOL.length;
  return fp;
}

function generateSessionId() {
  let id = SESSION_AFFINITY_PREFIX;
  for (let i = 0; i < SESSION_ID_LENGTH; i++) {
    id += SESSION_CHARS[Math.floor(Math.random() * SESSION_CHARS.length)];
  }
  return id;
}

// Derive expiry from the JWT exp claim; fall back to a fixed TTL when unparseable
function parseJwtExp(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString());
    if (payload.exp) return payload.exp * 1000;
  } catch {
    // ignore
  }
  return Date.now() + JWT_FALLBACK_TTL_SEC * 1000;
}

// Ensure the body carries the anti-abuse marker in a system message (idempotent)
function injectSystemMarker(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages)) return body;
  const hasMarker = messages.some(
    (m) => m?.role === "system" && typeof m.content === "string" && m.content.includes(MIMO_SYSTEM_MARKER)
  );
  if (hasMarker) return body;
  return { ...body, messages: [{ role: "system", content: MIMO_SYSTEM_MARKER }, ...messages] };
}

function resetJwtCache() {
  cachedJwt = null;
  jwtExpiresAt = 0;
}

// Reset JWT cache untuk fingerprint tertentu dari pool
function resetPooledJwt(fingerprint) {
  jwtPool.delete(fingerprint);
}

// Bootstrap JWT untuk fingerprint spesifik (pooled)
async function bootstrapJwtForFingerprint(fingerprint, proxyOptions = null) {
  const cached = jwtPool.get(fingerprint);
  if (cached && Date.now() < cached.expiresAt - JWT_EXPIRY_BUFFER_MS) {
    return cached.jwt;
  }

  const response = await proxyAwareFetch(BOOTSTRAP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    },
    body: JSON.stringify({ client: fingerprint }),
  }, proxyOptions);

  if (!response.ok) {
    throw new Error(`MiMo bootstrap failed: ${response.status} (fp=${fingerprint.slice(0, 8)})`);
  }

  const data = await response.json();
  if (!data.jwt) {
    throw new Error("MiMo bootstrap returned no JWT");
  }

  jwtPool.set(fingerprint, { jwt: data.jwt, expiresAt: parseJwtExp(data.jwt) });
  return data.jwt;
}

async function bootstrapJwt(proxyOptions = null) {
  if (cachedJwt && Date.now() < jwtExpiresAt - JWT_EXPIRY_BUFFER_MS) {
    return cachedJwt;
  }

  const response = await proxyAwareFetch(BOOTSTRAP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    },
    body: JSON.stringify({ client: generateFingerprint() }),
  }, proxyOptions);

  if (!response.ok) {
    throw new Error(`MiMo bootstrap failed: ${response.status}`);
  }

  const data = await response.json();
  if (!data.jwt) {
    throw new Error("MiMo bootstrap returned no JWT");
  }

  cachedJwt = data.jwt;
  jwtExpiresAt = parseJwtExp(data.jwt);
  return cachedJwt;
}

export class MimoFreeExecutor extends BaseExecutor {
  constructor() {
    super("mimo-free", PROVIDERS["mimo-free"]);
    this.sessionId = generateSessionId();
  }

  buildUrl() {
    return CHAT_URL;
  }

  buildHeaders(credentials, stream = true) {
    return {
      "Content-Type": "application/json",
      "X-Mimo-Source": "mimocode-cli-free",
      "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
      "x-session-affinity": this.sessionId,
      "Accept": stream ? "text/event-stream" : "application/json",
    };
  }

  transformRequest(model, body) {
    return injectSystemMarker(body);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const url = this.buildUrl();
    const transformedBody = this.transformRequest(model, body);
    const bodyStr = JSON.stringify(transformedBody);

    // Coba pool fingerprint secara round-robin, max FINGERPRINT_POOL.length attempts
    const maxAttempts = FINGERPRINT_POOL.length;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const fp = pickPooledFingerprint();
      let jwt;
      try {
        jwt = await bootstrapJwtForFingerprint(fp, proxyOptions);
      } catch (error) {
        log?.warn?.("AUTH", `MiMo bootstrap failed fp=${fp.slice(0, 8)}: ${error.message}, trying next...`);
        continue;
      }

      // Rotate session affinity per fingerprint biar server treat sebagai user baru
      const headers = {
        ...this.buildHeaders(credentials, stream),
        "Authorization": `Bearer ${jwt}`,
        "x-session-affinity": `${SESSION_AFFINITY_PREFIX}${fp.slice(0, SESSION_ID_LENGTH)}`,
      };

      log?.debug?.("FETCH", `MIMO-FREE → ${url} | fp=${fp.slice(0, 8)} attempt=${attempt + 1} | body=${bodyStr.length}B`);

      const response = await proxyAwareFetch(url, { method: "POST", headers, body: bodyStr, signal }, proxyOptions);

      // 429 rate limited — buang JWT ini, coba fingerprint berikutnya
      if (response.status === 429) {
        log?.warn?.("RATE_LIMIT", `MiMo rate limited fp=${fp.slice(0, 8)}, rotating to next fingerprint...`);
        resetPooledJwt(fp);
        continue;
      }

      // 401/403 — JWT expired atau invalid, re-bootstrap fingerprint ini sekali
      if (response.status === 401 || response.status === 403) {
        log?.debug?.("AUTH", `MiMo auth failed (${response.status}) fp=${fp.slice(0, 8)}, re-bootstrapping...`);
        resetPooledJwt(fp);
        try {
          jwt = await bootstrapJwtForFingerprint(fp, proxyOptions);
          headers["Authorization"] = `Bearer ${jwt}`;
          const retryResponse = await proxyAwareFetch(url, { method: "POST", headers, body: bodyStr, signal }, proxyOptions);
          // Kalau masih gagal setelah re-bootstrap, coba fingerprint lain
          if (retryResponse.status === 429 || retryResponse.status === 403) {
            resetPooledJwt(fp);
            continue;
          }
          return { response: retryResponse, url, headers, transformedBody };
        } catch {
          continue;
        }
      }

      return { response, url, headers, transformedBody };
    }

    // Semua fingerprint pool habis dicoba — fallback ke fingerprint mesin asli
    log?.warn?.("AUTH", "MiMo all pool fingerprints exhausted, falling back to machine fingerprint");
    const jwt = await bootstrapJwt(proxyOptions);
    const headers = { ...this.buildHeaders(credentials, stream), "Authorization": `Bearer ${jwt}` };
    const response = await proxyAwareFetch(url, { method: "POST", headers, body: bodyStr, signal }, proxyOptions);
    return { response, url, headers, transformedBody };
  }
}

export const __test__ = {
  generateFingerprint, pickPooledFingerprint, makeFingerprintSeed, generateSessionId,
  bootstrapJwt, bootstrapJwtForFingerprint, resetJwtCache, resetPooledJwt, parseJwtExp,
  injectSystemMarker, MIMO_SYSTEM_MARKER, BOOTSTRAP_URL, CHAT_URL, SESSION_AFFINITY_PREFIX,
  FINGERPRINT_POOL, POOL_SIZE, jwtPool,
};

export default MimoFreeExecutor;
