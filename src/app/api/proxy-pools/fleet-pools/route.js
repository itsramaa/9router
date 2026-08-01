import { NextResponse } from "next/server";

// GET /api/proxy-pools/fleet-pools - Get available pools from fleet base URL
// Uses adminKey parameter for authentication (separate from API key used for fleet operations)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const baseUrl = searchParams.get("baseUrl");
    const adminKey = searchParams.get("apiKey"); // renamed to adminKey in UI, but kept as apiKey param for backward compat

    if (!baseUrl) {
      return NextResponse.json({ pools: [], error: "No baseUrl provided" });
    }

    const fleetBaseUrl = baseUrl.replace(/\/+$/, "");
    const fleetUrl = `${fleetBaseUrl}/api/v1/pools`;
    
    const headers = {
      "Content-Type": "application/json",
      "X-API-Key": adminKey || "",
      "User-Agent": "9Router/proxy-fleet-pools-fetch",
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(fleetUrl, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        console.log(`Fleet pools fetch failed: ${res.status} - ${errorText}`);
        return NextResponse.json({ 
          pools: [], 
          error: `Fleet API returned ${res.status}`,
          details: errorText 
        });
      }

      const data = await res.json();
      
      // Proxy-fleet returns array of Pool objects: [{id, name, ...}, ...]
      let pools = [];
      if (Array.isArray(data)) {
        pools = data.map(pool => ({
          id: pool.id,
          name: pool.name || pool.id,
        }));
      } else if (data.pools && Array.isArray(data.pools)) {
        pools = data.pools.map(pool => ({
          id: pool.id,
          name: pool.name || pool.id,
        }));
      }

      return NextResponse.json({ pools });
    } catch (error) {
      console.log("Error fetching fleet pools:", error.message);
      return NextResponse.json({ pools: [], error: error.message });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    console.log("Error fetching fleet pools:", error);
    return NextResponse.json({ pools: [], error: error.message });
  }
}