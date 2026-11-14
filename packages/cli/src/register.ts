/** Small, text-based edits that wire a generated file into an existing one. */

/** Adds `import { name } from 'from';` after the last import, unless it is already imported. */
export function addImport(source: string, name: string, from: string): string {
  const already = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`).test(source);
  if (already) return source;
  const line = `import { ${name} } from '${from}';`;
  const imports = [...source.matchAll(/^import[\s\S]*?from\s*['"][^'"]+['"];?[ \t]*$/gm)];
  const last = imports.at(-1);
  if (!last || last.index === undefined) return `${line}\n\n${source}`;
  const end = last.index + last[0].length;
  return `${source.slice(0, end)}\n${line}${source.slice(end)}`;
}

/**
 * Appends `item` to the first `key: [...]` array in `source`. Returns `undefined` when there
 * is no such array, so the caller can tell the user to register by hand.
 */
export function addToArray(source: string, key: string, item: string): string | undefined {
  const match = new RegExp(`(\\b${key}\\s*:\\s*\\[)([^\\]]*)(\\])`).exec(source);
  if (!match) return undefined;
  const [whole, open = '', body = '', close = ''] = match;
  if (new RegExp(`\\b${item}\\b`).test(body)) return source;
  let next: string;
  if (body.trim() === '') {
    next = `${open}${item}${close}`;
  } else if (body.includes('\n')) {
    const indent = /\n([ \t]*)\S/.exec(body)?.[1] ?? '    ';
    const closing = /\n([ \t]*)$/.exec(body)?.[1] ?? '';
    next = `${open}${body.trimEnd().replace(/,$/, '')},\n${indent}${item},\n${closing}${close}`;
  } else {
    next = `${open}${body.trim().replace(/,$/, '')}, ${item}${close}`;
  }
  return source.slice(0, match.index) + next + source.slice(match.index + whole.length);
}

/**
 * Adds `key: [item]` as the first property of the options object passed to `feature(...)`,
 * for a feature that does not have that array yet.
 */
export function addArrayToFeature(source: string, key: string, item: string): string | undefined {
  const match = /feature\(\s*['"][^'"]*['"]\s*,\s*\{/.exec(source);
  if (!match) return undefined;
  const at = match.index + match[0].length;
  const rest = source.slice(at);
  if (/^\s*\}/.test(rest)) return `${source.slice(0, at)} ${key}: [${item}] ${rest.trimStart()}`;
  const indent = /^\n([ \t]*)/.exec(rest)?.[1];
  return indent === undefined
    ? `${source.slice(0, at)} ${key}: [${item}],${rest}`
    : `${source.slice(0, at)}\n${indent}${key}: [${item}],${rest}`;
}
