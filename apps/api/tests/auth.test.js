import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { SESSION_COOKIE_NAME, createAuth, createRateLimiter, normalizeEmail } from '../src/auth.js';
import { validateCatalog } from '../src/catalog.js';
import { migrate, openDatabase } from '../src/db.js';
import {
  ARGON2_PARAMS,
  HasherBusyError,
  countCodePoints,
  createPasswordHasher,
  isValidPassword,
  parseHash,
} from '../src/passwords.js';
import {
  ABSOLUTE_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  SqliteSessionStore,
  hashSessionId,
  sessionExpiresAt,
} from '../src/sessions.js';
import { validCatalog } from './fixtures.js';

// Cada prueba usa su propio archivo SQLite temporal y un reloj inyectado.
const ORIGIN = 'http://127.0.0.1:5573';
const SECRET = randomBytes(32).toString('hex');
const PASSWORD = 'una contraseña larga y segura';
const MINUTE = 60 * 1000;
const catalog = validateCatalog(validCatalog(), { today: '2026-11-20' });

let dir;
let clock;
const opened = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nomoresaas-auth-'));
  clock = Date.parse('2026-11-21T10:00:00.000Z');
});

afterEach(() => {
  for (const { auth, db } of opened.splice(0)) {
    auth?.close();
    if (db.isOpen) db.close();
  }
  rmSync(dir, { recursive: true, force: true });
});

function build({ path = join(dir, 'auth.sqlite'), logger = { error: vi.fn() }, ...options } = {}) {
  const db = openDatabase(path);
  migrate(db);
  const auth = createAuth({
    db,
    sessionSecret: SECRET,
    appOrigin: ORIGIN,
    cookieSecure: false,
    now: () => clock,
    ...options,
  });
  opened.push({ auth, db });
  return { app: createApp({ catalog, logger, auth }), db, auth, logger };
}

const count = (db, table) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;

function sessionCookie(res) {
  const cookies = res.headers['set-cookie'] || [];
  return cookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
}

const cookiePair = (setCookie) => setCookie.split(';')[0];

async function csrfOf(agent) {
  const res = await agent.get('/api/auth/session');
  expect(res.status).toBe(200);
  return res.body.csrfToken;
}

function post(agent, path, body, token, { origin = ORIGIN, type = 'application/json', cookie } = {}) {
  let req = agent.post(path);
  if (origin !== null) req = req.set('Origin', origin);
  if (token) req = req.set('X-CSRF-Token', token);
  if (type) req = req.set('Content-Type', type);
  if (cookie) req = req.set('Cookie', cookie);
  return req.send(typeof body === 'string' ? body : JSON.stringify(body));
}

async function register(agent, email = 'ana@example.com', password = PASSWORD) {
  return post(agent, '/api/auth/register', { email, password }, await csrfOf(agent));
}

async function login(agent, email = 'ana@example.com', password = PASSWORD) {
  return post(agent, '/api/auth/login', { email, password }, await csrfOf(agent));
}

function expectError(res, status, code) {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.body).toEqual({ error: { code, message: expect.any(String) } });
  expect(res.text).not.toMatch(/argon2|password_hash|SELECT|INSERT|sqlite|at \w+ \(|node_modules/i);
}

