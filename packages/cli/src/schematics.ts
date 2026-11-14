import { CliError } from './errors.js';
import { type Names, names, singular, splitPath } from './names.js';
import type { Plan } from './plan.js';
import { importPath, type Project } from './project.js';
import { addArrayToFeature, addImport, addToArray } from './register.js';

export interface GenerateOptions {
  /** Functions instead of classes: `route.group` and `service()`. */
  classless?: boolean;
  /** Do not create a folder named after the thing. */
  flat?: boolean;
  /** Do not edit other files to register what was generated. */
  skipImport?: boolean;
  /** `resource` only: do not generate a test file. */
  skipTests?: boolean;
}

export const SCHEMATICS = {
  feature: { alias: 'f', description: 'A feature: a named group of routes and services' },
  routes: { alias: 'r', description: 'A routes class (or a route group with --classless)' },
  service: { alias: 's', description: 'A service class (or service() with --classless)' },
  middleware: { alias: 'mw', description: 'A middleware' },
  resource: { alias: 'res', description: 'A CRUD feature: routes, service, schemas and a test' },
} as const;

export type Schematic = keyof typeof SCHEMATICS;

export function resolveSchematic(input: string): Schematic {
  for (const [name, { alias }] of Object.entries(SCHEMATICS)) {
    if (input === name || input === alias) return name as Schematic;
  }
  throw new CliError(
    `Unknown schematic "${input}". Available: ${Object.entries(SCHEMATICS)
      .map(([name, { alias }]) => `${name} (${alias})`)
      .join(', ')}.`,
  );
}

interface Target {
  n: Names;
  /** Folder for the generated files, relative to the project root. */
  dir: string;
  file: (suffix: string) => string;
}

function target(
  project: Project,
  input: string,
  options: GenerateOptions,
  ownFolder = true,
): Target {
  const { dir, name } = splitPath(input);
  const n = names(name);
  const parts = [project.sourceRoot, dir, ownFolder && !options.flat ? n.kebab : ''].filter(
    Boolean,
  );
  const folder = parts.join('/');
  return { n, dir: folder, file: (suffix) => `${folder}/${n.kebab}.${suffix}.ts` };
}

/** Edits `file` so it imports `symbol` and lists it under `key`. Leaves a note when it cannot. */
function register(
  plan: Plan,
  project: Project,
  options: GenerateOptions,
  file: string,
  key: string,
  symbol: string,
  from: string,
): void {
  if (options.skipImport) return;
  const source = plan.read(file);
  if (source === undefined) return;
  const listed = addToArray(source, key, symbol) ?? addArrayToFeature(source, key, symbol);
  if (listed === undefined) {
    plan.note(`Could not find where to add ${symbol} in ${file}. Add it to \`${key}\` by hand.`);
    return;
  }
  plan.update(file, addImport(listed, symbol, importPath(file, from, project.importExtension)));
}

/** Registers a feature with the app: in `app.feature.ts` if there is one, else in the entry file. */
function registerFeature(
  plan: Plan,
  project: Project,
  options: GenerateOptions,
  symbol: string,
  from: string,
): void {
  if (options.skipImport) return;
  const appFeature = `${project.sourceRoot}/app.feature.ts`;
  if (plan.exists(appFeature)) {
    register(plan, project, options, appFeature, 'imports', symbol, from);
  } else if (plan.exists(project.entry)) {
    register(plan, project, options, project.entry, 'features', symbol, from);
  } else {
    plan.note(`Add ${symbol} to your app's features.`);
  }
}

function featureFile(t: Target): string {
  return `import { feature } from '@sukujs/core';

export const ${t.n.pascal}Feature = feature('${t.n.kebab}', {
  routes: [],
  services: [],
});
`;
}

function routesFile(t: Target, options: GenerateOptions): { symbol: string; content: string } {
  if (options.classless) {
    return {
      symbol: `${t.n.camel}Routes`,
      content: `import { route } from '@sukujs/core';

export const ${t.n.camel}Routes = route.group('/${t.n.kebab}', {
  list: route.get('/', {
    handle: () => [],
  }),
});
`,
    };
  }
  return {
    symbol: `${t.n.pascal}Routes`,
    content: `import { Routes, route } from '@sukujs/core';

@Routes('/${t.n.kebab}')
export class ${t.n.pascal}Routes {
  list = route.get('/', {
    handle: () => [],
  });
}
`,
  };
}

function serviceFile(t: Target, options: GenerateOptions): { symbol: string; content: string } {
  if (options.classless) {
    return {
      symbol: `${t.n.pascal}Service`,
      content: `import { service } from '@sukujs/core';

export const ${t.n.pascal}Service = service('${t.n.kebab}', () => ({
  // methods go here
}));
`,
    };
  }
  return {
    symbol: `${t.n.pascal}Service`,
    content: `import { Service } from '@sukujs/core';

@Service()
export class ${t.n.pascal}Service {}
`,
  };
}

function middlewareFile(t: Target): string {
  return `import { middleware } from '@sukujs/core';

export const ${t.n.camel} = middleware(async (ctx, next) => {
  // before the handler
  const response = await next();
  // after the handler
  return response;
});
`;
}

