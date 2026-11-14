// The same HTTP behaviour, verified against every database library in the guides.
import { describe, expect, test } from 'bun:test';
import { type Feature, Logger, SilentLogger, Suku, singleton } from '@suku/core';
import { drizzleFeature } from '../src/drizzle.js';
import { kyselyFeature } from '../src/kysely.js';
import { PrismaConnection, prismaFeature } from '../src/prisma.js';
import { sequelizeFeature } from '../src/sequelize.js';
import { UsersRepository } from '../src/shared.js';
import { sqlkitFeature } from '../src/sqlkit.js';
import { typeormFeature } from '../src/typeorm.js';

const implementations: [string, () => Feature | Promise<Feature>][] = [
  ['Drizzle', drizzleFeature],
  ['TypeORM', typeormFeature],
  ['Prisma', prismaFeature],
  ['Sequelize', sequelizeFeature],
  ['sqlkit', sqlkitFeature],
  ['Kysely', kyselyFeature],
];

const json = (path: string, body: unknown) =>
  new Request(`http://db.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

for (const [name, makeFeature] of implementations) {
  describe(name, () => {
    const appP = (async () =>
      Suku.create({ features: [makeFeature()], services: [singleton(Logger, SilentLogger)] }))();

    test('create and list through the same routes', async () => {
      const app = await appP;
      const created = await app.handle(json('/users', { name: 'Ada', email: 'ada@example.com' }));
      expect(created.status).toBe(201);
      expect(await created.json()).toEqual({ id: 1, name: 'Ada', email: 'ada@example.com' });
      await app.handle(json('/users', { name: 'Grace', email: 'grace@example.com' }));
      const list = (await (await app.handle(new Request('http://db.test/users'))).json()) as {
        name: string;
      }[];
      expect(list.map((u) => u.name)).toEqual(['Ada', 'Grace']);
    });

    test('a unique violation becomes a domain error, then a 409', async () => {
      const app = await appP;
      const res = await app.handle(json('/users', { name: 'Imposter', email: 'ada@example.com' }));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        code: 'email_taken',
        message: 'Email ada@example.com is already registered',
      });
    });

    test('invalid input never reaches the database', async () => {
      const app = await appP;
      expect((await app.handle(json('/users', { name: '', email: 'nope' }))).status).toBe(400);
    });

    test('a failing transaction rolls back completely', async () => {
      const app = await appP;
      const before = await app.get(UsersRepository).list();
      const res = await app.handle(
        json('/users/batch', [
          { name: 'Linus', email: 'linus@example.com' },
          { name: 'Duplicate', email: 'grace@example.com' },
        ]),
      );
      expect(res.status).toBe(409);
      expect(await app.get(UsersRepository).list()).toHaveLength(before.length);
    });

    test('a successful transaction commits', async () => {
      const app = await appP;
      const res = await app.handle(
        json('/users/batch', [
          { name: 'Linus', email: 'linus@example.com' },
          { name: 'Margaret', email: 'margaret@example.com' },
        ]),
      );
      expect(res.status).toBe(201);
      expect((await app.get(UsersRepository).list()).map((u) => u.name)).toEqual([
        'Ada',
        'Grace',
        'Linus',
        'Margaret',
      ]);
    });

    test('closing the app closes the connection', async () => {
      const app = await appP;
      const repository = app.get(UsersRepository);
      if (name === 'Prisma') {
        // Prisma reconnects on demand after $disconnect, so check the disposal itself.
        const connection = app.get(PrismaConnection);
        await app.close();
        expect(connection.disposed).toBe(true);
        return;
      }
      await app.close();
      // The container disposed the connection service, so the library can no longer query.
      await expect(repository.list()).rejects.toThrow();
    });
  });
}

describe('reflect-metadata alongside Suku', () => {
  test('classes decorated before and after reflect-metadata loads both resolve', async () => {
    const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/fixtures/metadata-order.ts`], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(err).toBe('');
    expect(JSON.parse(out)).toEqual({ before: true, after: true });
  });
});