describe('contraseñas (Argon2id)', () => {
  const hasher = createPasswordHasher();

  it('genera hash versionado con parámetros, salt de 16 bytes y tag de 32', async () => {
    const encoded = await hasher.hash(PASSWORD);
    expect(encoded).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    const parsed = parseHash(encoded);
    expect(parsed.salt).toHaveLength(16);
    expect(parsed.tag).toHaveLength(32);
    expect({ memory: parsed.memory, passes: parsed.passes, parallelism: parsed.parallelism }).toEqual({
      memory: ARGON2_PARAMS.memory,
      passes: ARGON2_PARAMS.passes,
      parallelism: ARGON2_PARAMS.parallelism,
    });
    expect(encoded).not.toContain(PASSWORD);
    expect(await hasher.hash(PASSWORD)).not.toBe(encoded); // salt aleatorio
  });

  it('verifica exacto, sin trim ni normalización, y rechaza hashes malformados', async () => {
    const encoded = await hasher.hash(`${PASSWORD} `);
    expect(await hasher.verify(`${PASSWORD} `, encoded)).toBe(true);
    expect(await hasher.verify(PASSWORD, encoded)).toBe(false);
    const nfc = 'contraseña-compuesta-ñ'; // ñ precompuesta
    const nfd = nfc.normalize('NFD');
    expect(await hasher.verify(nfd, await hasher.hash(nfc))).toBe(false);
    for (const bad of ['', 'texto', '$argon2i$v=19$m=1,t=1,p=1$YWJjZGVmZ2g$YWJjZA', '$argon2id$v=16$m=19456,t=2,p=1$YWJjZGVmZ2g$YWJjZA', null]) {
      expect(await hasher.verify(PASSWORD, bad)).toBe(false);
    }
    expect(await hasher.verifyDummy(PASSWORD)).toBe(false);
  });

  it('un hash corrupto o con parámetros arbitrarios devuelve false sin derivar', async () => {
    const valid = await hasher.hash(PASSWORD);
    const [, , , , salt, tag] = valid.split('$');
    const corrupt = [
      `$argon2id$v=19$m=4294967295,t=2,p=1$${salt}$${tag}`, // memoria desmesurada
      `$argon2id$v=19$m=19456,t=4294967295,p=1$${salt}$${tag}`, // pasadas desmesuradas
      `$argon2id$v=19$m=19456,t=2,p=16777215$${salt}$${tag}`,
      `$argon2id$v=19$m=8,t=1,p=1$${salt}$${tag}`, // parámetros más débiles
      `$argon2id$v=19$m=019456,t=2,p=1$${salt}$${tag}`, // no canónico
      `$argon2id$v=19$m=19456,t=2,p=1$${salt}$${tag}${'A'.repeat(10000)}`, // tag gigante
      `$argon2id$v=19$m=19456,t=2,p=1$${salt.slice(0, 11)}$${tag}`, // salt de 8 bytes
      `$argon2id$v=19$m=19456,t=2,p=1$${salt}$${tag.slice(0, 6)}`, // tag corto
      `$argon2id$v=19$m=19456,t=2,p=1$${salt}==$${tag}`, // relleno
      `$argon2id$v=19$m=19456,t=2,p=1$${salt.slice(0, -1)}B$${tag}`, // bits sobrantes no canónicos
    ];
    const probe = createPasswordHasher({ maxConcurrent: 1, maxQueue: 0 });
    for (const encoded of corrupt) {
      expect(parseHash(encoded), encoded.slice(0, 60)).toBeNull();
      const pending = probe.verify(PASSWORD, encoded);
      expect(probe.active).toBe(0); // no se programó ninguna derivación
      expect(await pending).toBe(false);
    }
    // Control: un hash válido sí programa una derivación y verifica.
    const pending = probe.verify(PASSWORD, valid);
    expect(probe.active).toBe(1);
    expect(await pending).toBe(true);
  });

  it('valida 15–128 puntos Unicode, no unidades UTF-16', () => {
    expect(isValidPassword('a'.repeat(14))).toBe(false);
    expect(isValidPassword('a'.repeat(15))).toBe(true);
    expect(isValidPassword('a'.repeat(128))).toBe(true);
    expect(isValidPassword('a'.repeat(129))).toBe(false);
    expect(countCodePoints('😀'.repeat(15))).toBe(15);
    expect(isValidPassword('😀'.repeat(15))).toBe(true);
    expect(isValidPassword('😀'.repeat(65))).toBe(true); // 130 unidades UTF-16 pero 65 puntos
    expect(isValidPassword('😀'.repeat(129))).toBe(false);
    expect(isValidPassword(' '.repeat(15))).toBe(true);
    expect(isValidPassword(123456789012345)).toBe(false);
  });

  it('limita a 2 derivaciones simultáneas y rechaza con cola mayor de 10', async () => {
    const busy = createPasswordHasher();
    const results = await Promise.allSettled(Array.from({ length: 13 }, () => busy.hash(PASSWORD)));
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(HasherBusyError);
    expect(busy.active).toBe(0);
    expect(busy.queued).toBe(0);
  });
});

