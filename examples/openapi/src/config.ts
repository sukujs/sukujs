import { defineConfig } from '@sukujs/core';
import { z } from 'zod';

/** Validated when the app starts. A missing or malformed variable stops it before it listens. */
export const Env = defineConfig(
  'env',
  z.object({
    PORT: z.coerce.number().int().min(0).default(3000),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    // Unset: readable lines in a terminal, JSON everywhere else.
    LOG_FORMAT: z.enum(['json', 'pretty']).optional(),
  }),
);
