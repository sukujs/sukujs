import { type Feature, factory, Service, singleton } from '@suku/core';
import {
  DataTypes,
  type InferAttributes,
  type InferCreationAttributes,
  Model,
  Sequelize,
  UniqueConstraintError,
} from 'sequelize';
import {
  DuplicateEmail,
  type NewUser,
  type User,
  UsersRepository,
  usersFeature,
} from './shared.js';

export class UserModel extends Model<
  InferAttributes<UserModel>,
  InferCreationAttributes<UserModel, { omit: 'id' }>
> {
  declare id: number;
  declare name: string;
  declare email: string;
}

/** Owns the Sequelize instance. The container calls `dispose` when the app closes. */
export class SequelizeConnection {
  constructor(readonly sequelize: Sequelize) {}

  dispose() {
    return this.sequelize.close();
  }
}

const plain = (model: UserModel): User => model.get({ plain: true });

@Service()
export class SequelizeUsers extends UsersRepository {
  constructor(private readonly connection: SequelizeConnection) {
    super();
  }

  async list(): Promise<User[]> {
    return (await UserModel.findAll({ order: [['id', 'ASC']] })).map(plain);
  }

  async create(input: NewUser): Promise<User> {
    try {
      return plain(await UserModel.create(input));
    } catch (error) {
      if (error instanceof UniqueConstraintError) throw new DuplicateEmail(input.email);
      throw error;
    }
  }

  async createMany(inputs: NewUser[]): Promise<User[]> {
    try {
      return await this.connection.sequelize.transaction(async (transaction) => {
        const created: User[] = [];
        for (const input of inputs)
          created.push(plain(await UserModel.create(input, { transaction })));
        return created;
      });
    } catch (error) {
      if (error instanceof UniqueConstraintError)
        throw new DuplicateEmail(inputs.map((i) => i.email).join(', '));
      throw error;
    }
  }
}

export const sequelizeFeature = async (): Promise<Feature> => {
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
  UserModel.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING, allowNull: false },
      email: { type: DataTypes.STRING, allowNull: false, unique: true },
    },
    { sequelize, tableName: 'users', timestamps: false },
  );
  await sequelize.sync();
  return usersFeature('users-sequelize', [
    factory(SequelizeConnection, () => new SequelizeConnection(sequelize)),
    singleton(UsersRepository, SequelizeUsers),
  ]);
};