describe('correo y limitador', () => {
  it('normaliza trim/lowercase y exige formato básico', () => {
    expect(normalizeEmail('  Ana@Example.COM ')).toBe('ana@example.com');
    for (const bad of ['', 'ab', 'sin-arroba.com', 'a b@example.com', 'ana@dominio', 'a@b@c.co', `${'a'.repeat(250)}@x.co`, 'ana\u0000@x.co', 7]) {
      expect(normalizeEmail(bad), String(bad)).toBeNull();
    }
  });

  it('ventana fija con TTL y máximo de claves', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, maxKeys: 2, now: () => t });
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a')).toEqual({ allowed: false, retryAfterMs: 1000 });
    expect(limiter.hit('b').allowed).toBe(true);
    expect(limiter.hit('c').allowed).toBe(false); // lleno: clave nueva rechazada
    t = 1000;
    expect(limiter.hit('c').allowed).toBe(true); // TTL vencido libera claves
    expect(limiter.size).toBe(1);
  });
});

describe('store de sesiones SQLite', () => {
  let db;
  let store;
  const call = (fn, ...args) => new Promise((resolve, reject) => fn.call(store, ...args, (e, v) => (e ? reject(e) : resolve(v))));
  const sess = (extra = {}) => ({ cookie: { path: '/', httpOnly: true }, csrfToken: 't', createdAt: clock, ...extra });

  beforeEach(() => {
    db = openDatabase(join(dir, 'store.sqlite'));
    migrate(db);
    opened.push({ db });
    store = new SqliteSessionStore({ db, now: () => clock });
  });

  it('guarda SHA-256 del sid, payload permitido y expiración mínima', async () => {
    await call(store.set, 'sid-en-claro', sess({ userId: '0f8fad5b-d9cb-469f-a165-70867728950e', password: 'nunca' }));
    const row = db.prepare('SELECT * FROM sessions').get();
    expect(row.id_hash).toBe(hashSessionId('sid-en-claro'));
    expect(row.id_hash).not.toContain('sid');
    expect(JSON.parse(row.payload)).toEqual({
      cookie: { path: '/', httpOnly: true },
      csrfToken: 't',
      createdAt: clock,
      userId: '0f8fad5b-d9cb-469f-a165-70867728950e',
    });
    expect(row.expires_at).toBe(clock + IDLE_TIMEOUT_MS);
    expect(await call(store.get, 'sid-en-claro')).toMatchObject({ csrfToken: 't' });
    expect(await call(store.get, 'otro')).toBeNull();
  });

  it('caduca por inactividad y no revive con touch', async () => {
    await call(store.set, 's', sess());
    clock += IDLE_TIMEOUT_MS - 1;
    await call(store.touch, 's', sess({ createdAt: clock - IDLE_TIMEOUT_MS + 1 }));
    clock += IDLE_TIMEOUT_MS - 1;
    expect(await call(store.get, 's')).not.toBeNull(); // touch extendió
    clock += IDLE_TIMEOUT_MS;
    await call(store.touch, 's', sess({ createdAt: clock - 1 }));
    expect(await call(store.get, 's')).toBeNull();
    expect(count(db, 'sessions')).toBe(0);
  });

  it('respeta el límite absoluto de 24 h aunque haya actividad', async () => {
    const created = clock;
    await call(store.set, 's', sess());
    expect(sessionExpiresAt(created, created + ABSOLUTE_TIMEOUT_MS - 10 * MINUTE)).toBe(created + ABSOLUTE_TIMEOUT_MS);
    while (clock + 20 * MINUTE < created + ABSOLUTE_TIMEOUT_MS) {
      clock += 20 * MINUTE;
      await call(store.touch, 's', sess({ createdAt: created }));
    }
    expect(db.prepare('SELECT expires_at FROM sessions').get().expires_at).toBe(created + ABSOLUTE_TIMEOUT_MS);
    clock = created + ABSOLUTE_TIMEOUT_MS;
    expect(await call(store.get, 's')).toBeNull();
    await call(store.set, 's', sess({ createdAt: created }));
    expect(count(db, 'sessions')).toBe(0); // set no revive una sesión vencida
  });

  it('descarta payload corrupto, limpia vencidas y destruye', async () => {
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hashSessionId('x'), '{"sin":"campos"}', clock + 1000);
    expect(await call(store.get, 'x')).toBeNull();
    await call(store.set, 'a', sess());
    await call(store.set, 'b', sess());
    clock += IDLE_TIMEOUT_MS;
    expect(store.cleanup()).toBe(2);
    await call(store.set, 'c', sess({ createdAt: clock }));
    await call(store.destroy, 'c');
    expect(count(db, 'sessions')).toBe(0);
    await expect(call(store.set, 'd', { cookie: {} })).rejects.toThrow(/csrfToken/);
  });
});

