import { describe, expect, test } from 'bun:test';
import {
  CaptiveDependencyError,
  Inject,
  InjectionToken,
  MissingServiceError,
  Service,
  ServiceCollection,
  type ServiceOf,
  scoped,
  service,
  value,
} from '../src/index.js';

const CONFIG = new InjectionToken<{ prefix: string }>('CONFIG');

class Database {
  rows = new Map<number, string>([[1, 'Ada']]);
}

const Clock = service('clock', () => ({ now: () => 1000 }));

const Users = service('users', {
  services: { db: Database, clock: Clock, config: CONFIG },
  create: ({ db, clock, config }) => ({
    find: (id: number) => `${config.prefix}${db.rows.get(id)}@${clock.now()}`,
  }),
});

describe('service() without a class', () => {
  test('is its own token, resolves declared dependencies by name, and is typed', () => {
    const sp = new ServiceCollection()
      .addSingleton(Database)
      .addRange([Clock, Users, value(CONFIG, { prefix: '#' })])
      .build({ validateOnBuild: true });
    const users: ServiceOf<typeof Users> = sp.get(Users);
    expect(users.find(1)).toBe('#Ada@1000');
    expect(sp.get(Users)).toBe(users);
    // @ts-expect-error `nope` does not exist on the inferred service type
    users.nope;
  });

  test('lifetimes: declared on the definition, or overridden when registering', async () => {
    let n = 0;
    const disposed: number[] = [];
    const Unit = service('unit', {
      lifetime: 'scoped',
      create: () => {
        const id = ++n;
        return { id, dispose: () => void disposed.push(id) };
      },
    });
    const sp = new ServiceCollection().add(Unit).build();
    const a = sp.createScope();
    const b = sp.createScope();
    expect(a.get(Unit)).toBe(a.get(Unit));
    expect(a.get(Unit).id).not.toBe(b.get(Unit).id);
    await a.dispose();
    expect(disposed).toEqual([1]);

    const perScope = new ServiceCollection().add(scoped(Clock)).build();
    expect(perScope.createScope().get(Clock)).not.toBe(perScope.createScope().get(Clock));
  });

  test('declared dependencies are validated at build: missing and captive', () => {
    expect(() => new ServiceCollection().add(Users).build({ validateOnBuild: true })).toThrow(
      MissingServiceError,
    );
    const Scoped = service('scoped', { lifetime: 'scoped', create: () => ({}) });
    const Captor = service('captor', { services: { s: Scoped }, create: ({ s }) => ({ s }) });
    expect(() =>
      new ServiceCollection().addRange([Scoped, Captor]).build({ validateOnBuild: true }),
    ).toThrow(CaptiveDependencyError);
  });

  test('mixes with classes in both directions', () => {
    @Service()
    class Report {
      constructor(@Inject(Users) readonly users: ServiceOf<typeof Users>) {}
    }
    const Summary = service('summary', {
      services: { report: Report },
      create: ({ report }) => report.users.find(1),
    });
    const sp = new ServiceCollection()
      .addSingleton(Database)
      .addSingleton(Report)
      .addRange([Clock, Users, Summary, value(CONFIG, { prefix: '' })])
      .build({ validateOnBuild: true });
    expect(sp.get(Summary)).toBe('Ada@1000');
  });

  test('a class without constructor parameters needs no decorator', () => {
    class Plain {
      hello = 'hi';
    }
    expect(
      new ServiceCollection().addSingleton(Plain).build({ validateOnBuild: true }).get(Plain).hello,
    ).toBe('hi');
  });
});
