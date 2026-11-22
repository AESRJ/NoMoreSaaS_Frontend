import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { DEFAULT_CATALOG_PATH, loadCatalog, validateCatalog } from '../src/catalog.js';
import { migrate, openDatabase } from '../src/db.js';
import { createProjects } from '../src/projects.js';
import { PROFILE_FIELDS, parseProfile } from '../src/workflow.js';
import { validCatalog } from './fixtures.js';

// Perfil y documento workflow (T002). DB SQLite temporal por prueba; hasher
// determinista rápido como en projects.test.js.
const ORIGIN = 'http://127.0.0.1:5573';
const SECRET = randomBytes(32).toString('hex');
const PASSWORD = 'una contraseña larga y segura';
const catalog = validateCatalog(validCatalog(), { today: '2026-11-20' });
const fakeHash = (password) => `$argon2id$v=19$test$${Buffer.from(password, 'utf8').toString('base64')}`;
const fakeHasher = {
  hash: async (password) => fakeHash(password),
  verify: async (password, encoded) => encoded === fakeHash(password),
  verifyDummy: async () => false,
};

const PROFILE = Object.freeze({
  cpuCores: 4,
  ramGiB: 7.5,
  storageGiB: 500,
  os: 'linux',
  architecture: 'amd64',
  storageKind: 'ssd',
  users: 3,
  dataGiB: 120,
  access: 'internet',
  hasDomain: true,
  cpuFeaturesKnown: false,
});
const EMPTY_PROGRESS = { completedStepIds: [], stale: false, updatedAt: null };

let dir;
let clock;
const opened = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nomoresaas-workflow-'));
  clock = Date.parse('2026-11-22T10:00:00.000Z');
});

afterEach(() => {
  for (const { auth, db } of opened.splice(0)) {
    auth.close();
    if (db.isOpen) db.close();
  }
  rmSync(dir, { recursive: true, force: true });
});

function build({ path = join(dir, 'wf.sqlite'), fresh = true, catalogData = catalog } = {}) {
  const db = openDatabase(path);
  if (fresh) migrate(db);
  const now = () => clock;
  const auth = createAuth({ db, sessionSecret: SECRET, appOrigin: ORIGIN, cookieSecure: false, now, hasher: fakeHasher });
  const projects = createProjects({ db, catalog: catalogData, auth, now });
  opened.push({ auth, db });
  return { app: createApp({ catalog: catalogData, logger: { error: vi.fn() }, auth, projects }), db, auth };
}

function send(agent, method, path, body, token, { origin = ORIGIN } = {}) {
  let req = agent[method](path).set('Content-Type', 'application/json');
  if (origin) req = req.set('Origin', origin);
  if (token) req = req.set('X-CSRF-Token', token);
  return req.send(JSON.stringify(body));
}

async function signUp(app, email) {
  const agent = request.agent(app);
  const pre = (await agent.get('/api/auth/session')).body.csrfToken;
  const res = await send(agent, 'post', '/api/auth/register', { email, password: PASSWORD }, pre);
  expect(res.status).toBe(201);
  const cookie = res.headers['set-cookie'].find((c) => c.startsWith('nomoresaas.sid=')).split(';')[0];
  return { agent, token: res.body.csrfToken, cookie };
}

async function newProject(who) {
  const res = await send(who.agent, 'post', '/api/projects', { name: 'Mi nube', alternativeIds: ['otra'] }, who.token);
  expect(res.status).toBe(201);
  return res.body.project.id;
}

const putProfile = (who, id, body, token = who.token, opts) => send(who.agent, 'put', `/api/projects/${id}/profile`, body, token, opts);
const getWorkflow = (who, id) => who.agent.get(`/api/projects/${id}/workflow`);

function expectNoLeak(res) {
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.text).not.toMatch(/SELECT|INSERT|sqlite|constraint|owner_id|ownerId|password|csrf/i);
}

describe('GET /api/projects/:id/workflow', () => {
  it('proyecto propio sin perfil: estado vacío normal con evaluación/plan null y avance vacío', async () => {
    const { app } = build();
    const ana = await signUp(app, 'ana@example.com');
    const id = await newProject(ana);
    const res = await getWorkflow(ana, id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ profile: null, evaluation: null, plan: null, progress: EMPTY_PROGRESS });
    expectNoLeak(res);
  });

  it('sin sesión 401; ID inválido 400; inexistente 404', async () => {
    const { app } = build();
    const ana = await signUp(app, 'ana@example.com');
    const id = await newProject(ana);
    const anon = await request(app).get(`/api/projects/${id}/workflow`);
    expect(anon.status).toBe(401);
    expect(anon.body.error.code).toBe('UNAUTHENTICATED');
    expect((await getWorkflow(ana, 'no-uuid')).status).toBe(400);
    const missing = await getWorkflow(ana, '00000000-0000-4000-8000-000000000000');
    expect(missing.status).toBe(404);
  });
});

