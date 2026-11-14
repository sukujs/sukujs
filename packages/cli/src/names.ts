import { CliError } from './errors.js';

export interface Names {
  /** `user-profiles`: file and folder names, URL prefixes. */
  kebab: string;
  /** `UserProfiles`: classes and exported features. */
  pascal: string;
  /** `userProfiles`: variables. */
  camel: string;
}

const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** Turns any spelling (`userProfiles`, `user_profiles`, `User Profiles`) into every casing. */
export function names(input: string): Names {
  const words = input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  if (words.length === 0) throw new CliError(`"${input}" is not a usable name.`);
  if (/^[0-9]/.test(words[0] as string)) {
    throw new CliError(`"${input}" starts with a digit, which is not a valid identifier.`);
  }
  const pascal = words.map(cap).join('');
  return {
    kebab: words.join('-'),
    pascal,
    camel: pascal.charAt(0).toLowerCase() + pascal.slice(1),
  };
}

/** `users` -> `user`, `categories` -> `category`, `addresses` -> `address`. Good enough for a type name. */
export function singular(word: string): string {
  if (/ies$/i.test(word)) return word.replace(/ies$/i, 'y');
  if (/(ss|x|ch|sh)es$/i.test(word)) return word.replace(/es$/i, '');
  if (/s$/i.test(word) && !/ss$/i.test(word)) return word.slice(0, -1);
  return word;
}

/** Splits `admin/users` into the folder `admin` and the name `users`. */
export function splitPath(input: string): { dir: string; name: string } {
  const parts = input.split(/[\\/]+/).filter(Boolean);
  const name = parts.pop();
  if (!name) throw new CliError('A name is required.');
  if (parts.some((part) => part === '..')) throw new CliError('The name cannot contain "..".');
  return { dir: parts.join('/'), name };
}
