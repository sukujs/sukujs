import { createFileRoute, Link } from '@tanstack/react-router';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { BenchmarkChart } from '@/components/home/benchmark-chart';
import { CopyCommand } from '@/components/home/copy-command';
import { ResponsePanel } from '@/components/home/response-panel';
import HeroSample from '@/components/home/samples/hero.mdx';
import OpenapiSample from '@/components/home/samples/openapi.mdx';
import RoutesSample from '@/components/home/samples/routes.mdx';
import ServicesSample from '@/components/home/samples/services.mdx';
import ValidationSample from '@/components/home/samples/validation.mdx';
import { getMDXComponents } from '@/components/mdx';
import { cn } from '@/lib/cn';
import { baseOptions } from '@/lib/layout.shared';
import { changelogUrl, repoUrl, version } from '@/lib/shared';

export const Route = createFileRoute('/')({
  component: Home,
  head: () => ({
    meta: [
      { title: 'Suku: a TypeScript backend framework with room to spare' },
      {
        name: 'description',
        content:
          'Typed routes, features and middlewares on a dependency injection container with real lifetimes. Zero runtime dependencies. Runs on Node and Bun.',
      },
    ],
  }),
});

const installCommand = 'bun add @sukujs/core @sukujs/platform-bun zod';
const createCommand = 'bunx @sukujs/cli new my-api';

const mdxComponents = getMDXComponents();

/** A code sample compiled from MDX, so it is highlighted exactly like the docs pages. */
function Sample({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'min-w-0 text-sm [&_figure]:my-0 [&_figure+figure]:mt-3 [&>div+figure]:mt-3 [&>div]:my-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

function DocsLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to="/docs/$"
      params={{ _splat: to }}
      className="group inline-flex items-center gap-1.5 text-sm font-medium text-fd-primary"
    >
      {children}
      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/** Rounded tiles in the spirit of the mark, fading out towards the text. */
function TileBackdrop() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 size-full text-fd-foreground opacity-[0.045] [mask-image:radial-gradient(ellipse_70%_80%_at_85%_0%,black,transparent)]"
    >
      <defs>
        <pattern id="home-tiles" width="44" height="44" patternUnits="userSpaceOnUse">
          <rect x="2" y="2" width="40" height="40" rx="10" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#home-tiles)" />
    </svg>
  );
}

function Hero() {
  return (
    <section className="relative isolate border-b">
      <TileBackdrop />
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-14 md:py-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="min-w-0">
          <a
            href={changelogUrl}
            className="mb-6 inline-flex items-center gap-2 rounded-full border bg-fd-card px-3 py-1 text-xs font-medium text-fd-muted-foreground transition-colors hover:text-fd-foreground"
          >
            <span className="size-1.5 rounded-[2px] bg-fd-primary" />
            Suku {version} · Node 22+ and Bun
          </a>
          <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
            A TypeScript backend framework with room to spare
            <span className="text-fd-primary">.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-fd-muted-foreground">
            Four ideas: routes, features, middlewares and services. Routes are typed by their
            schemas, and services come from a container with real lifetimes. Zero runtime
            dependencies.
          </p>
          <CopyCommand command={installCommand} className="mt-8 w-fit" />
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              to="/docs/$"
              params={{ _splat: 'getting-started' }}
              className="suku-btn suku-btn-primary"
            >
              Getting started
            </Link>
            <a href={repoUrl} className="suku-btn suku-btn-secondary">
              GitHub
              <ArrowUpRight className="size-4 text-fd-muted-foreground" />
            </a>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <Sample>
            <HeroSample components={mdxComponents} />
          </Sample>
          <ResponsePanel />
        </div>
      </div>
    </section>
  );
}

function Proof() {
  return (
    <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-16 md:py-24 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="min-w-0">
        <p className="mb-3 text-sm font-medium text-fd-primary">Performance</p>
        <h2 className="text-3xl font-semibold tracking-tight text-balance">
          On Bun, the framework keeps pace with a raw server.
        </h2>
        <p className="mt-4 text-fd-muted-foreground">
          The kernel speaks Fetch <code className="font-mono text-[0.9em]">Request</code> and{' '}
          <code className="font-mono text-[0.9em]">Response</code>, which Bun&apos;s server already
          uses, so requests pass straight through. Node has its own request types, and building the
          Fetch objects for every call is where the throughput goes.
        </p>
        <div className="mt-6">
          <DocsLink to="performance">How it was measured</DocsLink>
        </div>
      </div>
      <BenchmarkChart />
    </section>
  );
}

