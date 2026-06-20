import { runSetup, getSetupState } from "@/lib/automation/processManager";

export const dynamic = "force-dynamic";

export async function POST(request) {
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { action, pythonPath, scriptsDir } = body;

  if (!action) return Response.json({ error: "action required" }, { status: 400 });

  try {
    const result = await runSetup(action, { pythonPath, scriptsDir });
    return Response.json({ ok: true, setup: result ?? getSetupState() });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}

export async function GET() {
  return Response.json({ setup: getSetupState() });
}
