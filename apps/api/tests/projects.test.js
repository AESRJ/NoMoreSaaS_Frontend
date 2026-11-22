import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { DEFAULT_CATALOG_PATH, loadCatalog, validateCatalog } from '../src/catalog.js';
import { migrate, openDatabase } from '../src/db.js';
import { PROJECT_QUOTA, createProjects } from '../src/projects.js';
import { startServer } from '../src/server.js';
import { validAlternative, validCatalog } from './fixtures.js';

// Cada prueba usa su propio archivo SQLite temporal y un reloj inyectado.
// El hasher Argon2 real se cubre en auth.test.js; aquí se usa uno determinista
// rápido (mismo formato aceptado por el CHECK de users.password_hash).
const ORIGIN = 'http://127.0.0.1:5573';
const SECRET = randomBytes(32).toString('hex');
const PASSWORD = 'una contraseña larga y segura';
const MINUTE = 60 * 1000;
const catalog = validateCatalog(validCatalog(), { today: '2026-11-20' });

const fakeHash = (password) => `$argon2id$v=19$test$${Buffer.from(password, 'utf8').toString('base64')}`;
const fakeHasher = {
  hash: async (password) => fakeHash(password),
  verify: async (password, encoded) => encoded === fakeHash(password),
  verifyDummy: async () => false,
};

let dir;
let clock;
const opened = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nomoresaas-projects-'));
  clock = Date.parse('2026-11-21T10:00:00.000Z');
});

afterEach(() => {
  for (const { auth, db } of opened.splice(0)) {
    auth.close();
    if (db.isOpen) db.close();
  }
  rmSync(dir, { recursive: true, force: true });
});

function build({ path = join(dir, 'projects.sqlite'), fresh = true, catalogData = catalog } = {}) {
  const db = openDatabase(path);
  if (fresh) migrate(db);
  const now = () => clock;
  const auth = createAuth({ db, sessionSecret: SECRET, appOrigin: ORIGIN, cookieSecure: false, now, hasher: fakeHasher });
  const projects = createProjects({ db, catalog: catalogData, auth, now });
  const logger = { error: vi.fn() };
  opened.push({ auth, db });
  return { app: createApp({ catalog: catalogData, logger, auth, projects }), db, auth, logger };
}

const count = (db, table) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;

async function csrfOf(agent) {
  const res = await agent.get('/api/auth/session');
  expect(res.status).toBe(200);
  return res.body.csrfToken;
}

/** Mutación con Origin/JSON/CSRF válidos salvo que se indique otra cosa. */
function send(agent, method, path, body, token, { origin = ORIGIN, type = 'application/json' } = {}) {
  let req = agent[method](path);
  if (origin !== null) req = req.set('Origin', origin);
  if (token) req = req.set('X-CSRF-Token', token);
  if (type) req = req.set('Content-Type', type);
  return req.send(typeof body === 'string' ? body : JSON.stringify(body));
}

/** Registra un usuario en su propio agente (cookie jar) y devuelve agente + CSRF autenticado. */
async function signUp(app, email) {
  const agent = request.agent(app);
  const res = await send(agent, 'post', '/api/auth/register', { email, password: PASSWORD }, await csrfOf(agent));
  expect(res.status).toBe(201);
  const cookie = res.headers['set-cookie'].find((c) => c.startsWith('nomoresaas.sid=')).split(';')[0];
  return { agent, token: res.body.csrfToken, user: res.body.user, cookie };
}

const createProject = (who, body) => send(who.agent, 'post', '/api/projects', body, who.token);
const VALID = { name: 'Mi nube', description: 'Fotos y archivos', alternativeIds: ['otra', 'alt-uno'] };

function expectError(res, status, code) {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.body).toEqual({ error: { code, message: expect.any(String) } });
  expect(res.text).not.toMatch(/SELECT|INSERT|UPDATE|DELETE FROM|sqlite|constraint|owner_id|at \w+ \(|node_modules/i);
}

