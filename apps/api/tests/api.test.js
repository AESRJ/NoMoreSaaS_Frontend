import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { validateCatalog } from '../src/catalog.js';
import { migrate, openDatabase } from '../src/db.js';
import { startServer } from '../src/server.js';
import { validCatalog } from './fixtures.js';

const silentLogger = { error: vi.fn() };
const catalog = validateCatalog(validCatalog(), { today: '2026-11-20' });
const app = createApp({ catalog, logger: silentLogger });

function expectErrorBody(res, status, code) {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  expect(res.body.error.code).toBe(code);
  expect(typeof res.body.error.message).toBe('string');
  expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js|stack|node_modules/i);
}

describe('GET /api/health', () => {
  it('responde ok sin detalles de entorno', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /api/catalog', () => {
  it('devuelve la instantánea completa con orden estable', async () => {
    const res = await request(app).get('/api/catalog');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json; charset=utf-8/);
    expect(res.body.schemaVersion).toBe(1);
    expect(res.body.services.map((s) => s.id)).toEqual(['alfa', 'beta', 'zeta']);
    expect(res.body.alternatives.map((a) => a.id)).toEqual(['alt-uno', 'beta-alt', 'cuarta', 'otra']);
    expect(res.body.relations).toHaveLength(4);
  });

  it('ignora parámetros de consulta inesperados', async () => {
    const plain = await request(app).get('/api/catalog');
    const withQuery = await request(app).get('/api/catalog?q=alfa&services=x');
    expect(withQuery.body).toEqual(plain.body);
  });

  it('puede devolver un catálogo vacío', async () => {
    const empty = validateCatalog({ schemaVersion: 1, services: [], alternatives: [], relations: [] });
    const res = await request(createApp({ catalog: empty })).get('/api/catalog');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ schemaVersion: 1, services: [], alternatives: [], relations: [] });
  });

  it('aplica cabeceras de seguridad y oculta X-Powered-By', async () => {
    const res = await request(app).get('/api/catalog');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('GET /api/alternatives/:id', () => {
  it('devuelve la ficha y sus relaciones', async () => {
    const res = await request(app).get('/api/alternatives/cuarta');
    expect(res.status).toBe(200);
    expect(res.body.alternative.id).toBe('cuarta');
    expect(res.body.relations).toEqual([{ serviceId: 'alfa', alternativeId: 'cuarta', coverage: 'Cubre A también.' }]);
  });

  it.each(['Cuarta', 'con_guion', 'a'.repeat(81), '..%2F..%2Fetc', '-x', 'x--y'])('responde 400 INVALID_ID para %s', async (id) => {
    const res = await request(app).get(`/api/alternatives/${id}`);
    expectErrorBody(res, 400, 'INVALID_ID');
  });

  it('responde 404 NOT_FOUND para un ID válido inexistente', async () => {
    const res = await request(app).get('/api/alternatives/no-existe');
    expectErrorBody(res, 404, 'NOT_FOUND');
  });
});

describe('rutas y métodos no soportados', () => {
  it('responde 404 JSON para rutas desconocidas', async () => {
    expectErrorBody(await request(app).get('/api/desconocida'), 404, 'NOT_FOUND');
    expectErrorBody(await request(app).get('/'), 404, 'NOT_FOUND');
  });

  it.each(['post', 'put', 'patch', 'delete'])('no acepta escrituras con %s', async (method) => {
    const res = await request(app)[method]('/api/catalog').send({ schemaVersion: 1, services: [] });
    expectErrorBody(res, 404, 'NOT_FOUND');
    const after = await request(app).get('/api/catalog');
    expect(after.body.services).toHaveLength(3);
  });

  it('no permite modificar la instantánea en memoria', () => {
    expect(() => {
      catalog.services.push({ id: 'x' });
    }).toThrow();
  });
});

describe('errores internos', () => {
  it('responde 500 INTERNAL_ERROR sin stack y registra diagnóstico local', async () => {
    const logger = { error: vi.fn() };
    const broken = new Proxy(catalog, {
      get(target, prop) {
        if (prop === 'alternatives') throw new Error('fallo interno /ruta/secreta');
        return target[prop];
      },
    });
    const res = await request(createApp({ catalog: broken, logger })).get('/api/alternatives/otra');
    expectErrorBody(res, 500, 'INTERNAL_ERROR');
    expect(res.text).not.toContain('secreta');
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('arranque del servidor', () => {
  it('no arranca con un dataset inválido', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'catalogo-'));
    const file = join(dir, 'invalido.json');
    await writeFile(file, JSON.stringify({ schemaVersion: 1, services: [{ id: 'X' }], alternatives: [], relations: [] }));
    await expect(startServer({ catalogPath: file, port: 0 })).rejects.toThrow(/Catálogo inválido/);
  });

  // Desde T002 el servidor real exige configuración de identidad y DB migrada.
  // Solo DB temporales: nunca la ruta por defecto del desarrollador.
  const SECRET = randomBytes(32).toString('hex');
  const envFor = (dir, extra = {}) => ({
    DATABASE_PATH: join(dir, 'api.sqlite'),
    SESSION_SECRET: SECRET,
    APP_ORIGIN: 'http://127.0.0.1:5573',
    ...extra,
  });
  async function migratedDir() {
    const dir = await mkdtemp(join(tmpdir(), 'api-server-'));
    const db = openDatabase(join(dir, 'api.sqlite'));
    migrate(db);
    db.close();
    return dir;
  }

  it('arranca con el seed real enlazado a 127.0.0.1 por defecto', async () => {
    const dir = await migratedDir();
    const server = await startServer({ port: 0, env: envFor(dir) });
    try {
      expect(server.address().address).toBe('127.0.0.1');
      const res = await request(server).get('/api/auth/session');
      expect(res.status).toBe(200);
      expect(res.body.user).toBeNull();
      expect((await request(server).get('/api/catalog')).status).toBe(200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('producción: 0.0.0.0, origen de Railway, SPA en el mismo origen y /api 404 JSON', async () => {
    const dir = await migratedDir();
    const web = join(dir, 'web');
    await mkdir(join(web, 'assets'), { recursive: true });
    await writeFile(join(web, 'index.html'), '<!doctype html><div id="root"></div>');
    await writeFile(join(web, 'assets', 'app-abc123.js'), 'console.log(1)');
    const env = envFor(dir, { NODE_ENV: 'production', APP_ORIGIN: '', RAILWAY_PUBLIC_DOMAIN: 'nomoresaas.up.railway.app' });
    const server = await startServer({ port: 0, env, staticDir: web });
    try {
      expect(server.address().address).toBe('0.0.0.0');
      const home = await request(server).get('/');
      expect(home.status).toBe(200);
      expect(home.text).toContain('id="root"');
      expect(home.headers['cache-control']).toBe('no-cache');
      const deep = await request(server).get('/proyectos/123/flujo');
      expect(deep.status).toBe(200);
      expect(deep.text).toContain('id="root"');
      const asset = await request(server).get('/assets/app-abc123.js');
      expect(asset.status).toBe(200);
      expect(asset.headers['cache-control']).toMatch(/immutable/);
      expectErrorBody(await request(server).get('/assets/falta.js'), 404, 'NOT_FOUND');
      expectErrorBody(await request(server).get('/api/no-existe'), 404, 'NOT_FOUND');
      expectErrorBody(await request(server).post('/cualquier'), 404, 'NOT_FOUND');
      expect((await request(server).get('/api/health')).body).toEqual({ status: 'ok' });
      // Tras el proxy de Railway (1 salto) la sesión se considera segura.
      const session = await request(server).get('/api/auth/session').set('X-Forwarded-Proto', 'https');
      expect(session.status).toBe(200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('producción sin la web compilada no arranca', async () => {
    const dir = await migratedDir();
    try {
      const env = envFor(dir, { NODE_ENV: 'production', APP_ORIGIN: 'https://app.example.com' });
      await expect(startServer({ port: 0, env, staticDir: join(dir, 'nada') })).rejects.toThrow(/pnpm build/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('no arranca sin configuración válida ni sustituye la DB por memoria', async () => {
    const dir = await migratedDir();
    try {
      await expect(startServer({ port: 0, env: envFor(dir, { SESSION_SECRET: '' }) })).rejects.toThrow(/SESSION_SECRET/);
      await expect(startServer({ port: 0, env: envFor(dir, { APP_ORIGIN: 'http://ejemplo.com' }) })).rejects.toThrow(/APP_ORIGIN/);
      await expect(startServer({ port: 0, env: envFor(dir, { DATABASE_PATH: ':memory:' }) })).rejects.toThrow(/DATABASE_PATH/);
      await expect(startServer({ port: 0, env: envFor(dir, { DATABASE_PATH: join(dir, 'falta', 'x.sqlite') }) })).rejects.toThrow(
        /No se pudo abrir/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('no arranca con una DB sin migrar', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'api-server-'));
    try {
      await expect(startServer({ port: 0, env: envFor(dir) })).rejects.toThrow(/pnpm db:migrate/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
