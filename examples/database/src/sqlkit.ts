import { PGlite } from '@electric-sql/pglite';
import { type Feature, factory, Service, singleton } from '@suku/core';
import { Repository, type SqlExecutor } from 'sqlkit';
import {
  DuplicateEmail,
  type NewUser,
  POSTGRES_SCHEMA,
  type User,
  UsersRepository,
  usersFeature,
} from './shared.js';

/**
 * Owns the executor. In production this wraps a `pg` Pool:
 *
 *   const pool = new Pool({ connectionString });
 *   new SqlkitConnection(new PostgresAdapter(pool), () => pool.end());
 *
 * Here it wraps PGlite, a Postgres that runs in process, so the example needs no server.
 */
export class SqlkitConnection {
  constructor(
    readonly executor: SqlExecutor,
    private readonly close: () => Promise<void>,
  ) {}

  /** Runs `work` inside BEGIN / COMMIT, rolling back if it throws. */
  async transaction<T>(work: () => Promise<T>): Promise<T> {
    await this.executor.executeSQL('BEGIN', []);
    try {
      const result = await work();
      await this.executor.executeSQL('COMMIT', []);
      return result;
    } catch (error) {
      await this.executor.executeSQL('ROLLBACK', []);
      throw error;
    }
  }

  dispose() {
    return this.close();
  }
}

// 23505 is PostgreSQL's code for a unique constraint violation.
const isUnique = (error: unknown) => (error as { code?: string }).code === '23505';

@Service()
export class SqlkitUsers extends UsersRepository {
  private readonly repo: Repository<User>;

  constructor(private readonly connection: SqlkitConnection) {
    super();
    this.repo = new Repository<User>({ tableName: 'users', executor: connection.executor });
  }

  list(): Promise<User[]> {
    return this.repo.find({});
  }

  async create(input: NewUser): Promise<User> {
    try {
      const { rows } = await this.repo.insert(input as User);
      return rows[0]!;
    } catch (error) {
      if (isUnique(error)) throw new DuplicateEmail(input.email);
      throw error;
    }
  }

  async createMany(inputs: NewUser[]): Promise<User[]> {
    try {
      return await this.connection.transaction(
        async () => (await this.repo.insert(inputs as User[])).rows,
      );
    } catch (error) {
      if (isUnique(error)) throw new DuplicateEmail(inputs.map((i) => i.email).join(', '));
      throw error;
    }
  }
}

export const sqlkitFeature = async (): Promise<Feature> => {
  const pg = new PGlite();
  await pg.exec(POSTGRES_SCHEMA);
  const executor: SqlExecutor = {
    executeSQL: (sql, values) => pg.query(sql, values as unknown[]) as never,
  };
  return usersFeature('users-sqlkit', [
    factory(SqlkitConnection, () => new SqlkitConnection(executor, () => pg.close())),
    singleton(UsersRepository, SqlkitUsers),
  ]);
};
