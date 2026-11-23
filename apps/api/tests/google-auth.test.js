import { createHash, createSign, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OAuth2Client } from 'google-auth-library';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { SESSION_COOKIE_NAME, createAuth } from '../src/auth.js';
import { validateCatalog } from '../src/catalog.js';
import { ConfigError, GOOGLE_CALLBACK_PATH, loadGoogleConfig } from '../src/config.js';
import { migrate, openDatabase } from '../src/db.js';
import { ATTEMPT_TTL_MS } from '../src/google-auth.js';
import { GOOGLE_AUTHORIZATION_ENDPOINT, GoogleAuthError, createGoogleProvider } from '../src/google.js';
import { createAccountStore } from '../src/identities.js';
import { validCatalog } from './fixtures.js';

// Flujo OIDC con DB temporal y cliente Google simulado (sin red ni credenciales
// reales). La verificación real de firma/iss/aud/exp de google-auth-library se
// prueba aparte con una clave RSA local. Esto NO es una prueba viva con Google.
const ORIGIN = 'http://127.0.0.1:5573';
const REDIRECT = `${ORIGIN}${GOOGLE_CALLBACK_PATH}`;
const CLIENT_ID = 'cliente-de-prueba.apps.googleusercontent.com';
const SECRET = randomBytes(32).toString('hex');
const PASSWORD = 'una contraseña larga y segura';
const fakeHash = (password) => `$argon2id$v=19$test$${Buffer.from(password, 'utf8').toString('base64')}`;
const fakeHasher = {
  hash: async (password) => fakeHash(password),
  verify: async (password, encoded) => encoded === fakeHash(password),
  verifyDummy: async () => false,
};
const catalog = validateCatalog(validCatalog(), { today: '2026-11-20' });
const s256 = (v) => createHash('sha256').update(v).digest('base64url');

let dir;
let clock;
const opened = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nomoresaas-google-'));
  clock = Date.parse('2026-11-22T10:00:00.000Z');
});

afterEach(() => {
  for (const { auth, db } of opened.splice(0)) {
    auth.close();
    if (db.isOpen) db.close();
  }
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Cliente OAuth simulado: getToken comprueba el verifier PKCE contra el
 * challenge emitido y devuelve un ID token opaco; verifyIdToken devuelve las
 * claims configuradas por la prueba (o lanza).
 */
function fakeClient() {
  const state = { challenge: null, claims: null, failExchange: false, failVerify: false, calls: 0, tokens: [], gate: null };
  return {
    state,
    async getToken({ code, codeVerifier, redirect_uri: redirectUri }) {
      state.calls += 1;
      if (state.gate) await state.gate; // canje diferido para reproducir carreras
      if (state.failExchange) throw new Error(`invalid_grant para ${code}`);
      if (redirectUri !== REDIRECT || s256(codeVerifier) !== state.challenge) throw new Error('pkce');
      const idToken = `id-token-${randomBytes(8).toString('hex')}`;
      state.tokens.push(idToken, code);
      return { tokens: { id_token: idToken, access_token: `access-${code}`, refresh_token: 'refresh-x' } };
    },
    async verifyIdToken({ idToken, audience }) {
      if (state.failVerify) throw new Error(`Invalid token signature: ${idToken}`);
      if (audience !== CLIENT_ID) throw new Error('aud');
      return { getPayload: () => ({ iss: 'https://accounts.google.com', aud: CLIENT_ID, ...state.claims }) };
    },
  };
}

function build({ google = true, path = join(dir, 'g.sqlite') } = {}) {
  const db = openDatabase(path);
  migrate(db);
  const client = fakeClient();
  const logger = { error: vi.fn() };
  const auth = createAuth({
    db,
    sessionSecret: SECRET,
    appOrigin: ORIGIN,
    cookieSecure: false,
    now: () => clock,
    hasher: fakeHasher,
    logger,
    googleProvider: google
      ? createGoogleProvider({ clientId: CLIENT_ID, clientSecret: 'secreto-cliente', redirectUri: REDIRECT, client })
      : null,
  });
  opened.push({ auth, db });
  return { app: createApp({ catalog, logger, auth }), db, client, logger, path, auth };
}

const count = (db, table) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
const sessionCookie = (res) => (res.headers['set-cookie'] || []).find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));

