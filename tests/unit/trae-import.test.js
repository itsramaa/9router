import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

function makeJwt(payload) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(payload)}.${b64({})}`;
}

describe("POST /api/oauth/trae/import", () => {
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

  it("rejects missing refreshToken with 400", async () => {
    const { POST } = await import("../../src/app/api/oauth/trae/import/route.js");
    const response = await POST(
      new Request("https://9router.local/api/oauth/trae/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBeUndefined();
    expect(body.error).toBe("Refresh token is required");
    expect(createdConnections).toHaveLength(0);
  });

  it("imports a raw refresh token as an oauth trae connection", async () => {
    const { POST } = await import("../../src/app/api/oauth/trae/import/route.js");
    const response = await POST(
      new Request("https://9router.local/api/oauth/trae/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: "raw-token-abc", loginHost: "login.trae.ai" }),
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.connection).toEqual({
      id: "conn-1",
      provider: "trae",
      email: null,
      displayName: null,
    });
    expect(createdConnections).toHaveLength(1);
    expect(createdConnections[0]).toMatchObject({
      provider: "trae",
      authType: "oauth",
      refreshToken: "raw-token-abc",
      email: null,
      providerSpecificData: {
        authMethod: "imported",
        loginHost: "login.trae.ai",
        region: "US-East",
        aiRegion: "US-East",
        tenant: "marscode",
        scope: "marscode-us",
      },
      testStatus: "active",
    });
  });

  it("derives email/displayName from a JWT refresh token", async () => {
    const { POST } = await import("../../src/app/api/oauth/trae/import/route.js");
    const refreshToken = makeJwt({
      email: "user@example.com",
      name: "Example User",
    });
    const response = await POST(
      new Request("https://9router.local/api/oauth/trae/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.connection.email).toBe("user@example.com");
    expect(body.connection.displayName).toBe("Example User");
    expect(createdConnections[0].email).toBe("user@example.com");
    expect(createdConnections[0].providerSpecificData.loginHost).toBeUndefined();
  });
});