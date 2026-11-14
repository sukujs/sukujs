// Cloudflare Workers: no port. The platform calls fetch() for every request.
import type { SukuApplication } from '@sukujs/core';
import { createApp } from './app.js';

let app: Promise<SukuApplication> | undefined;

export default {
  async fetch(request: Request, env: Record<string, unknown>): Promise<Response> {
    // Bindings arrive with the first request, so the app is created then and kept.
    app ??= createApp({ runtime: 'cloudflare-workers', source: { ...env } });
    const { handle } = await app;
    const remoteAddress = request.headers.get('cf-connecting-ip') ?? undefined;
    return handle(request, remoteAddress ? { remoteAddress } : undefined);
  },
};
