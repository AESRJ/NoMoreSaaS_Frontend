import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { createAuth } from './auth.js';
import { DEFAULT_CATALOG_PATH, loadCatalog } from './catalog.js';
import { REPO_ROOT, loadConfig } from './config.js';
import { DatabaseError, loadMigrations, openDatabase } from './db.js';
import { createProjects } from './projects.js';

export const DEFAULT_WEB_DIST = join(REPO_ROOT, 'apps', 'web', 'dist');

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
  host = env.API_HOST || (env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
  port = Number(env.PORT || env.API_PORT || 3001),
  staticDir = env.NODE_ENV === 'production' ? env.WEB_DIST_DIR || DEFAULT_WEB_DIST : null,
  catalogPath = env.CATALOG_PATH || DEFAULT_CATALOG_PATH,
  logger = console,
  now,
} = {}) {
  const catalog = await loadCatalog(catalogPath, { requireSeedCoverage: catalogPath === DEFAULT_CATALOG_PATH });
  const config = loadConfig(env);
  if (staticDir && !existsSync(join(staticDir, 'index.html'))) {
    throw new Error(`No se encontró la web compilada en ${staticDir}; ejecuta pnpm build.`);
  }
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
      ...(now ? { now } : {}),
    });
    projects = createProjects({ db, catalog, auth, ...(now ? { now } : {}) });
  } catch (error) {
    auth?.close();
    db.close();
    throw error;
  }
  const app = createApp({ catalog, logger, auth, projects, trustProxyHops: config.trustProxyHops, staticDir });
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
      // Railway envía SIGTERM al redesplegar: dejar de aceptar y cerrar la DB.
      const shutdown = (signal) => {
        console.log(`[api] ${signal} recibido; cerrando…`);
        server.close(() => process.exit(0));
        server.closeIdleConnections?.();
        setTimeout(() => process.exit(0), 10000).unref();
      };
      process.once('SIGTERM', shutdown);
      process.once('SIGINT', shutdown);
    })
    .catch((error) => {
      console.error('[api] no se pudo iniciar:', error.message);
      process.exitCode = 1;
    });
}
