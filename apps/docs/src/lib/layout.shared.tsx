import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, gitConfig } from './shared';

/**
 * The Suku mark: a two-by-two grid with three tiles placed and the fourth slot left empty.
 * Neutral tiles follow the text colour; the accent tile follows the theme's primary colour.
 */
export function SukuMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect x="1" y="1" width="14" height="14" rx="4" fill="currentColor" />
      <rect x="1" y="17" width="14" height="14" rx="4" fill="currentColor" />
      <rect x="17" y="17" width="14" height="14" rx="4" className="fill-fd-primary" />
    </svg>
  );
}

/** The mark and the drawn lowercase wordmark, as one lockup. Sized by its height. */
export function SukuLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 32" role="img" aria-label={appName} className={className}>
      <defs>
        <clipPath id="suku-k">
          <rect x="80" y="10" width="24" height="20" />
        </clipPath>
      </defs>
      <rect x="1" y="1" width="14" height="14" rx="4" fill="currentColor" />
      <rect x="1" y="17" width="14" height="14" rx="4" fill="currentColor" />
      <rect x="17" y="17" width="14" height="14" rx="4" className="fill-fd-primary" />
      <g fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="round">
        <path d="M56 12.5H49.25a3.75 3.75 0 0 0 0 7.5h2.5a3.75 3.75 0 0 1 0 7.5H45" />
        <path d="M64.5 10v12a5.5 5.5 0 0 0 11 0M75.5 10v20" />
        <path d="M85.5 2v28" />
        <path d="M97.5 8L87 20.5 98.5 33" clipPath="url(#suku-k)" />
        <path d="M105.5 10v12a5.5 5.5 0 0 0 11 0M116.5 10v20" />
      </g>
    </svg>
  );
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <SukuLogo className="h-5 w-auto" />,
    },
    links: [{ text: 'Documentation', url: '/docs', active: 'nested-url' }],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
