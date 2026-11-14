// The production guidelines from the Database page, runnable: a readiness check that
// reports 503 when the database is unreachable, and keyset pagination with a validated query.
import { Database as Sqlite } from 'bun:sqlite';
import { feature, route, ServiceUnavailableException, service } from '@sukujs/core';
import { gt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { z } from 'zod';
import { users } from './drizzle.js';
import { SQLITE_SCHEMA } from './shared.js';

export const Db = service('guidelines-db', () => {
  const sqlite = new Sqlite(':memory:');
  sqlite.run(SQLITE_SCHEMA);
  return {
    sqlite,
    orm: drizzle(sqlite, { schema: { users } }),
    /** A cheap round trip. Never throws: a health check must answer either way. */
    ping() {
      try {
        sqlite.query('select 1').get();
        return true;
      } catch {
        return false;
      }
    },
    dispose: () => sqlite.close(),
  };
});

/** Liveness: the process is up. It must not touch the database. */
export const health = route.get('/health', { handle: () => ({ status: 'ok' }) });

/** Readiness: this instance can serve traffic. 503 takes it out of rotation. */
export const ready = route.get('/ready', {
  services: { db: Db },
  handle: ({ db }) => {
    if (!db.ping()) throw new ServiceUnavailableException('Database is not reachable');
    return { status: 'ready' };
  },
});

const Page = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Keyset pagination: "rows after this id", which stays fast on any page. */
export const listUsers = route.get('/users', {
  query: Page,
  services: { db: Db },
  handle: ({ query, db }) => {
    const rows = db.orm
      .select()
      .from(users)
      .where(gt(users.id, query.after))
      .orderBy(users.id)
      .limit(query.limit + 1)
      .all();
    const items = rows.slice(0, query.limit);
    return { items, next: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null };
  },
});

export const guidelinesFeature = feature('guidelines', {
  routes: [health, ready, listUsers],
  services: [Db],
});
