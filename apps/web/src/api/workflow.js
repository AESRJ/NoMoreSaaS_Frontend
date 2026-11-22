import { AuthRequestError, send } from './auth.js';

// Cliente del flujo privado de un proyecto (entrega 004): documento workflow
// {profile, evaluation, plan, progress}, guardado del perfil y del avance.
// Comprobación de forma superficial: cualquier respuesta inesperada se trata
// como error, nunca como estado vacío.

const INVALID = 'El servidor devolvió una respuesta inesperada. Inténtalo de nuevo.';
const invalid = () => new AuthRequestError('invalid', INVALID);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

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

function toProfile(value) {
  if (value === null) return null;
  if (!isObject(value) || !Number.isInteger(value.revision)) throw invalid();
  const profile = { revision: value.revision };
  for (const key of PROFILE_FIELDS) {
    if (!Object.hasOwn(value, key)) throw invalid();
    profile[key] = value[key];
  }
  return profile;
}

function toEvaluation(value) {
  if (value === null) return null;
  if (!isObject(value) || typeof value.status !== 'string' || !Array.isArray(value.items) || !Array.isArray(value.warnings) || !isObject(value.totals)) {
    throw invalid();
  }
  return value;
}

function toPlan(value) {
  if (value === null) return null;
  if (!isObject(value) || typeof value.fingerprint !== 'string' || !Array.isArray(value.steps) || typeof value.blocked !== 'boolean') {
    throw invalid();
  }
  return { ...value, blockedReasons: Array.isArray(value.blockedReasons) ? value.blockedReasons : [] };
}

function toProgress(value) {
  if (!isObject(value) || !Array.isArray(value.completedStepIds)) throw invalid();
  return {
    completedStepIds: value.completedStepIds.filter((id) => typeof id === 'string'),
    stale: value.stale === true,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
  };
}

export function toWorkflow(data) {
  if (!isObject(data)) throw invalid();
  return {
    profile: toProfile(data.profile ?? null),
    evaluation: toEvaluation(data.evaluation ?? null),
    plan: toPlan(data.plan ?? null),
    progress: toProgress(data.progress),
  };
}

const base = (id) => `/api/projects/${encodeURIComponent(id)}`;

export async function getWorkflow(id, { signal } = {}) {
  return toWorkflow(await send(`${base(id)}/workflow`, { signal }));
}

/** Reemplaza el perfil completo (solo los campos editables) y devuelve el documento recalculado. */
export async function saveProfile(id, profile, { csrfToken }) {
  const body = Object.fromEntries(PROFILE_FIELDS.map((key) => [key, profile[key]]));
  return toWorkflow(await send(`${base(id)}/profile`, { method: 'PUT', body, csrfToken }));
}

export async function saveProgress(id, { fingerprint, completedStepIds }, { csrfToken }) {
  const data = await send(`${base(id)}/progress`, { method: 'PUT', body: { fingerprint, completedStepIds }, csrfToken });
  if (!isObject(data) || data.fingerprint !== fingerprint || !Array.isArray(data.completedStepIds)) throw invalid();
  return { fingerprint: data.fingerprint, completedStepIds: data.completedStepIds, updatedAt: data.updatedAt ?? null };
}
