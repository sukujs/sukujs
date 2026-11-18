import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import {
  type SimpleIcon,
  siApache,
  siCaddy,
  siCloudflareworkers,
  siDocker,
  siLinux,
  siNginx,
  siPm2,
  siVercel,
} from 'simple-icons';
import { cn } from '@/lib/cn';

/**
 * A brand's own mark, from Simple Icons. `brandColour: false` draws it in the text colour,
 * for marks whose own colour is too dark to read on the dark theme.
 */
function BrandIcon({
  icon,
  brandColour = true,
  className,
}: {
  icon: SimpleIcon;
  brandColour?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={icon.title}
      className={cn('size-6 shrink-0', className)}
      fill={brandColour ? `#${icon.hex}` : 'currentColor'}
    >
      <path d={icon.path} />
    </svg>
  );
}

/** The hosts the deployment guide covers. `hash` is the heading on that page. */
const targets = [
  {
    name: 'Cloudflare Workers',
    hash: 'cloudflare-workers',
    icon: siCloudflareworkers,
    brandColour: true,
    runs: 'app.handle',
    body: 'Workers already speak Fetch, so there is no adapter.',
  },
  {
    name: 'Vercel',
    hash: 'vercel',
    icon: siVercel,
    brandColour: false,
    runs: 'app.handle',
    body: 'One function passes every request to the app.',
  },
  {
    name: 'Docker Compose',
    hash: 'docker-compose',
    icon: siDocker,
    brandColour: true,
    runs: 'listen()',
    body: 'A container for reproducible deploys, beside your other services.',
  },
  {
    name: 'VPS with PM2',
    hash: 'vps-with-pm2',
    icon: siPm2,
    brandColour: false,
    runs: 'listen()',
    body: 'An always-on API under a process manager, on Node or Bun.',
  },
  {
    name: 'VPS with systemd',
    hash: 'vps-with-systemd',
    icon: siLinux,
    brandColour: false,
    runs: 'listen()',
    body: 'A unit file owns the process, restarts it and collects its logs.',
  },
];

const proxies = [
  { icon: siCaddy, brandColour: true },
  { icon: siNginx, brandColour: true },
  { icon: siApache, brandColour: true },
];

const cardClass =
  'group flex h-full flex-col rounded-xl border bg-fd-card suku-raised p-4 transition-colors hover:border-fd-primary/50';

export function DeployTargets() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {targets.map((target) => (
        <li key={target.name} className="min-w-0">
          <Link
            to="/docs/$"
            params={{ _splat: 'deployment' }}
            hash={target.hash}
            className={cardClass}
          >
            <span className="flex items-center gap-3">
              <BrandIcon icon={target.icon} brandColour={target.brandColour} />
              <span className="min-w-0 flex-1 truncate font-medium">{target.name}</span>
              <ArrowRight className="size-4 shrink-0 text-fd-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-fd-primary" />
            </span>
            <span className="mt-3 text-sm leading-relaxed text-fd-muted-foreground">
              {target.body}
            </span>
            <span className="mt-3 font-mono text-xs text-fd-muted-foreground">{target.runs}</span>
          </Link>
        </li>
      ))}
      <li className="min-w-0">
        <Link
          to="/docs/$"
          params={{ _splat: 'deployment' }}
          hash="reverse-proxy"
          className={cardClass}
        >
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-2">
              {proxies.map((proxy) => (
                <BrandIcon
                  key={proxy.icon.slug}
                  icon={proxy.icon}
                  brandColour={proxy.brandColour}
                />
              ))}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">Reverse proxy</span>
            <ArrowRight className="size-4 shrink-0 text-fd-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-fd-primary" />
          </span>
          <span className="mt-3 text-sm leading-relaxed text-fd-muted-foreground">
            Caddy, Nginx or Apache in front of a VPS, ending TLS at the proxy.
          </span>
          <span className="mt-3 font-mono text-xs text-fd-muted-foreground">127.0.0.1:3000</span>
        </Link>
      </li>
    </ul>
  );
}
