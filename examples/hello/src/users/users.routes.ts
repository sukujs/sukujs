import { NotFoundException, Routes, route } from '@suku/core';
import { z } from 'zod';
import { RequireApiKey } from '../common.js';
import { CreateUser, ListUsers } from './dto.js';
import { UsersService } from './users.service.js';

const Id = z.object({ id: z.coerce.number().int().positive() });

@Routes('/users')
export class UsersRoutes {
  constructor(private readonly users: UsersService) {}

  list = route.get('/', {
    query: ListUsers,
    handle: ({ query }) => {
      const all = this.users.findAll();
      const q = query.q?.toLowerCase();
      return (q ? all.filter((u) => u.name.toLowerCase().includes(q)) : all).slice(0, query.limit);
    },
  });

  findOne = route.get('/:id', {
    params: Id,
    handle: ({ params }) => {
      const user = this.users.findOne(String(params.id));
      if (!user) throw new NotFoundException(`User ${params.id} not found`);
      return user;
    },
  });

  create = route.post('/', {
    body: CreateUser,
    middlewares: [RequireApiKey],
    handle: ({ body }) => this.users.create(body.name),
  });

  remove = route.delete('/:id', {
    params: Id,
    middlewares: [RequireApiKey],
    handle: ({ params }) => {
      this.users.findOne(String(params.id));
    },
  });
}
