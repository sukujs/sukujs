// A transaction that spans the whole request, shown in the database overview guide.
import { describe, expect, test } from 'bun:test';
import { ConflictException, Logger, route, SilentLogger, Suku, singleton } from '@suku/core';
import { TypeormConnection, typeormFeature, UserEntity } from '../src/typeorm.js';
import { transaction, transactional } from '../src/unit-of-work.js';

describe('request-wide transaction', () => {
  const signup = route.post('/signup', {
    middlewares: [transactional],
    handle: async ({ ctx }) => {
      const db = transaction(ctx);
      const body = await ctx.body<{ email: string; fail?: 'throw' | 'conflict' }>();
      const user = await db.save(db.create(UserEntity, { name: 'New', email: body.email }));
      await db.save(db.create(UserEntity, { name: 'Welcome note', email: `note+${body.email}` }));
      if (body.fail === 'throw') throw new Error('mailer down');
      if (body.fail === 'conflict') throw new ConflictException('nope');
      return { id: user.id };
    },
  });
  const untracked = route.get('/no-tx', { handle: ({ ctx }) => transaction(ctx) });

  const appP = (async () =>
    Suku.create({
      features: [typeormFeature()],
      routes: [signup, untracked],
      services: [singleton(Logger, SilentLogger)],
    }))();
  const post = async (body: unknown) =>
    (await appP).handle(
      new Request('http://db.test/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  const count = async () =>
    (await appP).get(TypeormConnection).dataSource.getRepository(UserEntity).count();

  test('commits both writes when the handler succeeds', async () => {
    expect((await post({ email: 'a@example.com' })).status).toBe(201);
    expect(await count()).toBe(2);
  });

  test('rolls back both writes when the handler throws, and still answers', async () => {
    const crashed = await post({ email: 'b@example.com', fail: 'throw' });
    expect(crashed.status).toBe(500);
    expect(await count()).toBe(2);
    const rejected = await post({ email: 'c@example.com', fail: 'conflict' });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ message: 'nope' });
    expect(await count()).toBe(2);
  });

  test('using the helper without the middleware is a clear error', async () => {
    const res = await (await appP).handle(new Request('http://db.test/no-tx'));
    expect(res.status).toBe(500);
  });
});
