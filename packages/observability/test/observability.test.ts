// Runs the middleware against a local stand-in for an OTLP endpoint, with the real SDK.
import { afterAll, describe, expect, test } from 'bun:test';
import {
  Logger,
  type LogLevel,
  NotFoundException,
  route,
  Service,
  SilentLogger,
  Suku,
  singleton,
} from '@sukujs/core';
import { observability, Traced, telemetry } from '../src/index';
import { parseHeaders } from '../src/init';

delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
delete process.env.OTLP_ENDPOINT;
process.env.OTLP_HEADER = 'x-short=Basic%20abc,x-auth=sentry sentry_key=k1';
process.env.OTEL_EXPORTER_OTLP_HEADERS = 'x-env=Bearer%20secret';
process.env.OTEL_RESOURCE_ATTRIBUTES = 'deployment.environment.name=staging';

/** Keeps the text of every export. OTLP bodies are protobuf: names and messages stay readable. */
let received = '';
const backend = Bun.serve({
  port: 0,
  async fetch(request) {
    const body = Buffer.from(await request.arrayBuffer()).toString('latin1');
    const { headers } = request;
    received += `${new URL(request.url).pathname} env=${headers.get('x-env')} key=${headers.get('x-key')} short=${headers.get('x-short')} auth=${headers.get('x-auth')} ${body}\n`;
    return new Response('{}');
  },
});
afterAll(() => backend.stop(true));
const text = () => received.replace(/[^\x21-\x7e]+/g, ' ');

@Service()
class Reports {
  @Traced()
  async build(month: string) {
    await new Promise((done) => setTimeout(done, 5));
    return `report for ${month}`;
  }

  @Traced()
  count() {
    return 3;
  }
}

/** A logger that ships its lines, as the starter's pino logger does. */
class ShippingLogger extends Logger {
  log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    telemetry.log(level, message, meta);
  }
}

const routes = [
  route.get('/reports/:month', {
    services: { reports: Reports, log: Logger },
    handle: async ({ params, reports, log }) => {
      log.info('building report', { month: params.month });
      return { report: await reports.build(params.month), count: reports.count() };
    },
  }),
  route.get('/boom', {
    handle: () => {
      throw new Error('kaboom');
    },
  }),
  route.get('/expected', {
    handle: () => {
      throw new TypeError('expected failure');
    },
  }),
  route.get('/missing', {
    handle: () => {
      throw new NotFoundException('no such thing');
    },
  }),
];
const req = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://app.test${path}`, { headers });

describe('OTLP_HEADER', () => {
  test('is name=value pairs, split on the first = and percent-decoded', () => {
    expect(parseHeaders('a=1, b = two words ,c=x=y,d=Basic%20abc==')).toEqual({
      a: '1',
      b: 'two words',
      c: 'x=y',
      d: 'Basic abc==',
    });
    expect(parseHeaders(undefined)).toEqual({});
    expect(parseHeaders('novalue,=nokey,bad=%E0%A4%A')).toEqual({ bad: '%E0%A4%A' });
  });
});

describe('without an endpoint', () => {
  test('the app works, nothing is sent and telemetry is a no-op', async () => {
    const app = await Suku.create({
      middlewares: [observability()],
      routes,
      services: [Reports, singleton(Logger, SilentLogger)],
    });
    expect(telemetry.isEnabled()).toBe(false);
    const res = await app.handle(req('/reports/may'));
    expect(await res.json()).toEqual({ report: 'report for may', count: 3 });
    expect((await app.handle(req('/boom'))).status).toBe(500);
    expect(telemetry.startSpan({ name: 'x' }, () => 7)).toBe(7);
    telemetry.log('info', 'nowhere');
    telemetry.captureException(new Error('nowhere'));
    await app.close();
    expect(received).toBe('');
  });
});

