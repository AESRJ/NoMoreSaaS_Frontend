import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { DEFAULT_CATALOG_PATH, loadCatalog } from '../src/catalog.js';
import { migrate, openDatabase } from '../src/db.js';
import { evaluate, loadRules } from '../src/evaluation.js';
import { buildPlan, planFingerprint } from '../src/plan.js';
import { STAGES, STEP_BLOCKS, TEMPLATES, TEMPLATES_VERSION } from '../src/plan-templates.js';
import { createProjects } from '../src/projects.js';
import { parseProgress } from '../src/workflow.js';

// Plan, prompts y avance (T004) con catálogo, reglas y plantillas reales.
// Cada prueba HTTP usa su propia DB SQLite temporal.
const catalog = await loadCatalog(DEFAULT_CATALOG_PATH, { requireSeedCoverage: true });
const catalogNames = new Map(catalog.alternatives.map((a) => [a.id, a.name]));
const rules = loadRules();
const ALL = ['nextcloud', 'immich', 'matrix-synapse', 'wireguard', 'outline'];
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE = Object.freeze({
  cpuCores: 16,
  ramGiB: 64,
  storageGiB: 2000,
  os: 'linux',
  architecture: 'amd64',
  storageKind: 'ssd',
  users: 4,
  dataGiB: 300,
  access: 'local',
  hasDomain: true,
  cpuFeaturesKnown: true,
});

function plan({ alternativeIds = ['nextcloud', 'wireguard'], profile = { ...PROFILE, revision: 1 }, name = 'Casa', ruleSet = rules } = {}) {
  const evaluation = evaluate({ profile, alternativeIds, catalogNames, rules: ruleSet });
  return buildPlan({ projectId: PROJECT_ID, projectName: name, alternativeIds, profile, evaluation, catalogNames });
}

