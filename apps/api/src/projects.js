import { randomUUID } from 'node:crypto';
import express from 'express';
import { isValidId } from './catalog.js';
import { ApiError, invalidId, notFound } from './errors.js';
import { loadRules } from './evaluation.js';
import { mountWorkflow } from './workflow.js';

// Proyectos privados por cuenta. El propietario sale SIEMPRE de la sesión
// (req.user de requireUser); toda consulta filtra por id AND owner_id y un
// proyecto ajeno responde el mismo 404 que uno inexistente.

export const PROJECT_QUOTA = 100;
export const NAME_MIN = 3;
export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 1000;
export const SELECTION_MIN = 1;
export const SELECTION_MAX = 10;
const QUOTA_SQL_ERROR = 'PROJECT_QUOTA_EXCEEDED';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Nombre en una línea; la descripción admite saltos de línea y tabuladores.
// eslint-disable-next-line no-control-regex
const NAME_FORBIDDEN = /[\u0000-\u001f\u007f-\u009f]/;
// eslint-disable-next-line no-control-regex
const DESCRIPTION_FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

const errors = {
  validation: (message) => new ApiError(400, 'VALIDATION_ERROR', message),
  notFound: () => notFound('El proyecto no existe.'),
  quota: () => new ApiError(409, 'PROJECT_LIMIT_REACHED', `Has alcanzado el máximo de ${PROJECT_QUOTA} proyectos por cuenta.`),
};

const codePoints = (value) => [...value].length;

/** Exactamente un objeto JSON con claves permitidas; el resto (ownerId, id, fechas…) es 400. */
function readFields(body, allowed) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw errors.validation('El cuerpo debe ser un objeto JSON.');
  }
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw errors.validation('La petición contiene campos no permitidos.');
  }
  return body;
}

function parseName(value) {
  if (typeof value !== 'string') throw errors.validation('El nombre es obligatorio.');
  const name = value.trim();
  const length = codePoints(name);
  if (length < NAME_MIN || length > NAME_MAX) {
    throw errors.validation(`El nombre debe tener entre ${NAME_MIN} y ${NAME_MAX} caracteres.`);
  }
  if (NAME_FORBIDDEN.test(name)) throw errors.validation('El nombre contiene caracteres no permitidos.');
  return name;
}

function parseDescription(value) {
  if (typeof value !== 'string') throw errors.validation('La descripción debe ser texto.');
  const description = value.trim();
  if (codePoints(description) > DESCRIPTION_MAX) {
    throw errors.validation(`La descripción no puede superar ${DESCRIPTION_MAX} caracteres.`);
  }
  if (DESCRIPTION_FORBIDDEN.test(description)) throw errors.validation('La descripción contiene caracteres no permitidos.');
  return description;
}

/** Selección ordenada de 1–10 IDs únicos existentes HOY en el catálogo. */
function parseAlternativeIds(value, catalogIds) {
  if (!Array.isArray(value)) throw errors.validation('Selecciona entre 1 y 10 alternativas.');
  if (value.length < SELECTION_MIN || value.length > SELECTION_MAX) {
    throw errors.validation(`Selecciona entre ${SELECTION_MIN} y ${SELECTION_MAX} alternativas.`);
  }
  if (!value.every(isValidId)) throw errors.validation('Algún identificador de alternativa no es válido.');
  if (new Set(value).size !== value.length) throw errors.validation('La selección contiene alternativas repetidas.');
  if (!value.every((id) => catalogIds.has(id))) {
    throw errors.validation('La selección incluye alternativas que no existen en el catálogo.');
  }
  return [...value];
}

function parseProjectId(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw invalidId();
  return value.toLowerCase();
}

/**
 * @param {{
 *   db: import('node:sqlite').Database,
 *   catalog: { alternatives: { id: string, name: string }[] },
 *   auth: ReturnType<typeof import('./auth.js').createAuth>,
 *   now?: () => number,
 * }} options
 */
