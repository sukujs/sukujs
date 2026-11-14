import { describe, expect, test } from 'bun:test';
import {
  alias,
  factory,
  InjectionToken,
  Service,
  ServiceCollection,
  scoped,
  singleton,
  transient,
  value,
} from '../src/index.js';

abstract class Logger {
  abstract log(m: string): void;
}
@Service()
class ConsoleLogger extends Logger {
  log(_m: string) {}
}
@Service()
class Unrelated {}
const CONFIG = new InjectionToken<{ port: number }>('CONFIG');

describe('typed helpers', () => {
  test('register with the expected lifetimes and kinds', () => {
    const c = new ServiceCollection().addRange([
      singleton(Logger, ConsoleLogger),
      scoped(Unrelated),
      transient('t', ConsoleLogger),
      value(CONFIG, { port: 1 }),
      factory('f', (sp) => sp.get(CONFIG).port, 'transient'),
      alias('log-alias', Logger),
      singleton(Logger, ConsoleLogger, { key: 'audit' }),
    ]);
    expect(c.descriptors.map((d) => `${d.kind}:${d.lifetime}`)).toEqual([
      'class:singleton',
      'class:scoped',
      'class:transient',
      'value:singleton',
      'factory:transient',
      'existing:singleton',
      'class:singleton',
    ]);
    const sp = c.build({ validateOnBuild: true });
    expect(sp.get(Logger)).toBeInstanceOf(ConsoleLogger);
    expect(sp.get('f')).toBe(1);
    expect(sp.get('log-alias')).toBe(sp.get(Logger));
    expect(sp.getKeyed(Logger, 'audit')).toBeInstanceOf(ConsoleLogger);
  });

  test('type-level: implementations and values are checked against the token', () => {
    // @ts-expect-error Unrelated is not a Logger
    singleton(Logger, Unrelated);
    // @ts-expect-error wrong value shape for CONFIG
    value(CONFIG, { port: 'one' });
    // @ts-expect-error alias target must be assignable to the token
    alias(Logger, Unrelated);
    // @ts-expect-error factory must return the token's type
    factory(CONFIG, () => 42);
    // Valid forms compile:
    singleton(Logger, ConsoleLogger);
    value(CONFIG, { port: 3000 });
    alias(Logger, ConsoleLogger);
    expect(true).toBe(true);
  });
});
