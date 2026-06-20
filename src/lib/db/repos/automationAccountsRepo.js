import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    password: row.password,
    tags: row.tags ? row.tags.split(",").filter(Boolean) : [],
    createdAt: row.createdAt,
  };
}

export async function getAutomationAccounts() {
  const db = await getAdapter();
  const rows = db.all("SELECT * FROM automationAccounts ORDER BY createdAt ASC");
  return rows.map(rowToAccount);
}

export async function createAutomationAccount({ email, password, tags = [] }) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const id = uuidv4();
  db.run(
    `INSERT INTO automationAccounts(id, email, password, tags, createdAt)
     VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET password=excluded.password, tags=excluded.tags`,
    [id, email.trim().toLowerCase(), password, tags.join(","), now]
  );
  return rowToAccount(db.get("SELECT * FROM automationAccounts WHERE email = ?", [email.trim().toLowerCase()]));
}

export async function bulkCreateAutomationAccounts(accounts) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  let inserted = 0;
  let skipped = 0;
  db.transaction(() => {
    for (const { email, password, tags = [] } of accounts) {
      if (!email || !password) { skipped++; continue; }
      const id = uuidv4();
      db.run(
        `INSERT INTO automationAccounts(id, email, password, tags, createdAt)
         VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET password=excluded.password`,
        [id, email.trim().toLowerCase(), password, tags.join(","), now]
      );
      inserted++;
    }
  });
  return { inserted, skipped };
}

export async function deleteAutomationAccount(id) {
  const db = await getAdapter();
  db.run("DELETE FROM automationAccounts WHERE id = ?", [id]);
}

export async function deleteAllAutomationAccounts() {
  const db = await getAdapter();
  db.run("DELETE FROM automationAccounts");
}

/** Returns accounts as plain {email, password} array for syncing to Python server */
export async function getAutomationAccountsForSync() {
  const db = await getAdapter();
  const rows = db.all("SELECT email, password FROM automationAccounts ORDER BY createdAt ASC");
  return rows.map((r) => ({ email: r.email, password: r.password }));
}
