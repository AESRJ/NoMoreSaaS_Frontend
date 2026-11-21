import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { validateCatalog } from '../src/catalog.js';
import { validCatalog } from './fixtures.js';

const app = createApp({ catalog: validateCatalog(validCatalog(), { today: '2026-11-20' }), logger: { error() {} } });

describe('revisión de seguridad (T016)', () => {
  it('un ID con codificación porcentual inválida responde 400 JSON sin stack', async () => {
    const res = await request(app).get('/api/alternatives/%E0%A4%A');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error.code).toBe('INVALID_ID');
    expect(res.text).not.toMatch(/URIError|at \w|node_modules/);
  });

  it('no sirve archivos ni recorre rutas de disco', async () => {
    for (const path of ['/api/../package.json', '/api/alternatives/..%2F..%2Fpackage.json', '/data/catalog.json', '/src/app.js']) {
      const res = await request(app).get(path);
      expect([400, 404]).toContain(res.status);
      expect(res.text).not.toContain('"dependencies"');
    }
  });

  it('OPTIONS no habilita CORS', async () => {
    const res = await request(app).options('/api/catalog').set('Origin', 'https://otro.example').set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
