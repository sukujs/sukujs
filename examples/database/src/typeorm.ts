import 'reflect-metadata';
import { type Feature, factory, Service, singleton } from '@sukujs/core';
import { Column, DataSource, Entity, PrimaryGeneratedColumn, QueryFailedError } from 'typeorm';
import {
  DuplicateEmail,
  type NewUser,
  type User,
  UsersRepository,
  usersFeature,
} from './shared.js';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;
}

/** Owns the DataSource. The container calls `dispose` when the app closes. */
export class TypeormConnection {
  constructor(readonly dataSource: DataSource) {}

  dispose() {
    return this.dataSource.destroy();
  }
}

const isUnique = (error: unknown) =>
  error instanceof QueryFailedError && /UNIQUE constraint failed/i.test(error.message);

// `@Service()` works alongside `reflect-metadata`, which TypeORM requires.
@Service()
export class TypeormUsers extends UsersRepository {
  constructor(private readonly connection: TypeormConnection) {
    super();
  }

  private get repo() {
    return this.connection.dataSource.getRepository(UserEntity);
  }

  list(): Promise<User[]> {
    return this.repo.find({ order: { id: 'ASC' } });
  }

  async create(input: NewUser): Promise<User> {
    try {
      return await this.repo.save(this.repo.create(input));
    } catch (error) {
      if (isUnique(error)) throw new DuplicateEmail(input.email);
      throw error;
    }
  }

  async createMany(inputs: NewUser[]): Promise<User[]> {
    try {
      return await this.connection.dataSource.transaction(async (manager) => {
        const created: User[] = [];
        for (const input of inputs)
          created.push(await manager.save(manager.create(UserEntity, input)));
        return created;
      });
    } catch (error) {
      if (isUnique(error)) throw new DuplicateEmail(inputs.map((i) => i.email).join(', '));
      throw error;
    }
  }
}

export const typeormFeature = async (): Promise<Feature> => {
  // TypeORM connects asynchronously, so connect before the app is created.
  const dataSource = await new DataSource({
    type: 'sqljs',
    entities: [UserEntity],
    synchronize: true,
  }).initialize();
  return usersFeature('users-typeorm', [
    factory(TypeormConnection, () => new TypeormConnection(dataSource)),
    singleton(UsersRepository, TypeormUsers),
  ]);
};
