import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { type Feature, factory, Service, singleton } from '@sukujs/core';
import { Prisma, PrismaClient } from './generated/prisma/client.js';
import {
  DuplicateEmail,
  type NewUser,
  SQLITE_SCHEMA,
  type User,
  UsersRepository,
  usersFeature,
} from './shared.js';

/** Owns the client. The container calls `dispose` when the app closes. */
export class PrismaConnection {
  constructor(
    readonly client: PrismaClient,
    private readonly cleanup: () => void = () => {},
  ) {}

  disposed = false;

  async dispose() {
    await this.client.$disconnect();
    this.cleanup();
    this.disposed = true;
  }
}

// P2002 is Prisma's code for a unique constraint violation.
const isUnique = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

@Service()
export class PrismaUsers extends UsersRepository {
  constructor(private readonly connection: PrismaConnection) {
    super();
  }

  list(): Promise<User[]> {
    return this.connection.client.user.findMany({ orderBy: { id: 'asc' } });
  }

  async create(input: NewUser): Promise<User> {
    try {
      return await this.connection.client.user.create({ data: input });
    } catch (error) {
      if (isUnique(error)) throw new DuplicateEmail(input.email);
      throw error;
    }
  }

  async createMany(inputs: NewUser[]): Promise<User[]> {
    try {
      return await this.connection.client.$transaction(async (tx) => {
        const created: User[] = [];
        for (const input of inputs) created.push(await tx.user.create({ data: input }));
        return created;
      });
    } catch (error) {
      if (isUnique(error)) throw new DuplicateEmail(inputs.map((i) => i.email).join(', '));
      throw error;
    }
  }
}

export const prismaFeature = async (): Promise<Feature> => {
  // A file, not ":memory:": Prisma's transactions use a second connection.
  const file = join(tmpdir(), `suku-prisma-${crypto.randomUUID()}.db`);
  const client = new PrismaClient({ adapter: new PrismaLibSql({ url: `file:${file}` }) });
  await client.$executeRawUnsafe(SQLITE_SCHEMA);
  return usersFeature('users-prisma', [
    factory(
      PrismaConnection,
      () => new PrismaConnection(client, () => rmSync(file, { force: true })),
    ),
    singleton(UsersRepository, PrismaUsers),
  ]);
};
