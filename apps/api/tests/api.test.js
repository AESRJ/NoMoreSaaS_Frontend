import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { validateCatalog } from '../src/catalog.js';
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

  it('arranca con el seed real enlazado a 127.0.0.1 por defecto', async () => {
    const server = await startServer({ port: 0 });
    try {
      expect(server.address().address).toBe('127.0.0.1');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
