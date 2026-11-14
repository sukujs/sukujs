import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, gitConfig } from './shared';

function Logo() {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <rect width="24" height="24" rx="6" className="fill-fd-primary" />
        <path
          d="M15.5 8.2c-.7-.9-1.9-1.4-3.4-1.4-2.1 0-3.6 1-3.6 2.7 0 3.6 7 1.6 7 5 0 1.7-1.6 2.7-3.7 2.7-1.7 0-3-.6-3.8-1.6"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          className="stroke-fd-primary-foreground"
        />
      </svg>
      {appName}
    </span>
  );
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <Logo />,
    },
    links: [{ text: 'Documentation', url: '/docs', active: 'nested-url' }],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