function resourceFiles(t: Target, project: Project): Record<string, string> {
  const ext = project.importExtension;
  const one = names(singular(t.n.kebab));
  const { kebab, pascal } = t.n;
  return {
    schemas: `import { z } from 'zod';

export const Create${one.pascal} = z.object({
  name: z.string().min(1),
});
export type Create${one.pascal} = z.infer<typeof Create${one.pascal}>;

export const Update${one.pascal} = Create${one.pascal}.partial();
export type Update${one.pascal} = z.infer<typeof Update${one.pascal}>;

export const ${one.pascal}Id = z.object({ id: z.coerce.number().int().positive() });

export interface ${one.pascal} extends Create${one.pascal} {
  id: number;
}
`,
    service: `import { NotFoundException, Service } from '@sukujs/core';
import type { Create${one.pascal}, ${one.pascal}, Update${one.pascal} } from './${kebab}.schemas${ext}';

/** Keeps ${kebab} in memory. Replace the map with a repository when you add a database. */
@Service()
export class ${pascal}Service {
  private readonly items = new Map<number, ${one.pascal}>();
  private nextId = 1;

  findAll(): ${one.pascal}[] {
    return [...this.items.values()];
  }

  findOne(id: number): ${one.pascal} {
    const item = this.items.get(id);
    if (!item) throw new NotFoundException(\`${one.pascal} \${id} not found\`);
    return item;
  }

  create(input: Create${one.pascal}): ${one.pascal} {
    const item = { id: this.nextId++, ...input };
    this.items.set(item.id, item);
    return item;
  }

  update(id: number, input: Update${one.pascal}): ${one.pascal} {
    const item = { ...this.findOne(id), ...input } as ${one.pascal};
    this.items.set(id, item);
    return item;
  }

  remove(id: number): void {
    this.findOne(id);
    this.items.delete(id);
  }
}
`,
    routes: `import { Routes, route } from '@sukujs/core';
import { Create${one.pascal}, ${one.pascal}Id, Update${one.pascal} } from './${kebab}.schemas${ext}';
import { ${pascal}Service } from './${kebab}.service${ext}';

@Routes('/${kebab}')
export class ${pascal}Routes {
  constructor(private readonly ${t.n.camel}: ${pascal}Service) {}

  list = route.get('/', {
    handle: () => this.${t.n.camel}.findAll(),
  });

  findOne = route.get('/:id', {
    params: ${one.pascal}Id,
    handle: ({ params }) => this.${t.n.camel}.findOne(params.id),
  });

  create = route.post('/', {
    body: Create${one.pascal},
    handle: ({ body }) => this.${t.n.camel}.create(body),
  });

  update = route.patch('/:id', {
    params: ${one.pascal}Id,
    body: Update${one.pascal},
    handle: ({ params, body }) => this.${t.n.camel}.update(params.id, body),
  });

  remove = route.delete('/:id', {
    params: ${one.pascal}Id,
    handle: ({ params }) => this.${t.n.camel}.remove(params.id),
  });
}
`,
    feature: `import { feature } from '@sukujs/core';
import { ${pascal}Routes } from './${kebab}.routes${ext}';
import { ${pascal}Service } from './${kebab}.service${ext}';

export const ${pascal}Feature = feature('${kebab}', {
  routes: [${pascal}Routes],
  services: [${pascal}Service],
});
`,
    test: `import { expect, test } from 'bun:test';
import { Suku } from '@sukujs/core';
import { ${pascal}Feature } from './${kebab}.feature${ext}';

const json = (method: string, path: string, body?: unknown) =>
  new Request(\`http://test\${path}\`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

test('${kebab}: create, read, update and delete', async () => {
  const app = await Suku.create({ features: [${pascal}Feature] });

  const created = await app.handle(json('POST', '/${kebab}', { name: 'First' }));
  expect(created.status).toBe(201);
  expect(await created.json()).toEqual({ id: 1, name: 'First' });

  const updated = await app.handle(json('PATCH', '/${kebab}/1', { name: 'Renamed' }));
  expect(await updated.json()).toEqual({ id: 1, name: 'Renamed' });

  expect(await (await app.handle(json('GET', '/${kebab}'))).json()).toHaveLength(1);
  expect((await app.handle(json('POST', '/${kebab}', {}))).status).toBe(400);

  expect((await app.handle(json('DELETE', '/${kebab}/1'))).status).toBe(204);
  expect((await app.handle(json('GET', '/${kebab}/1'))).status).toBe(404);
});
`,
  };
}

/** Adds the files for one schematic to `plan`, and the edits that register them. */
export function generate(
  plan: Plan,
  project: Project,
  schematic: Schematic,
  input: string,
  options: GenerateOptions = {},
): void {
  switch (schematic) {
    case 'feature': {
      const t = target(project, input, options);
      plan.create(t.file('feature'), featureFile(t));
      registerFeature(plan, project, options, `${t.n.pascal}Feature`, t.file('feature'));
      return;
    }
    case 'routes': {
      const t = target(project, input, options);
      const { symbol, content } = routesFile(t, options);
      plan.create(t.file('routes'), content);
      register(plan, project, options, t.file('feature'), 'routes', symbol, t.file('routes'));
      return;
    }
    case 'service': {
      const t = target(project, input, options);
      const { symbol, content } = serviceFile(t, options);
      plan.create(t.file('service'), content);
      register(plan, project, options, t.file('feature'), 'services', symbol, t.file('service'));
      return;
    }
    case 'middleware': {
      // A bare name goes to `middlewares/`; `admin/audit` goes next to the admin code.
      const bare = !/[\\/]/.test(input);
      const t = target(project, bare ? `middlewares/${input}` : input, options, false);
      plan.create(t.file('middleware'), middlewareFile(t));
      return;
    }
    case 'resource': {
      const t = target(project, input, options);
      const files = resourceFiles(t, project);
      for (const [suffix, content] of Object.entries(files)) {
        if (suffix === 'test' && options.skipTests) continue;
        plan.create(t.file(suffix), content);
      }
      registerFeature(plan, project, options, `${t.n.pascal}Feature`, t.file('feature'));
      if (!project.dependencies.zod) {
        plan.note('The schemas use zod, which is not in package.json. Install it: bun add zod');
      }
      return;
    }
  }
}
