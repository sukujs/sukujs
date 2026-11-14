import { describe, expect, test } from 'bun:test';
import { InvalidDescriptorError, Service, ServiceCollection } from '../src/index.js';

@Service()
class A {}
@Service()
class B {}
abstract class T {}

describe('ServiceCollection', () => {
  test('tryAdd* only registers when the token is absent', () => {
    const c = new ServiceCollection().addSingleton(T, A).tryAddSingleton(T, B);
    expect(c.size).toBe(1);
    expect(c.build().get(T)).toBeInstanceOf(A);
    c.tryAddScoped(A);
    expect(c.size).toBe(2);
  });

  test('tryAddEnumerable dedupes by implementation', () => {
    const c = new ServiceCollection()
      .tryAddEnumerable({ provide: T, useClass: A })
      .tryAddEnumerable({ provide: T, useClass: A })
      .tryAddEnumerable({ provide: T, useClass: B });
    expect(c.size).toBe(2);
    expect(c.build().getAll(T).length).toBe(2);
  });

  test('replace removes all registrations for the token then adds', () => {
    const c = new ServiceCollection()
      .addSingleton(T, A)
      .addSingleton(T, A)
      .replace({ provide: T, useClass: B });
    expect(c.size).toBe(1);
    expect(c.build().get(T)).toBeInstanceOf(B);
  });

  test('remove is keyed-aware', () => {
    const c = new ServiceCollection().addSingleton(T, A).addKeyedSingleton(T, 'k', B);
    c.remove(T);
    expect(c.has(T)).toBe(false);
    expect(c.has(T, 'k')).toBe(true);
  });

  test('a non-class token needs an implementation', () => {
    expect(() => new ServiceCollection().addSingleton('x')).toThrow(InvalidDescriptorError);
    expect(() => new ServiceCollection().addSingleton(T, { useClass: 'nope' as any })).toThrow(
      InvalidDescriptorError,
    );
    expect(() =>
      new ServiceCollection().addSingleton(T, { useClass: A, useValue: 1 } as any),
    ).toThrow(/exactly one/);
  });

  test('plain functions are factories, classes are classes', () => {
    function makeIt() {
      return { made: true };
    }
    const sp = new ServiceCollection()
      .addSingleton('fn', makeIt)
      .addSingleton('arrow', () => ({ arrow: true }))
      .addSingleton('cls', A)
      .build();
    expect(sp.get('fn')).toEqual({ made: true });
    expect(sp.get('arrow')).toEqual({ arrow: true });
    expect(sp.get('cls')).toBeInstanceOf(A);
  });

  test('build() snapshots the collection; later additions do not affect the provider', () => {
    const c = new ServiceCollection().addSingleton(A);
    const sp = c.build();
    c.addSingleton(B);
    expect(sp.has(B)).toBe(false);
    expect(c.build().has(B)).toBe(true);
  });
});
