import { NextResponse } from "next/server";
import { PROVIDERS } from "open-sse/config/providers.js";
import REGISTRY from "open-sse/providers/registry/index.js";

// GET /api/providers/list - Get all provider IDs and aliases for dropdowns
export async function GET() {
  try {
    const providers = Object.keys(PROVIDERS).map((id) => {
      const entry = REGISTRY.find((r) => r.id === id);
      return {
        id,
        alias: entry?.alias || id,
        name: entry?.display?.name || id,
      };
    });

    return NextResponse.json({ providers });
  } catch (error) {
    console.log("Error fetching providers list:", error);
    return NextResponse.json({ providers: [] });
  }
}