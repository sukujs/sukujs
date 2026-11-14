// Suku's metadata shim loads first and records a class; reflect-metadata loads afterwards.
import { Service } from '@suku/core';
import { ServiceCollection } from '../../../../packages/di/src/index.js';

class Engine {}

@Service()
class Before {
  constructor(readonly engine: Engine) {}
}

await import('reflect-metadata');

@Service()
class After {
  constructor(
    readonly engine: Engine,
    readonly before: Before,
  ) {}
}

const provider = new ServiceCollection()
  .addSingleton(Engine)
  .addSingleton(Before)
  .addSingleton(After)
  .build({ validateOnBuild: true });
const after = provider.get(After);
console.log(
  JSON.stringify({
    before: after.before.engine === provider.get(Engine),
    after: after.engine === provider.get(Engine),
  }),
);
