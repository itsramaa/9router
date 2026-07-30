import { NextResponse } from 'next/server';

import {
  getProviderConnections,
  updateProviderConnection,
} from '@/lib/localDb';

import {
  MODEL_LOCK_PREFIX,
  getLockKey,
} from 'open-sse/services/modelLockStore.js';

import { BAN_PATTERNS } from 'open-sse/services/cooldownPolicy.js';

function getActiveModelLocks(connection) {
  const now = Date.now();

  return Object.entries(connection)

    .filter(([key, value]) => key.startsWith(MODEL_LOCK_PREFIX) && value)

    .map(([key, value]) => ({
      key,

      model: key.slice(MODEL_LOCK_PREFIX.length) || '__all',

      until: value,

      active: new Date(value).getTime() > now,
    }))

    .filter((lock) => lock.active);
}

function isBanned(connection) {
  if (!connection.lastError) return false;

  const lower = connection.lastError.toLowerCase();

  return BAN_PATTERNS.some((p) => lower.includes(p));
}

export async function GET() {
  try {
    const now = Date.now();

    const [activeConns, inactiveConns] = await Promise.all([
      getProviderConnections(),

      getProviderConnections({ isActive: false }),
    ]);

    const models = [];

    // Active connections: per-model locks + account-unavailable

    for (const connection of activeConns) {
      const locks = getActiveModelLocks(connection);

      for (const lock of locks) {
        models.push({
          provider: connection.provider,

          model: lock.model,

          status: 'cooldown',

          until: lock.until,

          connectionId: connection.id,

          connectionName: connection.name || connection.email || connection.id,

          lastError: connection.lastError || null,

          reason: connection.lastError || null,
        });
      }

      if (locks.length === 0 && connection.testStatus === 'unavailable') {
        models.push({
          provider: connection.provider,

          model: '__all',

          status: 'unavailable',

          connectionId: connection.id,

          connectionName: connection.name || connection.email || connection.id,

          lastError: connection.lastError || null,

          reason: connection.lastError || null,
        });
      }
    }

    // Inactive connections: paused (auto, has pausedUntil) vs disabled (manual/banned)

    for (const connection of inactiveConns) {
      const pausedUntil = connection.pausedUntil;

      if (pausedUntil && new Date(pausedUntil).getTime() > now) {
        models.push({
          provider: connection.provider,

          model: '__all',

          status: 'paused',

          until: pausedUntil,

          connectionId: connection.id,

          connectionName: connection.name || connection.email || connection.id,

          lastError: connection.lastError || null,

          reason: connection.lastError || 'quota exhausted',
        });
      } else {
        // BUG-18 fix: expose disabled/banned connections so UI and ModelAvailabilityBadge

        // are aware of them — previously these were silently omitted

        const banned = isBanned(connection);

        models.push({
          provider: connection.provider,

          model: '__all',

          status: banned ? 'banned' : 'disabled',

          connectionId: connection.id,

          connectionName: connection.name || connection.email || connection.id,

          lastError: connection.lastError || null,

          reason: connection.lastError || null,
        });
      }
    }

    return NextResponse.json({
      models,

      unavailableCount: models.length,
    });
  } catch (error) {
    console.error('[API] Failed to get model availability:', error);

    return NextResponse.json(
      { error: 'Failed to fetch model availability' },

      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const { action, provider, model } = await request.json();

    if (action !== 'clearCooldown' || !provider || !model) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const connections = await getProviderConnections({ provider });

    const lockKey = getLockKey(model);

    await Promise.all(
      connections

        .filter((connection) => connection[lockKey])

        .map((connection) =>
          updateProviderConnection(connection.id, {
            [lockKey]: null,

            // BUG-15 fix: always reset testStatus AND backoffLevel when clearing

            // a cooldown manually, regardless of current testStatus value

            ...(connection.testStatus === 'unavailable' ||
            connection.backoffLevel > 0
              ? {
                  testStatus: 'active',

                  lastError: null,

                  lastErrorAt: null,

                  backoffLevel: 0,
                }
              : {}),
          })
        )
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[API] Failed to clear model cooldown:', error);

    return NextResponse.json(
      { error: 'Failed to clear cooldown' },

      { status: 500 }
    );
  }
}
