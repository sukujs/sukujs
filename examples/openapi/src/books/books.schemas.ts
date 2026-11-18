import { z } from 'zod';

// `id` names the schema: it is written once under `components.schemas` and referenced.
export const Book = z
  .object({
    id: z.number().int(),
    title: z.string(),
    author: z.string(),
    year: z.number().int().optional(),
  })
  .meta({ id: 'Book' });

export const NewBook = z.object({
  title: z.string().min(1).max(200),
  author: z.string().min(1).max(100),
  year: z.number().int().min(0).optional(),
});

export const BookId = z.object({ id: z.coerce.number().int().positive() });

export const BookQuery = z.object({
  author: z.string().optional().describe('Only books by this author'),
  limit: z.coerce.number().int().min(1).max(100).default(20).describe('Page size'),
});

export type Book = z.infer<typeof Book>;
export type NewBook = z.infer<typeof NewBook>;
