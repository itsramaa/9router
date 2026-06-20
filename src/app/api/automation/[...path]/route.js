/**
 * HTTP proxy to bulk-accounts Python server.
 * All requests to /api/automation/* are forwarded to AUTOMATION_SERVER_URL.
 * Default: http://localhost:8765
 */

const AUTOMATION_SERVER_URL =
  process.env.AUTOMATION_SERVER_URL || "http://localhost:8765";

async function proxyRequest(request, { params }) {
  const pathSegments = (await params).path ?? [];
  const upstreamPath = "/" + pathSegments.join("/");
  const search = new URL(request.url).search;
  const upstreamUrl = `${AUTOMATION_SERVER_URL}${upstreamPath}${search}`;

  const headers = new Headers();
  for (const [k, v] of request.headers.entries()) {
    if (["host", "connection"].includes(k.toLowerCase())) continue;
    headers.set(k, v);
  }

  let body = undefined;
  if (!["GET", "HEAD"].includes(request.method)) {
    body = await request.arrayBuffer();
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: body ?? undefined,
      duplex: "half",
    });

    const resHeaders = new Headers();
    for (const [k, v] of upstream.headers.entries()) {
      if (["transfer-encoding"].includes(k.toLowerCase())) continue;
      resHeaders.set(k, v);
    }
    resHeaders.set("Access-Control-Allow-Origin", "*");

    return new Response(upstream.body, {
      status: upstream.status,
      headers: resHeaders,
    });
  } catch {
    return new Response(
      JSON.stringify({ error: "Automation server unreachable", url: upstreamUrl }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const DELETE = proxyRequest;
export const PATCH = proxyRequest;

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,PATCH,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
