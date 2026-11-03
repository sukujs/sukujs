import type { ServiceDescriptor } from './descriptor.js';
import { tokenName } from './types.js';

export class DiError extends Error {
  override readonly name: string = 'DiError';
}

function describe(d: ServiceDescriptor): string {
  const base = tokenName(d.token);
  const key = d.key === undefined ? '' : `[key=${String(d.key)}]`;
  return `${base}${key} (${d.lifetime})`;
}

export function formatChain(chain: readonly ServiceDescriptor[]): string {
  return chain.map(describe).join(' -> ');
}

export class MissingServiceError extends DiError {
  override readonly name = 'MissingServiceError';
  constructor(
    readonly token: unknown,
    readonly key: unknown,
    chain: readonly ServiceDescriptor[],
  ) {
    const what = key === undefined ? tokenName(token) : `${tokenName(token)}[key=${String(key)}]`;
    const where = chain.length ? ` while resolving ${formatChain(chain)}` : '';
    super(`No service registered for ${what}${where}. Register it on the ServiceCollection.`);
  }
}

export class CircularDependencyError extends DiError {
  override readonly name = 'CircularDependencyError';
  constructor(readonly chain: readonly ServiceDescriptor[]) {
    super(`Circular dependency detected: ${formatChain(chain)}`);
  }
}

export class ScopedFromRootError extends DiError {
  override readonly name = 'ScopedFromRootError';
  constructor(
    readonly descriptor: ServiceDescriptor,
    chain: readonly ServiceDescriptor[],
  ) {
    const target = `scoped service ${tokenName(descriptor.token)}`;
    super(
      chain.length
        ? `Cannot resolve ${target} from the root provider while constructing ${formatChain(chain)}. ` +
            'A singleton (or a transient created from the root) may not depend on a scoped service; ' +
            'this is a captive dependency.'
        : `Cannot resolve ${target} from the root provider. Create a scope first: provider.createScope().`,
    );
  }
}

export class CaptiveDependencyError extends DiError {
  override readonly name = 'CaptiveDependencyError';
  constructor(
    readonly consumer: ServiceDescriptor,
    readonly dependency: ServiceDescriptor,
  ) {
    super(
      `Captive dependency: ${describe(consumer)} depends on ${describe(dependency)}. ` +
        'A longer-lived service would hold a shorter-lived one for its entire lifetime.',
    );
  }
}

export class UnresolvableParameterError extends DiError {
  override readonly name = 'UnresolvableParameterError';
  constructor(cls: Function, index: number, reason: string) {
    super(
      index < 0
        ? `Cannot construct ${tokenName(cls)}: ${reason}`
        : `Cannot resolve constructor parameter #${index} of ${tokenName(cls)}: ${reason}`,
    );
  }
}

export class InvalidDescriptorError extends DiError {
  override readonly name = 'InvalidDescriptorError';
}

export class ProviderDisposedError extends DiError {
  override readonly name = 'ProviderDisposedError';
  constructor() {
    super('This ServiceProvider has been disposed.');
  }
}
