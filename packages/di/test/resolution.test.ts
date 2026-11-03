import { describe, expect, test } from 'bun:test';
import {
  CircularDependencyError,
  Inject,
  Injectable,
  InjectionToken,
  MissingServiceError,
  Optional,
  ServiceCollection,
} from '../src/index.js';

describe('resolution', () => {
  test('constructor injection by class type', () => {
    @Injectable()
    class Db {}
    @Injectable()
    class Repo {
      constructor(public db: Db) {}
    }
    @Injectable()
    class Svc {
      constructor(public repo: Repo) {}
    }
    const sp = new ServiceCollection()
      .addSingleton(Db)
      .addSingleton(Repo)
      .addSingleton(Svc)
      .build();
    const svc = sp.get(Svc);
    expect(svc.repo).toBeInstanceOf(Repo);
    expect(svc.repo.db).toBe(sp.get(Db));
  });

  test('abstract class as token for an implementation', () => {
    abstract class Cache {
      abstract name: string;
    }
    @Injectable()
    class RedisCache extends Cache {
      name = 'redis';
    }
    @Injectable()
    class Uses {
      constructor(public cache: Cache) {}
    }
    const sp = new ServiceCollection().addSingleton(Cache, RedisCache).addSingleton(Uses).build();
    expect(sp.get(Cache)).toBeInstanceOf(RedisCache);
    expect(sp.get(Uses).cache.name).toBe('redis');
    // The implementation class is not itself registered.
    expect(sp.has(RedisCache)).toBe(false);
  });

  test('InjectionToken, string and symbol tokens with values', () => {
    const CONFIG = new InjectionToken<{ port: number }>('CONFIG');
    const SYM = Symbol('sym');
    @Injectable()
    class Svc {
      constructor(
        @Inject(CONFIG) public cfg: { port: number },
        @Inject('greeting') public greeting: string,
        @Inject(SYM) public sym: number,
      ) {}
    }
    const sp = new ServiceCollection()
      .addSingleton(CONFIG, { useValue: { port: 8080 } })
      .addSingleton('greeting', { useValue: 'hi' })
      .addSingleton(SYM, { useValue: 42 })
      .addTransient(Svc)
      .build();
    const svc = sp.get(Svc);
    expect(svc.cfg.port).toBe(8080);
    expect(svc.greeting).toBe('hi');
    expect(svc.sym).toBe(42);
    expect(sp.get(CONFIG).port).toBe(8080);
  });

  test('factory receives the resolving provider', () => {
    @Injectable()
    class Logger {}
    const sp = new ServiceCollection()
      .addSingleton(Logger)
      .addTransient('thing', (p) => ({ log: p.get(Logger) }))
      .build();
    expect(sp.get<{ log: Logger }>('thing').log).toBe(sp.get(Logger));
  });

  test('useExisting aliases another token', () => {
    @Injectable()
    class Impl {}
    abstract class Alias {}
    const sp = new ServiceCollection()
      .addSingleton(Impl)
      .addSingleton(Alias, { useExisting: Impl })
      .build();
    expect(sp.get(Alias)).toBe(sp.get(Impl));
  });

  test('last registration wins for get(), all are returned by getAll() in order', () => {
    abstract class Plugin {
      abstract n: number;
    }
    @Injectable()
    class P1 extends Plugin {
      n = 1;
    }
    @Injectable()
    class P2 extends Plugin {
      n = 2;
    }
    const sp = new ServiceCollection().addSingleton(Plugin, P1).addSingleton(Plugin, P2).build();
    expect(sp.get(Plugin)).toBeInstanceOf(P2);
    expect(sp.getAll(Plugin).map((p) => p.n)).toEqual([1, 2]);
    expect(sp.getAll('nothing')).toEqual([]);
  });

  test('missing service throws with the resolution chain', () => {
    @Injectable()
    class Missing {}
    @Injectable()
    class Needs {
      constructor(public m: Missing) {}
    }
    const sp = new ServiceCollection().addSingleton(Needs).build();
    expect(() => sp.get(Needs)).toThrow(MissingServiceError);
    expect(() => sp.get(Needs)).toThrow(/No service registered for Missing while resolving Needs/);
    expect(sp.getOptional(Missing)).toBeUndefined();
  });

  test('@Optional yields undefined for missing dependencies', () => {
    @Injectable()
    class Missing {}
    @Injectable()
    class Needs {
      constructor(@Optional() public m?: Missing) {}
    }
    const sp = new ServiceCollection().addSingleton(Needs).build();
    expect(sp.get(Needs).m).toBeUndefined();
  });

  test('circular dependency is detected at runtime with the chain', () => {
    @Injectable()
    class A {
      constructor(@Inject('B') public b: unknown) {}
    }
    @Injectable()
    class B {
      constructor(@Inject(A) public a: unknown) {}
    }
    const sp = new ServiceCollection().addSingleton(A).addSingleton('B', B).build();
    expect(() => sp.get(A)).toThrow(CircularDependencyError);
    expect(() => sp.get(A)).toThrow(/A \(singleton\) -> "B" \(singleton\) -> A \(singleton\)/);
  });

  test('keyed services', () => {
    abstract class Storage {
      abstract kind: string;
    }
    @Injectable()
    class S3 extends Storage {
      kind = 's3';
    }
    @Injectable()
    class Local extends Storage {
      kind = 'local';
    }
    @Injectable()
    class Uploader {
      constructor(@Inject(Storage, 's3') public storage: Storage) {}
    }
    const sp = new ServiceCollection()
      .addKeyedSingleton(Storage, 's3', S3)
      .addKeyedSingleton(Storage, 'local', Local)
      .addSingleton(Uploader)
      .build();
    expect(sp.getKeyed(Storage, 's3').kind).toBe('s3');
    expect(sp.getKeyed(Storage, 'local').kind).toBe('local');
    expect(sp.get(Uploader).storage.kind).toBe('s3');
    expect(sp.getKeyedOptional(Storage, 'gcs')).toBeUndefined();
    expect(() => sp.getKeyed(Storage, 'gcs')).toThrow(/Storage\[key=gcs\]/);
    // Keyed registrations are not visible to unkeyed lookup.
    expect(sp.has(Storage)).toBe(false);
    expect(sp.has(Storage, 's3')).toBe(true);
  });

  test('NestJS-style provider objects via add()', () => {
    @Injectable({ lifetime: 'transient' })
    class Bare {}
    @Injectable()
    class Impl {}
    abstract class Tok {}
    const TOKEN = new InjectionToken<number>('n');
    const sp = new ServiceCollection()
      .add(Bare)
      .add({ provide: Tok, useClass: Impl, lifetime: 'scoped' })
      .add({ provide: TOKEN, useValue: 7 })
      .add({ provide: 'f', useFactory: () => 'made' })
      .add({ provide: 'alias', useExisting: TOKEN })
      .build();
    expect(sp.get(Bare)).not.toBe(sp.get(Bare)); // @Injectable lifetime hint honoured
    const scope = sp.createScope();
    expect(scope.get(Tok)).toBeInstanceOf(Impl);
    expect(scope.get(Tok)).toBe(scope.get(Tok));
    expect(sp.get(TOKEN)).toBe(7);
    expect(sp.get('f')).toBe('made');
    expect(sp.get('alias')).toBe(7);
  });
});