async function csrfOf(agent) {
  return (await agent.get('/api/auth/session')).body.csrfToken;
}

function post(agent, path, body, token, { origin = ORIGIN } = {}) {
  let req = agent.post(path).set('Content-Type', 'application/json');
  if (origin) req = req.set('Origin', origin);
  if (token) req = req.set('X-CSRF-Token', token);
  return req.send(JSON.stringify(body));
}

/** Inicia un intento y devuelve los parámetros de la URL de Google. */
async function start(ctx, agent) {
  const res = await post(agent, '/api/auth/google/start', {}, await csrfOf(agent));
  expect(res.status).toBe(200);
  const url = new URL(res.body.authorizationUrl);
  const params = Object.fromEntries(url.searchParams);
  ctx.client.state.challenge = params.code_challenge;
  return { url, params };
}

const callback = (agent, query) => agent.get(GOOGLE_CALLBACK_PATH).query(query);

function expectRedirect(res, location) {
  expect(res.status).toBe(303);
  expect(res.headers.location).toBe(location);
}

describe('GET /api/auth/providers', () => {
  it('informa enabled sin secretos ni IDs y sin crear sesión', async () => {
    const on = build();
    const res = await request(on.app).get('/api/auth/providers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ google: { enabled: true } });
    expect(res.text).not.toContain(CLIENT_ID);
    expect(sessionCookie(res)).toBeUndefined();
    const off = build({ google: false, path: join(dir, 'off.sqlite') });
    expect((await request(off.app).get('/api/auth/providers')).body).toEqual({ google: { enabled: false } });
  });
});

describe('POST /api/auth/google/start', () => {
  it('devuelve URL de Google con state/nonce/PKCE S256, scopes mínimos y guarda solo hashes', async () => {
    const ctx = build();
    const agent = request.agent(ctx.app);
    const { url, params } = await start(ctx, agent);
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTHORIZATION_ENDPOINT);
    expect(params).toEqual({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: 'openid email profile',
      state: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      nonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      code_challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      code_challenge_method: 'S256',
      access_type: 'online',
    });
    expect(params.state).not.toBe(params.nonce);
    const row = ctx.db.prepare('SELECT * FROM oauth_attempts').get();
    expect(row.state_hash).toBe(createHash('sha256').update(params.state).digest('hex'));
    expect(row.nonce_hash).toBe(createHash('sha256').update(params.nonce).digest('hex'));
    expect(s256(row.verifier)).toBe(params.code_challenge);
    expect(row).toMatchObject({ purpose: 'login', expected_user_id: null, return_to: 'projects', expires_at: clock + ATTEMPT_TTL_MS });
    // Un nuevo inicio en la misma sesión sustituye al anterior.
    await start(ctx, agent);
    expect(count(ctx.db, 'oauth_attempts')).toBe(1);
  });

  it('exige Origin, CSRF, JSON y cuerpo vacío; sin configuración responde 503', async () => {
    const ctx = build();
    const agent = request.agent(ctx.app);
    const token = await csrfOf(agent);
    expect((await post(agent, '/api/auth/google/start', {}, token, { origin: 'http://evil.example' })).body.error.code).toBe('FORBIDDEN_ORIGIN');
    expect((await post(agent, '/api/auth/google/start', {}, 'otro')).body.error.code).toBe('CSRF_INVALID');
    expect((await post(agent, '/api/auth/google/start', { returnTo: 'https://evil.example' }, token)).status).toBe(400);
    const text = await agent.post('/api/auth/google/start').set('Origin', ORIGIN).set('X-CSRF-Token', token).set('Content-Type', 'text/plain').send('{}');
    expect(text.status).toBe(415);
    expect(count(ctx.db, 'oauth_attempts')).toBe(0);

    const off = build({ google: false, path: join(dir, 'off.sqlite') });
    const offAgent = request.agent(off.app);
    const res = await post(offAgent, '/api/auth/google/start', {}, await csrfOf(offAgent));
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: { code: 'AUTH_PROVIDER_UNAVAILABLE', message: expect.any(String) } });
  });
});

