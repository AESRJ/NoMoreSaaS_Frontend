import { ApiError } from './errors.js';
import { evaluate } from './evaluation.js';
import { buildPlan } from './plan.js';

// Flujo privado por proyecto (entrega 004): perfil de equipo y documento
// workflow. Se monta dentro del router de /api/projects para reutilizar
// sesión, CSRF/Origin, parser limitado y mapeo de errores. El propietario sale
// SIEMPRE de la sesión: toda consulta une projects.id con owner_id, y un
// proyecto ajeno responde el mismo 404 que uno inexistente.
// Evaluación (T003) y plan (T004) se recalculan en cada respuesta desde
// perfil, selección, reglas y plantillas versionadas; ambos null sin perfil.
// El avance (T004) se guarda por fingerprint del plan: si el plan cambia, la
// lectura devuelve avance vacío con stale:true y la escritura antigua es 409.

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

export const PROGRESS_MAX = 100;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const stalePlan = () => new ApiError(409, 'PLAN_STALE', 'El plan ha cambiado desde que lo cargaste. Recarga para ver el plan y el avance actuales.');

/** Cuerpo exacto {fingerprint, completedStepIds}; IDs únicos, máximo 100. */
export function parseProgress(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError('El cuerpo debe ser un objeto JSON.');
  }
  const fields = Object.create(null);
  for (const key of Object.keys(body)) {
    if (key !== 'fingerprint' && key !== 'completedStepIds') fields[key] = 'Campo no permitido.';
  }
  if (typeof body.fingerprint !== 'string' || !FINGERPRINT_PATTERN.test(body.fingerprint)) {
    fields.fingerprint = 'Identificador de plan no válido.';
  }
  const ids = body.completedStepIds;
  if (!Array.isArray(ids) || ids.length > PROGRESS_MAX || !ids.every((id) => typeof id === 'string' && id.length >= 1 && id.length <= 120)) {
    fields.completedStepIds = `Debe ser una lista de hasta ${PROGRESS_MAX} identificadores de paso.`;
  } else if (new Set(ids).size !== ids.length) {
    fields.completedStepIds = 'La lista contiene pasos repetidos.';
  }
  if (Object.keys(fields).length) throw validationError('El avance no es válido.', fields);
  return { fingerprint: body.fingerprint, completedStepIds: [...ids] };
}

/**
 * Registra GET /:id/workflow, PUT /:id/profile y PUT /:id/progress en el router de proyectos.
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
export function mountWorkflow(router, { db, read, write, parseProjectId, notFound, transaction, timestamp, catalogNames, rules }) {
  if (!catalogNames || !rules) throw new Error('mountWorkflow requiere nombres del catálogo y reglas de evaluación');
  const sql = {
    owned: db.prepare('SELECT id, name FROM projects WHERE id = ? AND owner_id = ?'),
    progress: db.prepare('SELECT fingerprint, completed_step_ids, updated_at FROM project_progress WHERE project_id = ?'),
    upsertProgress: db.prepare(
      `INSERT INTO project_progress (project_id, fingerprint, completed_step_ids, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (project_id) DO UPDATE SET
         fingerprint = excluded.fingerprint, completed_step_ids = excluded.completed_step_ids, updated_at = excluded.updated_at`,
    ),
    selection: db.prepare('SELECT alternative_id FROM project_selections WHERE project_id = ? ORDER BY position'),
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

  /** Estado actual (perfil, evaluación, plan) de un proyecto propio ya comprobado. */
  function currentState(project, ownerId) {
    const row = sql.profile.get(project.id, ownerId);
    const profile = row ? toProfileDto(row) : null;
    const alternativeIds = sql.selection.all(project.id).map((s) => s.alternative_id);
    const evaluation = evaluate({ profile, alternativeIds, catalogNames, rules });
    const plan = buildPlan({ projectId: project.id, projectName: project.name, alternativeIds, profile, evaluation, catalogNames });
    return { profile, evaluation, plan };
  }

  /** El avance solo se aplica si su fingerprint coincide con el plan actual; nunca se traslada. */
  function progressFor(projectId, plan) {
    const row = sql.progress.get(projectId);
    if (!row) return { completedStepIds: [], stale: false, updatedAt: null };
    if (!plan || row.fingerprint !== plan.fingerprint) return { completedStepIds: [], stale: true, updatedAt: null };
    const current = new Set(plan.steps.map((s) => s.id));
    return { completedStepIds: JSON.parse(row.completed_step_ids).filter((id) => current.has(id)), stale: false, updatedAt: row.updated_at };
  }

  /** Llamar solo tras comprobar la propiedad del proyecto. */
  function workflowDocument(project, ownerId) {
    const { profile, evaluation, plan } = currentState(project, ownerId);
    return { profile, evaluation, plan, progress: progressFor(project.id, plan) };
  }

  router.get('/:id/workflow', ...read, (req, res) => {
    const id = parseProjectId(req.params.id);
    const project = sql.owned.get(id, req.user.id);
    if (!project) throw notFound();
    res.json(workflowDocument(project, req.user.id));
  });

  router.put('/:id/progress', ...write, (req, res) => {
    const id = parseProjectId(req.params.id);
    const { fingerprint, completedStepIds } = parseProgress(req.body);
    const ownerId = req.user.id;
    // Plan actual y escritura en la misma transacción: un cambio concurrente de
    // perfil o selección no puede colarse entre la comprobación y el guardado.
    const saved = transaction(() => {
      const project = sql.owned.get(id, ownerId);
      if (!project) throw notFound();
      const { plan } = currentState(project, ownerId);
      if (!plan || plan.fingerprint !== fingerprint) throw stalePlan();
      const chosen = new Set(completedStepIds);
      const valid = new Set(plan.steps.map((s) => s.id));
      if (completedStepIds.some((stepId) => !valid.has(stepId))) {
        throw validationError('El avance contiene pasos que no pertenecen al plan actual.', { completedStepIds: 'Paso desconocido.' });
      }
      const ordered = plan.steps.map((s) => s.id).filter((stepId) => chosen.has(stepId));
      const at = timestamp();
      sql.upsertProgress.run(id, fingerprint, JSON.stringify(ordered), at);
      return { fingerprint, completedStepIds: ordered, updatedAt: at };
    });
    res.json(saved);
  });

  router.put('/:id/profile', ...write, (req, res) => {
    const id = parseProjectId(req.params.id);
    const profile = parseProfile(req.body);
    const ownerId = req.user.id;
    const project = transaction(() => {
      const owned = sql.owned.get(id, ownerId);
      if (!owned) return null;
      const current = sql.profile.get(id, ownerId);
      if (current && sameContent(toProfileDto(current), profile)) return owned; // sin cambios: misma revisión
      const revision = current ? current.revision + 1 : 1;
      sql.upsert.run(id, ...toRow(profile), revision, timestamp());
      return owned;
    });
    if (!project) throw notFound();
    res.json(workflowDocument(project, ownerId));
  });
}
