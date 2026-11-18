import { telemetry } from './telemetry';

/**
 * Records a span named `Class.method` around a method, inside the trace of the request that
 * called it.
 */
export function Traced(): MethodDecorator {
  return (target, key, descriptor: PropertyDescriptor) => {
    const original = descriptor.value as (...args: unknown[]) => unknown;
    descriptor.value = function (this: object, ...args: unknown[]) {
      const owner = this?.constructor?.name ?? target.constructor.name;
      return telemetry.startSpan(
        { name: `${owner}.${String(key)}`, op: 'function', onlyIfParent: true },
        () => original.apply(this, args),
      );
    };
    return descriptor;
  };
}
