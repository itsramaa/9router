import os from "os";
import { getStatus, startServer, stopServer } from "@/lib/automation/processManager";

export async function GET() {
  return Response.json(getStatus());
}

export async function POST(request) {
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { action, pythonPath, scriptsDir, port } = body;

  if (action === "start") {
    try {
      const defaultPython = os.platform() === "win32" ? "python" : "python3";
      const result = startServer({
        pythonPath: pythonPath?.trim() || defaultPython,
        scriptsDir: scriptsDir?.trim() || "",
        port: Number(port) || 8765,
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
