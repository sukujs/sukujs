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
          'Typed routes, features and middlewares on a .NET-style dependency injection container. Zero runtime dependencies. Runs on Node and Bun.',
      },
    ],
  }),
});

const sample = `import { Routes, Suku, feature, route, singleton } from '@suku/core';
import { nodeAdapter } from '@suku/platform-node';
import { z } from 'zod';

class UsersService {
  find(id: number) {
    return { id, name: 'Ada' };
  }
}

@Routes('/users')
class UsersRoutes {
  constructor(private readonly users: UsersService) {}

  findOne = route.get('/:id', {
    params: z.object({ id: z.coerce.number() }),
    handle: ({ params }) => this.users.find(params.id),
  });

  create = route.post('/', {
    body: z.object({ name: z.string().min(2) }),
    handle: ({ body }) => ({ created: body.name }),
  });
}

const UsersFeature = feature('users', {
  routes: [UsersRoutes],
  services: [singleton(UsersService)],
});

const app = await Suku.create({
  features: [UsersFeature],
  adapter: nodeAdapter(),
});
await app.listen(3000);`;

const features: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <Workflow className="size-5" />,
    title: 'Types written once',
    body: "A route's schemas validate the request and type the handler. The path itself is checked against the params schema at compile time.",
  },
  {
    icon: <Layers className="size-5" />,
    title: 'With a class, or without',
    body: 'Group routes in a class with constructor injection, or declare them as plain values that list the services they need.',
  },
  {
    icon: <Boxes className="size-5" />,
    title: 'Dependency injection like .NET',
    body: 'One flat service collection with singleton, scoped and transient lifetimes, a scope per request, and disposal in reverse order.',
  },
  {
    icon: <ShieldCheck className="size-5" />,
    title: 'One cross-cutting concept',
    body: 'Authentication, logging, caching and CORS are all middlewares: code before next(), code after it.',
  },
  {
    icon: <Feather className="size-5" />,
    title: 'Zero runtime dependencies',
    body: 'No RxJS, no reflect-metadata, no Express. Validation works with any Standard Schema library.',
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
              Typed routes.
              <br />
              <span className="text-fd-muted-foreground">A real container.</span>
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
