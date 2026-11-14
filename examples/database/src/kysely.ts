import { PGlite } from '@electric-sql/pglite';
import { type Feature, factory, Service, singleton } from '@suku/core';
import { type Generated, Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import {
  DuplicateEmail,
  type NewUser,
  POSTGRES_SCHEMA,
  type User,
  UsersRepository,
  usersFeature,
} from './shared.js';

interface Schema {
  users: { id: Generated<number>; name: string; email: string };
}

/** Owns the Kysely instance. In production, use `PostgresDialect` with a `pg` Pool. */
export class KyselyConnection {
  constructor(readonly db: Kysely<Schema>) {}

  dispose() {
    return this.db.destroy();
  }
}

const isUnique = (error: unknown) => (error as { code?: string }).code === '23505';

@Service()
export class KyselyUsers extends UsersRepository {
  constructor(private readonly connection: KyselyConnection) {
    super();
  }

  list(): Promise<User[]> {
    return this.connection.db.selectFrom('users').selectAll().orderBy('id').execute();
  }

  async create(input: NewUser): Promise<User> {
    try {
      return await this.connection.db
        .insertInto('users')
        .values(input)
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (error) {
      if (isUnique(error)) throw new DuplicateEmail(input.email);
      throw error;
    }
  }

  async createMany(inputs: NewUser[]): Promise<User[]> {
    try {
      return await this.connection.db
        .transaction()
        .execute((trx) => trx.insertInto('users').values(inputs).returningAll().execute());
    } catch (error) {
      if (isUnique(error)) throw new DuplicateEmail(inputs.map((i) => i.email).join(', '));
      throw error;
    }
  }
}

export const kyselyFeature = async (): Promise<Feature> => {
  const pg = new PGlite();
  await pg.exec(POSTGRES_SCHEMA);
  const db = new Kysely<Schema>({ dialect: new PGliteDialect(pg) });
  return usersFeature('users-kysely', [
    factory(KyselyConnection, () => new KyselyConnection(db)),
    singleton(UsersRepository, KyselyUsers),
  ]);
};