interface FeatureProps {
  label: string;
  title: string;
  body: ReactNode;
  points?: ReactNode[];
  link: { to: string; text: string };
  flip?: boolean;
  children: ReactNode;
}

function Feature({ label, title, body, points, link, flip, children }: FeatureProps) {
  return (
    <section className="mx-auto grid w-full max-w-6xl items-start gap-8 px-4 py-12 md:py-16 lg:grid-cols-2 lg:gap-14">
      <div className={cn('min-w-0 lg:sticky lg:top-24', flip && 'lg:order-last')}>
        <p className="mb-3 text-sm font-medium text-fd-primary">{label}</p>
        <h2 className="text-3xl font-semibold tracking-tight text-balance">{title}</h2>
        <p className="mt-4 text-fd-muted-foreground">{body}</p>
        {points && (
          <ul className="mt-5 flex flex-col gap-2.5 text-sm">
            {points.map((point, index) => (
              <li key={index} className="flex gap-3">
                <span className="mt-[0.45rem] size-2 shrink-0 rounded-[3px] bg-fd-foreground/30" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-6">
          <DocsLink to={link.to}>{link.text}</DocsLink>
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

const openapiRoutes = [
  { path: 'GET /openapi.json', serves: 'The OpenAPI 3.1 document.' },
  { path: 'GET /docs', serves: 'A UI that renders it: Swagger UI, Scalar or Redoc.' },
];

function Mono({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[0.9em]">{children}</code>;
}

function Features() {
  return (
    <div className="border-y bg-fd-muted/40 py-6 md:py-10">
      <Feature
        label="Routes"
        title="A route is a typed value, with a class or without one."
        body="Group routes in a class that receives its services through the constructor, or declare them as plain values that list the services they need. Both make the same kind of route, and they mix freely."
        points={[
          <>
            The path is read at compile time. A <Mono>params</Mono> schema must cover every
            parameter in it.
          </>,
          'Return an object and it is sent as JSON.',
          'Plain routes need no decorators, so on Node they run without a compile step.',
        ]}
        link={{ to: 'routes', text: 'Routes' }}
      >
        <Sample>
          <RoutesSample components={mdxComponents} />
        </Sample>
      </Feature>

      <Feature
        flip
        label="Dependency injection"
        title="Services with lifetimes, and a scope for every request."
        body="You never write new UsersService() yourself. Register a service once with the lifetime it should have, and the container hands it to every route or service that asks. Mistakes in the graph stop the app at startup, not in production."
        points={[
          'A scope opens for every request and closes when it ends.',
          <>
            A service with a <Mono>dispose()</Mono> method is cleaned up for you, newest first.
          </>,
        ]}
        link={{ to: 'dependency-injection', text: 'Services' }}
      >
        <Sample>
          <ServicesSample components={mdxComponents} />
        </Sample>
      </Feature>

      <Feature
        label="Validation"
        title="Write the schema once. It validates and it types."
        body={
          <>
            Suku validates through Standard Schema, so Zod, Valibot and ArkType work without
            adapters, and Suku depends on none of them. The handler is typed from the schema&apos;s
            output. Invalid input never reaches it.
          </>
        }
        link={{ to: 'validation', text: 'Validation' }}
      >
        <Sample>
          <ValidationSample components={mdxComponents} />
        </Sample>
      </Feature>

      <Feature
        flip
        label="OpenAPI"
        title="API docs generated from the routes you already have."
        body={
          <>
            <Mono>@sukujs/openapi</Mono> reads the routes your app serves and builds the document
            from their schemas, so the docs and the validation cannot drift apart. One entry in{' '}
            <Mono>routes</Mono> serves it with Swagger UI, Scalar or Redoc.
          </>
        }
        link={{ to: 'openapi', text: 'OpenAPI' }}
      >
        <Sample>
          <OpenapiSample components={mdxComponents} />
        </Sample>
        <dl className="mt-3 divide-y rounded-xl border bg-fd-card text-sm">
          {openapiRoutes.map((item) => (
            <div key={item.path} className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-3">
              <dt className="w-40 font-mono text-[13px]">{item.path}</dt>
              <dd className="text-fd-muted-foreground">{item.serves}</dd>
            </div>
          ))}
        </dl>
      </Feature>
    </div>
  );
}

const packages = [
  {
    name: 'core',
    docs: '',
    body: 'Routes, features, middlewares, validation, config and a logger.',
  },
  {
    name: 'di',
    docs: 'dependency-injection',
    body: 'The container: lifetimes, scopes and disposal. Usable on its own, without HTTP.',
  },
  {
    name: 'crypto',
    docs: 'crypto',
    body: 'JWT, password hashing, signed and encrypted values. Works on its own.',
  },
  {
    name: 'security',
    docs: 'security',
    body: 'CORS, security headers, CSRF protection and rate limiting, as middlewares.',
  },
  {
    name: 'graphql',
    docs: 'graphql',
    body: 'Class-based GraphQL resolvers with injection and typed arguments.',
  },
  {
    name: 'openapi',
    docs: 'openapi',
    body: 'An OpenAPI document from your routes, with Swagger UI, Scalar or Redoc.',
  },
  {
    name: 'observability',
    docs: 'observability',
    body: 'Traces, logs, errors and metrics over OpenTelemetry, to any OTLP endpoint.',
  },
  {
    name: 'cli',
    docs: 'cli',
    body: 'The suku command: create a project, generate code, run, build and start.',
  },
  {
    name: 'platform-bun',
    docs: 'platforms',
    body: 'The adapter for Bun.serve.',
  },
  {
    name: 'platform-node',
    docs: 'platforms',
    body: 'The adapter for node:http.',
  },
];

function Packages() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 md:py-24">
      <div className="max-w-2xl">
        <p className="mb-3 text-sm font-medium text-fd-primary">Packages</p>
        <h2 className="text-3xl font-semibold tracking-tight text-balance">
          Install what you use. Leave the rest out.
        </h2>
        <p className="mt-4 text-fd-muted-foreground">
          Everything beyond the core is its own package, and an app that does not use one installs
          nothing for it.
        </p>
      </div>
      <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {packages.map((item) => (
          <li key={item.name} className="min-w-0">
            <Link
              to="/docs/$"
              params={{ _splat: item.docs }}
              className="group flex h-full flex-col rounded-xl border bg-fd-card p-4 transition-colors hover:border-fd-primary/50"
            >
              <span className="flex items-center justify-between gap-2 font-mono text-[13px]">
                <span className="truncate">
                  <span className="text-fd-muted-foreground">@sukujs/</span>
                  {item.name}
                </span>
                <ArrowRight className="size-4 shrink-0 text-fd-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-fd-primary" />
              </span>
              <span className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">
                {item.body}
              </span>
            </Link>
          </li>
        ))}
        <li className="flex min-w-0 flex-col justify-center rounded-xl border border-dashed p-4 sm:col-span-2">
          <span className="text-sm font-medium">One version for all of them</span>
          <span className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">
            Every package is released together as Suku {version}, so any set of them installed at
            one version works together.
          </span>
        </li>
      </ul>
    </section>
  );
}

function Closing() {
  return (
    <section className="border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-4 py-16 md:flex-row md:items-center md:justify-between md:py-20">
        <div className="min-w-0">
          <h2 className="text-3xl font-semibold tracking-tight">Start with one route.</h2>
          <p className="mt-3 max-w-xl text-fd-muted-foreground">
            The CLI creates a project with tests, config and a health route. Or add the packages to
            an app you already have.
          </p>
        </div>
        <div className="flex min-w-0 max-w-full flex-col gap-3">
          <CopyCommand command={createCommand} />
          <DocsLink to="getting-started">Read the getting started guide</DocsLink>
        </div>
      </div>
    </section>
  );
}

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="flex w-full flex-1 flex-col">
        <Hero />
        <Proof />
        <Features />
        <Packages />
        <Closing />
      </main>
    </HomeLayout>
  );
}
