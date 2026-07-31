import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";

/**
 * POST /api/oauth/trae/import
 * Import a Trae refreshToken pushed by an external orchestrator. No upstream
 * Trae API calls — validate presence/shape and save so the token-refresh
 * machinery (refreshTraeToken) can exchange it server-side later.
 *
 * Body: { refreshToken: string, loginHost?: string }
 */
export async function POST(request) {
  try {
    const { refreshToken, loginHost } = await request.json();

    if (!refreshToken || typeof refreshToken !== "string") {
      return NextResponse.json(
        { error: "Refresh token is required" },
        { status: 400 }
      );
    }

    const token = refreshToken.trim();
    if (!token) {
      return NextResponse.json(
        { error: "Refresh token is required" },
        { status: 400 }
      );
    }

    // Best-effort JWT decode for identity hints (email/displayName).
    // Never throw on decode failure — import proceeds as raw token.
    let email = null;
    let displayName = null;
    try {
      const parts = token.split(".");
      if (parts.length === 3) {
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
        const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
        email = payload.email || payload.preferred_username || null;
        displayName = payload.name || payload.displayName || null;
      }
    } catch {
      // Not a JWT or malformed — still allow import as raw token
    }

    // Field names match what refreshTraeToken consumes (refreshToken, plus the
    // providerSpecificData conventions set by trae.mapTokens in the OAuth path).
    const connection = await createProviderConnection({
      provider: "trae",
      authType: "oauth",
      refreshToken: token,
      email,
      displayName,
      providerSpecificData: {
        authMethod: "imported",
        ...(loginHost ? { loginHost } : {}),
        region: "US-East",
        aiRegion: "US-East",
        tenant: "marscode",
        userId: "",
        scope: "marscode-us",
        webId: "",
        bizUserId: "",
        userUniqueId: "",
        appLanguage: "en",
        appVersion: "1.0.0",
        userRegion: "US",
        userIdentity: "Free",
      },
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
        displayName: connection.displayName,
      },
    });
  } catch (error) {
    console.log("Trae import token error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}