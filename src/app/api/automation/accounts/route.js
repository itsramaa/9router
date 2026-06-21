import {
  getAutomationAccounts,
  createAutomationAccount,
  bulkCreateAutomationAccounts,
  deleteAutomationAccount,
  deleteAllAutomationAccounts,
} from "@/lib/db/repos/automationAccountsRepo";

export const dynamic = "force-dynamic";

export async function GET() {
  const accounts = await getAutomationAccounts();
  // Never expose passwords to the client
  return Response.json({
    accounts: accounts.map(({ id, email, tags, createdAt }) => ({ id, email, tags, createdAt })),
  });
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Bulk import
  if (Array.isArray(body.accounts)) {
    const result = await bulkCreateAutomationAccounts(body.accounts);
    return Response.json(result, { status: 201 });
  }

  // Single create
  const { email, password, tags } = body;
  if (!email || !password) {
    return Response.json({ error: "email and password are required" }, { status: 400 });
  }
  const account = await createAutomationAccount({ email, password, tags });
  return Response.json({ account: { id: account.id, email: account.email, tags: account.tags, createdAt: account.createdAt } }, { status: 201 });
}

export async function DELETE(request) {
  let body;
  try { body = await request.json(); } catch { body = {}; }

  if (body.all) {
    const result = await deleteAllAutomationAccounts();
    return Response.json({ ok: true, deleted: result.deleted, backupPath: result.backupPath });
  }

  if (body.id) {
    await deleteAutomationAccount(body.id);
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Provide id or all:true" }, { status: 400 });
}