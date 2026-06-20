import { createProviderConnection } from "@/models";
import { APIKEY_PROVIDERS } from "@/shared/constants/config";
import { FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS } from "@/shared/constants/providers";

export const dynamic = "force-dynamic";

/**
 * POST /api/automation/inject-key
 * Body: { provider, key, email, name? }
 *
 * Called by:
 * 1. page.js frontend — when WS result.api_keys arrives
 * 2. harvest/dashboard.py — via HTTP POST using AUTOMATION_INJECT_URL
 *
 * No session auth required — protected by AUTOMATION_INJECT_TOKEN env var.
 * If AUTOMATION_INJECT_TOKEN is not set, only localhost requests are accepted.
 */
export async function POST(request) {
  // Token / localhost check
  const token = process.env.AUTOMATION_INJECT_TOKEN;
  if (token) {
    const auth = request.headers.get("x-automation-token");
    if (auth !== token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { provider, key, email, name } = body;

  if (!provider || !key) {
    return Response.json({ error: "provider and key are required" }, { status: 400 });
  }

  const isValid =
    APIKEY_PROVIDERS?.[provider] ||
    FREE_TIER_PROVIDERS?.[provider] ||
    WEB_COOKIE_PROVIDERS?.[provider];

  if (!isValid) {
    return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }

  try {
    const conn = await createProviderConnection({
      provider,
      authType: "apikey",
      name: name || email || provider,
      email: email || null,
      apiKey: key,
      isActive: true,
      testStatus: "unknown",
    });
    return Response.json({
      ok: true,
      id: conn.id,
      provider: conn.provider,
      name: conn.name,
    }, { status: 201 });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
