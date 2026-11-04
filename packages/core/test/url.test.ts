import { expect, test } from 'bun:test';
import { pathnameOf } from '../src/index.js';

test('pathnameOf', () => {
  expect(pathnameOf('http://h/a/b?x=1#f')).toBe('/a/b');
  expect(pathnameOf('http://h:8080/')).toBe('/');
  expect(pathnameOf('http://h')).toBe('/');
  expect(pathnameOf('https://h/a#frag')).toBe('/a');
  expect(pathnameOf('http://h/a?')).toBe('/a');
  for (const u of ['http://x.y/users/42?q=1', 'http://[::1]:3000/p/q', 'http://h/%20x'])
    expect(pathnameOf(u)).toBe(new URL(u).pathname);
});