// ---------------------------------------------------------------------------
describe('acceso y guardas', () => {
  it('sin sesión: 401 en todos los endpoints de proyectos', async () => {
    const { app } = build();
    const agent = request.agent(app);
    const token = await csrfOf(agent); // presesión sin usuario
    const id = randomUUID();
    expectError(await agent.get('/api/projects'), 401, 'UNAUTHENTICATED');
    expectError(await agent.get(`/api/projects/${id}`), 401, 'UNAUTHENTICATED');
    expectError(await send(agent, 'post', '/api/projects', VALID, token), 401, 'UNAUTHENTICATED');
    expectError(await send(agent, 'patch', `/api/projects/${id}`, { name: 'Otro' }, token), 401, 'UNAUTHENTICATED');
    expectError(await send(agent, 'delete', `/api/projects/${id}`, {}, token), 401, 'UNAUTHENTICATED');
    expectError(await request(app).get('/api/projects'), 401, 'UNAUTHENTICATED');
  });

  it('CSRF y origen: 403 sin token, token ajeno, token antiguo u origen distinto; nada se escribe', async () => {
    const { app, db } = build();
    const ana = await signUp(app, 'ana@example.com');
    expectError(await send(ana.agent, 'post', '/api/projects', VALID, null), 403, 'CSRF_INVALID');
    expectError(await send(ana.agent, 'post', '/api/projects', VALID, 'x'.repeat(43)), 403, 'CSRF_INVALID');
    expectError(await send(ana.agent, 'post', '/api/projects', VALID, ana.token, { origin: 'http://evil.example' }), 403, 'FORBIDDEN_ORIGIN');
    expectError(await send(ana.agent, 'post', '/api/projects', VALID, ana.token, { origin: null }), 403, 'FORBIDDEN_ORIGIN');

    // Tras volver a entrar, el CSRF de la sesión anterior ya no sirve.
    const relog = await send(ana.agent, 'post', '/api/auth/login', { email: 'ana@example.com', password: PASSWORD }, ana.token);
    expect(relog.status).toBe(200);
    expectError(await send(ana.agent, 'post', '/api/projects', VALID, ana.token), 403, 'CSRF_INVALID');
    expect(count(db, 'projects')).toBe(0);
    expect((await send(ana.agent, 'post', '/api/projects', VALID, relog.body.csrfToken)).status).toBe(201);
  });

  it('errores del parser en /api/projects: JSON 400, tamaño 413, tipo 415 (nunca 500)', async () => {
    const { app, db, logger } = build();
    const ana = await signUp(app, 'ana@example.com');
    const created = await createProject(ana, VALID);
    const path = `/api/projects/${created.body.project.id}`;
    for (const [method, target] of [
      ['post', '/api/projects'],
      ['patch', path],
      ['delete', path],
    ]) {
      expectError(await send(ana.agent, method, target, '{"name": ', ana.token), 400, 'INVALID_JSON');
      expectError(await send(ana.agent, method, target, '"texto"', ana.token), 400, 'INVALID_JSON');
      expectError(
        await send(ana.agent, method, target, JSON.stringify({ name: 'x'.repeat(17 * 1024) }), ana.token),
        413,
        'PAYLOAD_TOO_LARGE',
      );
      expectError(await send(ana.agent, method, target, JSON.stringify(VALID), ana.token, { type: 'text/plain' }), 415, 'UNSUPPORTED_MEDIA_TYPE');
      expectError(await send(ana.agent, method, target, JSON.stringify(VALID), ana.token, { type: null }), 415, 'UNSUPPORTED_MEDIA_TYPE');
      expectError(
        await send(ana.agent, method, target, JSON.stringify(VALID), ana.token, { type: 'application/json; charset=latin1' }),
        415,
        'UNSUPPORTED_MEDIA_TYPE',
      );
    }
    expect(logger.error).not.toHaveBeenCalled();
    expect(count(db, 'projects')).toBe(1);
  });

  it('createApp sin proyectos conserva el catálogo y no expone /api/projects', async () => {
    const app = createApp({ catalog, logger: { error() {} } });
    expect((await request(app).get('/api/catalog')).status).toBe(200);
    expectErrorNoCache(await request(app).get('/api/projects'), 404);
    expect(() => createApp({ catalog, projects: { router: () => {} } })).toThrow(/requiere auth/);
  });
});

function expectErrorNoCache(res, status) {
  expect(res.status).toBe(status);
  expect(res.body.error.code).toBe('NOT_FOUND');
}

