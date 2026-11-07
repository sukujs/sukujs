const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  development: false,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/') return Response.json({ hello: 'world' });
    const m = /^\/users\/([^/]+)/.exec(url.pathname);
    if (m) return Response.json({ id: m[1] });
    return new Response('Not Found', { status: 404 });
  },
});
console.log(`listening on http://127.0.0.1:${server.port}`);
