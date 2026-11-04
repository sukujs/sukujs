import type { ArgumentMetadata, Pipe } from './enhancers.js';
import { BadRequestException } from './http-errors.js';

function where(m: ArgumentMetadata): string {
  return m.data === undefined
    ? m.kind.toLowerCase()
    : `${m.kind.toLowerCase()} "${String(m.data)}"`;
}

function fail(m: ArgumentMetadata, expected: string): never {
  throw new BadRequestException(`Validation failed for ${where(m)}: ${expected}`);
}

export class ParseIntPipe implements Pipe<unknown, number> {
  transform(value: unknown, m: ArgumentMetadata): number {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'string' && /^\s*[-+]?\d+\s*$/.test(value))
      return Number.parseInt(value, 10);
    return fail(m, 'an integer is expected');
  }
}

export class ParseFloatPipe implements Pipe<unknown, number> {
  transform(value: unknown, m: ArgumentMetadata): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return fail(m, 'a number is expected');
  }
}

export class ParseBoolPipe implements Pipe<unknown, boolean> {
  transform(value: unknown, m: ArgumentMetadata): boolean {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return fail(m, 'a boolean ("true" or "false") is expected');
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ParseUUIDPipe implements Pipe<unknown, string> {
  transform(value: unknown, m: ArgumentMetadata): string {
    if (typeof value === 'string' && UUID.test(value)) return value;
    return fail(m, 'a UUID is expected');
  }
}

/** Replaces `undefined` (a missing query value, say) with a default. Use as an instance. */
export class DefaultValuePipe<T> implements Pipe<unknown, unknown> {
  constructor(private readonly defaultValue: T) {}
  transform(value: unknown): unknown {
    return value === undefined || value === null || value === '' ? this.defaultValue : value;
  }
}

/** Accepts only one of the given values. Use as an instance: `new ParseEnumPipe(['asc', 'desc'])`. */
export class ParseEnumPipe<T extends string | number> implements Pipe<unknown, T> {
  private readonly allowed: readonly T[];
  constructor(values: readonly T[] | Record<string, T>) {
    this.allowed = Array.isArray(values) ? values : (Object.values(values) as T[]);
  }
  transform(value: unknown, m: ArgumentMetadata): T {
    if (this.allowed.includes(value as T)) return value as T;
    return fail(m, `one of ${this.allowed.map((v) => JSON.stringify(v)).join(', ')} is expected`);
  }
}