// ---------------------------------------------------------------------------
describe('crear y validar', () => {
  it('crea con DTO del contrato, sin propietario, recortando textos y conservando el orden', async () => {
    const { app, db } = build();
    const ana = await signUp(app, 'ana@example.com');
    const res = await createProject(ana, { name: '  Mi nube  ', description: '\n Fotos \n', alternativeIds: ['otra', 'alt-uno'] });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const { project } = res.body;
    expect(Object.keys(project).sort()).toEqual(['alternativeIds', 'alternatives', 'createdAt', 'description', 'id', 'name', 'updatedAt']);
    expect(project).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      name: 'Mi nube',
      description: 'Fotos',
      alternativeIds: ['otra', 'alt-uno'],
      alternatives: [
        { id: 'otra', name: 'Otra', available: true },
        { id: 'alt-uno', name: 'Alternativa Uno', available: true },
      ],
      createdAt: '2026-11-21T10:00:00.000Z',
      updatedAt: '2026-11-21T10:00:00.000Z',
    });
    expect(res.text).not.toContain(ana.user.id);
    const row = db.prepare('SELECT owner_id FROM projects WHERE id = ?').get(project.id);
    expect(row.owner_id).toBe(ana.user.id);
    expect(db.prepare('SELECT alternative_id, position FROM project_selections ORDER BY position').all()).toEqual([
      { alternative_id: 'otra', position: 0 },
      { alternative_id: 'alt-uno', position: 1 },
    ]);
  });

  it('descripción opcional (vacía por defecto) y límites en puntos Unicode', async () => {
    const { app } = build();
    const ana = await signUp(app, 'ana@example.com');
    const minimal = await createProject(ana, { name: 'abc', alternativeIds: ['otra'] });
    expect(minimal.status).toBe(201);
    expect(minimal.body.project.description).toBe('');
    // 80 emoji = 80 puntos (160 unidades UTF-16) y 1000 emoji en la descripción.
    const wide = await createProject(ana, { name: '😀'.repeat(80), description: '😀'.repeat(1000), alternativeIds: ['otra'] });
    expect(wide.status).toBe(201);
    expect([...wide.body.project.name]).toHaveLength(80);
    const allIds = ['otra', 'alt-uno', 'cuarta', 'beta-alt'];
    expect((await createProject(ana, { name: 'Cuatro', alternativeIds: allIds })).status).toBe(201);
  });

  it.each([
    ['nombre corto', { ...VALID, name: '  ab  ' }],
    ['nombre largo', { ...VALID, name: '😀'.repeat(81) }],
    ['nombre ausente', { alternativeIds: ['otra'] }],
    ['nombre no texto', { ...VALID, name: 123 }],
    ['nombre con control', { ...VALID, name: 'Mi\u0000nube' }],
    ['nombre multilínea', { ...VALID, name: 'Mi\nnube' }],
    ['descripción larga', { ...VALID, description: '😀'.repeat(1001) }],
    ['descripción no texto', { ...VALID, description: null }],
    ['descripción con control', { ...VALID, description: 'a\u0007b' }],
    ['selección ausente', { name: 'Mi nube' }],
    ['selección vacía', { ...VALID, alternativeIds: [] }],
    ['selección no array', { ...VALID, alternativeIds: 'otra' }],
    ['más de 10', { ...VALID, alternativeIds: Array.from({ length: 11 }, (_, i) => `alt-${i}`) }],
    ['duplicados', { ...VALID, alternativeIds: ['otra', 'otra'] }],
    ['desconocida', { ...VALID, alternativeIds: ['otra', 'no-existe'] }],
    ['ID inválido', { ...VALID, alternativeIds: ['Otra'] }],
    ['ID no texto', { ...VALID, alternativeIds: [1] }],
    ['ownerId extra', { ...VALID, ownerId: randomUUID() }],
    ['id extra', { ...VALID, id: randomUUID() }],
    ['fechas extra', { ...VALID, createdAt: '2020-01-01T00:00:00.000Z' }],
    ['updatedAt extra', { ...VALID, updatedAt: '2020-01-01T00:00:00.000Z' }],
    ['cuerpo array', [VALID]],
  ])('400 por %s y nada se guarda', async (_label, body) => {
    const { app, db } = build();
    const ana = await signUp(app, 'ana@example.com');
    expectError(await createProject(ana, body), 400, 'VALIDATION_ERROR');
    expect(count(db, 'projects')).toBe(0);
    expect(count(db, 'project_selections')).toBe(0);
  });

  it('el propietario nunca sale de la query ni del cuerpo', async () => {
    const { app, db } = build();
    const ana = await signUp(app, 'ana@example.com');
    const bea = await signUp(app, 'bea@example.com');
    const res = await send(ana.agent, 'post', `/api/projects?ownerId=${bea.user.id}`, VALID, ana.token);
    expect(res.status).toBe(201);
    expect(db.prepare('SELECT owner_id FROM projects').get().owner_id).toBe(ana.user.id);
    expect((await bea.agent.get(`/api/projects?ownerId=${ana.user.id}`)).body.projects).toEqual([]);
  });

  it(`cupo de ${PROJECT_QUOTA} proyectos por cuenta: 409 sin escribir; otra cuenta no se ve afectada`, async () => {
    const { app, db } = build();
    const ana = await signUp(app, 'ana@example.com');
    const bea = await signUp(app, 'bea@example.com');
    const insert = db.prepare(
      "INSERT INTO projects (id, owner_id, name, description, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?)",
    );
    const at = '2026-11-20T00:00:00.000Z';
    for (let i = 0; i < PROJECT_QUOTA - 1; i += 1) insert.run(randomUUID(), ana.user.id, `Proyecto ${i}`, at, at);
    expect((await createProject(ana, VALID)).status).toBe(201); // el 100
    expectError(await createProject(ana, VALID), 409, 'PROJECT_LIMIT_REACHED');
    expect(db.prepare('SELECT count(*) AS n FROM projects WHERE owner_id = ?').get(ana.user.id).n).toBe(PROJECT_QUOTA);
    expect(count(db, 'project_selections')).toBe(2);
    const list = await ana.agent.get('/api/projects');
    expect(list.body.projects).toHaveLength(PROJECT_QUOTA);
    expect((await createProject(bea, VALID)).status).toBe(201);

    const victim = list.body.projects[0].id;
    expect((await send(ana.agent, 'delete', `/api/projects/${victim}`, {}, ana.token)).status).toBe(204);
    expect((await createProject(ana, VALID)).status).toBe(201);
  });

  it('rollback: si falla la selección no queda el proyecto ni parte de la selección', async () => {
    const { app, db, logger } = build();
    const ana = await signUp(app, 'ana@example.com');
    db.exec(`CREATE TEMP TRIGGER fail_selection BEFORE INSERT ON project_selections
             WHEN NEW.alternative_id = 'cuarta' BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END`);
    expectError(await createProject(ana, { ...VALID, alternativeIds: ['otra', 'cuarta'] }), 500, 'INTERNAL_ERROR');
    expect(logger.error).toHaveBeenCalled();
    expect(count(db, 'projects')).toBe(0);
    expect(count(db, 'project_selections')).toBe(0);
    expect(db.isTransaction).toBe(false);
    expect((await createProject(ana, VALID)).status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
describe('listar, leer, editar y borrar', () => {
  it('lista solo propios, por updatedAt descendente e id ascendente como desempate', async () => {
    const { app } = build();
    const ana = await signUp(app, 'ana@example.com');
    const bea = await signUp(app, 'bea@example.com');
    const a1 = (await createProject(ana, { ...VALID, name: 'Uno' })).body.project;
    const a2 = (await createProject(ana, { ...VALID, name: 'Dos' })).body.project; // mismo instante
    clock += MINUTE;
    const a3 = (await createProject(ana, { ...VALID, name: 'Tres' })).body.project;
    await createProject(bea, { ...VALID, name: 'De Bea' });

    const res = await ana.agent.get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const tie = [a1.id, a2.id].sort();
    expect(res.body.projects.map((p) => p.id)).toEqual([a3.id, ...tie]);
    expect(res.body.projects.every((p) => !('ownerId' in p))).toBe(true);
    expect(res.body.projects.map((p) => p.name)).not.toContain('De Bea');

    clock += MINUTE;
    await send(ana.agent, 'patch', `/api/projects/${a1.id}`, { name: 'Uno editado' }, ana.token);
    expect((await ana.agent.get('/api/projects')).body.projects[0].id).toBe(a1.id);
  });

  it('PATCH conserva campos omitidos, reemplaza la selección completa y avanza updatedAt', async () => {
    const { app, db } = build();
    const ana = await signUp(app, 'ana@example.com');
    const created = (await createProject(ana, VALID)).body.project;
    const path = `/api/projects/${created.id}`;
    clock += MINUTE;

    const renamed = await send(ana.agent, 'patch', path, { name: '  Nube nueva ' }, ana.token);
    expect(renamed.status).toBe(200);
    expect(renamed.body.project).toMatchObject({
      name: 'Nube nueva',
      description: VALID.description,
      alternativeIds: VALID.alternativeIds,
      createdAt: created.createdAt,
      updatedAt: '2026-11-21T10:01:00.000Z',
    });

    const reselected = await send(ana.agent, 'patch', path, { alternativeIds: ['beta-alt'], description: '' }, ana.token);
    expect(reselected.body.project).toMatchObject({ name: 'Nube nueva', description: '', alternativeIds: ['beta-alt'] });
    expect(db.prepare('SELECT alternative_id FROM project_selections').all()).toEqual([{ alternative_id: 'beta-alt' }]);
    expect((await ana.agent.get(path)).body.project).toEqual(reselected.body.project);
  });

  it('PATCH valida: vacío, extras (ownerId/id/fechas), selección inválida → 400 sin cambios', async () => {
    const { app, db } = build();
    const ana = await signUp(app, 'ana@example.com');
    const bea = await signUp(app, 'bea@example.com');
    const created = (await createProject(ana, VALID)).body.project;
    const path = `/api/projects/${created.id}`;
    for (const body of [
      {},
      { ownerId: bea.user.id },
      { name: 'Válido', ownerId: bea.user.id },
      { id: randomUUID() },
      { createdAt: '2020-01-01T00:00:00.000Z' },
      { name: 'ab' },
      { alternativeIds: [] },
      { alternativeIds: ['otra', 'no-existe'] },
      { alternativeIds: ['otra', 'otra'] },
      { name: null },
    ]) {
      expectError(await send(ana.agent, 'patch', path, body, ana.token), 400, 'VALIDATION_ERROR');
    }
    expect((await ana.agent.get(path)).body.project).toEqual(created);
    expect(db.prepare('SELECT owner_id FROM projects').get().owner_id).toBe(ana.user.id);
  });

  it('rollback de PATCH: si falla la nueva selección se conservan nombre y selección previos', async () => {
    const { app, db } = build();
    const ana = await signUp(app, 'ana@example.com');
    const created = (await createProject(ana, VALID)).body.project;
    db.exec(`CREATE TEMP TRIGGER fail_selection BEFORE INSERT ON project_selections
             WHEN NEW.alternative_id = 'cuarta' BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END`);
    clock += MINUTE;
    const res = await send(ana.agent, 'patch', `/api/projects/${created.id}`, { name: 'Cambiado', alternativeIds: ['beta-alt', 'cuarta'] }, ana.token);
    expectError(res, 500, 'INTERNAL_ERROR');
    expect((await ana.agent.get(`/api/projects/${created.id}`)).body.project).toEqual(created);
    expect(db.isTransaction).toBe(false);
  });

  it('DELETE: 204, borra selección en cascada, 404 después; exige cuerpo {} exacto', async () => {
    const { app, db } = build();
    const ana = await signUp(app, 'ana@example.com');
    const keep = (await createProject(ana, VALID)).body.project;
    const gone = (await createProject(ana, { ...VALID, alternativeIds: ['cuarta'] })).body.project;
    const path = `/api/projects/${gone.id}`;
    expectError(await send(ana.agent, 'delete', path, { confirm: true }, ana.token), 400, 'VALIDATION_ERROR');
    const res = await send(ana.agent, 'delete', path, {}, ana.token);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(db.prepare('SELECT count(*) AS n FROM project_selections WHERE project_id = ?').get(gone.id).n).toBe(0);
    expectError(await ana.agent.get(path), 404, 'NOT_FOUND');
    expectError(await send(ana.agent, 'delete', path, {}, ana.token), 404, 'NOT_FOUND');
    expect((await ana.agent.get('/api/projects')).body.projects.map((p) => p.id)).toEqual([keep.id]);
    expect(count(db, 'project_selections')).toBe(2);
  });

  it('ID no UUID → 400 INVALID_ID; UUID en mayúsculas se trata igual', async () => {
    const { app } = build();
    const ana = await signUp(app, 'ana@example.com');
    const created = (await createProject(ana, VALID)).body.project;
    for (const bad of ['abc', '123', `${created.id}x`, '%zz', 'null']) {
      expectError(await ana.agent.get(`/api/projects/${bad}`), 400, 'INVALID_ID');
      expectError(await send(ana.agent, 'patch', `/api/projects/${bad}`, { name: 'Otro' }, ana.token), 400, 'INVALID_ID');
      expectError(await send(ana.agent, 'delete', `/api/projects/${bad}`, {}, ana.token), 400, 'INVALID_ID');
    }
    expect((await ana.agent.get(`/api/projects/${created.id.toUpperCase()}`)).body.project.id).toBe(created.id);
  });
});

// ---------------------------------------------------------------------------
describe('aislamiento entre cuentas (A/B)', () => {
  it('B no lista, lee, edita ni borra proyectos de A: mismo 404 que un UUID inexistente; A intacto', async () => {
    const { app, db } = build();
    const ana = await signUp(app, 'ana@example.com');
    const bea = await signUp(app, 'bea@example.com');
    const p1 = (await createProject(ana, VALID)).body.project;
    const p2 = (await createProject(ana, { ...VALID, name: 'Segundo' })).body.project;

    expect((await bea.agent.get('/api/projects')).body).toEqual({ projects: [] });
    const missing = randomUUID();
    for (const id of [p1.id, p2.id]) {
      const pairs = [
        [await bea.agent.get(`/api/projects/${id}`), await bea.agent.get(`/api/projects/${missing}`)],
        [
          await send(bea.agent, 'patch', `/api/projects/${id}`, { name: 'Robado' }, bea.token),
          await send(bea.agent, 'patch', `/api/projects/${missing}`, { name: 'Robado' }, bea.token),
        ],
        [
          await send(bea.agent, 'delete', `/api/projects/${id}`, {}, bea.token),
          await send(bea.agent, 'delete', `/api/projects/${missing}`, {}, bea.token),
        ],
      ];
      for (const [foreign, absent] of pairs) {
        expectError(foreign, 404, 'NOT_FOUND');
        expect(foreign.body).toEqual(absent.body);
      }
    }
    // El token CSRF de A no autoriza a B ni al revés.
    expectError(await send(bea.agent, 'patch', `/api/projects/${p1.id}`, { name: 'Robado' }, ana.token), 403, 'CSRF_INVALID');

    const list = (await ana.agent.get('/api/projects')).body.projects;
    expect(list.map((p) => p.id).sort()).toEqual([p1.id, p2.id].sort());
    expect((await ana.agent.get(`/api/projects/${p1.id}`)).body.project).toEqual(p1);
    expect(count(db, 'projects')).toBe(2);
    expect(count(db, 'project_selections')).toBe(4);
  });

  it('tras logout la cookie antigua ya no da acceso a los proyectos', async () => {
    const { app } = build();
    const ana = await signUp(app, 'ana@example.com');
    const created = (await createProject(ana, VALID)).body.project;
    const { cookie } = ana;
    expect((await request(app).get('/api/projects').set('Cookie', cookie)).status).toBe(200);
    expect((await send(ana.agent, 'post', '/api/auth/logout', {}, ana.token)).status).toBe(204);
    expectError(await request(app).get('/api/projects').set('Cookie', cookie), 401, 'UNAUTHENTICATED');
    expectError(await request(app).get(`/api/projects/${created.id}`).set('Cookie', cookie), 401, 'UNAUTHENTICATED');
    expectError(await ana.agent.get('/api/projects'), 401, 'UNAUTHENTICATED');
  });

  it('sesión expirada (inactividad) → 401 sin datos', async () => {
    const { app } = build();
    const ana = await signUp(app, 'ana@example.com');
    await createProject(ana, VALID);
    clock += 31 * MINUTE;
    expectError(await ana.agent.get('/api/projects'), 401, 'UNAUTHENTICATED');
  });
});

// ---------------------------------------------------------------------------
describe('persistencia y catálogo cambiante', () => {
  it('proyectos y sesión sobreviven a reabrir la DB (reinicio de API)', async () => {
    const path = join(dir, 'persist.sqlite');
    const first = build({ path });
    const ana = await signUp(first.app, 'ana@example.com');
    const created = (await createProject(ana, VALID)).body.project;
    const { cookie } = ana;
    first.auth.close();
    first.db.close();

    const second = build({ path, fresh: false });
    const res = await request(second.app).get('/api/projects').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.projects).toEqual([created]);
  });

  it('alternativa retirada: available:false con ID, sin nombre inventado; se conserva y puede quitarse', async () => {
    const path = join(dir, 'retired.sqlite');
    const first = build({ path });
    const ana = await signUp(first.app, 'ana@example.com');
    const created = (await createProject(ana, { ...VALID, alternativeIds: ['otra', 'cuarta'] })).body.project;
    const { cookie, token } = ana;
    first.auth.close();
    first.db.close();

    // El catálogo publica una nueva versión sin 'cuarta' (ni su relación).
    const data = validCatalog();
    data.alternatives = data.alternatives.filter((a) => a.id !== 'cuarta');
    data.relations = data.relations.filter((r) => r.alternativeId !== 'cuarta');
    const second = build({ path, fresh: false, catalogData: validateCatalog(data, { today: '2026-11-20' }) });
    const agent = request.agent(second.app);
    const get = () => agent.get(`/api/projects/${created.id}`).set('Cookie', cookie);
    const patch = (body) =>
      agent.patch(`/api/projects/${created.id}`).set('Cookie', cookie).set('Origin', ORIGIN).set('X-CSRF-Token', token).set('Content-Type', 'application/json').send(JSON.stringify(body));

    expect((await get()).body.project.alternatives).toEqual([
      { id: 'otra', name: 'Otra', available: true },
      { id: 'cuarta', name: null, available: false },
    ]);
    // Editar otros campos conserva la referencia histórica.
    expect((await patch({ name: 'Renombrado' })).body.project.alternativeIds).toEqual(['otra', 'cuarta']);
    // Reenviarla en una selección nueva se rechaza; reemplazarla funciona.
    expectError(await patch({ alternativeIds: ['otra', 'cuarta'] }), 400, 'VALIDATION_ERROR');
    expect((await patch({ alternativeIds: ['otra'] })).body.project.alternatives).toEqual([{ id: 'otra', name: 'Otra', available: true }]);
  });

  it('seed vigente: un proyecto histórico con Gitea/Forgejo se conserva como no disponible', async () => {
    const path = join(dir, 'historic.sqlite');
    // Catálogo anterior (fixture) con los IDs retirados en 004.
    const old = validCatalog();
    old.alternatives.push(validAlternative({ id: 'gitea', name: 'Gitea' }), validAlternative({ id: 'forgejo', name: 'Forgejo' }));
    old.relations.push({ serviceId: 'zeta', alternativeId: 'gitea', coverage: 'x' }, { serviceId: 'zeta', alternativeId: 'forgejo', coverage: 'x' });
    const first = build({ path, catalogData: validateCatalog(old, { today: '2026-11-20' }) });
    const ana = await signUp(first.app, 'ana@example.com');
    const created = (await createProject(ana, { ...VALID, alternativeIds: ['gitea', 'forgejo'] })).body.project;
    first.auth.close();
    first.db.close();

    const seed = await loadCatalog(DEFAULT_CATALOG_PATH, { requireSeedCoverage: true });
    const second = build({ path, fresh: false, catalogData: seed });
    const res = await request(second.app).get(`/api/projects/${created.id}`).set('Cookie', ana.cookie);
    expect(res.status).toBe(200);
    expect(res.body.project.name).toBe(created.name);
    expect(res.body.project.alternatives).toEqual([
      { id: 'gitea', name: null, available: false },
      { id: 'forgejo', name: null, available: false },
    ]);
    const patch = await request(second.app)
      .patch(`/api/projects/${created.id}`)
      .set('Cookie', ana.cookie)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', ana.token)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ alternativeIds: ['wireguard', 'outline'] }));
    expect(patch.status).toBe(200);
    expect(patch.body.project.alternatives).toEqual([
      { id: 'wireguard', name: 'WireGuard', available: true },
      { id: 'outline', name: 'Outline', available: true },
    ]);
  });
});

// ---------------------------------------------------------------------------
describe('servidor real', () => {
  it('startServer monta /api/projects con la DB temporal configurada', async () => {
    const path = join(dir, 'server.sqlite');
    const db = openDatabase(path);
    migrate(db);
    db.close();
    const server = await startServer({
      port: 0,
      env: { DATABASE_PATH: path, SESSION_SECRET: SECRET, APP_ORIGIN: ORIGIN },
      logger: { error() {} },
    });
    try {
      expectError(await request(server).get('/api/projects'), 401, 'UNAUTHENTICATED');
      expect((await request(server).get('/api/catalog')).status).toBe(200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
