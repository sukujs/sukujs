import { describe, expect, test } from 'bun:test';
import { Injectable, ProviderDisposedError, ServiceCollection } from '../src/index.js';

describe('disposal', () => {
  test('owned instances dispose newest-first; sync, async and Symbol forms are supported', async () => {
    const order: string[] = [];
    @Injectable()
    class A {
      dispose() {
        order.push('A');
      }
    }
    @Injectable()
    class B {
      constructor(public a: A) {}
      async [Symbol.asyncDispose]() {
        await Promise.resolve();
        order.push('B');
      }
    }
    @Injectable()
    class C {
      constructor(public b: B) {}
      [Symbol.dispose]() {
        order.push('C');
      }
    }
    @Injectable()
    class D {
      onDispose() {
        order.push('D');
      }
    }
    const root = new ServiceCollection()
      .addSingleton(A)
      .addSingleton(B)
      .addSingleton(C)
      .addSingleton(D)
      .build();
    root.get(C); // creates A, then B, then C
    root.get(D);
    await root.dispose();
    expect(order).toEqual(['D', 'C', 'B', 'A']);
  });

  test('scope disposal releases scoped and transient instances it created, not singletons', async () => {
    const disposed: string[] = [];
    @Injectable()
    class Single {
      dispose() {
        disposed.push('single');
      }
    }
    @Injectable()
    class Scoped {
      dispose() {
        disposed.push('scoped');
      }
    }
    @Injectable()
    class Trans {
      dispose() {
        disposed.push('transient');
      }
    }
    const root = new ServiceCollection()
      .addSingleton(Single)
      .addScoped(Scoped)
      .addTransient(Trans)
      .build();
    const scope = root.createScope();
    scope.get(Single);
    scope.get(Scoped);
    scope.get(Trans);
    scope.get(Trans);
    await scope.dispose();
    expect(disposed).toEqual(['transient', 'transient', 'scoped']);
    await root.dispose();
    expect(disposed).toEqual(['transient', 'transient', 'scoped', 'single']);
  });

  test('values registered with useValue are not disposed by the container', async () => {
    let called = 0;
    const external = { dispose: () => void called++ };
    const root = new ServiceCollection().addSingleton('ext', { useValue: external }).build();
    root.get('ext');
    await root.dispose();
    expect(called).toBe(0);
  });

  test('root disposal disposes live child scopes', async () => {
    const disposed: string[] = [];
    @Injectable()
    class Scoped {
      dispose() {
        disposed.push('scoped');
      }
    }
    const root = new ServiceCollection().addScoped(Scoped).build();
    const s1 = root.createScope();
    const s2 = root.createScope();
    s1.get(Scoped);
    s2.get(Scoped);
    await root.dispose();
    expect(disposed).toEqual(['scoped', 'scoped']);
    expect(() => s1.get(Scoped)).toThrow(ProviderDisposedError);
  });

  test('using a disposed provider throws; disposing twice is a no-op', async () => {
    @Injectable()
    class X {}
    const root = new ServiceCollection().addSingleton(X).build();
    await root.dispose();
    await root.dispose();
    expect(() => root.get(X)).toThrow(ProviderDisposedError);
    expect(() => root.createScope()).toThrow(ProviderDisposedError);
  });

  test('works with `await using`', async () => {
    let disposed = false;
    @Injectable()
    class X {
      dispose() {
        disposed = true;
      }
    }
    {
      await using root = new ServiceCollection().addSingleton(X).build();
      root.get(X);
    }
    expect(disposed).toBe(true);
  });
});