describe('buildPlan', () => {
  it('sin perfil no hay plan (estado vacío)', () => {
    expect(buildPlan({ projectId: PROJECT_ID, projectName: 'x', alternativeIds: ['nextcloud'], profile: null, evaluation: null, catalogNames })).toBeNull();
  });

  it('las cinco alternativas tienen preparación/instalación/comprobación/recuperación con fuentes oficiales HTTPS', () => {
    const p = plan({ alternativeIds: ALL });
    expect(p.steps).toHaveLength(ALL.length * STAGES.length);
    expect(p.steps.map((s) => s.id)).toEqual(ALL.flatMap((alt) => STAGES.map((stage) => `${alt}.${stage}`)));
    for (const step of p.steps) {
      expect(step.sources.length, step.id).toBeGreaterThan(0);
      expect(step.sources.every((s) => s.url.startsWith('https://'))).toBe(true);
      expect(step.tasks.length).toBeGreaterThan(0);
      expect(step.validation.length).toBeGreaterThan(0);
    }
    expect(Object.keys(TEMPLATES).sort()).toEqual([...ALL].sort());
  });

  it('determinista: misma entrada, mismo plan y fingerprint (SHA-256 hex)', () => {
    expect(plan()).toEqual(plan());
    expect(plan().fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(plan().templatesVersion).toBe(TEMPLATES_VERSION);
  });

  it('el fingerprint cambia con perfil, revisión, selección y reglas, pero no con el nombre ni el orden de selección', () => {
    const base = plan().fingerprint;
    expect(plan({ name: 'Otro nombre' }).fingerprint).toBe(base);
    expect(plan({ alternativeIds: ['wireguard', 'nextcloud'] }).fingerprint).toBe(base);
    expect(plan({ profile: { ...PROFILE, ramGiB: 32, revision: 2 } }).fingerprint).not.toBe(base);
    expect(plan({ profile: { ...PROFILE, revision: 2 } }).fingerprint).not.toBe(base);
    expect(plan({ alternativeIds: ['nextcloud'] }).fingerprint).not.toBe(base);
    expect(plan({ ruleSet: { ...rules, rulesVersion: 'otra' } }).fingerprint).not.toBe(base);
    expect(TEMPLATES_VERSION).toBe('2026-11-22.2'); // 007: textos nuevos → avance anterior obsoleto
    const fp = planFingerprint({ projectId: PROJECT_ID, alternativeIds: ['a'], profile: { projectId: 'x', b: 1, a: 2 }, rulesVersion: 'r' });
    expect(planFingerprint({ projectId: PROJECT_ID, alternativeIds: ['a'], profile: { a: 2, b: 1 }, rulesVersion: 'r' })).toBe(fp);
  });

  it('prompt copiable con contexto, restricciones, fuentes, validación y condiciones pendientes; sin secretos ni ejecución', () => {
    const p = plan({ alternativeIds: ['outline', 'nextcloud'], profile: { ...PROFILE, hasDomain: false, revision: 1 }, name: 'Wiki <b>familiar</b>' });
    const step = p.steps.find((s) => s.id === 'outline.installation');
    expect(step.prompt).toContain('«Wiki <b>familiar</b>»'); // texto plano; la UI lo muestra como texto
    expect(step.prompt).toContain('Otras alternativas del proyecto: Nextcloud.');
    expect(step.prompt).toContain('16 núcleos; 64 GiB de RAM');
    expect(step.prompt).toMatch(/Reglas para tu respuesta:\n- Explica los pasos/);
    expect(step.prompt).toContain('https://docs.getoutline.com/s/hosting/doc/docker-7pfeLP5a8t');
    expect(step.prompt).toContain('Cómo comprobar:\n- Se puede iniciar sesión');
    expect(step.prompt).toContain('No es una garantía.');
    expect(step.pending.map((w) => w.code)).toEqual(expect.arrayContaining(['domain-required', 'auth-provider-required']));
    expect(step.prompt).toContain('Outline requiere un dominio o subdominio dedicado.');
    for (const s of p.steps) {
      expect(s.prompt).toContain(`plan ${p.fingerprint.slice(0, 12)}`);
      expect(s.prompt).not.toMatch(/sk-[A-Za-z0-9]|api[_ ]?key|ssh |sudo |curl |\bhttp:\/\//i);
    }
  });

  it('FR-007: cada fase de las cinco alternativas tiene objetivo, contexto, precomprobaciones, acciones, seguridad, validación y recuperación', () => {
    const p = plan({ alternativeIds: ALL });
    const headings = ['Objetivo: ', 'Contexto relevante:', 'Condiciones pendientes', ...STEP_BLOCKS.map((b) => `${b.label}:`), 'Reglas para tu respuesta:', 'Fuentes oficiales:'];
    for (const s of p.steps) {
      for (const key of ['prechecks', 'tasks', 'security', 'validation', 'rollback']) {
        expect(s[key].length, `${s.id}.${key}`).toBeGreaterThan(0);
        for (const line of s[key]) expect(s.prompt, `${s.id}.${key}`).toContain(`- ${line}`);
      }
      // Bloques en orden fijo, cada uno una sola vez.
      const positions = headings.map((h) => s.prompt.indexOf(h));
      expect(positions.every((pos) => pos >= 0), s.id).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      expect(s.prompt).toContain(`Objetivo: ${s.stageLabel} de ${s.alternativeName} — ${s.title}. ${s.explanation}`);
      // Sin secretos, sin instalación ni acceso remoto automático, sin comandos destructivos.
      expect(s.prompt).not.toMatch(/sk-[A-Za-z0-9]|api[_ ]?key|\bssh\b|sudo |curl |rm -rf|\bhttp:\/\/|password=/i);
    }
    // Seguridad pertinente: bases de datos/Redis no expuestas en instalación con Docker; WireGuard solo el UDP del túnel.
    expect(p.steps.find((s) => s.id === 'outline.installation').security.join(' ')).toMatch(/No publicar los puertos de PostgreSQL ni de Redis/);
    expect(p.steps.find((s) => s.id === 'immich.installation').security.join(' ')).toMatch(/PostgreSQL ni de Redis/);
    expect(p.steps.find((s) => s.id === 'wireguard.installation').security.join(' ')).toMatch(/únicamente el puerto UDP/);
    expect(p.steps.find((s) => s.id === 'nextcloud.recovery').rollback.join(' ')).toMatch(/entorno separado/);
    // Las restricciones comunes piden confirmación antes de borrar o sobrescribir.
    expect(p.steps[0].prompt).toMatch(/borre, sobrescriba o reinicie algo, avísame/);
  });

  it('el prompt indica el origen guardado de CPU/RAM/disco y marca lo aproximado como pendiente', () => {
    const profile = { ...PROFILE, revision: 1 };
    const browser = { source: 'browser', certainty: 'approximate', capturedAt: '2026-11-22T09:00:00.000Z' };
    const imported = { source: 'import', certainty: 'reported', capturedAt: '2026-11-21T09:00:00.000Z' };
    const evaluation = evaluate({ profile, alternativeIds: ['nextcloud'], catalogNames, rules, provenance: { ramGiB: browser, storageGiB: imported } });
    const p = buildPlan({ projectId: PROJECT_ID, projectName: 'Casa', alternativeIds: ['nextcloud'], profile, evaluation, catalogNames });
    expect(p.steps[0].prompt).toContain('Origen de los datos: CPU declarado a mano; RAM aproximado por el navegador, pendiente de confirmar; Disco importado del diagnóstico.');
    expect(plan().steps[0].prompt).toContain('Origen de los datos: CPU declarado a mano; RAM declarado a mano; Disco declarado a mano.');
  });

  it('WireGuard con instalación nativa y claves locales; Matrix como protocolo y Synapse como servidor', () => {
    const p = plan({ alternativeIds: ['wireguard', 'matrix-synapse'] });
    const wg = p.steps.find((s) => s.id === 'wireguard.installation');
    expect(wg.title).toMatch(/nativa/);
    expect(wg.tasks.join(' ')).toMatch(/clave privada nunca sale/);
    expect(wg.sources.map((s) => s.url)).toContain('https://www.wireguard.com/install/');
    const synapse = p.steps.find((s) => s.id === 'matrix-synapse.preparation');
    expect(synapse.explanation).toMatch(/Matrix es el protocolo; Synapse es el servidor/);
  });

  it('bloqueado con motivos si hay insuficiencia o alternativa retirada, sin pasos para la retirada', () => {
    const small = plan({ profile: { ...PROFILE, ramGiB: 1, revision: 1 } });
    expect(small.blocked).toBe(true);
    expect(small.blockedReasons[0].code).toBe('ram-insufficient');
    expect(small.steps).toHaveLength(8); // contenido informativo visible
    const retired = plan({ alternativeIds: ['gitea', 'wireguard'] });
    expect(retired.blocked).toBe(true);
    expect(retired.blockedReasons).toEqual([expect.objectContaining({ code: 'retired-alternative', alternativeId: 'gitea' })]);
    expect(retired.steps.every((s) => s.alternativeId === 'wireguard')).toBe(true);
    expect(plan().blocked).toBe(false);
  });
});

describe('parseProgress', () => {
  const fp = 'a'.repeat(64);
  const fieldsOf = (body) => {
    try {
      parseProgress(body);
    } catch (error) {
      return Object.keys(error.fields ?? {});
    }
    return [];
  };
  it('acepta el cuerpo exacto y rechaza extras, repetidos, >100 y fingerprint inválido', () => {
    expect(parseProgress({ fingerprint: fp, completedStepIds: ['a.preparation'] })).toEqual({ fingerprint: fp, completedStepIds: ['a.preparation'] });
    expect(fieldsOf(JSON.parse(`{"fingerprint":"${fp}","completedStepIds":[],"__proto__":{"x":1}}`))).toEqual(['__proto__']);
    expect(fieldsOf({ fingerprint: fp, completedStepIds: ['x', 'x'] })).toEqual(['completedStepIds']);
    expect(fieldsOf({ fingerprint: fp, completedStepIds: Array.from({ length: 101 }, (_, i) => `s${i}`) })).toEqual(['completedStepIds']);
    expect(fieldsOf({ fingerprint: 'corto', completedStepIds: [] })).toEqual(['fingerprint']);
    expect(fieldsOf({ fingerprint: fp, completedStepIds: [1] })).toEqual(['completedStepIds']);
  });
});

// ---------------------------------------------------------------------------
const ORIGIN = 'http://127.0.0.1:5573';
const SECRET = randomBytes(32).toString('hex');
const fakeHash = (password) => `$argon2id$v=19$test$${Buffer.from(password, 'utf8').toString('base64')}`;
const fakeHasher = { hash: async (p) => fakeHash(p), verify: async (p, e) => e === fakeHash(p), verifyDummy: async () => false };

let dir;
const opened = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nomoresaas-plan-'));
});
afterEach(() => {
  for (const { auth, db } of opened.splice(0)) {
    auth.close();
    if (db.isOpen) db.close();
  }
  rmSync(dir, { recursive: true, force: true });
});

