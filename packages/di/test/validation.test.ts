import { describe, expect, test } from 'bun:test';
import {
  CaptiveDependencyError,
  CircularDependencyError,
  Inject,
  MissingServiceError,
  Service,
  ServiceCollection,
  UnresolvableParameterError,
} from '../src/index';

describe('validateOnBuild', () => {
  test('missing dependency fails at build', () => {
    @Service()
    class Missing {}
    @Service()
    class Needs {
      constructor(public m: Missing) {}
    }
    const c = new ServiceCollection().addSingleton(Needs);
    expect(() => c.build({ validateOnBuild: true })).toThrow(MissingServiceError);
    expect(() => c.build()).not.toThrow();
  });

  test('singleton depending on scoped is promoted to scoped (Nest-like)', () => {
    @Service()
    class Scoped {}
    @Service()
    class Single {
      constructor(public s: Scoped) {}
    }
    const sp = new ServiceCollection()
      .addScoped(Scoped)
      .addSingleton(Single)
      .build({ validateOnBuild: true });
    expect(sp.lifetimeOf(Single)).toBe('scoped');
    expect(() => sp.get(Single)).toThrow(); // still not resolvable from root
    const scope = sp.createScope();
    expect(scope.get(Single).s).toBe(scope.get(Scoped));
  });

  test('captiveDependencies: error keeps .NET-like rejection', () => {
    @Service()
    class Scoped {}
    @Service()
    class Single {
      constructor(public s: Scoped) {}
    }
    const c = new ServiceCollection().addScoped(Scoped).addSingleton(Single);
    expect(() => c.build({ validateOnBuild: true, captiveDependencies: 'error' })).toThrow(
      CaptiveDependencyError,
    );
    expect(() => c.build({ validateOnBuild: true, validateScopes: false })).not.toThrow();
  });

  test('promotion follows useExisting aliases and bubbles up the chain', () => {
    @Service()
    class Scoped {}
    abstract class Alias {}
    @Service()
    class Mid {
      constructor(public a: Alias) {}
    }
    @Service()
    class Top {
      constructor(public mid: Mid) {}
    }
    const sp = new ServiceCollection()
      .addScoped(Scoped)
      .addScoped(Alias, { useExisting: Scoped })
      .addSingleton(Mid)
      .addSingleton(Top)
      .build({ validateOnBuild: true });
    expect(sp.lifetimeOf(Mid)).toBe('scoped');
    expect(sp.lifetimeOf(Top)).toBe('scoped');
  });

  test('scoped depending on transient and singleton depending on transient are fine', () => {
    @Service()
    class T {}
    @Service()
    class S {
      constructor(public t: T) {}
    }
    @Service()
    class Single {
      constructor(public t: T) {}
    }
    const c = new ServiceCollection().addTransient(T).addScoped(S).addSingleton(Single);
    expect(() => c.build({ validateOnBuild: true })).not.toThrow();
  });

  test('cycles fail at build', () => {
    @Service()
    class A {
      constructor(@Inject('B') public b: unknown) {}
    }
    @Service()
    class B {
      constructor(@Inject('C') public c: unknown) {}
    }
    @Service()
    class C {
      constructor(public a: A) {}
    }
    const c = new ServiceCollection().addSingleton(A).addSingleton('B', B).addSingleton('C', C);
    expect(() => c.build({ validateOnBuild: true })).toThrow(CircularDependencyError);
  });

  test('unresolvable parameter types fail at build', () => {
    @Service()
    class Bad {
      constructor(public port: number) {}
    }
    const c = new ServiceCollection().addSingleton(Bad);
    expect(() => c.build({ validateOnBuild: true })).toThrow(UnresolvableParameterError);
  });

  test('optional missing dependencies pass validation', () => {
    @Service()
    class Missing {}
    @Service()
    class Needs {
      constructor(@Inject(Missing) public m?: Missing) {}
    }
    // Not optional: fails.
    expect(() =>
      new ServiceCollection().addSingleton(Needs).build({ validateOnBuild: true }),
    ).toThrow();
  });
});
