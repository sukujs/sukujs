/** Adds a value to the `Vary` header without duplicating it. */
export function appendVary(headers: Headers, value: string): void {
  const current = headers.get('vary');
  if (!current) {
    headers.set('vary', value);
    return;
  }
  if (current === '*') return;
  const existing = current.split(',').map((v) => v.trim().toLowerCase());
  if (!existing.includes(value.toLowerCase())) headers.set('vary', `${current}, ${value}`);
}

/**
 * Returns a response whose headers can be changed. Responses from `fetch()` or
 * `Response.redirect()` have immutable headers, so those are copied.
 */
export function mutable(response: Response): Response {
  try {
    response.headers.set('x-suku-probe', '1');
    response.headers.delete('x-suku-probe');
    return response;
  } catch {
    return new Response(response.body, response);
  }
}

export type OriginRule = string | RegExp;

export function matchesOrigin(origin: string, rules: readonly OriginRule[]): boolean {
  return rules.some((rule) => (typeof rule === 'string' ? rule === origin : rule.test(origin)));
}

/** Seconds as a number, or a string such as `30s`, `15m`, `1h`, `1d`. */
export type Duration = number | `${number}${'s' | 'm' | 'h' | 'd'}`;

const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

export function toSeconds(duration: Duration): number {
  if (typeof duration === 'number') {
    if (!Number.isFinite(duration) || duration <= 0)
      throw new TypeError(`Invalid duration: ${duration}`);
    return duration;
  }
  const match = /^(\d+(?:\.\d+)?)([smhd])$/.exec(duration);
  if (!match)
    throw new TypeError(`Invalid duration "${duration}". Use seconds or a string like "15m".`);
  return Number(match[1]) * UNITS[match[2]!]!;
}