describe('with an endpoint', () => {
  const create = () => {
    // The endpoint comes from OTLP_ENDPOINT, the headers from three places at once.
    process.env.OTLP_ENDPOINT = `http://127.0.0.1:${backend.port}/`;
    return Suku.create({
      middlewares: [
        observability({
          headers: { 'x-key': 'from-options' },
          serviceName: 'reports-api',
          traceSampleRate: 0,
          forceTraceHeader: 'x-app-trace',
          ignoreTraces: [/^GET \/health$/],
          ignoreError: (error) => error instanceof TypeError,
        }),
      ],
      routes: [...routes, route.get('/health', { handle: () => 'ok' })],
      services: [Reports, singleton(Logger, ShippingLogger)],
    });
  };
  const traced = { 'x-app-trace': '1' };

  test('sends traces, spans, logs, errors and metrics, with headers from both sources', async () => {
    const app = await create();
    expect(telemetry.isEnabled()).toBe(true);
    // Part of a trace the caller started: sampled because the caller said so.
    const continued = { traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' };
    expect((await app.handle(req('/reports/may', continued))).status).toBe(200);
    expect((await app.handle(req('/boom', traced))).status).toBe(500);
    expect((await app.handle(req('/missing', traced))).status).toBe(404);
    expect((await app.handle(req('/expected', traced))).status).toBe(500);
    expect((await app.handle(req('/nope', traced))).status).toBe(404);
    expect((await app.handle(req('/health', traced))).status).toBe(200);
    // Not sampled: the rate is 0 and nothing forces it.
    expect((await app.handle(req('/reports/june'))).status).toBe(200);
    // Closing the app disposes the middleware, which flushes.
    await app.close();

    const sent = text();
    for (const signal of ['traces', 'logs', 'metrics']) {
      expect(sent).toContain(
        `/v1/${signal} env=Bearer secret key=from-options short=Basic abc auth=sentry sentry_key=k1`,
      );
    }
    expect(sent).toContain('service.name reports-api');
    expect(sent).toContain('deployment.environment.name staging');

    // The trace is named after the route and holds both traced methods, sync and async.
    expect(sent).toContain('GET /reports/:month');
    expect(sent).toContain('http.route /reports/:month');
    expect(sent).toContain('Reports.build');
    expect(sent).toContain('Reports.count');
    const traceId = Buffer.from('0af7651916cd43dd8448eb211c80319c', 'hex').toString('latin1');
    expect(received).toContain(traceId);

    // The unexpected error is reported. An HttpException, the 404 and an ignored error are not.
    expect(sent).toContain('exception.message kaboom');
    expect(sent).not.toContain('no such thing');
    expect(sent).not.toContain('Cannot GET /nope');
    // (The app's logger still writes its own line for it; only the report is skipped.)
    expect(sent).not.toContain('exception.message expected failure');

    // Logs are always sent, sampled request or not. Ignored traces are not.
    expect(sent).toContain('building report');
    expect(sent.match(/building report/g)).toHaveLength(2);
    expect(sent).not.toContain('GET /health');
    expect(sent).toContain('process.memory.usage');
  });

  test('is started once: a second call does not reconfigure it', async () => {
    received = '';
    const app = await Suku.create({
      middlewares: [observability({ endpoint: 'http://127.0.0.1:1', serviceName: 'other' })],
      routes,
      services: [Reports, singleton(Logger, SilentLogger)],
    });
    await app.handle(req('/reports/july', traced));
    await app.close();
    expect(text()).toContain('service.name reports-api');
    expect(text()).toContain('GET /reports/:month');
  });

  test('captureException and startSpan work outside a request', async () => {
    received = '';
    telemetry.captureException(new Error('handled'), { orderId: 7 });
    expect(await telemetry.startSpan({ name: 'job', op: 'task' }, async () => 'done')).toBe('done');
    expect(telemetry.startSpan({ name: 'skipped', onlyIfParent: true }, () => 1)).toBe(1);
    expect(() =>
      telemetry.startSpan({ name: 'throws' }, () => {
        throw new Error('inside span');
      }),
    ).toThrow('inside span');
    await telemetry.flush();
    const sent = text();
    expect(sent).toContain('exception.message handled');
    expect(sent).toContain('orderId');
    expect(sent).not.toContain('skipped');
  });
});
