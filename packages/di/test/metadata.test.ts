import { describe, expect, test } from 'bun:test';
import {
  getConstructorParameters,
  getMetadata,
  Inject,
  Injectable,
  InjectionToken,
  Optional,
  UnresolvableParameterError,
} from '../src/index.js';

describe('metadata shim', () => {
  test('TypeScript emits design:paramtypes through the shim', () => {
    class A {}
    class B {}
    @Injectable()
    class C {
      constructor(
        public a: A,
        public b: B,
      ) {}
    }
    expect(getMetadata('design:paramtypes', C)).toEqual([A, B]);
    expect(getConstructorParameters(C).map((p) => p.token)).toEqual([A, B]);
  });

  test('@Inject overrides the token and @Optional marks the parameter', () => {
    const CONFIG = new InjectionToken<{ port: number }>('CONFIG');
    class Logger {}
    @Injectable()
    class Svc {
      constructor(
        @Inject(CONFIG) public cfg: { port: number },
        @Optional() public log?: Logger,
        @Inject('name') public name?: string,
        @Inject(Logger, 'audit') public audit?: Logger,
      ) {}
    }
    const params = getConstructorParameters(Svc);
    expect(params[0]).toMatchObject({ index: 0, token: CONFIG, optional: false });
    expect(params[1]).toMatchObject({ index: 1, token: Logger, optional: true });
    expect(params[2]).toMatchObject({ index: 2, token: 'name', optional: false });
    expect(params[3]).toMatchObject({ index: 3, token: Logger, key: 'audit' });
  });

  test('interface-typed parameter without @Inject is an error with guidance', () => {
    interface Clock {
      now(): number;
    }
    @Injectable()
    class Uses {
      constructor(public clock: Clock) {}
    }
    expect(() => getConstructorParameters(Uses)).toThrow(UnresolvableParameterError);
    expect(() => getConstructorParameters(Uses)).toThrow(/parameter #0 of Uses/);
  });

  test('undecorated class with constructor parameters is an error', () => {
    class Dep {}
    class Plain {
      constructor(public dep: Dep) {}
    }
    expect(() => getConstructorParameters(Plain)).toThrow(/@Injectable\(\)/);
  });

  test('subclass without its own constructor inherits parent parameters', () => {
    class Dep {}
    @Injectable()
    class Base {
      constructor(public dep: Dep) {}
    }
    class Derived extends Base {}
    expect(getConstructorParameters(Derived).map((p) => p.token)).toEqual([Dep]);
  });
});