describe('GET /api/auth/session', () => {
  it('crea una presesión con token CSRF y cookie segura sin usuario', async () => {
    const { app, db } = build();
    const res = await request(app).get('/api/auth/session');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ user: null, csrfToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Expires=/);
    expect(cookie).not.toMatch(/Domain|Secure/i);
    expect(count(db, 'sessions')).toBe(1);
  });

  it('reutiliza la presesión existente y su token', async () => {
    const { app, db } = build();
    const agent = request.agent(app);
    const first = await csrfOf(agent);
    expect(await csrfOf(agent)).toBe(first);
    expect(count(db, 'sessions')).toBe(1);
  });

  it('el catálogo público no crea sesiones ni cookies', async () => {
    const { app, db } = build();
    for (const path of ['/api/catalog', '/api/health', '/api/alternatives/otra']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(200);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    expect(count(db, 'sessions')).toBe(0);
  });

  it('sin auth inyectada, createApp conserva solo el catálogo', async () => {
    const app = createApp({ catalog, logger: { error() {} } });
    expect((await request(app).get('/api/catalog')).status).toBe(200);
    expect((await request(app).get('/api/auth/session')).status).toBe(404);
  });
});

describe('POST /api/auth/register', () => {
  it('crea la cuenta normalizada, inicia sesión regenerada y oculta el hash', async () => {
    const { app, db } = build();
    const agent = request.agent(app);
    const pre = await agent.get('/api/auth/session');
    const preCookie = cookiePair(sessionCookie(pre));
    const res = await post(agent, '/api/auth/register', { email: '  Ana@Example.COM ', password: PASSWORD }, pre.body.csrfToken);
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      user: { id: expect.stringMatching(/^[0-9a-f-]{36}$/), email: 'ana@example.com' },
      csrfToken: expect.any(String),
    });
    expect(res.body.csrfToken).not.toBe(pre.body.csrfToken);
    expect(cookiePair(sessionCookie(res))).not.toBe(preCookie);
    expect(Object.keys(res.body).sort()).toEqual(['csrfToken', 'user']);
    expect(res.text).not.toMatch(/\$argon2|password|passwordHash/i);

    const user = db.prepare('SELECT * FROM users').get();
    expect(user.email).toBe('ana@example.com');
    expect(user.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(user.created_at).toBe('2026-11-21T10:00:00.000Z');
    const rows = db.prepare('SELECT payload FROM sessions').all();
    expect(rows).toHaveLength(1); // la presesión anterior fue destruida
    const payload = JSON.parse(rows[0].payload);
    expect(payload.userId).toBe(user.id);
    expect(rows[0].payload).not.toContain(PASSWORD);

    const me = await agent.get('/api/auth/session');
    expect(me.body).toEqual({ user: { id: user.id, email: 'ana@example.com' }, csrfToken: res.body.csrfToken });
    // El token de la presesión ya no sirve.
    expectError(await post(agent, '/api/auth/logout', {}, pre.body.csrfToken), 403, 'CSRF_INVALID');
  });

  it.each([
    ['correo inválido', { email: 'sin-arroba', password: PASSWORD }],
    ['correo no texto', { email: ['a@b.co'], password: PASSWORD }],
    ['contraseña corta', { email: 'a@b.co', password: 'a'.repeat(14) }],
    ['contraseña larga', { email: 'a@b.co', password: 'a'.repeat(129) }],
    ['contraseña vacía', { email: 'a@b.co', password: '' }],
    ['contraseña no texto', { email: 'a@b.co', password: 123456789012345 }],
    ['faltan campos', { email: 'a@b.co' }],
    ['campo extra', { email: 'a@b.co', password: PASSWORD, id: 'x' }],
    ['array', [{ email: 'a@b.co', password: PASSWORD }]],
  ])('rechaza %s con 400 sin crear cuenta', async (_label, body) => {
    const { app, db } = build();
    const agent = request.agent(app);
    const res = await post(agent, '/api/auth/register', body, await csrfOf(agent));
    expectError(res, 400, 'VALIDATION_ERROR');
    expect(count(db, 'users')).toBe(0);
  });

  it('acepta contraseña con espacios y emoji sin recortarla', async () => {
    const { app } = build();
    const pw = ` ${'😀'.repeat(14)}`;
    expect((await register(request.agent(app), 'emoji@example.com', pw)).status).toBe(201);
    expect((await login(request.agent(app), 'emoji@example.com', pw)).status).toBe(200);
    expectError(await login(request.agent(app), 'emoji@example.com', pw.trim()), 401, 'INVALID_CREDENTIALS');
  });

  it('duplicado con otra capitalización responde 409', async () => {
    const { app, db } = build();
    expect((await register(request.agent(app), 'ana@example.com')).status).toBe(201);
    expectError(await register(request.agent(app), 'ANA@Example.com'), 409, 'EMAIL_UNAVAILABLE');
    expect(count(db, 'users')).toBe(1);
  });

  it('dos registros simultáneos del mismo correo crean una sola cuenta', async () => {
    const { app, db } = build();
    const a = request.agent(app);
    const b = request.agent(app);
    const [ta, tb] = await Promise.all([csrfOf(a), csrfOf(b)]);
    const results = await Promise.all([
      post(a, '/api/auth/register', { email: 'mismo@example.com', password: PASSWORD }, ta),
      post(b, '/api/auth/register', { email: 'Mismo@example.com', password: PASSWORD }, tb),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(count(db, 'users')).toBe(1);
  });
});

describe('POST /api/auth/login', () => {
  it('inicia sesión con sid y CSRF nuevos y devuelve el mismo DTO', async () => {
    const { app } = build();
    const created = await register(request.agent(app));
    const agent = request.agent(app);
    const pre = await agent.get('/api/auth/session');
    const res = await post(agent, '/api/auth/login', { email: ' ANA@example.com', password: PASSWORD }, pre.body.csrfToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: created.body.user, csrfToken: expect.any(String) });
    expect(res.body.csrfToken).not.toBe(pre.body.csrfToken);
    expect(cookiePair(sessionCookie(res))).not.toBe(cookiePair(sessionCookie(pre)));
    expect((await agent.get('/api/auth/session')).body.user).toEqual(created.body.user);
  });

  it('responde idéntico 401 genérico para contraseña errónea y correo inexistente', async () => {
    const { app } = build();
    await register(request.agent(app));
    const wrong = await login(request.agent(app), 'ana@example.com', `${PASSWORD}x`);
    const missing = await login(request.agent(app), 'nadie@example.com', PASSWORD);
    const short = await login(request.agent(app), 'ana@example.com', 'corta');
    for (const res of [wrong, missing, short]) expectError(res, 401, 'INVALID_CREDENTIALS');
    expect(wrong.body).toEqual(missing.body);
    expect(short.body).toEqual(missing.body);
  });

  it('no autentica la presesión si las credenciales fallan', async () => {
    const { app } = build();
    await register(request.agent(app));
    const agent = request.agent(app);
    await login(agent, 'ana@example.com', 'contraseña incorrecta!!');
    expect((await agent.get('/api/auth/session')).body.user).toBeNull();
  });

  it('rechaza campos extra o no texto con 400', async () => {
    const { app } = build();
    const agent = request.agent(app);
    const token = await csrfOf(agent);
    expectError(await post(agent, '/api/auth/login', { email: 'a@b.co', password: PASSWORD, remember: true }, token), 400, 'VALIDATION_ERROR');
    expectError(await post(agent, '/api/auth/login', { email: 'a@b.co', password: 5 }, token), 400, 'VALIDATION_ERROR');
  });
});

