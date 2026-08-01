import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToPool(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    isActive: row.isActive === 1 || row.isActive === true,
    testStatus: row.testStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function poolToRow(p) {
  const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
  return {
    id,
    isActive: isActive === false ? 0 : 1,
    testStatus: testStatus ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

function upsert(db, p) {
  const r = poolToRow(p);
  db.run(
    `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       isActive=excluded.isActive, testStatus=excluded.testStatus,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.isActive, r.testStatus, r.data, r.createdAt, r.updatedAt]
  );
}

export async function getProxyPools(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (filter.isActive !== undefined) { where.push("isActive = ?"); params.push(filter.isActive ? 1 : 0); }
  if (filter.testStatus) { where.push("testStatus = ?"); params.push(filter.testStatus); }
  const sql = `SELECT * FROM proxyPools${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  const list = db.all(sql, params).map(rowToPool);
  list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  return list;
}

export async function getProxyPoolById(id) {
  const db = await getAdapter();
  return rowToPool(db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]));
}

export async function createProxyPool(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const pool = {
    id: data.id || uuidv4(),
    name: data.name,
    proxyUrl: data.proxyUrl,
    noProxy: data.noProxy || "",
    type: data.type || "http",
    isActive: data.isActive !== undefined ? data.isActive : true,
    strictProxy: data.strictProxy === true,
    testStatus: data.testStatus || "unknown",
    lastTestedAt: data.lastTestedAt || null,
    lastError: data.lastError || null,
    createdAt: now,
    updatedAt: now,
  };
  upsert(db, pool);
  return pool;
}

export async function updateProxyPool(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToPool(row), ...data, updatedAt: new Date().toISOString() };
    upsert(db, merged);
    result = merged;
  });
  return result;
}

export async function deleteProxyPool(id) {
  const db = await getAdapter();
  let removed = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    removed = rowToPool(row);
    db.run(`DELETE FROM proxyPools WHERE id = ?`, [id]);
  });
  return removed;
}

// ============================================================================
// Fleet Pool CRUD Functions
// ============================================================================

/**
 * Get fleet pool by fleetPoolId
 * @param {string} fleetPoolId - The fleet pool identifier
 * @returns {Promise<Object|null>} Fleet pool or null if not found
 */
export async function getFleetPoolByFleetId(fleetPoolId) {
  const pools = await getProxyPools();
  return pools.find(p => p.type === "fleet" && p.fleetPoolId === fleetPoolId) || null;
}

/**
 * Create a fleet pool with initial proxy URLs
 * @param {string} fleetPoolId - The fleet pool identifier
 * @param {string[]} proxyUrls - Array of proxy URLs
 * @returns {Promise<Object>} The created fleet pool
 */
export async function createFleetPool(fleetPoolId, proxyUrls) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const pool = {
    id: uuidv4(),
    type: "fleet",
    name: `fleet:${fleetPoolId}`,
    fleetPoolId: fleetPoolId,
    proxyUrls: Array.isArray(proxyUrls) ? proxyUrls : [],
    currentIndex: 0,
    exhaustedProxies: [],
    lastSyncAt: now,
    isActive: true,
    testStatus: "active",
    createdAt: now,
    updatedAt: now,
  };
  upsert(db, pool);
  return pool;
}

/**
 * Update fleet pool proxy list
 * @param {string} poolId - The pool ID
 * @param {string[]} newProxies - New proxy URLs
 * @param {boolean} append - If true, merge with existing; if false, replace
 * @returns {Promise<Object|null>} Updated pool or null if not found
 */
export async function updateFleetPoolProxies(poolId, newProxies, append = false) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [poolId]);
    if (!row) return;
    const pool = rowToPool(row);
    
    let updatedProxies;
    if (append) {
      // Merge and deduplicate
      const existing = pool.proxyUrls || [];
      const combined = [...existing, ...newProxies];
      updatedProxies = [...new Set(combined)];
    } else {
      // Replace
      updatedProxies = newProxies;
    }
    
    const merged = {
      ...pool,
      proxyUrls: updatedProxies,
      lastSyncAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    upsert(db, merged);
    result = merged;
  });
  return result;
}

/**
 * Mark a proxy as exhausted in a fleet pool
 * @param {string} poolId - The pool ID
 * @param {string} proxyUrl - The proxy URL to mark as exhausted
 * @returns {Promise<Object|null>} Updated pool or null if not found
 */
export async function markProxyExhausted(poolId, proxyUrl) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [poolId]);
    if (!row) return;
    const pool = rowToPool(row);
    
    const exhaustedProxies = pool.exhaustedProxies || [];
    // Add to exhausted list if not already present
    if (!exhaustedProxies.includes(proxyUrl)) {
      exhaustedProxies.push(proxyUrl);
    }
    
    const merged = {
      ...pool,
      exhaustedProxies,
      updatedAt: new Date().toISOString(),
    };
    upsert(db, merged);
    result = merged;
  });
  return result;
}

/**
 * Get active (non-exhausted) proxies from a fleet pool
 * @param {string} poolId - The pool ID
 * @returns {Promise<string[]>} Array of active proxy URLs
 */
export async function getActiveProxies(poolId) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [poolId]);
  if (!row) return [];
  
  const pool = rowToPool(row);
  const proxyUrls = pool.proxyUrls || [];
  const exhaustedProxies = pool.exhaustedProxies || [];
  
  return proxyUrls.filter(url => !exhaustedProxies.includes(url));
}

/**
 * Rotate to next proxy by incrementing currentIndex
 * @param {string} poolId - The pool ID
 * @returns {Promise<Object|null>} Updated pool or null if not found
 */
export async function rotateProxy(poolId) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [poolId]);
    if (!row) return;
    const pool = rowToPool(row);
    
    const merged = {
      ...pool,
      currentIndex: (pool.currentIndex || 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    upsert(db, merged);
    result = merged;
  });
  return result;
}
