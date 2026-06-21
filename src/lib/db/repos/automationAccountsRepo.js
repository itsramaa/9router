import { v4 as uuidv4 } from 'uuid';
import fs from 'node:fs';
import path from 'node:path';

import { getAdapter } from '../driver.js';

/**
 * Atomically write accounts array to bulk-accounts/accounts.json.
 * Called after any mutation so the Python server always sees the current state
 * without needing a restart. Non-fatal if the directory doesn't exist yet.
 */
function syncAccountsJson(accounts) {
  try {
    const dir = path.join(process.cwd(), 'bulk-accounts');
    const accountsPath = path.join(dir, 'accounts.json');
    const tmp = accountsPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(accounts, null, 2), 'utf-8');
    fs.renameSync(tmp, accountsPath);
  } catch {
    // Non-fatal: bulk-accounts dir may not exist in all environments
  }
}

function rowToAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    password: row.password,
    tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
    createdAt: row.createdAt,
  };
}

export async function getAutomationAccounts() {
  const db = await getAdapter();
  const rows = db.all('SELECT * FROM automationAccounts ORDER BY createdAt ASC');
  return rows.map(rowToAccount);
}

// BUG-013 fix: sync accounts.json after single create so Python server sees the new account
export async function createAutomationAccount({ email, password, tags = [] }) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const id = uuidv4();
  db.run(
    `INSERT INTO automationAccounts(id, email, password, tags, createdAt)
     VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET password=excluded.password, tags=excluded.tags`,
    [id, email.trim().toLowerCase(), password, tags.join(','), now]
  );
  const allRows = db.all('SELECT email, password FROM automationAccounts ORDER BY createdAt ASC');
  syncAccountsJson(allRows.map((r) => ({ email: r.email, password: r.password })));
  return rowToAccount(
    db.get('SELECT * FROM automationAccounts WHERE email = ?', [
      email.trim().toLowerCase(),
    ])
  );
}

export async function bulkCreateAutomationAccounts(accounts) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  let inserted = 0;
  let skipped = 0;
  db.transaction(() => {
    for (const { email, password, tags = [] } of accounts) {
      if (!email || !password) {
        skipped++;
        continue;
      }
      const id = uuidv4();
      db.run(
        `INSERT INTO automationAccounts(id, email, password, tags, createdAt)
         VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET password=excluded.password`,
        [id, email.trim().toLowerCase(), password, tags.join(','), now]
      );
      inserted++;
    }
  });

  const allRows = db.all(
    'SELECT email, password FROM automationAccounts ORDER BY createdAt ASC'
  );
  syncAccountsJson(allRows.map((r) => ({ email: r.email, password: r.password })));

  return { inserted, skipped };
}

// BUG-009 fix: sync accounts.json after single delete so Python server stops using deleted account
export async function deleteAutomationAccount(id) {
  const db = await getAdapter();
  db.run('DELETE FROM automationAccounts WHERE id = ?', [id]);
  const allRows = db.all('SELECT email, password FROM automationAccounts ORDER BY createdAt ASC');
  syncAccountsJson(allRows.map((r) => ({ email: r.email, password: r.password })));
}

export async function deleteAllAutomationAccounts() {
  const db = await getAdapter();
  const accounts = db.all(
    'SELECT email, password, tags, createdAt FROM automationAccounts ORDER BY createdAt ASC'
  );
  let backupPath = null;

  if (accounts.length > 0) {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .replace('Z', '');
    const backupDir = path.join(process.cwd(), 'bulk-accounts', 'backups');
    backupPath = path.join(backupDir, `accounts-backup-${timestamp}.json`);

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    fs.writeFileSync(backupPath, JSON.stringify(accounts, null, 2), 'utf-8');
  }

  db.run('DELETE FROM automationAccounts');
  syncAccountsJson([]);
  return { deleted: accounts.length, backupPath };
}

/** Returns accounts as plain {email, password} array for syncing to Python server */
export async function getAutomationAccountsForSync() {
  const db = await getAdapter();
  const rows = db.all(
    'SELECT email, password FROM automationAccounts ORDER BY createdAt ASC'
  );
  return rows.map((r) => ({ email: r.email, password: r.password }));
}
