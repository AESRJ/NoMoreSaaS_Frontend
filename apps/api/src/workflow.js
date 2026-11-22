import { ApiError } from './errors.js';

// Flujo privado por proyecto (entrega 004): perfil de equipo y documento
// workflow. Se monta dentro del router de /api/projects para reutilizar
// sesión, CSRF/Origin, parser limitado y mapeo de errores. El propietario sale
// SIEMPRE de la sesión: toda consulta une projects.id con owner_id, y un
// proyecto ajeno responde el mismo 404 que uno inexistente.
// Evaluación y plan se calculan en tareas posteriores; aquí son null y el
// avance va vacío, sin cambiar la forma final del documento.

export const PROFILE_FIELDS = Object.freeze([
  'cpuCores',
  'ramGiB',
  'storageGiB',
  'os',
  'architecture',
  'storageKind',
  'users',
  'dataGiB',
  'access',
  'hasDomain',
  'cpuFeaturesKnown',
]);

const OS = ['linux', 'windows', 'macos', 'unknown'];
const ARCHITECTURES = ['amd64', 'arm64', 'unknown'];
const STORAGE_KINDS = ['ssd', 'hdd', 'network', 'unknown'];
const ACCESS = ['local', 'internet'];

const validationError = (message, fields) => new ApiError(400, 'VALIDATION_ERROR', message, fields ? { fields } : undefined);

function integerIn(min, max) {
  return (value) =>
    Number.isInteger(value) && value >= min && value <= max ? null : `Debe ser un número entero entre ${min} y ${max}.`;
}

function numberIn(min, max) {
  return (value) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
      ? null
      : `Debe ser un número entre ${min} y ${max}.`;
}

function oneOf(options) {
  return (value) => (typeof value === 'string' && options.includes(value) ? null : `Debe ser uno de: ${options.join(', ')}.`);
}

const boolean = (value) => (typeof value === 'boolean' ? null : 'Debe ser verdadero o falso.');

const RULES = {
  cpuCores: integerIn(1, 256),
  ramGiB: numberIn(0.5, 4096),
  storageGiB: numberIn(1, 100000),
  os: oneOf(OS),
  architecture: oneOf(ARCHITECTURES),
  storageKind: oneOf(STORAGE_KINDS),
  users: integerIn(1, 10000),
  dataGiB: numberIn(0, 100000),
  access: oneOf(ACCESS),
  hasDomain: boolean,
  cpuFeaturesKnown: boolean,
};

/**
 * Valida el perfil completo (reemplazo total). Rechaza campos de servidor
 * (projectId, revision, ownerId…) o desconocidos y devuelve todos los errores
 * por campo. Devuelve una copia normalizada.
 */
export function parseProfile(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError('El cuerpo debe ser un objeto JSON.');
  }
  // Diccionario sin prototipo: claves propias como "__proto__", "constructor"
  // o "prototype" (JSON.parse las crea como propiedades propias) se registran
  // como campo no permitido igual que cualquier otra, sin tocar prototipos.
  const fields = Object.create(null);
  for (const key of Object.keys(body)) {
    if (!PROFILE_FIELDS.includes(key)) fields[key] = 'Campo no permitido.';
  }
  for (const key of PROFILE_FIELDS) {
    if (!Object.hasOwn(body, key)) {
      fields[key] = 'Campo obligatorio.';
      continue;
    }
    const problem = RULES[key](body[key]);
    if (problem) fields[key] = problem;
  }
  if (Object.keys(fields).length) throw validationError('El perfil del equipo no es válido.', fields);
  return Object.fromEntries(PROFILE_FIELDS.map((key) => [key, body[key]]));
}

function toRow(profile) {
  return [
    profile.cpuCores,
    profile.ramGiB,
    profile.storageGiB,
    profile.os,
    profile.architecture,
    profile.storageKind,
    profile.users,
    profile.dataGiB,
    profile.access,
    profile.hasDomain ? 1 : 0,
    profile.cpuFeaturesKnown ? 1 : 0,
  ];
}

function toProfileDto(row) {
  return {
    projectId: row.project_id,
    cpuCores: row.cpu_cores,
    ramGiB: row.ram_gib,
    storageGiB: row.storage_gib,
    os: row.os,
    architecture: row.architecture,
    storageKind: row.storage_kind,
    users: row.users,
    dataGiB: row.data_gib,
    access: row.access,
    hasDomain: row.has_domain === 1,
    cpuFeaturesKnown: row.cpu_features_known === 1,
    revision: row.revision,
  };
}

const sameContent = (a, b) => PROFILE_FIELDS.every((key) => a[key] === b[key]);

/**
 * Registra GET /:id/workflow y PUT /:id/profile en el router de proyectos.
 * @param {import('express').Router} router
 * @param {{
 *   db: import('node:sqlite').Database,
 *   read: import('express').RequestHandler[],
 *   write: import('express').RequestHandler[],
 *   parseProjectId: (value: unknown) => string,
 *   notFound: () => Error,
 *   transaction: <T>(fn: () => T) => T,
 *   timestamp: () => string,
 * }} deps
 */
export function mountWorkflow(router, { db, read, write, parseProjectId, notFound, transaction, timestamp }) {
  const sql = {
    owned: db.prepare('SELECT 1 AS ok FROM projects WHERE id = ? AND owner_id = ?'),
    profile: db.prepare(
      `SELECT f.* FROM project_profiles f JOIN projects p ON p.id = f.project_id
       WHERE f.project_id = ? AND p.owner_id = ?`,
    ),
    upsert: db.prepare(
      `INSERT INTO project_profiles (project_id, cpu_cores, ram_gib, storage_gib, os, architecture, storage_kind,
         users, data_gib, access, has_domain, cpu_features_known, revision, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id) DO UPDATE SET
         cpu_cores = excluded.cpu_cores, ram_gib = excluded.ram_gib, storage_gib = excluded.storage_gib,
         os = excluded.os, architecture = excluded.architecture, storage_kind = excluded.storage_kind,
         users = excluded.users, data_gib = excluded.data_gib, access = excluded.access,
         has_domain = excluded.has_domain, cpu_features_known = excluded.cpu_features_known,
         revision = excluded.revision, updated_at = excluded.updated_at`,
    ),
  };

  function workflowDocument(projectId, ownerId) {
    const row = sql.profile.get(projectId, ownerId);
    return {
      profile: row ? toProfileDto(row) : null,
      evaluation: null,
      plan: null,
      progress: { completedStepIds: [], stale: false, updatedAt: null },
    };
  }

  router.get('/:id/workflow', ...read, (req, res) => {
    const id = parseProjectId(req.params.id);
    if (!sql.owned.get(id, req.user.id)) throw notFound();
    res.json(workflowDocument(id, req.user.id));
  });

  router.put('/:id/profile', ...write, (req, res) => {
    const id = parseProjectId(req.params.id);
    const profile = parseProfile(req.body);
    const ownerId = req.user.id;
    const found = transaction(() => {
      if (!sql.owned.get(id, ownerId)) return false;
      const current = sql.profile.get(id, ownerId);
      if (current && sameContent(toProfileDto(current), profile)) return true; // sin cambios: misma revisión
      const revision = current ? current.revision + 1 : 1;
      sql.upsert.run(id, ...toRow(profile), revision, timestamp());
      return true;
    });
    if (!found) throw notFound();
    res.json(workflowDocument(id, ownerId));
  });
}
