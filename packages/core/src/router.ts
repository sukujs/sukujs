/**
 * Radix-tree router. One tree per HTTP method; `HEAD` falls back to `GET`, and routes
 * registered with method `ALL` match any method after the specific trees miss.
 *
 * Segment precedence is static > `:param` > `*wildcard`, with backtracking: if a
 * static branch matches a segment but dead-ends deeper, the param branch is tried.
 */

export interface RouteMatch<T> {
  readonly handler: T;
  readonly params: Record<string, string>;
}

interface Leaf<T> {
  handler: T;
  paramNames: string[];
  pattern: string;
}

class RadixNode<T> {
  statics: Map<string, RadixNode<T>> | null = null;
  param: RadixNode<T> | null = null;
  wildcard: RadixNode<T> | null = null;
  leaf: Leaf<T> | null = null;
}

export const ALL_METHODS = 'ALL';

export class RouteConflictError extends Error {
  override readonly name = 'RouteConflictError';
}

function splitPath(path: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i <= path.length; i++) {
    if (i === path.length || path.charCodeAt(i) === 47 /* / */) {
      if (i > start) out.push(path.slice(start, i));
      start = i + 1;
    }
  }
  return out;
}

function decode(value: string): string {
  if (value.indexOf('%') === -1) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export class Router<T> {
  private readonly trees = new Map<string, RadixNode<T>>();
  private count = 0;

  get size(): number {
    return this.count;
  }

  /**
   * Registers a route. `path` uses `:name` for a single segment and `*` or `*name` for a
   * trailing catch-all (which also matches zero segments). Throws on duplicates.
   */
  add(method: string, path: string, handler: T): this {
    const m = method.toUpperCase();
    let node = this.trees.get(m);
    if (!node) this.trees.set(m, (node = new RadixNode<T>()));

    const paramNames: string[] = [];
    const segments = splitPath(path);
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      if (seg.charCodeAt(0) === 58 /* : */) {
        const name = seg.slice(1);
        if (!name) throw new RouteConflictError(`Empty parameter name in route ${m} ${path}`);
        paramNames.push(name);
        if (!node.param) node.param = new RadixNode<T>();
        node = node.param;
      } else if (seg.charCodeAt(0) === 42 /* * */) {
        if (i !== segments.length - 1) {
          throw new RouteConflictError(`Wildcard must be the last segment in route ${m} ${path}`);
        }
        paramNames.push(seg.length > 1 ? seg.slice(1) : '*');
        if (!node.wildcard) node.wildcard = new RadixNode<T>();
        node = node.wildcard;
      } else {
        if (!node.statics) node.statics = new Map();
        let child = node.statics.get(seg);
        if (!child) node.statics.set(seg, (child = new RadixNode<T>()));
        node = child;
      }
    }

    if (node.leaf) {
      throw new RouteConflictError(
        `Route ${m} ${path} conflicts with already registered ${m} ${node.leaf.pattern}`,
      );
    }
    node.leaf = { handler, paramNames, pattern: path };
    this.count++;
    return this;
  }

  /** Matches a method and pathname (no query string). Returns `null` when nothing matches. */
  match(method: string, pathname: string): RouteMatch<T> | null {
    const m = method.toUpperCase();
    const segments = splitPath(pathname);
    return (
      this.matchIn(m, segments) ??
      (m === 'HEAD' ? this.matchIn('GET', segments) : null) ??
      this.matchIn(ALL_METHODS, segments)
    );
  }

  /** Methods that have a route for the pathname. Used to answer 405 after a miss. */
  allowedMethods(pathname: string): string[] {
    const segments = splitPath(pathname);
    const out: string[] = [];
    for (const method of this.trees.keys()) {
      if (method === ALL_METHODS) continue;
      if (this.matchIn(method, segments)) out.push(method);
    }
    if (out.includes('GET') && !out.includes('HEAD')) out.push('HEAD');
    return out.sort();
  }

  private matchIn(method: string, segments: string[]): RouteMatch<T> | null {
    const root = this.trees.get(method);
    if (!root) return null;
    const values: string[] = [];
    const leaf = walk(root, segments, 0, values);
    if (!leaf) return null;
    const params: Record<string, string> = {};
    for (let i = 0; i < leaf.paramNames.length; i++) {
      params[leaf.paramNames[i]!] = decode(values[i] ?? '');
    }
    return { handler: leaf.handler, params };
  }
}

function walk<T>(
  node: RadixNode<T>,
  segments: string[],
  i: number,
  values: string[],
): Leaf<T> | null {
  if (i === segments.length) {
    if (node.leaf) return node.leaf;
    if (node.wildcard?.leaf) {
      values.push('');
      return node.wildcard.leaf;
    }
    return null;
  }
  const seg = segments[i]!;
  if (node.statics) {
    const child = node.statics.get(seg);
    if (child) {
      const found = walk(child, segments, i + 1, values);
      if (found) return found;
    }
  }
  if (node.param) {
    values.push(seg);
    const found = walk(node.param, segments, i + 1, values);
    if (found) return found;
    values.pop();
  }
  if (node.wildcard?.leaf) {
    values.push(segments.slice(i).join('/'));
    return node.wildcard.leaf;
  }
  return null;
}
