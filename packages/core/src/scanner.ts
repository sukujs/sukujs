import { type Constructor, getInjectableOptions, ServiceCollection } from '@suku/di';
import { type Feature, type FeatureRef, isFeature, type RouteEntry } from './feature.js';
import { isRoute, isRouteGroup } from './route.js';
import { getRoutesMetadata } from './routes-class.js';

export class FeatureError extends Error {
  override readonly name = 'FeatureError';
}

export interface ScannedEntry {
  readonly entry: RouteEntry;
  readonly feature: Feature;
}

export interface ScanResult {
  /** Every feature reached from the root, imports before the features that import them. */
  readonly features: Feature[];
  readonly entries: ScannedEntry[];
  readonly collection: ServiceCollection;
}

/**
 * Walks the feature graph from the root and flattens it into one `ServiceCollection`: every
 * service, and every `@Routes` class registered with its declared lifetime.
 */
export async function scanFeatures(root: FeatureRef): Promise<ScanResult> {
  const collection = new ServiceCollection();
  const features: Feature[] = [];
  const entries: ScannedEntry[] = [];
  const seen = new Set<Feature>();
  const seenClasses = new Set<Constructor>();

  const visit = async (ref: FeatureRef, chain: Feature[]): Promise<void> => {
    const f = await ref;
    const via = chain.map((c) => c.name).join(' -> ') || 'root';
    if (!isFeature(f)) {
      throw new FeatureError(
        `${describe(f)} is not a feature (imported via ${via}). Create one with feature(name, { ... }).`,
      );
    }
    if (chain.includes(f)) {
      throw new FeatureError(
        `Circular feature import: ${[...chain, f].map((c) => c.name).join(' -> ')}`,
      );
    }
    if (seen.has(f)) return;
    seen.add(f);

    for (const imp of f.imports ?? []) await visit(imp, [...chain, f]);

    for (const s of f.services ?? []) collection.add(s);
    for (const entry of f.routes ?? []) {
      if (isRoute(entry) || isRouteGroup(entry)) {
        entries.push({ entry, feature: f });
        continue;
      }
      const meta = typeof entry === 'function' ? getRoutesMetadata(entry) : undefined;
      if (!meta) {
        throw new FeatureError(
          `${describe(entry)} in feature "${f.name}" is not a route. Use route.get(...), route.group(...), or a class decorated with @Routes().`,
        );
      }
      if (seenClasses.has(entry)) continue;
      seenClasses.add(entry);
      entries.push({ entry, feature: f });
      // An explicit entry in `services` (e.g. a custom lifetime) wins over the implicit registration.
      if (!collection.has(entry)) {
        const lifetime = meta.lifetime ?? getInjectableOptions(entry)?.lifetime ?? 'singleton';
        collection.add({ provide: entry, useClass: entry, lifetime });
      }
    }
    features.push(f);
  };

  await visit(root, []);
  return { features, entries, collection };
}

function describe(value: unknown): string {
  if (typeof value === 'function') return value.name || '<anonymous class>';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
