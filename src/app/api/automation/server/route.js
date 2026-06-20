import { getStatus, startServer, stopServer, resolveScriptsDir, resolveDefaultPort, hasVenv } from "@/lib/automation/processManager";
import os from "os";

export async function GET() {
  const status = getStatus();
  const dir = resolveScriptsDir("");
  return Response.json({
    ...status,
    envScriptsDir: dir,
    envPort: resolveDefaultPort(),
    platform: os.platform(),
    hasVenv: hasVenv(dir),
  });
}

export async function POST(request) {
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { action, pythonPath, scriptsDir, port } = body;

  if (action === "start") {
    try {
      const result = await startServer({
        pythonPath: pythonPath?.trim() || undefined,
        scriptsDir: scriptsDir?.trim() || undefined,
        port: Number(port) || undefined,
      });
      return Response.json({ ok: true, ...result });
    } catch (e) {
      return Response.json({ ok: false, error: e.message }, { status: 400 });
    }
  }

  if (action === "stop") {
    const stopped = stopServer();
    return Response.json({ ok: stopped });
  }

  return Response.json({ error: "Unknown action. Use start or stop." }, { status: 400 });
}
