import { useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * What `UsersRoutes` in `samples/hero.mdx` answers. The bodies are the app's real output:
 * change the sample and these together.
 */
const requests = [
  {
    path: '/users/1',
    status: '200 OK',
    note: 'The returned object is sent as JSON.',
    body: { id: 1, name: 'Ada Lovelace' },
  },
  {
    path: '/users/7',
    status: '404 Not Found',
    note: 'A thrown exception becomes its status and body.',
    body: { statusCode: 404, message: 'User 7 not found', error: 'Not Found' },
  },
  {
    path: '/users/abc',
    status: '400 Bad Request',
    note: 'The params schema rejects it before the handler runs.',
    body: {
      statusCode: 400,
      message: 'Validation failed for params',
      error: 'Bad Request',
      issues: [{ path: 'id', message: 'Invalid input: expected number, received NaN' }],
    },
  },
];

export function ResponsePanel() {
  const [selected, setSelected] = useState(0);
  const current = requests[selected]!;
  const ok = current.status.startsWith('2');

  return (
    <div className="overflow-hidden rounded-xl border bg-fd-card text-[13px]">
      <div
        role="tablist"
        aria-label="Request"
        className="flex gap-1 overflow-x-auto border-b p-1.5"
      >
        {requests.map((request, index) => (
          <button
            key={request.path}
            type="button"
            role="tab"
            aria-selected={index === selected}
            onClick={() => setSelected(index)}
            className={cn(
              'whitespace-nowrap rounded-md px-2.5 py-1.5 font-mono text-xs transition-colors',
              index === selected
                ? 'bg-fd-background text-fd-foreground shadow-xs'
                : 'text-fd-muted-foreground hover:text-fd-foreground',
            )}
          >
            <span className="text-fd-primary">GET</span> {request.path}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className={cn(
              'rounded-md border px-1.5 py-0.5 font-mono text-xs font-medium',
              ok ? 'text-fd-foreground' : 'border-fd-primary/40 text-fd-primary',
            )}
          >
            {current.status}
          </span>
          <span className="text-xs text-fd-muted-foreground">{current.note}</span>
        </div>
        <pre className="mt-3 min-h-[9.5rem] overflow-x-auto font-mono leading-relaxed">
          <code>{JSON.stringify(current.body, null, 2)}</code>
        </pre>
      </div>
    </div>
  );
}
