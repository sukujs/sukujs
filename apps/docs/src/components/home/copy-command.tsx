import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

/** A shell command on one line, with a button that copies it. */
export function CopyCommand({ command, className }: { command: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div
      className={cn(
        'flex max-w-full items-center gap-1 rounded-lg border bg-fd-card suku-raised py-1 pl-4 pr-1 font-mono text-[13px]',
        className,
      )}
    >
      <span aria-hidden="true" className="select-none text-fd-primary">
        $
      </span>
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-2 py-1.5 [scrollbar-width:none]">
        {command}
      </code>
      <button
        type="button"
        aria-label={copied ? 'Copied' : 'Copy command'}
        onClick={() => {
          void navigator.clipboard.writeText(command).then(() => setCopied(true));
        }}
        className="rounded-md p-2 text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}
