import type { Infer } from '@suku/core';
import { z } from 'zod';

export const CreateUser = z.object({
  name: z.string().min(2).max(80),
  email: z.email().optional(),
});
export type CreateUser = Infer<typeof CreateUser>;

export const ListUsers = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListUsers = Infer<typeof ListUsers>;