export function createProjects({ db, catalog, auth, now = Date.now, rules = loadRules() }) {
  if (!db || !catalog || !auth) throw new Error('createProjects requiere db, catálogo y auth');
  const catalogNames = new Map(catalog.alternatives.map((alternative) => [alternative.id, alternative.name]));
  const catalogIds = new Set(catalogNames.keys());

  const sql = {
    list: db.prepare(
      'SELECT id, name, description, created_at, updated_at FROM projects WHERE owner_id = ? ORDER BY updated_at DESC, id ASC LIMIT ?',
    ),
    listSelections: db.prepare(
      `SELECT s.project_id, s.alternative_id FROM project_selections s
       JOIN projects p ON p.id = s.project_id
       WHERE p.owner_id = ? ORDER BY s.project_id, s.position`,
    ),
    get: db.prepare('SELECT id, name, description, created_at, updated_at FROM projects WHERE id = ? AND owner_id = ?'),
    selection: db.prepare('SELECT alternative_id FROM project_selections WHERE project_id = ? ORDER BY position'),
    insert: db.prepare(
      'INSERT INTO projects (id, owner_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    insertSelection: db.prepare('INSERT INTO project_selections (project_id, alternative_id, position) VALUES (?, ?, ?)'),
    update: db.prepare('UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ? AND owner_id = ?'),
    clearSelection: db.prepare('DELETE FROM project_selections WHERE project_id = ?'),
    remove: db.prepare('DELETE FROM projects WHERE id = ? AND owner_id = ?'),
  };

  /** Ejecuta `fn` en una transacción de escritura; cualquier error deja los datos previos intactos. */
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  }

  const timestamp = () => new Date(now()).toISOString();

  function toDto(row, alternativeIds) {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      alternativeIds,
      // Una alternativa retirada del catálogo se conserva sin inventar nombre.
      alternatives: alternativeIds.map((id) =>
        catalogNames.has(id) ? { id, name: catalogNames.get(id), available: true } : { id, name: null, available: false },
      ),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function findOwned(id, ownerId) {
    const row = sql.get.get(id, ownerId);
    if (!row) return null;
    return toDto(row, sql.selection.all(row.id).map((s) => s.alternative_id));
  }

  function writeSelection(projectId, alternativeIds) {
    alternativeIds.forEach((alternativeId, position) => sql.insertSelection.run(projectId, alternativeId, position));
  }

  const router = express.Router();
  router.use(auth.noStore, auth.session, auth.capCookie);
  const read = [auth.requireUser];
  const write = [...auth.mutationBody, auth.requireUser, auth.requireCsrf];

  router.get('/', ...read, (req, res) => {
    const ownerId = req.user.id;
    const selections = new Map();
    for (const { project_id: projectId, alternative_id: alternativeId } of sql.listSelections.all(ownerId)) {
      if (!selections.has(projectId)) selections.set(projectId, []);
      selections.get(projectId).push(alternativeId);
    }
    const projects = sql.list.all(ownerId, PROJECT_QUOTA).map((row) => toDto(row, selections.get(row.id) || []));
    res.json({ projects });
  });

  router.post('/', ...write, (req, res) => {
    const body = readFields(req.body, ['name', 'description', 'alternativeIds']);
    const name = parseName(body.name);
    const description = body.description === undefined ? '' : parseDescription(body.description);
    const alternativeIds = parseAlternativeIds(body.alternativeIds, catalogIds);
    const ownerId = req.user.id;
    const id = randomUUID();
    const at = timestamp();
    try {
      transaction(() => {
        sql.insert.run(id, ownerId, name, description, at, at);
        writeSelection(id, alternativeIds);
      });
    } catch (error) {
      if (error && typeof error.message === 'string' && error.message.includes(QUOTA_SQL_ERROR)) throw errors.quota();
      throw error;
    }
    res.status(201).json({ project: findOwned(id, ownerId) });
  });

  router.get('/:id', ...read, (req, res) => {
    const project = findOwned(parseProjectId(req.params.id), req.user.id);
    if (!project) throw errors.notFound();
    res.json({ project });
  });

  router.patch('/:id', ...write, (req, res) => {
    const id = parseProjectId(req.params.id);
    const body = readFields(req.body, ['name', 'description', 'alternativeIds']);
    if (!Object.keys(body).length) throw errors.validation('Indica al menos un campo para modificar.');
    const changes = {
      name: body.name === undefined ? undefined : parseName(body.name),
      description: body.description === undefined ? undefined : parseDescription(body.description),
      alternativeIds: body.alternativeIds === undefined ? undefined : parseAlternativeIds(body.alternativeIds, catalogIds),
    };
    const ownerId = req.user.id;
    const found = transaction(() => {
      const current = sql.get.get(id, ownerId);
      if (!current) return false;
      const at = timestamp();
      sql.update.run(
        changes.name ?? current.name,
        changes.description ?? current.description,
        at < current.created_at ? current.created_at : at,
        id,
        ownerId,
      );
      if (changes.alternativeIds) {
        sql.clearSelection.run(id);
        writeSelection(id, changes.alternativeIds);
      }
      return true;
    });
    if (!found) throw errors.notFound();
    res.json({ project: findOwned(id, ownerId) });
  });

  router.delete('/:id', ...write, (req, res) => {
    const id = parseProjectId(req.params.id);
    readFields(req.body, []);
    // La selección se elimina por ON DELETE CASCADE en la misma sentencia.
    const { changes } = sql.remove.run(id, req.user.id);
    if (!changes) throw errors.notFound();
    res.status(204).end();
  });

  // Flujo privado (004): perfil/workflow con las mismas guardas y propiedad.
  mountWorkflow(router, { db, read, write, parseProjectId, notFound: errors.notFound, transaction, timestamp, catalogNames, rules });

  // Un :id con codificación porcentual inválida (URIError de Express) es un ID inválido.
  router.use((error, _req, _res, next) => next(error instanceof URIError ? invalidId() : error));
  router.use(auth.mapPublicErrors);

  return { router };
}
