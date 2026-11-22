// Carga y validación del catálogo curado. Solo lectura: el dataset se valida
// completo al iniciar y se congela; cualquier error detiene el arranque.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const DEFAULT_CATALOG_PATH = fileURLToPath(new URL('../data/catalog.json', import.meta.url));

export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ID_MAX = 80;

const LICENSE_CLASSIFICATIONS = ['open-source', 'source-available', 'unknown'];
// Publicables: código abierto o código disponible (p. ej. BSL) declarado como tal.
// Una licencia sin clasificar no se publica.
const PUBLISHABLE_LICENSES = ['open-source', 'source-available'];
// Cobertura mínima del seed vigente (entrega 004): cinco SaaS y cinco alternativas.
export const SEED_MIN_SERVICES = 5;
export const SEED_MIN_ALTERNATIVES = 5;
const DIFFICULTY_LEVELS = ['basic', 'intermediate', 'advanced', 'unknown'];
const SOURCE_KINDS = ['official', 'editorial'];
export const SUPPORTABLE_FIELDS = [
  'name',
  'description',
  'capabilities',
  'limitations',
  'license',
  'difficulty',
  'hostingNotes',
  'officialUrl',
  'documentationUrl',
];

export class CatalogValidationError extends Error {
  constructor(problems) {
    super(`Catálogo inválido (${problems.length} problema(s)):\n- ${problems.join('\n- ')}`);
    this.name = 'CatalogValidationError';
    this.problems = problems;
  }
}