function build({ path = join(dir, 'plan.sqlite'), fresh = true } = {}) {
  const db = openDatabase(path);
  if (fresh) migrate(db);
  const now = () => Date.parse('2026-11-22T12:00:00.000Z');
  const auth = createAuth({ db, sessionSecret: SECRET, appOrigin: ORIGIN, cookieSecure: false, now, hasher: fakeHasher });
  const projects = createProjects({ db, catalog, auth, now });
  opened.push({ auth, db });
  return { app: createApp({ catalog, logger: { error: vi.fn() }, auth, projects }), db, auth };
}

function send(agent, method, path, body, token) {
  return agent[method](path).set('Content-Type', 'application/json').set('Origin', ORIGIN).set('X-CSRF-Token', token).send(JSON.stringify(body));
}

async function signUp(app, email) {
  const agent = request.agent(app);
  const pre = (await agent.get('/api/auth/session')).body.csrfToken;
  const res = await send(agent, 'post', '/api/auth/register', { email, password: 'una contraseña larga y segura' }, pre);
  expect(res.status).toBe(201);
  const cookie = res.headers['set-cookie'].find((c) => c.startsWith('nomoresaas.sid=')).split(';')[0];
  return { agent, token: res.body.csrfToken, cookie };
}

async function projectWithPlan(who, alternativeIds = ['nextcloud', 'wireguard']) {
  const created = await send(who.agent, 'post', '/api/projects', { name: 'Casa', alternativeIds }, who.token);
  const id = created.body.project.id;
  const doc = (await send(who.agent, 'put', `/api/projects/${id}/profile`, PROFILE, who.token)).body;
  return { id, doc };
}

