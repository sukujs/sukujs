import { describe, expect, test } from 'bun:test';
import {
  Injectable,
  ScopedFromRootError,
  ServiceCollection,
  ServiceProvider,
} from '../src/index.js';

let counter = 0;
@Injectable()
class Counted {
  readonly id = ++counter;
}

describe('lifetimes', () => {
  test('singleton: one instance across root and all scopes', () => {
    const root = new ServiceCollection().addSingleton(Counted).build();
    const s1 = root.createScope();
    const s2 = root.createScope();
    expect(root.get(Counted)).toBe(root.get(Counted));
    expect(s1.get(Counted)).toBe(root.get(Counted));
    expect(s2.get(Counted)).toBe(s1.get(Counted));
  });

  test('scoped: one instance per scope, different across scopes', () => {
    const root = new ServiceCollection().addScoped(Counted).build();
    const s1 = root.createScope();
    const s2 = root.createScope();
    expect(s1.get(Counted)).toBe(s1.get(Counted));
    expect(s2.get(Counted)).toBe(s2.get(Counted));
    expect(s1.get(Counted)).not.toBe(s2.get(Counted));
  });

  test('scoped from root throws by default', () => {
    const root = new ServiceCollection().addScoped(Counted).build();
    expect(() => root.get(Counted)).toThrow(ScopedFromRootError);
    expect(() => root.get(Counted)).toThrow(/createScope/);
  });

  test('scoped from root is allowed when validateScopes is off (root acts as a scope)', () => {
    const root = new ServiceCollection().addScoped(Counted).build({ validateScopes: false });
    expect(root.get(Counted)).toBe(root.get(Counted));
    expect(root.createScope().get(Counted)).not.toBe(root.get(Counted));
  });

  test('transient: new instance on every resolve', () => {
    const root = new ServiceCollection().addTransient(Counted).build();
    const scope = root.createScope();
    expect(root.get(Counted)).not.toBe(root.get(Counted));
    expect(scope.get(Counted)).not.toBe(scope.get(Counted));
  });

  test('singleton dependencies are resolved from the root even when requested in a scope', () => {
    @Injectable()
    class Scoped {}
    @Injectable()
    class Single {
      constructor(public dep: Scoped) {}
    }
    const root = new ServiceCollection().addScoped(Scoped).addSingleton(Single).build();
    const scope = root.createScope();
    // The singleton is built with the root provider, so its scoped dependency is a captive.
    expect(() => scope.get(Single)).toThrow(ScopedFromRootError);
    expect(() => scope.get(Single)).toThrow(/captive/);
  });

  test('ServiceProvider injection yields the resolving scope', () => {
    @Injectable()
    class Needs {
      constructor(public sp: ServiceProvider) {}
    }
    const root = new ServiceCollection().addTransient(Needs).build();
    const scope = root.createScope();
    expect(root.get(Needs).sp).toBe(root);
    expect(scope.get(Needs).sp).toBe(scope);
    expect(scope.get(ServiceProvider)).toBe(scope);
    expect(root.isRoot).toBe(true);
    expect(scope.isRoot).toBe(false);
  });
});
