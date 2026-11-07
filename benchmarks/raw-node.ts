import { createServer } from 'node:http';

const server = createServer((req, res) => {
  if (req.url === '/' || req.url?.startsWith('/?')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"hello":"world"}');
    return;
  }
  const m = /^\/users\/([^/?]+)/.exec(req.url ?? '');
  if (m) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: m[1] }));
    return;
  }
  res.writeHead(404).end('Not Found');
});
server.listen(0, '127.0.0.1', () => {
  const a = server.address() as { port: number };
  console.log(`listening on http://127.0.0.1:${a.port}`);
});