describe('PUT /api/projects/:id/profile', () => {
  it('guarda, devuelve el documento workflow y persiste tras reiniciar con la misma DB', async () => {
    const path = join(dir, 'persist.sqlite');
    const first = build({ path });
    const ana = await signUp(first.app, 'ana@example.com');
    const id = await newProject(ana);

    const res = await putProfile(ana, id, PROFILE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      profile: { projectId: id, ...PROFILE, revision: 1 },
      // El fixture no tiene reglas: evaluación pendiente con requisitos desconocidos (T003).
      evaluation: expect.objectContaining({ status: 'pending', rulesVersion: expect.any(String) }),
      // Sin reglas ni plantillas para el fixture: plan bloqueado y sin pasos (T004).
      plan: expect.objectContaining({ blocked: true, steps: [] }),
      progress: EMPTY_PROGRESS,
    });
    expectNoLeak(res);
    first.auth.close();
    first.db.close();

    const second = build({ path, fresh: false });
    const again = await request(second.app).get(`/api/projects/${id}/workflow`).set('Cookie', ana.cookie);
    expect(again.status).toBe(200);
    expect(again.body.profile).toEqual({ projectId: id, ...PROFILE, revision: 1 });
  });

  it('sin cambios conserva la revisión; un cambio la incrementa', async () => {
    const { app } = build();
    const ana = await signUp(app, 'ana@example.com');
    const id = await newProject(ana);
    expect((await putProfile(ana, id, PROFILE)).body.profile.revision).toBe(1);
    expect((await putProfile(ana, id, { ...PROFILE })).body.profile.revision).toBe(1);
    const changed = await putProfile(ana, id, { ...PROFILE, ramGiB: 16, hasDomain: false });
    expect(changed.body.profile).toMatchObject({ ramGiB: 16, hasDomain: false, revision: 2 });
    expect((await getWorkflow(ana, id)).body.profile.revision).toBe(2);
  });

  it('rechaza perfiles inválidos con 400 y errores por campo, sin escribir nada', async () => {
    const { app, db } = build();
    const ana = await signUp(app, 'ana@example.com');
    const id = await newProject(ana);
    const cases = [
      [{ ...PROFILE, cpuCores: 0 }, 'cpuCores'],
      [{ ...PROFILE, cpuCores: 2.5 }, 'cpuCores'],
      [{ ...PROFILE, cpuCores: 257 }, 'cpuCores'],
      [{ ...PROFILE, ramGiB: 0.25 }, 'ramGiB'],
      [{ ...PROFILE, ramGiB: '8' }, 'ramGiB'],
      [{ ...PROFILE, storageGiB: 0 }, 'storageGiB'],
      [{ ...PROFILE, os: 'android' }, 'os'],
      [{ ...PROFILE, architecture: 'x86' }, 'architecture'],
      [{ ...PROFILE, storageKind: 'nvme' }, 'storageKind'],
      [{ ...PROFILE, users: 10001 }, 'users'],
      [{ ...PROFILE, dataGiB: -1 }, 'dataGiB'],
      [{ ...PROFILE, access: 'vpn' }, 'access'],
      [{ ...PROFILE, hasDomain: 'true' }, 'hasDomain'],
      [{ ...PROFILE, cpuFeaturesKnown: 1 }, 'cpuFeaturesKnown'],
      [{ ...PROFILE, projectId: id }, 'projectId'],
      [{ ...PROFILE, revision: 9 }, 'revision'],
      [{ ...PROFILE, ownerId: 'x' }, 'ownerId'],
    ];
    for (const [body, field] of cases) {
      const res = await putProfile(ana, id, body);
      expect(res.status, field).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(Object.keys(res.body.error.fields), field).toEqual([field]);
    }
    const missing = { ...PROFILE };
    delete missing.cpuCores;
    const incomplete = await putProfile(ana, id, missing);
    expect(incomplete.body.error.fields).toEqual({ cpuCores: 'Campo obligatorio.' });
    const several = await putProfile(ana, id, { ...PROFILE, users: 0, os: 'x' });
    expect(Object.keys(several.body.error.fields).sort()).toEqual(['os', 'users']);
    expect((await putProfile(ana, id, [])).status).toBe(400);
    expect(db.prepare('SELECT count(*) AS n FROM project_profiles').get().n).toBe(0);
  });

  it('rechaza claves especiales (__proto__/constructor/prototype) como campos extra, sin contaminar prototipos', async () => {
    const valid = JSON.stringify(PROFILE).slice(0, -1);
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const raw = `${valid},"${key}":{"polluted":true}}`;
      const parsed = JSON.parse(raw);
      expect(Object.hasOwn(parsed, key)).toBe(true);
      let error;
      try {
        parseProfile(parsed);
      } catch (caught) {
        error = caught;
      }
      expect(error?.code, key).toBe('VALIDATION_ERROR');
      expect(Object.keys(error.fields)).toEqual([key]);
    }

    const { app, db } = build();
    const ana = await signUp(app, 'ana@example.com');
    const id = await newProject(ana);
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const res = await ana.agent
        .put(`/api/projects/${id}/profile`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', ana.token)
        .set('Content-Type', 'application/json')
        .send(`${valid},"${key}":{"polluted":true}}`);
      expect(res.status, key).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(Object.keys(res.body.error.fields)).toEqual([key]);
      expect(res.body.error.fields[key]).toBe('Campo no permitido.');
    }
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
    expect(db.prepare('SELECT count(*) AS n FROM project_profiles').get().n).toBe(0);
  });

  it('acepta los límites inclusivos del modelo', async () => {
    const { app } = build();
    const ana = await signUp(app, 'ana@example.com');
    const id = await newProject(ana);
    const min = { ...PROFILE, cpuCores: 1, ramGiB: 0.5, storageGiB: 1, users: 1, dataGiB: 0, os: 'unknown', architecture: 'unknown', storageKind: 'unknown', access: 'local' };
    expect((await putProfile(ana, id, min)).status).toBe(200);
    const max = { ...PROFILE, cpuCores: 256, ramGiB: 4096, storageGiB: 100000, users: 10000, dataGiB: 100000 };
    expect((await putProfile(ana, id, max)).body.profile).toMatchObject({ cpuCores: 256, users: 10000, revision: 2 });
  });

  it('CSRF/Origin inválidos 403, tipo 415, sin sesión 401; nada se escribe', async () => {
    const { app, db } = build();
    const ana = await signUp(app, 'ana@example.com');
    const id = await newProject(ana);
    expect((await putProfile(ana, id, PROFILE, 'token-falso')).status).toBe(403);
    expect((await putProfile(ana, id, PROFILE, ana.token, { origin: 'http://evil.example' })).status).toBe(403);
    const wrongType = await ana.agent.put(`/api/projects/${id}/profile`).set('Origin', ORIGIN).set('X-CSRF-Token', ana.token).set('Content-Type', 'text/plain').send('x');
    expect(wrongType.status).toBe(415);
    const anon = request.agent(app);
    const pre = (await anon.get('/api/auth/session')).body.csrfToken;
    expect((await send(anon, 'put', `/api/projects/${id}/profile`, PROFILE, pre)).status).toBe(401);
    expect(db.prepare('SELECT count(*) AS n FROM project_profiles').get().n).toBe(0);
  });

  it('dos usuarios: B no lee ni escribe el perfil de A (404 indistinguible) y A no cambia', async () => {
    const { app } = build();
    const ana = await signUp(app, 'ana@example.com');
    const bea = await signUp(app, 'bea@example.com');
    const idA = await newProject(ana);
    await putProfile(ana, idA, PROFILE);

    const read = await getWorkflow(bea, idA);
    expect(read.status).toBe(404);
    expect(read.body.error.code).toBe('NOT_FOUND');
    expect(read.text).not.toContain('7.5');
    const write = await putProfile(bea, idA, { ...PROFILE, cpuCores: 64 });
    expect(write.status).toBe(404);
    const missing = await putProfile(bea, '00000000-0000-4000-8000-000000000000', PROFILE);
    expect(write.body).toEqual(missing.body);

    const idB = await newProject(bea);
    expect((await getWorkflow(bea, idB)).body.profile).toBeNull();
    expect((await getWorkflow(ana, idA)).body.profile).toEqual({ projectId: idA, ...PROFILE, revision: 1 });
  });

  it('borrar el proyecto elimina su perfil en cascada', async () => {
    const { app, db } = build();
    const ana = await signUp(app, 'ana@example.com');
    const id = await newProject(ana);
    await putProfile(ana, id, PROFILE);
    expect((await send(ana.agent, 'delete', `/api/projects/${id}`, {}, ana.token)).status).toBe(204);
    expect(db.prepare('SELECT count(*) AS n FROM project_profiles').get().n).toBe(0);
  });

  it('seed real: PUT/GET devuelven la misma evaluación y cambiar el equipo la recalcula (insuficiente)', async () => {
    const seed = await loadCatalog(DEFAULT_CATALOG_PATH, { requireSeedCoverage: true });
    const { app } = build({ catalogData: seed });
    const ana = await signUp(app, 'ana@example.com');
    const created = await send(ana.agent, 'post', '/api/projects', { name: 'Equipo', alternativeIds: ['nextcloud', 'wireguard'] }, ana.token);
    const id = created.body.project.id;
    const local = { ...PROFILE, access: 'local', cpuFeaturesKnown: true };
    const put = await putProfile(ana, id, local);
    expect(put.body.evaluation).toMatchObject({ status: 'viable', rulesVersion: '2026-11-22.1' });
    expect(put.body.evaluation.totals.ramGiB).toEqual({ base: 2.25, required: 2.81, available: 7.5 });
    expect((await getWorkflow(ana, id)).body.evaluation).toEqual(put.body.evaluation);
    const small = await putProfile(ana, id, { ...local, ramGiB: 2, storageGiB: 10 });
    expect(small.body.evaluation.status).toBe('insufficient');
    expect(small.body.evaluation.warnings.slice(0, 2).map((w) => w.code)).toEqual(['ram-insufficient', 'disk-insufficient']);
  });

  it('PROFILE_FIELDS coincide con los campos editables del modelo', () => {
    expect([...PROFILE_FIELDS].sort()).toEqual(Object.keys(PROFILE).sort());
  });
});
