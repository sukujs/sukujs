import { monitorEventLoopDelay } from 'node:perf_hooks';
import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { detectResources, envDetector, resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  type Sampler,
  SamplingDecision,
  TraceIdRatioBasedSampler,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import type { ObservabilityOptions } from './types';

/** Set on a request's span when its force-trace header asks for a trace. */
export const FORCE_TRACE = 'app.force_trace';

/** The options with every default and environment variable applied. */
export interface Settings {
  endpoint: string;
  headers: Record<string, string>;
  serviceName: string;
  traceSampleRate: number;
  forceTraceHeader: string | undefined;
  ignoreTraces: RegExp[];
  ignoreError: ((error: Error) => boolean) | undefined;
  logs: boolean;
  metrics: boolean;
}

/** What `telemetry` needs after start-up. Empty while observability is off. */
export const otel: {
  settings?: Settings;
  flush: Array<() => Promise<void>>;
} = { flush: [] };

/**
 * Starts OpenTelemetry once per process: the first call that has an endpoint wins, and later
 * calls change nothing. Without an endpoint it does nothing at all, so development and tests
 * never load an exporter.
 */
export function start(options: ObservabilityOptions): void {
  if (otel.settings) return;
  const env = process.env;
  const endpoint = (
    options.endpoint ??
    env.OTLP_ENDPOINT ??
    env.OTEL_EXPORTER_OTLP_ENDPOINT
  )?.replace(/\/$/, '');
  if (!endpoint || options.enabled === false) return;
  const settings: Settings = {
    endpoint,
    headers: { ...parseHeaders(env.OTLP_HEADER), ...options.headers },
    serviceName: options.serviceName ?? env.OTEL_SERVICE_NAME ?? 'app',
    traceSampleRate: options.traceSampleRate ?? Number(env.OTEL_TRACES_SAMPLER_ARG ?? 0.1),
    forceTraceHeader: options.forceTraceHeader?.toLowerCase(),
    ignoreTraces: options.ignoreTraces ?? [],
    ignoreError: options.ignoreError,
    logs: options.logs ?? env.OTEL_LOGS_EXPORTER !== 'none',
    metrics: options.metrics ?? env.OTEL_METRICS_EXPORTER !== 'none',
  };
  otel.settings = settings;
  const { headers } = settings;
  // OTEL_RESOURCE_ATTRIBUTES adds to this, e.g. deployment.environment.name=production.
  const resource = resourceFromAttributes({ 'service.name': settings.serviceName }).merge(
    detectResources({ detectors: [envDetector] }),
  );

  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());

  // The caller's decision is kept. Otherwise a share of requests is traced, plus every
  // request that carries the force-trace header.
  const share = new TraceIdRatioBasedSampler(settings.traceSampleRate);
  const root: Sampler = {
    shouldSample(ctx, traceId, name, _kind, attributes) {
      if (settings.ignoreTraces.some((pattern) => pattern.test(name))) {
        return { decision: SamplingDecision.NOT_RECORD };
      }
      if (attributes[FORCE_TRACE]) return { decision: SamplingDecision.RECORD_AND_SAMPLED };
      return share.shouldSample(ctx, traceId);
    },
    toString: () => 'AppSampler',
  };
  const tracers = new TracerProvider({
    resource,
    sampler: new ParentBasedSampler({ root }),
    spanProcessors: [
      new BatchSpanProcessor({
        exporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces`, headers }),
      }),
    ],
  });
  trace.setGlobalTracerProvider(tracers);
  otel.flush.push(() => tracers.forceFlush());

  if (settings.logs) {
    const loggers = new LoggerProvider({
      resource,
      processors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({ url: `${endpoint}/v1/logs`, headers }),
        }),
      ],
    });
    logs.setGlobalLoggerProvider(loggers);
    otel.flush.push(() => loggers.forceFlush());
  }

  if (settings.metrics) {
    const meters = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics`, headers }),
          exportIntervalMillis: 60_000,
        }),
      ],
    });
    metrics.setGlobalMeterProvider(meters);
    otel.flush.push(() => meters.forceFlush());
    reportRuntime();
  }
}

/**
 * Reads `OTLP_HEADER`: `name=value` pairs separated by commas. Only the first `=` splits a
 * pair, so a value may contain one, and `%20` in a value is a space.
 */
export function parseHeaders(value: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const pair of (value ?? '').split(',')) {
    const at = pair.indexOf('=');
    if (at < 1) continue;
    const raw = pair.slice(at + 1).trim();
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      // Not percent-encoded after all: use it as written.
    }
    headers[pair.slice(0, at).trim()] = decoded;
  }
  return headers;
}

/** Memory, CPU time, uptime and event-loop delay, read each time metrics are exported. */
function reportRuntime(): void {
  const meter = metrics.getMeter('runtime');
  const gauge = (name: string, unit: string, read: () => number) =>
    meter.createObservableGauge(name, { unit }).addCallback((result) => result.observe(read()));

  gauge('process.memory.usage', 'By', () => process.memoryUsage().rss);
  gauge('process.memory.heap.used', 'By', () => process.memoryUsage().heapUsed);
  gauge('process.uptime', 's', () => process.uptime());
  gauge('process.cpu.time', 's', () => {
    const { user, system } = process.cpuUsage();
    return (user + system) / 1e6;
  });
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  gauge('nodejs.eventloop.delay.p99', 's', () => {
    const p99 = delay.percentile(99) / 1e9;
    delay.reset();
    return p99;
  });
}
