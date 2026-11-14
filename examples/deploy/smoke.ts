// Checks a running deployment from the outside:  bun run smoke.ts https://api.example.com
export {};

const base = (process.argv[2] ?? 'http://127.0.0.1:3000').replace(/\/$/, '');

let failed = 0;
const check = async (name: string, run: () => Promise<string | undefined>) => {
  try {
    const problem = await run();
    if (problem) failed++;
    console.log(`${problem ? 'FAIL' : 'ok  '}  ${name}${problem ? `: ${problem}` : ''}`);
  } catch (error) {
    failed++;
    console.log(`FAIL  ${name}: ${(error as Error).message}`);
  }
};
const get = (path: string) => fetch(`${base}${path}`);
const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const expectStatus = (response: Response, status: number) =>
  response.status === status ? undefined : `expected ${status}, got ${response.status}`;

console.log(`Checking ${base}\n`);

await check('GET /health', async () => expectStatus(await get('/health'), 200));
await check('GET /ready', async () => expectStatus(await get('/ready'), 200));

await check('GET /info', async () => {
  const response = await get('/info');
  const info = await response.json();
  console.log(`      runtime=${info.runtime} version=${info.version} instance=${info.instance}`);
  return expectStatus(response, 200);
});

await check('one or several copies', async () => {
  const ids = new Set<string>();
  for (let i = 0; i < 12; i++) ids.add((await (await get('/info')).json()).instance);
  console.log(`      ${ids.size} instance(s) answered 12 requests`);
  return undefined;
});

await check('GET /hello/Ada reads configuration', async () => {
  const response = await get('/hello/Ada');
  const { message } = await response.json();
  console.log(`      ${message}`);
  return expectStatus(response, 200) ?? (message?.endsWith(', Ada') ? undefined : 'bad message');
});

await check('GET /whoami', async () => {
  const response = await get('/whoami');
  const who = await response.json();
  console.log(`      ip=${who.ip} peer=${who.peer} host=${who.host} protocol=${who.protocol}`);
  console.log(`      x-forwarded-for=${who.forwardedFor} x-forwarded-proto=${who.forwardedProto}`);
  if (who.host !== new URL(base).host) return `Host was not preserved: app saw ${who.host}`;
  return expectStatus(response, 200);
});

await check('POST /echo accepts a valid body', async () =>
  expectStatus(await post('/echo', { message: 'hello' }), 200),
);
await check('POST /echo rejects an invalid body with 400', async () =>
  expectStatus(await post('/echo', { message: '' }), 400),
);
await check('unknown path is 404', async () => expectStatus(await get('/nope'), 404));

await check('security headers', async () => {
  const response = await get('/health');
  return response.headers.get('x-content-type-options') === 'nosniff'
    ? undefined
    : 'x-content-type-options is missing';
});

await check('POST /hash (CPU heavy)', async () => {
  const response = await post('/hash', { password: 'correct horse battery staple' });
  if (response.status !== 200) return `status ${response.status}: a CPU limit may have been hit`;
  console.log(`      hashed and verified in ${(await response.json()).ms} ms`);
  return undefined;
});

await check('GET /limited allows 5 a minute', async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 8; i++) statuses.push((await get('/limited')).status);
  const allowed = statuses.filter((s) => s === 200).length;
  console.log(`      ${allowed} of 8 allowed (${statuses.join(' ')})`);
  if (allowed > 5) return `${allowed} allowed: several copies each keep their own count`;
  if (allowed < 5) return `${allowed} allowed: wait a minute and run again`;
  return undefined;
});

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
