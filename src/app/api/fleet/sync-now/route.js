import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Manual trigger for the proxy-fleet sync loop. Runs the same batch sync that
// the scheduler performs on its own interval.
export async function POST() {
  try {
    const { syncFleetProxies } = await import("@/shared/services/proxyFleetSync");
    const result = await syncFleetProxies();
    return NextResponse.json({
      ok: result.ok,
      message: result.ok
        ? `All pools synced, ${result.assignments} proxies assigned`
        : `Sync finished with ${result.failed} failed pool(s)`,
      ...result,
    });
  } catch (error) {
    console.log("Error in fleet sync:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}