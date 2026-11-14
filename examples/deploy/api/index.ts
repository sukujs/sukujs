// Vercel: one function for the whole API. vercel.json sends every path here.
import { createApp } from '../src/app.js';

const app = await createApp({ runtime: 'vercel' });

export default {
  fetch: (request: Request) => app.handle(request),
};
