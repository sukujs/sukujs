import { createFileRoute, Link } from '@tanstack/react-router';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { Boxes, Feather, Gauge, Layers, ShieldCheck, Workflow } from 'lucide-react';
import type { ReactNode } from 'react';
import { baseOptions } from '@/lib/layout.shared';
import { gitConfig } from '@/lib/shared';

export const Route = createFileRoute('/')({
  component: Home,
  head: () => ({
    meta: [
      { title: 'Suku — a lightweight TypeScript backend framework' },
      {
        name: 'description',
        content:
          'NestJS-shaped structure on a .NET-style dependency injection container. Zero runtime dependencies. Runs on Node and Bun.',
      },
    ],
  }),
});

const sample = `import { Body, Controller, Get, Param, Post, Suku, defineModule, singleton } from '@suku/core';
import { Injectable } from '@suku/di';
import { nodeAdapter } from '@suku/platform-node';

@Injectable()
class UsersService {
  find(id: string) {
    return { id, name: 'Ada' };
  }
}

@Controller('users')
class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get(':id')
  get(@Param('id') id: string) {
    return this.users.find(id);
  }

  @Post()
  create(@Body(CreateUser) dto: CreateUser) {
    return dto;
  }
}

const UsersModule = defineModule({
  controllers: [UsersController],
  services: [singleton(UsersService)],
});

const app = await Suku.create({ imports: [UsersModule], adapter: nodeAdapter() });
await app.listen(3000);`;

const features: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <Boxes className="size-5" />,
    title: 'Dependency injection like .NET',
    body: 'One flat service collection with singleton, scoped and transient lifetimes, a scope per request, and disposal in reverse order.',
  },
  {
    icon: <Layers className="size-5" />,
    title: 'Structure you already know',
    body: 'Controllers, route and parameter decorators, guards, interceptors, pipes and filters, in the order NestJS taught you.',
  },
  {
    icon: <ShieldCheck className="size-5" />,
    title: 'Typed modules, not empty classes',
    body: 'defineModule() returns a plain object. singleton(Logger, ConsoleLogger) fails to compile if the implementation does not fit.',
  },
  {
    icon: <Feather className="size-5" />,
    title: 'Zero runtime dependencies',
    body: 'No RxJS, no reflect-metadata, no Express. The container is 13 KB and the whole core is 24 KB minified.',
  },
  {
    icon: <Workflow className="size-5" />,
    title: 'Bring your own schema',
    body: 'Validation runs through Standard Schema, so Zod, Valibot and ArkType plug into @Body(schema) with no adapter.',
  },
  {
    icon: <Gauge className="size-5" />,
    title: 'Web-standard core',
    body: 'The kernel speaks Fetch Request and Response. On Bun the full framework runs at parity with raw Bun.serve.',
  },
];

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-16 px-4 py-14 md:py-20">
        <section className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <p className="mb-4 inline-flex rounded-full border bg-fd-card px-3 py-1 text-xs font-medium text-fd-muted-foreground">
              Pre-release · Node 22+ and Bun
            </p>
            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
              The shape of NestJS.
              <br />
              <span className="text-fd-muted-foreground">The container of .NET.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-fd-muted-foreground">
              Suku is a lightweight TypeScript backend framework: decorated controllers and a
              familiar request pipeline, on a dependency injection container with real lifetimes and
              scopes. No runtime dependencies.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/docs/$"
                params={{ _splat: 'getting-started' }}
                className="rounded-lg bg-fd-primary px-4 py-2.5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
              >
                Get started
              </Link>
              <a
                href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
                className="rounded-lg border bg-fd-card px-4 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent"
              >
                View on GitHub
              </a>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border bg-fd-card shadow-sm">
            <div className="border-b px-4 py-2 text-xs text-fd-muted-foreground">main.ts</div>
            <pre className="max-h-[460px] overflow-auto p-4 text-[12.5px] leading-relaxed">
              <code>{sample}</code>
            </pre>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border bg-fd-card p-5">
              <div className="mb-3 inline-flex rounded-lg border bg-fd-background p-2 text-fd-primary">
                {f.icon}
              </div>
              <h2 className="mb-1.5 font-medium">{f.title}</h2>
              <p className="text-sm leading-relaxed text-fd-muted-foreground">{f.body}</p>
            </div>
          ))}
        </section>
      </main>
    </HomeLayout>
  );
}