describe('límites 429', () => {
  it('5 intentos por correo en 15 min, también con la contraseña correcta', async () => {
    const { app } = build();
    await register(request.agent(app));
    const agent = request.agent(app);
    for (let i = 0; i < 5; i += 1) {
      expect((await login(agent, 'ana@example.com', `${PASSWORD}-${i}`)).status).toBe(401);
    }
    const blocked = await login(agent, 'ANA@example.com', PASSWORD);
    expectError(blocked, 429, 'RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    clock += 15 * MINUTE;
    expect((await login(agent, 'ana@example.com', PASSWORD)).status).toBe(200);
  });

  it('un login correcto reinicia el contador del correo', async () => {
    const { app } = build();
    await register(request.agent(app));
    const agent = request.agent(app);
    for (let i = 0; i < 4; i += 1) await login(agent, 'ana@example.com', `${PASSWORD}-${i}`);
    expect((await login(agent, 'ana@example.com', PASSWORD)).status).toBe(200);
    for (let i = 0; i < 5; i += 1) {
      expect((await login(request.agent(app), 'ana@example.com', `${PASSWORD}-${i}`)).status).toBe(401);
    }
  });

  it('20 intentos de login por IP', async () => {
    const { app } = build();
    for (let i = 0; i < 20; i += 1) {
      expect((await login(request.agent(app), `u${i}@example.com`, PASSWORD)).status).toBe(401);
    }
    expectError(await login(request.agent(app), 'otro@example.com', PASSWORD), 429, 'RATE_LIMITED');
  });

  it('10 registros por IP', async () => {
    const { app, db } = build();
    for (let i = 0; i < 10; i += 1) {
      expect((await register(request.agent(app), `r${i}@example.com`)).status).toBe(201);
    }
    expectError(await register(request.agent(app), 'r10@example.com'), 429, 'RATE_LIMITED');
    expect(count(db, 'users')).toBe(10);
  });

  it('con el limitador lleno rechaza claves nuevas', async () => {
    const { app } = build({ limits: { maxKeys: 2 } });
    await login(request.agent(app), 'a@example.com', PASSWORD);
    await login(request.agent(app), 'b@example.com', PASSWORD);
    expectError(await login(request.agent(app), 'c@example.com', PASSWORD), 429, 'RATE_LIMITED');
  });

  it('cola de hashing llena responde 429 sin crear cuenta', async () => {
    const hasher = { hash: () => Promise.reject(new HasherBusyError()), verify: vi.fn(), verifyDummy: vi.fn() };
    const { app, db } = build({ hasher });
    expectError(await register(request.agent(app)), 429, 'RATE_LIMITED');
    expect(count(db, 'users')).toBe(0);
  });
});

describe('origen, CSRF, tipo y tamaño', () => {
  it.each([
    ['sin Origin', { origin: null }],
    ['origen ajeno', { origin: 'https://atacante.example' }],
    ['origen con barra', { origin: `${ORIGIN}/` }],
    ['origen null', { origin: 'null' }],
    ['otro puerto', { origin: 'http://127.0.0.1:5173' }],
  ])('%s → 403 FORBIDDEN_ORIGIN', async (_label, opts) => {
    const { app, db } = build();
    const agent = request.agent(app);
    const res = await post(agent, '/api/auth/register', { email: 'a@b.co', password: PASSWORD }, await csrfOf(agent), opts);
    expectError(res, 403, 'FORBIDDEN_ORIGIN');
    expect(count(db, 'users')).toBe(0);
  });

  it('token ausente, erróneo o de otra sesión → 403 CSRF_INVALID', async () => {
    const { app, db } = build();
    const agent = request.agent(app);
    const own = await csrfOf(agent);
    const foreign = await csrfOf(request.agent(app));
    for (const token of [undefined, 'x', `${own}x`, foreign]) {
      expectError(await post(agent, '/api/auth/register', { email: 'a@b.co', password: PASSWORD }, token), 403, 'CSRF_INVALID');
    }
    // Sin presesión no hay token válido posible.
    expectError(await post(request(app), '/api/auth/login', { email: 'a@b.co', password: PASSWORD }, own), 403, 'CSRF_INVALID');
    expect(count(db, 'users')).toBe(0);
  });

  it.each([
    ['text/plain', 'text/plain'],
    ['formulario', 'application/x-www-form-urlencoded'],
    ['sin tipo', null],
    ['charset no UTF-8', 'application/json; charset=latin1'],
  ])('tipo %s → 415', async (_label, type) => {
    const { app } = build();
    const agent = request.agent(app);
    const res = await post(agent, '/api/auth/login', JSON.stringify({ email: 'a@b.co', password: PASSWORD }), await csrfOf(agent), { type });
    expectError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('cuerpo mayor de 16 KiB → 413 y JSON inválido → 400', async () => {
    const { app } = build();
    const agent = request.agent(app);
    const token = await csrfOf(agent);
    const big = JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(16 * 1024) });
    expectError(await post(agent, '/api/auth/register', big, token), 413, 'PAYLOAD_TOO_LARGE');
    expectError(await post(agent, '/api/auth/register', '{"email":', token), 400, 'INVALID_JSON');
    expectError(await post(agent, '/api/auth/register', 'null', token), 400, 'INVALID_JSON');
    expectError(await post(agent, '/api/auth/register', '', token), 400, 'VALIDATION_ERROR');
  });

  it('los errores de catálogo previos no cambian', async () => {
    const { app } = build();
    const res = await request(app).get('/api/alternatives/%E0%A4%A');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ID');
    expect((await request(app).post('/api/catalog').send({})).body.error.code).toBe('NOT_FOUND');
  });

  it('métodos no soportados en auth responden 404 sin caché', async () => {
    const { app } = build();
    expectError(await request(app).get('/api/auth/login'), 404, 'NOT_FOUND');
    expectError(await request(app).delete('/api/auth/session'), 404, 'NOT_FOUND');
  });
});

describe('POST /api/auth/logout', () => {
  it('destruye la sesión, limpia la cookie y la sesión anterior no autoriza', async () => {
    const { app, db } = build();
    const agent = request.agent(app);
    const reg = await register(agent);
    const oldCookie = cookiePair(sessionCookie(reg));
    const oldToken = reg.body.csrfToken;

    const res = await post(agent, '/api/auth/logout', {}, oldToken);
    expect(res.status).toBe(204);
    expect(res.headers['cache-control']).toBe('no-store');
    const cleared = sessionCookie(res);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(cleared).toMatch(/Path=\//);
    expect(cleared).toMatch(/HttpOnly/);
    expect(cleared).toMatch(/SameSite=Lax/);
    expect(count(db, 'sessions')).toBe(0);

    // Reutilizar cookie y token antiguos no autoriza nada.
    const replay = request(app);
    expectError(await post(replay, '/api/auth/logout', {}, oldToken, { cookie: oldCookie }), 401, 'UNAUTHENTICATED');
    expectError(
      await post(replay, '/api/auth/login', { email: 'ana@example.com', password: PASSWORD }, oldToken, { cookie: oldCookie }),
      403,
      'CSRF_INVALID',
    );
    const after = await request(app).get('/api/auth/session').set('Cookie', oldCookie);
    expect(after.body.user).toBeNull();
    expect(after.body.csrfToken).not.toBe(oldToken);
  });

  it('sin sesión autenticada responde 401, también con presesión y token válidos', async () => {
    const { app } = build();
    const agent = request.agent(app);
    expectError(await post(agent, '/api/auth/logout', {}, await csrfOf(agent)), 401, 'UNAUTHENTICATED');
  });

  it('exige CSRF y cuerpo vacío', async () => {
    const { app } = build();
    const agent = request.agent(app);
    const reg = await register(agent);
    expectError(await post(agent, '/api/auth/logout', {}, 'otro'), 403, 'CSRF_INVALID');
    expectError(await post(agent, '/api/auth/logout', { userId: 'x' }, reg.body.csrfToken), 400, 'VALIDATION_ERROR');
    expect((await agent.get('/api/auth/session')).body.user).not.toBeNull();
  });
});

describe('expiración con reloj inyectado', () => {
  it('30 min de inactividad invalidan la sesión; la actividad la renueva', async () => {
    const { app, db } = build();
    const agent = request.agent(app);
    const reg = await register(agent);
    clock += 29 * MINUTE;
    expect((await agent.get('/api/auth/session')).body.user).toEqual(reg.body.user);
    clock += 29 * MINUTE;
    expect((await agent.get('/api/auth/session')).body.user).toEqual(reg.body.user);
    clock += 30 * MINUTE;
    const expired = await agent.get('/api/auth/session');
    expect(expired.body.user).toBeNull();
    expect(expired.body.csrfToken).not.toBe(reg.body.csrfToken);
    expectError(await post(agent, '/api/auth/logout', {}, reg.body.csrfToken), 401, 'UNAUTHENTICATED');
    expect(count(db, 'users')).toBe(1);
  });

  it('el límite absoluto de 24 h vence aunque haya actividad continua', async () => {
    const { app } = build();
    const agent = request.agent(app);
    const reg = await register(agent);
    const start = clock;
    while (clock + 25 * MINUTE < start + ABSOLUTE_TIMEOUT_MS) {
      clock += 25 * MINUTE;
      expect((await agent.get('/api/auth/session')).body.user).toEqual(reg.body.user);
    }
    clock = start + ABSOLUTE_TIMEOUT_MS;
    expect((await agent.get('/api/auth/session')).body.user).toBeNull();
  });

  it('la cookie no promete más vida que el límite absoluto', async () => {
    const { app, db } = build();
    const agent = request.agent(app);
    await register(agent);
    clock += ABSOLUTE_TIMEOUT_MS - 10 * MINUTE;
    // Simula actividad continua: la fila sigue dentro de su ventana de inactividad.
    db.prepare('UPDATE sessions SET expires_at = ?').run(clock + 10 * MINUTE);
    const res = await agent.get('/api/auth/session');
    expect(res.body.user).not.toBeNull();
    const expires = Date.parse(/Expires=([^;]+)/.exec(sessionCookie(res))[1]);
    expect(expires - Date.now()).toBeLessThanOrEqual(10 * MINUTE + 1000);
  });

  it('la limpieza al arrancar elimina sesiones vencidas', async () => {
    const path = join(dir, 'limpieza.sqlite');
    const first = build({ path });
    await register(request.agent(first.app));
    expect(count(first.db, 'sessions')).toBe(1);
    first.auth.close();
    first.db.close();
    clock += IDLE_TIMEOUT_MS + 1;
    const second = build({ path });
    expect(count(second.db, 'sessions')).toBe(0);
  });
});

describe('persistencia', () => {
  it('la sesión y la cuenta sobreviven a reabrir la DB y recrear la app', async () => {
    const path = join(dir, 'persist.sqlite');
    const first = build({ path });
    const reg = await register(request.agent(first.app));
    const cookie = cookiePair(sessionCookie(reg));
    first.auth.close();
    first.db.close();

    clock += 5 * MINUTE;
    const second = build({ path });
    const me = await request(second.app).get('/api/auth/session').set('Cookie', cookie);
    expect(me.body).toEqual({ user: reg.body.user, csrfToken: reg.body.csrfToken });
    const out = await post(request(second.app), '/api/auth/logout', {}, reg.body.csrfToken, { cookie });
    expect(out.status).toBe(204);
    expect((await login(request.agent(second.app))).body.user).toEqual(reg.body.user);
  });

  it('una cookie firmada con otro secreto no autentica', async () => {
    const path = join(dir, 'secreto.sqlite');
    const first = build({ path });
    const reg = await register(request.agent(first.app));
    const cookie = cookiePair(sessionCookie(reg));
    first.auth.close();
    first.db.close();
    const second = build({ path, sessionSecret: randomBytes(32).toString('hex') });
    expect((await request(second.app).get('/api/auth/session').set('Cookie', cookie)).body.user).toBeNull();
  });
});

describe('errores internos', () => {
  it('un fallo de DB responde 500 genérico sin SQL ni secretos', async () => {
    const { app, db, logger } = build();
    const agent = request.agent(app);
    const token = await csrfOf(agent);
    db.close();
    const res = await post(agent, '/api/auth/login', { email: 'a@b.co', password: PASSWORD }, token);
    expectError(res, 500, 'INTERNAL_ERROR');
    expect(res.text).not.toContain(SECRET);
    expect(logger.error).toHaveBeenCalled();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(PASSWORD);
  });
});
