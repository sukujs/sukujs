import { Logger } from '@suku/core';
import { Injectable } from '@suku/di';

export interface User {
  id: string;
  name: string;
}

@Injectable()
export class UsersService {
  private readonly users = new Map<string, User>([
    ['1', { id: '1', name: 'Ada Lovelace' }],
    ['2', { id: '2', name: 'Grace Hopper' }],
  ]);

  constructor(private readonly log: Logger) {}

  findAll(): User[] {
    return [...this.users.values()];
  }

  findOne(id: string): User | undefined {
    return this.users.get(id);
  }

  create(name: string): User {
    const user = { id: String(this.users.size + 1), name };
    this.users.set(user.id, user);
    this.log.info(`created user ${user.id}`);
    return user;
  }
}
