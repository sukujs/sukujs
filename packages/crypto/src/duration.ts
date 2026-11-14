import { CryptoError } from './errors.js';

/** Seconds as a number, or a string such as `30s`, `15m`, `12h`, `7d`, `2w`. */
export type Duration = number | `${number}${'s' | 'm' | 'h' | 'd' | 'w'}`;

const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

export function toSeconds(duration: Duration): number {
  if (typeof duration === 'number') {
    if (!Number.isFinite(duration) || duration < 0)
      throw new CryptoError('invalid_input', `Invalid duration: ${duration}`);
    return Math.floor(duration);
  }
  const match = /^(\d+(?:\.\d+)?)([smhdw])$/.exec(duration);
  if (!match)
    throw new CryptoError(
      'invalid_input',
      `Invalid duration "${duration}". Use seconds or a string like "15m".`,
    );
  return Math.floor(Number(match[1]) * UNITS[match[2]!]!);
}
