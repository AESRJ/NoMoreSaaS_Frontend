import { randomBytes } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

// Configuración de la API solo para la ejecución de Playwright (no es una spec):
// cada ejecución crea su propio directorio temporal con una DB nueva, un
// secreto criptográfico generado en runtime y APP_ORIGIN igual a la web de
// prueba. Nunca usa la DB ni el .env del desarrollador: las variables
// explícitas del entorno prevalecen sobre --env-file-if-exists de Node.

const PREFIX = 'nomoresaas-e2e-';
// Playwright vuelve a cargar la configuración en sus workers; heredan esta
// variable y reutilizan el directorio del proceso principal sin crear otro.
const RUN_DIR_VAR = 'NOMORESAAS_E2E_RUN_DIR';

function isOwnRunDir(path) {
  try {
    return dirname(realpathSync(path)) === realpathSync(tmpdir()) && basename(path).startsWith(PREFIX);
  } catch {
    return false;
  }
}

function runDir() {
  const inherited = process.env[RUN_DIR_VAR];
  if (inherited) {
    if (!isOwnRunDir(inherited)) {
      throw new Error(`${RUN_DIR_VAR} no apunta a un directorio temporal de esta ejecución e2e.`);
    }
    return inherited;
  }
  const dir = mkdtempSync(join(tmpdir(), PREFIX));
  process.env[RUN_DIR_VAR] = dir;
  // Limpieza al salir el proceso principal, cuando Playwright ya detuvo la API
  // (Windows no permite borrar la DB mientras está abierta).
  process.once('exit', () => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      console.error(`[e2e] no se pudo borrar ${dir}: ${error.message}`);
    }
  });
  return dir;
}

/** Variables exclusivas del proceso API de prueba. */
export function createApiTestEnv({ webUrl }) {
  return {
    DATABASE_PATH: join(runDir(), 'api.sqlite'),
    SESSION_SECRET: randomBytes(32).toString('hex'),
    APP_ORIGIN: webUrl,
  };
}