const putProgress = (who, id, body) => send(who.agent, 'put', `/api/projects/${id}/progress`, body, who.token);

describe('avance HTTP', () => {
  it('plan en GET workflow; marcar, recargar y reiniciar la API con la misma DB conserva el avance', async () => {
    const path = join(dir, 'restart.sqlite');
    const first = build({ path });
    const ana = await signUp(first.app, 'ana@example.com');
    const { id, doc } = await projectWithPlan(ana);
    expect(doc.plan.steps).toHaveLength(8);
    expect(doc.progress).toEqual({ completedStepIds: [], stale: false, updatedAt: null });

    const saved = await putProgress(ana, id, { fingerprint: doc.plan.fingerprint, completedStepIds: ['wireguard.preparation', 'nextcloud.preparation'] });
    expect(saved.status).toBe(200);
    // Orden normalizado al del plan; timestamp del servidor; sin prompts ni credenciales.
    expect(saved.body).toEqual({ fingerprint: doc.plan.fingerprint, completedStepIds: ['nextcloud.preparation', 'wireguard.preparation'], updatedAt: '2026-11-22T12:00:00.000Z' });
    expect(first.db.prepare('SELECT * FROM project_progress').get()).toEqual({
      project_id: id,
      fingerprint: doc.plan.fingerprint,
      completed_step_ids: '["nextcloud.preparation","wireguard.preparation"]',
      updated_at: '2026-11-22T12:00:00.000Z',
    });
    expect((await ana.agent.get(`/api/projects/${id}/workflow`)).body.progress.completedStepIds).toEqual(['nextcloud.preparation', 'wireguard.preparation']);
    first.auth.close();
    first.db.close();

    const second = build({ path, fresh: false });
    const reloaded = await request(second.app).get(`/api/projects/${id}/workflow`).set('Cookie', ana.cookie);
    expect(reloaded.body.plan.fingerprint).toBe(doc.plan.fingerprint);
    expect(reloaded.body.progress).toEqual({ completedStepIds: ['nextcloud.preparation', 'wireguard.preparation'], stale: false, updatedAt: '2026-11-22T12:00:00.000Z' });
  });

  it('cambiar el equipo invalida el avance: lectura stale vacía, escritura antigua 409, la nueva no hereda', async () => {
    const { app } = build();
    const ana = await signUp(app, 'ana@example.com');
    const { id, doc } = await projectWithPlan(ana);
    const old = doc.plan.fingerprint;
    await putProgress(ana, id, { fingerprint: old, completedStepIds: ['nextcloud.preparation'] });

    const changed = (await send(ana.agent, 'put', `/api/projects/${id}/profile`, { ...PROFILE, ramGiB: 32 }, ana.token)).body;
    expect(changed.plan.fingerprint).not.toBe(old);
    expect(changed.progress).toEqual({ completedStepIds: [], stale: true, updatedAt: null });
    const stale = await putProgress(ana, id, { fingerprint: old, completedStepIds: ['nextcloud.preparation'] });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('PLAN_STALE');

    const fresh = await putProgress(ana, id, { fingerprint: changed.plan.fingerprint, completedStepIds: [] });
    expect(fresh.status).toBe(200);
    expect((await ana.agent.get(`/api/projects/${id}/workflow`)).body.progress).toMatchObject({ completedStepIds: [], stale: false });
  });

  it('cambiar la selección también invalida; renombrar el proyecto no', async () => {
    const { app } = build();
    const ana = await signUp(app, 'ana@example.com');
    const { id, doc } = await projectWithPlan(ana);
    await putProgress(ana, id, { fingerprint: doc.plan.fingerprint, completedStepIds: ['wireguard.recovery'] });
    await send(ana.agent, 'patch', `/api/projects/${id}`, { name: 'Casa renombrada' }, ana.token);
    expect((await ana.agent.get(`/api/projects/${id}/workflow`)).body.progress.completedStepIds).toEqual(['wireguard.recovery']);
    await send(ana.agent, 'patch', `/api/projects/${id}`, { alternativeIds: ['wireguard'] }, ana.token);
    const after = (await ana.agent.get(`/api/projects/${id}/workflow`)).body;
    expect(after.progress).toEqual({ completedStepIds: [], stale: true, updatedAt: null });
    expect(after.plan.steps.every((s) => s.alternativeId === 'wireguard')).toBe(true);
  });

  it('paso ajeno al plan 400; sin perfil 409; CSRF 403', async () => {
    const { app } = build();
    const ana = await signUp(app, 'ana@example.com');
    const { id, doc } = await projectWithPlan(ana);
    const bad = await putProgress(ana, id, { fingerprint: doc.plan.fingerprint, completedStepIds: ['immich.preparation'] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields).toEqual({ completedStepIds: 'Paso desconocido.' });
    const created = await send(ana.agent, 'post', '/api/projects', { name: 'Sin perfil', alternativeIds: ['outline'] }, ana.token);
    expect((await putProgress(ana, created.body.project.id, { fingerprint: doc.plan.fingerprint, completedStepIds: [] })).status).toBe(409);
    const csrf = await send(ana.agent, 'put', `/api/projects/${id}/progress`, { fingerprint: doc.plan.fingerprint, completedStepIds: [] }, 'falso');
    expect(csrf.status).toBe(403);
  });

  it('aislamiento: otra cuenta no lee ni escribe plan/avance (404 indistinguible); borrar el proyecto elimina el avance', async () => {
    const { app, db } = build();
    const ana = await signUp(app, 'ana@example.com');
    const bea = await signUp(app, 'bea@example.com');
    const { id, doc } = await projectWithPlan(ana);
    await putProgress(ana, id, { fingerprint: doc.plan.fingerprint, completedStepIds: ['nextcloud.installation'] });

    const read = await bea.agent.get(`/api/projects/${id}/workflow`);
    expect(read.status).toBe(404);
    expect(read.text).not.toContain(doc.plan.fingerprint);
    const write = await putProgress(bea, id, { fingerprint: doc.plan.fingerprint, completedStepIds: [] });
    const missing = await putProgress(bea, '00000000-0000-4000-8000-000000000000', { fingerprint: doc.plan.fingerprint, completedStepIds: [] });
    expect(write.status).toBe(404);
    expect(write.body).toEqual(missing.body);
    expect((await ana.agent.get(`/api/projects/${id}/workflow`)).body.progress.completedStepIds).toEqual(['nextcloud.installation']);

    expect((await send(ana.agent, 'delete', `/api/projects/${id}`, {}, ana.token)).status).toBe(204);
    expect(db.prepare('SELECT count(*) AS n FROM project_progress').get().n).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM project_profiles').get().n).toBe(0);
  });
});
