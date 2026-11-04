import { describe, expect, test } from 'bun:test';
import { RouteConflictError, Router } from '../src/index.js';

const r = new Router<string>()
  .add('GET', '/', 'root')
  .add('GET', '/users', 'users.list')
  .add('POST', '/users', 'users.create')
  .add('GET', '/users/me', 'users.me')
  .add('GET', '/users/:id', 'users.get')
  .add('GET', '/users/:id/posts/:postId', 'users.post')
  .add('GET', '/users/:id/settings', 'users.settings')
  .add('GET', '/files/*path', 'files')
  .add('GET', '/static/*', 'static')
  .add('ALL', '/any', 'any')
  .add('get', '/lower', 'lower');

describe('Router', () => {
  test('static routes and the root', () => {
    expect(r.match('GET', '/')?.handler).toBe('root');
    expect(r.match('GET', '/users')?.handler).toBe('users.list');
    expect(r.match('POST', '/users')?.handler).toBe('users.create');
    expect(r.match('GET', '/lower')?.handler).toBe('lower');
  });

  test('trailing slashes and double slashes are ignored', () => {
    expect(r.match('GET', '/users/')?.handler).toBe('users.list');
    expect(r.match('GET', '//users//42//')?.handler).toBe('users.get');
    expect(r.match('GET', '')?.handler).toBe('root');
  });

  test('static beats param; params are extracted and decoded', () => {
    expect(r.match('GET', '/users/me')?.handler).toBe('users.me');
    const m = r.match('GET', '/users/42');
    expect(m?.handler).toBe('users.get');
    expect(m?.params).toEqual({ id: '42' });
    expect(r.match('GET', '/users/a%20b')?.params).toEqual({ id: 'a b' });
    expect(r.match('GET', '/users/%E0%A4%A')?.params).toEqual({ id: '%E0%A4%A' }); // bad escape kept raw
    expect(r.match('GET', '/users/7/posts/9')?.params).toEqual({ id: '7', postId: '9' });
  });

  test('backtracks from a static dead end into the param branch', () => {
    // "/users/me" exists statically but has no "/settings" child; ":id/settings" does.
    const m = r.match('GET', '/users/me/settings');
    expect(m?.handler).toBe('users.settings');
    expect(m?.params).toEqual({ id: 'me' });
  });

  test('wildcards capture the rest, including zero segments', () => {
    expect(r.match('GET', '/files/a/b/c.txt')?.params).toEqual({ path: 'a/b/c.txt' });
    expect(r.match('GET', '/files')?.params).toEqual({ path: '' });
    expect(r.match('GET', '/static/x.js')?.params).toEqual({ '*': 'x.js' });
  });

  test('HEAD falls back to GET; ALL matches any method after specific trees', () => {
    expect(r.match('HEAD', '/users')?.handler).toBe('users.list');
    expect(r.match('DELETE', '/any')?.handler).toBe('any');
    expect(r.match('PATCH', '/any')?.handler).toBe('any');
  });

  test('misses return null and allowedMethods supports 405', () => {
    expect(r.match('GET', '/nope')).toBeNull();
    expect(r.match('DELETE', '/users')).toBeNull();
    expect(r.allowedMethods('/users')).toEqual(['GET', 'HEAD', 'POST']);
    expect(r.allowedMethods('/nope')).toEqual([]);
  });

  test('duplicate and malformed routes throw', () => {
    expect(() => new Router().add('GET', '/a', 1).add('GET', '/a/', 2)).toThrow(RouteConflictError);
    expect(() => new Router().add('GET', '/:a', 1).add('GET', '/:b', 2)).toThrow(/conflicts/);
    expect(() => new Router().add('GET', '/*/x', 1)).toThrow(/last segment/);
    expect(() => new Router().add('GET', '/:', 1)).toThrow(/Empty parameter/);
    expect(r.size).toBe(11);
  });

  test('wildcard only applies when no param or static branch matched deeper', () => {
    const x = new Router<string>().add('GET', '/a/:b', 'param').add('GET', '/a/*', 'wild');
    expect(x.match('GET', '/a/1')?.handler).toBe('param');
    expect(x.match('GET', '/a/1/2')?.handler).toBe('wild');
    expect(x.match('GET', '/a')?.handler).toBe('wild');
  });
});