describe('GET /api/auth/google/callback', () => {
  it('alta Google: crea usuario sin contraseña, regenera sesión y redirige a /proyectos', async () => {
    const ctx = build();
    const agent = request.agent(ctx.app);
    const pre = await agent.get('/api/auth/session');
    const { params } = await start(ctx, agent);
    ctx.client.state.claims = { sub: 'g-sub-1', email: 'Nueva@Example.com', email_verified: true, nonce: params.nonce };

    const res = await callback(agent, { state: params.state, code: 'codigo-1' });
    expectRedirect(res, '/proyectos');
    expect(sessionCookie(res).split(';')[0]).not.toBe(sessionCookie(pre).split(';')[0]);
    const me = (await agent.get('/api/auth/session')).body;
    expect(me.user).toEqual({ id: expect.any(String), email: 'nueva@example.com' });
    expect(me.csrfToken).not.toBe(pre.body.csrfToken);
    expect(ctx.db.prepare('SELECT provider, subject, user_id FROM external_identities').all()).toEqual([
      { provider: 'google', subject: 'g-sub-1', user_id: me.user.id },
    ]);
    expect(count(ctx.db, 'password_credentials')).toBe(0);
    expect(count(ctx.db, 'oauth_attempts')).toBe(0);
    // La cuenta Google ve sus proyectos privados (vacío) y el logout revoca la sesión.
    const out = await post(agent, '/api/auth/logout', {}, me.csrfToken);
    expect(out.status).toBe(204);
    expect((await agent.get('/api/auth/session')).body.user).toBeNull();
  });

  it('Google existente recupera el mismo UUID aunque cambie el correo externo', async () => {
    const ctx = build();
    const id = randomUUID();
    createAccountStore({ db: ctx.db }).createUserWithIdentity({
      id, email: 'antes@example.com', provider: 'google', subject: 'g-sub-2', createdAt: '2026-11-21T10:00:00.000Z',
    });
    const agent = request.agent(ctx.app);
    const { params } = await start(ctx, agent);
    ctx.client.state.claims = { sub: 'g-sub-2', email: 'despues@example.com', email_verified: false, nonce: params.nonce };
    expectRedirect(await callback(agent, { state: params.state, code: 'c' }), '/proyectos');
    expect((await agent.get('/api/auth/session')).body.user).toEqual({ id, email: 'antes@example.com' });
    expect(count(ctx.db, 'users')).toBe(1);
  });

  it('replay, intento vencido y state ajeno fallan sin canje ni sesión', async () => {
    const ctx = build();
    const agent = request.agent(ctx.app);
    let { params } = await start(ctx, agent);
    ctx.client.state.claims = { sub: 's', email: 'a@example.com', email_verified: true, nonce: params.nonce };
    expectRedirect(await callback(agent, { state: params.state, code: 'c' }), '/proyectos');
    expect(ctx.client.state.calls).toBe(1);
    // Replay del mismo state (ya consumido).
    expectRedirect(await callback(agent, { state: params.state, code: 'c' }), '/entrar?reason=google_failed');
    expect(ctx.client.state.calls).toBe(1);

    // Vencido: 5 min exactos.
    const late = request.agent(ctx.app);
    ({ params } = await start(ctx, late));
    clock += ATTEMPT_TTL_MS;
    expectRedirect(await callback(late, { state: params.state, code: 'c' }), '/entrar?reason=google_failed');
    expect(ctx.client.state.calls).toBe(1);
    expect(count(ctx.db, 'oauth_attempts')).toBe(0);

    // State de otra sesión: no se acepta ni se consume; la sesión dueña aún puede completarlo.
    const owner = request.agent(ctx.app);
    ({ params } = await start(ctx, owner));
    ctx.client.state.claims = { sub: 's2', email: 'b@example.com', email_verified: true, nonce: params.nonce };
    const intruder = request.agent(ctx.app);
    await intruder.get('/api/auth/session');
    expectRedirect(await callback(intruder, { state: params.state, code: 'c' }), '/entrar?reason=google_failed');
    expectRedirect(await callback(request(ctx.app), { state: params.state, code: 'c' }), '/entrar?reason=google_failed');
    expect((await intruder.get('/api/auth/session')).body.user).toBeNull();
    expect(ctx.client.state.calls).toBe(1);
    expectRedirect(await callback(owner, { state: params.state, code: 'c' }), '/proyectos');
  });

  it('nonce distinto, email no verificado, verificación o canje fallidos no crean usuario ni sesión', async () => {
    const ctx = build();
    const cases = [
      (p) => { ctx.client.state.claims = { sub: 'x1', email: 'x@example.com', email_verified: true, nonce: `${p.nonce}x` }; },
      (p) => { ctx.client.state.claims = { sub: 'x2', email: 'x@example.com', email_verified: false, nonce: p.nonce }; },
      (p) => { ctx.client.state.claims = { sub: 'x3', email: 'x@example.com', email_verified: 'true', nonce: p.nonce }; },
      (p) => { ctx.client.state.claims = { sub: '', email: 'x@example.com', email_verified: true, nonce: p.nonce }; },
      () => { ctx.client.state.claims = { sub: 'x5', email: 'x@example.com', email_verified: true }; },
      (p) => { ctx.client.state.claims = { sub: 'x6', email: 'x@example.com', email_verified: true, nonce: p.nonce }; ctx.client.state.failVerify = true; },
      (p) => { ctx.client.state.claims = { sub: 'x7', email: 'x@example.com', email_verified: true, nonce: p.nonce }; ctx.client.state.failVerify = false; ctx.client.state.failExchange = true; },
    ];
    for (const prepare of cases) {
      const agent = request.agent(ctx.app);
      const { params } = await start(ctx, agent);
      prepare(params);
      expectRedirect(await callback(agent, { state: params.state, code: 'codigo-secreto' }), '/entrar?reason=google_failed');
      expect((await agent.get('/api/auth/session')).body.user).toBeNull();
    }
    expect(count(ctx.db, 'users')).toBe(0);
    expect(count(ctx.db, 'external_identities')).toBe(0);
    expect(count(ctx.db, 'oauth_attempts')).toBe(0);
    // Los registros nunca incluyen códigos, tokens ni mensajes de la biblioteca.
    const logged = JSON.stringify(ctx.logger.error.mock.calls);
    expect(logged).not.toMatch(/codigo-secreto|id-token-|signature|invalid_grant/);
  });

  it('correo ocupado por una cuenta local no se autoenlaza: google_conflict sin mutaciones', async () => {
    const ctx = build();
    const local = request.agent(ctx.app);
    const reg = await post(local, '/api/auth/register', { email: 'ana@example.com', password: PASSWORD }, await csrfOf(local));
    ctx.db.prepare(
      'INSERT INTO projects (id, owner_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), reg.body.user.id, 'Proyecto de Ana', '', '2026-11-22T10:00:00.000Z', '2026-11-22T10:00:00.000Z');
    const before = {
      users: ctx.db.prepare('SELECT * FROM users').all(),
      creds: ctx.db.prepare('SELECT * FROM password_credentials').all(),
      projects: ctx.db.prepare('SELECT * FROM projects').all(),
    };
    const agent = request.agent(ctx.app);
    const { params } = await start(ctx, agent);
    ctx.client.state.claims = { sub: 'g-ana', email: 'ana@example.com', email_verified: true, nonce: params.nonce };
    expectRedirect(await callback(agent, { state: params.state, code: 'c' }), '/entrar?reason=google_conflict');
    expect((await agent.get('/api/auth/session')).body.user).toBeNull();
    expect(count(ctx.db, 'external_identities')).toBe(0);
    expect(ctx.db.prepare('SELECT * FROM users').all()).toEqual(before.users);
    expect(ctx.db.prepare('SELECT * FROM password_credentials').all()).toEqual(before.creds);
    expect(ctx.db.prepare('SELECT * FROM projects').all()).toEqual(before.projects);
    expect(before.projects).toHaveLength(1);
  });

  it('cancelación y errores del proveedor usan motivos fijos sin reflejar parámetros', async () => {
    const ctx = build();
    let agent = request.agent(ctx.app);
    let { params } = await start(ctx, agent);
    let res = await callback(agent, { state: params.state, error: 'access_denied', error_description: '<script>x</script>' });
    expectRedirect(res, '/entrar?reason=google_cancelled');
    expect(sessionCookie(res)).toBeUndefined();
    expect(count(ctx.db, 'oauth_attempts')).toBe(0);

    agent = request.agent(ctx.app);
    ({ params } = await start(ctx, agent));
    res = await callback(agent, { state: params.state, error: 'server_error', error_description: 'detalle' });
    expectRedirect(res, '/entrar?reason=google_failed');

    // Parámetros ausentes, repetidos o malformados.
    for (const query of [{}, { state: 'corto', code: 'c' }, { state: ['a', 'b'], code: 'c' }]) {
      expectRedirect(await callback(request.agent(ctx.app), query), '/entrar?reason=google_failed');
    }
    agent = request.agent(ctx.app);
    ({ params } = await start(ctx, agent));
    expectRedirect(await agent.get(`${GOOGLE_CALLBACK_PATH}?state=${params.state}&code=a&code=b`), '/entrar?reason=google_failed');
    agent = request.agent(ctx.app);
    ({ params } = await start(ctx, agent));
    expectRedirect(await callback(agent, { state: params.state }), '/entrar?reason=google_failed');
    expect(ctx.client.state.calls).toBe(0);
    expect(res.text).not.toContain('detalle');
  });

  describe('carreras durante el canje (proveedor diferido)', () => {
    /** Lanza el callback, espera a que el canje quede bloqueado y devuelve {release, done}. */
    async function pendingCallback(ctx, agent, params, claims) {
      let release;
      ctx.client.state.gate = new Promise((resolve) => { release = resolve; });
      ctx.client.state.claims = { nonce: params.nonce, ...claims };
      const done = callback(agent, { state: params.state, code: 'c' }).then((r) => r);
      for (let i = 0; i < 200 && ctx.client.state.calls === 0; i += 1) await new Promise((r) => setTimeout(r, 5));
      expect(ctx.client.state.calls).toBe(1);
      return { release, done };
    }
    const sids = (db) => db.prepare('SELECT id_hash FROM sessions ORDER BY id_hash').all().map((r) => r.id_hash);

    it('logout durante el canje: no crea usuario, identidad ni sesión y no emite cookie', async () => {
      const ctx = build();
      const agent = request.agent(ctx.app);
      const reg = await post(agent, '/api/auth/register', { email: 'local@example.com', password: PASSWORD }, await csrfOf(agent));
      const { params } = await start(ctx, agent);
      const { release, done } = await pendingCallback(ctx, agent, params, { sub: 'g-late', email: 'tarde@example.com', email_verified: true });

      expect((await post(agent, '/api/auth/logout', {}, reg.body.csrfToken)).status).toBe(204);
      expect(count(ctx.db, 'sessions')).toBe(0);
      release();
      const res = await done;

      expectRedirect(res, '/entrar?reason=google_failed');
      expect(sessionCookie(res)).toBeUndefined();
      expect(count(ctx.db, 'sessions')).toBe(0); // el sid revocado no revive
      expect(count(ctx.db, 'users')).toBe(1);
      expect(count(ctx.db, 'external_identities')).toBe(0);
      expect((await agent.get('/api/auth/session')).body.user).toBeNull();
    });

    it('otra cuenta inicia sesión (sid rotado) durante el canje: conserva la sesión y cookie nuevas', async () => {
      const ctx = build();
      const other = request.agent(ctx.app);
      await post(other, '/api/auth/register', { email: 'beto@example.com', password: PASSWORD }, await csrfOf(other));
      const agent = request.agent(ctx.app);
      const { params } = await start(ctx, agent);
      const { release, done } = await pendingCallback(ctx, agent, params, { sub: 'g-rot', email: 'rot@example.com', email_verified: true });

      const login = await post(agent, '/api/auth/login', { email: 'beto@example.com', password: PASSWORD }, await csrfOf(agent));
      expect(login.status).toBe(200);
      const rotated = sessionCookie(login).split(';')[0];
      const before = sids(ctx.db);
      release();
      const res = await done;

      expectRedirect(res, '/entrar?reason=google_failed');
      expect(sessionCookie(res)).toBeUndefined(); // no sobrescribe la cookie rotada
      expect(sids(ctx.db)).toEqual(before);
      expect(count(ctx.db, 'external_identities')).toBe(0);
      expect(count(ctx.db, 'users')).toBe(1);
      const me = await request(ctx.app).get('/api/auth/session').set('Cookie', rotated);
      expect(me.body.user).toEqual(login.body.user);
      expect((await agent.get('/api/auth/session')).body.user).toEqual(login.body.user);
    });

    it('la sesión vence durante el canje: rechazo sin revivirla ni crear cuenta', async () => {
      const ctx = build();
      const agent = request.agent(ctx.app);
      const { params } = await start(ctx, agent);
      const { release, done } = await pendingCallback(ctx, agent, params, { sub: 'g-exp', email: 'exp@example.com', email_verified: true });
      ctx.db.prepare('UPDATE sessions SET expires_at = ?').run(clock); // vencida en el servidor
      release();
      const res = await done;

      expectRedirect(res, '/entrar?reason=google_failed');
      expect(sessionCookie(res)).toBeUndefined();
      expect(count(ctx.db, 'sessions')).toBe(0);
      expect(count(ctx.db, 'users')).toBe(0);
      expect(count(ctx.db, 'external_identities')).toBe(0);
    });

    it('sin cesión entre la relectura de la sesión y la mutación', async () => {
      const ctx = build();
      const agent = request.agent(ctx.app);
      await agent.get('/api/auth/session');
      const { params } = await start(ctx, agent);
      const oldHash = ctx.db.prepare('SELECT id_hash FROM sessions').get().id_hash;
      const { release, done } = await pendingCallback(ctx, agent, params, { sub: 'g-sync', email: 'sync@example.com', email_verified: true });
      // La siguiente lectura del store es la relectura del callback; una
      // continuación encolada en ese instante no debe ver el tramo a medias.
      let seen;
      const original = ctx.auth.store.get.bind(ctx.auth.store);
      ctx.auth.store.get = (sid, cb) => {
        ctx.auth.store.get = original;
        queueMicrotask(() => {
          seen = {
            oldSession: ctx.db.prepare('SELECT count(*) AS n FROM sessions WHERE id_hash = ?').get(oldHash).n,
            identities: count(ctx.db, 'external_identities'),
          };
        });
        return original(sid, cb);
      };
      release();
      const res = await done;
      expectRedirect(res, '/proyectos');
      expect(seen).toEqual({ oldSession: 0, identities: 1 });
    });

    it('el intento vence (5 min) durante el canje: rechazo sin aplicar el resultado', async () => {
      const ctx = build();
      const agent = request.agent(ctx.app);
      const pre = await agent.get('/api/auth/session');
      const { params } = await start(ctx, agent);
      const { release, done } = await pendingCallback(ctx, agent, params, { sub: 'g-ttl', email: 'ttl@example.com', email_verified: true });
      clock += ATTEMPT_TTL_MS;
      release();
      const res = await done;

      expectRedirect(res, '/entrar?reason=google_failed');
      expect(sessionCookie(res)).toBeUndefined();
      expect(count(ctx.db, 'users')).toBe(0);
      expect(count(ctx.db, 'external_identities')).toBe(0);
      // La presesión original sigue siendo la única y sin usuario.
      expect(sids(ctx.db)).toHaveLength(1);
      const me = await request(ctx.app).get('/api/auth/session').set('Cookie', sessionCookie(pre).split(';')[0]);
      expect(me.body.user).toBeNull();
    });
  });

  it('sin configuración el callback redirige a google_failed', async () => {
    const off = build({ google: false });
    expectRedirect(await callback(request(off.app), { state: 'a'.repeat(43), code: 'c' }), '/entrar?reason=google_failed');
  });

  it('la DB no guarda códigos ni tokens: solo identidad y sesión', async () => {
    const ctx = build();
    const agent = request.agent(ctx.app);
    const { params } = await start(ctx, agent);
    ctx.client.state.claims = { sub: 'g-p', email: 'p@example.com', email_verified: true, nonce: params.nonce };
    expectRedirect(await callback(agent, { state: params.state, code: 'codigo-unico-123' }), '/proyectos');
    ctx.db.close();
    const raw = readFileSync(ctx.path).toString('latin1');
    for (const secret of ['codigo-unico-123', ...ctx.client.state.tokens, 'refresh-x', 'access-', params.state, params.nonce]) {
      expect(raw).not.toContain(secret);
    }
    expect(ctx.logger.error).not.toHaveBeenCalled();
  });
});

describe('createGoogleProvider con google-auth-library real (sin red)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

  function jwt(claims, { kid = 'k1', key = privateKey } = {}) {
    const head = b64({ alg: 'RS256', kid, typ: 'JWT' });
    const body = b64(claims);
    const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url');
    return `${head}.${body}.${sig}`;
  }

  function provider(idToken) {
    const client = new OAuth2Client({ clientId: CLIENT_ID, clientSecret: 'x', redirectUri: REDIRECT, issuers: ['https://accounts.google.com', 'accounts.google.com'] });
    client.getToken = async () => ({ tokens: { id_token: idToken } });
    client.getFederatedSignonCertsAsync = async () => ({ certs: { k1: pem }, format: 'PEM' });
    return createGoogleProvider({ clientId: CLIENT_ID, clientSecret: 'x', redirectUri: REDIRECT, client });
  }

  const nowS = () => Math.floor(Date.now() / 1000);
  const valid = () => ({
    iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1234', email: 'u@example.com',
    email_verified: true, nonce: 'n-1', iat: nowS(), exp: nowS() + 3600,
  });

  it('acepta un ID token firmado con iss/aud/exp válidos y devuelve claims mínimas', async () => {
    await expect(provider(jwt(valid())).exchange({ code: 'c', codeVerifier: 'v' })).resolves.toEqual({
      sub: '1234', email: 'u@example.com', emailVerified: true, nonce: 'n-1',
    });
  });

  it.each([
    ['audiencia ajena', { aud: 'otro-cliente' }],
    ['emisor ajeno', { iss: 'https://evil.example' }],
    ['emisor googleapis.com', { iss: 'googleapis.com' }],
    ['expirado', { iat: nowS() - 7200, exp: nowS() - 3600 }],
  ])('rechaza %s con GoogleAuthError sin el token en el mensaje', async (_name, override) => {
    const token = jwt({ ...valid(), ...override });
    const error = await provider(token).exchange({ code: 'c', codeVerifier: 'v' }).catch((e) => e);
    expect(error).toBeInstanceOf(GoogleAuthError);
    expect(error.message).not.toContain(token);
  });

  it('rechaza firma de otra clave y respuesta sin id_token', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    await expect(provider(jwt(valid(), { key: other })).exchange({ code: 'c', codeVerifier: 'v' })).rejects.toBeInstanceOf(GoogleAuthError);
    await expect(provider(undefined).exchange({ code: 'c', codeVerifier: 'v' })).rejects.toBeInstanceOf(GoogleAuthError);
  });
});

