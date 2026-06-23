import { NextResponse } from "next/server";
import { testSingleConnection } from "./testUtils.js";

// POST /api/providers/[id]/test - Test connection
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const result = await testSingleConnection(id);

    if (result.error === "Connection not found") {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    // BUG-T03A fix: forward enriched fields (skipped, diagnosis, activeLocks, quotaStatus, pausedUntil)
    return NextResponse.json({
      valid: result.valid,
      error: result.error,
      refreshed: result.refreshed || false,
      skipped: result.skipped || false,
      reason: result.reason || null,
      isPaused: result.isPaused || false,
      pausedUntil: result.pausedUntil || null,
      quotaStatus: result.quotaStatus || null,
      activeLocks: result.activeLocks || [],
      diagnosis: result.diagnosis || null,
      latencyMs: result.latencyMs || 0,
    });
  } catch (error) {
    console.log("Error testing connection:", error);
    return NextResponse.json({ error: "Test failed" }, { status: 500 });
  }
}
