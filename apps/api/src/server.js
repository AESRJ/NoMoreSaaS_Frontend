import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { createAuth } from './auth.js';
import { DEFAULT_CATALOG_PATH, loadCatalog } from './catalog.js';
import { loadConfig, loadGoogleConfig } from './config.js';
import { DatabaseError, loadMigrations, openDatabase } from './db.js';
import { createGoogleProvider } from './google.js';
import { createProjects } from './projects.js';

/**
 * Comprueba que la DB tiene exactamente las migraciones de este código. El
 * servidor no migra por su cuenta: `pnpm db:migrate` es un paso explícito.
 */
export function assertMigrated(db, migrations = loadMigrations()) {
  const table = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  const applied = table ? db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version) : [];
  const known = new Set(migrations.map((m) => m.version));
  if (applied.some((v) => !known.has(v))) {
    throw new DatabaseError('La base tiene migraciones desconocidas para este código; no se arranca.');
  }
  if (migrations.some((m) => !applied.includes(m.version))) {
    throw new DatabaseError('La base de datos no está migrada; ejecuta pnpm db:migrate.');
  }
}

/**
 * Carga y valida el dataset, la configuración y la DB migrada; después
 * escucha. Cualquier fallo rechaza la promesa antes de abrir el puerto: nunca
 * se sirven datos parciales ni se sustituye la DB por memoria.
 */
export async function startServer({
  env = process.env,
  host = env.API_HOST || '127.0.0.1',
  port = Number(env.API_PORT || 3001),
  catalogPath = env.CATALOG_PATH || DEFAULT_CATALOG_PATH,
  logger = console,
  now,
} = {}) {
  const catalog = await loadCatalog(catalogPath, { requireSeedCoverage: catalogPath === DEFAULT_CATALOG_PATH });
  const config = loadConfig(env);
  // Todo-o-nada: sin variables de Google el proveedor queda desactivado.
  const googleConfig = loadGoogleConfig(env, config.appOrigin);
  const db = openDatabase(config.databasePath);
  let auth;
  let projects;
  try {
    assertMigrated(db);
    auth = createAuth({
      db,
      sessionSecret: config.sessionSecret,
      appOrigin: config.appOrigin,
      cookieSecure: config.cookieSecure,
      googleProvider: googleConfig ? createGoogleProvider(googleConfig) : null,
      logger,
      ...(now ? { now } : {}),
    });
    projects = createProjects({ db, catalog, auth, ...(now ? { now } : {}) });
  } catch (error) {
    auth?.close();
    db.close();
    throw error;
  }
  const app = createApp({ catalog, logger, auth, projects });
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, (error) => {
      if (error) {
        auth.close();
        if (db.isOpen) db.close();
        reject(error);
        return;
      }
      resolve(server);
    });
    server.on('close', () => {
      auth.close();
      if (db.isOpen) db.close();
    });
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  startServer()
    .then((server) => {
      const address = server.address();
      console.log(`[api] escuchando en http://${address.address}:${address.port}`);
    })
    .catch((error) => {
      console.error('[api] no se pudo iniciar:', error.message);
      process.exitCode = 1;
    });
}
