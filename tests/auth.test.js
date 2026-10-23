import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

describe('HTTP auth API', () => {
  let app;
  before(async () => {
    app = await startServer();
  });
  after(() => app.close());

  it('reports health', async () => {
    const res = await fetch(`${app.baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).store, 'memory');
  });

  it('registers a user and sets an httpOnly session cookie', async () => {
    const { res, body } = await app.post('/api/auth/register', { username: 'budi', password: 'rahasia123' });
    assert.equal(res.status, 201);
    assert.equal(body.user.username, 'budi');
    assert.equal(body.user.passwordHash, undefined);
    const cookie = res.headers.get('set-cookie');
    assert.match(cookie, /chat_token=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
  });

  it('rejects duplicate usernames case-insensitively', async () => {
    const { res } = await app.post('/api/auth/register', { username: 'BUDI', password: 'rahasia123' });
    assert.equal(res.status, 409);
  });

  it('validates input', async () => {
    assert.equal((await app.post('/api/auth/register', { username: 'a', password: 'rahasia123' })).res.status, 400);
    assert.equal((await app.post('/api/auth/register', { username: 'valid_name', password: 'short' })).res.status, 400);
    assert.equal((await app.post('/api/auth/register', '{bad json')).res.status, 400);
  });

  it('logs in with correct credentials only', async () => {
    assert.equal((await app.post('/api/auth/login', { username: 'budi', password: 'salah12345' })).res.status, 401);
    assert.equal((await app.post('/api/auth/login', { username: 'nobody', password: 'rahasia123' })).res.status, 401);
    const { res, body } = await app.post('/api/auth/login', { username: 'Budi', password: 'rahasia123' });
    assert.equal(res.status, 200);
    assert.equal(body.user.username, 'budi');
  });

  it('returns the current user from the cookie', async () => {
    const { cookie } = await app.register('siti');
    const res = await fetch(`${app.baseUrl}/api/auth/me`, { headers: { cookie } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).user.username, 'siti');
    assert.equal((await fetch(`${app.baseUrl}/api/auth/me`)).status, 401);
  });

  it('clears the cookie on logout', async () => {
    const { res } = await app.post('/api/auth/logout', {});
    assert.equal(res.status, 204);
    assert.match(res.headers.get('set-cookie'), /chat_token=;/);
  });

  it('serves the frontend with security headers', async () => {
    const res = await fetch(`${app.baseUrl}/login.html`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});
