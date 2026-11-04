/**
 * Extracts the pathname from an absolute URL string without allocating a `URL`.
 * `http://h/a/b?x=1#f` -> `/a/b`. Returns `/` when the URL has no path.
 */
export function pathnameOf(url: string): string {
  const schemeEnd = url.indexOf('://');
  const start = url.indexOf('/', schemeEnd === -1 ? 0 : schemeEnd + 3);
  if (start === -1) return '/';
  let end = url.length;
  for (let i = start; i < url.length; i++) {
    const c = url.charCodeAt(i);
    if (c === 63 /* ? */ || c === 35 /* # */) {
      end = i;
      break;
    }
  }
  return url.slice(start, end);
}
