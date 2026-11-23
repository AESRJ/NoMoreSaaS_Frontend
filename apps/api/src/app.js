import { extname, join } from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { findAlternative, isValidId } from './catalog.js';
import { createErrorHandler, invalidId, notFound, notFoundHandler } from './errors.js';

/**
 * Crea la aplicación Express a partir de un catálogo ya validado. El catálogo
 * es público y no usa sesión; `auth` (de createAuth) es opcional y, si se
 * inyecta, monta /api/auth. `projects` (de createProjects, requiere auth) monta
 * /api/projects. No abre puertos: `server.js` se encarga de `listen`.
 * @param {{
 *   catalog: object,
 *   logger?: Pick<Console, 'error'>,
 *   auth?: { router: import('express').Router },
 *   projects?: { router: import('express').Router },
 *   trustProxyHops?: number,
 *   staticDir?: string | null,
 * }} options
 *
 * Con `staticDir` (producción) sirve la SPA compilada en el mismo origen:
 * /api sigue respondiendo JSON (404 incluido), los assets con hash se cachean
 * como inmutables y cualquier otra ruta GET sin extensión devuelve index.html
 * para que React Router resuelva los enlaces profundos.
 */
export function createApp({ catalog, logger = console, auth, projects, trustProxyHops = 0, staticDir = null }) {
  if (!catalog) throw new Error('createApp requiere un catálogo validado');
  if (projects && !auth) throw new Error('createApp: /api/projects requiere auth');

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', 'strong');
  app.set('trust proxy', trustProxyHops > 0 ? trustProxyHops : false);
  app.use(helmet());

  if (auth) app.use('/api/auth', auth.router);
  if (projects) app.use('/api/projects', projects.router);

  const api = express.Router();

  api.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  api.get('/catalog', (_req, res) => {
    res.json(catalog);
  });

  api.get('/alternatives/:id', (req, res, next) => {
    const { id } = req.params;
    if (!isValidId(id)) return next(invalidId());
    const result = findAlternative(catalog, id);
    if (!result) return next(notFound('La alternativa solicitada no existe.'));
    res.json(result);
  });

  app.use('/api', api);
  app.use('/api', notFoundHandler);

  if (staticDir) {
    const indexFile = join(staticDir, 'index.html');
    app.use(
      express.static(staticDir, {
        index: false,
        dotfiles: 'ignore',
        setHeaders(res, path) {
          const immutable = path.includes(`${join(staticDir, 'assets')}`);
          res.set('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
        },
      }),
    );
    app.get(/.*/, (req, res, next) => {
      // Un archivo inexistente (con extensión) es 404, no un index falso.
      if (extname(req.path)) return next();
      res.set('Cache-Control', 'no-cache');
      res.sendFile(indexFile);
    });
  }

  // Cualquier otra ruta o método (incluidas escrituras) responde 404 JSON.
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}