describe('loadGoogleConfig', () => {
  const full = { GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 'secreto-muy-privado', GOOGLE_REDIRECT_URI: REDIRECT };

  it('desactivado sin variables; completo devuelve la configuración congelada', () => {
    expect(loadGoogleConfig({}, ORIGIN)).toBeNull();
    const cfg = loadGoogleConfig(full, ORIGIN);
    expect(cfg).toEqual({ clientId: CLIENT_ID, clientSecret: 'secreto-muy-privado', redirectUri: REDIRECT });
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it('parcial o con callback distinto de APP_ORIGIN falla sin revelar valores', () => {
    const bad = [
      { GOOGLE_CLIENT_ID: CLIENT_ID },
      { ...full, GOOGLE_CLIENT_SECRET: '' },
      { ...full, GOOGLE_REDIRECT_URI: 'http://localhost:5573/api/auth/google/callback' },
      { ...full, GOOGLE_REDIRECT_URI: `${REDIRECT}?x=1` },
      { ...full, GOOGLE_REDIRECT_URI: 'https://evil.example/api/auth/google/callback' },
      { ...full, GOOGLE_CLIENT_SECRET: 'con espacio' },
    ];
    for (const env of bad) {
      let error;
      try {
        loadGoogleConfig(env, ORIGIN);
      } catch (e) {
        error = e;
      }
      expect(error, JSON.stringify(Object.keys(env))).toBeInstanceOf(ConfigError);
      expect(error.message).not.toContain('secreto-muy-privado');
      expect(error.message).not.toContain(CLIENT_ID);
    }
  });
});
