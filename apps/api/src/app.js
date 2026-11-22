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
 * }} options
 */
export function createApp({ catalog, logger = console, auth, projects }) {
  if (!catalog) throw new Error('createApp requiere un catálogo validado');
  if (projects && !auth) throw new Error('createApp: /api/projects requiere auth');

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', 'strong');
  app.set('trust proxy', false);
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
  // Cualquier otra ruta o método (incluidas escrituras) responde 404 JSON.
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}
