import { cn } from '@/lib/cn';

/**
 * Requests per second from `benchmarks/run.ts`, rounded to the nearest thousand.
 * Keep these in step with `measured` below: they come from one run.
 */
const groups = [
  {
    runtime: 'Bun',
    rows: [
      { label: 'Raw Bun.serve', value: 88_000, suku: false },
      { label: 'Suku app', value: 87_000, suku: true },
    ],
  },
  {
    runtime: 'Node',
    rows: [
      { label: 'Raw node:http', value: 73_000, suku: false },
      { label: 'Suku app', value: 31_000, suku: true },
    ],
  },
];

export const measured =
  'Requests per second, rounded to the nearest thousand. GET /users/:id returning JSON, 64 connections, 20 seconds after a 20 second warm-up, measured with autocannon on an Apple M3 Pro laptop: Suku 0.5.0, Bun 1.4.4, Node 22. One machine, with run-to-run variation, so read it as a ratio.';

const max = Math.max(...groups.flatMap((group) => group.rows.map((row) => row.value)));
const format = new Intl.NumberFormat('en-US');

export function BenchmarkChart() {
  return (
    <div className="rounded-xl border bg-fd-card p-5 sm:p-6">
      <div className="flex flex-col gap-6">
        {groups.map((group) => (
          <div key={group.runtime}>
            <h3 className="mb-3 text-xs font-medium text-fd-muted-foreground">
              On {group.runtime}
            </h3>
            <dl className="flex flex-col gap-2.5">
              {group.rows.map((row) => (
                <div
                  key={row.label}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 sm:grid-cols-[8.5rem_1fr_5rem]"
                >
                  <dt className={cn('text-sm', row.suku && 'font-medium')}>{row.label}</dt>
                  <dd className="text-right font-mono text-sm tabular-nums sm:order-last">
                    {format.format(row.value)}
                  </dd>
                  <dd aria-hidden="true" className="col-span-2 sm:col-span-1">
                    <div
                      className={cn(
                        'h-3 rounded-[4px]',
                        row.suku ? 'bg-fd-primary' : 'bg-fd-foreground/25',
                      )}
                      style={{ width: `${(row.value / max) * 100}%` }}
                    />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      <p className="mt-6 border-t pt-4 text-xs leading-relaxed text-fd-muted-foreground">
        {measured}
      </p>
    </div>
  );
}
