import {
  ConflictException,
  type ErrorHandler,
  feature,
  route,
  type ServiceEntry,
} from '@sukujs/core';
import { z } from 'zod';

export interface User {
  id: number;
  name: string;
  email: string;
}

export const NewUser = z.object({ name: z.string().min(1), email: z.email() });
export type NewUser = z.infer<typeof NewUser>;

/** A domain error. It knows nothing about HTTP or about any database library. */
export class DuplicateEmail extends Error {
  constructor(readonly email: string) {
    super(`Email ${email} is already registered`);
  }
}

/**
 * The contract every implementation fulfils. Routes depend on this abstract class, so the
 * database library behind it can be swapped without touching them.
 */
export abstract class UsersRepository {
  abstract list(): Promise<User[]>;
  abstract create(input: NewUser): Promise<User>;
  /** Inserts all of them or none: runs in one transaction. */
  abstract createMany(inputs: NewUser[]): Promise<User[]>;
}

export const usersRoutes = route.group('/users', {
  list: route.get('/', {
    services: { users: UsersRepository },
    handle: ({ users }) => users.list(),
  }),
  create: route.post('/', {
    body: NewUser,
    services: { users: UsersRepository },
    handle: ({ body, users }) => users.create(body),
  }),
  batch: route.post('/batch', {
    body: z.array(NewUser).min(1),
    services: { users: UsersRepository },
    handle: ({ body, users }) => users.createMany(body),
  }),
});

/** Translates domain errors at the edge. */
export const databaseErrors: ErrorHandler = (error) => {
  if (error instanceof DuplicateEmail) {
    return new ConflictException({ code: 'email_taken', message: error.message }).toResponse();
  }
};

/** The same routes and error mapping, on whichever implementation is passed in. */
export const usersFeature = (name: string, services: ServiceEntry[]) =>
  feature(name, { routes: [usersRoutes], services, onError: databaseErrors });

export const SQLITE_SCHEMA =
  'create table if not exists users (id integer primary key autoincrement, name text not null, email text not null unique)';
export const POSTGRES_SCHEMA =
  'create table if not exists users (id serial primary key, name text not null, email text not null unique)';
