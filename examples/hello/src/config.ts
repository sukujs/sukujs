import { defineConfig } from '@sukujs/core';
import { z } from 'zod';

/** Validated at startup from process.env; injected with `@Inject(Env)`. */
export const Env = defineConfig(
  'env',
  z.object({
    PORT: z.coerce.number().int().positive().default(3000),
    API_KEY: z.string().min(1).default('secret'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }),
);
