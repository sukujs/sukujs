import { describe, expect, test } from 'bun:test';
import {
  CaptiveDependencyError,
  CircularDependencyError,
  Inject,
  Injectable,
  MissingServiceError,
  ServiceCollection,
  UnresolvableParameterError,
} from '../src/index.js';

describe('validateOnBuild', () => {
  test('missing dependency fails at build', () => {
    @Injectable()
    class Missing {}
    @Injectable()
    class Needs {
      constructor(public m: Missing) {}
    }
    const c = new ServiceCollection().addSingleton(Needs);
    expect(() => c.build({ validateOnBuild: true })).toThrow(MissingServiceError);
    expect(() => c.build()).not.toThrow();
  });

  test('singleton depending on scoped fails at build as a captive dependency', () => {
    @Injectable()
    class Scoped {}
    @Injectable()
    class Single {
      constructor(public s: Scoped) {}
    }
    const c = new ServiceCollection().addScoped(Scoped).addSingleton(Single);
    expect(() => c.build({ validateOnBuild: true })).toThrow(CaptiveDependencyError);
    expect(() => c.build({ validateOnBuild: true, validateScopes: false })).not.toThrow();
  });

  test('captive detection follows useExisting aliases', () => {
    @Injectable()
    class Scoped {}
    abstract class Alias {}
    @Injectable()
    class Single {
      constructor(public a: Alias) {}
    }
    const c = new ServiceCollection()
      .addScoped(Scoped)
      .addScoped(Alias, { useExisting: Scoped })
      .addSingleton(Single);
    expect(() => c.build({ validateOnBuild: true })).toThrow(CaptiveDependencyError);
  });

  test('scoped depending on transient and singleton depending on transient are fine', () => {
    @Injectable()
    class T {}
    @Injectable()
    class S {
      constructor(public t: T) {}
    }
    @Injectable()
    class Single {
      constructor(public t: T) {}
    }
    const c = new ServiceCollection().addTransient(T).addScoped(S).addSingleton(Single);
    expect(() => c.build({ validateOnBuild: true })).not.toThrow();
  });

  test('cycles fail at build', () => {
    @Injectable()
    class A {
      constructor(@Inject('B') public b: unknown) {}
    }
    @Injectable()
    class B {
      constructor(@Inject('C') public c: unknown) {}
    }
    @Injectable()
    class C {
      constructor(public a: A) {}
    }
    const c = new ServiceCollection().addSingleton(A).addSingleton('B', B).addSingleton('C', C);
    expect(() => c.build({ validateOnBuild: true })).toThrow(CircularDependencyError);
  });

  test('unresolvable parameter types fail at build', () => {
    @Injectable()
    class Bad {
      constructor(public port: number) {}
    }
    const c = new ServiceCollection().addSingleton(Bad);
    expect(() => c.build({ validateOnBuild: true })).toThrow(UnresolvableParameterError);
  });

  test('optional missing dependencies pass validation', () => {
    @Injectable()
    class Missing {}
    @Injectable()
    class Needs {
      constructor(@Inject(Missing) public m?: Missing) {}
    }
    // Not optional: fails.
    expect(() =>
      new ServiceCollection().addSingleton(Needs).build({ validateOnBuild: true }),
    ).toThrow();
  });
});
