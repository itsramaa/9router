import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("POST /api/oauth/grok-web/import", () => {
  let createdConnections;

  beforeEach(() => {
    createdConnections = [];
    vi.doMock("next/server", () => ({
      NextResponse: {
        json(body, init = {}) {
          return new Response(JSON.stringify(body), {
            status: init.status || 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    }));
    vi.doMock("@/models", () => ({
      createProviderConnection: vi.fn(async (data) => {
        const connection = { id: "conn-1", ...data };
        createdConnections.push(connection);
        return connection;
      }),
    }));
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("rejects missing sso with 400", async () => {
    const { POST } = await import("../../src/app/api/oauth/grok-web/import/route.js");
    const response = await POST(
      new Request("https://9router.local/api/oauth/grok-web/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBeUndefined();
    expect(body.error).toBe("SSO token is required");
    expect(createdConnections).toHaveLength(0);
  });

  it("imports a raw sso token as a cookie grok-web connection", async () => {
    const { POST } = await import("../../src/app/api/oauth/grok-web/import/route.js");
    const response = await POST(
      new Request("https://9router.local/api/oauth/grok-web/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sso: "abc123token" }),
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.connection).toEqual({
      id: "conn-1",
      provider: "grok-web",
      email: undefined,
      displayName: undefined,
    });
    expect(createdConnections).toHaveLength(1);
    expect(createdConnections[0]).toMatchObject({
      provider: "grok-web",
      authType: "cookie",
      apiKey: "abc123token",
      name: "grok-web 123token",
      providerSpecificData: { authMethod: "imported" },
      testStatus: "active",
      isActive: true,
    });
  });

  it("strips a leading sso= prefix from the token", async () => {
    const { POST } = await import("../../src/app/api/oauth/grok-web/import/route.js");
    const response = await POST(
      new Request("https://9router.local/api/oauth/grok-web/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sso: "sso=prefixedtoken" }),
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(createdConnections[0].apiKey).toBe("prefixedtoken");
    expect(createdConnections[0].providerSpecificData.authMethod).toBe("imported");
  });

  it("stores ssoRw in providerSpecificData when provided", async () => {
    const { POST } = await import("../../src/app/api/oauth/grok-web/import/route.js");
    const response = await POST(
      new Request("https://9router.local/api/oauth/grok-web/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sso: "abc123token", ssoRw: "sso_rw=rwtoken" }),
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(createdConnections[0].providerSpecificData).toEqual({
      authMethod: "imported",
      ssoRw: "rwtoken",
    });
  });
});