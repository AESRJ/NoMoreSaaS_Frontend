import { pathToFileURL } from 'node:url';
import { DEFAULT_CATALOG_PATH, loadCatalog } from './catalog.js';
import { createApp } from './app.js';

/**
 * Carga y valida el dataset y después escucha. Un dataset inválido rechaza la
 * promesa antes de abrir el puerto, así nunca se sirven datos parciales.
 */
export async function startServer({
  host = process.env.API_HOST || '127.0.0.1',
  port = Number(process.env.API_PORT || 3001),
  catalogPath = process.env.CATALOG_PATH || DEFAULT_CATALOG_PATH,
  logger = console,
} = {}) {
  const catalog = await loadCatalog(catalogPath, { requireSeedCoverage: catalogPath === DEFAULT_CATALOG_PATH });
  const app = createApp({ catalog, logger });
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(server);
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