export function isValidId(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= ID_MAX && ID_PATTERN.test(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkText(problems, path, value, max, { min = 1 } = {}) {
  if (typeof value !== 'string') {
    problems.push(`${path}: debe ser texto`);
    return;
  }
  const length = value.trim().length;
  if (length < min || length > max) {
    problems.push(`${path}: longitud tras trim debe estar entre ${min} y ${max}`);
  }
}

function checkHttpUrl(problems, path, value) {
  if (typeof value !== 'string') {
    problems.push(`${path}: debe ser una URL`);
    return;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    problems.push(`${path}: URL no válida`);
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    problems.push(`${path}: solo se admiten URL HTTP(S)`);
  }
}

function checkId(problems, path, value) {
  if (!isValidId(value)) {
    problems.push(`${path}: identificador no cumple ${ID_PATTERN} (1-${ID_MAX})`);
  }
}

function checkStringList(problems, path, value, { min, max, itemMax }) {
  if (!Array.isArray(value)) {
    problems.push(`${path}: debe ser una lista`);
    return;
  }
  if (value.length < min || value.length > max) {
    problems.push(`${path}: debe tener entre ${min} y ${max} elementos`);
  }
  value.forEach((item, index) => checkText(problems, `${path}[${index}]`, item, itemMax));
}

function isValidIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function checkSource(problems, path, source, today) {
  if (!isPlainObject(source)) {
    problems.push(`${path}: debe ser un objeto`);
    return;
  }
  checkHttpUrl(problems, `${path}.url`, source.url);
  if (!isValidIsoDate(source.checkedAt)) {
    problems.push(`${path}.checkedAt: fecha ISO YYYY-MM-DD no válida`);
  } else if (source.checkedAt > today) {
    problems.push(`${path}.checkedAt: no puede ser posterior a ${today}`);
  }
  if (!Array.isArray(source.supports) || source.supports.length === 0) {
    problems.push(`${path}.supports: debe ser una lista no vacía`);
  } else {
    source.supports.forEach((field, index) => {
      if (!SUPPORTABLE_FIELDS.includes(field)) {
        problems.push(`${path}.supports[${index}]: campo desconocido "${String(field)}"`);
      }
    });
  }
  if (!SOURCE_KINDS.includes(source.kind)) {
    problems.push(`${path}.kind: debe ser ${SOURCE_KINDS.join(' o ')}`);
  }
  if (source.note !== undefined) {
    checkText(problems, `${path}.note`, source.note, 1000, { min: 0 });
  }
  if (source.kind === 'editorial') {
    checkText(problems, `${path}.note`, source.note, 1000);
  }
}

function checkHttpsUrl(problems, path, value) {
  const before = problems.length;
  checkHttpUrl(problems, path, value);
  if (problems.length === before && new URL(value).protocol !== 'https:') {
    problems.push(`${path}: debe ser una URL HTTPS`);
  }
}

// Metadatos opcionales de Service (005): URL oficial y fuentes oficiales.
// Los fixtures anteriores sin estos campos siguen siendo válidos.
export const SERVICE_SOURCES_MAX = 8;

function checkServiceMetadata(problems, path, service, today) {
  if (service.officialUrl !== undefined) checkHttpsUrl(problems, `${path}.officialUrl`, service.officialUrl);
  if (service.sources === undefined) return;
  if (!Array.isArray(service.sources) || service.sources.length < 1 || service.sources.length > SERVICE_SOURCES_MAX) {
    problems.push(`${path}.sources: debe ser una lista de 1 a ${SERVICE_SOURCES_MAX} fuentes`);
    return;
  }
  service.sources.forEach((source, index) => {
    const sourcePath = `${path}.sources[${index}]`;
    if (!isPlainObject(source)) {
      problems.push(`${sourcePath}: debe ser un objeto`);
      return;
    }
    checkHttpsUrl(problems, `${sourcePath}.url`, source.url);
    if (!isValidIsoDate(source.checkedAt)) {
      problems.push(`${sourcePath}.checkedAt: fecha ISO YYYY-MM-DD no válida`);
    } else if (source.checkedAt > today) {
      problems.push(`${sourcePath}.checkedAt: no puede ser posterior a ${today}`);
    }
    if (source.kind !== 'official') problems.push(`${sourcePath}.kind: debe ser official`);
    checkText(problems, `${sourcePath}.note`, source.note, 1000);
  });
}

function checkAlternative(problems, path, alt, today) {
  if (!isPlainObject(alt)) {
    problems.push(`${path}: debe ser un objeto`);
    return;
  }
  checkId(problems, `${path}.id`, alt.id);
  checkText(problems, `${path}.name`, alt.name, 120);
  checkText(problems, `${path}.description`, alt.description, 1000);
  checkStringList(problems, `${path}.capabilities`, alt.capabilities, { min: 1, max: 20, itemMax: 500 });
  checkStringList(problems, `${path}.limitations`, alt.limitations, { min: 0, max: 20, itemMax: 500 });

  if (!isPlainObject(alt.license)) {
    problems.push(`${path}.license: debe ser un objeto`);
  } else {
    checkText(problems, `${path}.license.label`, alt.license.label, 120);
    checkHttpUrl(problems, `${path}.license.url`, alt.license.url);
    if (!LICENSE_CLASSIFICATIONS.includes(alt.license.classification)) {
      problems.push(`${path}.license.classification: valor no permitido`);
    } else if (!PUBLISHABLE_LICENSES.includes(alt.license.classification)) {
      problems.push(`${path}.license.classification: solo se publican licencias open-source o source-available`);
    }
  }

  if (!isPlainObject(alt.difficulty)) {
    problems.push(`${path}.difficulty: debe ser un objeto`);
  } else {
    if (!DIFFICULTY_LEVELS.includes(alt.difficulty.level)) {
      problems.push(`${path}.difficulty.level: valor no permitido`);
    }
    checkText(problems, `${path}.difficulty.explanation`, alt.difficulty.explanation, 1000);
  }

  checkText(problems, `${path}.hostingNotes`, alt.hostingNotes, 2000);
  checkHttpUrl(problems, `${path}.officialUrl`, alt.officialUrl);
  checkHttpUrl(problems, `${path}.documentationUrl`, alt.documentationUrl);

  if (!Array.isArray(alt.sources) || alt.sources.length === 0) {
    problems.push(`${path}.sources: debe ser una lista no vacía`);
  } else {
    alt.sources.forEach((source, index) => checkSource(problems, `${path}.sources[${index}]`, source, today));
    if (Array.isArray(alt.limitations) && alt.limitations.length === 0) {
      const declared = alt.sources.some(
        (s) => isPlainObject(s) && Array.isArray(s.supports) && s.supports.includes('limitations') && typeof s.note === 'string' && s.note.trim(),
      );
      if (!declared) {
        problems.push(`${path}.limitations: lista vacía sin una fuente con nota que declare la revisión`);
      }
    }
    const editorialDifficulty = alt.sources.some(
      (s) => isPlainObject(s) && s.kind === 'editorial' && Array.isArray(s.supports) && s.supports.includes('difficulty'),
    );
    if (!editorialDifficulty) {
      problems.push(`${path}.difficulty: requiere una fuente editorial con motivo`);
    }
  }
}

function byNameThenId(a, b) {
  const byName = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
  if (byName !== 0) return byName;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

/**
 * Valida un dataset y devuelve una copia ordenada y congelada.
 * @param {unknown} data
 * @param {{ today?: string, requireSeedCoverage?: boolean }} [options]
 */
export function validateCatalog(data, { today = new Date().toISOString().slice(0, 10), requireSeedCoverage = false } = {}) {
  const problems = [];
  if (!isPlainObject(data)) {
    throw new CatalogValidationError(['raíz: debe ser un objeto']);
  }
  if (data.schemaVersion !== 1) problems.push('schemaVersion: debe ser 1');
  for (const key of ['services', 'alternatives', 'relations']) {
    if (!Array.isArray(data[key])) problems.push(`${key}: debe ser una lista`);
  }
  if (problems.length) throw new CatalogValidationError(problems);

  const serviceIds = new Set();
  data.services.forEach((service, index) => {
    const path = `services[${index}]`;
    if (!isPlainObject(service)) {
      problems.push(`${path}: debe ser un objeto`);
      return;
    }
    checkId(problems, `${path}.id`, service.id);
    checkText(problems, `${path}.name`, service.name, 120);
    checkText(problems, `${path}.description`, service.description, 1000);
    checkServiceMetadata(problems, path, service, today);
    if (serviceIds.has(service.id)) problems.push(`${path}.id: duplicado "${service.id}"`);
    serviceIds.add(service.id);
  });

  const alternativeIds = new Set();
  data.alternatives.forEach((alt, index) => {
    const path = `alternatives[${index}]`;
    checkAlternative(problems, path, alt, today);
    if (isPlainObject(alt)) {
      if (alternativeIds.has(alt.id)) problems.push(`${path}.id: duplicado "${alt.id}"`);
      alternativeIds.add(alt.id);
    }
  });

  const pairs = new Set();
  const relatedServices = new Set();
  const relatedAlternatives = new Set();
  data.relations.forEach((relation, index) => {
    const path = `relations[${index}]`;
    if (!isPlainObject(relation)) {
      problems.push(`${path}: debe ser un objeto`);
      return;
    }
    if (!serviceIds.has(relation.serviceId)) problems.push(`${path}.serviceId: referencia inexistente`);
    if (!alternativeIds.has(relation.alternativeId)) problems.push(`${path}.alternativeId: referencia inexistente`);
    checkText(problems, `${path}.coverage`, relation.coverage, 1000);
    const pair = `${relation.serviceId}\u0000${relation.alternativeId}`;
    if (pairs.has(pair)) problems.push(`${path}: pareja serviceId/alternativeId duplicada`);
    pairs.add(pair);
    relatedServices.add(relation.serviceId);
    relatedAlternatives.add(relation.alternativeId);
  });

  serviceIds.forEach((id) => {
    if (!relatedServices.has(id)) problems.push(`servicio "${id}": no tiene relaciones`);
  });
  alternativeIds.forEach((id) => {
    if (!relatedAlternatives.has(id)) problems.push(`alternativa "${id}": no tiene relaciones`);
  });

  // La regla antigua «un servicio con dos alternativas» queda sustituida (004):
  // no se exige inventar relaciones; comparar necesidades distintas sigue siendo válido.
  if (requireSeedCoverage) {
    if (serviceIds.size < SEED_MIN_SERVICES) problems.push(`seed: se requieren al menos ${SEED_MIN_SERVICES} servicios`);
    if (alternativeIds.size < SEED_MIN_ALTERNATIVES) {
      problems.push(`seed: se requieren al menos ${SEED_MIN_ALTERNATIVES} alternativas`);
    }
  }

  if (problems.length) throw new CatalogValidationError(problems);

  const copy = structuredClone({
    schemaVersion: 1,
    services: data.services,
    alternatives: data.alternatives,
    relations: data.relations,
  });
  copy.services.sort(byNameThenId);
  copy.alternatives.sort(byNameThenId);
  const serviceOrder = new Map(copy.services.map((s, i) => [s.id, i]));
  const alternativeOrder = new Map(copy.alternatives.map((a, i) => [a.id, i]));
  copy.relations.sort(
    (a, b) =>
      serviceOrder.get(a.serviceId) - serviceOrder.get(b.serviceId) ||
      alternativeOrder.get(a.alternativeId) - alternativeOrder.get(b.alternativeId),
  );
  return deepFreeze(copy);
}

/** Lee y valida el catálogo desde disco. Lanza en caso de JSON o datos inválidos. */
export async function loadCatalog(path = DEFAULT_CATALOG_PATH, options = {}) {
  const raw = await readFile(path, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new CatalogValidationError([`JSON no válido: ${error.message}`]);
  }
  return validateCatalog(data, options);
}

export function findAlternative(catalog, id) {
  const alternative = catalog.alternatives.find((alt) => alt.id === id);
  if (!alternative) return null;
  return {
    alternative,
    relations: catalog.relations.filter((relation) => relation.alternativeId === id),
  };
}
