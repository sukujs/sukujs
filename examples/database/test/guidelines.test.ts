// The readiness check and pagination shown on the Database page.
import { expect, test } from 'bun:test';
import { Logger, SilentLogger, Suku, singleton } from '@sukujs/core';
import { users } from '../src/drizzle.js';
import { Db, guidelinesFeature } from '../src/guidelines.js';

const create = () =>
  Suku.create({ features: [guidelinesFeature], services: [singleton(Logger, SilentLogger)] });
const get = (app: Awaited<ReturnType<typeof create>>, path: string) =>
  app.handle(new Request(`http://db.test${path}`));

test('readiness is 200 while the database answers and 503 once it does not', async () => {
  const app = await create();
  expect((await get(app, '/ready')).status).toBe(200);

  app.provider.get(Db).sqlite.close();
  const down = await get(app, '/ready');
  expect(down.status).toBe(503);
  expect((await down.json()).message).toBe('Database is not reachable');
  // Liveness does not depend on the database.
  expect((await get(app, '/health')).status).toBe(200);
});

test('keyset pagination walks every row once and validates its query', async () => {
  const app = await create();
  const { orm } = app.provider.get(Db);
  for (let i = 1; i <= 5; i++) {
    orm
      .insert(users)
      .values({ name: `User ${i}`, email: `u${i}@example.com` })
      .run();
  }

  const first = (await (await get(app, '/users?limit=2')).json()) as {
    items: { id: number }[];
    next: number | null;
  };
  expect(first.items.map((u) => u.id)).toEqual([1, 2]);
  expect(first.next).toBe(2);

  const second = await (await get(app, `/users?limit=2&after=${first.next}`)).json();
  expect(second.items.map((u: { id: number }) => u.id)).toEqual([3, 4]);
  const last = await (await get(app, '/users?limit=2&after=4')).json();
  expect(last).toEqual({ items: [{ id: 5, name: 'User 5', email: 'u5@example.com' }], next: null });

  expect((await get(app, '/users?limit=1000')).status).toBe(400);
  await app.close();
});
