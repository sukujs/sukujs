import { Database as Sqlite } from 'bun:sqlite';
import { type Feature, type ServiceOf, service, singleton } from '@sukujs/core';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import {
  DuplicateEmail,
  type NewUser,
  SQLITE_SCHEMA,
  type User,
  UsersRepository,
  usersFeature,
} from './shared.js';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
});

/** Owns the connection: created once, closed when the app closes. */
export const Db = service('db', () => {
  const sqlite = new Sqlite(':memory:');
  sqlite.run(SQLITE_SCHEMA);
  return {
    orm: drizzle(sqlite, { schema: { users } }),
    closed: false,
    dispose() {
      sqlite.close();
      this.closed = true;
    },
  };
});

const isUnique = (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } };
  return (e.code ?? e.cause?.code)?.startsWith('SQLITE_CONSTRAINT') ?? false;
};

export class DrizzleUsers extends UsersRepository {
  static inject = [Db];
  constructor(private readonly db: ServiceOf<typeof Db>) {
    super();
  }

  async list(): Promise<User[]> {
    return this.db.orm.select().from(users);
  }

  async create(input: NewUser): Promise<User> {
    try {
      const [row] = await this.db.orm.insert(users).values(input).returning();
      return row!;
    } catch (error) {
      if (isUnique(error)) throw new DuplicateEmail(input.email);
      throw error;
    }
  }

  async createMany(inputs: NewUser[]): Promise<User[]> {
    try {
      // bun:sqlite transactions are synchronous, so the callback is too.
      return this.db.orm.transaction((tx) =>
        inputs.map((input) => tx.insert(users).values(input).returning().get()),
      );
    } catch (error) {
      if (isUnique(error)) throw new DuplicateEmail(inputs.map((i) => i.email).join(', '));
      throw error;
    }
  }
}

export const drizzleFeature = (): Feature =>
  usersFeature('users-drizzle', [Db, singleton(UsersRepository, DrizzleUsers)]);
