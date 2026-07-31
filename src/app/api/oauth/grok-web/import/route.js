import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";

/**
 * POST /api/oauth/grok-web/import
 * Import a grok.com sso cookie token pushed by an external orchestrator (AAR).
 * No upstream Grok API calls — validate presence/shape and save so the
 * GrokWebExecutor can use it directly (it consumes credentials.apiKey and
 * sends `Cookie: sso=<token>`).
 *
 * Body: { sso: string, ssoRw?: string, name?: string }
 */
export async function POST(request) {
  try {
    const { sso, ssoRw, name } = await request.json();

    if (!sso || typeof sso !== "string") {
      return NextResponse.json(
        { error: "SSO token is required" },
        { status: 400 }
      );
    }

    // Strip "sso=" prefix if the caller pasted the raw cookie value
    let token = sso.trim();
    if (token.startsWith("sso=")) token = token.slice(4);
    if (!token) {
      return NextResponse.json(
        { error: "SSO token is required" },
        { status: 400 }
      );
    }

    // sso_rw is optional — store it for reference, but the executor only
    // consumes apiKey (the sso token).
    let ssoRwToken;
    if (ssoRw !== undefined && ssoRw !== null && ssoRw !== "") {
      if (typeof ssoRw !== "string") {
        return NextResponse.json(
          { error: "ssoRw must be a string" },
          { status: 400 }
        );
      }
      ssoRwToken = ssoRw.trim();
      if (ssoRwToken.startsWith("sso_rw=")) ssoRwToken = ssoRwToken.slice(7);
    }

    // No email available from an sso token — use the short token suffix so
    // multiple accounts stay distinguishable, or an explicit name if provided.
    const suffix = token.slice(-8);
    const connection = await createProviderConnection({
      provider: "grok-web",
      authType: "cookie",
      apiKey: token,
      name: name || `grok-web ${suffix}`,
      providerSpecificData: {
        authMethod: "imported",
        ...(ssoRwToken ? { ssoRw: ssoRwToken } : {}),
      },
      expiresAt: null, // session cookie — no known expiry
      testStatus: "active",
      isActive: true,
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
    console.log("Grok web import error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}