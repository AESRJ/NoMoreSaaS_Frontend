// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import config, { readServerEnv } from '../vite.config.js';

// .env temporal (nunca el del desarrollador) con secretos de servidor y puertos
// propios del fixture, distintos de cualquier puerto que herede el proceso.
const NETWORK_KEYS = ['API_HOST', 'API_PORT', 'WEB_HOST', 'WEB_PORT'];
let dir;

beforeEach(() => {
  // loadEnv de Vite da prioridad a process.env: se aíslan las variables de red
  // SOLO en este proceso de prueba; vi.unstubAllEnvs las restaura en afterEach
  // aunque la prueba falle.
  for (const key of NETWORK_KEYS) vi.stubEnv(key, undefined);
  dir = mkdtempSync(join(tmpdir(), 'nomoresaas-vite-env-'));
  writeFileSync(
    join(dir, '.env'),
    [
      'API_HOST=127.0.0.1',
      'API_PORT=4101',
      'WEB_PORT=4202',
      'SESSION_SECRET=no-debe-salir-de-node-0123456789abcdef',
      'DATABASE_PATH=C:/ruta/privada.sqlite',
      'APP_ORIGIN=http://127.0.0.1:4202',
    ].join('\n'),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

it('lee del .env raíz solo host/puertos de red', () => {
  expect(readServerEnv('development', { root: dir })).toEqual({
    API_HOST: '127.0.0.1',
    API_PORT: '4101',
    WEB_PORT: '4202',
  });
});

it('el entorno del proceso prevalece sobre el .env', () => {
  vi.stubEnv('WEB_PORT', '5999');
  const env = readServerEnv('development', { root: dir });
  expect(env.WEB_PORT).toBe('5999');
  expect(env.API_PORT).toBe('4101');
  expect(readServerEnv('development', { root: dir, processEnv: { API_PORT: '6001' } }).API_PORT).toBe('6001');
});

it('la configuración no expone variables de servidor al bundle', () => {
  const resolved = config({ mode: 'production', command: 'build' });
  expect(resolved.define).toBeUndefined();
  expect(resolved.envDir).toBeUndefined(); // sigue en apps/web, no en la raíz con el .env
  expect(resolved.envPrefix).toBeUndefined(); // solo VITE_*
  expect(JSON.stringify(resolved)).not.toMatch(/SESSION_SECRET|DATABASE_PATH|APP_ORIGIN/);
});
