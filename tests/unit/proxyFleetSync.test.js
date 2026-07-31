import { describe, it, expect, vi, beforeEach } from "vitest";
import { PROXY_FLEET_CONFIG } from "../../src/shared/constants/config.js";

const dbMocks = vi.hoisted(() => ({
  getProxyPoolById: vi.fn(),
  getProxyPools: vi.fn(),
  updateProxyPool: vi.fn(),
  createProxyPool: vi.fn(),
}));

const fetchMock = vi.hoisted(() =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: "ok" }),
    text: async () => "",
  }))
);

vi.mock("../../src/lib/localDb.js", () => dbMocks);
vi.mock("undici", () => ({ fetch: fetchMock }));

// Config reads env at module import; reload proxyFleetSync with stubbed env.
async function loadModule() {
  vi.resetModules();
  return import("../../src/shared/services/proxyFleetSync.js");
}

function stubFleetEnv(overrides = {}) {
  vi.stubEnv("FLEET_ENABLED", "true");
  vi.stubEnv("FLEET_URL", "http://fleet.test");
  vi.stubEnv("FLEET_API_KEY", "k");
  vi.stubEnv("FLEET_POOLS", "mimo");
  vi.stubEnv("FLEET_PROVIDERS", "opencode-go");
  for (const [k, v] of Object.entries(overrides)) vi.stubEnv(k, v);
}

describe("proxyFleetSync", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    for (const fn of Object.values(dbMocks)) fn.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok" }),
      text: async () => "",
    });
  });

  it("exposes the batch/report/hook surface", async () => {
    const mod = await loadModule();
    expect(typeof mod.syncFleetPool).toBe("function");
    expect(typeof mod.syncFleetProxies).toBe("function");
    expect(typeof mod.flushExhaustedReports).toBe("function");
    expect(typeof mod.maybeReportFleetExhaustion).toBe("function");
    expect(typeof mod.markFleetProxyExhausted).toBe("function");
  });

  it("config default pools resolve to at least one pool", () => {
    expect(Array.isArray(PROXY_FLEET_CONFIG.pools)).toBe(true);
    expect(PROXY_FLEET_CONFIG.pools.length).toBeGreaterThan(0);
    expect(PROXY_FLEET_CONFIG.providers).toContain("opencode-go");
    expect(PROXY_FLEET_CONFIG.providers).toContain("xiaomi-mimo");
  });

  it("maybeReportFleetExhaustion is a no-op when fleet disabled", async () => {
    const mod = await loadModule(); // FLEET_ENABLED unset → disabled
    await mod.maybeReportFleetExhaustion({
      provider: "opencode-go",
      connection: { providerSpecificData: { proxyPoolId: "abc" } },
      status: 429,
      errorText: "rate limit",
    });
    // Nothing queued → flush must not POST anything.
    const r = await mod.flushExhaustedReports();
    expect(r.reported).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("queues fleet proxies on upstream rate limit and flushes the batch report", async () => {
    stubFleetEnv();
    const fleetPool = { id: "pool-1", proxyUrl: "http://fleet-proxy-1:8080", name: "fleet:1.2.3.4", isActive: true };
    dbMocks.getProxyPoolById.mockResolvedValue(fleetPool);
    dbMocks.getProxyPools.mockResolvedValue([fleetPool]);
    dbMocks.updateProxyPool.mockResolvedValue(fleetPool);

    const mod = await loadModule();
    await mod.maybeReportFleetExhaustion({
      provider: "opencode-go",
      connection: { providerSpecificData: { proxyPoolId: "pool-1" } },
      status: 429,
      errorText: "Too many requests",
    });

    const r = await mod.flushExhaustedReports();
    expect(r.reported).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/proxy/report-exhausted/batch");
    const body = JSON.parse(opts.body);
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0].proxy_url).toBe(fleetPool.proxyUrl);
    expect(body.reports[0].reason).toBe("upstream_rate_limited");
    // Local pool deactivated after a successful report.
    expect(dbMocks.updateProxyPool).toHaveBeenCalledWith("pool-1", expect.objectContaining({ testStatus: "error", isActive: false }));
  });

  it("ignores non-fleet pools", async () => {
    stubFleetEnv();
    dbMocks.getProxyPoolById.mockResolvedValue({ id: "pool-2", proxyUrl: "http://other:8080", name: "manual", isActive: true });

    const mod = await loadModule();
    await mod.maybeReportFleetExhaustion({
      provider: "opencode-go",
      connection: { providerSpecificData: { proxyPoolId: "pool-2" } },
      status: 429,
      errorText: "Too many requests",
    });

    expect(dbMocks.getProxyPoolById).toHaveBeenCalledWith("pool-2");
    const r = await mod.flushExhaustedReports();
    expect(r.reported).toBe(0);
  });

  it("only reports for providers in FLEET_PROVIDERS", async () => {
    stubFleetEnv();
    const fleetPool = { id: "pool-3", proxyUrl: "http://fleet-proxy-3:8080", name: "fleet:5.6.7.8", isActive: true };
    dbMocks.getProxyPoolById.mockResolvedValue(fleetPool);

    const mod = await loadModule();
    await mod.maybeReportFleetExhaustion({
      provider: "xiaomi-mimo", // not in stubbed FLEET_PROVIDERS=opencode-go
      connection: { providerSpecificData: { proxyPoolId: "pool-3" } },
      status: 429,
      errorText: "Too many requests",
    });

    const r = await mod.flushExhaustedReports();
    expect(r.reported).toBe(0);
  });
});